// 전체 공고: 필터 칩 · 검색 · 정렬 · 날짜 모드 · 내 조건 적용/해제 · 관심(★) · 지원 → 내 지원 이동
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, jobsData, seedDb, todayKST } from "./support.mjs";

let S;
const g = guard(() => S.page, "list");
before(async () => { S = await open({ seed: true, tag: "list" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const chip = (p, label) => p.locator("#filters button", { hasText: new RegExp("^" + label + " \\d+$") });
const chipCount = async (p, label) => Number((await chip(p, label).textContent()).match(/(\d+)$/)[1]);
const companies = p => p.$$eval("#listBody td.co", tds => tds.map(td => td.firstChild ? td.firstChild.textContent : ""));
/* 알약 종류(p-open · p-roll …) — 접수 중은 남은 날짜에 따라 .s · .n이 더 붙는다(UX B-3-4) */
const pillClasses = p => p.$$eval("#listBody td.stt .pill", ps => ps.map(x => x.className.replace("pill ", "").split(" ")[0]));
/* 목록은 40줄씩 그린다(B15) — 수를 세는 테스트는 '더 보기'를 끝까지 눌러 다 펼친다 */
async function showAll(p){ for(let i = 0; i < 60 && await p.isVisible("#listMore"); i++) await p.click("#listMore"); }
async function useFilter(p, label){
  await chip(p, label).click();
  assert.equal(await chip(p, label).getAttribute("aria-pressed"), "true");
}
/** 목록을 처음 상태로: 검색 비움 · 날짜 모드 '시작·마감 모두' · 마감일 오름차순 · '접수 중' */
async function resetList(p){
  await closeAll(p); await tab(p, "list");
  if(await p.inputValue("#q")){ await p.fill("#q", ""); }
  for(let i = 0; i < 3 && (await p.textContent("#dateModeBtn")) !== "시작일·마감일 모두 보기"; i++) await p.click("#dateModeBtn");
  for(let i = 0; i < 2 && !(await p.evaluate(() => sortKey === "end" && sortDir === 1)); i++) await p.click('th.sortable[data-s="end"]');
  await useFilter(p, "접수 중");
}
const fmtEnd = j => j.end ? Number(j.end.slice(5, 7)) + "월 " + Number(j.end.slice(8, 10)) + "일" + (j.endTime ? " " + j.endTime : "") : "상시·수시";
const rowKeys = p => p.$$eval("#listBody tr", trs => trs.map(tr => { const co = tr.querySelector("td.co"), e = tr.querySelector("td.dt-end"); return co && e ? co.firstChild.textContent + "|" + e.textContent : ""; }));

test("필터 칩 8개가 개수와 함께 보이고 처음에는 '접수 중'이 눌려 있다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const labels = await p.$$eval("#filters button", bs => bs.map(b => b.textContent.replace(/ \d+$/, "")));
  assert.deepEqual(labels, ["전체", "새로 뜸", "접수 중", "관심", "오픈 예정", "예상", "상시", "마감"]);
  assert.equal(await p.getAttribute('#filters button[aria-pressed="true"]', "aria-pressed"), "true");
  assert.match(await p.textContent('#filters button[aria-pressed="true"]'), /^접수 중 \d+$/);
  const n = await chipCount(p, "접수 중");
  assert.equal(await p.locator("#listBody tr").count(), Math.min(n, 40), "처음에는 40줄까지");
  if(n > 40) assert.match(await p.textContent("#listMore"), /^\d+개 더 보기/);
  await showAll(p);
  assert.equal(await p.locator("#listBody tr").count(), n, "접수 중 칩 숫자 = 목록 줄 수");
  assert.ok((await pillClasses(p)).every(c => c === "p-open"));
}));

test("'상시' 칩을 누르면 상시 공고만 칩 숫자만큼 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await useFilter(p, "상시");
  await showAll(p);
  const n = await chipCount(p, "상시");
  const cls = await pillClasses(p);
  assert.equal(cls.length, n);
  assert.ok(cls.every(c => c === "p-roll"), "상시가 아닌 줄: " + cls.filter(c => c !== "p-roll").join(","));
  await resetList(p);
}));

test("'마감' 칩을 누르면 지난 공고까지 받아 와 마감 공고만 보인다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await useFilter(p, "마감");
  await p.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 20000 });
  await p.waitForFunction(() => document.querySelectorAll("#listBody td.stt").length > 0);
  await showAll(p);
  const cls = await pillClasses(p);
  assert.ok(cls.length > 0);
  assert.ok(cls.every(c => c === "p-shut"));
  assert.equal(cls.length, await chipCount(p, "마감"));
  await resetList(p);
}));

test("회사 이름으로 검색하면 그 이름이 들어간 공고만 마감 포함으로 보인다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await p.fill("#q", "신한");
  await p.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 20000 });
  await p.waitForFunction(() => /‘신한’ 검색 \(마감 포함\)/.test(document.getElementById("listCount").textContent));
  const cos = await companies(p);
  assert.ok(cos.length > 0, "검색 결과가 비어 있음");
  assert.ok(cos.every(c => c.toLowerCase().includes("신한")), "검색어가 없는 회사: " + cos.filter(c => !c.includes("신한")).join(","));
  assert.match(await p.textContent("#listCount"), new RegExp("^" + cos.length + "건"));
  await resetList(p);
}));

test("'기업' 머리글을 누르면 회사 이름 순, 한 번 더 누르면 반대 순서로 바뀐다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const ko = (a, b) => a.localeCompare(b, "ko");
  await p.click('th.sortable[data-s="company"]');
  const asc = await companies(p);
  assert.ok(asc.length > 2);
  assert.ok(asc.every((c, i) => i === 0 || ko(asc[i - 1], c) <= 0), "오름차순이 아님");
  await p.click('th.sortable[data-s="company"]');
  const desc = await companies(p);
  assert.ok(desc.every((c, i) => i === 0 || ko(desc[i - 1], c) >= 0), "내림차순이 아님");
  await p.click('th.sortable[data-s="end"]');   // 원래 정렬(마감일)로
}));

test("날짜 모드 버튼은 '시작·마감 모두 → 마감만 → 시작만' 순으로 바뀌고 해당 날짜가 있는 공고만 남긴다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await useFilter(p, "전체");
  assert.equal(await p.textContent("#dateModeBtn"), "시작일·마감일 모두 보기");
  await p.click("#dateModeBtn");
  assert.equal(await p.textContent("#dateModeBtn"), "마감일만 보기");
  const ends = await p.$$eval("#listBody td.dt-end", tds => tds.map(t => t.textContent));
  assert.ok(ends.length > 0 && ends.every(t => t !== "상시·수시"), "마감일 없는 공고가 남음");
  await p.click("#dateModeBtn");
  assert.equal(await p.textContent("#dateModeBtn"), "시작일만 보기");
  const starts = await p.$$eval("#listBody td.dt-start", tds => tds.map(t => t.textContent));
  assert.ok(starts.length > 0 && starts.every(t => /^\d+월 \d+일$/.test(t)), "시작일 없는 공고가 남음: " + starts.filter(t => !/^\d+월 \d+일$/.test(t)).slice(0, 3));
  assert.equal(await p.textContent("#calDateModeBtn"), "시작일만 보기", "캘린더 버튼도 같은 기준을 쓴다");
  await p.click("#dateModeBtn");
  assert.equal(await p.textContent("#dateModeBtn"), "시작일·마감일 모두 보기");
}));

test("[BUG-22] 날짜 모드를 한 바퀴 돌려 '시작·마감 모두'로 오면 처음 정렬(마감일 순)로 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  await p.click('th.sortable[data-s="end"]');
  if(await p.evaluate(() => sortDir) !== 1) await p.click('th.sortable[data-s="end"]');
  assert.equal(await p.evaluate(() => sortKey), "end");
  for(let i = 0; i < 3; i++) await p.click("#dateModeBtn");
  assert.equal(await p.textContent("#dateModeBtn"), "시작일·마감일 모두 보기");
  const key = await p.evaluate(() => sortKey);
  assert.equal(key, "end", "날짜 모드를 돌린 뒤 정렬 기준이 '" + key + "'로 남음(화면에는 표시 없음)");
}));

test("'내 조건 적용 중' 옆 '전체 보기'를 누르면 조건을 풀어 공고가 늘고, 다시 누르면 원래 조건으로 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const before = Number(await p.textContent("#c-list"));
  assert.deepEqual([await p.textContent("#scopeState"), await p.textContent("#scopeBtn")], ["내 조건 적용 중", "전체 보기"]);
  await p.click("#scopeBtn");
  assert.deepEqual([await p.textContent("#scopeState"), await p.textContent("#scopeBtn")], ["전체 보는 중", "내 조건으로 보기"]);
  const all = Number(await p.textContent("#c-list"));
  assert.ok(all > before, `전체 ${all} > 조건 적용 ${before}`);
  await p.click("#scopeBtn");
  assert.deepEqual([await p.textContent("#scopeState"), await p.textContent("#scopeBtn")], ["내 조건 적용 중", "전체 보기"]);
  assert.equal(Number(await p.textContent("#c-list")), before);
  const d = await getDb(p);
  assert.deepEqual(d.profile.roles, seedDb().profile.roles);
}));

test("☆ 관심을 누르면 ★ 관심으로 바뀌고 '관심' 칩 숫자가 1 늘며, 다시 누르면 원래대로 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const n0 = await chipCount(p, "관심");
  const starredBefore = Object.entries((await getDb(p)).apps).filter(([, a]) => a.starred).map(([id]) => id);
  const row = p.locator("#listBody tr").filter({ has: p.locator('td.act button', { hasText: /^☆ 관심$/ }) }).first();
  const co = await row.locator("td.co").evaluate(td => td.firstChild.textContent);
  await row.locator("td.act button", { hasText: "관심" }).click();
  const after = Object.entries((await getDb(p)).apps).filter(([, a]) => a.starred).map(([id]) => id);
  const added = after.filter(id => !starredBefore.includes(id));
  assert.equal(added.length, 1);
  assert.equal(await chipCount(p, "관심"), n0 + 1);
  const row2 = p.locator("#listBody tr").filter({ has: p.locator("td.co", { hasText: co }) }).filter({ has: p.locator('td.act button.on', { hasText: "★ 관심" }) }).first();
  assert.equal(await row2.count(), 1, co + " 줄이 ★ 관심으로 바뀌지 않음");
  await row2.locator("td.act button", { hasText: "관심" }).click();
  assert.equal(await chipCount(p, "관심"), n0);
  assert.equal((await getDb(p)).apps[added[0]].starred, false);
}));

test("'담기'를 누르면 화면은 그대로이고 내 지원에 담기며, '담음'을 누르면 빠지고 [되돌리기]로 돌아온다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const appliedBefore = Object.entries((await getDb(p)).apps).filter(([, a]) => a.applied).map(([id]) => id);
  const row = p.locator("#listBody tr").filter({ has: p.locator("td.act button", { hasText: /^담기$/ }) })
    .filter({ hasNot: p.locator("td.dt-end", { hasText: "상시·수시" }) }).first();
  const co = await row.locator("td.co").evaluate(td => td.firstChild.textContent);
  await row.locator("td.act button", { hasText: /^담기$/ }).click();
  assert.equal(await p.getAttribute('nav.tabs button[data-v="list"]', "aria-selected"), "true", "담아도 전체 공고 탭에 머문다(B25)");
  assert.equal(await p.textContent("#toast .toast-msg"), co + " · 내 지원에 담았어요");
  assert.equal(await p.textContent("#toast .toast-act"), "내 지원 보기");
  const id = Object.entries((await getDb(p)).apps).filter(([, a]) => a.applied).map(([i]) => i).find(i => !appliedBefore.includes(i));
  assert.ok(id, "새로 담은 기록이 없음");
  assert.equal((await getDb(p)).apps[id].at, todayKST(), "담은 날이 오늘로 기록된다");
  await p.click("#toast .toast-act");
  await p.waitForFunction(() => document.querySelector('nav.tabs button[data-v="mine"]').getAttribute("aria-selected") === "true");
  const mineCos = await p.$$eval(".tb .tb-co", tds => tds.map(t => (t.querySelector("input") || t.querySelector("span") || t).value || t.textContent));
  assert.ok(mineCos.some(c => c.startsWith(co)), "내 지원 표에 " + co + "이 없음");
  await snap(p, "list-after-apply");
  await tab(p, "list");
  await p.fill("#q", co);
  const out = () => p.locator("#listBody tr").filter({ has: p.locator("td.act button.on", { hasText: /^담음$/ }) }).first().locator("td.act button", { hasText: /^담음$/ });
  const confirms = S.dialogs.filter(d => d.type === "confirm").length;
  await out().click();
  assert.equal(await p.textContent("#toast .toast-msg"), co + " · 내 지원에서 뺐어요");
  assert.equal((await getDb(p)).apps[id].applied, false);
  await p.click("#toast .toast-act");               // 되돌리기
  await p.waitForFunction(id => db.apps[id].applied === true, id);
  await out().click();
  assert.equal((await getDb(p)).apps[id].applied, false);
  assert.equal(S.dialogs.filter(d => d.type === "confirm").length, confirms, "빼기는 확인 창 없이");
  await resetList(p);
}));

test("[BUG-07] 관심(★)으로 찜한 공고는 내 조건과 상관없이 '관심'에 모두 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const ids = new Set(jobsData().jobs.map(j => j.id).concat(seedDb().custom.map(c => c.id)));
  const starred = Object.entries(seedDb().apps).filter(([id, a]) => a.starred && ids.has(id)).length;
  const shown = await chipCount(p, "관심");
  await useFilter(p, "관심");
  await snap(p, "bug-star-hidden");
  assert.equal(shown, starred, `시드에서 찜한 ${starred}건 중 '관심'에 보이는 것 ${shown}건`);
}));

test("[BUG-06] 내 조건 적용 중에도 기업 형태가 비어 있는 접수 중 공고가 목록에 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const prof = seedDb().profile, today = todayKST();
  const want = jobsData().jobs.filter(j => !j.type && j.confirmed && j.end && j.end >= today && (!j.start || j.start <= today) &&
    (!(j.roles || []).length || j.roles.some(r => prof.roles.includes(r))) && !seedDb().apps[j.id]);
  assert.ok(want.length > 0, "이 날짜 데이터에 해당 공고가 없음(테스트 전제 확인)");
  await showAll(p);
  const keys = await rowKeys(p);
  const shown = want.filter(j => keys.includes(j.company + "|" + fmtEnd(j)));
  const hidden = want.filter(j => !shown.includes(j));
  assert.equal(shown.length, want.length, `기업 형태가 빈 접수 중 공고 ${want.length}건 중 목록에 보이는 것 ${shown.length}건 (안 보이는 예: ${[...new Set(hidden.map(j => j.company))].slice(0, 4).join(", ")})`);
}));

test("[BUG-06] 기업 형태가 비어 있는 회사도 이름으로 검색하면 나온다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await resetList(p);
  const j = jobsData().jobs.find(x => x.id === "wanted-384472") || jobsData().jobs.find(x => !x.type && x.confirmed && !seedDb().apps[x.id]);
  await p.fill("#q", j.company);
  await p.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 20000 });
  await p.waitForFunction(q => document.getElementById("listCount").textContent.includes("‘" + q + "’"), j.company);
  const cos = await companies(p);
  await snap(p, "bug-type-unknown-search");
  assert.ok(cos.includes(j.company), `'${j.company}'(기업 형태 비어 있음)를 검색했는데 결과 ${cos.length}건`);
  await resetList(p);
}));
