// 내 지원 — 표 보기: 상태 · 진행 단계 · 단계 고치기 · 결과 확인일 · 마감 · 메모 · 행 추가 · 내보내기 · 검색 · 빼기
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, setPrompt, downloadText, todayKST, addDays } from "./support.mjs";

let S;
const g = guard(() => S.page, "mine-table");
before(async () => {
  S = await open({ seed: true, tag: "mine-table" });
  await tab(S.page, "mine"); await S.page.click("#mvTable");
}, { timeout: 120000 });
after(async () => { setPrompt(null); await finish(S); });

const T = "#apps .tb";
const rows = p => p.locator(T + " tbody tr:not(:has(.tb-empty))");
const tile = (p, label) => p.locator(".tb-tile", { has: p.locator("span", { hasText: new RegExp("^" + label + "$") }) });
const tileN = async (p, label) => Number(await tile(p, label).locator("b").textContent());
async function home(p){ await closeAll(p); await tab(p, "mine"); await p.click("#mvTable"); if(await p.inputValue(".tb-q")) await p.fill(".tb-q", ""); }
/** 시드에서 고른 '결과 대기' 지원 하나(이름이 바뀌지 않는 실제 공고) */
async function target(p, id){ return p.evaluate(id => { const j = allJobs().find(x => x.id === id); return j ? { id, co: j.company } : null; }, id); }

test("표 위 숫자 타일이 흐름 순서로 나오고 줄 수와 맞는다(전체·마감 전·결과 대기·확인 필요·합격·진행·탈락)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  assert.deepEqual(await p.$$eval(".tb-tile span", s => s.map(x => x.textContent)), ["전체", "마감 전", "결과 대기", "확인 필요", "합격·진행", "탈락"]);
  const n = await rows(p).count();
  assert.equal(await tileN(p, "전체"), n);
  const cls = await rows(p).evaluateAll(trs => trs.map(t => t.className));
  for(const [label, k] of [["마감 전", "마감전"], ["결과 대기", "대기"], ["확인 필요", "확인필요"], ["합격·진행", "합격"], ["탈락", "탈락"]])
    assert.equal(await tileN(p, label), cls.filter(c => c === "s-" + k).length, label);
  assert.equal(await p.locator(".tb-bar .chips").count(), 0, "타일과 같은 칩 줄은 없앴다(UX M-02)");
  await snap(p, "mine-table");
}));

test("카드 보기도 표와 같은 타일·같은 수를 보여 준다(B16)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const table = await p.$$eval(".tb-tile", ts => ts.map(t => t.textContent));
  await p.click("#mvCard");
  const card = await p.$$eval(".tb-tile", ts => ts.map(t => t.textContent));
  await p.click("#mvTable");
  assert.deepEqual(card, table);
}));

test("상태를 '합격'으로 바꾸면 줄 색과 타일 숫자가 바뀌고 서류 결과가 합격으로 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "fin-public-b");
  const pass0 = await tileN(p, "합격·진행");
  await p.selectOption(`select[aria-label="${t.co} 상태"]`, "합격");
  await p.waitForFunction(co => { const s = document.querySelector(`select[aria-label="${co} 상태"]`); return s && s.closest("tr").className === "s-합격"; }, t.co);
  assert.equal(await tileN(p, "합격·진행"), pass0 + 1);
  assert.equal((await getDb(p)).apps[t.id].doc, "합격");
}));

test("진행 단계에서 '1차 면접'을 고르면 그 단계가 진행 중(예정)으로 붙는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "fin-public-b");
  await p.selectOption(`select[aria-label="${t.co} 진행 단계"]`, "1차 면접");
  await p.waitForFunction(co => document.querySelector(`select[aria-label="${co} 진행 단계"]`).value === "1차 면접", t.co);
  const a = (await getDb(p)).apps[t.id];
  assert.equal(a.doc, "합격");
  assert.deepEqual(a.stages.map(s => [s.name, s.result]), [["1차 면접", "예정"]]);
}));

test("'전형 순서 고치기…'를 고르면 화면 안 입력칸이 열리고, 쉼표로 적어 저장하면 진행 단계 선택지가 바뀐다(B20)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "fin-public-b");
  const prompts = S.dialogs.filter(d => d.type === "prompt").length;
  await p.selectOption(`select[aria-label="${t.co} 진행 단계"]`, "__edit");
  const box = p.locator(`form.inline-add[data-inl="flow"] input[aria-label="${t.co} 전형 순서"]`);
  await box.waitFor();
  assert.ok((await box.inputValue()).length > 0, "지금 순서를 미리 채운다");
  await box.fill("서류합격, 과제, 임원 면접");
  await box.press("Enter");
  await p.waitForFunction(co => [...document.querySelector(`select[aria-label="${co} 진행 단계"]`).options].some(o => o.value === "임원 면접"), t.co);
  assert.deepEqual((await getDb(p)).apps[t.id].flow, ["서류합격", "과제", "임원 면접"]);
  const opts = await p.$$eval(`select[aria-label="${t.co} 진행 단계"] option`, os => os.map(o => o.value));
  assert.deepEqual(opts.filter(o => !["__edit"].includes(o)).slice(0, 5), ["서류 제출", "서류합격", "과제", "임원 면접", "최종합격"]);
  assert.equal(await p.locator('form.inline-add[data-inl="flow"]').count(), 0, "저장하면 입력칸이 닫힌다");
  assert.equal(S.dialogs.filter(d => d.type === "prompt").length, prompts, "브라우저 prompt()를 쓰지 않는다");
}));

test("진행 단계가 서류 다음이면 표에서 그 단계의 날짜·시각을 넣을 수 있다(B13)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "fin-public-b");
  await p.selectOption(`select[aria-label="${t.co} 진행 단계"]`, "과제");
  const day = p.locator(`input[aria-label="${t.co} 과제 일정"]`);
  await day.waitFor();
  const d = addDays(todayKST(), 5);
  await day.fill(d);
  await p.waitForFunction(([id, d]) => db.apps[id].stages.some(s => s.name === "과제" && s.date === d), [t.id, d]);
  await p.fill(`input[aria-label="${t.co} 과제 시각"]`, "14:00");
  await p.waitForFunction(id => db.apps[id].stages.some(s => s.name === "과제" && s.time === "14:00"), t.id);
  assert.ok((await p.$$eval("#rail .dchip", cs => cs.map(c => c.textContent))).some(x => x.includes(t.co) && x.includes("과제 14:00")), "넣은 시각이 레일에도 나온다");
}));

test("발표 예정일을 넣으면 저장되고, 지난 날짜면 결과 대기가 '확인 필요'로 바뀐다(B02)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "shinhan-life");
  const d = todayKST();
  await p.fill(`input[aria-label="${t.co} 발표 예정일"]`, d);
  await p.waitForFunction(([id, d]) => db.apps[id].resultAt === d, [t.id, d]);
  assert.equal(await p.evaluate(() => [...document.querySelectorAll(".tb thead th")].map(th => th.textContent)[4]), "발표 예정일");
  // 어제로 바꾸면 발표 예정일이 지난 '대기' — 확인 필요
  await p.fill(`input[aria-label="${t.co} 발표 예정일"]`, addDays(d, -1));
  await p.waitForFunction(co => document.querySelector(`select[aria-label="${co} 상태"]`).closest("tr").className === "s-확인필요", t.co);
  await p.fill(`input[aria-label="${t.co} 발표 예정일"]`, d);
  await p.waitForFunction(co => document.querySelector(`select[aria-label="${co} 상태"]`).closest("tr").className !== "s-확인필요", t.co);
}));

test("공용 공고의 마감일을 바꾸면 내 마감일(myEnd)로 저장되고 원래 공고 마감일은 그대로다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "shinhan-life");
  const end0 = await p.evaluate(id => allJobs().find(j => j.id === id).end, t.id);
  const d = addDays(todayKST(), 3);
  await p.fill(`input[aria-label="${t.co} 마감일"]`, d);
  await p.waitForFunction(([id, d]) => db.apps[id].myEnd === d, [t.id, d]);
  assert.equal(await p.evaluate(id => allJobs().find(j => j.id === id).end, t.id), end0);
  assert.equal(await p.inputValue(`input[aria-label="${t.co} 마감일"]`), d);
}));

test("메모 칸에 쓰고 칸을 벗어나면 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "shinhan-life");
  const box = p.locator(`input[aria-label="${t.co} 메모"]`);
  await box.fill("QA 표 메모 — 1차 면접 준비");
  await box.blur();
  await p.waitForFunction(id => db.apps[id].note === "QA 표 메모 — 1차 면접 준비", t.id);
}));

test("'+ 행 추가'로 회사 이름을 넣으면 직접 등록 지원이 표에 한 줄 생긴다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const n = await rows(p).count();
  await p.click(T.replace(" .tb", "") + " .tb-bar button.primary");
  const box = p.locator('form.inline-add[data-inl="addrow"] input[aria-label="회사 이름"]');
  await box.fill("QA 행추가 회사");
  await box.press("Enter");
  await p.waitForFunction(n => document.querySelectorAll("#apps .tb tbody tr").length === n + 1, n);
  const d = await getDb(p);
  const c = d.custom.find(x => x.company === "QA 행추가 회사");
  assert.ok(c);
  assert.equal(c.source, "직접 등록");
  assert.equal(d.apps[c.id].applied, true);
  assert.equal(await p.locator(T + ' input[aria-label="기업"]').evaluateAll(xs => xs.some(x => x.value === "QA 행추가 회사")), true);
}));

test("'내보내기'는 표의 모든 줄을 머리글과 함께 CSV로 내려준다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const n = await rows(p).count();
  const t = await target(p, "shinhan-life");
  const { name, text } = await downloadText(p, () => p.click(".tb-bar button.ghost:text-is('내보내기')"));
  assert.match(name, /^지원현황_\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(text.charCodeAt(0), 0xfeff, "엑셀용 BOM");
  const lines = text.slice(1).split("\n");
  assert.equal(lines[0], "기업,직무,상태,진행 단계,발표 예정일,마감,메모");
  assert.equal(lines.length - 1, n, "CSV 줄 수 = 표 줄 수");
  const row = lines.find(l => l.startsWith('"' + t.co + '"'));
  assert.ok(row && row.includes('"QA 표 메모 — 1차 면접 준비"'), "메모가 CSV에 들어간다: " + row);
}));

test("표 검색칸에 쓰면 그 글자가 들어간 줄만 남고 입력칸 포커스가 유지된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  await p.click(".tb-q");
  await p.keyboard.type("QA 행추가");
  await p.waitForFunction(() => document.querySelectorAll("#apps .tb tbody tr:not(:has(.tb-empty))").length === 1);   // 줄만 다시 그린다(150ms 뒤)
  assert.equal(await rows(p).count(), 1);
  assert.equal(await p.evaluate(() => document.activeElement.classList.contains("tb-q")), true);
  await p.fill(".tb-q", "");
}));

test("줄 끝 ×를 누르면 확인 없이 빠지고 적어 둔 내용은 남으며, [되돌리기]로 돌아온다(B25)", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await home(p);
  const t = await target(p, "shinhan-life");
  const n = await rows(p).count();
  const confirms = S.dialogs.filter(d => d.type === "confirm").length;
  const x = p.locator(`select[aria-label="${t.co} 상태"]`).locator("xpath=ancestor::tr").locator(".tb-del");
  assert.equal(await x.getAttribute("aria-label"), t.co + " 내 지원에서 빼기");
  await x.click();
  await p.waitForFunction(n => document.querySelectorAll("#apps .tb tbody tr").length === n - 1, n);
  const a = (await getDb(p)).apps[t.id];
  assert.equal(a.applied, false);
  assert.equal(a.note, "QA 표 메모 — 1차 면접 준비");
  assert.equal(S.dialogs.filter(d => d.type === "confirm").length, confirms, "확인 창을 띄우지 않는다");
  assert.equal(await p.textContent("#toast .toast-msg"), t.co + " · 내 지원에서 뺐어요");
  await p.click("#toast .toast-act");
  await p.waitForFunction(n => document.querySelectorAll("#apps .tb tbody tr").length === n, n);
  assert.equal((await getDb(p)).apps[t.id].applied, true);
}));
