#!/usr/bin/env node
// 마감된 공고를 data/archive.json으로 옮긴다.
//
// 지난 공고도 "이 회사가 언제 뽑았고 자소서 문항이 뭐였는지" 참고가 되므로 지우지 않는다.
// 다만 앱은 첫 화면을 그리기 전에 jobs.json을 통째로 받기 때문에, 당장 지원할 수 없는
// 공고까지 거기 들어 있으면 로딩만 무거워진다. 그래서 목록을 둘로 나눠 두고
// 화면에서는 "마감" 필터나 검색을 쓸 때만 archive.json을 받아 온다.
//
// 45일보다 오래된 것은 참고 가치도 떨어져 완전히 지운다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "archive.json");
const DETAILS_PATH = path.join(DATA_DIR, "details.json");

const KEEP_DAYS = 45;   // 최근 45일치 지난 공고만 참고용으로 남긴다
const AUTO_PREFIXES = ["jasoseol-", "wanted-", "linkareer-"];

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

function isAuto(job) {
  return AUTO_PREFIXES.some((p) => job.id.startsWith(p));
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const archive = await readJson(ARCHIVE_PATH, { updated: "", jobs: [] });
  const details = await readJson(DETAILS_PATH, { updated: "", items: {} });

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  // 1) 마감된 자동 수집 공고를 보관함으로 옮긴다(내가 직접 넣은 공고는 그대로 둔다)
  const moved = [];
  db.jobs = db.jobs.filter((j) => {
    if (!isAuto(j) || !j.end || j.end >= today) return true;
    moved.push(j);
    return false;
  });

  const seen = new Set(archive.jobs.map((j) => j.id));
  for (const j of moved) if (!seen.has(j.id)) archive.jobs.push(j);

  // 2) 너무 오래된 것은 보관함에서도 지운다
  const before = archive.jobs.length;
  archive.jobs = archive.jobs.filter((j) => !j.end || j.end >= cutoff);
  const dropped = before - archive.jobs.length;

  // 3) 어느 목록에도 없는 본문은 같이 지운다
  const liveIds = new Set([...db.jobs, ...archive.jobs].map((j) => j.id));
  let detailsDropped = 0;
  for (const id of Object.keys(details.items ?? {})) {
    if (!liveIds.has(id)) { delete details.items[id]; detailsDropped++; }
  }

  archive.jobs.sort((a, b) => (b.end || "").localeCompare(a.end || ""));
  archive.updated = today;

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  await writeFile(ARCHIVE_PATH, JSON.stringify(archive, null, 2) + "\n", "utf-8");
  if (detailsDropped) await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");

  console.log(`보관함으로 ${moved.length}건 이동, 오래돼서 삭제 ${dropped}건, 딸린 본문 정리 ${detailsDropped}건.`);
  console.log(`현재 목록 ${db.jobs.length}건 / 보관함 ${archive.jobs.length}건.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
