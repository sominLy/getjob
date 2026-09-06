#!/usr/bin/env node
// 일회성 마이그레이션: 이미 저장된 자소설닷컴 공고에 마감 "시각"(endTime)을 채워 넣는다.
// (endTime 필드는 fetch-jobs.mjs가 신규 수집 시 이미 넣고 있음 — 이건 과거분 백필용)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const KST_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
});
function toTimeKST(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const t = KST_TIME.format(d);
  return t === "00:00" ? "" : t;
}

async function main() {
  const db = JSON.parse(await readFile(JOBS_PATH, "utf-8"));
  const targets = db.jobs.filter((j) => j.source === "자소설닷컴" && !j.endTime && j.id.startsWith("jasoseol-"));
  console.log(`대상 ${targets.length}건`);

  let idx = 0, filled = 0;
  async function worker() {
    while (idx < targets.length) {
      const job = targets[idx++];
      const jid = job.id.replace("jasoseol-", "");
      try {
        const res = await fetch(`https://jasoseol.com/api/v1/employment_companies/${jid}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
        });
        if (res.ok) {
          const detail = await res.json();
          if (detail.end_time) {
            const t = toTimeKST(detail.end_time);
            if (t) { job.endTime = t; filled++; }
          }
        }
      } catch {
        // 무시
      }
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(`완료. 시각 채움: ${filled}건.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
