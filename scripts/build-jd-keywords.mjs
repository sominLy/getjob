#!/usr/bin/env node
// 지원보드 전체 공고 · 채용 레이더 · 주니어 공고판의 JD 본문에서 역량 키워드를 뽑아
// data/jd-keywords.json에 모은다. 지원보드의 '매칭 아카이브' 탭이 이 파일을 읽어
// 로그인 계정에 저장된 내 경험 키워드와 브라우저에서 매칭한다(내 경험은 여기 없음).
//
// 연차가 숫자로 적힌 공고는 넣지 않는다 — 매칭 아카이브는 "연차 표시 없는" 공고만 다룬다.
// 본문이 포스터 이미지뿐인 공고는 글자를 읽을 수 없어 빠진다.
// 주니어 공고판 본문은 한 번 받은 링크는 다시 받지 않는다(직전 결과를 캐시로 씀).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DICT, yearsIn, weights } from "./lib/jd-keywords.mjs";
import { stripHtml, greetingJd, fetchText } from "./lib/jd-text.mjs";
import { isNotJob, isTalentPool, needsOtherLang } from "./lib/not-job.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "jd-keywords.json");
const DICT_OUT = path.join(ROOT, "data", "keyword-dict.json");
const MIN_KEYWORDS = 3; // 키워드가 이보다 적으면 매칭률이 의미가 없어 뺀다

// 직무와 무관한 회사 소개·복리후생·전형 절차에 나온 단어가 매칭률을 부풀리지 않도록,
// 지원보드 본문은 이 섹션들만 쓴다.
const JD_SECTIONS = /자격|담당|우대|업무|모집\s*부문/;
// 개발·설비·디자인 직군은 기획·마케팅·운영 경험과 비교하는 의미가 없어 뺀다.
const EXCLUDE_TITLE = /개발(?!\s*(자와|협업))|엔지니어|engineer|developer|백엔드|프론트엔드|backend|frontend|전기|기계|설비|R&D|ENG\b|디자이너|designer|연구원|생산|품질보증|디자인|설계|간호|인체적용|임상/i;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

const GREENHOUSE_BOARDS = { 쿠팡: "coupang", 당근: "daangn", 센드버드: "sendbird" };
const greenhouseCache = new Map();
async function greenhouseJd(company, url) {
  const board = GREENHOUSE_BOARDS[company];
  const id = url.match(/gh_jid=(\d+)|jobs\/(\d+)/)?.slice(1).find(Boolean);
  if (!board || !id) return "";
  if (!greenhouseCache.has(board)) {
    const data = JSON.parse(await fetchText(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`));
    greenhouseCache.set(board, new Map(data.jobs.map((j) => [String(j.id), j.content || ""])));
  }
  return stripHtml(greenhouseCache.get(board).get(id) || "");
}

function careerYears(career) {
  const m = (career || "").match(/경력\s*(\d+)년/);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const prev = await readJson(OUT, { jobs: [] });
  const cache = new Map(prev.jobs.map((j) => [j.url, j]));
  // 본문을 받아 봤지만 연차가 있거나 키워드가 적어 뺀 주니어 공고 — 다음 날 다시 받지 않는다
  const skipped = new Set(prev.skip || []);
  const skipOut = [];
  const out = [];
  const seen = new Set();
  const push = (item, text, extraYears = null) => {
    if (!item.url || seen.has(item.url)) return;
    seen.add(item.url);
    if (EXCLUDE_TITLE.test(item.title) || isTalentPool(item.title) || isNotJob(item.company, item.title) || needsOtherLang(item.title, text)) return;
    const years = extraYears ?? yearsIn(text);
    if (years !== null) return;
    const w = weights(text);
    if (Object.keys(w).length < MIN_KEYWORDS) return;
    out.push({ ...item, w });
  };

  // 1) 지원보드 전체 공고 — fetch-official-details.mjs가 모아 둔 본문(details.json)
  const board = await readJson(path.join(ROOT, "data", "jobs.json"), { jobs: [] });
  const details = await readJson(path.join(ROOT, "data", "details.json"), { items: {} });
  let nBoard = 0;
  for (const j of board.jobs) {
    if (j.end && j.end < today) continue; // 마감 지난 공고
    const secs = details.items[j.id]?.sections;
    if (!Array.isArray(secs) || !secs.length) continue;
    const tracks = (details.items[j.id]?.tracks || []).map((t) => t.name).filter((n) => n && n !== "직무 미표기");
    const text = secs.filter((s) => JD_SECTIONS.test(s.title)).map((s) => `${s.title}\n${s.body}`).join("\n");
    const before = out.length;
    push({ src: "board", id: j.id, company: j.company, title: tracks.slice(0, 3).join(" · ") || (j.roles || []).join(" · ") || "공고", url: j.url || `#${j.id}`, end: j.end || "", posted: j.start || "", found: j.found || "" }, text);
    nBoard += out.length - before;
  }

  // 2) 채용 레이더 — fetch-radar.mjs가 요건 원문(jd)을 함께 저장한다
  const radar = await readJson(path.join(ROOT, "data", "radar.json"), { jobs: [] });
  let nRadar = 0;
  for (const j of radar.jobs) {
    if (j.years !== null || !j.jd) continue;
    const before = out.length;
    push({ src: "radar", company: j.company, title: j.title, url: j.url, end: "", found: j.firstSeen || "" }, `${j.title}\n${j.jd}`);
    nRadar += out.length - before;
  }

  // 3) 주니어 공고판 — 목록만 있으므로 본문을 따로 받는다(새 링크만)
  const junior = await readJson(path.join(ROOT, "artifact", "data.json"), { rows: [] });
  let nJunior = 0, fetched = 0, failed = 0;
  for (const r of junior.rows) {
    if (seen.has(r.link)) continue;
    const cached = cache.get(r.link);
    if (cached && cached.src === "junior") {
      seen.add(r.link); out.push({ ...cached, posted: r.openDate || cached.posted || "", found: r.found || cached.found || "" }); nJunior++;
      continue;
    }
    if (skipped.has(r.link)) { skipOut.push(r.link); continue; }
    let text = "";
    try {
      if (r["플랫폼"] === "greetinghr") { text = await greetingJd(r.link); fetched++; await new Promise((s) => setTimeout(s, 300)); }
      else if (r["플랫폼"] === "greenhouse") { text = await greenhouseJd(r["회사"], r.link); fetched++; }
      else continue; // 외국계 AI 4사는 채용 레이더 쪽 본문으로 이미 다룸
    } catch (e) {
      failed++;
      console.error("본문 실패:", r["회사"], r.title, e.message);
      continue;
    }
    const before = out.length;
    push({ src: "junior", company: r["회사"], title: r.title, url: r.link, end: /^\d{4}-/.test(r.due) ? r.due : "", posted: r.openDate || "", found: r.found || "" },
      `${r.title}\n${text}`, careerYears(r.career));
    if (out.length === before) skipOut.push(r.link);
    nJunior += out.length - before;
  }

  // 4) 스타트업·유니콘·외국계 공식 채용 시스템 — fetch-companies.mjs가 키워드까지 뽑아 둠
  const companies = await readJson(path.join(ROOT, "data", "company-jobs.json"), { jobs: [] });
  let nCompany = 0;
  for (const j of companies.jobs) {
    if (!j.url || seen.has(j.url)) continue;
    seen.add(j.url);
    if (j.years !== null || EXCLUDE_TITLE.test(j.title) || isTalentPool(j.title) || isNotJob(j.company, j.title) || needsOtherLang(j.title) || Object.keys(j.w || {}).length < MIN_KEYWORDS) continue;
    out.push({ src: "company", company: j.company, title: j.title, url: j.url, end: "", w: j.w, posted: j.posted || "", found: j.found || "" });
    nCompany++;
  }

  await writeFile(OUT, JSON.stringify({ updated: today, jobs: out, skip: skipOut }, null, 1) + "\n", "utf-8");
  await writeFile(DICT_OUT, JSON.stringify(DICT) + "\n", "utf-8");
  console.log(`매칭 대상 ${out.length}건 (지원보드 ${nBoard} · 레이더 ${nRadar} · 주니어 ${nJunior} · 기업 채용 ${nCompany}) · 본문 새로 받음 ${fetched} · 실패 ${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
