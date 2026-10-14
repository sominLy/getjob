// 캘린더(월 이동 · 내 지원만 · 날짜 모드 · 일정 누르기) · 주간 플래너(주 이동 · 할 일 추가/완료/삭제)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, setPrompt, todayKST, seedDb, addDays } from "./support.mjs";

let S;
const g = guard(() => S.page, "cal-plan");
before(async () => { S = await open({ seed: true, tag: "calendar-planner" }); }, { timeout: 120000 });
after(async () => { setPrompt(null); await finish(S); });

const ym = iso => Number(iso.slice(0, 4)) + "년 " + Number(iso.slice(5, 7)) + "월";
const monday = iso => { const d = new Date(iso + "T00:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const md = iso => Number(iso.slice(5, 7)) + "/" + Number(iso.slice(8, 10));
async function cal(p){ await closeAll(p); await tab(p, "cal"); }

test("캘린더는 이번 달로 열리고 › ‹ 로 달이 바뀐다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cal(p);
  const now = todayKST();
  assert.equal(await p.textContent("#mLbl"), ym(now));
  assert.equal(await p.locator(".cal-grid .cell").count(), 42);
  assert.equal(await p.locator(".cal-grid .cell.is-today").count(), 1);
  await p.click("#mNext");
  const next = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7), 1)).toISOString().slice(0, 10);
  assert.equal(await p.textContent("#mLbl"), ym(next));
  await p.click("#mPrev"); await p.click("#mPrev");
  const prev = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  assert.equal(await p.textContent("#mLbl"), ym(prev));
  await p.click("#mNext");
  assert.equal(await p.textContent("#mLbl"), ym(now));
}));

test("'내 지원만'을 누르면 내가 지원한 공고 일정만 남고, 다시 누르면 전체로 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cal(p);
  const all = await p.locator(".cal-grid .ev").count();
  await p.click("#mineBtn");
  assert.equal(await p.getAttribute("#mineBtn", "aria-pressed"), "true");
  const cls = await p.$$eval(".cal-grid .ev", es => es.map(e => e.classList.contains("mine")));
  assert.ok(cls.length > 0 && cls.length < all, `전체 ${all} → 내 지원만 ${cls.length}`);
  assert.ok(cls.every(Boolean), "내 지원이 아닌 일정이 남음");
  await snap(p, "calendar-mine-only");
  await p.click("#mineBtn");
  assert.equal(await p.getAttribute("#mineBtn", "aria-pressed"), "false");
  assert.equal(await p.locator(".cal-grid .ev").count(), all);
}));

test("캘린더 날짜 모드를 '마감만'으로 바꾸면 접수 시작 일정이 빠진다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cal(p);
  assert.ok(await p.locator(".cal-grid .ev-start").count() > 0, "이번 달에 접수 시작 일정이 있어야 의미가 있다");
  await p.click("#calDateModeBtn");
  assert.equal(await p.textContent("#calDateModeBtn"), "마감일만 보기");
  assert.equal(await p.locator(".cal-grid .ev-start").count(), 0);
  assert.ok(await p.locator(".cal-grid .ev-end").count() > 0);
  await p.click("#calDateModeBtn"); await p.click("#calDateModeBtn");
  assert.equal(await p.textContent("#calDateModeBtn"), "시작일·마감일 모두 보기");
}));

test("캘린더 일정을 누르면 그 공고 상세 창이 열린다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cal(p);
  const ev = p.locator(".cal-grid .ev.mine").first();
  const co = await ev.evaluate(e => e.lastChild.textContent);
  await ev.click();
  await p.waitForSelector("#jobDlg[open]");
  assert.equal(await p.evaluate(() => document.getElementById("jdCompany").firstChild.textContent), co);
  await p.click("#jdClose");
}));

/* ---------- 주간 플래너 ---------- */
const SEED_DAY = Object.keys(seedDb().todos).sort()[0];      // 시드 할 일이 있는 첫 날
async function planWeekOf(p, iso){
  await closeAll(p); await tab(p, "plan"); await p.click("#wToday");
  const weeks = Math.round((Date.parse(monday(iso)) - Date.parse(monday(todayKST()))) / (7 * 864e5));
  for(let i = 0; i < Math.abs(weeks); i++) await p.click(weeks > 0 ? "#wNext" : "#wPrev");
}
const dayCol = (p, iso) => p.locator("#week .day").nth((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7);

test("주간 플래너는 이번 주(월~일)로 열리고 ›·‹·'이번 주'로 주를 옮긴다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "plan"); await p.click("#wToday");
  const m = monday(todayKST());
  assert.equal(await p.textContent("#wLbl"), md(m) + " – " + md(addDays(m, 6)));
  assert.equal(await p.locator("#week .day").count(), 7);
  assert.equal(await p.locator("#week .day.is-today").count(), 1);
  await p.click("#wNext");
  assert.equal(await p.textContent("#wLbl"), md(addDays(m, 7)) + " – " + md(addDays(m, 13)));
  await p.click("#wToday");
  assert.equal(await p.textContent("#wLbl"), md(m) + " – " + md(addDays(m, 6)));
}));

test("시드의 할 일이 그 날짜 칸에 보이고 완료한 것은 완료로 표시된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await planWeekOf(p, SEED_DAY);
  const col = dayCol(p, SEED_DAY);
  const want = seedDb().todos[SEED_DAY];
  assert.deepEqual(await col.locator(".todo span").allTextContents(), want.map(t => t.text));
  assert.deepEqual(await col.locator(".todo").evaluateAll(rs => rs.map(r => r.classList.contains("done"))), want.map(t => !!t.done));
}));

test("'+ 할 일'에 쓰면 그날 할 일로 추가된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await planWeekOf(p, SEED_DAY);
  await dayCol(p, SEED_DAY).locator(".addtodo").click();
  const box = dayCol(p, SEED_DAY).locator('form.inline-add[data-inl="todo"] input');
  await box.fill("QA 플래너 할 일");
  await box.press("Enter");
  await p.waitForFunction(d => (db.todos[d] || []).some(t => t.text === "QA 플래너 할 일"), SEED_DAY);
  assert.ok((await dayCol(p, SEED_DAY).locator(".todo span").allTextContents()).includes("QA 플래너 할 일"));
  // 연달아 적을 수 있게 입력칸이 열린 채 비워지고, Esc로 닫으면 '+ 할 일' 버튼으로 돌아간다(B20 · UX B-4-a)
  const again = dayCol(p, SEED_DAY).locator('form.inline-add[data-inl="todo"] input');
  assert.equal(await again.inputValue(), "");
  await again.press("Escape");
  assert.equal(await dayCol(p, SEED_DAY).locator(".addtodo").count(), 1);
}));

test("할 일을 체크하면 완료로 바뀌어 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await planWeekOf(p, SEED_DAY);
  await dayCol(p, SEED_DAY).locator('input[aria-label="QA 플래너 할 일"]').check();
  await p.waitForFunction(d => db.todos[d].find(t => t.text === "QA 플래너 할 일").done === true, SEED_DAY);
  assert.equal(await dayCol(p, SEED_DAY).locator(".todo.done span", { hasText: "QA 플래너 할 일" }).count(), 1);
}));

test("할 일의 ×를 누르면 지워진다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await planWeekOf(p, SEED_DAY);
  const row = dayCol(p, SEED_DAY).locator(".todo", { hasText: "QA 플래너 할 일" });
  await row.locator('button[aria-label="할 일 삭제"]').click();
  await p.waitForFunction(d => !(db.todos[d] || []).some(t => t.text === "QA 플래너 할 일"), SEED_DAY);
  assert.equal(await dayCol(p, SEED_DAY).locator(".todo", { hasText: "QA 플래너 할 일" }).count(), 0);
}));
