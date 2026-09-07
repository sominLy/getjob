#!/usr/bin/env node
// 원티드·링커리어는 PM/서비스기획·기획/전략 관련 인턴/신입 공고만,
// 자소설닷컴은 신입/인턴 공고 전부(직무 무관)를 가져와 data/jobs.json에 병합한다.
// 기존 항목은 건드리지 않고 새 공고만 추가한다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyPosting, dutyNamesOf, fetchDutyGroupNames, isExperiencedOnly,
  mapCompanyType, toDateOnly, toTimeKST, UNKNOWN_ROLE_HIST,
} from "./lib/classify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const ARCHIVE_PATH = path.join(__dirname, "..", "data", "archive.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    const hit = classifyPosting({
      title: value.title,
      company: value.organizationName,
      dutyNames: categoryNames.split(" ").filter(Boolean),
    });
    if (!hit) continue;

    results.push({
      id: `linkareer-${value.id}`,
      company: value.organizationName ?? "",
      type: "",
      roles: hit.roles,
      start: "",
      end: toDateOnly(value.recruitCloseAt),
      endTime: toTimeKST(value.recruitCloseAt),
      confirmed: true,
      source: "링커리어",
      url: `https://linkareer.com/activity/${value.id}`,
      hist: hit.hist,
    });
  }
  return results;
}

// ---------- 자소설닷컴 ----------
async function fetchJasoseol() {
  /* 마감된 공고도 "이 회사가 언제 뽑았고 문항이 뭐였는지" 참고가 되므로 함께 받되,
     너무 오래된 건 도움이 안 돼서 최근 45일치까지만 본다. */
  const start = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const [res, dutyGroupNames] = await Promise.all([
    fetch("https://jasoseol.com/employment/calendar_list.json", {
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
    }),
    fetchDutyGroupNames(UA),
  ]);
  if (!res.ok) throw new Error(`jasoseol fetch failed: ${res.status}`);
  const data = await res.json();

  // 자소설닷컴은 직무 필터 없이 신입/인턴/계약직 공고를 가져온다(경력만 뽑는 공고는 제외).
  // 직무를 못 알아낸 공고는 roles를 비워두고 "직무 확인 필요"로 표시 —
  // 빈 roles는 index.html의 fits()가 필터로 걸러내지 않고 항상 보여준다.
  const results = [];
  for (const item of data.employment ?? []) {
    const dutyNames = dutyNamesOf(item, dutyGroupNames);
    if (isExperiencedOnly(`${item.title ?? ""} ${item.name ?? ""} ${dutyNames.join(" ")}`)) continue;
    const hit = classifyPosting({ title: item.title, company: item.name, dutyNames });

    results.push({
      id: `jasoseol-${item.id}`,
      company: item.name ?? "",
      type: mapCompanyType(item),
      roles: hit ? hit.roles : [],
      start: toDateOnly(item.start_time),
      end: toDateOnly(item.end_time),
      endTime: toTimeKST(item.end_time),
      confirmed: true,
      source: "자소설닷컴",
      url: `https://jasoseol.com/recruit/${item.id}`, // 아래에서 회사 공식 링크로 교체 시도
      hist: hit ? hit.hist : UNKNOWN_ROLE_HIST,
      _jasoseolId: item.id,
    });
  }
  await attachOfficialUrls(results);
  results.forEach((r) => delete r._jasoseolId);
  return results;
}

// 각 공고 상세에서 회사 공식 채용페이지 링크(employment_page_url)를 가져와 url을 교체한다.
// 실패하면 jasoseol 자체 공고 페이지 링크(위에서 이미 넣어둔 값)를 그대로 둔다.
async function attachOfficialUrls(results, concurrency = 8) {
  let idx = 0;
  async function worker() {
    while (idx < results.length) {
      const item = results[idx++];
      try {
        const res = await fetch(
          `https://jasoseol.com/api/v1/employment_companies/${item._jasoseolId}`,
          { headers: { "User-Agent": UA, Accept: "application/json" } }
        );
        if (!res.ok) continue;
        const detail = await res.json();
        if (detail.employment_page_url) item.url = detail.employment_page_url;
      } catch {
        // 무시 — jasoseol 자체 링크로 폴백
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ---------- 원티드 ----------
async function fetchWanted() {
  const results = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const res = await fetch(
      `https://www.wanted.co.kr/api/v4/jobs?country=kr&years=-1&locations=all&limit=100&offset=${offset}&job_sort=job.latest_order`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) throw new Error(`wanted fetch failed: ${res.status}`);
    const data = await res.json();
    const batch = data.data ?? [];
    if (batch.length === 0) break;

    for (const item of batch) {
      if ((item.annual_from ?? 0) > 0) continue; // 경력(연차 요구)만 있는 공고 제외
      const hit = classifyPosting({ title: item.position, company: item.company?.name });
      if (!hit) continue;

      results.push({
        id: `wanted-${item.id}`,
        company: item.company?.name ?? "",
        type: "",
        roles: hit.roles,
        start: "",
        end: toDateOnly(item.due_time),
        endTime: toTimeKST(item.due_time),
        confirmed: true,
        source: "원티드",
        url: `https://www.wanted.co.kr/wd/${item.id}`,
        hist: item.due_time ? hit.hist : `${hit.hist} · 상시/수시 채용으로 추정(마감일 미표기)`,
      });
    }
    if (!data.links?.next) break;
  }
  return results;
}

async function main() {
  const raw = await readFile(JOBS_PATH, "utf-8");
  const db = JSON.parse(raw);
  /* 이미 보관함으로 넘어간 마감 공고를 매일 다시 집어넣지 않도록 함께 비교한다 */
  let archived = [];
  try {
    archived = JSON.parse(await readFile(ARCHIVE_PATH, "utf-8")).jobs ?? [];
  } catch { /* 보관함이 아직 없으면 무시 */ }
  const existingUrls = new Set([...db.jobs, ...archived].map((j) => j.url));

  const [linkareer, jasoseol, wanted] = await Promise.all([
    fetchLinkareer().catch((err) => {
      console.error("링커리어 수집 실패:", err.message);
      return [];
    }),
    fetchJasoseol().catch((err) => {
      console.error("자소설닷컴 수집 실패:", err.message);
      return [];
    }),
    fetchWanted().catch((err) => {
      console.error("원티드 수집 실패:", err.message);
      return [];
    }),
  ]);

  const fresh = [...linkareer, ...jasoseol, ...wanted].filter(
    (job) => !existingUrls.has(job.url)
  );

  if (fresh.length === 0) {
    console.log("새 공고 없음.");
    return;
  }

  db.jobs.push(...fresh);
  db.updated = new Date().toISOString().slice(0, 10);

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(
    `새 공고 ${fresh.length}건 추가 (링커리어 ${linkareer.length}, 자소설닷컴 ${jasoseol.length}, 원티드 ${wanted.length} 중 중복 제외).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
