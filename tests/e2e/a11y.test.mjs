// 접근성 빠른 검사: 이름(라벨) 없는 입력·선택·버튼 · 휴대폰 터치 타깃 크기 · 상태 필·칩 글자 대비
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, tab, openMenu } from "./helpers.mjs";
import { open, finish, guard, closeAll, OUT, BASE } from "./support.mjs";

let S;
const M = {};
const g = guard(() => S.page, "a11y");
before(async () => { S = await open({ seed: true, tag: "a11y" }); }, { timeout: 120000 });
after(async () => { writeFileSync(join(OUT, "metrics-a11y.json"), JSON.stringify(M, null, 1)); await finish(S); });

/** 지금 보이는 입력·선택·글상자·버튼 가운데 이름이 없는 것 */
const unnamed = (p, scope) => p.evaluate(scope => {
  const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
  const name = el => (el.getAttribute("aria-label") || "").trim() || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || "").join("").trim()
    || (el.labels ? [...el.labels].map(l => l.textContent).join("").trim() : "") || (el.title || "").trim() || (el.tagName === "BUTTON" ? el.textContent.trim() : "");
  const desc = el => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") + (el.placeholder ? ` [placeholder="${el.placeholder.slice(0, 20)}"]` : "");
  const root = scope ? document.querySelector(scope) : document;   // 창(모달)이면 창 안만 센다 — 뒤 화면은 가려져 누를 수 없다
  const all = [...root.querySelectorAll('input:not([type="hidden"]), select, textarea, button')].filter(vis);
  const none = all.filter(el => !name(el));
  const symbolOnly = all.filter(el => el.tagName === "BUTTON" && !el.getAttribute("aria-label") && !el.title && /^[×?‹›⋯+\-▾▴]$/.test(el.textContent.trim()));
  return { controls: all.length, unnamed: none.length, placeholderOnly: none.filter(el => el.placeholder).length, symbolOnly: symbolOnly.length, examples: none.slice(0, 6).map(desc) };
}, scope);

test("[BUG-20] 화면마다 보이는 입력칸·선택칸·버튼은 모두 이름(라벨)이 있다", { timeout: 180000 }, g(async () => {
  const p = S.page;
  const views = {
    "전체 공고": async () => { await tab(p, "list"); },
    "내 지원 표": async () => { await tab(p, "mine"); await p.click("#mvTable"); },
    "내 지원 카드(접힌 칸 모두 펼침)": async () => { await tab(p, "mine"); await p.click("#mvCard"); await p.evaluate(() => document.querySelectorAll("#apps details").forEach(d => d.open = true)); },
    "캘린더": async () => { await tab(p, "cal"); },
    "주간 플래너": async () => { await tab(p, "plan"); },
    "아카이브 경험 정리": async () => { await tab(p, "arc"); await p.click('#arcTabs button[data-a="exp"]'); },
    "아카이브 마스터 자소서": async () => { await tab(p, "arc"); await p.click('#arcTabs button[data-a="cov"]'); },
    "채용 레이더": async () => { await tab(p, "radar"); await p.waitForSelector("#rdList li"); },
    "매칭 아카이브(입력칸 펼침)": async () => { await tab(p, "match"); await p.waitForFunction(() => mtData !== null, null, { timeout: 30000 }); await p.evaluate(() => { document.getElementById("mtSettings").open = true; document.getElementById("mtEditor").hidden = false; document.getElementById("liEditor").hidden = false; }); },
    "공고 추가 창": async () => { await tab(p, "list"); await p.click("#addBtn"); return "#dlg"; },
    "지원 현황표 창": async () => { await tab(p, "mine"); await p.click("#stBtn"); return "#stDlg"; },
    "공고 제보 창(올리지 않음)": async () => { await openMenu(p); await p.click("#shareBtn"); return "#shareDlg"; },
    "테마 창": async () => { await openMenu(p); await p.click("#themeBtn"); return "#themeDlg"; },
    "공고 상세 창": async () => { await tab(p, "list"); await p.locator("#rail .dchip").first().click(); return "#jobDlg"; },
  };
  M.labels = {};
  for(const [name, go] of Object.entries(views)){ await closeAll(p); const scope = await go(); await p.waitForTimeout(300); M.labels[name] = await unnamed(p, scope); }
  await closeAll(p); await p.click("#mvTable").catch(() => {}); await tab(p, "list");
  // 로그인 화면(로그아웃 상태)
  const L = await launch();
  try{ await L.page.goto(BASE + "/"); await L.page.waitForSelector("#authScreen:not([hidden])"); M.labels["로그인 화면"] = await unnamed(L.page, "#authScreen"); } finally { await L.browser.close(); }
  const total = Object.values(M.labels).reduce((n, v) => n + v.unnamed, 0);
  M.labelsTotalUnnamed = total;
  assert.equal(total, 0, "이름 없는 컨트롤: " + JSON.stringify(Object.fromEntries(Object.entries(M.labels).filter(([, v]) => v.unnamed).map(([k, v]) => [k, v.unnamed + "개 " + v.examples.join(" | ")]))));
}));

/* 2026-10-14 기준선 — 화면을 고친 뒤 이 수보다 늘면 회귀로 본다(줄면 기준선을 낮춰 적는다) */
const TOUCH_BASELINE_UNDER_24 = Number(process.env.JOBBOARD_TOUCH_BASELINE_24 || 0);

test("측정: 휴대폰(iPhone 14)에서 44×44px·24×24px보다 작은 터치 타깃 수", { timeout: 180000 }, g(async () => {
  const P = await open({ mobile: true, tag: "a11y-mobile" });
  try{
    const p = P.page;
    const count = () => p.evaluate(() => {
      const vis = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]") && !el.closest("dialog:not([open])");
      const els = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary')].filter(vis);
      const sz = el => { const t = (el.type === "checkbox" || el.type === "radio") && el.closest("label") ? el.closest("label") : el; const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
      const small = els.map(el => [el, sz(el)]).filter(([, [w, h]]) => w < 44 || h < 44);
      const tiny = small.filter(([, [w, h]]) => w < 24 || h < 24);
      const d = ([el, [w, h]]) => (el.textContent || el.getAttribute("aria-label") || el.type || el.tagName).trim().slice(0, 14) + " " + w + "×" + h;
      return { targets: els.length, under44: small.length, under24: tiny.length, examples44: small.slice(0, 6).map(d), examples24: tiny.slice(0, 6).map(d) };
    });
    M.touch = {};
    for(const [v, sub] of [["list"], ["mine", "#mvTable"], ["mine", "#mvCard"], ["cal"], ["plan"], ["arc"], ["radar"], ["match"]]){
      await closeAll(p); await p.evaluate(v => document.querySelector(`nav.tabs button[data-v="${v}"]`).click(), v);
      if(sub) await p.click(sub);
      await p.waitForTimeout(v === "radar" || v === "match" ? 2500 : 400);
      M.touch[v + (sub ? " " + sub : "")] = await count();
    }
    await p.click("#mvTable").catch(() => {});
  } finally { await finish(P); }
  M.touchTotals = Object.values(M.touch).reduce((o, v) => ({ targets: o.targets + v.targets, under44: o.under44 + v.under44, under24: o.under24 + v.under24 }), { targets: 0, under44: 0, under24: 0 });
  console.log("터치 타깃:", JSON.stringify(M.touchTotals));
  if(TOUCH_BASELINE_UNDER_24) assert.ok(M.touchTotals.under24 <= TOUCH_BASELINE_UNDER_24, `24px 미만 ${M.touchTotals.under24}개 > 기준선 ${TOUCH_BASELINE_UNDER_24}`);
}));

/** 글자색과 실제로 깔린 배경(투명이면 조상까지 올라가 겹쳐 계산)의 대비 */
const contrastOf = (p, probes) => p.evaluate(probes => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if(!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
  const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bot[i] * (1 - a)).concat(1); };
  const bgOf = el => { const layers = []; for(let x = el; x; x = x.parentElement){ const c = parse(getComputedStyle(x).backgroundColor); if(c[3] > 0) layers.push(c); if(c[3] >= 1) break; } let base = [255, 255, 255, 1]; for(let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return base; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
  const host = document.querySelector("#listBody tr td.co") || document.body;
  return probes.map(([tag, cls, label]) => {
    const el = document.createElement(tag); el.className = cls; el.textContent = label; if(tag === "button") el.type = "button";
    const wrap = cls.startsWith("__chip") ? Object.assign(document.createElement("div"), { className: "chips" }) : null;
    if(wrap){ el.className = ""; el.setAttribute("aria-pressed", "true"); wrap.append(el); host.append(wrap); } else host.append(el);
    const bg = bgOf(el), fg = over(parse(getComputedStyle(el).color), bg);
    const r = { probe: cls.replace("__chip", "선택된 칩"), label, ratio: ratio(fg, bg), fontPx: parseFloat(getComputedStyle(el).fontSize) };
    (wrap || el).remove(); return r;
  });
}, probes);
const PROBES = [["span", "pill p-open", "접수 중 D-3"], ["span", "pill p-soon", "예정 D-5"], ["span", "pill p-est", "예상"], ["span", "pill p-roll", "상시"], ["span", "pill p-shut", "마감"],
  ["span", "st-chip next", "1차 면접 준비"], ["span", "st-chip fail", "서류 불합격"], ["span", "st-chip wait", "결과 대기"], ["span", "rd-pill unstated", "연차 명시 없음"], ["span", "rd-pill senior", "3년 이상"],
  ["select", "tb-pill s-대기", "대기"], ["select", "tb-pill s-탈락", "탈락"], ["select", "tb-pill s-미지원", "미지원"],
  ["button", "__chip", "접수 중 56"], ["button", "primary", "저장"], ["span", "sub", "보조 설명 글자"]];

test("[BUG-19] 상태 필·칩·보조 글자는 밝은 화면과 어두운 화면 모두에서 배경 대비 4.5:1 이상이다", { timeout: 120000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await tab(p, "list");
  M.contrastLight = await contrastOf(p, PROBES);
  const D = await open({ dark: true, tag: "a11y-dark" });          // 시스템 다크 모드(계정 테마는 '시스템 따라')
  try{ M.contrastDark = await contrastOf(D.page, PROBES); } finally { await finish(D); }
  const low = [...M.contrastLight.map(x => ({ ...x, mode: "밝게" })), ...M.contrastDark.map(x => ({ ...x, mode: "어둡게" }))].filter(x => x.ratio < 4.5);
  M.contrastBelow45 = low;
  assert.deepEqual(low.map(x => `${x.mode} ${x.probe}(${x.label}) ${x.ratio}:1`), [], "4.5:1 미만");
}));
