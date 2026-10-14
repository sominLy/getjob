// ⋯ 메뉴 열고 닫기 · 업데이트 기록 · 도움말 패널 · 테마(모드·색) · 공고 제보 폼(올리지 않고 검증만)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tab, openMenu } from "./helpers.mjs";
import { open, finish, guard, snap, closeAll, waitForSync, reloadApp, restoreSeed, readJson, REPO } from "./support.mjs";

let S;
const g = guard(() => S.page, "menu");
before(async () => { S = await open({ seed: true, tag: "menu-theme-help" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const html = (p, a) => p.evaluate(a => document.documentElement.getAttribute(a), a);
const menuHidden = p => p.evaluate(() => document.getElementById("menuPop").hidden);

test("⋯ 메뉴는 버튼으로 열리고 바깥을 누르면 닫힌다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.click("#menuBtn");
  assert.equal(await menuHidden(p), false);
  assert.equal(await p.getAttribute("#menuBtn", "aria-expanded"), "true");
  await snap(p, "menu-open");
  await p.click("#v-list h2");
  assert.equal(await menuHidden(p), true);
  assert.equal(await p.getAttribute("#menuBtn", "aria-expanded"), "false");
}));

test("⋯ 메뉴는 Esc로 닫히고 키보드 포커스가 메뉴 버튼으로 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.click("#menuBtn");
  await p.keyboard.press("Escape");
  assert.equal(await menuHidden(p), true);
  assert.equal(await p.evaluate(() => document.activeElement.id), "menuBtn");
}));

test("메뉴 항목을 누르면 메뉴는 닫히고 그 창이 열린다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await openMenu(p); await p.click("#themeBtn");
  assert.equal(await menuHidden(p), true);
  assert.equal(await p.evaluate(() => document.getElementById("themeDlg").open), true);
  await p.click("#themeDone");
}));

test("업데이트 기록은 날짜별 묶음으로 열리고 가장 최근 날짜만 펼쳐져 있다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  const log = readJson(join(REPO, "data/update-log.json"));
  await openMenu(p); await p.click("#logBtn");
  await p.waitForSelector("#logBody details.log-day", { timeout: 20000 });
  const days = await p.$$eval("#logBody details.log-day", ds => ds.map(d => [d.querySelector("summary b").textContent, d.open]));
  assert.equal(days.length, log.entries.length);
  const last = log.entries[log.entries.length - 1].date;
  assert.ok(days[0][0].startsWith(last.slice(5).replace("-", "/")), days[0][0] + " vs " + last);
  assert.deepEqual(days.map(d => d[1]), days.map((d, i) => i === 0));
  await snap(p, "update-log");
  await p.click("#logDone");
  assert.equal(await p.evaluate(() => document.getElementById("logDlg").open), false);
}));

test("도움말 ?를 누르면 사용법 패널이 열리고 Esc로 닫힌다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.click("#helpBtn");
  assert.equal(await p.isVisible("#help"), true);
  assert.equal(await p.textContent("#helpBtn"), "×");
  assert.equal(await p.getAttribute("#helpBtn", "aria-expanded"), "true");
  await p.keyboard.press("Escape");
  assert.equal(await p.isHidden("#help"), true);
  assert.equal(await p.textContent("#helpBtn"), "?");
}));

test("도움말 패널은 바깥을 누르면 닫힌다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.click("#helpBtn");
  await p.click("#v-list h2");
  assert.equal(await p.isHidden("#help"), true);
}));

test("[BUG-18] 도움말의 안내가 지금 화면·저장 방식과 맞는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const text = await p.textContent("#help");
  const stale = ["이 브라우저에만", "맨 위 내 조건", "브라우저 기록을 지우거나 기기를 바꾸면 사라집니다"].filter(s => text.replace(/\s+/g, " ").includes(s));
  assert.deepEqual(stale, [], "로그인 계정 저장·⋯ 메뉴로 바뀐 뒤에도 남아 있는 옛 안내");
}));

test("[BUG-18] 페이지 설명(meta description)이 지금 저장 방식과 맞는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const desc = await p.getAttribute('meta[name="description"]', "content");
  assert.ok(!/브라우저에만 저장/.test(desc), "meta description: " + desc);
}));

async function theme(p){ await closeAll(p); await openMenu(p); await p.click("#themeBtn"); await p.waitForSelector("#themeDlg[open]"); }

test("테마 창에서 '어둡게'를 고르면 html에 data-theme=dark가 붙고, '밝게'는 light, '시스템 따라'는 속성을 뗀다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await theme(p);
  await p.click('#modeChips button:text-is("어둡게")');
  assert.equal(await html(p, "data-theme"), "dark");
  assert.equal(await p.getAttribute('#modeChips button:text-is("어둡게")', "aria-pressed"), "true");
  await p.click('#modeChips button:text-is("밝게")');
  assert.equal(await html(p, "data-theme"), "light");
  await p.click('#modeChips button:text-is("시스템 따라")');
  assert.equal(await html(p, "data-theme"), null);
  await p.click("#themeDone");
}));

test("테마 색 '더스티 블루'를 고르면 html의 data-accent가 sky가 되고 강조색 변수도 바뀐다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await theme(p);
  const before = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  await p.click('#accentChips button[aria-label="더스티 블루 테마"]');
  assert.equal(await html(p, "data-accent"), "sky");
  const after = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  assert.notEqual(after, before);
  assert.match(after, /^#[0-9a-f]{6}$|^rgb/i, "강조색 값(팔레트는 app.css가 정하므로 값 자체는 고정하지 않는다)");
  await p.click("#themeDone");
}));

test("고른 테마는 계정에 저장돼 새로고침해도 그대로다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await theme(p);
  const synced = waitForSync(p, d => d.profile.theme.mode === "dark" && d.profile.theme.accent === "sky");
  await p.click('#modeChips button:text-is("어둡게")');
  await p.click("#themeDone");
  await synced;
  await reloadApp(p);
  assert.equal(await html(p, "data-theme"), "dark");
  assert.equal(await html(p, "data-accent"), "sky");
  await snap(p, "theme-dark-sky-after-reload");
}));

test("[BUG-24] 백업에서 복원하면 백업에 든 테마가 바로 적용된다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  assert.equal(await html(p, "data-theme"), "dark", "앞 테스트에서 어둡게로 저장해 둠");
  await restoreSeed(p);           // 시드 테마: 시스템 따라 · 연두
  const got = [await html(p, "data-theme"), await html(p, "data-accent")];
  assert.deepEqual(got, [null, "lime"], "복원 뒤 html 속성(새로고침 전): " + JSON.stringify(got));
}));

/* ---------- 공고 제보(모든 사용자에게 보이는 공용 표) — 절대 올리지 않는다. 폼 검증까지만 ---------- */
async function share(p){ await closeAll(p); await reloadApp(p); await openMenu(p); await p.click("#shareBtn"); await p.waitForSelector("#shareDlg[open]"); }

test("공고 제보 창은 링크 없이 '올리기'를 누르면 막히고 아무것도 보내지 않는다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await share(p);
  assert.equal(await p.locator("#shareRoles button").count(), 14);
  await p.fill('#shareForm [name="company"]', "QA 제보 검증(올리지 않음)");
  await p.click("#shareSubmit");
  assert.equal(await p.evaluate(() => document.querySelector('#shareForm [name="url"]').validity.valueMissing), true);
  assert.equal(await p.evaluate(() => document.getElementById("shareDlg").open), true);
  assert.deepEqual(S.sharedWrites, [], "공용 표로 나간 쓰기 요청이 없어야 한다");
  await p.click("#shareCancel");
  assert.equal(await p.evaluate(() => document.getElementById("shareDlg").open), false);
}));

test("[BUG-12] 공고 제보 링크 칸은 http(s)가 아닌 주소(javascript: 등)를 받지 않는다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await share(p);
  await p.fill('#shareForm [name="company"]', "QA 제보 검증(올리지 않음)");
  await p.fill('#shareForm [name="url"]', "javascript:void(0)");
  const valid = await p.evaluate(() => document.getElementById("shareForm").checkValidity());   // 제출하지 않고 검증만
  await p.click("#shareCancel");
  assert.deepEqual(S.sharedWrites, []);
  assert.equal(valid, false, "모든 사용자에게 보일 링크에 javascript: 주소가 통과함");
}));

test("[BUG-12] 공고 추가 폼의 링크 칸도 http(s)가 아닌 주소를 받지 않는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.click("#addBtn");
  await p.fill('#form [name="company"]', "QA 링크 검증(저장 안 함)");
  await p.fill('#form [name="url"]', "javascript:void(0)");
  const valid = await p.evaluate(() => document.getElementById("form").checkValidity());
  await p.click("#cancelBtn");
  assert.equal(valid, false, "javascript: 주소가 통과함");
}));
