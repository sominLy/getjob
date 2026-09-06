#!/usr/bin/env node
// 공고 하나에 여러 직무가 걸려 있는 경우(예: KT 대졸신입 = NW인프라운용 / B2B컨설팅&세일즈 /
// B2C마케팅&세일즈), 직무 목록과 직무별 자소서 문항을 details.json에 담는다.
//
// 자소설닷컴이 공고마다 직무(employments)를 나눠 두고, 직무별로 자소서 문항을 따로 갖고 있다.
// 문항 API는 공고 id가 아니라 "직무 id"로 물어봐야 답이 온다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const DETAILS_PATH = path.join(DATA_DIR, "details.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CONCURRENCY = 6;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

async function jsonPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

/** 한 직무의 자소서 문항. 없으면 빈 배열. */
async function fetchQuestions(employmentId) {
  const data = await jsonPost("https://jasoseol.com/employment/employment_question.json", {
    employment_id: employmentId,
  });
  const list = data?.employment_question;
  if (!Array.isArray(list)) return [];
  return list
    .map((q) => ({
      q: (q.question ?? "").replace(/\r/g, "").trim(),
      limit: q.total_count || 0,                      // 제한 글자수(0이면 표기 없음)
      space: q.include_space !== false,               // 공백 포함 여부
    }))
    .filter((q) => q.q);
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const details = await readJson(DETAILS_PATH, { updated: "", items: {} });

  const targets = db.jobs.filter(
    (j) => j.id.startsWith("jasoseol-") && !details.items[j.id]?.tracks
  );
  console.log(`대상 ${targets.length}건 (직무 정보 없는 자소설닷컴 공고)`);
  if (targets.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  let idx = 0, withTracks = 0, withQuestions = 0;

  async function worker() {
    while (idx < targets.length) {
      const job = targets[idx++];
      const jid = job.id.replace("jasoseol-", "");
      try {
        const res = await fetch(`https://jasoseol.com/api/v1/employment_companies/${jid}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
        });
        if (!res.ok) continue;
        const detail = await res.json();
        const employments = detail.employments ?? [];
        if (employments.length === 0) continue;

        const tracks = [];
        for (const e of employments) {
          const questions = await fetchQuestions(e.id);
          tracks.push({ name: e.field || "직무 미표기", questions });
          if (questions.length) withQuestions++;
        }

        const item = details.items[job.id] ?? { at: today };
        item.tracks = tracks;
        details.items[job.id] = item;
        withTracks++;
      } catch {
        // 개별 실패는 넘어간다
      }
      if (idx % 25 === 0) console.log(`진행 ${idx}/${targets.length} (직무 ${withTracks}, 문항 있는 직무 ${withQuestions})`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  details.updated = today;
  await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");
  console.log(`완료. 직무 정보 ${withTracks}건, 자소서 문항이 있는 직무 ${withQuestions}개.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
