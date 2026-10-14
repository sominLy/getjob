// 실험 변형(03 문서): 파라미터 없으면 현행(A)과 같고, ?v=b1이면 '오늘' 탭, ?v=b2면 담기·제출 분리
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, restoreSeed, ready, BASE } from "./support.mjs";

let S;
const g = guard(() => S.page, "variants");
before(async () => { S = await open({ seed: true, tag: "variants" }); }, { timeout: 120000 });
after(async () => { try{ await go(S.page, "a"); await restoreSeed(S.page); }catch{} await finish(S); });

async function go(p, v, hash = ""){ await p.goto(BASE + "/?v=" + v + hash, { waitUntil: "domcontentloaded" }); await ready(p); await p.waitForTimeout(300); }

test("파라미터가 없으면 변형 요소가 하나도 보이지 않는다(02 문서 R5)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  assert.equal(await p.getAttribute("html", "data-variant"), "a");
  assert.equal(await p.isHidden('nav.tabs button[data-v="today"]'), true, "'오늘' 탭 없음");
  assert.equal(await p.isHidden("#v-today"), true);
  assert.equal(await p.isVisible("#rail"), true, "D-day 줄은 그대로");
  await tab(p, "mine"); await p.click("#mvTable");
  assert.equal(await p.locator(".sent-btn").count(), 0, "[제출했어요] 없음");
  assert.deepEqual(await p.$$eval(".tb-tile span", s => s.map(x => x.textContent)).then(l => l.includes("제출 전")), false);
  await closeAll(p); await tab(p, "list");
}));

test("?v=b1이면 '오늘' 탭이 맨 앞에 생겨 처음부터 열리고, 레일은 숨는다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await go(p, "b1");
  assert.equal(await p.getAttribute("html", "data-variant"), "b1");
  const first = await p.$eval("nav.tabs button:not([hidden])", b => b.dataset.v);
  assert.equal(first, "today");
  assert.equal(await p.getAttribute('nav.tabs button[data-v="today"]', "aria-selected"), "true");
  assert.equal(await p.isVisible("#v-today"), true);
  assert.equal(await p.isHidden("#rail"), true);
  assert.deepEqual(await p.$$eval("#todayBody .today-block h3", hs => hs.map(h => h.textContent)),
    ["내 일정", "결과 확인 필요", "이번 주 전형", "오늘 할 일", "새로 뜬 공고 · 최근 3일"]);
  await snap(p, "variant-b1-today", true);
}));

test("b1 '결과 확인 필요'의 [서류 합격]은 표의 상태 바꾸기와 같게 기록하고 [되돌리기]로 돌아온다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const btn = p.locator("#todayBody .today-block").filter({ has: p.locator("h3", { hasText: "결과 확인 필요" }) }).locator(".dd-act button").first();
  if(!(await btn.count())){ assert.ok(true, "시드에 확인 필요 공고가 없음"); return; }
  const label = await btn.getAttribute("aria-label");
  const co = label.replace(/ (서류|.+) 합격으로 기록$/, "");
  const id = await p.evaluate(co => allJobs().find(j => j.company === co).id, co);
  await btn.click();
  assert.equal((await getDb(p)).apps[id].doc, "합격");
  assert.match(await p.textContent("#toast .toast-msg"), /합격으로 적었어요$/);
  await p.click("#toast .toast-act");
  await p.waitForFunction(id => db.apps[id].doc === "대기", id);
}));

test("?v=b2이면 새로 담은 공고는 '제출 전'으로 시작하고 [제출했어요]를 누르면 '결과 대기'로 간다. 기존 기록은 그대로 해석", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await go(p, "b2", "#/jobs");
  assert.equal(await p.getAttribute("html", "data-variant"), "b2");
  assert.equal(await p.isHidden('nav.tabs button[data-v="today"]'), true, "b2에는 '오늘' 탭이 없다");
  const before = await getDb(p);
  const row = p.locator("#listBody tr").filter({ has: p.locator("td.act button", { hasText: /^담기$/ }) }).filter({ hasNot: p.locator("td.dt-end", { hasText: "상시·수시" }) }).first();
  const co = await row.locator("td.co").evaluate(td => td.firstChild.textContent);
  await row.locator("td.act button", { hasText: /^담기$/ }).click();
  const id = Object.entries((await getDb(p)).apps).find(([i, a]) => a.applied && !(before.apps[i] && before.apps[i].applied))[0];
  assert.equal((await getDb(p)).apps[id].sent, false);
  await tab(p, "mine"); await p.click("#mvTable");
  assert.ok((await p.$$eval(".tb-tile span", s => s.map(x => x.textContent))).includes("제출 전"));
  const tr = p.locator(`select[aria-label="${co} 상태"]`).locator("xpath=ancestor::tr");
  assert.equal(await tr.getAttribute("class"), "s-제출전");
  // 시드 기록(sent 없음)은 '제출 전'으로 보이지 않는다(03 문서 3.4 가드레일)
  const seededPre = await p.evaluate(ids => ids.filter(i => statusOf(db.apps[i], allJobs().find(j => j.id === i) || {}) === "제출전").length, Object.keys(before.apps).filter(i => before.apps[i].applied));
  assert.equal(seededPre, 0);
  await tr.locator(".sent-btn").click();
  await p.waitForFunction(id => db.apps[id].sent === true && !!db.apps[id].sentAt, id);
  assert.equal(await p.locator(`select[aria-label="${co} 상태"]`).locator("xpath=ancestor::tr").getAttribute("class"), "s-대기");
  assert.match(await p.textContent("#toast .toast-msg"), /제출했다고 적었어요$/);
  await snap(p, "variant-b2-mine", true);
}));

test("?v=a로 열면 현행으로 돌아온다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await go(p, "a");
  assert.equal(await p.getAttribute("html", "data-variant"), "a");
  assert.equal(await p.isHidden('nav.tabs button[data-v="today"]'), true);
  assert.equal(await p.isVisible("#rail"), true);
}));
