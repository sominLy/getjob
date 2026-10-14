# 지원 보드 E2E 테스트

로컬 정적 서버에 띄운 `index.html`을 Playwright(Chromium)로 열어, QA 전용 계정으로 로그인한 뒤 화면을 실제로 눌러 보는 테스트다. 테스트 러너는 Node 내장 `node:test`만 쓴다. 기준선(2026-10-14) 결과와 버그 목록은 `docs/update-2026-10/05_QA_기준선_리포트.md`에 있다.

## 먼저 알아 둘 것

- **실사용자 계정으로 돌리지 않는다.** 테스트는 로그인한 계정의 보드 데이터를 시드 백업으로 덮어쓴다.
- 데이터 변경은 전부 앱 화면(버튼·입력·'백업에서 복원')으로만 한다. Supabase에 직접 쓰지 않는다.
- 공용 '공고 제보' 표(`jobboard_shared_jobs`)로 가는 쓰기 요청은 `support.mjs`가 모든 테스트에서 막는다. 제보 폼은 검증까지만 확인한다.
- 테스트 파일은 **차례로 하나씩** 돈다(`--test-concurrency=1`). 같은 계정을 두 파일이 동시에 쓰면 서로 저장을 덮어써 결과가 엉킨다.
- 이름이 `[BUG-NN]`으로 시작하는 테스트는 기대 동작을 적은 것이다. 기준선에서는 앱 버그 때문에 실패하고, 고치면 통과해야 한다. 번호는 리포트의 버그 ID와 같다.

## 준비

1. Node 22 이상(테스트 파일을 glob으로 넘긴다. Node 20은 glob을 못 읽는다)과 저장소의 `node_modules`(Playwright 1.63, Chromium).
2. 저장소 폴더에서 정적 서버를 띄운다.

   ```sh
   python3 -m http.server 8787 --bind 127.0.0.1
   ```

3. QA 계정 파일(아래 형식)과 시드 백업(`seed-db.json`)을 같은 폴더에 둔다. 저장소에는 넣지 않는다.

   ```
   JOBBOARD_QA_EMAIL=...
   JOBBOARD_QA_PASSWORD=...
   ```

## 실행

```sh
# 전체
JOBBOARD_QA_ENV=/경로/qa-account.env JOBBOARD_E2E_OUT=/경로/baseline npm run test:e2e

# 파일 하나
JOBBOARD_QA_ENV=/경로/qa-account.env node --test --test-reporter=spec tests/e2e/list.test.mjs

# 이름으로 골라서
JOBBOARD_QA_ENV=/경로/qa-account.env node --test --test-name-pattern="BUG-06" tests/e2e/list.test.mjs
```

전체 실행은 부하가 낮은 기계에서 10분 안팎 걸린다.

## 환경변수

| 이름 | 쓰임 | 기본값 |
|---|---|---|
| `JOBBOARD_QA_ENV` | QA 계정 파일 경로. 시드·세션 파일도 이 폴더에서 찾는다 | 없음(필수, 또는 아래 두 변수) |
| `JOBBOARD_QA_EMAIL` / `JOBBOARD_QA_PASSWORD` | 계정 파일 대신 직접 넘길 때 | — |
| `JOBBOARD_QA_SEED` | 시드 백업 경로 | `JOBBOARD_QA_ENV` 폴더의 `seed-db.json` |
| `JOBBOARD_BASE_URL` | 앱 주소 | `http://127.0.0.1:8787` |
| `JOBBOARD_E2E_OUT` | 스크린샷·측정치·콘솔 기록을 남길 폴더 | OS 임시 폴더의 `jobboard-e2e` |
| `JOBBOARD_E2E_SESSION` | 로그인 세션을 잠깐 보관할 파일 | `JOBBOARD_QA_ENV` 폴더의 `.e2e-session.json` |
| `JOBBOARD_TOUCH_BASELINE_24` | 휴대폰에서 24px보다 작은 터치 타깃 수의 상한(넘으면 실패) | 0(검사 안 함) |

`JOBBOARD_PROMPT_VALUE`는 예전 `prompt()` 자동 응답용이다. 2026-10 업데이트(B20)로 앱은 `prompt()`·`confirm()`을 쓰지 않는다 — 할 일·행 추가·전형 직접 입력·전형 순서는 화면 안 입력칸(`form.inline-add[data-inl="todo|addrow|stage|flow|role"]`), 지우기·복원 확인은 `#confirmDlg`(`#confirmYes`·`#confirmNo`·`#confirmExtra`)다. `helpers.restore()`는 확인 창이 뜨면 `#confirmYes`를 누른다.

**여러 사람이 같은 폴더의 계정 파일로 돌릴 때**: 세션 파일 기본값이 계정 파일 폴더의 `.e2e-session.json` 하나라서, 30분 안에 다른 계정으로 돌리면 남의 세션을 다시 쓸 수 있다. 계정마다 `JOBBOARD_E2E_SESSION`을 따로 준다.

## 로그인 횟수

Supabase는 같은 주소에서 짧은 시간에 로그인을 많이 하면 막는다. 그래서 첫 파일이 로그인한 세션을 30분 동안 세션 파일에 두고 다음 파일이 다시 쓴다(각 파일은 그래도 `login()`을 거친다). 로그아웃 테스트는 같은 계정의 다른 세션 갱신도 끊으므로, 끝나면 세션 파일을 지워 다음 파일이 새로 로그인하게 한다.

## 결과물(`JOBBOARD_E2E_OUT`)

- `*.png` — 증거 스크린샷과, 실패한 테스트의 화면(`파일-fail-테스트이름.png`)
- `metrics-data.json` — 저장 데이터의 빈 기록 수·크기
- `metrics-perf.json` — 첫 화면 시간, `renderAll()` 소요 시간, 화면별 전송 크기(측정 때 load average 포함)
- `metrics-a11y.json` — 이름 없는 컨트롤, 터치 타깃 크기, 글자 대비
- `console/*.json` — 파일마다 콘솔 오류·HTTP 4xx/5xx·실패한 요청, `console-summary.json` — 모든 탭과 창을 돈 기록
- `tmp-*.json` — 테스트가 복원에 쓰려고 만든 임시 백업 파일

## 파일

| 파일 | 다루는 흐름 |
|---|---|
| `helpers.mjs` | 공용 도우미(launch·login·restore·tab·openMenu·shot). restore는 복원 확인 창(`#confirmDlg`)을 눌러 준다 |
| `support.mjs` | 세션 재사용, 공용 제보 쓰기 차단, 기록 남기기, 저장 대기(`waitForSync`), 내려받기 읽기 |
| `auth.test.mjs` | 틀린 비밀번호 문구, 로그인, 내 계정 창, 로그아웃 |
| `onboarding.test.mjs` | 첫 로그인 '내 조건' 창, 저장, Esc로 닫기 |
| `list.test.mjs` | 필터 칩, 검색, 정렬, 날짜 모드, 내 조건 적용/해제, 관심·지원 |
| `job-detail.test.mjs` | 공고 상세 창(레일·다가오는 일정에서 열기), 편집 전환, 상세에서 지원 |
| `custom-job.test.mjs` | 공고 직접 추가·필수값·편집·삭제, 공용 공고 편집 |
| `mine-table.test.mjs` | 내 지원 표: 상태·진행 단계·단계 고치기·결과 확인일·마감·메모·행 추가·CSV·검색·빼기 |
| `mine-card.test.mjs` | 내 지원 카드: 서류 결과 → 다음 전형 → 날짜 → 캘린더/플래너, 자소서 글자수, 자격요건, 지원 직무 |
| `calendar-planner.test.mjs` | 캘린더 월 이동·내 지원만·날짜 모드, 주간 플래너 할 일 |
| `archive.test.mjs` | 아카이브 4개 하위 탭 입력과 새로고침 뒤 유지 |
| `radar-match.test.mjs` | 채용 레이더 필터 칩, 매칭 아카이브 빈 상태·붙여넣기 |
| `status-paste.test.mjs` | 지원 현황표 붙여넣기(한 줄·표 형식) 미리보기·반영 |
| `menu-theme-help.test.mjs` | ⋯ 메뉴, 업데이트 기록, 도움말, 테마, 공고 제보 폼 검증 |
| `export-backup.test.mjs` | 일정 파일(.ics), 백업 받기, 복원 라운드트립, 잘못된 백업 |
| `mobile.test.mjs` | iPhone 14: 목록 카드화, 탭 줄 스크롤, 가로 넘침, 캘린더 목록 |
| `data-safety.test.mjs` | 두 창 동시 저장, 저장 전 이탈, 불러오기 실패(`#loadFail`·`#loadRetry`, 쓰기 0건), 새로고침 시 탭(주소 해시), 예상→실제 공고 옮기기, 저장 실패 → 다시 시도(`#saveState`) |
| `variants.test.mjs` | 실험 변형: 파라미터 없으면 변형 요소 0, `?v=b1` '오늘' 탭, `?v=b2` 담기·제출 분리, `?v=a`로 복귀 |
| `metrics-data.test.mjs` | 빈 기록 수·업로드 크기 측정 |
| `metrics-perf.test.mjs` | 첫 화면·`renderAll()`·전송 크기 측정 |
| `a11y.test.mjs` | 라벨·터치 타깃·글자 대비 |
| `console-errors.test.mjs` | 모든 탭·창을 돌며 콘솔 오류와 404 기록 |

## 시드에 대해

시드(`seed-db.json`)는 2026-10-12 공고 데이터의 공고 id를 가리킨다. 공고가 매일 갱신되면서 시드가 가리키는 공고(`shinhan-life`, `fin-public-b`, `wanted-384558`, `wanted-384515`, `kakao`, `kis`)가 데이터에서 빠지면 해당 테스트는 "시드 갱신 필요"로 실패한다. 이때는 앱 버그가 아니라 시드를 새 데이터로 다시 만들어야 한다. 날짜 기대값은 실행한 날(KST)을 기준으로 계산한다.
