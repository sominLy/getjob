// 아카이브 4개 하위 탭(경험 정리 · 마스터 자소서 · 마스터 이력서 · 마스터 포트폴리오) 입력과 저장
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, waitForSync, reloadApp } from "./support.mjs";

let S;
const g = guard(() => S.page, "archive");
before(async () => { S = await open({ seed: true, tag: "archive" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const STAMP = Date.now().toString(36);
const V = { title: "QA 경험 " + STAMP, tags: "기획, 운영", s: "QA 상황 — 신청이 메일로 흩어져 집계가 늦음", t: "QA 과제", a: "QA 행동", r: "QA 결과 — 집계 시간 0분",
  q: "QA 마스터 문항 " + STAMP, ans: "QA 마스터 답안 ".repeat(5).trim(), res: "[경력]\nQA 이력서 " + STAMP, pf: "[포트폴리오 링크] https://example.com/qa-" + STAMP };
async function sub(p, a){ await closeAll(p); await tab(p, "arc"); await p.click(`#arcTabs button[data-a="${a}"]`); }

test("아카이브는 하위 탭 4개로 열리고 처음에는 '경험 정리'가 눌려 있다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "arc");
  assert.deepEqual(await p.$$eval("#arcTabs button", bs => bs.map(b => b.textContent)), ["경험 정리", "마스터 자소서", "마스터 이력서", "마스터 포트폴리오"]);
  assert.equal(await p.getAttribute('#arcTabs button[data-a="exp"]', "aria-pressed"), "true");
}));

test("'+ 경험 추가'로 맨 앞에 카드가 생기고, 이름·태그·상황·과제·행동·결과를 쓰면 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await sub(p, "exp");
  const n = await p.locator("#arcBody .acard").count();
  await p.click('#arcBody button.primary:text-is("+ 경험 추가")');
  assert.equal(await p.locator("#arcBody .acard").count(), n + 1);
  const c = p.locator("#arcBody .acard").first();
  await c.locator("input.at").fill(V.title);
  await c.locator('input[aria-label^="태그"]').fill(V.tags);
  for(const [label, k] of [["상황", "s"], ["과제", "t"], ["행동", "a"], ["결과", "r"]]) await c.locator(`textarea[aria-label="${label}"]`).fill(V[k]);
  await c.locator('textarea[aria-label="결과"]').blur();
  await p.waitForFunction(r => db.arc.exp[0].r === r, V.r);
  const e = (await getDb(p)).arc.exp[0];
  assert.deepEqual([e.title, e.tags, e.s, e.t, e.a, e.r], [V.title, V.tags, V.s, V.t, V.a, V.r]);
}));

test("마스터 자소서 '+ 문항 추가'로 문항과 답안을 쓰면 글자수가 함께 보이고 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await sub(p, "cov");
  const n = await p.locator("#arcBody .qa").count();
  await p.click('#arcBody button.primary:text-is("+ 문항 추가")');
  const qa = p.locator("#arcBody .qa").nth(n);
  await qa.locator('input[aria-label="문항"]').fill(V.q);
  await qa.locator('textarea[aria-label="답안"]').fill(V.ans);
  assert.equal(await qa.locator(".qh .sub").textContent(), V.ans.length + "자");
  await qa.locator('textarea[aria-label="답안"]').blur();
  await p.waitForFunction(a => db.arc.cov.some(x => x.a === a), V.ans);
  assert.equal((await getDb(p)).arc.cov[n].q, V.q);
}));

test("마스터 이력서 칸에 쓰면 글자수가 바로 바뀌고 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await sub(p, "res");
  const ta = p.locator('#arcBody textarea[aria-label="마스터 이력서"]');
  await ta.fill(V.res);
  assert.match(await p.textContent("#arcBody .qa .sub"), new RegExp("\\(" + V.res.length + "자\\)$"));
  await ta.blur();
  await p.waitForFunction(v => db.arc.res === v, V.res);
}));

test("마스터 포트폴리오 칸에 쓰면 저장된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await sub(p, "pf");
  const ta = p.locator('#arcBody textarea[aria-label="마스터 포트폴리오"]');
  await ta.fill(V.pf);
  await ta.blur();
  await p.waitForFunction(v => db.arc.pf === v, V.pf);
}));

test("새로고침해도 아카이브 네 곳에 쓴 내용이 그대로 있다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  await waitForSync(p, d => d.arc.pf === V.pf && d.arc.res === V.res).catch(() => {});   // 마지막 저장이 이미 끝났으면 넘어간다
  await p.waitForTimeout(500);
  await reloadApp(p);
  await sub(p, "exp");
  assert.equal(await p.locator("#arcBody .acard").first().locator("input.at").inputValue(), V.title);
  await sub(p, "cov");
  assert.ok((await p.locator('#arcBody input[aria-label="문항"]').evaluateAll(xs => xs.map(x => x.value))).includes(V.q));
  await sub(p, "res");
  assert.equal(await p.inputValue('#arcBody textarea[aria-label="마스터 이력서"]'), V.res);
  await sub(p, "pf");
  assert.equal(await p.inputValue('#arcBody textarea[aria-label="마스터 포트폴리오"]'), V.pf);
  await snap(p, "archive-pf-after-reload");
}));
