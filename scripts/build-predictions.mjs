#!/usr/bin/env node
// '예상' 공고를 관리한다(data/jobs.json 안 confirmed:false 항목).
//
// 1) 자동 예상: 자소설닷컴 달력에서 '1년 전 같은 기간(오늘 ~ 5개월 뒤)'의 대기업·금융·공기업 공고를 받아
//    364일(같은 요일) 뒤로 옮겨 올해 예상 일정으로 만든다. id는 pred-회사-연월로 고정해 매일 다시 만들어도
//    내 지원·관심 표시가 이어진다. 이미 올해 실제 공고가 나온 회사는 만들지 않는다.
// 2) 정리: 예상(자동·직접 넣은 것 모두) 중 같은 회사(그룹 예상은 계열사 포함)의 실제 공고가 이번 시즌에 나왔으면
//    doneBy(실제 공고 id)를 붙인다 → 화면은 예상을 숨기고, 그 예상을 내 지원에 담아 뒀으면 실제 공고로 옮긴다.
//    날짜가 지났는데 실제 공고가 안 나온 자동 예상은 지운다.
//
// 네트워크가 안 되면 1)은 건너뛰고(직전 자동 예상 유지) 2)만 한다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyPosting, dutyNamesOf, fetchDutyGroupNames, isExperiencedOnly, mapCompanyType, toDateOnly } from "./lib/classify.mjs";
import { isNotJob, needsOtherLang } from "./lib/not-job.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOBS = path.join(ROOT, "data", "jobs.json");
const ARCHIVE = path.join(ROOT, "data", "archive.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const AHEAD_DAYS = 150;     // 오늘부터 약 5개월 앞까지 예상
const SEASON_DAYS = 100;    // 예상 시작일 기준 이만큼 앞에 실제 공고가 났으면 '이번 시즌에 이미 나옴'
const DAY = 864e5;
const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const readJson = async (f, fb) => { try { return JSON.parse(await readFile(f, "utf-8")); } catch { return fb; } };

/* 회사 이름 맞추기: 괄호·주식회사·공백 제거, '그룹'으로 끝나면 그룹 이름만 */
const coKey = (s) => (s || "").replace(/\(.*?\)|㈜|주식회사|\s/g, "").toLowerCase();
const sameCompany = (pred, real) => {
  const k = coKey(pred), x = coKey(real);
  if (k === x) return true;
  const g = /그룹$/.test(k) ? k.replace(/그룹$/, "") : "";
  return g.length >= 2 && x.startsWith(g);
};
// 직무 단위로 그때그때 뽑는 회사는 공채 예상이 의미 없다(build-gongchae.mjs와 같은 목록)
const ROLE_BASED = /쿠팡|토스|당근|우아한형제들|무신사|컬리|야놀자|여기어때|직방|숨고|크몽|쏘카|카카오페이|카카오모빌리티|카카오뱅크|네이버|라인|하이퍼커넥트|몰로코|센드버드|리디|뱅크샐러드|오늘의집|에이블리|번개장터|크림|캐치테이블|마이리얼트립|업스테이지|뤼튼/;

async function lastYearPostings() {
  const from = addDays(today, -364), to = addDays(today, AHEAD_DAYS - 364);
  const [res, duty] = await Promise.all([
    fetch("https://jasoseol.com/employment/calendar_list.json", {
      method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString() }),
    }),
    fetchDutyGroupNames(UA).catch(() => new Map()),
  ]);
  if (!res.ok) throw new Error(`자소설닷컴 달력 ${res.status}`);
  const items = (await res.json()).employment ?? [];
  const out = [];
  for (const it of items) {
    const company = (it.name || "").trim();
    const type = mapCompanyType(it);
    const start = toDateOnly(it.start_time), end = toDateOnly(it.end_time);
    if (!company || !start || !end || start < from || start > to) continue;
    if (!/대기업|금융|공기업/.test(type) || ROLE_BASED.test(company)) continue;
    const dutyNames = dutyNamesOf(it, duty);
    const text = `${it.title ?? ""} ${dutyNames.join(" ")}`;
    if (isExperiencedOnly(text) || isNotJob(company, text) || needsOtherLang(it.title ?? "")) continue;
    // 신입·공채·인턴 성격만(경력직·전문직·현장직·교육 캠프 등은 예상 공고로 의미가 없다)
    const title = it.title || "";
    if (/변호사|의사|약사|간호|진료|트레이더|딜러|상담직|콜센터|현장\s*운영직|생산직|기능직|기술직|전임직|운전|경비|캠프|교육생|아카데미|연구직|연구원|디자인센터|사내\s*강사|계약직/.test(title)) continue;
    if (!/신입|공채|공개\s*채용|채용형|채용연계|인턴|대졸|신규\s*직원|신입행원|하반기|상반기|정기/.test(title)) continue;
    const hit = classifyPosting({ title: it.title, company, dutyNames });
    // 공기업은 기획·마케팅 등 관심 직무가 잡힐 때만(기술직 공고가 많아서), 대기업·금융은 직무 미표기 공채가 많아 모두
    if (type === "공기업" && !hit) continue;
    out.push({ company, type, start, end, title: (it.title || "").trim(), roles: hit ? hit.roles : [], id: it.id });
  }
  return out;
}

async function main() {
  const db = await readJson(JOBS, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const archive = (await readJson(ARCHIVE, { jobs: [] })).jobs;
  const real = [...db.jobs, ...archive].filter((j) => j.confirmed);

  // 1) 자동 예상 다시 만들기
  let made = 0, skipped = 0, netOk = true;
  try {
    const past = await lastYearPostings();
    // 같은 회사의 같은 시기 공고는 하나로(가장 이른 것, 직무는 합침)
    const byKey = new Map();
    for (const p of past.sort((a, b) => a.start.localeCompare(b.start))) {
      const start = addDays(p.start, 364), end = addDays(p.end, 364);
      const key = `pred-${coKey(p.company).replace(/[^0-9a-z가-힣]/g, "")}-${start.slice(0, 7).replace("-", "")}`;
      const cur = byKey.get(key);
      if (cur) { cur.roles = [...new Set([...cur.roles, ...p.roles])]; continue; }
      byKey.set(key, {
        id: key, company: p.company, type: p.type, roles: p.roles, start, end, confirmed: false,
        source: "예상(작년 자소설닷컴 기록)", url: `https://jasoseol.com/recruit/${p.id}`,
        hist: `작년 ${p.start.slice(5).replace("-", "/")}~${p.end.slice(5).replace("-", "/")} ‘${p.title.slice(0, 40)}’ 기준 예상`,
      });
    }
    const keep = db.jobs.filter((j) => !j.id.startsWith("pred-"));
    const fresh = [];
    for (const p of byKey.values()) {
      if (p.end < today) continue;
      // 이번 시즌에 이미 실제 공고가 났으면 만들지 않는다
      if (real.some((r) => sameCompany(p.company, r.company) && (r.end || r.start || "") >= addDays(p.start, -SEASON_DAYS))) { skipped++; continue; }
      // 직접 넣어 둔 예상과 겹치면(같은 회사·60일 안) 직접 넣은 것을 둔다
      if (keep.some((k) => !k.confirmed && sameCompany(k.company, p.company) && Math.abs(Date.parse(k.start || k.end || today) - Date.parse(p.start)) < 60 * DAY)) { skipped++; continue; }
      fresh.push(p);
    }
    db.jobs = keep.concat(fresh);
    made = fresh.length;
  } catch (e) {
    netOk = false;
    console.error("자동 예상 건너뜀(직전 것 유지):", e.message);
  }

  // 2) 이미 실제 공고가 나온 예상 표시, 지난 자동 예상 정리
  let done = 0, dropped = 0;
  db.jobs = db.jobs.filter((j) => {
    if (j.confirmed) return true;
    const from = addDays(j.start || j.end || today, -SEASON_DAYS);
    const r = real.filter((x) => sameCompany(j.company, x.company) && (x.end || x.start || "") >= from)
      .sort((a, b) => (a.end || "").localeCompare(b.end || ""))[0];
    if (r) { if (j.doneBy !== r.id) done++; j.doneBy = r.id; j.doneAt = r.end || r.start || ""; }
    else delete j.doneBy;
    if (j.id.startsWith("pred-") && j.end && j.end < today && !j.doneBy) { dropped++; return false; }
    return true;
  });

  await writeFile(JOBS, JSON.stringify(db, null, 2) + "\n", "utf-8");
  const preds = db.jobs.filter((j) => !j.confirmed);
  console.log(`예상 ${preds.length}건(자동 ${preds.filter((j) => j.id.startsWith("pred-")).length}${netOk ? `, 새로 만듦 ${made}, 올해 이미 나와 건너뜀 ${skipped}` : ", 네트워크 실패로 유지"}) · 실제 공고가 나와 숨김 표시 ${preds.filter((j) => j.doneBy).length}(이번에 ${done}) · 지난 자동 예상 삭제 ${dropped}`);
  preds.filter((j) => j.doneBy).forEach((j) => console.log(`  ${j.company} 예상(${j.start}~${j.end}) → 실제 ${j.doneBy} (${j.doneAt})`));
}

main().catch((e) => { console.error(e); process.exit(1); });
