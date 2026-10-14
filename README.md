# 지원 보드

채용 공고 캘린더 · 전형 일정 · 자소서 아카이브를 한 화면에서 관리하는 정적 웹앱.

## 쓰는 법

배포된 주소를 열면 먼저 로그인(이메일+비밀번호) 화면이 뜹니다. 로그인/가입 후 ⋯ 메뉴의 **내 조건**에서
관심 직무와 기업 형태를 고르면, 조건에 맞는 공고만 보입니다(기업 형태 정보가 없는 공고는 기본으로 함께 보이고,
내 조건 창에서 끌 수 있습니다).
공고에 **담기**를 누르면 화면은 그대로 있고 `내 지원` 탭에 모이며, 서류 마감 D-day가 상단에 뜹니다.
서류 결과를 **합격**으로 바꾸면 그 다음 전형(AI 역량검사, 적성검사, 인적성검사, 1·2차·최종 면접)을
붙여 일정을 넣을 수 있고, 그 날짜가 캘린더와 주간 플래너에 함께 표시됩니다.
발표 예정일이 지났거나(없으면 서류 마감 후 14일) 결과가 아직 '대기'인 공고는 **확인 필요**로 표시됩니다.

## 내 데이터는 어디에 있나

**로그인 계정 기준으로 Supabase에 저장**됩니다. 같은 계정으로 로그인하면 어느 기기에서 열어도
같은 내용이 보입니다(점약노트와 같은 Supabase 프로젝트를 쓰지만 테이블은 분리되어 있음:
`jobboard_data`). 다른 사람 계정에는 보이지 않습니다. 저장되는 것: 지원 여부, 전형 일정,
공고별 자소서·이력서 본문, 경험 정리, 마스터 자소서·이력서, 주간 할 일.

이 기기에도 계정별 사본(`localStorage`의 `jobboard-v2:<사용자 id>`)이 남지만 정본은 항상 계정 쪽입니다.
로그아웃하면 기다리던 저장을 먼저 끝낸 뒤 이 기기의 사본을 지웁니다(공유 PC 대비). 저장 사본에는
아무 내용도 없는 빈 기록은 넣지 않습니다. 계정 데이터를 불러오지 못하면 빈 보드로 시작하지 않고
'다시 시도' 화면에서 멈춥니다(그 상태에서는 아무것도 저장하지 않음). 헤더의 '저장됨 / 저장 중 / 저장 못 했어요'로
저장 상태를 볼 수 있습니다. 그래도 가끔 ⋯ 메뉴의 **백업 파일 받기**로 JSON 파일을 받아 두고, 필요하면
**백업에서 복원**으로 불러오세요.

Supabase 쪽 최초 설정(테이블 생성 SQL)은 `jobboard_data` 테이블이 없으면 로그인 후 토스트로
에러가 뜨니, Supabase 대시보드 SQL Editor에서 한 번만 실행하면 됩니다 — Claude와의 대화 기록에
전체 SQL이 있습니다.

## 공고 데이터

`data/jobs.json` 하나에만 들어 있습니다. 공개 정보(기업·직무·접수기간·역대 오픈 이력·출처·링크)만
담고 개인 메모는 넣지 않습니다. 이 파일이 갱신되면 모든 사용자가 자동으로 최신 목록을 봅니다.

- `confirmed: false` — 과거 접수 패턴으로 추정한 **예상** 일정
- `confirmed: true` — 실제 공고로 확인한 **확정** 일정
- `start`, `end`가 빈 문자열 — 상시·수시 채용

## 자동 업데이트

GitHub Actions(`.github/workflows/update-jobs.yml`)가 매일 KST 22:23에 예약돼 있습니다. 깃허브 예약 실행은
몇 시간씩 늦게 시작해서 보통 다음 날 새벽에 끝나고, 바뀐 데이터를 main에 커밋합니다. 그중 공고 수집 스크립트는 다음과 같습니다.

- `scripts/fetch-jobs.mjs` — 원티드·링커리어·자소설닷컴에서 PM/서비스기획·기획/전략 관련 인턴/신입
  공고를 찾아 `data/jobs.json`에 새 항목만 추가(기존 항목은 건드리지 않음). 제목에 직무가 안 써있는
  "2026년 대졸신입 채용" 같은 대기업 공채도 기획 트랙이 있을 가능성이 높아 "확인 필요" 표시로 함께 수집
- `scripts/fetch-ai-companies.mjs` — 구글·앤스로픽·노션·OpenAI 서울 오피스 공고를 직무·경력 무관하게
  전부 모아 `data/ai-companies-jobs.json`을 매번 새로 씀 (지원보드 트래킹 대상이 아닌 분석용 자료).
  앤스로픽은 Greenhouse, 노션·OpenAI는 Ashby — 전부 각 채용 플랫폼의 공식 공개 API를 쓴다
  (OpenAI 자체 웹사이트는 봇 차단이라 직접 스크래핑은 여전히 안 됨, 그래서 Ashby로 우회 아닌 정공)

잡코리아는 robots.txt가 AI 크롤러를 전면 차단해서, 스펙업은 실체가 로그인 필요한 네이버 카페라서
자동 수집 대상에서 제외했습니다 (둘 다 사이트가 명시적으로 원치 않는 접근이라 우회하지 않음).

## 배포

- **main에 push하면 Vercel의 GitHub 연동이 프로덕션 배포를 자동으로 만든다.** 워크플로는 데이터 커밋·푸시까지만 하고
  CLI로 따로 배포하지 않는다(이중 배포 방지). `vercel.json`은 `cleanUrls`만 켠다.
- 공개 주소 `getjob.vercel.app`은 Vercel 프로젝트 Settings → Domains에 등록돼 있어야 최신 프로덕션 배포를 따라간다.
  배포는 됐는데 주소가 옛 화면이면, Domains에 그 주소가 있는지(또는 `vercel alias set <배포 주소> getjob.vercel.app`) 확인한다.
- 배포 뒤 확인: 로그인, 콘솔 오류 0건, `data/jobs.json`의 `updated`, 로그아웃 뒤 이 기기 사본(`jobboard-v2:*`) 없음.
- 되돌리기: Vercel 대시보드 Deployments에서 이전 배포를 Promote(Instant Rollback)하거나 `vercel rollback`(바로 앞 배포) /
  `vercel rollback <배포 주소>`. 코드 쪽은 main에서 해당 커밋을 `git revert`.
- 화면 파일은 `index.html`(마크업) · `app.css` · `app.js`. 바꾼 뒤에는 `index.html`의 `app.css?v=` · `app.js?v=` 값을
  바꿔 브라우저 캐시를 무효화한다. 로컬 확인은 저장소 폴더에서 `python3 -m http.server 8787 --bind 127.0.0.1`.

## 테스트

`tests/e2e/`에 Playwright(Chromium) E2E가 있다. 로컬 서버를 띄운 뒤 **QA 전용 계정**으로 돌린다(실사용자 계정 금지 —
테스트가 보드를 시드 백업으로 덮어쓴다). 자세한 준비물과 환경변수는 `tests/e2e/README.md`.

```sh
python3 -m http.server 8787 --bind 127.0.0.1          # 다른 터미널
JOBBOARD_QA_ENV=/경로/qa-account.env npm run test:e2e   # 전체(파일을 차례로)
JOBBOARD_QA_ENV=/경로/qa-account.env node --test tests/e2e/list.test.mjs   # 파일 하나
```

실험 변형은 주소 파라미터로 켠다: `?v=b1`(첫 화면 '오늘' 탭), `?v=b2`(담기와 제출 나누기). 파라미터가 없으면 언제나 기본 화면이다.

## 구조

```
index.html                        화면 마크업(로그인·탭·창). app.css와 app.js를 상대 경로로 불러온다
app.css                           스타일(테마 6색 · 밝게/어둡게)
app.js                            앱 동작 전체(공고 목록·내 지원·캘린더·저장)
tests/e2e/                        E2E 테스트(Playwright, node:test)
data/jobs.json                    공고 목록 (첫 화면에서 바로 받음, 가볍게 유지)
data/details.json                 공고 본문·포스터 이미지 (공고를 열 때만 받음)
data/ai-companies-jobs.json       구글/앤스로픽/노션/OpenAI 서울 공고 (분석용)
data/radar.json                   채용 레이더 탭 데이터 (토스·구글·노션·앤스로픽, 연차 구분)
data/jd-keywords.json             매칭 아카이브용 JD 키워드 (연차 표시 없는 공고만)
scripts/lib/classify.mjs          직무 분류·정규화 공용 규칙 (수집·재분류가 함께 사용)
scripts/fetch-jobs.mjs            공고 목록 수집
scripts/fetch-official-details.mjs 공식 채용페이지 본문 수집 (헤드리스 브라우저)
scripts/fetch-ai-companies.mjs    AI 4사 공고 수집
scripts/fetch-radar.mjs           채용 레이더 수집 (요건 문장에서 연차를 읽어 분류)
scripts/fetch-companies.mjs       스타트업·유니콘·외국계 공식 채용 시스템에서 기획·PM·마케팅 공고 수집
scripts/build-jd-keywords.mjs     JD 본문에서 역량 키워드 추출 (사전: scripts/lib/jd-keywords.mjs)
scripts/reclassify-jasoseol.mjs   분류 규칙 변경 시 기존 데이터 재분류
.github/workflows/update-jobs.yml 매일 11시 자동 실행 워크플로우
```

## 공고 본문은 어떻게 가져오나

회사 공식 채용페이지는 대부분 자바스크립트로 그려지는 사이트라 단순 요청으로는 빈 화면만 옵니다.
그래서 헤드리스 브라우저로 페이지를 실제로 띄운 뒤 화면에 보이는 내용을 가져옵니다.
한국 채용공고는 본문 전체가 이미지 한 장인 경우도 많아서, 텍스트가 부실하면 그 포스터 이미지를
대신 저장해 앱에서 그대로 보여줍니다.

회사마다 페이지 구조가 전부 달라 "직무별 표"처럼 구조화해서 뽑는 것은 하지 않습니다.
사람이 페이지를 열어 읽는 것과 같은 원문을 그대로 담습니다.
