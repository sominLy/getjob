#!/usr/bin/env node
// 일회성 마이그레이션: data/jobs.json에 이미 들어간 잘못된
// jasoseol.com/employment/{id} 링크(404)를 회사 공식 채용페이지 링크로 고친다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function main() {
  const db = JSON.parse(await readFile(JOBS_PATH, "utf-8"));
  const targets = db.jobs.filter((j) => j.url?.startsWith("https://jasoseol.com/employment/"));
  console.log(`고칠 대상 ${targets.length}건`);

  let idx = 0;
  let fixed = 0;
  async function worker() {
    while (idx < targets.length) {
      const job = targets[idx++];
      const id = job.url.split("/").pop();
      job.url = `https://jasoseol.com/recruit/${id}`; // 기본 폴백
      try {
        const res = await fetch(`https://jasoseol.com/api/v1/employment_companies/${id}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
        });
        if (res.ok) {
          const detail = await res.json();
          if (detail.employment_page_url) {
            job.url = detail.employment_page_url;
            fixed++;
          }
        }
      } catch {
        // 폴백 유지
      }
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(`완료. 공식 링크로 교체됨: ${fixed}건, 나머지는 jasoseol 자체 링크로 폴백.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
