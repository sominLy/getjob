// 첫 로그인 '내 조건' 다이얼로그 · 내 조건 저장 · 닫기 동작
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openMenu } from "./helpers.mjs";
import { open, finish, restoreSeed, seedDb, getDb, waitForSync, guard, snap, OUT, closeAll, reloadApp } from "./support.mjs";

let S;
const g = guard(() => S.page, "onboarding");
const fresh = join(OUT, "tmp-seed-not-onboarded.json");

before(async () => {
  const d = seedDb();
  d.profile.onboarded = false; d.profile.roles = []; d.profile.types = [];
  writeFileSync(fresh, JSON.stringify(d));
  S = await open({ seed: true, tag: "onboarding" });
}, { timeout: 120000 });
after(async () => { await finish(S); });

test("아직 조건을 안 고른 계정은 첫 화면에서 '내 조건' 창이 열린다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await restoreSeed(p, fresh);
  await reloadApp(p);
  await p.waitForSelector("#prefDlg[open]", { timeout: 10000 });
  assert.equal(await p.locator("#roleChips button[aria-pressed=true]").count(), 0);
  assert.equal(await p.locator("#typeChips button[aria-pressed=true]").count(), 0);
  assert.equal(await p.locator("#roleChips button").count(), 14, "관심 직무 칩 14개");
  assert.equal(await p.locator("#typeChips button").count(), 7, "기업 형태 칩 7개");
  await snap(p, "onboarding-first-pref");
}));

test("칩을 고르고 저장하면 조건이 저장되고 안내 문구가 뜬다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await p.click('#roleChips button:text-is("PM/서비스기획")');
  await p.click('#typeChips button:text-is("대기업")');
  assert.equal(await p.getAttribute('#roleChips button:text-is("PM/서비스기획")', "aria-pressed"), "true");
  const synced = waitForSync(p, d => d.profile.onboarded === true);
  await p.click("#prefDone");
  await p.waitForFunction(() => /^내 조건에 맞는 공고 \d+건을 보여 줘요$/.test(document.getElementById("toast").textContent));
  await synced;
  assert.equal(await p.locator("#prefDlg[open]").count(), 0);
  const d = await getDb(p);
  assert.equal(d.profile.onboarded, true);
  assert.deepEqual(d.profile.roles, ["PM/서비스기획"]);
  assert.deepEqual(d.profile.types, ["대기업"]);
}));

test("조건을 저장한 뒤 다시 열면 '내 조건' 창이 저절로 뜨지 않는다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await reloadApp(p);
  await p.waitForTimeout(1500);
  assert.equal(await p.locator("#prefDlg[open]").count(), 0);
}));

test("[BUG-21] '내 조건' 창을 Esc로 닫으면 누른 칩이 조건에 반영되지 않는다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await restoreSeed(p);
  const before = (await getDb(p)).profile.roles.slice();
  await openMenu(p); await p.click("#prefBtn");
  await p.waitForSelector("#prefDlg[open]");
  await p.click('#roleChips button:text-is("마케팅")');
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.getElementById("prefDlg").open);
  const after = (await getDb(p)).profile.roles;
  assert.deepEqual(after, before, "저장을 누르지 않았는데 메모리의 조건이 바뀜: " + JSON.stringify(after));
}));

test("[BUG-16] '전체 보기'로 잠시 풀어 둔 상태에서 '내 조건'을 열면 저장해 둔 조건이 그대로 보인다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await restoreSeed(p);
  const saved = (await getDb(p)).profile;
  assert.equal(await p.textContent("#scopeState"), "내 조건 적용 중");
  await p.click("#scopeBtn");
  assert.equal(await p.textContent("#scopeState"), "전체 보는 중");
  await openMenu(p); await p.click("#prefBtn");
  await p.waitForSelector("#prefDlg[open]");
  const shown = await p.locator("#roleChips button[aria-pressed=true]").count() + await p.locator("#typeChips button[aria-pressed=true]").count();
  await snap(p, "bug-scope-pref-empty");
  assert.equal(shown, saved.roles.length + saved.types.length, "저장해 둔 조건 " + (saved.roles.length + saved.types.length) + "개 중 창에 보이는 것 " + shown + "개");
}));
