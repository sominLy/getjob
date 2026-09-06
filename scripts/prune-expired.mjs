#!/usr/bin/env node
// 마감된 지 오래된 자동 수집 공고를 정리한다. 매일 크론이 계속 공고를 쌓기만 하면
// 목록이 무한정 길어지고 파일도 계속 커지기 때문.
//
// 지우지 않는 것:
//  - 내가 직접 추가한 공고(자동 수집이 아닌 것) — 내 기록이다
//  - 마감일이 없는 상시·수시 공고
//  - 아직 마감 전이거나, 마감된 지 얼마 안 된 공고(회고용으로 잠시 남겨둔다)
// 지원 여부는 사용자 브라우저(localStorage/Supabase)에만 있어서 여기서는 알 수 없으므로,
// 최근 마감분은 유예 기간을 두고 남긴다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const DETAILS_PATH = path.join(DATA_DIR, "details.json");

const GRACE_DAYS = 45;
const AUTO_PREFIXES = ["jasoseol-", "wanted-", "linkareer-"];

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const details = await readJson(DETAILS_PATH, { updated: "", items: {} });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const before = db.jobs.length;
  db.jobs = db.jobs.filter((j) => {
    const isAuto = AUTO_PREFIXES.some((p) => j.id.startsWith(p));
    if (!isAuto) return true;
    if (!j.end) return true;             // 상시·수시 채용
    return j.end >= cutoffIso;
  });
  const removed = before - db.jobs.length;

  // 남은 공고가 참조하지 않는 본문은 같이 지운다(파일이 계속 커지는 것 방지).
  const liveIds = new Set(db.jobs.map((j) => j.id));
  let detailsRemoved = 0;
  for (const id of Object.keys(details.items ?? {})) {
    if (!liveIds.has(id)) { delete details.items[id]; detailsRemoved++; }
  }

  if (removed === 0 && detailsRemoved === 0) {
    console.log(`정리할 공고 없음 (기준: ${cutoffIso} 이전 마감).`);
    return;
  }

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");
  console.log(`마감 ${GRACE_DAYS}일 지난 공고 ${removed}건, 딸린 본문 ${detailsRemoved}건 정리. 남은 공고 ${db.jobs.length}건.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
