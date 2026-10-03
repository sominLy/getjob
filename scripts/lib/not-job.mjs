// 채용이 아니라 교육·학위 과정인 공고, 대학 교직원·병원 공고를 걸러 낸다.
// 지원보드·매칭 아카이브는 기획·마케팅·운영 직무를 찾는 용도라 이런 공고는 섞이지 않게 한다.

// 내가 '교육생'으로 들어가는 과정(부트캠프·양성과정·아카데미·대학원 과정)
const PROGRAM = /양성\s*(과정|교육|프로그램)|전문가\s*양성|교육\s*프로그램|아카데미|academy|부트\s*캠프|bootcamp|내일배움|K-?디지털|국비|교육생|수강생|연수생|참여자\s*모집|아카데미\s*참여자|박사\s*과정|석사\s*과정|\((박사|석사|박사후)\)|박사후\s*연구원/i;
// 대학교 교직원·학사 행정, 병원·의료원(간호·약사·원무 등 의료기관 채용)
const ACADEMIC = /대학교|미래인재개발원|학교법인|병원|의료원|의료재단|의료법인/;

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
