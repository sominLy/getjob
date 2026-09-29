#!/usr/bin/env node
// 스타트업·유니콘·외국계 서울 오피스의 공식 채용 시스템에서 기획·PM·마케팅·운영 공고를 모아
// JD 키워드와 요구 연차를 뽑아 data/company-jobs.json에 저장한다(매칭 아카이브용).
// 연차 필터·최소 키워드 수는 build-jd-keywords.mjs에서 다른 공고와 같은 기준으로 적용한다.
//
// 회사 목록은 scripts/probe-sources.mjs 점검(2026-09-29)에서 실제로 공고가 읽힌 곳만 넣었다.
// 공개 채용 API(Greenhouse·Ashby·Workday·SmartRecruiters·넷플릭스) 또는 서버에서 그려진 그리팅 페이지만 쓴다.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { yearsIn, weights } from "./lib/jd-keywords.mjs";
import { stripHtml, greetingJd, UA } from "./lib/jd-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "company-jobs.json");

// 기획·PM·마케팅·운영·사업 직무만. 개발·디자인·설비 등은 뺀다.
const ROLE = /기획|PM\b|PO\b|product\s*(manager|owner|operations|marketing|strategist|lead)|프로덕트|program\s*manager|사업|business|전략|strategy|operations|운영|마케팅|marketing|marketer|growth|그로스|brand|브랜드|CRM|MD\b|머천다이|merchandis|콘텐츠|content|partnership|제휴|GTM|go[-\s]to[-\s]market|campaign|캠페인|community|커뮤니티|CX\b|customer\s*(experience|success)|intern|인턴/i;
const EXCLUDE = /engineer|엔지니어|developer|개발자|백엔드|프론트엔드|backend|frontend|designer|디자이너|scientist|researcher|연구원|devops|\bSRE\b|security|보안|legal|법무|counsel|accountant|회계|recruit|채용담당|talent\s*acquisition/i;
const SEOUL = /seoul|korea|서울|한국|대한민국|성남|판교/i;
const relevant = (title) => ROLE.test(title) && !EXCLUDE.test(title);

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
      jobs.push({ company, title: o.title.trim(), url, text });
    } catch (e) { console.error(`  ${company} 본문 실패`, o.title, e.message); }
    await sleep(250);
  }
  return jobs;
}

async function collectGreenhouse(company, token) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return data.jobs
    .filter((j) => SEOUL.test(j.location?.name || "") && relevant(j.title))
    .map((j) => ({ company, title: j.title, url: j.absolute_url, text: stripHtml(j.content || "") }));
}

async function collectAshby(company, org) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`);
  return data.jobs
    .filter((j) => SEOUL.test(`${j.location} ${JSON.stringify(j.secondaryLocations || [])}`) && relevant(j.title))
    .map((j) => ({ company, title: j.title, url: j.jobUrl, text: j.descriptionPlain || stripHtml(j.descriptionHtml || "") }));
}

async function collectWorkday(company, host, tenant, site) {
  const api = `https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}`;
  const list = await getJson(`${api}/jobs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Seoul" }),
  });
  const jobs = [];
  for (const p of list.jobPostings || []) {
    if (!SEOUL.test(p.locationsText || "") || !relevant(p.title)) continue;
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
      jobs.push({ company, title: p.name, url: d.postingUrl || `https://jobs.smartrecruiters.com/${id}/${p.id}`, text: stripHtml(secs) });
    } catch (e) { console.error(`  ${company} 본문 실패`, p.name, e.message); }
  }
  return jobs;
}

async function collectNetflix() {
  const data = await getJson("https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&location=Seoul&num=100");
  const jobs = [];
  for (const p of data.positions || []) {
    if (!SEOUL.test(p.location || "") || !relevant(p.name)) continue;
    let text = p.job_description || "";
    if (!text) {
      try { text = (await getJson(`https://explore.jobs.netflix.net/api/apply/v2/jobs/${p.id}?domain=netflix.com`)).job_description || ""; } catch {}
    }
    jobs.push({ company: "넷플릭스", title: p.name, url: p.canonicalPositionUrl || `https://explore.jobs.netflix.net/careers/job/${p.id}`, text: stripHtml(text) });
  }
  return jobs;
}

async function main() {
  const tasks = [
    ...GREETING.map(([c, b]) => [c, () => collectGreeting(c, b)]),
    ...GREENHOUSE.map(([c, t]) => [c, () => collectGreenhouse(c, t)]),
    ...ASHBY.map(([c, o]) => [c, () => collectAshby(c, o)]),
    ...WORKDAY.map(([c, ...w]) => [c, () => collectWorkday(c, ...w)]),
    ...SMARTRECRUITERS.map(([c, id]) => [c, () => collectSmartRecruiters(c, id)]),
    ["넷플릭스", collectNetflix],
  ];
  const all = [];
  const errors = {};
  for (const [name, fn] of tasks) {
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
  const jobs = all.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url)).map(({ text, ...j }) => ({
    ...j, years: yearsIn(`${j.title}\n${text}`), w: weights(`${j.title}\n${text}`), short: text.length < 200,
  }));
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), errors, jobs }, null, 1) + "\n", "utf-8");
  const noYears = jobs.filter((j) => j.years === null).length;
  console.log(`총 ${jobs.length}건 (연차 표시 없음 ${noYears}건) · 실패 ${Object.keys(errors).length}곳`);
}

main().catch((e) => { console.error(e); process.exit(1); });
