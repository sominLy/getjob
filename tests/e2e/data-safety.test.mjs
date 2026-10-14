// 데이터 안전: 두 창 동시 사용 · 저장 전에 페이지를 떠날 때 · 불러오기 실패 · 새로고침 시 탭 · 예상→실제 공고 옮기기
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab, launch } from "./helpers.mjs";
import { open, openSecond, finish, getDb, guard, snap, closeAll, setPrompt, waitForSync, restoreSeed, reloadApp, BASE, seedDb } from "./support.mjs";

let S;
const g = guard(() => S.page, "data-safety");
before(async () => { S = await open({ seed: true, tag: "data-safety" }); }, { timeout: 120000 });
after(async () => { setPrompt(null); await finish(S); });

const allTodos = p => p.evaluate(() => Object.values(db.todos).flat().map(t => t.text));
async function addTodayTodo(p, text){
  await closeAll(p); await tab(p, "plan"); await p.click("#wToday");
  const synced = waitForSync(p, d => Object.values(d.todos).flat().some(t => t.text === text));
  await p.locator("#week .day.is-today .addtodo").click();
  const box = p.locator('#week .day.is-today form.inline-add[data-inl="todo"] input');
  await box.fill(text); await box.press("Enter");
  await synced;
}

test("[BUG-02] 같은 계정을 두 창에서 쓰면 나중 창은 먼저 저장한 내용을 덮지 않고 '다른 기기에서 바뀐 내용이 있어요'를 묻는다", { timeout: 120000 }, g(async () => {
  const B = await openSecond(S);              // 같은 계정, 다른 창(다른 기기와 같다)
  try{
    // B가 열리면서 저장한 것(예상→실제 옮기기 등)이 있으면 A가 옛 내용이 되므로, 두 창 모두 같은 서버 내용에서 출발하게 A를 새로 연다
    await B.page.waitForTimeout(1500); await reloadApp(S.page); await reloadApp(B.page);
    await addTodayTodo(S.page, "창A 할 일");      // A가 먼저 저장
    await addTodayTodo(B.page, "창B 할 일");      // B는 A의 변경을 모른 채 저장 → 조건부 저장이 0행
    await B.page.waitForSelector("#confirmDlg[open]", { timeout: 15000 });
    assert.equal(await B.page.textContent("#confirmDlg .confirm-msg"), "다른 기기에서 바뀐 내용이 있어요");
    assert.equal(await B.page.getAttribute("#saveState", "data-state"), "failed");
    await snap(B.page, "bug-two-tab-overwrite");
    await reloadApp(S.page);
    const texts = await allTodos(S.page);
    assert.ok(texts.includes("창A 할 일"), "먼저 저장한 A의 할 일이 서버에 남는다: " + JSON.stringify(texts));
    assert.ok(!texts.includes("창B 할 일"), "B는 묻기 전에 덮어쓰지 않는다");
    // B에서 '다른 기기 내용 불러오기' → B의 지금 내용은 백업 파일로 받고, A의 할 일이 보인다
    await Promise.all([B.page.waitForEvent("download", { timeout: 10000 }).catch(() => null), B.page.click("#confirmYes")]);
    await B.page.waitForFunction(() => Object.values(db.todos).flat().some(t => t.text === "창A 할 일"), null, { timeout: 15000 });
    await B.page.waitForSelector('#saveState[data-state="saved"]', { timeout: 10000 });
  } finally { await finish(B); }
}));

test("[BUG-03] 자소서 답안을 쓰다가 다른 곳을 누르지 않고 새로고침해도 쓴 내용이 남는다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await restoreSeed(p);
  const co = await p.evaluate(() => allJobs().find(j => j.id === "fin-public-b").company);
  await closeAll(p); await tab(p, "mine");
  const viewSaved = waitForSync(p, d => d.profile.mineView === "card");
  await p.click("#mvCard");
  await viewSaved;                             // 보기 전환 저장이 끝난 뒤부터는 다른 저장이 없다
  const card = p.locator("#apps .app").filter({ has: p.locator(".app-h .nm", { hasText: co }) });
  await card.locator("details.fold > summary", { hasText: "자소서" }).click();
  await card.locator(".essay textarea").first().fill("QA 새로고침 직전까지 쓴 답안");
  await p.waitForTimeout(1500);                // 디바운스(800ms)보다 넉넉히 기다려도
  await reloadApp(p);
  const a = await p.evaluate(() => db.apps["fin-public-b"].essays[0].a);
  const local = await p.evaluate(() => { try{ return JSON.parse(localStorage.getItem("jobboard-v2:" + currentUserId)).apps["fin-public-b"].essays[0].a; }catch{ return null; } });
  assert.equal(a, "QA 새로고침 직전까지 쓴 답안", `새로고침 뒤 1번 문항 답안: ${JSON.stringify(a)} (이 브라우저 localStorage: ${JSON.stringify(local)})`);
}));

test("[BUG-03] 관심(★)을 누르고 곧바로 새로고침해도 관심 표시가 남는다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  const before = new Set(Object.entries((await getDb(p)).apps).filter(([, a]) => a.starred).map(([id]) => id));
  await p.locator("#listBody tr").filter({ has: p.locator("td.act button", { hasText: /^☆ 관심$/ }) }).first().locator("td.act button", { hasText: "관심" }).click();
  const id = Object.entries((await getDb(p)).apps).filter(([, a]) => a.starred).map(([i]) => i).find(i => !before.has(i));
  await reloadApp(p);                           // 저장 디바운스(800ms)가 끝나기 전에 떠남
  const starred = await p.evaluate(id => !!(db.apps[id] && db.apps[id].starred), id);
  const local = await p.evaluate(id => { try{ return !!JSON.parse(localStorage.getItem("jobboard-v2:" + currentUserId)).apps[id].starred; }catch{ return null; } }, id);
  assert.equal(starred, true, `새로고침 뒤 관심 표시: ${starred} (이 브라우저 localStorage에는 ${local})`);
}));

test("[BUG-01] 내 데이터를 불러오지 못하면 빈 보드로 시작하지 않고, 다시 불러올 때까지 저장 요청을 보내지 않는다(B28)", { timeout: 90000 }, g(async () => {
  await restoreSeed(S.page);
  const writes = [];
  let failGet = true;
  // 같은 계정의 다른 창: 불러오기(GET)는 503으로 실패시키고, 쓰기 요청은 서버로 보내지 않고 기록만 한다
  const state = await S.ctx.storageState();
  state.origins = state.origins.map(o => ({ ...o, localStorage: o.localStorage.filter(x => x.name.startsWith("sb-")) }));
  const C = await launch({ context: { storageState: state } });
  Object.assign(C, { tag: "data-safety-loadfail", http: [], failed: [], dialogs: [], sharedWrites: [] });
  await C.ctx.route("**/rest/v1/jobboard_data**", route => {
    const r = route.request();
    if(r.method() === "GET") return failGet ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "QA 모의 장애" }) }) : route.continue();
    writes.push({ method: r.method(), applied: (() => { try{ return Object.values(r.postDataJSON().data.apps).filter(a => a.applied).length; }catch{ return null; } })() });
    return route.fulfill({ status: 201, body: "" });
  });
  try{
    await C.page.goto(BASE + "/?sales=1", { waitUntil: "domcontentloaded" });   // ?sales=1의 자동 저장 경로까지
    await C.page.waitForSelector("#loadFail:not([hidden])", { timeout: 30000 });
    await snap(C.page, "bug-load-fail-wipe");
    assert.equal(await C.page.isHidden("#appWrap"), true, "빈 보드를 그리지 않는다");
    assert.equal(await C.page.evaluate(() => document.getElementById("prefDlg").open), false, "첫 화면 '내 조건' 창이 뜨지 않는다");
    await C.page.click("#loadRetry");                                        // 아직 실패 중 — 그대로 멈춘다
    // supabase-js가 503을 몇 번 다시 시도한 뒤(약 7초) 실패로 돌아온다
    await C.page.waitForFunction(() => !document.getElementById("loadRetry").disabled, null, { timeout: 30000 });
    assert.equal(await C.page.isVisible("#loadFail"), true);
    assert.deepEqual(writes, [], "불러오기 실패 상태에서 나간 쓰기 요청(실제 서버로는 보내지 않음)");
    failGet = false;                                                             // 연결 복구 → 다시 시도
    await C.page.click("#loadRetry");
    await C.page.waitForSelector("#appWrap:not([hidden])", { timeout: 30000 });
    const applied = await C.page.evaluate(() => Object.values(db.apps).filter(a => a.applied).length);
    assert.equal(applied, Object.values(seedDb().apps).filter(a => a.applied).length, "다시 불러온 뒤에는 계정의 기록이 그대로");
    assert.ok(writes.every(w => w.applied === null || w.applied > 0), "복구 뒤 쓰기에 빈 보드가 없다: " + JSON.stringify(writes));
  } finally { await finish(C); }
}));

test("[BUG-17] 새로고침해도 보던 탭(캘린더)이 그대로 열린다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "cal");
  await reloadApp(p);
  const v = await p.getAttribute('nav.tabs button[aria-selected="true"]', "data-v");
  assert.equal(v, "cal", "새로고침 뒤 열린 탭: " + v + " (주소에도 탭 정보가 없음: " + new URL(p.url()).search + new URL(p.url()).hash + ")");
}));

test("[BUG-15] 예상 공고에 담아 둔 지원은 공고 목록(jobs.json)이 늦게 받아져도 실제 공고로 옮겨진다", { timeout: 120000 }, g(async () => {
  await restoreSeed(S.page);                   // 시드: 'kis'(예상, 실제 공고 jasoseol-106211이 나옴)에 지원해 둠
  const target = await S.page.evaluate(() => { const j = allJobs().find(x => x.id === "kis"); return j && j.doneBy; });
  assert.ok(target, "kis 공고의 doneBy가 없음 — 데이터가 바뀌었으면 시드 갱신 필요");
  const C = await open({ tag: "data-safety-migrate", routes: async s => {
    await s.ctx.route("**/data/jobs.json*", async route => { await new Promise(r => setTimeout(r, 2000)); await route.continue(); });   // 느린 휴대폰 망 흉내
  } });
  try{
    await C.page.waitForTimeout(1500);
    const st = await C.page.evaluate(t => ({ prediction: !!(db.apps.kis && db.apps.kis.applied), actual: !!(db.apps[t] && db.apps[t].applied) }), target);
    assert.deepEqual(st, { prediction: false, actual: true }, "jobs.json이 제보 목록보다 늦게 오면 옮기기를 건너뜀: " + JSON.stringify(st));
  } finally { await finish(C); await reloadApp(S.page); await restoreSeed(S.page); }   // C(다른 창)가 저장했으면 S는 옛 내용이라 새로 불러온 뒤 복원
}));

test("[BUG-09] 그룹 단위 예상(카카오그룹)에 담아 둔 지원이 이미 마감된 계열사 공고 한 곳으로 옮겨지지 않는다", { timeout: 120000 }, g(async () => {
  await restoreSeed(S.page);                   // 시드: '카카오그룹'(예상)에 9월 말 지원해 둠
  const info = await S.page.evaluate(() => { const j = allJobs().find(x => x.id === "kakao"), t = j && allJobs().find(x => x.id === j.doneBy); return j && t && { to: t.id, toCompany: t.company, toEnd: t.end, at: db.apps.kakao.at }; });
  assert.ok(info, "kakao 공고나 doneBy 대상이 데이터에 없음 — 시드 갱신 필요");
  // 제보 목록 응답을 늦춰 jobs.json이 먼저 오게 한다(로컬에서 흔한 순서) → 첫 renderAll에서 옮기기가 실행된다
  const C = await open({ tag: "data-safety-migrate-group", routes: async s => {
    await s.ctx.route("**/rest/v1/jobboard_shared_jobs**", async route => { await new Promise(r => setTimeout(r, 2500)); await route.fallback(); });
  } });
  try{
    await C.page.waitForTimeout(3500);
    const st = await C.page.evaluate(t => ({ group: !!(db.apps.kakao && db.apps.kakao.applied), affiliate: !!(db.apps[t] && db.apps[t].applied), note: (db.apps[t] || {}).note || "" }), info.to);
    assert.deepEqual({ group: st.group, affiliate: st.affiliate }, { group: true, affiliate: false },
      `${info.at}에 담은 '카카오그룹' 지원이 ${info.toEnd}에 마감된 '${info.toCompany}' 공고로 옮겨짐(메모: ${st.note})`);
  } finally { await finish(C); await reloadApp(S.page); await restoreSeed(S.page); }   // C(다른 창)가 저장했으면 S는 옛 내용이라 새로 불러온 뒤 복원
}));

test("저장이 막히면 한 번 다시 시도한 뒤 '저장 못 했어요 · 다시 시도'를 보이고, 연결이 돌아와 다시 시도하면 '저장됨'(B08)", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  let blocked = true, posts = 0;
  const handler = route => {
    if(!["POST", "PATCH"].includes(route.request().method())) return route.fallback();
    posts++;
    return blocked ? route.abort("internetdisconnected") : route.fallback();
  };
  await p.route("**/rest/v1/jobboard_data**", handler);
  try{
    await p.locator("#listBody tr").filter({ has: p.locator("td.act button", { hasText: /^☆ 관심$/ }) }).first().locator("td.act button", { hasText: "관심" }).click();
    await p.waitForSelector('#saveState[data-state="failed"]', { timeout: 20000 });
    assert.ok(posts >= 2, "실패 표시 전에 한 번 더 시도한다(요청 " + posts + "번)");
    assert.equal(await p.isVisible("#saveRetry"), true);
    assert.equal(await p.textContent("#saveState .save-t"), "저장 못 했어요");
    blocked = false;
    const synced = waitForSync(p);
    await p.click("#saveRetry");
    await synced;
    await p.waitForSelector('#saveState[data-state="saved"]', { timeout: 10000 });
    assert.equal(await p.isHidden("#saveRetry"), true);
  } finally { await p.unroute("**/rest/v1/jobboard_data**", handler); }
  // 원래대로(관심 끄기) — 저장이 끝날 때까지
  const back = waitForSync(p);
  await p.locator("#listBody tr").filter({ has: p.locator("td.act button.on", { hasText: "★ 관심" }) }).first().locator("td.act button", { hasText: "관심" }).click();
  await back;
}));
