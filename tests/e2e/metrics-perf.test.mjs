// 성능 측정: 첫 화면 시간 · renderAll() 5회 평균(데스크톱/휴대폰, CPU 4배 느리게) · 내려받는 데이터 크기
// 기계 부하에 따라 값이 흔들리므로 측정 시점의 load average를 함께 남긴다. 합격/불합격 기준 없이 기록만 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { gzipSync } from "node:zlib";
import { launch, creds, tab, openMenu } from "./helpers.mjs";
import { open, finish, guard, closeAll, ready, OUT, BASE } from "./support.mjs";

let S;
const M = { measuredAt: new Date().toISOString(), loadavg: os.loadavg().map(x => +x.toFixed(2)), cpus: os.cpus().length };
const g = guard(() => S.page, "metrics-perf");
before(async () => { S = await open({ seed: true, tag: "metrics-perf" }); }, { timeout: 120000 });
after(async () => { M.loadavgEnd = os.loadavg().map(x => +x.toFixed(2)); writeFileSync(join(OUT, "metrics-perf.json"), JSON.stringify(M, null, 1)); await finish(S); });

const stats = a => ({ avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1), runs: a.map(x => +x.toFixed(1)) });
const timeRenderAll = (p, n = 5) => p.evaluate(n => { renderAll(); const out = []; for(let i = 0; i < n; i++){ const s = performance.now(); renderAll(); out.push(performance.now() - s); } return out; }, n);
const parts = p => p.evaluate(() => Object.fromEntries(["renderRail", "renderList", "renderMine", "renderCal", "renderWeek", "renderArc"].map(f => { const s = performance.now(); window[f](); return [f, +(performance.now() - s).toFixed(1)]; }).concat([["scoped", (() => { const s = performance.now(); scoped(); return +(performance.now() - s).toFixed(1); })()]])));

test("측정: 로그인 화면에서 로그인한 뒤 공고 목록이 다 그려질 때까지(데스크톱, 새 세션)", { timeout: 90000 }, g(async () => {
  const L = await launch();
  try{
    const c = creds(), t0 = Date.now();
    await L.page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await L.page.waitForSelector("#authScreen:not([hidden])");
    const tAuth = Date.now();
    await L.page.fill("#authEmail", c.email); await L.page.fill("#authPw", c.password);
    const tSubmit = Date.now();
    await L.page.click("#authSubmit");
    await ready(L.page);
    M.firstLoadFreshLogin = { toLoginScreenMs: tAuth - t0, submitToListMs: Date.now() - tSubmit };
    const t1 = Date.now();
    await L.page.reload({ waitUntil: "domcontentloaded" });
    await ready(L.page);
    M.reloadWithSessionMs = Date.now() - t1;
  } finally { await L.browser.close(); }
  assert.ok(M.firstLoadFreshLogin.submitToListMs > 0);
}));

test("측정: renderAll() 5회 평균 — 데스크톱 1280×900, 보관함 안 불러온 상태", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  M.desktop = { jobs: await p.evaluate(() => allJobs().length), renderAll: stats(await timeRenderAll(p)), parts: await parts(p) };
  assert.ok(M.desktop.renderAll.avg > 0);
}));

test("측정: renderAll() 5회 평균 — 데스크톱, '마감' 필터로 보관함까지 불러온 상태", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await p.locator("#filters button", { hasText: /^마감 \d+$/ }).click();
  await p.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 20000 });
  M.desktopWithArchive = { jobs: await p.evaluate(() => allJobs().length), renderAll: stats(await timeRenderAll(p)), parts: await parts(p) };
  await p.locator("#filters button", { hasText: /^접수 중 \d+$/ }).click();
}));

test("측정: renderAll() 5회 평균 — 휴대폰(iPhone 14) 에뮬레이션, CPU 그대로 / 4배 느리게 / 4배+보관함", { timeout: 180000 }, g(async () => {
  let release; const gate = new Promise(r => { release = r; });
  // 데스크톱 첫 측정과 같은 조건(보관함 안 불러온 655건)으로 맞추려고 archive.json을 잠시 붙잡아 둔다
  const P = await open({ mobile: true, tag: "metrics-perf-mobile", routes: async s => { await s.ctx.route("**/data/archive.json*", async route => { await gate; await route.continue().catch(() => {}); }); } });
  try{
    const cdp = await P.ctx.newCDPSession(P.page);
    const jobs = () => P.page.evaluate(() => allJobs().length);
    M.mobile = { jobs: await jobs(), renderAll: stats(await timeRenderAll(P.page)) };
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    M.mobileCpu4x = { jobs: await jobs(), renderAll: stats(await timeRenderAll(P.page)), parts: await parts(P.page) };
    release();
    await P.page.evaluate(() => loadArchive());
    await P.page.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 30000 });
    M.mobileCpu4xWithArchive = { jobs: await jobs(), renderAll: stats(await timeRenderAll(P.page)), parts: await parts(P.page) };
    const t0 = Date.now();
    await P.page.reload({ waitUntil: "domcontentloaded" });
    await ready(P.page);
    M.mobileCpu4xReloadToListMs = Date.now() - t0;
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  } finally { release(); await finish(P); }
}));

test("측정: 화면별로 내려받는 데이터 크기(원본·gzip)", { timeout: 120000 }, g(async () => {
  const R = await launch({ context: {} });
  const got = [];
  R.page.on("response", async r => {
    const step = R.step, u = new URL(r.url());
    if(!(u.origin === new URL(BASE).origin || u.hostname.endsWith("supabase.co") || u.hostname.includes("jsdelivr") || u.hostname.includes("cdnjs"))) return;
    let bytes = null, gz = null;
    try{ const b = await r.body(); bytes = b.length; gz = gzipSync(b).length; }catch{}
    got.push({ step, path: u.hostname === new URL(BASE).hostname ? u.pathname : u.hostname + u.pathname, status: r.status(), kb: bytes == null ? null : +(bytes / 1024).toFixed(1), gzipKb: gz == null ? null : +(gz / 1024).toFixed(1) });
  });
  try{
    R.step = "로그인~첫 화면";
    const c = creds();
    await R.page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await R.page.waitForSelector("#authScreen:not([hidden]), #appWrap:not([hidden])");
    if(await R.page.isVisible("#authScreen")){ await R.page.fill("#authEmail", c.email); await R.page.fill("#authPw", c.password); await R.page.click("#authSubmit"); }
    await ready(R.page);
    if(await R.page.evaluate(() => document.getElementById("prefDlg").open)) await R.page.evaluate(() => document.getElementById("prefDlg").close());
    await R.page.waitForTimeout(1000);
    R.step = "공고 상세 열기"; await R.page.locator("#rail .dchip").first().click(); await R.page.waitForFunction(() => DETAILS !== null, null, { timeout: 60000 }); await R.page.waitForTimeout(800); await R.page.click("#jdClose");
    R.step = "마감 필터"; await R.page.locator("#filters button", { hasText: /^마감 \d+$/ }).click(); await R.page.waitForFunction(() => ARCHIVE.length > 0); await R.page.waitForTimeout(500);
    R.step = "채용 레이더"; await tab(R.page, "radar"); await R.page.waitForSelector("#rdList li"); await R.page.waitForTimeout(500);
    R.step = "매칭 아카이브"; await tab(R.page, "match"); await R.page.waitForFunction(() => mtData !== null, null, { timeout: 30000 }); await R.page.waitForTimeout(1500);
    R.step = "업데이트 기록"; await openMenu(R.page); await R.page.click("#logBtn"); await R.page.waitForSelector("#logBody details.log-day", { timeout: 30000 }); await R.page.waitForTimeout(500);
  } finally { await R.browser.close(); }
  M.transfer = got.filter(x => !x.path.endsWith("favicon.svg"));
  M.transferByStep = Object.entries(M.transfer.reduce((o, x) => { (o[x.step] = o[x.step] || { kb: 0, gzipKb: 0, files: [] }); o[x.step].kb += x.kb || 0; o[x.step].gzipKb += x.gzipKb || 0; o[x.step].files.push(x.path); return o; }, {}))
    .map(([step, v]) => ({ step, kb: +v.kb.toFixed(1), gzipKb: +v.gzipKb.toFixed(1), files: v.files }));
  console.log(JSON.stringify(M.transferByStep.map(x => [x.step, x.kb, x.gzipKb])));
  assert.ok(M.transfer.some(x => x.path === "/data/jobs.json"));
}));
