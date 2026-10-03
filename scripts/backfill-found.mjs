#!/usr/bin/env node
// 일회성: 저장소 기록(git log)을 거슬러 올라가 공고마다 '처음 발견한 날(found)'을 채운다.
// 이후로는 수집 스크립트가 새 공고에 그날 날짜를 직접 넣는다.
//
// 기록이 시작된 첫 커밋부터 있던 공고는 실제로 언제 떴는지 알 수 없으므로 비워 둔다
// (화면은 접수 시작일·게시일이 있으면 그것을 쓴다).
// 전체 기록이 필요하다: 얕은 클론이면 먼저 `git fetch --unshallow`.

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, TZ: "Asia/Seoul" } });
const readJson = async (f, fb) => { try { return JSON.parse(await readFile(path.join(ROOT, f), "utf-8")); } catch { return fb; } };
const writeJson = (f, o, indent) => writeFile(path.join(ROOT, f), JSON.stringify(o, null, indent) + "\n", "utf-8");

/** files의 각 커밋 시점 내용을 오래된 순서로 훑어 key별 처음 등장한 날(KST)을 모은다 */
function firstSeen(files, listOf, keyOf) {
  const log = git("log", "--reverse", "--format=%H %cd", "--date=format-local:%Y-%m-%d", "HEAD", "--", ...files).trim().split("\n").filter(Boolean);
  const first = new Map();
  const startDay = log.length ? log[0].split(" ")[1] : "";
  for (const line of log) {
    const [hash, day] = line.split(" ");
    for (const f of files) {
      let data;
      try { data = JSON.parse(git("show", `${hash}:${f}`)); } catch { continue; }
      for (const item of listOf(data)) {
        const k = keyOf(item);
        if (k && !first.has(k)) first.set(k, day);
      }
    }
  }
  // 첫 커밋부터 있던 것은 언제 떴는지 모름
  for (const [k, d] of first) if (d === startDay) first.set(k, "");
  return { first, startDay, commits: log.length };
}

async function main() {
  // 1) 지원보드 공고(목록 + 보관함) — id 기준
  const board = firstSeen(["data/jobs.json", "data/archive.json"], (d) => d.jobs || [], (j) => j.id);
  const jobs = await readJson("data/jobs.json", null);
  const archive = await readJson("data/archive.json", null);
  let nb = 0;
  for (const j of [...jobs.jobs, ...archive.jobs]) {
    if (!j.found && board.first.get(j.id)) { j.found = board.first.get(j.id); nb++; }
  }
  await writeJson("data/jobs.json", jobs, 2);
  await writeJson("data/archive.json", archive, 2);

  // 2) 기업 채용 — url 기준
  const comp = firstSeen(["data/company-jobs.json"], (d) => d.jobs || [], (j) => j.url);
  const cj = await readJson("data/company-jobs.json", null);
  let nc = 0;
  for (const j of cj.jobs) if (!j.found && comp.first.get(j.url)) { j.found = comp.first.get(j.url); nc++; }
  await writeJson("data/company-jobs.json", cj, 1);

  // 3) 주니어 공고판 — link 기준
  const jr = firstSeen(["artifact/data.json"], (d) => d.rows || [], (r) => r.link);
  const ad = await readJson("artifact/data.json", null);
  let nj = 0;
  for (const r of ad.rows) if (!r.found && jr.first.get(r.link)) { r.found = jr.first.get(r.link); nj++; }
  await writeJson("artifact/data.json", ad, 1);

  // 4) 매칭 아카이브 키워드 파일에도 같은 날짜를 붙인다(다음 수집부터는 build-jd-keywords.mjs가 넣음)
  const radar = await readJson("data/radar.json", { jobs: [] });
  const byId = new Map([...jobs.jobs, ...archive.jobs].map((j) => [j.id, j]));
  const byUrl = new Map([
    ...radar.jobs.map((j) => [j.url, { found: j.firstSeen || "", posted: "" }]),
    ...ad.rows.map((r) => [r.link, { found: r.found || "", posted: r.openDate || "" }]),
    ...cj.jobs.map((j) => [j.url, { found: j.found || "", posted: j.posted || "" }]),
  ]);
  const kw = await readJson("data/jd-keywords.json", null);
  let nk = 0;
  for (const j of kw.jobs) {
    const b = j.src === "board" ? byId.get(j.id) : null;
    const src = b ? { found: b.found || "", posted: b.start || "" } : byUrl.get(j.url);
    if (src) { j.found = j.found || src.found; j.posted = j.posted || src.posted; if (j.found || j.posted) nk++; }
  }
  await writeJson("data/jd-keywords.json", kw, 1);

  console.log(`기록 시작일 지원보드 ${board.startDay}(${board.commits}커밋) · 기업 채용 ${comp.startDay} · 주니어 ${jr.startDay}`);
  console.log(`처음 발견일 채움: 지원보드 ${nb} · 기업 채용 ${nc} · 주니어 ${nj} · 매칭 키워드 ${nk}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
