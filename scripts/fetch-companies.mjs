#!/usr/bin/env node
// 스타트업·유니콘·외국계 서울 오피스의 공식 채용 시스템에서 기획·PM·마케팅·운영 공고를 모아
// JD 키워드와 요구 연차를 뽑아 data/company-jobs.json에 저장한다(매칭 아카이브용).
// 연차 필터·최소 키워드 수는 build-jd-keywords.mjs에서 다른 공고와 같은 기준으로 적용한다.
//
// 회사 목록은 scripts/probe-sources.mjs 점검(2026-09-29)에서 실제로 공고가 읽힌 곳만 넣었다.
// 공개 채용 API(Greenhouse·Ashby·Workday·SmartRecruiters·넷플릭스) 또는 서버에서 그려진 그리팅 페이지만 쓴다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { yearsIn, weights } from "./lib/jd-keywords.mjs";
import { stripHtml, greetingJd, UA } from "./lib/jd-text.mjs";
import { isTalentPool, needsOtherLang } from "./lib/not-job.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "company-jobs.json");

// 기획·PM·마케팅·운영·사업·영업 직무만. 개발·디자인·설비 등은 뺀다.
const ROLE = /영업|세일즈|sales|account\s*(executive|manager|strategist)|\bAE\b|\bSDR\b|\bBDR\b|기획|PM\b|PO\b|product\s*(manager|owner|operations|marketing|strategist|lead)|프로덕트|program\s*manager|사업|business|전략|strategy|operations|운영|마케팅|marketing|marketer|growth|그로스|brand|브랜드|CRM|MD\b|머천다이|merchandis|콘텐츠|content|partnership|제휴|GTM|go[-\s]to[-\s]market|campaign|캠페인|community|커뮤니티|CX\b|customer\s*(experience|success)|intern|인턴/i;
const EXCLUDE = /engineer|엔지니어|developer|개발자|백엔드|프론트엔드|backend|frontend|designer|디자이너|scientist|researcher|연구원|devops|\bSRE\b|security|보안|legal|법무|counsel|accountant|회계|recruit|채용담당|talent\s*acquisition/i;
const SEOUL = /seoul|korea|서울|한국|대한민국|성남|판교/i;
const relevant = (title) => ROLE.test(title) && !EXCLUDE.test(title) && !isTalentPool(title);

const GREETING = [
  ["무신사", "https://musinsa.career.greetinghr.com"], ["CJ올리브영", "https://career.oliveyoung.com"],
  ["컬리", "https://kurly.career.greetinghr.com"], ["업스테이지", "https://upstage.career.greetinghr.com"],
  ["캐치테이블", "https://catchtable.career.greetinghr.com"], ["마이리얼트립", "https://myrealtrip.career.greetinghr.com"],
  ["여기어때", "https://gccompany.career.greetinghr.com"], ["뤼튼", "https://wrtn.career.greetinghr.com"],
  ["아이디어스", "https://idus.career.greetinghr.com"], ["스푼랩스", "https://spoonradio.career.greetinghr.com"],
  ["더핑크퐁컴퍼니", "https://thepinkfongcompany.career.greetinghr.com"], ["로앤컴퍼니", "https://lawcompany.career.greetinghr.com"],
  ["핀다", "https://finda.career.greetinghr.com"], ["스캐터랩", "https://scatterlab.career.greetinghr.com"],
  // 킥킷 채용처 색인(뉴스레터 9회차 등장 회사)에서 그리팅을 쓰는 곳
  ["넛지헬스케어(캐시워크)", "https://cashwalk12.career.greetinghr.com"], ["하이컨시", "https://hiconsy.career.greetinghr.com"],
  ["라이드플럭스", "https://rideflux.career.greetinghr.com"], ["피에프씨테크놀로지스", "https://pfct.career.greetinghr.com"],
  ["메가스터디교육", "https://megastudyedu.career.greetinghr.com"], ["미리디", "https://miridih.career.greetinghr.com"],
  ["아우토크립트", "https://autocrypt.career.greetinghr.com"], ["강남언니", "https://career.gangnamunni.com"],
  ["헥토", "https://www.hectocareers.co.kr"], ["하이브", "https://careers.hybecorp.com"],
  // 2026-10-03 점검: 쏘카·KT M모바일·컬리처럼 국내 소비자 서비스 기업 중 그리팅을 쓰는 곳
  ["카카오모빌리티", "https://kakaomobility.career.greetinghr.com"], ["카카오페이", "https://kakaopay.career.greetinghr.com"],
  ["숨고", "https://soomgo.career.greetinghr.com"], ["직방", "https://zigbang.career.greetinghr.com"],
  ["W컨셉", "https://wconcept.career.greetinghr.com"], ["크몽", "https://kmong.career.greetinghr.com"],
  ["SSG닷컴", "https://ssg.career.greetinghr.com"], ["11번가", "https://11st.career.greetinghr.com"],
];
const SMARTRECRUITERS = [["에이블리", "ABLYCorporation"]];
const GREENHOUSE = [
  ["크래프톤", "krafton"], ["당근", "daangn"], ["당근페이", "daangnpay"], ["몰로코", "moloco"],
  ["아고다", "agoda"], ["에어비앤비", "airbnb"], ["2K", "2k"],
];
const ASHBY = [["42dot", "42dot"], ["OpenAI", "openai"], ["Snowflake", "snowflake"]];
const WORKDAY = [
  ["세일즈포스", "salesforce.wd12", "salesforce", "External_Career_Site"],
  ["어도비", "adobe.wd5", "adobe", "external_experienced"],
  ["인텔", "intel.wd1", "intel", "External"],
  ["비자", "visa.wd5", "visa", "Visa"],
  // 텐센트: 서울 근무지 필터(locations)로 받는다 — 한국 공고가 적어 인턴(리서치 인턴 포함)까지 모두 둔다
  ["텐센트", "tencent.wd1", "tencent", "Tencent_Careers", { locations: ["b3d4dad114e4100177c233d159a40000"] }],
];

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 그리팅 목록 페이지에 박힌 {"deploy":…} 공고 객체들을 괄호 짝을 맞춰 꺼낸다 */
function greetingOpenings(html) {
  const out = [];
  let from = 0;
  for (;;) {
    const start = html.indexOf('{"deploy":', from);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) break;
    try { out.push(JSON.parse(html.slice(start, end))); } catch {}
    from = end;
  }
  return out;
}

async function collectGreeting(company, base) {
  const res = await fetch(`${base}/ko`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(String(res.status));
  const list = greetingOpenings(await res.text()).filter((o) => o.deploy && o.title && relevant(o.title));
  const jobs = [];
  for (const o of list) {
    const url = `${base}/ko/o/${o.openingId}`;
    try {
      const text = await greetingJd(url);
      jobs.push({ company, title: o.title.trim(), url, text, posted: (o.openDate || "").slice(0, 10) });
    } catch (e) { console.error(`  ${company} 본문 실패`, o.title, e.message); }
    await sleep(250);
  }
  return jobs;
}

async function collectGreenhouse(company, token) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return data.jobs
    .filter((j) => SEOUL.test(j.location?.name || "") && relevant(j.title))
    .map((j) => ({ company, title: j.title, url: j.absolute_url, text: stripHtml(j.content || ""), posted: (j.first_published || "").slice(0, 10) }));
}

async function collectAshby(company, org) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`);
  return data.jobs
    .filter((j) => SEOUL.test(`${j.location} ${JSON.stringify(j.secondaryLocations || [])}`) && relevant(j.title))
    .map((j) => ({ company, title: j.title, url: j.jobUrl, text: j.descriptionPlain || stripHtml(j.descriptionHtml || ""), posted: (j.publishedAt || "").slice(0, 10) }));
}

async function collectWorkday(company, host, tenant, site, facets) {
  const api = `https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;
  const list = await getJson(`${api}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: facets || {}, limit: 20, offset: 0, searchText: facets ? "" : "Seoul" }),
  });
  const jobs = [];
  for (const p of list.jobPostings || []) {
    if ((!facets && !SEOUL.test(p.locationsText || "")) || !relevant(p.title)) continue;
    try {
      const d = await getJson(`${api}${p.externalPath}`);
      jobs.push({ company, title: p.title, url: d.jobPostingInfo?.externalUrl || `https://${host}.myworkdayjobs.com/${site}${p.externalPath}`,
        text: stripHtml(d.jobPostingInfo?.jobDescription || "") });
    } catch (e) { console.error(`  ${company} 본문 실패`, p.title, e.message); }
  }
  return jobs;
}

async function collectSmartRecruiters(company, id) {
  const api = `https://api.smartrecruiters.com/v1/companies/${id}/postings`;
  const list = await getJson(`${api}?limit=100`);
  const jobs = [];
  for (const p of list.content || []) {
    if (!relevant(p.name)) continue;
    try {
      const d = await getJson(`${api}/${p.id}`);
      const secs = Object.values(d.jobAd?.sections || {}).map((x) => `${x.title || ""}\n${x.text || ""}`).join("\n");
      jobs.push({ company, title: p.name, url: d.postingUrl || `https://jobs.smartrecruiters.com/${id}/${p.id}`, text: stripHtml(secs), posted: (p.releasedDate || "").slice(0, 10) });
    } catch (e) { console.error(`  ${company} 본문 실패`, p.name, e.message); }
  }
  return jobs;
}

/* 쏘카: 자체 채용 사이트(Next.js) 페이지 데이터에 공고 목록이 있고, 상세는 그리팅 링크다.
   계열사(에이펙스모빌리티 등) 공고도 섞여 있어 회사 이름을 함께 남긴다. 근무지 제주(WA01)는 그대로 두고 표시만 한다. */
async function collectSocar() {
  const res = await fetch("https://www.socarcorp.kr/careers/jobs", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(String(res.status));
  const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("페이지 데이터 없음");
  const list = JSON.parse(m[1]).props?.pageProps?.jobList?.jsonResult?.data || [];
  const jobs = [];
  for (const j of list) {
    const title = (j.title || "").trim();
    if (!title || !relevant(title) || !j.notice_url) continue;
    const company = j.company_name && j.company_name !== "쏘카" ? `쏘카(${j.company_name})` : "쏘카";
    try {
      const text = /greetinghr\.com/.test(j.notice_url) ? await greetingJd(j.notice_url) : "";
      jobs.push({ company, title, url: j.notice_url, text });
    } catch (e) { console.error("  쏘카 본문 실패", title, e.message); }
    await sleep(250);
  }
  return jobs;
}

async function collectNetflix() {
  const data = await getJson("https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&location=Seoul&num=100");
  const jobs = [];
  for (const p of data.positions || []) {
    if (!SEOUL.test(p.location || "") || !relevant(p.name)) continue;
    // 목록의 설명은 앞부분만 올 때가 있어(연차 요건이 잘림) 상세 본문을 늘 받아 긴 쪽을 쓴다
    let text = p.job_description || "";
    try {
      const full = (await getJson(`https://explore.jobs.netflix.net/api/apply/v2/jobs/${p.id}?domain=netflix.com`)).job_description || "";
      if (full.length > text.length) text = full;
    } catch {}
    jobs.push({ company: "넷플릭스", title: p.name, url: p.canonicalPositionUrl || `https://explore.jobs.netflix.net/careers/job/${p.id}`, text: stripHtml(text) });
  }
  return jobs;
}

async function main() {
  // 처음 발견한 날은 직전 결과에서 이어받는다(새로 보인 공고만 오늘 날짜)
  let prevFound = new Map();
  try { prevFound = new Map(JSON.parse(await readFile(OUT, "utf-8")).jobs.map((j) => [j.url, j.found])); } catch {}
  const today = new Date().toISOString().slice(0, 10);
  const tasks = [
    ...GREETING.map(([c, b]) => [c, () => collectGreeting(c, b)]),
    ...GREENHOUSE.map(([c, t]) => [c, () => collectGreenhouse(c, t)]),
    ...ASHBY.map(([c, o]) => [c, () => collectAshby(c, o)]),
    ...WORKDAY.map(([c, ...w]) => [c, () => collectWorkday(c, ...w)]),
    ...SMARTRECRUITERS.map(([c, id]) => [c, () => collectSmartRecruiters(c, id)]),
    ["넷플릭스", collectNetflix],
    ["쏘카", collectSocar],
  ];
  // 점검용: ONLY=쏘카,숨고 처럼 주면 그 회사만 돌리고 파일은 쓰지 않는다
  const only = (process.env.ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
  const all = [];
  const errors = {};
  for (const [name, fn] of tasks.filter(([n]) => !only.length || only.includes(n))) {
    try {
      const jobs = await fn();
      all.push(...jobs);
      console.log(`${name}: ${jobs.length}건`);
    } catch (e) {
      errors[name] = e.message.split("\n")[0];
      console.error(`${name} 실패:`, errors[name]);
    }
  }
  const seen = new Set();
  // 해외 근무(예: Upstage Japan)·일본어/중국어 등 다른 외국어가 필요한 공고는 뺀다
  const jobs = all.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url) && !needsOtherLang(j.title, j.text)).map(({ text, ...j }) => ({
    ...j, years: yearsIn(`${j.title}\n${text}`), w: weights(`${j.title}\n${text}`), short: text.length < 200,
    found: prevFound.get(j.url) || today,
  }));
  if (only.length) {
    jobs.forEach((j) => console.log(`  ${j.company} | ${j.title} | 연차 ${j.years} | 키워드 ${Object.keys(j.w).length} | ${j.url}`));
    console.log(`(점검 모드: ${only.join(",")} — 파일은 쓰지 않음)`);
    return;
  }
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), errors, jobs }, null, 1) + "\n", "utf-8");
  const noYears = jobs.filter((j) => j.years === null).length;
  console.log(`총 ${jobs.length}건 (연차 표시 없음 ${noYears}건) · 실패 ${Object.keys(errors).length}곳`);
}

main().catch((e) => { console.error(e); process.exit(1); });
