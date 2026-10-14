// 공고 추가 · 필수값 · 편집 · 삭제(직접 등록) · 공용 공고 편집
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, todayKST, addDays, jobOf } from "./support.mjs";

let S;
const g = guard(() => S.page, "custom");
const NAME = "QA 직접등록 " + Date.now().toString(36);
const RENAMED = NAME + " 수정";
before(async () => { S = await open({ seed: true, tag: "custom-job" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const dlgOpen = p => p.evaluate(() => document.getElementById("dlg").open);
const md = iso => Number(iso.slice(5, 7)) + "월 " + Number(iso.slice(8, 10)) + "일";
async function search(p, q){
  await closeAll(p); await tab(p, "list");
  await p.fill("#q", q);
  await p.waitForFunction(q => document.getElementById("listCount").textContent.includes("‘" + q + "’"), q);
}
const rowOf = (p, co) => p.locator("#listBody tr").filter({ has: p.locator("td.co", { hasText: co }) });
const customId = async (p, co) => ((await getDb(p)).custom.find(c => c.company === co) || {}).id;

test("'+ 공고'에 회사·직무·기간·출처·형태·링크·메모를 넣고 저장하면 목록과 내 데이터에 추가된다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const start = todayKST(), end = addDays(todayKST(), 10);
  await p.click("#addBtn");
  await p.waitForSelector("#dlg[open]");
  assert.equal(await p.textContent("#dlgTitle"), "공고 추가");
  assert.equal(await p.isHidden("#delBtn"), true);
  await p.fill('#form [name="company"]', NAME);
  await p.click('#formRoles button:text-is("PM/서비스기획")');
  await p.fill('#form [name="start"]', start);
  await p.fill('#form [name="end"]', end);
  assert.equal(await p.isChecked('#form [name="confirmed"]'), true, "새 공고는 확정 일정이 기본");
  await p.selectOption('#form [name="source"]', "원티드");
  await p.selectOption('#form [name="type"]', "스타트업");
  await p.fill('#form [name="url"]', "https://example.com/qa-job");
  await p.fill('#form [name="note"]', "QA 메모: 과제 전형 있음");
  await p.click('#form button[type="submit"]');
  await p.waitForFunction(() => !document.getElementById("dlg").open);
  assert.equal(await p.textContent("#toast"), "저장했어요");
  const d = await getDb(p);
  const c = d.custom.find(x => x.company === NAME);
  assert.ok(c, "db.custom에 없음");
  assert.deepEqual({ roles: c.roles, start: c.start, end: c.end, confirmed: c.confirmed, source: c.source, type: c.type, url: c.url },
    { roles: ["PM/서비스기획"], start, end, confirmed: true, source: "원티드", type: "스타트업", url: "https://example.com/qa-job" });
  assert.equal(d.apps[c.id].note, "QA 메모: 과제 전형 있음");
  await search(p, NAME);
  const row = rowOf(p, NAME);
  assert.equal(await row.count(), 1);
  assert.equal(await row.locator(".pill").textContent(), "접수 중 D-10");
  await snap(p, "custom-added");
}));

test("회사 이름을 비워 두고 저장하면 저장되지 않고 폼이 열린 채로 남는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  const n = (await getDb(p)).custom.length;
  await p.click("#addBtn");
  await p.click('#form button[type="submit"]');
  assert.equal(await dlgOpen(p), true);
  assert.equal(await p.evaluate(() => document.querySelector('#form [name="company"]').validity.valueMissing), true);
  assert.equal((await getDb(p)).custom.length, n);
  await p.click("#cancelBtn");
}));

test("직접 등록한 공고를 편집해 이름과 마감일을 바꾸면 목록에 바로 반영된다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const id = await customId(p, NAME);
  const end2 = addDays(todayKST(), 12);
  await search(p, NAME);
  await rowOf(p, NAME).locator("td.act button", { hasText: "편집" }).click();
  await p.waitForSelector("#dlg[open]");
  assert.equal(await p.textContent("#dlgTitle"), NAME);
  assert.equal(await p.isVisible("#delBtn"), true, "직접 등록한 공고에는 삭제 버튼이 있다");
  assert.equal(await p.inputValue('#form [name="note"]'), "QA 메모: 과제 전형 있음");
  await p.fill('#form [name="company"]', RENAMED);
  await p.fill('#form [name="end"]', end2);
  await p.click('#form button[type="submit"]');
  await p.waitForFunction(() => !document.getElementById("dlg").open);
  const c = (await getDb(p)).custom.find(x => x.id === id);
  assert.equal(c.company, RENAMED);
  assert.equal(c.end, end2);
  await search(p, RENAMED);
  assert.equal(await rowOf(p, RENAMED).locator("td.dt-end").textContent(), md(end2));
}));

test("직접 등록한 공고를 편집 폼의 '삭제'로 지우면 목록과 내 데이터에서 사라진다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const id = await customId(p, RENAMED);
  assert.ok(id);
  await search(p, RENAMED);
  await rowOf(p, RENAMED).locator("td.act button", { hasText: "편집" }).click();
  await p.waitForSelector("#dlg[open]");
  await p.click("#delBtn");
  await p.waitForSelector("#confirmDlg[open]");                // 되돌릴 수 없는 일이라 확인 창(B20)
  assert.match(await p.textContent("#confirmDlg .confirm-msg"), /공고를 지울까요\?$/);
  assert.equal(await p.textContent("#confirmYes"), "공고 지우기");
  await p.click("#confirmYes");
  await p.waitForFunction(() => !document.getElementById("dlg").open && !document.getElementById("confirmDlg").open);
  assert.equal(await p.textContent("#toast"), "공고를 지웠어요");
  const d = await getDb(p);
  assert.equal(d.custom.some(x => x.id === id), false);
  assert.equal(d.apps[id], undefined);
  await search(p, RENAMED);
  assert.equal(await rowOf(p, RENAMED).count(), 0);
  assert.equal(S.dialogs.filter(x => x.type === "confirm").length, 0, "브라우저 confirm()은 쓰지 않는다");
}));

test("공용 공고의 편집 폼에는 '삭제' 버튼이 없다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list"); await p.fill("#q", "");
  await p.locator("#listBody tr").first().locator("td.act button", { hasText: "편집" }).click();
  await p.waitForSelector("#dlg[open]");
  assert.equal(await p.isHidden("#delBtn"), true);
  await p.click("#cancelBtn");
}));

test("[BUG-13] 공용 공고의 편집 폼을 열어 아무것도 안 바꾸고 저장하면 공고 정보가 그대로다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  const changed = [];
  async function saveUnchanged(openRow){
    await openRow();
    await p.waitForSelector("#dlg[open]");
    const id = await p.evaluate(() => editId);
    const before = await jobOf(p, id);
    await p.click('#form button[type="submit"]');
    await p.waitForFunction(() => !document.getElementById("dlg").open);
    const after = await jobOf(p, id);
    Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .forEach(k => changed.push(`${before.company}(${id}) ${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`));
  }
  // ① 기업 형태가 비어 있는 공고(시드에서 지원해 둔 것이라 목록에 항상 보임)
  const j1 = await jobOf(p, "wanted-384558");
  assert.ok(j1, "wanted-384558 공고가 데이터에 없음 — 시드 갱신 필요");
  await search(p, j1.company);
  await saveUnchanged(() => rowOf(p, j1.company).filter({ has: p.locator("td.act button.on", { hasText: /^담음$/ }) }).first()
    .locator("td.act button", { hasText: "편집" }).click());
  // ② 출처가 폼 선택지에 없는 공고(작년 기록으로 만든 '예상' 일정)
  const j2 = await p.evaluate(() => { const j = scoped().find(x => x.source === "예상(작년 자소설닷컴 기록)" && !db.apps[x.id]?.applied); return j && { id: j.id, company: j.company }; });
  assert.ok(j2, "출처가 '예상(작년 자소설닷컴 기록)'인 공고가 목록에 없음(테스트 전제 확인)");
  await search(p, j2.company);
  await saveUnchanged(() => rowOf(p, j2.company).first().locator("td.act button", { hasText: "편집" }).click());
  await snap(p, "bug-edit-form-mutates");
  assert.deepEqual(changed, [], "저장만 눌렀는데 바뀐 값");
}));
