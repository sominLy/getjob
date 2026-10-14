// 휴대폰(iPhone 14, 390×664): 목록 카드화 · 탭 줄 가로 스크롤 · 가로 넘침 · 캘린더 목록 · 창 폭
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, guard, snap, closeAll, todayKST } from "./support.mjs";

let S;
const g = guard(() => S.page, "mobile");
before(async () => { S = await open({ mobile: true, seed: true, tag: "mobile" }); }, { timeout: 120000 });
after(async () => { await finish(S); });

const css = (p, sel, prop) => p.$eval(sel, (el, prop) => getComputedStyle(el)[prop], prop);
const jsTab = (p, v) => p.evaluate(v => document.querySelector(`nav.tabs button[data-v="${v}"]`).click(), v);   // 앱이 직접 스크롤하는지 보려고 Playwright 자동 스크롤 없이 누른다

test("전체 공고 목록은 표 머리글 없이 한 공고씩 카드처럼 쌓인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  assert.equal(await p.evaluate(() => innerWidth), 390);
  assert.equal(await css(p, "#v-list thead", "display"), "none");
  assert.equal(await css(p, "#listBody tr", "display"), "grid");
  assert.equal(await css(p, "#listBody td.dt-start", "display"), "none");
  assert.equal(await p.locator("#listBody tr").first().locator("td.act").isVisible(), true);
  await snap(p, "mobile-list");
}));

test("탭 줄은 옆으로 밀 수 있고, 화면 밖 탭을 누르면 그 탭이 화면 안으로 들어온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const nav = await p.$eval("nav.tabs", n => ({ sw: n.scrollWidth, cw: n.clientWidth }));
  assert.ok(nav.sw > nav.cw, `탭 줄 너비 ${nav.sw} > 보이는 폭 ${nav.cw}`);
  await jsTab(p, "match");
  await p.waitForTimeout(900);                 // 부드러운 스크롤
  const r = await p.evaluate(() => { const n = document.querySelector("nav.tabs"), b = n.querySelector('button[data-v="match"]'), nr = n.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { inside: br.left >= nr.left - 1 && br.right <= nr.right + 1, scrollLeft: n.scrollLeft, selected: b.getAttribute("aria-selected") }; });
  assert.deepEqual([r.inside, r.selected], [true, "true"], JSON.stringify(r));
  assert.ok(r.scrollLeft > 0);
  await jsTab(p, "list");
}));

test("모든 탭(내 지원은 표·카드 둘 다)에서 화면이 가로로 넘치지 않는다(scrollWidth ≤ innerWidth)", { timeout: 120000 }, g(async () => {
  const p = S.page;
  const views = [["list"], ["mine", "#mvTable"], ["mine", "#mvCard"], ["cal"], ["plan"], ["arc"], ["radar"], ["match"]];
  const bad = [];
  for(const [v, sub] of views){
    await closeAll(p); await jsTab(p, v);
    if(sub) await p.click(sub);
    await p.waitForTimeout(v === "radar" || v === "match" ? 2500 : 500);
    const m = await p.evaluate(() => {
      const iw = innerWidth, sw = document.scrollingElement.scrollWidth;
      const scrollers = el => { for(let x = el.parentElement; x; x = x.parentElement){ const o = getComputedStyle(x).overflowX; if(o === "auto" || o === "scroll" || o === "hidden") return x !== document.body && x !== document.documentElement; } return false; };
      const wide = [...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > iw + 1 && !scrollers(el); })
        .slice(0, 5).map(el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + [...el.classList].join(".") + " right=" + Math.round(el.getBoundingClientRect().right));
      return { sw, iw, wide };
    });
    if(m.sw > m.iw) bad.push({ view: v + (sub ? " " + sub : ""), ...m });
    await snap(p, "mobile-" + v + (sub ? "-" + sub.slice(3).toLowerCase() : ""), true);
  }
  await jsTab(p, "list"); await p.click("#mvTable").catch(() => {});
  assert.deepEqual(bad, [], "가로로 넘친 화면");
}));

test("캘린더는 7칸 달력 대신 오늘부터의 날짜별 일정 목록으로 보인다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await jsTab(p, "cal");
  assert.equal(await css(p, ".cal", "display"), "none");
  const heads = await p.$$eval("#calList .cl-day .cl-h", hs => hs.map(h => h.textContent));
  assert.ok(heads.length > 0, "이번 달 남은 일정이 있어야 한다");
  const today = todayKST(), day = d => Number(d.match(/(\d+)일/)[1]);
  assert.ok(heads.every(h => day(h) >= Number(today.slice(8, 10))), "오늘 이전 날짜가 섞임: " + heads[0]);
  await snap(p, "mobile-calendar-list", true);
  await jsTab(p, "list");
}));

test("공고 상세 창과 공고 추가 창이 화면 폭 안에 들어온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p);
  await p.locator("#rail .dchip").first().click();
  await p.waitForSelector("#jobDlg[open]");
  const r1 = await p.$eval("#jobDlg", d => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, iw: innerWidth }; });
  await snap(p, "mobile-jobdlg");
  await p.click("#jdClose");
  await p.click("#addBtn");
  const r2 = await p.$eval("#dlg", d => { const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, iw: innerWidth }; });
  await p.click("#cancelBtn");
  for(const r of [r1, r2]) assert.ok(r.left >= 0 && r.right <= r.iw, JSON.stringify(r));
}));

test("내 지원 표는 좁은 화면에서 머리글 없이 카드형 줄로 바뀐다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await jsTab(p, "mine"); await p.click("#mvTable");
  assert.equal(await css(p, "#apps .tb thead", "display"), "none");
  assert.equal(await css(p, "#apps .tb tbody tr", "display"), "grid");
  await jsTab(p, "list");
}));
