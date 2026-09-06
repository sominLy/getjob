#!/usr/bin/env node
// 이미 저장된 자소설닷컴 공고를 최신 분류 규칙(scripts/lib/classify.mjs)으로 다시 매긴다.
// 분류 규칙을 고칠 때마다 돌려서 과거 데이터도 같은 기준으로 맞추는 용도.
//  - 직무(roles): 공고에 표기된 직무 카테고리 기준으로 재분류
//  - 기업 형태(type), 접수 시작일(start): 누락분 채움
//  - 경력만 뽑는 공고: 제거

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyPosting, dutyNamesOf, fetchDutyGroupNames, isExperiencedOnly,
  mapCompanyType, toDateOnly, UNKNOWN_ROLE_HIST,
} from "./lib/classify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchCalendar() {
  const start = new Date();
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const res = await fetch("https://jasoseol.com/employment/calendar_list.json", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ start_time: start.toISOString(), end_time: end.toISOString() }),
  });
  if (!res.ok) throw new Error(`jasoseol fetch failed: ${res.status}`);
  return res.json();
}

async function main() {
  const db = JSON.parse(await readFile(JOBS_PATH, "utf-8"));
  const [dutyGroupNames, calData] = await Promise.all([fetchDutyGroupNames(UA), fetchCalendar()]);
  const byId = new Map((calData.employment ?? []).map((item) => [String(item.id), item]));

  let changed = 0, removed = 0, stillUnknown = 0;
  db.jobs = db.jobs.filter((job) => {
    if (job.source !== "자소설닷컴" || !job.id.startsWith("jasoseol-")) return true;
    const item = byId.get(job.id.replace("jasoseol-", ""));
    if (!item) return true; // 캘린더 조회 범위 밖(이미 지난 공고 등) — 건드리지 않는다

    const dutyNames = dutyNamesOf(item, dutyGroupNames);
    if (isExperiencedOnly(`${item.title ?? ""} ${item.name ?? ""} ${dutyNames.join(" ")}`)) {
      removed++;
      return false;
    }

    const hit = classifyPosting({ title: item.title, company: item.name, dutyNames });
    const next = {
      roles: hit ? hit.roles : [],
      hist: hit ? hit.hist : UNKNOWN_ROLE_HIST,
      type: mapCompanyType(item),
      start: toDateOnly(item.start_time),
    };
    if (!hit) stillUnknown++;

    let touched = false;
    for (const [key, value] of Object.entries(next)) {
      const same = Array.isArray(value)
        ? JSON.stringify(value) === JSON.stringify(job[key])
        : value === job[key];
      if (!same) { job[key] = value; touched = true; }
    }
    if (touched) changed++;
    return true;
  });

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(`수정 ${changed}건, 경력전용 제거 ${removed}건, 여전히 직무 미상 ${stillUnknown}건. 총 ${db.jobs.length}건.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
