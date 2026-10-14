// 채용 레이더(불러오기 · 필터 칩) · 매칭 아카이브(빈 상태 · 경험정리 붙여넣기로 키워드 뽑기)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, readJson, REPO } from "./support.mjs";

let S;
const g = guard(() => S.page, "radar-match");
before(async () => { S = await open({ seed: true, tag: "radar-match" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

/* 레이더 기본 필터: 경력 조건 3개(연차 제한 없음·연차 명시 없음·1–2년) · 4개 회사 · 모든 직무 유형 */
const RADAR = readJson(join(REPO, "data/radar.json"));
const RD_SRC = ["toss", "google", "notion", "anthropic"];
const RD_ROLES = ["프로덕트 기획","운영","마케팅·브랜드","솔루션·컨설팅","세일즈·파트너십","전략·재무","엔지니어링","HR","인재풀","기타"];
const rolesOf = j => (j.roles && j.roles.length) ? j.roles : ["기타"];
const shownBy = buckets => RADAR.jobs.filter(j => buckets.includes(j.bucket) && RD_SRC.includes(j.source) && rolesOf(j).some(r => RD_ROLES.includes(r))).length;
const rdRows = p => p.locator("#rdList li.rd-job");

test("채용 레이더 탭을 열면 수집 시각·개수 요약·공고 목록이 보인다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "radar");
  await p.waitForSelector("#rdList li", { timeout: 20000 });
  assert.match(await p.textContent("#rdStamp"), /서울 공고예요\. .* · 마지막 수집 /);
  const tally = await p.$$eval("#rdTally div", ds => ds.map(d => [d.querySelector("span").textContent, Number(d.querySelector("b").textContent)]));
  assert.deepEqual(tally[0], ["전체 공고", RADAR.jobs.length]);
  assert.equal(tally.length, 5);
  assert.equal(await rdRows(p).count(), shownBy(["open", "unstated", "junior"]));
  await snap(p, "radar");
}));

test("경력 조건 '3년 이상' 칩을 켜면 그만큼 목록이 늘고, 끄면 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "radar");
  const chip = p.locator("#rdBucket button", { hasText: /^3년 이상/ });
  assert.equal(await chip.getAttribute("aria-pressed"), "false");
  await chip.click();
  assert.equal(await chip.getAttribute("aria-pressed"), "true");
  assert.equal(await rdRows(p).count(), shownBy(["open", "unstated", "junior", "senior"]));
  await chip.click();
  assert.equal(await rdRows(p).count(), shownBy(["open", "unstated", "junior"]));
}));

test("'이번에 새로 뜬 공고만'을 켜면 NEW 표시가 있는 공고만 남는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "radar");
  const chip = p.locator("#rdExtra button", { hasText: "이번에 새로 뜬 공고만" });
  await chip.click();
  const n = await rdRows(p).count(), withNew = await p.locator("#rdList li.rd-job .rd-new").count();
  if(n) assert.equal(withNew, n); else assert.equal(await p.locator("#rdList li.rd-empty").count(), 1);
  await chip.click();
  assert.equal(await chip.getAttribute("aria-pressed"), "false");
}));

test("매칭 아카이브는 경험 키워드가 없으면 입력칸을 펼친 빈 상태로 열린다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  assert.equal(await p.isVisible('nav.tabs button[data-v="match"]'), true, "매칭 아카이브 탭이 누구에게나 보인다");
  await tab(p, "match");
  await p.waitForFunction(() => /아직 키워드가 없어요/.test(document.getElementById("mtMeStat").textContent), null, { timeout: 30000 });
  assert.equal(await p.isVisible("#mtEditor"), true);
  assert.equal(await p.evaluate(() => document.getElementById("mtSettings").open), true);
  assert.equal(await p.locator("#mtChips button").count(), 0);
  assert.equal((await p.textContent("#mtOut")).trim(), "");
  await snap(p, "match-empty", true);
}));

const PASTE = `# 사내 이벤트 신청 페이지 기획
신청 접수가 메일로 흩어져 집계가 늦어지는 문제를 정의하고, 요구사항을 정리해 화면 설계와 와이어프레임을 직접 만들었습니다. 오픈 뒤에는 지표를 보며 프로세스 개선을 이어 갔습니다.

# 사용자 인터뷰와 설문으로 서비스 기획
사용자 인터뷰 8회와 설문 조사를 설계해 인사이트를 도출하고, 서비스 기획 문서와 가이드를 작성해 유관 부서와 협업했습니다.

# 데이터로 캠페인 성과 보기
SQL과 GA로 퍼널 지표를 분석하고 KPI 대시보드를 만들어 마케팅 캠페인 성과를 매주 보고했습니다. A/B 테스트를 설계해 전환율을 비교했습니다.`;

test("경험정리를 붙여넣고 '키워드 뽑기'를 누르면 경험 카드가 아카이브에 생기고 키워드 칩이 나온다", { timeout: 60000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "match");
  await p.waitForFunction(() => mtDict !== null, null, { timeout: 30000 });
  const manual = (await getDb(p)).arc.exp.filter(e => e.src !== "paste").length;
  await p.fill("#mtText", PASTE);
  await p.click("#mtRunBtn");
  await p.waitForFunction(() => document.getElementById("toast").textContent === "경험 3개를 아카이브에 보관하고 키워드를 저장했어요");
  const d = await getDb(p);
  assert.equal(d.arc.exp.filter(e => e.src === "paste").length, 3);
  assert.equal(d.arc.exp.filter(e => e.src !== "paste").length, manual, "직접 쓴 경험 카드는 그대로");
  assert.ok(Object.keys(d.match.counts).length >= 5, "뽑힌 키워드: " + Object.keys(d.match.counts).join(","));
  assert.ok(await p.locator("#mtChips button").count() >= 5);
  assert.match(await p.textContent("#mtMeStat"), /^경험 \d+개에서 뽑음/);
  assert.notEqual((await p.textContent("#mtOut")).trim(), "", "매칭 결과(또는 결과 없음 안내)가 보인다");
  await snap(p, "match-after-paste", true);
}));

test("키워드 칩을 누르면 내 키워드에서 빼고, 다시 누르면 돌아온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "match");
  const chip = p.locator('#mtChips button[aria-pressed="true"]').first();
  const label = (await chip.textContent()).replace(/ \d+$/, "");
  await chip.click();
  await p.waitForFunction(k => db.match.off.includes(k), label);
  assert.equal(await p.locator("#mtChips button", { hasText: new RegExp("^" + label + " \\d+$") }).getAttribute("aria-pressed"), "false");
  await p.locator("#mtChips button", { hasText: new RegExp("^" + label + " \\d+$") }).click();
  await p.waitForFunction(k => !db.match.off.includes(k), label);
}));
