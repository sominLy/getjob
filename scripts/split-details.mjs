#!/usr/bin/env node
// 일회성 마이그레이션: jobs.json 안에 섞여 있던 공고 본문(detail/detailImage/detailAt)을
// data/details.json으로 분리한다.
//
// 이유: 앱은 첫 화면을 그리기 전에 jobs.json을 통째로 받는데, 본문까지 들어가면서
// 170KB → 1.3MB가 됐다. 본문은 공고 하나를 열어볼 때만 필요하므로 따로 두고
// 필요할 때만 받는다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const DETAILS_PATH = path.join(DATA_DIR, "details.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const details = await readJson(DETAILS_PATH, { updated: "", items: {} });

  let moved = 0;
  for (const job of db.jobs) {
    if (!job.detail && !job.detailImage) continue;
    details.items[job.id] = {
      ...(job.detail ? { detail: job.detail } : {}),
      ...(job.detailImage ? { image: job.detailImage } : {}),
      at: job.detailAt || "",
    };
    delete job.detail;
    delete job.detailImage;
    delete job.detailAt;
    moved++;
  }
  details.updated = new Date().toISOString().slice(0, 10);

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");
  console.log(`${moved}건을 details.json으로 분리했습니다.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
