// 로그인 화면 · 로그인 · 내 계정 · 로그아웃
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, creds } from "./helpers.mjs";
import { open, finish, restoreSeed, dropSession, guard, snap, BASE } from "./support.mjs";

let S, bad;
const g = guard(() => (S || bad).page, "auth");

before(async () => {
  bad = await launch();               // 저장 세션 없이 — 로그인 화면부터
  bad.tag = "auth-badpw"; bad.http = []; bad.failed = []; bad.dialogs = []; bad.sharedWrites = [];
}, { timeout: 60000 });
after(async () => { await finish(bad); await finish(S); });

test("틀린 비밀번호로 로그인하면 오류 문구가 보인다", { timeout: 60000 }, g(async () => {
  const p = bad.page;
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#authScreen:not([hidden])", { timeout: 20000 });
  await p.fill("#authEmail", creds().email);
  await p.fill("#authPw", "wrong-password-0000");
  await p.click("#authSubmit");
  await p.waitForSelector("#authMsg:not([hidden])", { timeout: 20000 });
  assert.equal(await p.textContent("#authMsg"), "이메일이나 비밀번호가 맞지 않아요.");
  assert.equal(await p.isHidden("#appWrap"), true, "앱 화면은 열리지 않아야 한다");
  await snap(p, "auth-wrong-password");
}));

test("가입하기 전환 버튼이 제출 버튼 글자를 바꾼다", { timeout: 30000 }, g(async () => {
  const p = bad.page;
  await p.click("#authSwitch");
  assert.equal(await p.textContent("#authSubmit"), "가입하기");
  assert.equal(await p.isHidden("#authMsg"), true, "전환하면 이전 오류 문구는 숨는다");
  await p.click("#authSwitch");
  assert.equal(await p.textContent("#authSubmit"), "로그인");
}));

test("QA 계정으로 로그인하면 전체 공고 목록이 보인다", { timeout: 90000 }, g(async () => {
  S = await open({ fresh: true, tag: "auth" });
  const p = S.page;
  assert.equal(await p.isVisible("#appHeader"), true);
  assert.equal(await p.isHidden("#authScreen"), true);
  assert.ok(await p.locator("#listBody tr").count() > 0);
  assert.equal(await p.getAttribute('nav.tabs button[data-v="list"]', "aria-selected"), "true");
  await restoreSeed(p);
}));

test("내 계정 창에 로그인 아이디와 지원 건수가 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await p.click("#meBtn");
  await p.waitForSelector("#meDlg[open]");
  const rows = await p.$$eval("#meBody dt", dts => dts.map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  const m = Object.fromEntries(rows);
  assert.equal(m["로그인 아이디"], creds().email);
  assert.equal(m["내 지원"], "10건");
  assert.equal(await p.isVisible("#meDlg"), true);
  await p.click("#meClose");
  assert.equal(await p.locator("#meDlg[open]").count(), 0);
}));

test("메뉴의 로그아웃을 누르면 로그인 화면으로 돌아간다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await p.click("#menuBtn");
  await p.click("#logoutBtn");
  await p.waitForSelector("#authScreen:not([hidden])", { timeout: 15000 });
  dropSession();   // 로그아웃은 같은 계정의 다른 세션 갱신 토큰도 끊으므로 저장 세션을 버린다
  assert.equal(await p.isHidden("#appWrap"), true);
  assert.equal(await p.isHidden("#appHeader"), true);
}));

test("[BUG-11] 로그아웃하면 이 브라우저에 지난 계정의 지원 기록이 남지 않는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  // 계정별 사본(jobboard-v2:<uid>)·예전 사본(jobboard-v2)·이동 전 사본(jobboard-v2-snapshot) 모두 없어야 한다(B26)
  const left = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("jobboard-v2")).map(k => {
    const raw = localStorage.getItem(k); let applied = null;
    try{ const d = JSON.parse(raw); applied = Object.values((d.apps || (d.db && d.db.apps)) || {}).filter(a => a.applied).length; }catch{}
    return { k: k.replace(/:.*/, ":<uid>"), bytes: raw.length, applied };
  }));
  assert.deepEqual(left, [], "로그아웃 뒤 localStorage에 이전 계정 데이터가 남아 있음: " + JSON.stringify(left));
}));
