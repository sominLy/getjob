#!/usr/bin/env node
// 링커리어 + 자소설닷컴에서 PM/서비스기획·기획/전략 관련 인턴/신입 공고를 모아
// data/jobs.json에 병합한다. 기존 항목은 건드리지 않고 새 공고만 추가한다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 제목/카테고리 문자열에서 PM/서비스기획 관련 공고인지 판별
const ROLE_KEYWORDS = [
  { role: "PM/서비스기획", pattern: /서비스\s*기획|프로덕트|PM\b|product manager|PO\b/i },
  { role: "기획/전략", pattern: /경영기획|사업기획|전략기획|기획\/경영|기획팀|사업전략/i },
];

function matchRoles(text) {
  const roles = new Set();
  for (const { role, pattern } of ROLE_KEYWORDS) {
    if (pattern.test(text)) roles.add(role);
  }
  return [...roles];
}

function toDateOnly(isoOrEpoch) {
  const d =
    typeof isoOrEpoch === "number" ? new Date(isoOrEpoch) : new Date(isoOrEpoch);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ---------- 링커리어 ----------
async function fetchLinkareer() {
  const res = await fetch("https://linkareer.com/list/recruit", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`linkareer list fetch failed: ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("linkareer: __NEXT_DATA__ not found");
  const data = JSON.parse(m[1]);
  const apollo = data?.props?.pageProps?.__APOLLO_STATE__ ?? {};

  const results = [];
  for (const [key, value] of Object.entries(apollo)) {
    if (!key.startsWith("Activity:")) continue;
    if (!Array.isArray(value.jobTypes) || !value.jobTypes.includes("NEW")) continue;

    const categoryNames = (value.categories ?? [])
      .map((ref) => apollo[ref.__ref]?.name)
      .filter(Boolean)
      .join(" ");
    const text = `${value.title ?? ""} ${categoryNames}`;
    const roles = matchRoles(text);
    if (roles.length === 0) continue;

    results.push({
      id: `linkareer-${value.id}`,
      company: value.organizationName ?? "",
      type: "",
      roles,
      start: "",
      end: value.recruitCloseAt ? toDateOnly(value.recruitCloseAt) : "",
      confirmed: true,
      source: "링커리어",
      url: `https://linkareer.com/activity/${value.id}`,
      hist: "자동 수집",
    });
  }
  return results;
}

// ---------- 자소설닷컴 ----------
async function fetchJasoseol() {
  const start = new Date();
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const res = await fetch("https://jasoseol.com/employment/calendar_list.json", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`jasoseol fetch failed: ${res.status}`);
  const data = await res.json();

  const results = [];
  for (const item of data.employment ?? []) {
    const text = `${item.title ?? ""} ${item.name ?? ""}`;
    const roles = matchRoles(text);
    if (roles.length === 0) continue;

    results.push({
      id: `jasoseol-${item.id}`,
      company: item.name ?? "",
      type: "",
      roles,
      start: "",
      end: item.end_time ? toDateOnly(item.end_time) : "",
      confirmed: true,
      source: "자소설닷컴",
      url: `https://jasoseol.com/employment/${item.id}`,
      hist: "자동 수집",
    });
  }
  return results;
}

async function main() {
  const raw = await readFile(JOBS_PATH, "utf-8");
  const db = JSON.parse(raw);
  const existingUrls = new Set(db.jobs.map((j) => j.url));

  const [linkareer, jasoseol] = await Promise.all([
    fetchLinkareer().catch((err) => {
      console.error("링커리어 수집 실패:", err.message);
      return [];
    }),
    fetchJasoseol().catch((err) => {
      console.error("자소설닷컴 수집 실패:", err.message);
      return [];
    }),
  ]);

  const fresh = [...linkareer, ...jasoseol].filter(
    (job) => !existingUrls.has(job.url)
  );

  if (fresh.length === 0) {
    console.log("새 공고 없음.");
    return;
  }

  db.jobs.push(...fresh);
  db.updated = new Date().toISOString().slice(0, 10);

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(`새 공고 ${fresh.length}건 추가 (링커리어 ${linkareer.length}, 자소설닷컴 ${jasoseol.length} 중 중복 제외).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
