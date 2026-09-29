#!/usr/bin/env node
// 수집처 후보 점검용(일회성). 스타트업·유니콘·외국계 서울 오피스가 어떤 채용 시스템을 쓰는지,
// 그리고 인턴·신입 플랫폼이 수집을 허락하는지(robots.txt) 확인해 표로 출력한다.
// 결과는 GitHub Actions 요약(GITHUB_STEP_SUMMARY)에 남고, 데이터 파일은 건드리지 않는다.

import { appendFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const PM = /기획|PM\b|PO\b|product\s*(manager|owner)|프로덕트|서비스\s*기획|사업\s*개발|business\s*development|전략|strategy|operations|운영|마케팅|marketing|growth|그로스/i;
const SEOUL = /seoul|korea|서울|한국|대한민국/i;

// [회사, 시도해 볼 계정 이름들]
const COMPANIES = [
  ["컬리", ["kurly", "kurlycorp"]], ["야놀자", ["yanolja"]], ["여기어때", ["gccompany", "goodchoice"]],
  ["쏘카", ["socar"]], ["오늘의집", ["bucketplace", "ohouse"]], ["리디", ["ridi", "ridicorp"]],
  ["뱅크샐러드", ["banksalad", "rainist"]], ["두나무", ["dunamu"]], ["크래프톤", ["krafton"]],
  ["하이퍼커넥트", ["hyperconnect"]], ["몰로코", ["moloco"]], ["채널코퍼레이션", ["channelcorp", "channelio", "channel"]],
  ["에이블리", ["ably", "ablycorp"]], ["카카오스타일(지그재그)", ["kakaostyle", "zigzag"]], ["브랜디", ["brandi"]],
  ["클래스101", ["class101"]], ["리멤버", ["remember", "dramancompany", "rememberncompany"]], ["오픈서베이", ["opensurvey"]],
  ["플렉스", ["flex", "flexteam"]], ["버드뷰(화해)", ["birdview", "hwahae"]], ["닥터나우", ["doctornow"]],
  ["42dot", ["42dot"]], ["리벨리온", ["rebellions"]], ["퓨리오사AI", ["furiosa", "furiosaai"]],
  ["왓챠", ["watcha"]], ["밀리의서재", ["millie", "milliebook"]], ["스푼랩스", ["spoonlabs", "spoonradio"]],
  ["매스프레소(콴다)", ["mathpresso", "qanda"]], ["뤼이드", ["riiid"]], ["엘리스", ["elice", "elicer"]],
  ["더핑크퐁컴퍼니", ["pinkfong", "thepinkfongcompany"]], ["로앤컴퍼니", ["lawcompany", "lawtalk"]],
  ["자비스앤빌런즈(삼쩜삼)", ["jobis", "3o3", "jobisnvillains"]], ["핀다", ["finda"]], ["정육각", ["jeongyookgak"]],
  ["그린랩스", ["greenlabs"]], ["크림", ["kream", "kreamcorp"]], ["번개장터", ["bunjang", "bgzt"]],
  ["원티드랩", ["wantedlab", "wanted"]], ["와드(캐치테이블)", ["wad", "catchtable"]], ["데이원컴퍼니", ["dayone", "fastcampus"]],
  ["트리플", ["triple", "interparktriple"]], ["당근", ["daangn"]], ["센드버드", ["sendbird"]], ["토스", ["toss", "vivarepublica"]],
  ["무신사", ["musinsa"]], ["29CM", ["29cm"]], ["마켓보로", ["marketboro"]], ["아이디어스(백패커)", ["backpackr", "idus"]],
  ["스타일쉐어", ["styleshare"]], ["당근페이", ["daangnpay"]], ["업비트", ["upbit"]], ["빗썸", ["bithumb"]],
  ["코드스테이츠", ["codestates"]], ["라포랩스(퀸잇)", ["laplace", "queenit", "laplacelabs"]], ["에이슬립", ["asleep"]],
  ["스캐터랩", ["scatterlab"]], ["뤼튼", ["wrtn"]], ["업스테이지", ["upstage"]], ["마이리얼트립", ["myrealtrip"]],
  // 외국계 서울 오피스
  ["에어비앤비", ["airbnb"]], ["스트라이프", ["stripe"]], ["우버", ["uber"]], ["데이터독", ["datadog"]],
  ["스노우플레이크", ["snowflake"]], ["노션", ["notion"]], ["피그마", ["figma"]], ["캔바", ["canva"]], ["리니어", ["linear"]],
  ["데이터브릭스", ["databricks"]], ["클라우드플레어", ["cloudflare"]], ["몽고DB", ["mongodb"]], ["트윌리오", ["twilio"]],
  ["옥타", ["okta"]], ["로블록스", ["roblox"]], ["유니티", ["unity3d", "unity"]], ["드롭박스", ["dropbox"]],
  ["핀터레스트", ["pinterest"]], ["레딧", ["reddit"]], ["디스코드", ["discord"]], ["듀오링고", ["duolingo"]],
  ["그래머리", ["grammarly"]], ["코인베이스", ["coinbase"]], ["바이낸스", ["binance"]], ["깃랩", ["gitlab"]],
  ["엘라스틱", ["elastic"]], ["허브스팟", ["hubspot"]], ["젠데스크", ["zendesk"]], ["아틀라시안", ["atlassian"]],
  ["스포티파이", ["spotify"]], ["틱톡/바이트댄스", ["bytedance", "tiktok"]], ["쇼피", ["shopee", "sea"]],
  ["그랩", ["grab"]], ["아고다", ["agoda"]], ["트립닷컴", ["tripcom", "trip"]], ["부킹닷컴", ["booking"]],
  ["오픈AI", ["openai"]], ["퍼플렉시티", ["perplexity", "perplexityai"]], ["스케일AI", ["scaleai"]], ["코히어", ["cohere"]],
  // 사용자가 링크드인에서 본 서울 공고 회사들 — 공식 채용 시스템 쪽을 찾는다
  ["틱톡", ["tiktok", "bytedance", "lifeattiktok"]], ["타코벨", ["tacobell", "yumbrands"]], ["2K", ["2k", "2kgames", "taketwo"]],
  ["샤크닌자", ["sharkninja"]], ["라쿠텐 심포니", ["rakutensymphony", "rakuten"]], ["얼라인 테크놀로지", ["align", "aligntech"]],
  ["KLA", ["kla", "klacorp"]], ["르네사스", ["renesas"]], ["덴츠플라이 시로나", ["dentsplysirona"]],
  ["스탠리블랙앤데커", ["stanleyblackdecker", "sbd"]], ["오비터스", ["orbiters"]], ["피키", ["picky"]],
  ["익스팬드케이", ["expandk"]], ["뉴베슬", ["newvessel"]], ["웰뉴", ["wellnew"]], ["키스뷰티", ["kissbeauty", "kissusa"]],
  ["미스트랄", ["mistral"]], ["허깅페이스", ["huggingface"]], ["일레븐랩스", ["elevenlabs"]], ["런웨이", ["runwayml", "runway"]],
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
  const lines = ["## 채용 시스템 점검 (회사)", "", "| 회사 | 찾은 곳 | 전체 | 서울 | 서울 중 기획·PM·마케팅·운영 |", "|---|---|---|---|---|"];
  for (const [name, slugs] of COMPANIES) {
    const r = await probeCompany(name, slugs);
    if (!r.found.length) lines.push(`| ${name} | 못 찾음 | | | |`);
    for (const f of r.found) lines.push(`| ${name} | ${f.via} | ${f.total} | ${f.seoul} | ${f.pm} |`);
    console.log(name, r.found.map((f) => f.via).join(", ") || "-");
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
