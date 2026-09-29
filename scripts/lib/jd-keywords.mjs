// JD ↔ 경험 매칭용 역량 키워드 사전.
// 공고 본문과 내 경험 글을 같은 사전으로 훑어 "어떤 역량 키워드가 나오는가"를 뽑는다.
// 매칭률 = (JD 키워드 중 내 경험에도 있는 것) / (JD 키워드 전체).
//
// 이 파일은 공개 저장소에 있으므로 사전(일반 용어)만 둔다. 내 경험 내용은 절대 넣지 않는다 —
// 내 키워드는 브라우저에서 뽑아 로그인 계정(Supabase)에만 저장한다.
// data/keyword-dict.json은 이 사전을 브라우저가 읽을 수 있게 내보낸 사본(build-jd-keywords.mjs가 생성).

export const DICT = [
  // 기획·프로덕트
  ["서비스기획", "서비스\\s*기획|서비스\\s*설계|기능\\s*기획|service planning"],
  ["프로덕트·PO", "product\\s*(owner|manager)|프로덕트|\\bPO\\b|\\bPM\\b|제품\\s*기획"],
  ["요구사항 정의", "요구\\s*사항|요건\\s*정의|requirement|정책\\s*(수립|설계|정의)|스펙\\s*정의"],
  ["화면설계·UX", "화면\\s*설계|와이어\\s*프레임|wireframe|스토리보드|\\bUX\\b|사용자\\s*경험|유저\\s*플로우|user\\s*flow|figma|피그마"],
  ["문제 정의", "문제\\s*(를\\s*)?정의|문제\\s*해결|가설|hypothesis|problem"],
  ["사업기획·전략", "사업\\s*기획|전략\\s*(수립|기획)|사업\\s*전략|business\\s*strategy|로드맵|roadmap|중장기"],
  ["사업개발·제휴", "사업\\s*개발|\\bBD\\b|business\\s*development|제휴|파트너십|partnership|협력사|파트너\\s*(사|관리)"],
  ["신사업·0to1", "신사업|신규\\s*(사업|서비스)|0\\s*(to|→)\\s*1|런칭|론칭|launch|출시"],
  ["프로젝트 관리", "프로젝트\\s*(관리|매니징|리딩|운영)|일정\\s*관리|project\\s*manag|PMO|\\bPL\\b"],
  ["이해관계자 조율", "이해\\s*관계자|유관\\s*부서|협업|cross[-\\s]*functional|stakeholder|부서\\s*간|커뮤니케이션|조율"],
  // 데이터·리서치
  ["데이터 분석", "데이터\\s*(분석|기반|를\\s*기반|드리븐)|data[-\\s]*(driven|analy)|정량\\s*분석|통계"],
  ["지표·KPI", "지표|KPI|메트릭|metric|성과\\s*(측정|분석|관리)|퍼널|funnel|전환율|리텐션|retention"],
  ["SQL·툴", "\\bSQL\\b|파이썬|python|\\bGA4?\\b|google\\s*analytics|amplitude|엑셀|excel|스프레드시트|tableau|태블로"],
  ["A/B 테스트·실험", "a\\s*/\\s*b|실험\\s*설계|experiment|테스트\\s*설계"],
  ["사용자 리서치", "사용자\\s*(리서치|조사|인터뷰)|고객\\s*(인터뷰|조사)|user\\s*research|인터뷰|IDI|FGI|정성\\s*(조사|리서치)"],
  ["설문·조사 설계", "설문|서베이|survey|질문\\s*설계|조사\\s*설계"],
  ["시장·트렌드 분석", "시장\\s*(조사|분석)|트렌드|trend|경쟁사|벤치마킹|benchmark|market\\s*research|산업\\s*분석"],
  ["인사이트 도출", "인사이트|insight"],
  // 마케팅·브랜드·콘텐츠
  ["마케팅 기획", "마케팅\\s*(기획|전략|캠페인)|marketing|캠페인|campaign|프로모션|promotion|IMC"],
  ["퍼포먼스 마케팅", "퍼포먼스|performance\\s*marketing|광고\\s*(운영|집행)|매체|\\bROAS\\b|\\bCPA\\b|페이드|paid"],
  ["그로스·CRM", "그로스|growth|\\bCRM\\b|리텐션\\s*마케팅|푸시|앱\\s*푸시|유입|acquisition"],
  ["브랜드", "브랜드|브랜딩|brand"],
  ["콘텐츠 기획·제작", "콘텐츠|컨텐츠|content|카피|copy\\s*writing|에디터|영상\\s*(기획|제작)|숏폼"],
  ["SNS·소셜", "\\bSNS\\b|소셜|social|인스타그램|instagram|유튜브|youtube|틱톡|tiktok"],
  ["인플루언서", "인플루언서|influencer|크리에이터|creator|KOL"],
  ["커뮤니티", "커뮤니티|community|팬덤|멤버십"],
  ["PR·홍보", "\\bPR\\b|홍보|보도\\s*자료|언론|대외\\s*협력"],
  ["행사·이벤트", "행사|이벤트|event|오프라인\\s*(행사|마케팅)|팝업|전시|컨퍼런스|세미나"],
  // 운영·CX
  ["서비스 운영", "서비스\\s*운영|운영\\s*(관리|기획|업무|정책)|operation|오퍼레이션"],
  ["프로세스 개선", "프로세스\\s*(개선|설계|정립)|업무\\s*(개선|효율)|효율화|표준화|process\\s*improv|자동화|automation"],
  ["CX·고객경험", "\\bCX\\b|고객\\s*경험|customer\\s*experience|VOC|고객\\s*(만족|불만|응대|문의)|\\bCS\\b"],
  ["문서화·가이드", "문서화|가이드|매뉴얼|manual|documentation|위키|노션|notion|온보딩|onboarding"],
  ["품질·검수", "품질|검수|\\bQA\\b|quality|모니터링|monitoring"],
  ["위기·이슈 대응", "이슈\\s*대응|위기|리스크|risk|장애\\s*대응|클레임|어뷰징"],
  ["물류·SCM", "물류|\\bSCM\\b|공급망|재고|풀필먼트|fulfillment|\\bFBA\\b|배송|입출고"],
  ["정산·계약", "정산|계약|settlement|회계"],
  // 커머스·영업
  ["이커머스", "이커머스|e-?commerce|커머스|commerce|온라인\\s*(몰|판매|유통|영업)|오픈\\s*마켓|쇼핑몰"],
  ["MD·상품기획", "(?<!\\.)\\bMD\\b|머천다이징|merchandis|상품\\s*(기획|소싱|구성|운영)|소싱"],
  ["영업·세일즈", "영업|세일즈|sales|수주|고객사\\s*(발굴|관리)|account\\s*(manage|execut)"],
  ["B2B", "\\bB2B\\b|기업\\s*고객|엔터프라이즈|enterprise|법인"],
  ["B2C", "\\bB2C\\b|소비자|일반\\s*고객|consumer"],
  // 기술·도메인
  ["AI·LLM", "\\bAI\\b|인공지능|\\bLLM\\b|생성형|GPT|챗봇|chatbot|머신\\s*러닝|machine\\s*learning|\\bML\\b|프롬프트|prompt|에이전트|agent"],
  ["노코드·개발 이해", "노코드|no-?code|개발\\s*(이해|협업|지식)|\\bAPI\\b|웹\\s*개발|프론트|개발자와|기술\\s*이해"],
  ["플랫폼", "플랫폼|platform"],
  ["모바일 앱", "모바일|앱\\s*서비스|\\bapp\\b|어플리케이션"],
  ["금융·핀테크", "금융|핀테크|fintech|결제|payment|은행|증권|보험|대출|투자|자산"],
  ["교육", "교육|에듀|edu|학습|강의|커리큘럼|curriculum"],
  ["엔터·IP", "엔터|아티스트|음악|앨범|\\bIP\\b|라이선싱|licens|게임|메타버스|metaverse"],
  ["F&B·식품", "F&B|식품|푸드|food|외식|음료"],
  ["뷰티·패션", "뷰티|beauty|화장품|코스메틱|패션|fashion|의류"],
  ["여행·모빌리티", "여행|travel|숙박|항공|모빌리티|mobility"],
  ["부동산·프롭테크", "부동산|프롭테크|중개|아파트"],
  ["헬스케어", "헬스케어|healthcare|의료|병원|메디컬|웰니스"],
  // 태도·언어
  ["글로벌·해외", "글로벌|global|해외|overseas|현지화|로컬라이|localiz"],
  ["영어", "영어|english|영문"],
  ["일본어", "일본어|japanese|일본"],
  ["중국어", "중국어|chinese|중화권"],
  ["리더십·팀 리딩", "리더십|leadership|팀\\s*(리드|리딩|장)|리딩\\s*경험"],
  ["주도성", "주도적|주도\\s*해|오너십|ownership|자기\\s*주도|능동"],
];

const COMPILED = DICT.map(([label, src]) => [label, new RegExp(src, "i")]);

/** 텍스트에 나오는 사전 키워드 라벨 목록 */
export function extractKeywords(text) {
  if (!text) return [];
  return COMPILED.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/**
 * JD 본문에서 요구 연차를 읽는다. 숫자로 된 연차가 있으면 가장 큰 값, 없으면 null.
 * "신입", "경력 무관", "연차 제한 없음"처럼 숫자가 없는 표현은 연차 표시 없음(null)으로 본다.
 * "0년", "1년 미만"처럼 신입을 뜻하는 숫자는 무시한다.
 */
export function yearsIn(text) {
  if (!text) return null;
  const mins = [];
  const patterns = [
    /(\d+)\s*(?:[~\-–]\s*\d+\s*)?\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/gi,
    /(\d+)\s*(?:[~\-–]\s*\d+\s*)?\+\s*years/gi,
    /(?:경력|경험|실무)\s*(\d+)\s*년/g,
    /(\d+)\s*(?:[~\-–]\s*\d+\s*)?년\s*(?:이상|차)?\s*(?:의)?\s*(?:경력|경험|실무|이상)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) mins.push(Number(m[1]));
  const valid = mins.filter((n) => n > 0 && n < 30);
  return valid.length ? Math.max(...valid) : null;
}
