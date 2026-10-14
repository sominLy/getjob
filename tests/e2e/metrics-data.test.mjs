// 저장 데이터 측정: 빈 기록 수 · 업로드 크기 · localStorage 크기 (브리핑의 '저장 데이터 비대화' 재현)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tab } from "./helpers.mjs";
import { open, finish, guard, closeAll, restoreSeed, isEmptyRecord, OUT, seedDb } from "./support.mjs";

let S;
const M = {};
const g = guard(() => S.page, "metrics-data");
let release;
const gate = new Promise(r => { release = r; });
before(async () => {
  // 지난 공고(archive.json)는 3번째 측정 전까지 붙잡아 둔다 — 로그인 직후 '예상→실제' 옮기기가 보관함을 미리 불러오면 첫 화면 측정이 섞이기 때문
  S = await open({ tag: "metrics-data", routes: async s => { await s.ctx.route("**/data/archive.json*", async route => { await gate; await route.continue().catch(() => {}); }); } });
}, { timeout: 120000 });
after(async () => { release(); writeFileSync(join(OUT, "metrics-data.json"), JSON.stringify(M, null, 1)); await finish(S); });

const kb = n => Math.round(n / 102.4) / 10;
function measure(db, raw){
  const apps = Object.values(db.apps), empty = apps.filter(isEmptyRecord).length;
  const slim = { ...db, apps: Object.fromEntries(Object.entries(db.apps).filter(([, a]) => !isEmptyRecord(a))) };
  return { records: apps.length, empty, kept: apps.length - empty, kb: kb(Buffer.byteLength(raw)), kbWithoutEmpty: kb(Buffer.byteLength(JSON.stringify(slim))) };
}
/** 아무 내용도 바꾸지 않는 저장 한 번(☆ 관심을 켰다 끔) — localStorage에 메모리의 db를 그대로 쓰게 한다 */
async function touchSave(p){
  const row = p.locator("#listBody tr").filter({ has: p.locator("td.act button", { hasText: /^☆ 관심$/ }) }).first();
  const co = await row.locator("td.co").evaluate(td => td.firstChild.textContent);
  await row.locator("td.act button", { hasText: "관심" }).click();
  await p.locator("#listBody tr").filter({ has: p.locator("td.co", { hasText: co }) }).locator("td.act button.on", { hasText: "★ 관심" }).first().click();
}

test("측정: 시드(기록 14개)를 복원하면 첫 업로드에 몇 개의 기록이 실리는가", { timeout: 60000 }, g(async () => {
  const p = S.page;
  const req = p.waitForRequest(r => r.url().includes("/rest/v1/jobboard_data") && ["POST", "PATCH"].includes(r.method()), { timeout: 15000 });
  await restoreSeed(p);
  const body = (await req).postData();
  M.seedRecords = Object.keys(seedDb().apps).length;
  M.afterRestoreUpload = measure(JSON.parse(body).data, body);
  assert.ok(M.afterRestoreUpload.records >= M.seedRecords);
}));

test("측정: 첫 화면을 그린 뒤 저장하면 localStorage(jobboard-v2:<uid>)에 들어간 기록", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  await touchSave(p);
  const raw = await p.evaluate(() => localStorage.getItem("jobboard-v2:" + currentUserId));
  M.afterFirstRender = measure(JSON.parse(raw), raw);
  M.jobsInView = await p.evaluate(() => ({ seed: SEED.length, archive: ARCHIVE.length, allJobs: allJobs().length }));
}));

test("측정: '마감' 필터로 지난 공고(보관함)까지 불러온 뒤 저장하면 늘어나는 기록", { timeout: 60000 }, g(async () => {
  const p = S.page;
  release();
  await p.locator("#filters button", { hasText: /^마감 \d+$/ }).click();
  await p.waitForFunction(() => ARCHIVE.length > 0, null, { timeout: 20000 });
  await p.locator("#filters button", { hasText: /^접수 중 \d+$/ }).click();
  await touchSave(p);
  const raw = await p.evaluate(() => localStorage.getItem("jobboard-v2:" + currentUserId));
  M.afterArchive = measure(JSON.parse(raw), raw);
  M.jobsInViewAfterArchive = await p.evaluate(() => ({ seed: SEED.length, archive: ARCHIVE.length, allJobs: allJobs().length }));
  console.log("저장 데이터 측정:", JSON.stringify(M));
}));

test("[BUG-05] 공고를 보기만 해서는 저장 데이터에 빈 기록이 생기지 않는다", { timeout: 30000 }, g(async () => {
  assert.ok(M.afterFirstRender, "앞 측정이 있어야 한다");
  assert.equal(M.afterFirstRender.empty, 0,
    `첫 화면 뒤 기록 ${M.afterFirstRender.records}개 중 빈 기록 ${M.afterFirstRender.empty}개(${M.afterFirstRender.kb}KB, 빼면 ${M.afterFirstRender.kbWithoutEmpty}KB) · 보관함까지 보면 ${M.afterArchive && M.afterArchive.empty}개(${M.afterArchive && M.afterArchive.kb}KB)`);
}));
