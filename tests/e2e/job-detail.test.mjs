// 공고 상세 창: 레일 칩·다가오는 일정에서 열기 · 편집 전환 · 상세에서 지원하기
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, todayKST } from "./support.mjs";

let S;
const g = guard(() => S.page, "detail");
before(async () => { S = await open({ seed: true, tag: "job-detail" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const heading = p => p.evaluate(() => document.getElementById("jdCompany").firstChild.textContent);
const isOpen = (p, id) => p.evaluate(id => document.getElementById(id).open, id);

test("레일의 D-day 칩을 누르면 그 회사의 공고 상세 창이 열린다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const chip = p.locator("#rail .dchip").first();
  const co = await chip.locator(".c").textContent();
  await chip.click();
  await p.waitForSelector("#jobDlg[open]");
  assert.equal(await heading(p), co);
  const facts = await p.$$eval("#jdFacts dt", x => x.map(d => d.textContent));
  assert.ok(facts.includes("접수 마감"), "사실 목록: " + facts.join(","));
  await p.waitForFunction(() => DETAILS !== null, null, { timeout: 30000 });   // 본문(details.json)은 처음 열 때 받는다
  await snap(p, "detail-from-rail");
  await p.click("#jdClose");
  assert.equal(await isOpen(p, "jobDlg"), false);
}));

test("내 지원 카드 보기의 '다가오는 일정' 줄을 누르면 그 공고 상세 창이 열린다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await tab(p, "mine"); await p.click("#mvCard");
  const row = p.locator(".ddb-list .dd").first();
  const co = await row.locator(".dd-co").evaluate(el => el.firstChild.textContent);
  await row.locator(".dd-w").click();
  await p.waitForSelector("#jobDlg[open]");
  assert.equal(await heading(p), co);
  await p.click("#jdClose");
  await p.click("#mvTable");
}));

test("상세 창의 '편집'을 누르면 상세 창이 닫히고 같은 공고의 편집 폼이 열린다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  const chip = p.locator("#rail .dchip").first();
  const co = await chip.locator(".c").textContent();
  await chip.click();
  await p.waitForSelector("#jobDlg[open]");
  await p.click("#jdEdit");
  await p.waitForSelector("#dlg[open]");
  assert.equal(await isOpen(p, "jobDlg"), false);
  assert.equal(await p.inputValue('#form [name="company"]'), co);
  assert.equal(await p.textContent("#dlgTitle"), co);
  await p.click("#cancelBtn");
  assert.equal(await isOpen(p, "dlg"), false);
}));

async function openUnapplied(p){
  await closeAll(p); await tab(p, "list");
  const chip = p.locator("#rail .dchip.dim").first();
  const co = await chip.locator(".c").textContent();
  await chip.click();
  await p.waitForSelector("#jobDlg[open]");
  const id = await p.evaluate(() => jdId);
  return { co, id };
}

test("상세 창에서 '내 지원에 담기'를 누르면 담기고 버튼이 '내 지원에서 빼기'로 바뀐다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const { co, id } = await openUnapplied(p);
  assert.equal(await p.textContent("#jdApply"), "내 지원에 담기");
  const errs = S.consoleErrors.length;
  await p.click("#jdApply");
  await p.waitForFunction(() => document.getElementById("jdApply").textContent === "내 지원에서 빼기");
  assert.equal((await getDb(p)).apps[id].applied, true);
  assert.equal(await p.textContent("#toast .toast-msg"), co + " · 내 지원에 담았어요");
  assert.equal(await isOpen(p, "jobDlg"), true, "상세 창은 열린 채로 남는다");
  assert.deepEqual(S.consoleErrors.slice(errs), [], "다시 그리면서 오류가 나면 안 된다");
  await p.click("#jdApply");
  await p.waitForFunction(() => document.getElementById("jdApply").textContent === "내 지원에 담기");
  assert.equal((await getDb(p)).apps[id].applied, false);
  assert.equal(await p.textContent("#toast .toast-msg"), co + " · 내 지원에서 뺐어요");
  await p.click("#jdClose");
}));

test("[BUG-23] 상세 창에서 지원해도 '담은 날'이 오늘로 기록된다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const { id } = await openUnapplied(p);
  await p.click("#jdApply");
  await p.waitForFunction(() => document.getElementById("jdApply").textContent === "내 지원에서 빼기");
  const at = (await getDb(p)).apps[id].at;
  await p.click("#jdApply"); await p.click("#jdClose");
  assert.equal(at, todayKST(), "목록의 '지원' 버튼은 담은 날을 남기는데 상세 창의 '지원하기'는 비워 둠: " + JSON.stringify(at));
}));
