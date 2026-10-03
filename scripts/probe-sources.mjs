#!/usr/bin/env node
// 수집처 후보 점검용(일회성). 스타트업·유니콘·외국계 서울 오피스가 어떤 채용 시스템을 쓰는지,
// 그리고 인턴·신입 플랫폼이 수집을 허락하는지(robots.txt) 확인해 표로 출력한다.
// 결과는 GitHub Actions 요약(GITHUB_STEP_SUMMARY)에 남고, 데이터 파일은 건드리지 않는다.

import { appendFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const PM = /기획|PM\b|PO\b|product\s*(manager|owner)|프로덕트|서비스\s*기획|사업\s*개발|business\s*development|전략|strategy|operations|운영|마케팅|marketing|growth|그로스/i;
const SEOUL = /seoul|korea|서울|한국|대한민국/i;

// [회사, 시도해 볼 계정 이름들]
// 2026-10-03: 쏘카·KT M모바일·컬리와 비슷한 국내 소비자 서비스 기업(모빌리티·통신 자회사·커머스·생활 플랫폼·핀테크·콘텐츠)
// (9/29 점검분은 fetch-companies.mjs에 반영 완료)
const COMPANIES = [
  // 모빌리티
  ["쏘카", ["socar", "socarcorp"]], ["카카오모빌리티", ["kakaomobility"]], ["티맵모빌리티", ["tmapmobility", "tmap"]],
  ["그린카", ["greencar"]], ["VCNC(타다)", ["vcnc", "tada"]], ["휴맥스모빌리티", ["humaxmobility"]],
  // 통신 자회사·알뜰폰
  ["KT M모바일", ["ktmmobile", "ktmmobilecorp"]], ["LG헬로비전", ["lghellovision", "hellovision"]], ["미디어로그", ["medialog"]],
  ["SK텔링크", ["sktelink"]], ["스테이지파이브", ["stagefive", "stage5"]], ["KT알파", ["ktalpha"]], ["SK플래닛", ["skplanet"]],
  // 커머스
  ["SSG닷컴", ["ssg", "ssgcom"]], ["11번가", ["11st", "elevenst"]], ["G마켓", ["gmarket"]], ["롯데온", ["lotteon"]],
  ["W컨셉", ["wconcept"]], ["오아시스마켓", ["oasis", "oasismarket"]], ["발란", ["balaan"]], ["트렌비", ["trenbe"]],
  ["머스트잇", ["mustit"]], ["텐바이텐", ["10x10", "tenbyten"]], ["펫프렌즈", ["petfriends"]], ["올웨이즈", ["alwayz", "levit"]],
  ["카카오스타일", ["kakaostyle", "zigzag"]], ["무신사", ["musinsa"]],
  // 생활·플랫폼 서비스
  ["우아한형제들(배민)", ["woowahan", "baemin"]], ["요기요", ["yogiyo", "wehago"]], ["직방", ["zigbang"]], ["숨고", ["soomgo", "bravemobile"]],
  ["크몽", ["kmong"]], ["야놀자", ["yanolja"]], ["오늘의집", ["bucketplace", "ohouse"]], ["당근", ["daangn"]],
  // 핀테크
  ["카카오페이", ["kakaopay"]], ["카카오뱅크", ["kakaobank"]], ["케이뱅크", ["kbank"]], ["토스", ["toss", "vivarepublica"]],
  ["뱅크샐러드", ["banksalad", "rainist"]], ["핀크", ["finnq"]],
  // 콘텐츠·미디어
  ["네이버웹툰", ["webtoon", "naverwebtoon"]], ["티빙", ["tving"]], ["웨이브", ["wavve"]], ["드림어스(플로)", ["dreamus", "flo"]],
  ["지니뮤직", ["genie", "geniemusic"]], ["리디", ["ridi"]], ["밀리의서재", ["millie"]],
];

// 자체 채용 사이트 후보 — 열리는지, robots.txt가 막는지, 서버에서 공고 목록이 그려지는지(브라우저가 필요한지)를 본다
const CAREER_PAGES = [
  ["쏘카", "https://www.socarcorp.kr/careers/jobs"], ["쏘카", "https://socarcorp.kr/careers"],
  ["카카오모빌리티", "https://www.kakaomobility.com/careers"], ["티맵모빌리티", "https://www.tmapmobility.com/careers"],
  ["KT M모바일", "https://www.ktmmobile.com/company/recruit.do"], ["KT M모바일", "https://ktmmobile.recruiter.co.kr"],
  ["우아한형제들", "https://career.woowahan.com"], ["카카오뱅크", "https://recruit.kakaobank.com"], ["카카오페이", "https://kakaopay.career.greetinghr.com"],
  ["직방", "https://career.zigbang.com"], ["SSG닷컴", "https://www.ssgcareers.com"], ["11번가", "https://careers.11st.co.kr"],
  ["G마켓", "https://gmarket.recruiter.co.kr"], ["롯데온", "https://lotteon.recruiter.co.kr"], ["네이버웹툰", "https://recruit.webtoonscorp.com"],
  ["티빙", "https://tving.recruiter.co.kr"], ["야놀자", "https://careers.yanolja.co"], ["토스", "https://toss.im/career/jobs"],
  ["카카오", "https://careers.kakao.com/jobs"], ["네이버", "https://recruit.navercorp.com"], ["LG U+", "https://careers.lg.com"],
];

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return { status: res.status, text: res.ok ? await res.text() : "" };
  } catch (e) { return { status: 0, text: "" }; }
}

function countJobs(list, titleKey, locKey) {
  const seoul = list.filter((j) => SEOUL.test(String(locKey(j) || "")));
  return { total: list.length, seoul: seoul.length, pm: seoul.filter((j) => PM.test(titleKey(j) || "")).length };
}

async function probeCompany(name, slugs) {
  const found = [];
  for (const s of slugs) {
    const gh = await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`);
    if (gh.status === 200) { const j = JSON.parse(gh.text).jobs || []; if (j.length) found.push({ via: `Greenhouse:${s}`, ...countJobs(j, (x) => x.title, (x) => x.location?.name) }); }
    const lv = await get(`https://api.lever.co/v0/postings/${s}?mode=json`);
    if (lv.status === 200) { const j = JSON.parse(lv.text); if (Array.isArray(j) && j.length) found.push({ via: `Lever:${s}`, ...countJobs(j, (x) => x.text, (x) => `${x.categories?.location} ${(x.categories?.allLocations || []).join(" ")}`) }); }
    const ab = await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
    if (ab.status === 200) { const j = JSON.parse(ab.text).jobs || []; if (j.length) found.push({ via: `Ashby:${s}`, ...countJobs(j, (x) => x.title, (x) => `${x.location} ${JSON.stringify(x.secondaryLocations || [])}`) }); }
    const gr = await get(`https://${s}.career.greetinghr.com/ko`);
    if (gr.status === 200 && gr.text.includes('{"deploy":')) {
      const n = (gr.text.match(/\{"deploy":true/g) || []).length;
      const titles = [...gr.text.matchAll(/"title":"([^"]+)"/g)].map((m) => m[1]);
      found.push({ via: `그리팅:${s}`, total: n, seoul: n, pm: titles.filter((t) => PM.test(t)).length });
    }
    const nh = await get(`https://${s}.ninehire.site/`);
    if (nh.status === 200 && nh.text.length > 1000) found.push({ via: `나인하이어:${s}`, total: "?", seoul: "?", pm: "?" });
    const rc = await get(`https://${s}.recruiter.co.kr/`);
    if (rc.status === 200 && /recruit|채용|모집/i.test(rc.text) && rc.text.length > 1000) found.push({ via: `recruiter.co.kr:${s}`, total: "?", seoul: "?", pm: "?" });
    const wk = await get(`https://apply.workable.com/api/v1/widget/accounts/${s}`);
    if (wk.status === 200) { try { const j = JSON.parse(wk.text).jobs || []; if (j.length) found.push({ via: `Workable:${s}`, ...countJobs(j, (x) => x.title, (x) => `${x.city} ${x.country}`) }); } catch {} }
    const rt = await get(`https://${s}.recruitee.com/api/offers/`);
    if (rt.status === 200) { try { const j = JSON.parse(rt.text).offers || []; if (j.length) found.push({ via: `Recruitee:${s}`, ...countJobs(j, (x) => x.title, (x) => `${x.city} ${x.country}`) }); } catch {} }
    const tt = await get(`https://${s}.teamtailor.com/jobs`);
    if (tt.status === 200 && /teamtailor/i.test(tt.text)) found.push({ via: `Teamtailor:${s}`, total: "?", seoul: "?", pm: "?" });
  }
  return { name, found };
}

// 자체 채용 사이트를 쓰는 외국계 — 공개 검색 API 형태만 확인
const BIGTECH = [
  ["넷플릭스", "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&location=Seoul&num=100",
    (t) => { const j = JSON.parse(t).positions || []; return countJobs(j, (x) => x.name, (x) => x.location); }],
  ["아마존", "https://www.amazon.jobs/en/search.json?loc_query=Seoul%2C%20South%20Korea&result_limit=100",
    (t) => { const j = JSON.parse(t).jobs || []; return countJobs(j, (x) => x.title, (x) => x.location || x.normalized_location); }],
  ["마이크로소프트", "https://gcsservices.careers.microsoft.com/search/api/v1/search?lc=Seoul%2C%20Seoul%2C%20South%20Korea&l=en_us&pg=1&pgSz=20",
    (t) => { const j = JSON.parse(t).operationResult?.result?.jobs || []; return countJobs(j, (x) => x.title, (x) => JSON.stringify(x.properties?.locations || [])); }],
];

// Workday를 쓰는 대기업 — 공개 검색 API(CXS)로 서울 공고 수 확인
const WORKDAY = [
  ["엔비디아", "nvidia.wd5", "nvidia", "NVIDIAExternalCareerSite"],
  ["세일즈포스", "salesforce.wd12", "salesforce", "External_Career_Site"],
  ["어도비", "adobe.wd5", "adobe", "external_experienced"],
  ["인텔", "intel.wd1", "intel", "External"],
  ["퀄컴", "qualcomm.wd5", "qualcomm", "External"],
  ["오토데스크", "autodesk.wd1", "autodesk", "Ext"],
  ["워크데이", "workday.wd5", "workday", "Workday"],
  ["델", "dell.wd1", "dell", "External"],
  ["HP", "hp.wd5", "hp", "ExternalCareerSite"],
  ["시스코", "cisco.wd5", "cisco", "Cisco_Careers"],
  ["마스터카드", "mastercard.wd1", "mastercard", "CorporateCareers"],
  ["비자", "visa.wd5", "visa", "Visa"],
  ["페이팔", "paypal.wd1", "paypal", "jobs"],
  ["AMD", "amd.wd1", "amd", "External"],
  ["블룸버그", "bloomberg.wd1", "bloomberg", "Bloomberg"],
];

// 인턴·신입 플랫폼 — robots.txt에서 전체 차단(Disallow: /)이나 AI 봇 차단이 있는지
const PLATFORMS = [
  ["슈퍼인턴", ["https://www.superintern.co.kr", "https://superintern.co.kr", "https://www.superintern.kr"]],
  ["그룹바이", ["https://groupby.kr", "https://www.groupby.kr"]],
  ["로켓펀치", ["https://www.rocketpunch.com"]],
  ["요즘것들", ["https://www.yozm.co.kr", "https://yozmgeotdeul.com"]],
  ["캐치", ["https://www.catch.co.kr"]],
  ["인크루트", ["https://www.incruit.com"]],
  ["잡플래닛", ["https://www.jobplanet.co.kr"]],
  ["링커리어", ["https://linkareer.com"]],
  ["원티드", ["https://www.wanted.co.kr"]],
];

function robotsVerdict(txt) {
  const groups = txt.split(/\n(?=\s*user-agent)/i);
  const block = (g) => /^\s*disallow:\s*\/\s*$/im.test(g);
  const star = groups.find((g) => /user-agent:\s*\*/i.test(g));
  const ai = groups.filter((g) => /user-agent:\s*(GPTBot|ClaudeBot|anthropic|CCBot|Google-Extended)/i.test(g) && block(g)).length;
  if (star && block(star)) return "전체 차단";
  if (ai) return `AI 봇 차단 ${ai}개 그룹`;
  return "허용(일반 봇)";
}

async function main() {
  const lines = ["## 채용 시스템 점검 (회사 · 2026-10-03 국내 소비자 서비스 후보)", "", "| 회사 | 찾은 곳 | 전체 | 서울 | 서울 중 기획·PM·마케팅·운영 |", "|---|---|---|---|---|"];
  for (const [name, slugs] of COMPANIES) {
    const r = await probeCompany(name, slugs);
    if (!r.found.length) lines.push(`| ${name} | 못 찾음 | | | |`);
    for (const f of r.found) lines.push(`| ${name} | ${f.via} | ${f.total} | ${f.seoul} | ${f.pm} |`);
    console.log(name, r.found.map((f) => f.via).join(", ") || "-");
  }
  lines.push("", "## 자체 채용 사이트", "", "| 회사 | 주소 | 상태 | robots.txt | 서버에서 그려진 공고 흔적 |", "|---|---|---|---|---|");
  for (const [name, url] of CAREER_PAGES) {
    const r = await get(url);
    const origin = (() => { try { return new URL(url).origin; } catch { return url; } })();
    const rb = await get(`${origin}/robots.txt`);
    // 서버 HTML에 공고 제목·링크가 들어 있으면 단순 요청으로 수집 가능, 아니면 브라우저(Playwright) 필요
    const jobLinks = (r.text.match(/(job|recruit|position|notice|공고|채용)[^"'<>]{0,40}(\/\d{3,}|[?&](id|idx|no)=\d+)/gi) || []).length;
    const nextData = /__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__/.test(r.text);
    lines.push(`| ${name} | ${url} | HTTP ${r.status}${r.text ? " · " + r.text.length + "자" : ""} | ${rb.status === 200 ? robotsVerdict(rb.text) : "없음(" + rb.status + ")"} | 링크 ${jobLinks}${nextData ? " · 페이지 데이터 있음" : ""} |`);
    console.log("PAGE", name, url, r.status, r.text.length, "links", jobLinks, "next", nextData, "| title:", (r.text.match(/<title>([^<]{0,80})/i) || [])[1] || "");
  }
  // 원티드에 회사 페이지가 있으면 회사별 공고를 받을 수 있는지(검색·회사 API 형태 확인)
  lines.push("", "## 원티드 회사 검색", "", "| 회사 | 결과 |", "|---|---|");
  for (const name of ["쏘카", "KT M모바일", "케이티엠모바일", "컬리", "카카오모빌리티", "직방"]) {
    for (const u of [`https://www.wanted.co.kr/api/chaos/search/v1/autocomplete?keyword=${encodeURIComponent(name)}`,
                     `https://www.wanted.co.kr/api/v4/search/summary?query=${encodeURIComponent(name)}`]) {
      const r = await get(u);
      lines.push(`| ${name} | ${u.split("/api/")[1].split("?")[0]} → HTTP ${r.status} ${r.text.slice(0, 160).replace(/\|/g, "/")} |`);
      console.log("WANTED", name, u, r.status, r.text.slice(0, 400));
    }
  }

  lines.push("", "## 외국계 자체 채용 사이트", "", "| 회사 | 상태 | 서울 | 서울 중 기획·PM·마케팅·운영 |", "|---|---|---|---|");
  for (const [name, url, parse] of BIGTECH) {
    const r = await get(url);
    let c = null;
    try { c = r.status === 200 && parse ? parse(r.text) : null; } catch {}
    lines.push(`| ${name} | HTTP ${r.status}${c ? "" : " (형식 확인 필요)"} | ${c?.seoul ?? ""} | ${c?.pm ?? ""} |`);
    console.log(name, r.status, c);
  }
  lines.push("", "## Workday 쓰는 외국계", "", "| 회사 | 상태 | 서울 공고 | 그중 기획·PM·마케팅·운영 |", "|---|---|---|---|");
  for (const [name, host, tenant, site] of WORKDAY) {
    const r = await get(`https://${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Seoul" }),
    });
    let total = "", pm = "";
    try { const d = JSON.parse(r.text); total = d.total; pm = (d.jobPostings || []).filter((j) => PM.test(j.title)).length + "(첫 20건 중)"; } catch {}
    lines.push(`| ${name} | HTTP ${r.status} | ${total} | ${pm} |`);
    console.log(name, r.status, total);
  }
  const ap = await get("https://jobs.apple.com/api/role/search", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "", filters: { postingpostLocation: ["postLocation-KOR"] }, page: 1, locale: "en-us", sort: "newest" }) });
  lines.push(`| 애플 | HTTP ${ap.status} (자체 API) | ${(() => { try { return JSON.parse(ap.text).totalRecords; } catch { return ""; } })()} | |`);

  lines.push("", "## 플랫폼 robots.txt", "", "| 플랫폼 | 주소 | 결과 |", "|---|---|---|");
  for (const [name, urls] of PLATFORMS) {
    for (const u of urls) {
      const r = await get(`${u}/robots.txt`);
      if (!r.status) { lines.push(`| ${name} | ${u} | 접속 안 됨 |`); continue; }
      lines.push(`| ${name} | ${u} | HTTP ${r.status} · ${r.status === 200 ? robotsVerdict(r.text) : "robots 없음"} |`);
      if (r.status === 200) { console.log(`--- ${name} robots.txt ---\n${r.text.slice(0, 1500)}`); break; }
    }
  }
  const md = lines.join("\n") + "\n";
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}

main().catch((e) => { console.error(e); process.exit(1); });
