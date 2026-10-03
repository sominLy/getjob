#!/usr/bin/env node
// 공채(정기 공개채용)·그룹 공고에서 "여러 직무 중 하나만 고른다면"을 정하기 위한 재료를 모은다 → data/gongchae.json
//
// 1) 공채 판별: 수시가 아니라 정해진 기간에 여러 직무를 한꺼번에 뽑는 공고를 규칙으로 가려낸다(아래 classify).
// 2) 직무별 JD: 공식 본문(details.sections)을 직무 이름으로 잘라 나누고, 본문이 없으면
//    자소설닷컴·공식 페이지의 공고 이미지를 글자 인식(tesseract, 한국어)해 같은 방식으로 나눈다.
// 3) 전략 신호: 계열사별 모집 직무 수·인원(본문의 "O명"), 직무별 자소설 지원자 수(경쟁),
//    최근 30일 뉴스(구글 뉴스 RSS) 속 계열사·직무 언급, 매출 추이(DART, DART_API_KEY가 있을 때만).
//
// 토큰·시간을 아끼려고 모든 단계는 캐시를 둔다(data/gongchae-cache.json).
//   - 이미지 글자 인식: 이미지 주소별 1회
//   - 뉴스: 회사(계열사)별 7일에 1회
//   - 매출: 회사별 90일에 1회
// 새 공고만 새로 처리하고, 마감 지난 공고는 결과에서 빠진다(캐시는 남겨 재사용).
//
// NO_NET=1 이면 네트워크 단계(이미지·뉴스·매출)를 건너뛰고 지금 있는 자료로만 만든다(로컬 점검용).

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { weights } from "./lib/jd-keywords.mjs";
import { UA } from "./lib/jd-text.mjs";

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "gongchae.json");
const CACHE = path.join(ROOT, "data", "gongchae-cache.json");
const NO_NET = process.env.NO_NET === "1";
const DART_KEY = process.env.DART_API_KEY || "";
const MAX_OCR = Number(process.env.MAX_OCR || 60); // 하루에 새로 글자 인식할 이미지 수 상한(첫 실행이 너무 길어지지 않게)
const SHOW = process.env.SHOW === "1";             // 점검용: 글자 인식·직무별 조각을 로그에 보여 줌
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => (Date.parse(today) - Date.parse(d)) / 864e5;
const readJson = async (f, fb) => { try { return JSON.parse(await readFile(f, "utf-8")); } catch { return fb; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 그룹 공채: 계열사 전체에서 한 곳만 지원 ----------
   삼성·신세계는 공채 기간에 계열사별 공고가 따로 올라와도 전 계열사·전 직무 중 하나만 지원할 수 있다(2026-10-03 소민 확인).
   그래서 이 그룹들은 공고 하나 안이 아니라 그룹 전체 직무를 한 줄로 세운다. 다른 그룹은 확인되면 여기에 더한다. */
const GROUPS = [
  { name: "삼성", re: /^삼성|제일기획|에스원|호텔신라|웰스토리/, note: "삼성 공채는 전 계열사·전 직무 중 1곳만 지원할 수 있어요" },
  { name: "신세계", re: /신세계|이마트|SSG|스타벅스|조선호텔|센트럴시티|까사|에브리데이/, note: "신세계 공채는 전 계열사·전 직무 중 1곳만 지원할 수 있어요" },
];
const groupOf = (company) => GROUPS.find((g) => g.re.test(company)) || null;
/* 직무 단위로 그때그때 뽑는 회사(쿠팡·토스처럼) — 직무가 여럿 걸려 있어도 공채로 보지 않는다 */
const ROLE_BASED = /쿠팡|토스|당근|우아한형제들|배달의민족|무신사|컬리|야놀자|여기어때|직방|숨고|크몽|쏘카|카카오페이|카카오모빌리티|카카오뱅크|네이버|라인|하이퍼커넥트|몰로코|센드버드|리디|뱅크샐러드|오늘의집|에이블리|번개장터|크림|캐치테이블|마이리얼트립|업스테이지|뤼튼/;

/* ---------- 1) 공채 판별 ----------
   공채 신호(점수 합 3 이상이면 공채):
   - 직무가 2개 이상(+2), 5개 이상(+1)
   - 마감일이 정해져 있음(+1) — 수시·상시는 대개 마감 미표기
   - 기업 형태가 대기업·공기업·금융(+1), 회사 이름에 그룹·계열(+1)
   - 공고 제목·직무 분류에 구체 직무가 없음(대졸 신입·하반기 공채처럼 묶음 제목)(+1)
   - 직무 이름에 [계열사] 같은 묶음 표시(+1)
   수시 신호: 제목이 하나의 구체 직무(PM·마케터 등)이고 직무가 1개(-2) */
const ROLE_WORD = /기획|마케팅|마케터|영업|세일즈|PM|PO|MD|인사|재무|회계|디자인|개발|운영|데이터|홍보|구매|생산|품질|연구/;
function classify(job, det) {
  const tracks = det?.tracks || [];
  const why = [];
  let s = 0;
  if (ROLE_BASED.test(job.company) || job.source === "원티드") return { gongchae: false, score: -9, why: ["직무 단위 수시 채용 회사"] };
  // 삼성·신세계 계열사 공고는 직무가 하나여도 그룹 공채의 일부
  const g = groupOf(job.company);
  if (g && tracks.length >= 1 && job.end && job.confirmed !== false) return { gongchae: true, score: 9, why: [`${g.name} 그룹 공채(전 계열사 중 1곳만)`, `직무 ${tracks.length}개`] };
  if (tracks.length >= 2) { s += 2; why.push(`직무 ${tracks.length}개`); }
  if (tracks.length >= 5) s += 1;
  if (job.end) { s += 1; why.push("마감일 명시"); }
  if (/대기업|공기업|금융/.test(job.type || "")) { s += 1; why.push(job.type); }
  if (/그룹|계열|홀딩스/.test(job.company)) { s += 1; why.push("그룹 공고"); }
  const titleish = `${job.hist || ""}`;
  if (!ROLE_WORD.test(titleish) || /공채|신입사원|대졸|하반기|상반기|정기/.test(titleish)) { s += 1; why.push("제목에 직무 미표기·공채 표현"); }
  if (tracks.some((t) => /^\s*\[[^\]]+\]/.test(t.name || ""))) { s += 1; why.push("[계열사] 묶음"); }
  if (tracks.length <= 1 && ROLE_WORD.test(titleish)) s -= 2;
  return { gongchae: s >= 3 && tracks.length >= 2, score: s, why };
}

/* ---------- 2) 직무별 JD ---------- */
// 직무 이름만으로는 키워드가 거의 없어서, 흔한 직무명은 그 일을 설명하는 말로 넓혀 둔다(매칭용)
const EXPAND = [
  [/마케팅|마케터|브랜드|BM\b/i, "마케팅 기획 브랜드 캠페인 콘텐츠 고객 데이터 분석"],
  [/영업|세일즈|sales|채널/i, "영업 세일즈 고객사 B2B 협상 매출 이해관계자 조율"],
  [/MD|매입|상품|바이어/i, "MD 상품 기획 소싱 이커머스 매출 데이터 분석"],
  [/서비스\s*기획|PM|PO|프로덕트|플랫폼/i, "서비스 기획 요구사항 정의 화면 설계 프로젝트 관리 데이터 분석"],
  [/전략|경영\s*기획|사업\s*기획|기획/i, "사업 기획 전략 수립 시장 분석 데이터 분석 지표"],
  [/데이터|DT|디지털|AI/i, "데이터 분석 지표 SQL AI 프로세스 개선 자동화"],
  [/경영\s*지원|인사|HR|총무/i, "프로세스 개선 문서화 이해관계자 조율 계약"],
  [/재무|회계|자금|IR/i, "정산 계약 데이터 분석 엑셀"],
  [/홍보|PR|커뮤니케이션|대외/i, "PR 홍보 보도자료 콘텐츠 커뮤니케이션"],
  [/CX|CS|고객/i, "고객 경험 VOC 서비스 운영 프로세스 개선"],
  [/운영/i, "서비스 운영 프로세스 개선 품질 모니터링"],
  [/글로벌|해외/i, "글로벌 해외 영어"],
];
const expandRole = (name) => EXPAND.filter(([re]) => re.test(name)).map(([, t]) => t).join(" ");
/* 계열사: "[백화점] 마케팅"처럼 대괄호, 또는 "동원F&B_기획"처럼 그룹 이름으로 시작하는 앞부분 */
function affiliateOf(name, company) {
  const b = (name.match(/^\s*\[([^\]]+)\]/) || [])[1];
  if (b) return b.trim();
  const g = company.replace(/그룹|\(.*?\)|㈜|\s/g, "").slice(0, 2);
  const m = name.match(/^([^_\-]{2,20})[_\-]/);
  return m && g && m[1].replace(/\s/g, "").startsWith(g) ? m[1].trim() : company;
}
const bareName = (name) => name.replace(/^\s*\[[^\]]+\]\s*/, "").replace(/^[^_\-]{2,20}[_\-]/, (x) => x).trim();

/** 본문을 직무 이름으로 잘라 직무별 조각을 만든다. 이름이 본문에 안 나오면 공통 본문으로 둔다 */
function splitByTrack(text, tracks) {
  const out = {};
  if (!text) return out;
  const pos = tracks.map((t) => {
    const key = bareName(t.name).split(/[\/(·]/)[0].trim();
    const i = key.length >= 2 ? text.indexOf(key) : -1;
    return { name: t.name, i };
  }).filter((p) => p.i >= 0).sort((a, b) => a.i - b.i);
  pos.forEach((p, k) => { out[p.name] = text.slice(p.i, k + 1 < pos.length ? pos[k + 1].i : Math.min(text.length, p.i + 1500)); });
  return out;
}
/** "마케팅 O명", "0명" 같은 모집 인원 */
function headcountNear(chunk) {
  const m = (chunk || "").match(/(\d{1,3})\s*명/);
  return m ? Number(m[1]) : null;
}
const ONE_ONLY = /(1개|하나의|한\s*개)\s*(직무|계열사|회사)[^.\n]{0,20}(만|지원)|중복\s*지원\s*(불가|불허|시\s*불이익)|복수\s*지원\s*(불가|불허)/;

/* ---------- 이미지 글자 인식(tesseract) ---------- */
const IMG_OK = /\.(png|jpe?g|gif|webp)(\?|$)/i;
const IMG_SKIP = /logo|youtube|favicon|icon|\.svg|profile|avatar|og[-_]?image/i;
async function ocr(url) {
  const tmp = path.join(os.tmpdir(), "gc-" + Buffer.from(url).toString("base64url").slice(-40));
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(String(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 60_000) return ""; // 작은 그림(아이콘·로고·배너)은 공고문이 아니다
  await writeFile(tmp, buf);
  // tesseract가 webp를 못 읽는 환경이면 png로 바꿔서 다시 읽는다
  let input = tmp;
  if (/\.webp(\?|$)/i.test(url)) { try { await run("convert", [tmp, tmp + ".png"]); input = tmp + ".png"; } catch {} }
  const { stdout } = await run("tesseract", [input, "stdout", "-l", "kor+eng", "--psm", "4"], { maxBuffer: 1 << 24, timeout: 180000 });
  return stdout.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
/** 자소설닷컴 공고 상세 JSON 안에서 이미지 주소를 모두 찾는다(필드 이름이 바뀌어도 되게 깊이 훑음) */
function imageUrls(o, out = []) {
  if (typeof o === "string") { if (/^https?:\/\//.test(o) && IMG_OK.test(o) && !IMG_SKIP.test(o)) out.push(o); }
  else if (Array.isArray(o)) o.forEach((x) => imageUrls(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => imageUrls(x, out));
  return out;
}

/* ---------- 3) 뉴스·매출 ---------- */
async function news(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:30d")}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(String(res.status));
  const xml = await res.text();
  return [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/g)]
    .map((m) => ({ t: m[1].replace(/\s+-\s+[^-]+$/, "").trim(), d: new Date(m[2]).toISOString().slice(0, 10) })).slice(0, 40);
}
let corpCodes = null;
async function dartRevenue(name) {
  if (!DART_KEY) return null;
  if (!corpCodes) {
    // 회사 고유번호 목록(zip 안 XML). 하루 한 번만 받는다
    const zip = path.join(os.tmpdir(), "corpcode.zip");
    const r = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`);
    await writeFile(zip, Buffer.from(await r.arrayBuffer()));
    const { stdout } = await run("unzip", ["-p", zip], { maxBuffer: 1 << 28 });
    corpCodes = [...stdout.matchAll(/<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]+)<\/corp_name>/g)].map((m) => [m[2].trim(), m[1]]);
  }
  const key = name.replace(/\(.*?\)|㈜|주식회사|\s/g, "");
  const hit = corpCodes.find(([n]) => n.replace(/\s/g, "") === key);
  if (!hit) return null;
  const y = Number(today.slice(0, 4)) - 1;
  const r = await fetch(`https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${hit[1]}&bsns_year=${y}&reprt_code=11011`);
  const d = await r.json();
  const row = (d.list || []).find((x) => /매출액|영업수익/.test(x.account_nm) && x.fs_div === "CFS") || (d.list || []).find((x) => /매출액|영업수익/.test(x.account_nm));
  if (!row) return null;
  const num = (s) => Number(String(s || "").replace(/,/g, "")) || null;
  const cur = num(row.thstrm_amount), prev = num(row.frmtrm_amount);
  return { year: y, revenue: cur, prev, growth: cur && prev ? Math.round((cur / prev - 1) * 1000) / 10 : null };
}

/* 직무별 '요즘 뉴스에서 이 일이 얼마나 언급되나' — 직무명·확장어가 제목에 나온 기사 수 */
function roleNews(items, trackName) {
  const words = [bareName(trackName), ...expandRole(trackName).split(" ")].filter((w) => w.length >= 2).slice(0, 8);
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  return items.filter((n) => re.test(n.t)).length;
}

async function main() {
  const jobs = (await readJson(path.join(ROOT, "data", "jobs.json"), { jobs: [] })).jobs;
  const details = (await readJson(path.join(ROOT, "data", "details.json"), { items: {} })).items;
  const archive = (await readJson(path.join(ROOT, "data", "archive.json"), { jobs: [] })).jobs;
  const cache = await readJson(CACHE, { ocr: {}, news: {}, dart: {} });
  cache.jsContent = cache.jsContent || {};
  delete cache.jsImages;

  const live = jobs.filter((j) => (!j.end || j.end >= today) && details[j.id]);
  const picked = live.map((j) => ({ j, d: details[j.id], c: classify(j, details[j.id]) })).filter((x) => x.c.gongchae);
  console.log(`살아 있는 공고 ${live.length}건 중 공채·그룹 공고 ${picked.length}건`);

  // 지난 1년 같은 회사의 직무 수(보관함 포함) — 이 회사가 해마다 얼마나 뽑는지
  const pastTracks = {};
  for (const j of [...jobs, ...archive]) {
    const n = (details[j.id]?.tracks || []).length;
    if (n) pastTracks[j.company] = (pastTracks[j.company] || 0) + n;
  }

  let ocrNew = 0, newsNew = 0, dartNew = 0;
  const out = [];
  for (const { j, d, c } of picked) {
    const tracks = d.tracks || [];
    let text = (d.sections || []).map((s) => `${s.title}\n${s.body}`).join("\n");
    let source = text ? "공식 본문" : "";

    // 본문이 없으면 이미지 글자 인식: 공식 페이지 대표 이미지 + 자소설닷컴 공고 이미지
    if (!text && !NO_NET) {
      // 자소설닷컴 공고 상세의 content(HTML): 글이면 그대로 쓰고, 공고문 이미지(content_images)면 글자 인식
      let imgs = [];
      if (j.id.startsWith("jasoseol-")) {
        if (!cache.jsContent[j.id]) {
          try {
            const r = await fetch(`https://jasoseol.com/api/v1/employment_companies/${j.id.slice(9)}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
            const html = r.ok ? (await r.json()).content || "" : "";
            cache.jsContent[j.id] = {
              text: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(),
              imgs: [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]).filter((u) => !IMG_SKIP.test(u)).slice(0, 4),
            };
          } catch { cache.jsContent[j.id] = { text: "", imgs: [] }; }
        }
        const c = cache.jsContent[j.id];
        if (c.text.length > 150) { text = c.text; source = "자소설닷컴 공고 본문"; }
        imgs.push(...c.imgs);
        if (SHOW) console.log(`  ${j.company}: 자소설 본문 ${c.text.length}자 · 공고문 이미지 ${c.imgs.length}개 ${c.imgs.join(" ").slice(0, 160)}`);
      }
      if (!text && d.image && IMG_OK.test(d.image) && !IMG_SKIP.test(d.image)) imgs.push(d.image);
      const texts = [];
      for (const u of [...new Set(imgs)]) {
        if (!(u in cache.ocr)) {
          if (ocrNew >= MAX_OCR) continue;
          try { cache.ocr[u] = { at: today, text: await ocr(u) }; ocrNew++; } catch (e) { cache.ocr[u] = { at: today, text: "", err: e.message.slice(0, 80) }; }
        }
        // 공고문다운 글자(모집·자격·우대·담당 업무 등)가 3개 이상 나와야 공고 이미지로 쓴다(사진·안내문 걸러냄)
        const t = cache.ocr[u].text || "";
        if ((t.match(/모집|자격|우대|담당|업무|지원|채용|전형|근무|직무|신입|경력|우대사항|접수/g) || []).length >= 3) texts.push(t);
        else if (SHOW && t) console.log(`  (공고문 아님, 버림) ${u.slice(0, 80)}: ${t.slice(0, 60).replace(/\n/g, " ")}`);
      }
      if (texts.length) { text = [text, ...texts].filter(Boolean).join("\n\n"); source = source ? source + "+공고문 이미지 글자 인식" : "공고문 이미지 글자 인식"; }
    }

    const parts = splitByTrack(text, tracks);
    if (SHOW && /글자 인식|자소설닷컴 공고 본문/.test(source)) {
      console.log(`\n=== ${j.company} (${tracks.length}개 직무) 글자 ${text.length}자 ===\n${text.slice(0, 700)}`);
      console.log("직무별 조각:", tracks.map((t) => `${t.name}=${(parts[t.name] || "").length}자`).join(" / "));
    }
    const affiliates = {};
    tracks.forEach((t) => { const a = affiliateOf(t.name, j.company); affiliates[a] = (affiliates[a] || 0) + 1; });

    // 뉴스: 계열사(없으면 회사) 이름으로 7일에 한 번
    const newsOf = {};
    for (const a of Object.keys(affiliates)) {
      const q = a === j.company ? j.company.replace(/\(.*?\)/g, "").trim() : `${j.company.replace(/그룹|\(.*?\)/g, "").trim()} ${a}`;
      const hit = cache.news[q];
      if (!NO_NET && (!hit || daysAgo(hit.at) >= 7)) {
        try { cache.news[q] = { at: today, items: await news(q) }; newsNew++; await sleep(400); } catch (e) { if (!hit) cache.news[q] = { at: today, items: [], err: e.message }; }
      }
      newsOf[a] = cache.news[q]?.items || [];
    }
    // 매출: 회사별 90일에 한 번(키가 있을 때만)
    let revenue = null;
    if (DART_KEY && !NO_NET) {
      const hit = cache.dart[j.company];
      if (!hit || daysAgo(hit.at) >= 90) {
        try { cache.dart[j.company] = { at: today, v: await dartRevenue(j.company) }; dartNew++; } catch (e) { cache.dart[j.company] = { at: today, v: null, err: e.message }; }
      }
    }
    revenue = cache.dart[j.company]?.v || null;

    const maxApplicants = Math.max(1, ...tracks.map((t) => t.applicants || 0));
    out.push({
      id: j.id, company: j.company, type: j.type || "", end: j.end || "", url: j.url, group: groupOf(j.company)?.name || "",
      why: c.why, jdSource: source || "직무 이름만", oneOnly: ONE_ONLY.test(text),
      revenue, pastTracks: pastTracks[j.company] || 0,
      tracks: tracks.map((t) => {
        const a = affiliateOf(t.name, j.company);
        const chunk = parts[t.name] || "";
        const base = `${t.name}\n${expandRole(t.name)}\n${chunk || (text ? text.slice(0, 3000) : "")}`;
        const items = newsOf[a] || [];
        return {
          name: t.name, affiliate: a,
          w: weights(base), ownJd: !!chunk,
          headcount: headcountNear(chunk.slice(0, 200)),
          applicants: t.applicants || 0, competition: Math.round(((t.applicants || 0) / maxApplicants) * 100) / 100,
          affiliateTracks: affiliates[a],
          news: { n30: items.length, role: roleNews(items, t.name), top: items.slice(0, 3).map((n) => n.t) },
        };
      }),
    });
  }

  // 마감이 한참 지난 공고의 자소설 이미지 목록 캐시는 정리(글자 인식 결과는 이미지 주소별로 남겨 재사용)
  const liveIds = new Set(live.map((j) => j.id));
  for (const id of Object.keys(cache.jsContent)) if (!liveIds.has(id)) delete cache.jsContent[id];

  // 그룹 공채 묶음(계열사 공고 여러 개 → 하나만 지원)
  const groups = GROUPS.map((g) => ({ name: g.name, note: g.note, oneOnly: true, ids: out.filter((x) => x.group === g.name).map((x) => x.id) }))
    .filter((g) => g.ids.length);
  await writeFile(OUT, JSON.stringify({ updated: today, rules: "공채 판별·직무별 JD·전략 신호는 scripts/build-gongchae.mjs 참고", groups, items: out }, null, 1) + "\n", "utf-8");
  await writeFile(CACHE, JSON.stringify(cache) + "\n", "utf-8");
  const bySrc = out.reduce((m, x) => ((m[x.jdSource] = (m[x.jdSource] || 0) + 1), m), {});
  groups.forEach((g) => console.log(`그룹 공채 ${g.name}: 공고 ${g.ids.length}개 · 직무 ${out.filter((x) => x.group === g.name).reduce((n, x) => n + x.tracks.length, 0)}개`));
  console.log(`공채 ${out.length}건 저장 · JD 출처 ${JSON.stringify(bySrc)} · 새로 글자 인식 ${ocrNew} · 뉴스 갱신 ${newsNew} · 매출 갱신 ${dartNew}${DART_KEY ? "" : " (DART_API_KEY 없음 — 매출 건너뜀)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
