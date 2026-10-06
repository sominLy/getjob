#!/usr/bin/env node
// 매일 수집이 끝난 뒤 '오늘 무엇이 바뀌었는지'를 data/update-log.json에 한 줄(하루 한 항목) 남긴다.
// 직전 커밋(HEAD)의 데이터와 지금 파일을 비교한다 — 새로 들어온 공고, 보관함으로 간 공고, 빠진 공고, 기업 채용 새 공고.
// 같은 날 여러 번 돌면 그날 항목에 합친다. 기록은 지우지 않고 계속 쌓는다.
//
// node scripts/log-update.mjs            오늘 실행분 기록(워크플로 커밋 직전)
// node scripts/log-update.mjs --backfill 저장소 기록(‘공고 자동 업데이트’ 커밋)을 처음부터 훑어 지난 날짜를 채운다

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG = path.join(ROOT, "data", "update-log.json");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
const showJson = (rev, f) => { try { return JSON.parse(git("show", `${rev}:${f}`)); } catch { return null; } };
const readJson = async (f) => { try { return JSON.parse(await readFile(path.join(ROOT, f), "utf-8")); } catch { return null; } };

const brief = (j) => ({ id: j.id, company: j.company, title: (j.title || j.hist || "").slice(0, 60), roles: (j.roles || []).slice(0, 4), end: j.end || "", url: j.url || "" });

/** before/after 데이터 묶음({jobs, archive, comp})을 비교해 하루 기록을 만든다 */
function diff(date, before, after) {
  const real = (d) => (d?.jobs || []).filter((j) => j.confirmed !== false);
  const bJobs = new Map(real(before.jobs).map((j) => [j.id, j]));
  const aJobs = new Map(real(after.jobs).map((j) => [j.id, j]));
  const aArch = new Set((after.archive?.jobs || []).map((j) => j.id));
  const bArch = new Set((before.archive?.jobs || []).map((j) => j.id));
  const added = [...aJobs.values()].filter((j) => !bJobs.has(j.id) && !bArch.has(j.id)).map(brief);
  const gone = [...bJobs.values()].filter((j) => !aJobs.has(j.id));
  const archived = gone.filter((j) => aArch.has(j.id)).map((j) => ({ id: j.id, company: j.company, end: j.end || "" }));
  const removed = gone.filter((j) => !aArch.has(j.id)).map((j) => ({ id: j.id, company: j.company, title: (j.title || "").slice(0, 40) }));
  const bComp = new Set((before.comp?.jobs || []).map((j) => j.url));
  const compNew = (after.comp?.jobs || []).filter((j) => !bComp.has(j.url)).map((j) => ({ company: j.company, title: j.title.slice(0, 60), url: j.url }));
  const preds = (after.jobs?.jobs || []).filter((j) => j.confirmed === false && !j.doneBy).length;
  return {
    date, added, archived, removed, compNew,
    total: aJobs.size, archiveTotal: after.archive?.jobs?.length || 0, preds, compTotal: after.comp?.jobs?.length || 0,
  };
}

/** 같은 날짜 항목이 이미 있으면 합친다(목록은 id·url 기준 중복 제거, 합계는 마지막 실행 값) */
function merge(log, e) {
  const i = log.entries.findIndex((x) => x.date === e.date);
  if (i < 0) { log.entries.push(e); return; }
  const o = log.entries[i];
  const uniq = (arr, k) => { const s = new Set(); return arr.filter((x) => !s.has(x[k]) && s.add(x[k])); };
  log.entries[i] = { ...e,
    added: uniq([...o.added, ...e.added], "id"), archived: uniq([...o.archived, ...e.archived], "id"),
    removed: uniq([...o.removed, ...e.removed], "id"), compNew: uniq([...o.compNew, ...e.compNew], "url") };
}

async function main() {
  const log = (await readJson("data/update-log.json")) || { note: "매일 공고 업데이트 기록(scripts/log-update.mjs). 지우지 않고 쌓는다.", entries: [] };
  const snap = (rev) => ({ jobs: showJson(rev, "data/jobs.json"), archive: showJson(rev, "data/archive.json"), comp: showJson(rev, "data/company-jobs.json") });

  if (process.argv.includes("--backfill")) {
    const commits = git("log", "--reverse", "--format=%H %s", "HEAD", "--grep", "공고 자동 업데이트 20").trim().split("\n").filter(Boolean);
    for (const line of commits) {
      const [hash, ...rest] = line.split(" ");
      const date = rest.join(" ").match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (!date) continue;
      const after = snap(hash), before = snap(`${hash}~1`);
      if (!after.jobs || !before.jobs) continue;
      merge(log, { ...diff(date, before, after), backfilled: true });
    }
  } else {
    const date = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST 날짜
    const after = { jobs: await readJson("data/jobs.json"), archive: await readJson("data/archive.json"), comp: await readJson("data/company-jobs.json") };
    merge(log, diff(date, snap("HEAD"), after));
  }
  log.entries.sort((a, b) => a.date.localeCompare(b.date));
  log.updated = log.entries.at(-1)?.date || "";
  await writeFile(LOG, JSON.stringify(log, null, 1) + "\n", "utf-8");
  const last = log.entries.at(-1);
  console.log(`업데이트 기록 ${log.entries.length}일치 · 마지막 ${last?.date}: 새 공고 ${last?.added.length}, 보관 ${last?.archived.length}, 제외 ${last?.removed.length}, 기업 채용 새 공고 ${last?.compNew.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
