// 공고 본문 텍스트를 "회사 소개 / 모집 부문 / 담당 업무 / 자격 요건 ..."처럼
// 표준 항목으로 쪼갠다. 회사마다 제목 표기가 제각각이라(예: "[우대사항]", "ㅣ 담당 업무",
// "이런 분이면 더 좋아요 (우대 사항)") 장식을 걷어낸 뒤 같은 항목으로 묶는다.

/** 화면에 보여줄 순서. 파서가 찾은 항목만 이 순서대로 나온다. */
export const SECTION_ORDER = [
  "회사 소개", "모집 부문", "담당 업무", "자격 요건", "우대 사항",
  "근무 조건", "복리후생", "전형 절차", "지원 방법", "유의 사항",
];

const SECTION_RULES = [
  ["회사 소개", /회사\s*소개|기업\s*소개|회사를\s*소개|팀을?\s*소개|우리\s*팀은|about\s*us/i],
  ["모집 부문", /모집\s*(부문|분야|직무|내용)|채용\s*분야|채용\s*부문|포지션\s*안내/],
  ["담당 업무", /담당\s*업무|주요\s*업무|수행\s*업무|업무\s*내용|이런\s*업무를\s*해요|이렇게\s*일해요|job\s*description/i],
  ["자격 요건", /자격\s*요건|지원\s*자격|필수\s*(요건|자격|역량)|응시\s*자격|이런\s*분들?을?\s*찾|requirements/i],
  ["우대 사항", /우대\s*(사항|조건|요건)|이런\s*분이면\s*더\s*좋|preferred/i],
  ["근무 조건", /근무\s*(조건|환경|형태|지역|시간|지|장소)|처우|급여\s*조건|고용\s*형태/],
  ["복리후생", /복리\s*후생|복지|혜택/],
  ["전형 절차", /전형\s*(절차|방법)|채용\s*(절차|전형|프로세스)|선발\s*절차|모집\s*절차/],
  ["지원 방법", /접수\s*(기간|방법)|지원\s*방법|지원\s*절차|제출\s*서류|서류\s*접수|apply/i],
  ["유의 사항", /유의\s*사항|기타\s*사항|참고\s*사항|안내\s*사항|필독/],
];

/** 제목 줄에 흔히 붙는 장식(대괄호, 세로줄, 불릿, 기호)을 걷어낸다. */
function undecorate(line) {
  return line
    .replace(/^[\s\[\]<>【】ㅣ|│┃▶▷◀●○■□◆◇★☆※·•\-–—_=~#*]+/, "")
    .replace(/[\s\[\]<>【】ㅣ|│┃▶◀●○■□◆◇★☆※·•\-–—_=~#*]+$/, "")
    .trim();
}

/** 이 줄이 항목 제목인가. 제목이면 표준 항목명을, 아니면 null을 준다. */
function headingOf(line) {
  const s = undecorate(line);
  if (!s || s.length > 30) return null;
  // "근무시간 : 주 5일"처럼 값이 붙은 줄은 제목이 아니라 내용이다.
  const colon = s.match(/[:：]\s*(.+)$/);
  if (colon && colon[1].trim().length > 0) return null;
  const head = s.replace(/[:：]\s*$/, "");
  for (const [name, pattern] of SECTION_RULES) {
    if (pattern.test(head)) return name;
  }
  return null;
}

/** 페이지 메뉴·버튼처럼 공고 내용이 아닌 줄. */
const NAV_LINE = /^(로그인|로그아웃|마이페이지|채용공고|채용 공고|돌아가기|공유하기|지원하기|지원 안내|기본 지원서|홈|FAQ|MY|이전|다음|더보기|목록|목록으로|스크랩|인재풀 등록|합류 가이드 확인하기|채용공고로 가기|본문 바로가기|주메뉴 바로가기|푸터 바로가기|합류 여정|인재 영입|더 많은 .{0,20}이야기)$/;

/** 이 줄부터는 푸터라 더 읽을 필요가 없다. */
const FOOTER_LINE = /사업자\s*등록\s*번호|개인정보\s*(처리)?방침|Copyright|All rights reserved|대표이사|통신판매업/i;

/**
 * 본문을 항목별로 나눈다.
 * @param {string} text
 * @returns {{title: string, body: string}[]} 나눌 수 없으면 빈 배열
 */
export function splitSections(text) {
  if (!text) return [];
  const buckets = new Map();   // 표준 항목명 → 내용 줄 배열
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (FOOTER_LINE.test(line)) break;

    const heading = headingOf(raw);
    if (heading) {
      current = heading;
      if (!buckets.has(current)) buckets.set(current, []);
      continue;
    }
    if (!current || !line) continue;   // 첫 제목 전의 메뉴·머리말은 버린다
    if (NAV_LINE.test(line)) continue;
    buckets.get(current).push(line);
  }

  const sections = [];
  for (const title of SECTION_ORDER) {
    const lines = buckets.get(title) ?? [];
    const body = lines.join("\n").trim();
    // 짧은 낱말만 잔뜩 모인 것(대개 메뉴 잔재)은 내용으로 보지 않는다.
    const hasSentence = lines.some((l) => l.length >= 15);
    if (body.length >= 20 && hasSentence) sections.push({ title, body });
  }
  // 항목이 하나뿐이면 굳이 접었다 펴게 만들 이유가 없다.
  return sections.length >= 2 ? sections : [];
}
