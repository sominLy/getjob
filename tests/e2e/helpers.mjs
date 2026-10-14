// 지원보드 E2E 공용 도우미. 로컬 정적 서버(기본 http://127.0.0.1:8787)와 QA 전용 계정으로 돈다.
// 계정 정보는 환경변수 JOBBOARD_QA_EMAIL / JOBBOARD_QA_PASSWORD 또는 JOBBOARD_QA_ENV(=key=value 파일 경로)에서 읽는다.
// 실제 사용자 계정으로는 절대 돌리지 않는다 — 테스트가 데이터를 덮어쓴다.
import { chromium, devices } from "playwright";
import { readFileSync, existsSync } from "node:fs";

export const BASE = process.env.JOBBOARD_BASE_URL || "http://127.0.0.1:8787";

export function creds(){
  let email = process.env.JOBBOARD_QA_EMAIL, password = process.env.JOBBOARD_QA_PASSWORD;
  const envPath = process.env.JOBBOARD_QA_ENV;
  if((!email || !password) && envPath && existsSync(envPath)){
    for(const line of readFileSync(envPath, "utf8").split("\n")){
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(!m) continue;
      if(m[1] === "JOBBOARD_QA_EMAIL") email = m[2];
      if(m[1] === "JOBBOARD_QA_PASSWORD") password = m[2];
    }
  }
  if(!email || !password) throw new Error("QA 계정이 없습니다. JOBBOARD_QA_EMAIL/JOBBOARD_QA_PASSWORD 또는 JOBBOARD_QA_ENV를 주세요.");
  return { email, password };
}

/** 브라우저+컨텍스트+페이지. opts.mobile=true면 iPhone 14 크기, opts.dark=true면 어두운 화면. */
export async function launch(opts = {}){
  const browser = await chromium.launch({ headless: opts.headless !== false });
  const base = opts.mobile
    ? { ...devices["iPhone 14"] }
    : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({
    ...base,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: opts.dark ? "dark" : "light",
    ...(opts.context || {}),
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if(m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
  // 앱이 confirm()/prompt()를 쓴다. 기본은 수락(prompt에는 기본값 "테스트 입력").
  page.on("dialog", d => d.type() === "prompt" ? d.accept(process.env.JOBBOARD_PROMPT_VALUE || "테스트 입력") : d.accept());
  return { browser, ctx, page, consoleErrors };
}

/** 로그인해서 공고 목록이 그려질 때까지 기다린다. 첫 로그인의 '내 조건' 다이얼로그는 닫는다. */
export async function login(page, c = creds()){
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#authScreen:not([hidden]), #appWrap:not([hidden])", { timeout: 20000 });
  if(await page.isVisible("#authScreen")){
    await page.fill("#authEmail", c.email);
    await page.fill("#authPw", c.password);
    await page.click("#authSubmit");
  }
  await page.waitForSelector("#appWrap:not([hidden])", { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll("#listBody tr").length > 0, null, { timeout: 30000 });
  const pref = page.locator("#prefDlg[open]");
  if(await pref.count()) await page.click("#prefDone");
}

/** 백업 파일(JSON)로 보드를 통째로 바꾼다 — 앱의 '백업에서 복원' 기능을 그대로 쓴다. */
export async function restore(page, seedPath){
  await page.setInputFiles("#fileIn", seedPath);
  // 앱이 확인 창(#confirmDlg, '백업 파일 내용으로 바꿀까요?')을 띄우면 '바꾸기'를 누른다. 형식이 틀린 파일이면 창 없이 토스트만 뜬다
  await page.waitForSelector("#confirmDlg[open], .toast.on", { timeout: 10000 });
  if(await page.locator("#confirmDlg[open]").count()) await page.click("#confirmYes");
  await page.waitForSelector(".toast.on", { timeout: 10000 });
  await page.waitForTimeout(1200); // 저장 디바운스(800ms) 후 동기화까지
}

export async function tab(page, v, mode){
  const sel = mode ? `nav.tabs button[data-mode="${mode}"]` : `nav.tabs button[data-v="${v}"]`;
  await page.click(sel);
  await page.waitForTimeout(250);
}

export async function openMenu(page){
  if(await page.isHidden("#menuPop")) await page.click("#menuBtn");
}

/** 전체 페이지 스크린샷(파일명만 주면 out 폴더에 저장) */
export async function shot(page, out, name, full = true){
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage: full });
  return path;
}
