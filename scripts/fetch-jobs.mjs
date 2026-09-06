#!/usr/bin/env node
// 원티드·링커리어는 PM/서비스기획·기획/전략 관련 인턴/신입 공고만,
// 자소설닷컴은 신입/인턴 공고 전부(직무 무관)를 가져와 data/jobs.json에 병합한다.
// 기존 항목은 건드리지 않고 새 공고만 추가한다.

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
  { role: "기획/전략", pattern: /경영기획|사업기획|전략기획|기획\/경영|기획팀|사업전략|경영전략/i },
];

// 경력만 뽑는 공고는 제외 — "경력"이라는 말이 있어도 신입/인턴/수시 등 표현이 함께 있으면
// 신입도 지원 가능하다고 보고 포함한다.
// 자소설닷컴이 붙여둔 기업 규모/유형 → 지원보드의 "기업 형태" 값으로 매핑
function mapCompanyType(item) {
  if (item.business_type === "public_institution") return "공기업";
  if (item.business_size === "big_business") return "대기업";
  if (item.business_size === "middle_market") return "중견기업";
  return "";
}

const EXPERIENCED_ONLY = /경력/;
const NOT_EXPERIENCED_ONLY_HINT = /신입|인턴|수시|채용연계형|무관|공채|졸업예정/;
function isExperiencedOnly(text) {
  return EXPERIENCED_ONLY.test(text) && !NOT_EXPERIENCED_ONLY_HINT.test(text);
}

// "2026년 대졸신입 채용"처럼 직무가 안 적힌 대기업 공채 — 대부분 기획 트랙이 있어서
// 놓치면 안 되지만, 실제로 PM/기획인지는 공고를 봐야 알 수 있으므로 "확인 필요"로 표시한다.
const BATCH_PATTERN = /대졸\s*신입|신입\s*공채|공채|대규모/;
const BATCH_EXCLUDE = /생산|기술직|현장|영업직|엔지니어|디자이너|개발자|R&D|연구소|판매|매장|간호|약사|의사/i;

function classify(text) {
  const roles = new Set();
  for (const { role, pattern } of ROLE_KEYWORDS) {
    if (pattern.test(text)) roles.add(role);
  }
  if (roles.size > 0) return { roles: [...roles], hist: "자동 수집" };

  if (BATCH_PATTERN.test(text) && !BATCH_EXCLUDE.test(text)) {
    return {
      roles: ["PM/서비스기획", "기획/전략"],
      hist: "자동 수집 · 대졸 신입 공채 — 기획 트랙 포함 여부는 공고에서 직접 확인하세요",
    };
  }
  return null;
}

function toDateOnly(isoOrEpoch) {
  const d =
    typeof isoOrEpoch === "number" ? new Date(isoOrEpoch) : new Date(isoOrEpoch);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

const KST_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// 마감 "시각"(KST, HH:mm). 00:00이면 시각 정보가 없는 경우가 많아 표시하지 않는다.
function toTimeKST(isoOrEpoch) {
  const d =
    typeof isoOrEpoch === "number" ? new Date(isoOrEpoch) : new Date(isoOrEpoch);
  if (Number.isNaN(d.getTime())) return "";
  const t = KST_TIME.format(d);
  return t === "00:00" ? "" : t;
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
    const hit = classify(text);
    if (!hit) continue;

    results.push({
      id: `linkareer-${value.id}`,
      company: value.organizationName ?? "",
      type: "",
      roles: hit.roles,
      start: "",
      end: value.recruitCloseAt ? toDateOnly(value.recruitCloseAt) : "",
      endTime: value.recruitCloseAt ? toTimeKST(value.recruitCloseAt) : "",
      confirmed: true,
      source: "링커리어",
      url: `https://linkareer.com/activity/${value.id}`,
      hist: hit.hist,
    });
  }
  return results;
}

// 자소설닷컴의 직무 카테고리(duty-groups) id → 이름. "서비스기획·PM", "경영기획" 같은
// 정확한 직무명이 들어있어서, 제목만 보고 추측하는 것보다 훨씬 정확하게 분류할 수 있다.
async function fetchDutyGroupNames() {
  const res = await fetch("https://jasoseol.com/api/v1/duty-groups", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return new Map();
  const list = await res.json();
  return new Map(list.map((g) => [g.id, g.name]));
}

// ---------- 자소설닷컴 ----------
async function fetchJasoseol() {
  const start = new Date();
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
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
    fetchDutyGroupNames(),
  ]);
  if (!res.ok) throw new Error(`jasoseol fetch failed: ${res.status}`);
  const data = await res.json();

  // 자소설닷컴은 직무 필터 없이 신입/인턴/계약직 공고를 가져온다(경력만 뽑는 공고는 제외).
  // PM/기획 키워드가 없으면 roles를 비워두고 "직무 확인 필요"로 표시 —
  // 빈 roles는 index.html의 fits()가 필터로 걸러내지 않고 항상 보여준다.
  const results = [];
  for (const item of data.employment ?? []) {
    const dutyNames = (item.employments ?? [])
      .flatMap((e) => e.duty_groups ?? [])
      .map((g) => dutyGroupNames.get(g.group_id))
      .filter(Boolean)
      .join(" ");
    const text = `${item.title ?? ""} ${item.name ?? ""} ${dutyNames}`;
    if (isExperiencedOnly(text)) continue;
    const hit = classify(text);

    results.push({
      id: `jasoseol-${item.id}`,
      company: item.name ?? "",
      type: mapCompanyType(item),
      roles: hit ? hit.roles : [],
      start: "",
      end: item.end_time ? toDateOnly(item.end_time) : "",
      endTime: item.end_time ? toTimeKST(item.end_time) : "",
      confirmed: true,
      source: "자소설닷컴",
      url: `https://jasoseol.com/recruit/${item.id}`, // 아래에서 회사 공식 링크로 교체 시도
      hist: hit ? hit.hist : "자동 수집 · 직무 확인 필요",
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
      const text = `${item.position ?? ""}`;
      const hit = classify(text);
      if (!hit) continue;

      results.push({
        id: `wanted-${item.id}`,
        company: item.company?.name ?? "",
        type: "",
        roles: hit.roles,
        start: "",
        end: item.due_time ? toDateOnly(item.due_time) : "",
        endTime: item.due_time ? toTimeKST(item.due_time) : "",
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
  const existingUrls = new Set(db.jobs.map((j) => j.url));

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
