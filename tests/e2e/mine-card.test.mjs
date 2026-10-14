// 내 지원 — 카드 보기: 현황판 · 서류 결과 → 다음 전형 → 날짜 → 캘린더/플래너 반영 · 자소서 문항·글자수 · 자격요건 · 지원 직무
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, todayKST, addDays } from "./support.mjs";

let S, T;
const g = guard(() => S.page, "mine-card");
before(async () => {
  S = await open({ seed: true, tag: "mine-card" });
  T = await S.page.evaluate(() => { const j = allJobs().find(x => x.id === "shinhan-life"); return j && { id: j.id, co: j.company, end: j.end, roles: j.roles }; });
  assert.ok(T, "시드가 참조하는 shinhan-life 공고가 데이터에 없음 — 시드 갱신 필요");
}, { timeout: 120000 });
after(async () => { await finish(S); });

const card = p => p.locator("#apps .app").filter({ has: p.locator(".app-h .nm", { hasText: T.co }) });
async function cards(p){ await closeAll(p); await tab(p, "mine"); await p.click("#mvCard"); await card(p).waitFor(); }
async function openFold(p, label){
  const sum = card(p).locator("details.fold > summary", { hasText: label });
  if(!(await sum.evaluate(s => s.parentElement.open))) await sum.click();
}
const STAGE_DATE = addDays(todayKST(), 6);

test("카드 보기는 담은 공고마다 카드 한 장과 '지원 현황'·'다가오는 일정' 판을 보여 준다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  const d = await getDb(p);
  const mine = await p.evaluate(() => allJobs().filter(j => db.apps[j.id] && db.apps[j.id].applied).map(j => ({ id: j.id, end: j.end })));
  assert.equal(await p.locator("#apps .app").count(), mine.length);
  assert.deepEqual(await p.$$eval("#apps .ddb h3", hs => hs.map(h => h.textContent)), ["지원 현황", "다가오는 일정"]);
  const tileAll = p.locator(".tb-tile", { has: p.locator("span", { hasText: /^전체$/ }) }).locator("b");
  assert.equal(await tileAll.textContent(), String(mine.length));
  // '확인 필요' 판정(B02): 결과가 대기인데 발표 예정일이 지났거나, 없으면 마감 후 14일이 지남 — 시드와 오늘 날짜로 따로 센다
  const today = todayKST();
  const stale = mine.filter(j => { const a = d.apps[j.id]; const dl = (a.myEnd || j.end);
    return a.check || (a.doc === "대기" && (a.resultAt ? a.resultAt < today : dl && dl < addDays(today, -14))); }).length;
  if(stale) assert.match(await p.textContent(".ddb .warn"), new RegExp("결과를 확인할 공고가 " + stale + "건"));
  else assert.equal(await p.locator(".ddb .warn").count(), 0);
  await snap(p, "mine-card", true);
}));

test("서류 결과를 '합격'으로 바꾸면 '다음 전형 붙이기' 버튼들이 나타난다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  const next = () => card(p).locator(".app-b > .stage-add");   // 자소서 '+ 문항 추가' 줄도 같은 class라 카드 본문 바로 아래 것만
  assert.equal(await next().count(), 0, "서류 합격 전에는 없음");
  await p.selectOption(`select[aria-label="${T.co} 서류 결과"]`, "합격");
  await next().waitFor();
  const btns = await next().locator("button").allTextContents();
  assert.ok(btns.includes("+ 1차 면접") && btns.includes("+ 직접 입력"), btns.join(","));
  assert.equal((await getDb(p)).apps[T.id].doc, "합격");
}));

test("'+ 1차 면접'을 누르면 서류 마감일 기준 예상 날짜가 '예상' 표시와 함께 붙는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await card(p).locator(".app-b > .stage-add button", { hasText: "+ 1차 면접" }).click();
  const input = p.locator(`input[aria-label="${T.co} 1차 면접 일정"]`);
  await input.waitFor();
  const dl = (await getDb(p)).apps[T.id].myEnd || T.end;
  assert.equal(await input.inputValue(), addDays(dl, 21), "통상 간격(서류 마감 + 21일)");
  assert.equal(await card(p).locator(".step .sn .est-tag").count(), 1, "1차 면접에 '예상' 꼬리표");
  assert.equal(await card(p).locator(".step .sn .est-tag").textContent(), "예상");
}));

test("전형 날짜를 직접 넣으면 '예상' 표시가 사라진다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await p.fill(`input[aria-label="${T.co} 1차 면접 일정"]`, STAGE_DATE);
  await p.waitForFunction(([id, d]) => db.apps[id].stages.some(s => s.name === "1차 면접" && s.date === d && !s.est), [T.id, STAGE_DATE]);
  assert.equal(await card(p).locator(".step .sn .est-tag").count(), 0);
}));

test("넣은 전형 날짜가 캘린더 그 날짜 칸에 '1차 면접 · 회사'로 뜬다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "cal");
  const want = Number(STAGE_DATE.slice(0, 4)) + "년 " + Number(STAGE_DATE.slice(5, 7)) + "월";
  for(let i = 0; i < 3 && (await p.textContent("#mLbl")) !== want; i++) await p.click("#mNext");
  assert.equal(await p.textContent("#mLbl"), want);
  const day = Number(STAGE_DATE.slice(8, 10));
  const evs = await p.$$eval(".cal-grid .cell:not(.out)", (cells, day) => {
    const c = cells.find(x => x.querySelector(".dnum").firstChild.textContent === String(day));
    return [...c.querySelectorAll(".ev-stage")].map(e => e.textContent);
  }, day);
  assert.ok(evs.includes("1차 면접" + T.co), "그 날짜 칸의 전형 일정: " + JSON.stringify(evs));
  await snap(p, "card-stage-on-calendar");
}));

test("같은 전형이 주간 플래너 그 날짜에도 뜬다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "plan");
  await p.click("#wToday");
  const day = String(Number(STAGE_DATE.slice(8, 10)));
  const find = () => p.$$eval("#week .day", (ds, day) => { const d = ds.find(x => x.querySelector("h3 b").textContent === day); return d ? [...d.querySelectorAll(".pev.g")].map(e => e.textContent) : null; }, day);
  let got = await find();
  if(!got){ await p.click("#wNext"); got = await find(); }
  assert.ok(got && got.includes("1차 면접 · " + T.co), "플래너 그 날짜의 전형: " + JSON.stringify(got));
  await p.click("#wToday");
}));

test("자소서 '+ 문항 추가'를 누르면 문항 칸이 하나 생긴다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await openFold(p, "자소서");
  const n = (await getDb(p)).apps[T.id].essays.length;
  await card(p).locator("button", { hasText: "+ 문항 추가" }).click();
  await openFold(p, "자소서");
  assert.equal(await card(p).locator(".essay").count(), n + 1);
  assert.equal((await getDb(p)).apps[T.id].essays.length, n + 1);
}));

test("[BUG-14] '+ 문항 추가'를 누른 뒤에도 자소서 영역이 펼쳐진 채로 새 문항 칸이 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await openFold(p, "자소서");
  await card(p).locator("button", { hasText: "+ 문항 추가" }).click();
  const visible = await card(p).locator(".essay").last().isVisible();
  await snap(p, "bug-essay-collapse");
  assert.equal(visible, true, "문항을 추가하자마자 카드가 다시 그려져 자소서 영역이 접힘");
}));

test("제한 글자수를 넣으면 쓰는 동안 글자수와 남은 글자수가 나오고, 넘치면 '초과'로 표시된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await openFold(p, "자소서");
  const box = card(p).locator(".essay").first();
  await box.locator(".e-q").fill("지원 동기를 쓰세요 (QA)");
  await box.locator(".e-lim").fill("100");
  await box.locator(".e-lim").blur();          // 칸을 벗어나면 카드가 다시 그려진다
  await openFold(p, "자소서");
  const box2 = card(p).locator(".essay").first();
  const ta = box2.locator("textarea");
  await ta.fill("가".repeat(90) + " " + "나".repeat(4));        // 95자, 공백 제외 94자
  assert.equal(await box2.locator(".e-cnt").textContent(), "95 / 100자 · 공백 제외 94자 · 5자 남음");
  assert.match(await box2.locator(".e-cnt").getAttribute("class"), /near/);
  await ta.fill("가".repeat(120));
  assert.equal(await box2.locator(".e-cnt").textContent(), "120 / 100자 · 공백 제외 120자 · 20자 초과");
  assert.match(await box2.locator(".e-cnt").getAttribute("class"), /over/);
  assert.equal(await box2.locator(".e-gauge i").getAttribute("class"), "over");
  await ta.blur();
  await p.waitForFunction(id => db.apps[id].essays[0].a.length === 120 && db.apps[id].essays[0].limit === 100, T.id);
}));

test("자격요건 칸에 붙여넣고 칸을 벗어나면 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  await openFold(p, "자격요건");
  const ta = card(p).locator('textarea[aria-label="자격요건"]');
  await ta.fill("- 금융권 인턴 경험\n- 엑셀 활용");
  await ta.blur();
  await p.waitForFunction(id => db.apps[id].req === "- 금융권 인턴 경험\n- 엑셀 활용", T.id);
}));

test("지원 직무를 고르면 카드 머리에 그 직무가 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await cards(p);
  const role = T.roles[0];
  await p.selectOption(`select[aria-label="${T.co} 지원 직무"]`, role);
  await p.waitForFunction(([id, r]) => db.apps[id].role === r, [T.id, role]);
  assert.equal(await card(p).locator(".app-h .rl").textContent(), role);
}));
