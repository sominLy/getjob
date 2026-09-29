#!/usr/bin/env node
// 채용 레이더: 토스(프로덕트·마케팅)·Google·Notion·Anthropic 서울 공고를 모아
// 요건 문장에서 연차를 읽어 "연차 제한 없음 / 명시 없음 / 1–2년 / 3년 이상"으로 나눈다.
// 결과는 data/radar.json — 지원보드의 '채용 레이더' 탭이 이 파일을 그대로 읽는다.
//
// 토스·Google은 스크립트로 그려지는 페이지라 헤드리스 브라우저로 읽고,
// Notion(Ashby)·Anthropic(Greenhouse)은 공식 공개 API를 쓴다.
// 한 곳이 실패해도 그 회사만 직전 결과를 유지하고 나머지는 갱신한다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "radar.json");

const TOSS_LISTS = [
  "https://toss.im/career/jobs?main_category=Product&employment_type=%EC%A0%95%EA%B7%9C%EC%A7%81",
  "https://toss.im/career/jobs?main_category=Marketing&employment_type=%EC%A0%95%EA%B7%9C%EC%A7%81",
];
const GOOGLE_LIST = "https://www.google.com/about/careers/applications/jobs/results/?hl=en-US&location=Seoul%2C%20South%20Korea&location=South%20Korea&location=Korea%2C%20Republic%20of";
const ANTHROPIC_SEOUL_OFFICE = 4043781008;

const FIT_WORDS = /product|PO\b|PM\b|기획|operations|운영|growth|그로스|marketing|마케팅|\bAI\b|LLM|data|데이터|CRM|program manager|strategy|전략|business development/i;

const decode = (h) => h
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/<\/(li|p|h\d|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

function analyze(reqText) {
  const lines = reqText.split("\n").filter((l) => !/챕터|chapter|구성되어|다양하며|come from/i.test(l));
  const text = lines.join("\n");
  const noLimit = /연차에 제한|경력\s*무관|신입/.test(text);
  const mins = [];
  const patterns = [
    /(\d+)\s*(?:[~\-–]\s*\d+\s*)?\+?\s*years/gi,
    /(\d+)\s*(?:[~\-–]\s*\d+\s*)?년\s*(?:이상)?\s*(?:의)?\s*(?:경력|경험|이상)/g,
    /총\s*경력\s*(\d+)\s*년/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) mins.push(Number(m[1]));
  const valid = mins.filter((n) => n > 0 && n < 30);
  const years = valid.length ? Math.max(...valid) : null;
  const evidenceLine = years !== null
    ? lines.find((l) => new RegExp(`${years}\\s*(?:[~\\-–]\\s*\\d+\\s*)?\\+?\\s*(years|년)`, "i").test(l) || new RegExp(`경력\\s*${years}\\s*년`).test(l))
    : noLimit ? lines.find((l) => /연차에 제한|경력\s*무관|신입/.test(l))
    : lines.slice(1).find((l) => l.trim().length > 15);
  return { years, noLimit, evidence: (evidenceLine || "").trim().slice(0, 220) };
}

const ROLE_LABELS = [
  ["인재풀", /인재풀/],
  ["프로덕트 기획", /product owner|product manager|\bPO\b|상품 Manager/i],
  ["운영", /operations|운영/i],
  ["마케팅·브랜드", /marketing|마케팅|brand|media lead/i],
  ["솔루션·컨설팅", /solutions|consultant|customer engineer|architect|customer success|technical account|onboarding/i],
  ["세일즈·파트너십", /sales|account (executive|strategist)|partner|business development|country lead/i],
  ["전략·재무", /strategy|finance|accountant|excellence|project staff|compliance|affairs/i],
  ["엔지니어링", /software engineer/i],
  ["HR", /people consultant|\bHR\b/i],
];
const REQ_LABELS = [
  ["영어", /english|영어/i],
  ["일본어", /japanese|일본어/i],
  ["SQL·데이터", /\bSQL\b|데이터 분석|데이터를? 기반|data analy|지표/i],
  ["AI·LLM", /\bLLM\b|\bAI\b|\bML\b|머신러닝/],
  ["금융 도메인", /여신|증권|은행|금융|financial services|FSI|외환|결제/i],
  ["B2B", /B2B|enterprise|기업 고객|법인|기업솔루션/i],
  ["포트폴리오 우대", /포트폴리오|portfolio/i],
];
const labelsFor = (title, reqText) => ({
  roles: ROLE_LABELS.filter(([, re]) => re.test(title)).map(([l]) => l).slice(0, 2),
  reqs: REQ_LABELS.filter(([, re]) => re.test(`${title}\n${reqText}`)).map(([l]) => l),
});

function bucket(job) {
  if (job.noLimit) return "open";
  if (job.years === null) return job.level === "Early" ? "open" : "unstated";
  if (job.years <= 2) return "junior";
  return "senior";
}

// 토스 페이지는 networkidle이 끝나지 않는 경우가 있어(분석 스크립트가 계속 요청을 보냄)
// DOM만 준비되면 잠깐 기다린 뒤 읽는다.
async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
}

async function collectToss(browser) {
  const page = await browser.newPage();
  const detailUrls = new Set();
  for (const listUrl of TOSS_LISTS) {
    await open(page, listUrl);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="job-detail?job_id="]')).map((a) => a.href));
    links.forEach((u) => detailUrls.add(u));
  }
  if (detailUrls.size === 0) throw new Error("토스 목록에서 공고 링크를 찾지 못함");

  const jobs = [];
  for (const url of detailUrls) {
    try {
      await open(page, url);
      const body = await page.evaluate(() => document.body.innerText);
      const subCount = await page.evaluate(() => Array.from(document.querySelectorAll("button")).filter((b) => /공고 보기/.test(b.innerText)).length);

      // 한 공고 안에 계열사별 하위 포지션이 여러 개 걸린 경우, 버튼을 눌러 각각의 주소를 얻는다
      const targets = [];
      if (subCount > 0 && /개의 포지션이 열려 있어요/.test(body)) {
        for (let i = 0; i < subCount; i++) {
          for (let attempt = 0; attempt < 3; attempt++) {
            await open(page, url);
            await page.evaluate((i) => Array.from(document.querySelectorAll("button")).filter((b) => /공고 보기/.test(b.innerText))[i]?.click(), i);
            await page.waitForURL((u) => u.toString().includes("sub_position_id"), { timeout: 8000 }).catch(() => {});
            if (page.url().includes("sub_position_id")) { targets.push(page.url()); break; }
          }
        }
        if (!targets.length) console.error("toss: 하위 포지션에 들어가지 못함", url);
      } else {
        targets.push(url);
      }

      for (const t of targets) {
        if (t !== page.url()) await open(page, t);
        const text = await page.evaluate(() => document.body.innerText);
        const start = text.indexOf("전체 공고") + 5;
        const head = text.slice(start, start + 200).split("\n").map((s) => s.trim()).filter(Boolean);
        const affIdx = head.findIndex((l) => /소속$/.test(l));
        const title = affIdx > 0 ? head.slice(0, affIdx).join(" · ") : head[0];
        const company = affIdx > 0 ? head[affIdx].replace(/\s*소속$/, "") : "토스";
        if (!title || /채용팀에 문의하기/.test(title)) continue; // 본문을 못 읽은 페이지
        const s = text.search(/이런 분과 ?함께 ?하고 싶어요|이런 분을 찾고 있어요|Who we.re looking for|You may be a good fit/i);
        const tail = s >= 0 ? text.slice(s) : "";
        const e = tail.slice(10).search(/이력서는|합류 ?여정|꼭 확인해 주세요|함께할 동료를 위한|How to apply|Hiring process/i);
        const reqText = s >= 0 ? tail.slice(0, e > 0 ? e + 10 : 2500) : text.slice(start, text.indexOf("채용팀에 문의하기"));
        jobs.push({ source: "toss", company, title, location: "서울", url: t, reqText, ...analyze(reqText) });
        console.error("toss:", company, title);
      }
    } catch (err) {
      console.error("toss: 건너뜀", url, err.message.split("\n")[0]);
    }
  }
  await page.close();
  if (jobs.length === 0) throw new Error("토스 공고 본문을 하나도 읽지 못함");
  return jobs;
}

async function collectNotion() {
  const res = await fetch("https://api.ashbyhq.com/posting-api/job-board/notion");
  if (!res.ok) throw new Error(`notion ${res.status}`);
  const { jobs } = await res.json();
  return jobs
    .filter((j) => /seoul|korea/i.test(`${j.location} ${JSON.stringify(j.secondaryLocations || [])}`))
    .map((j) => {
      const t = j.descriptionPlain || decode(j.descriptionHtml || "");
      const s = t.search(/SKILLS YOU.LL NEED|WHAT YOU.LL NEED|ABOUT YOU/i);
      const reqText = s >= 0 ? t.slice(s, s + 2500) : t;
      return { source: "notion", company: "Notion", title: j.title, location: j.location, url: j.jobUrl, reqText, ...analyze(reqText) };
    });
}

async function collectAnthropic() {
  const res = await fetch("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true");
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const { jobs } = await res.json();
  return jobs
    .filter((j) => (j.offices || []).some((o) => o.id === ANTHROPIC_SEOUL_OFFICE))
    .map((j) => {
      const t = decode(j.content || "");
      const s = t.search(/You may be a good fit|Minimum qualifications|Requirements|Qualifications/i);
      const e = t.search(/The annual compensation|Logistics|How we.re different/i);
      const reqText = s >= 0 ? t.slice(s, e > s ? e : s + 3000) : "";
      return { source: "anthropic", company: "Anthropic", title: j.title, location: j.location.name, url: j.absolute_url, reqText, ...analyze(reqText) };
    });
}

async function collectGoogle(browser) {
  const page = await browser.newPage();
  const jobs = [];
  const seen = new Set();
  for (let p = 1; p <= 20; p++) {
    await page.goto(`${GOOGLE_LIST}&page=${p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="jobs/results/"]'))
      .map((a) => ({ href: a.href.split("?")[0], card: (a.closest("li") || a.parentElement).innerText.trim() }))
      .filter((x) => /results\/\d+/.test(x.href)));
    const fresh = cards.filter((c) => !seen.has(c.href) && seen.add(c.href));
    if (!fresh.length) break;
    for (const c of fresh) {
      const lines = c.card.split("\n").map((s) => s.trim()).filter(Boolean);
      const level = ["Early", "Mid", "Advanced", "Director"].find((l) => lines.includes(l)) || null;
      const locIdx = lines.indexOf("place");
      const q = c.card.indexOf("Minimum qualifications");
      const reqText = q >= 0 ? c.card.slice(q).replace(/Learn more[\s\S]*$/, "") : "";
      jobs.push({ source: "google", company: "Google", title: lines[0], location: locIdx >= 0 ? lines[locIdx + 1] : "Korea", level, url: c.href, reqText, ...analyze(reqText) });
    }
  }
  await page.close();
  if (jobs.length === 0) throw new Error("Google 목록에서 공고를 찾지 못함");
  return jobs;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  let prev = { jobs: [] };
  try { prev = JSON.parse(await readFile(OUT, "utf-8")); } catch {}
  const firstSeen = new Map(prev.jobs.map((j) => [j.url, j.firstSeen]));

  const browser = await chromium.launch();
  const results = {};
  const errors = {};
  const run = async (name, fn) => {
    try {
      results[name] = await fn();
      console.error(`${name}: ${results[name].length}`);
    } catch (e) {
      errors[name] = e.message.split("\n")[0];
      results[name] = prev.jobs.filter((j) => j.source === name); // 직전 결과 유지
      console.error(`${name} 실패, 직전 결과 유지:`, errors[name]);
    }
  };
  await run("toss", () => collectToss(browser));
  await run("google", () => collectGoogle(browser));
  await run("notion", collectNotion);
  await run("anthropic", collectAnthropic);
  await browser.close();

  const jobs = Object.values(results).flat()
    .filter((j, i, arr) => arr.findIndex((x) => x.url === j.url) === i)
    .map((j) => {
      // 직전 결과를 그대로 유지한 항목은 reqText가 없고 라벨이 이미 붙어 있다
      if (j.reqText === undefined) return j;
      const { reqText, ...rest } = j;
      return {
        ...rest,
        ...labelsFor(j.title, reqText),
        bucket: bucket(j),
        fit: FIT_WORDS.test(j.title),
        firstSeen: firstSeen.get(j.url) || today,
      };
    });

  await writeFile(OUT, JSON.stringify({ collectedAt: new Date().toISOString(), errors, jobs }, null, 2) + "\n", "utf-8");
  const count = (b) => jobs.filter((j) => j.bucket === b).length;
  console.log(`총 ${jobs.length}건 | 제한없음 ${count("open")} 명시없음 ${count("unstated")} 1–2년 ${count("junior")} 3년+ ${count("senior")} | 신규 ${jobs.filter((j) => j.firstSeen === today).length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
