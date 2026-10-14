// 콘솔 오류·페이지 오류·HTTP 4xx/5xx 전수 기록: 모든 탭과 창을 한 번씩 돌아본다
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tab, openMenu } from "./helpers.mjs";
import { open, finish, guard, closeAll, OUT } from "./support.mjs";

let S;
const g = guard(() => S.page, "console");
before(async () => {
  S = await open({ seed: true, tag: "console-errors" });
  const p = S.page;
  const steps = [
    async () => { await tab(p, "list"); for(const f of ["전체", "새로 뜸", "관심", "오픈 예정", "예상", "상시", "마감", "접수 중"]) await p.locator("#filters button", { hasText: new RegExp("^" + f + " \\d+$") }).click(); },
    async () => { await p.locator("#rail .dchip").first().click(); await p.waitForFunction(() => DETAILS !== null, null, { timeout: 60000 }); await p.click("#jdClose"); },
    async () => { await tab(p, "mine"); await p.click("#mvTable"); await p.click("#mvCard"); await p.click("#stBtn"); await p.click("#stClose"); await p.click("#mvTable"); },
    async () => { await tab(p, "cal"); await p.click("#mNext"); await p.click("#mPrev"); },
    async () => { await tab(p, "plan"); await p.click("#wNext"); await p.click("#wToday"); },
    async () => { await tab(p, "arc"); for(const a of ["exp", "cov", "res", "pf"]) await p.click(`#arcTabs button[data-a="${a}"]`); },
    async () => { await tab(p, "radar"); await p.waitForSelector("#rdList li", { timeout: 20000 }); },
    async () => { await tab(p, "match"); await p.waitForFunction(() => mtData !== null, null, { timeout: 30000 }); await p.waitForTimeout(1000); },
    async () => { await tab(p, "list"); await p.click("#addBtn"); await p.click("#cancelBtn"); },
    async () => { for(const b of ["#prefBtn", "#themeBtn", "#logBtn", "#shareBtn"]){ await openMenu(p); await p.click(b); await p.waitForTimeout(b === "#logBtn" ? 1500 : 200); await closeAll(p); } },
    async () => { await p.click("#meBtn"); await p.click("#meClose"); await p.click("#helpBtn"); await p.keyboard.press("Escape"); },
  ];
  for(const s of steps){ await closeAll(p); await s(); }
  await p.waitForTimeout(1000);
  writeFileSync(join(OUT, "console-summary.json"), JSON.stringify({ consoleErrors: S.consoleErrors, http: S.http, failed: S.failed }, null, 1));
}, { timeout: 300000 });
after(async () => { await finish(S); });

test("모든 탭과 창을 돌아다녀도 페이지 스크립트 오류(pageerror)가 없다", { timeout: 30000 }, g(async () => {
  assert.deepEqual(S.consoleErrors.filter(e => e.startsWith("pageerror")), []);
}));

test("앱이 받아 오는 이 사이트의 파일(data/*.json·아이콘)에 404·실패가 없다", { timeout: 30000 }, g(async () => {
  const local = S.http.filter(h => h.url.startsWith("http://127.0.0.1") || h.url.startsWith("http://localhost"));
  assert.deepEqual(local, []);
  assert.deepEqual(S.failed.filter(f => !/ERR_ABORTED/.test(f.error || "")), []);
}));

test("[BUG-10] 공용 제보 목록(jobboard_shared_jobs)을 불러오는 요청이 404 없이 성공한다", { timeout: 30000 }, g(async () => {
  const bad = S.http.filter(h => h.url.includes("/rest/v1/jobboard_shared_jobs"));
  assert.deepEqual(bad.map(h => h.status + " " + h.method + " " + h.url.replace(/^https:\/\/[^/]+/, "")), [], "공고 제보 표가 서버에 없어 매번 404(제보 기능 전체가 동작하지 않음)");
}));

test("콘솔 오류는 위 404 말고는 없다", { timeout: 30000 }, g(async () => {
  const other = S.consoleErrors.filter(e => !e.startsWith("pageerror") && !/status of 404/.test(e));
  assert.deepEqual(other, []);
}));
