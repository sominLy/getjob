// 채용이 아니라 교육·학위 과정인 공고, 대학 교직원·병원 공고를 걸러 낸다.
// 지원보드·매칭 아카이브는 기획·마케팅·운영 직무를 찾는 용도라 이런 공고는 섞이지 않게 한다.

// 내가 '교육생'으로 들어가는 과정(부트캠프·양성과정·아카데미·대학원 과정)
const PROGRAM = /K-?Digital\s*Training|K-?디지털|디지털\s*트레이닝|K-?뉴딜|\bcamp\b|캠프|훈련생|훈련\s*과정|과정\s*(모집|수료)|수료\s*후|사관\s*학교|SSAFY|싸피|\bHINT\b|양성\s*(과정|교육|프로그램)|전문가\s*양성|교육\s*프로그램|아카데미|academy|부트\s*캠프|bootcamp|내일배움|K-?디지털|국비|교육생|수강생|연수생|참여자\s*모집|아카데미\s*참여자|박사\s*과정|석사\s*과정|\((박사|석사|박사후)\)|박사후\s*연구원/i;
// 대학교 교직원·학사 행정, 병원·의료원(간호·약사·원무 등 의료기관 채용)
const ACADEMIC = /대학교|미래인재개발원|학교법인|병원|의료원|의료재단|의료법인/;

// 채용이 아니라 '나중에 연락 줄게' 식으로 이력서만 모으는 인재풀·상시 인재 등록(제목으로만 판단)
const TALENT_POOL = /인재\s*풀|인재\s*pool|talent\s*(pool|community|network)|인재\s*(등록|DB|데이터베이스)|상시\s*인재|future\s*opportunit|general\s*application|open\s*application|expression\s*of\s*interest|자유\s*지원|오픈\s*포지션|open\s*position\s*\(|포지션\s*제안/i;
export const isTalentPool = (title = "") => TALENT_POOL.test(title);

// 공고 본문에만 드러나는 교육 과정(제목은 '○○ CAMP 7기'처럼 애매할 때). 본문의 복지 소개와 헷갈리지 않게 강한 표현만 본다.
const PROGRAM_STRONG = /K-?Digital\s*Training|K-?디지털\s*트레이닝|K-?뉴딜\s*아카데미|훈련\s*장려금/i;
// 약한 표현은 페이지 옆 광고나 '국비지원 사업을 운영할 사람' 같은 채용 공고에도 나오므로 서로 다른 표현이 두 개 이상일 때만
const PROGRAM_WEAK = [/내일\s*배움\s*카드/, /교육생\s*(모집|선발)/, /훈련생/, /수강생\s*모집/, /국비\s*(지원\s*)?(무료\s*)?(교육|과정)/, /아카데미\s*교육/, /수료증/];
export const isProgramBody = (text = "") => PROGRAM_STRONG.test(text) || PROGRAM_WEAK.filter((re) => re.test(text)).length >= 2;

/** company와 직무·제목 글자를 넣으면 걸러야 할 공고인지 */
export function isNotJob(company = "", text = "") {
  return ACADEMIC.test(company) || PROGRAM.test(`${company} ${text}`);
}

// 해외 근무지(일본·중국 등) 공고와 한국어·영어 말고 다른 외국어가 필요한 공고.
// 근무지는 제목만 본다(본문의 "도쿄 오피스와 협업" 같은 말로 빠지지 않게).
// 본문의 외국어는 '필수·능통' 같은 요구로 적힌 것만 친다(우대·회사 소개에 나온 것은 그대로 둔다).
const ABROAD = /japan|일본|tokyo|도쿄|osaka|오사카|china|중국|beijing|베이징|shanghai|상하이|taiwan|대만|singapore|싱가포르|vietnam|베트남|hong\s*kong|홍콩|thailand|태국|indonesia|인도네시아|philippines|필리핀|[぀-ヿ]/i;
const OTHER_LANG = /일본어|중국어|베트남어|태국어|인도네시아어|스페인어|독일어|프랑스어|러시아어|아랍어|포르투갈어|이탈리아어|japanese|mandarin|chinese|cantonese|vietnamese|bahasa|spanish|german|french|russian|arabic|portuguese|JLPT|\bHSK\b|\bJPT\b/i;

const MUST = /필수|능통|능숙|유창|자유롭|원어민|네이티브|native|fluen|required|proficien|업무\s*커뮤니케이션|비즈니스\s*(레벨|수준|회화)|작성\s*부탁|N[12]\b/i;
const SOFT = /우대|preferred|\bplus\b|bonus|nice\s*to\s*have|어학\s*우수|인재풀|전공/i;
const OTHER_LANG_G = new RegExp(OTHER_LANG.source, "gi");

/** 본문에서 한국어·영어 외 외국어를 '요구'하는지 */
export function requiresOtherLang(text = "") {
  for (const m of text.matchAll(OTHER_LANG_G)) {
    const win = text.slice(Math.max(0, m.index - 30), m.index + 40);
    if (MUST.test(win) && !SOFT.test(win)) return true;
  }
  return false;
}

/** 해외 근무이거나 한국어·영어 외 외국어가 필요한 공고인지 */
export function needsOtherLang(title = "", text = "") {
  return ABROAD.test(title) || OTHER_LANG.test(title) || requiresOtherLang(text);
}

/** 근무지·언어 표시가 이 글자에 있는지(여러 모집 부문 중 하나만 해외인 공고를 가릴 때) */
export const isAbroadName = (s = "") => ABROAD.test(s) || OTHER_LANG.test(s);
