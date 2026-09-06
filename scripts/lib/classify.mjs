// 공고 분류·정규화 공용 로직.
// fetch-jobs.mjs(신규 수집)와 reclassify-jasoseol.mjs(기존 데이터 재분류)가 같이 쓴다.
// 예전에는 두 파일에 같은 규칙을 복붙해 두어서 한쪽만 고치면 조용히 어긋났다.

/** 지원보드 index.html의 ROLES와 반드시 같은 값이어야 한다. */
export const ROLES = [
  "PM/서비스기획", "기획/전략", "사업개발", "마케팅", "브랜드", "콘텐츠", "MD",
  "영업", "영업관리", "고객/CS", "HR/인사", "금융/심사", "리서치", "홍보/PR",
];

/**
 * 자소설닷컴 직무 카테고리(duty-groups) 이름 → 지원보드 직무.
 * 위에 있는 규칙이 먼저 이긴다(구체적인 것부터). 예: "브랜드마케팅"은 마케팅보다
 * 브랜드로, "영업관리·지원·기획"은 영업보다 영업관리로 잡혀야 한다.
 */
const DUTY_ROLE_RULES = [
  [/서비스기획·PM|서비스\s*기획/, "PM/서비스기획"],
  [/기획·전략·경영|경영기획|사업기획|경영전략|사업전략|경영분석·컨설턴트/, "기획/전략"],
  [/브랜드마케팅/, "브랜드"],
  [/콘텐츠마케팅/, "콘텐츠"],
  [/상품기획/, "MD"],
  [/마케팅/, "마케팅"],
  [/언론홍보·PR|사내홍보|광고·홍보|광고기획·AE|광고제작·카피/, "홍보/PR"],
  [/영업관리·지원·기획/, "영업관리"],
  [/고객응대·CS|아웃바운드|인바운드/, "고객/CS"],
  [/제품·서비스영업|IT·솔루션·기술영업|B2B영업·법인영업|해외영업|금융·보험영업|영업/, "영업"],
  [/인사·노무·교육|교육개발·기획|^인사$|^노무$|^채용$|^급여$|^보상관리$/, "HR/인사"],
  [/채권·심사|증권·투자|외환·펀드·자산운용|보험계리사·손해사정|은행원|애널리스트/, "금융/심사"],
  [/리서치·시장조사/, "리서치"],
];

/** 직무 카테고리가 없을 때 쓰는 제목 키워드 백업 규칙. */
const TITLE_ROLE_RULES = [
  [/서비스\s*기획|프로덕트|PM\b|product manager|PO\b/i, "PM/서비스기획"],
  [/경영기획|사업기획|전략기획|기획\/경영|기획팀|사업전략|경영전략/i, "기획/전략"],
];

/**
 * "2026년 대졸신입 채용"처럼 직무가 안 적힌 대기업 공채.
 * 대부분 기획 트랙이 있어 놓치면 안 되지만 확정은 아니라 "확인 필요"로 표시한다.
 */
const BATCH_PATTERN = /대졸\s*신입|신입\s*공채|공채|대규모/;
const BATCH_EXCLUDE = /생산|기술직|현장|영업직|엔지니어|디자이너|개발자|R&D|연구소|판매|매장|간호|약사|의사/i;

/**
 * 공고 하나를 직무로 분류한다.
 * @param {{title?: string, company?: string, dutyNames?: string[]}} posting
 * @returns {{roles: string[], hist: string} | null} 분류 실패 시 null
 */
export function classifyPosting({ title = "", company = "", dutyNames = [] } = {}) {
  // 1순위: 채용 사이트가 공고에 직접 매겨둔 직무 카테고리 — 제목 추측보다 훨씬 정확하다.
  const fromDuty = new Set();
  for (const name of dutyNames) {
    if (!name) continue;
    for (const [pattern, role] of DUTY_ROLE_RULES) {
      if (pattern.test(name)) { fromDuty.add(role); break; }
    }
  }
  if (fromDuty.size > 0) {
    return { roles: [...fromDuty], hist: "자동 수집 · 공고에 표기된 직무 분류 기준" };
  }

  // 2순위: 제목에 직무가 드러난 경우
  const text = `${title} ${company}`;
  const fromTitle = new Set();
  for (const [pattern, role] of TITLE_ROLE_RULES) {
    if (pattern.test(text)) fromTitle.add(role);
  }
  if (fromTitle.size > 0) return { roles: [...fromTitle], hist: "자동 수집" };

  // 3순위: 직무 표기가 없는 대기업 공채 — 일단 잡아두고 확인하도록 안내
  if (BATCH_PATTERN.test(text) && !BATCH_EXCLUDE.test(text)) {
    return {
      roles: ["PM/서비스기획", "기획/전략"],
      hist: "자동 수집 · 대졸 신입 공채 — 기획 트랙 포함 여부는 공고에서 직접 확인하세요",
    };
  }
  return null;
}

/** 분류 실패 시 쓰는 기본 설명. */
export const UNKNOWN_ROLE_HIST = "자동 수집 · 직무 확인 필요";

const EXPERIENCED_ONLY = /경력/;
const NEWCOMER_HINT = /신입|인턴|수시|채용연계형|무관|공채|졸업예정/;

/** 경력만 뽑는 공고인지. 신입/인턴 표현이 같이 있으면 신입도 지원 가능하다고 본다. */
export function isExperiencedOnly(text) {
  return EXPERIENCED_ONLY.test(text) && !NEWCOMER_HINT.test(text);
}

/** 자소설닷컴의 기업 규모/유형 → 지원보드의 "기업 형태". */
export function mapCompanyType(item) {
  if (item?.business_type === "public_institution") return "공기업";
  if (item?.business_size === "big_business") return "대기업";
  if (item?.business_size === "middle_market") return "중견기업";
  return "";
}

/** 자소설닷컴 공고 하나에 붙은 직무 카테고리 이름들을 뽑는다. */
export function dutyNamesOf(item, dutyGroupNames) {
  return (item?.employments ?? [])
    .flatMap((e) => e.duty_groups ?? [])
    .map((g) => dutyGroupNames.get(g.group_id))
    .filter(Boolean);
}

/** 자소설닷컴 직무 카테고리 id → 이름 맵. */
export async function fetchDutyGroupNames(userAgent) {
  const res = await fetch("https://jasoseol.com/api/v1/duty-groups", {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!res.ok) return new Map();
  const list = await res.json();
  return new Map(list.map((g) => [g.id, g.name]));
}

/* ---------- 날짜 ---------- */

export function toDateOnly(isoOrEpoch) {
  if (!isoOrEpoch) return "";
  const d = new Date(isoOrEpoch);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const KST_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** 마감 시각(KST, HH:mm). 00:00이면 시각 정보가 없는 경우가 많아 빈 값으로 둔다. */
export function toTimeKST(isoOrEpoch) {
  if (!isoOrEpoch) return "";
  const d = new Date(isoOrEpoch);
  if (Number.isNaN(d.getTime())) return "";
  const t = KST_TIME.format(d);
  return t === "00:00" ? "" : t;
}
