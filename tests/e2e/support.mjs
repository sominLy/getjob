// 지원보드 E2E 테스트 준비물 — helpers.mjs(launch/login/restore/tab/openMenu/shot) 위에 얹는 공용 함수.
// - 로그인 세션을 잠깐 재사용해 Supabase 로그인 횟수 제한(분당·5분당)에 걸리지 않게 한다.
// - 공용 '공고 제보' 표(jobboard_shared_jobs)로 가는 쓰기 요청은 전부 막는다(실수로라도 올라가지 않게).
// - 콘솔 오류·HTTP 4xx/5xx·실패한 요청을 파일별로 모아 OUT/console/에 남긴다.
import { launch, login, restore, shot, BASE } from "./helpers.mjs";
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export { BASE };
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../..");
const QA_DIR = process.env.JOBBOARD_QA_ENV ? dirname(process.env.JOBBOARD_QA_ENV) : "";
/** 시드 백업(앱의 '백업에서 복원'으로 넣는다) */
export const SEED_PATH = process.env.JOBBOARD_QA_SEED || (QA_DIR ? join(QA_DIR, "seed-db.json") : "");
/** 스크린샷·측정치·콘솔 기록을 남길 폴더 */
export const OUT = process.env.JOBBOARD_E2E_OUT || join(os.tmpdir(), "jobboard-e2e");
const SESSION = process.env.JOBBOARD_E2E_SESSION || join(QA_DIR || os.tmpdir(), ".e2e-session.json");
const SESSION_MAX_AGE = 30 * 60 * 1000;   // 액세스 토큰(1시간)이 넉넉히 남아 있는 동안만 재사용
mkdirSync(join(OUT, "console"), { recursive: true });

export const readJson = p => JSON.parse(readFileSync(p, "utf8"));
export const seedDb = () => readJson(SEED_PATH);
export const jobsData = () => readJson(join(REPO, "data/jobs.json"));

/** 한국 시간 기준 오늘(YYYY-MM-DD) */
export function todayKST(offsetDays = 0){
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}
export const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function freshSession(){
  try{ return Date.now() - statSync(SESSION).mtimeMs < SESSION_MAX_AGE ? SESSION : undefined; }catch{ return undefined; }
}
/** 로그아웃 테스트 뒤에는 세션 파일을 지워 다음 파일이 새로 로그인하게 한다 */
export function dropSession(){ try{ rmSync(SESSION); }catch{} }

/**
 * 브라우저를 띄우고 로그인한다. opts: {mobile, dark, seed(true면 시드 복원), fresh(true면 저장 세션 안 씀), tag(기록 파일 이름)}
 * 반환: helpers.launch 결과 + {http, failed, dialogs, sharedWrites, tag, loginMs}
 */
export async function open(opts = {}){
  const cached = opts.fresh ? undefined : freshSession();
  const s = await launch({ ...opts, context: { ...(opts.context || {}), ...(cached ? { storageState: cached } : {}) } });
  s.tag = opts.tag || "run";
  await wire(s);
  if(opts.routes) await opts.routes(s);
  const t0 = Date.now();
  await login(s.page);
  await ready(s.page);
  s.loginMs = Date.now() - t0;
  if(!cached && !opts.noSaveSession) await keepSession(s.ctx);
  if(opts.seed) await restoreSeed(s.page);
  return s;
}
/** 같은 계정으로 두 번째 창(다른 기기·탭 흉내)을 연다 */
export async function openSecond(first, opts = {}){
  const state = await first.ctx.storageState();
  state.origins = state.origins.map(o => ({ ...o, localStorage: o.localStorage.filter(x => x.name.startsWith("sb-")) }));
  const s = await launch({ ...opts, context: { storageState: state } });
  s.tag = (first.tag || "run") + "-2";
  await wire(s);
  await login(s.page);
  await ready(s.page);
  return s;
}
async function keepSession(ctx){
  const st = await ctx.storageState();
  st.origins = st.origins.map(o => ({ ...o, localStorage: o.localStorage.filter(x => x.name.startsWith("sb-")) }))
    .filter(o => o.localStorage.length);
  if(st.origins.length) writeFileSync(SESSION, JSON.stringify(st));
}
async function wire(s){
  s.http = []; s.failed = []; s.dialogs = []; s.sharedWrites = [];
  s.page.on("response", r => { if(r.status() >= 400) s.http.push({ status: r.status(), method: r.request().method(), url: r.url().split("?")[0] }); });
  s.page.on("requestfailed", r => s.failed.push({ url: r.url().split("?")[0], error: (r.failure() || {}).errorText }));
  s.page.on("dialog", d => s.dialogs.push({ type: d.type(), message: d.message() }));   // 응답은 helpers.launch가 한다
  // 공용 제보 표에는 절대 쓰지 않는다(GET만 통과)
  await s.ctx.route("**/rest/v1/jobboard_shared_jobs**", route => {
    const m = route.request().method();
    if(m === "GET" || m === "HEAD") return route.continue();
    s.sharedWrites.push({ method: m, url: route.request().url() });
    return route.abort();
  });
}
/** 파일 끝에 콘솔 오류·HTTP 오류를 남기고 브라우저를 닫는다 */
export async function finish(s){
  if(!s) return;
  try{
    writeFileSync(join(OUT, "console", s.tag + ".json"), JSON.stringify({
      consoleErrors: s.consoleErrors, http: s.http, failed: s.failed, dialogs: s.dialogs.length, sharedWrites: s.sharedWrites }, null, 1));
  }catch{}
  await s.browser.close().catch(() => {});
}

/** 앱이 Supabase에 전체 db를 올리는 요청(디바운스 800ms 뒤)이 끝날 때까지.
 *  pred(data)를 주면 올린 db가 그 조건을 만족하는 요청만 기다린다(앞서 날아간 다른 저장과 헷갈리지 않게). */
export function waitForSync(page, pred, timeout = 15000){
  return page.waitForResponse(r => {
    /* 저장은 조건부 update(PATCH)이고, 첫 생성·폴백은 POST다 */
    if(!r.url().includes("/rest/v1/jobboard_data") || !["POST", "PATCH"].includes(r.request().method())) return false;
    if(!pred) return true;
    try{ return !!pred(r.request().postDataJSON().data); }catch{ return false; }
  }, { timeout });
}
/** 공고 목록(data/jobs.json)까지 받아 첫 화면이 다 그려질 때까지. 빈 목록 안내 줄 하나만 있는 순간은 준비 전이다 */
export async function ready(page){
  await page.waitForSelector("#appWrap:not([hidden])", { timeout: 30000 });
  await page.waitForFunction(() => typeof SEED !== "undefined" && SEED.length > 0 && document.querySelectorAll("#listBody tr").length > 0, null, { timeout: 30000 });
}
/** 새로고침하고 첫 화면이 다 그려질 때까지 */
export async function reloadApp(page){
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
}
/** 시드 백업을 앱의 '백업에서 복원'으로 넣고 서버 저장까지 기다린다 */
export async function restoreSeed(page, path = SEED_PATH){
  const want = readJson(path);
  const synced = waitForSync(page, d => Object.keys(d.todos || {}).join() === Object.keys(want.todos || {}).join() && d.profile.onboarded === want.profile.onboarded &&
    Object.entries(want.apps).every(([id, a]) => d.apps[id] && d.apps[id].applied === a.applied));
  await restore(page, path);
  await page.waitForFunction(() => document.getElementById("toast").textContent === "백업 파일 내용으로 바꿨어요", null, { timeout: 5000 });
  await synced;
}
/** 열린 다이얼로그·메뉴·도움말을 모두 닫는다(테스트 사이 정리) */
export async function closeAll(page){
  await page.evaluate(() => {
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    const m = document.getElementById("menuPop"); if(m && !m.hidden){ m.hidden = true; document.getElementById("menuBtn").setAttribute("aria-expanded", "false"); }
    const h = document.getElementById("help"); if(h && !h.hidden) document.getElementById("helpClose").click();
  });
}
/** 앱 메모리의 db 사본 */
export const getDb = page => page.evaluate(() => JSON.parse(JSON.stringify(db)));
/** id → 공고 */
export const jobOf = (page, id) => page.evaluate(id => { const j = allJobs().find(x => x.id === id); return j ? JSON.parse(JSON.stringify(j)) : null; }, id);
/** prompt()에 넣을 값 — helpers.launch의 dialog 처리기가 이 환경변수를 읽는다 */
export function setPrompt(v){ if(v == null) delete process.env.JOBBOARD_PROMPT_VALUE; else process.env.JOBBOARD_PROMPT_VALUE = v; }
/** 버튼을 눌러 내려받은 파일의 글자 */
export async function downloadText(page, trigger){
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), trigger()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(p, "utf8"), failure: await dl.failure() };
}
/** 증거 스크린샷 */
export function snap(page, name, full = false){
  mkdirSync(OUT, { recursive: true });
  return shot(page, OUT, name, full);
}
/** 실패하면 화면을 남기는 테스트 본문 감싸개 */
export function guard(getPage, prefix){
  return fn => async t => {
    try{ await fn(t); }
    catch(err){
      const name = prefix + "-fail-" + t.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60);
      try{ await snap(getPage(), name, false); }catch{}
      throw err;
    }
  };
}
/** 저장 기록이 '빈 기록'인가 — 지원·관심도 아니고 적은 내용도 없는 것 */
export function isEmptyRecord(a){
  if(!a || a.applied || a.starred) return false;
  const blank = v => v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length);
  if((a.doc || "대기") !== "대기") return false;
  for(const k of ["note", "cover", "resume", "folio", "myEnd", "at", "role", "req", "pref", "myEndTime", "resultAt", "check", "skip", "flow", "ovr"]) if(!blank(a[k])) return false;
  if((a.stages || []).length || (a.essays || []).length) return false;
  if(a.submit && Object.values(a.submit).some(Boolean)) return false;
  return true;
}
