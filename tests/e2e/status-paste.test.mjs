// 지원 현황표 붙여넣기: 한 줄 형식 · 표 형식 미리보기 · 반영
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tab } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll } from "./support.mjs";

let S, J;
const g = guard(() => S.page, "status-paste");
before(async () => {
  S = await open({ seed: true, tag: "status-paste" });
  J = await S.page.evaluate(() => Object.fromEntries(["shinhan-life", "wanted-384558", "wanted-384515"].map(id => [id, (allJobs().find(j => j.id === id) || {}).company])));
  assert.ok(Object.values(J).every(Boolean), "시드가 참조하는 공고가 데이터에 없음 — 시드 갱신 필요");
}, { timeout: 120000 });
after(async () => { await finish(S); });

const short = co => co.split(/[(·]/)[0];       // '마드라스체크(플로우)' → '마드라스체크'
async function openSt(p){ await closeAll(p); await tab(p, "mine"); await p.click("#stBtn"); await p.waitForSelector("#stDlg[open]"); }
async function preview(p, text){
  await p.fill("#stText", text);
  await p.click("#stPrevBtn");
  await p.waitForSelector("#stPreview table, #stPreview:not(:empty)");
  return p.$$eval("#stPreview tbody tr", trs => trs.map(tr => [...tr.cells].map(c => c.textContent)));
}
const oneLine = () => [`${J["shinhan-life"]} 탈락`, `${J["wanted-384558"]} 서류합격`, "QA가상회사 대기", `${short(J["wanted-384515"])} 안씀`].join("\n");

test("현황표 창을 열면 미리보기 전에는 '반영' 버튼이 꺼져 있다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await openSt(p);
  assert.equal(await p.isDisabled("#stApply"), true);
  await p.click("#stClose");
}));

test("한 줄 형식(회사 상태)을 미리보면 줄마다 상태와 연결될 공고가 표로 나온다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await openSt(p);
  const rows = await preview(p, oneLine());
  assert.deepEqual(rows.map(r => r[0]), ["탈락", "합격", "결과 대기", "미지원"]);
  assert.ok(rows[0][2].startsWith(J["shinhan-life"]), rows[0][2]);
  assert.ok(rows[1][2].startsWith(J["wanted-384558"]), rows[1][2]);
  assert.equal(rows[2][2], "새로 추가(직접 등록)");
  assert.ok(rows[3][2].startsWith(J["wanted-384515"]), rows[3][2]);
  assert.equal(await p.isEnabled("#stApply"), true);
  await snap(p, "status-paste-oneline");
  await p.click("#stClose");
}));

test("표 형식(## 제목 + 마크다운 표)을 미리보면 제목별 상태와 떨어진 단계를 읽는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await openSt(p);
  const md = ["## 1. 합격", "| 기업 | 직무 | 단계 |", "|---|---|---|", `| ${J["shinhan-life"]} | 기획 | 1차 면접 |`, "",
              "## 2. 탈락 확정", "| 기업 | 직무 | 떨어진 단계 |", "|---|---|---|", `| ${J["wanted-384558"]} | PM | 1차 면접 |`].join("\n");
  const rows = await preview(p, md);
  assert.deepEqual(rows.map(r => r.slice(0, 2)), [["합격", J["shinhan-life"] + " · 기획"], ["탈락 (1차 면접)", J["wanted-384558"] + " · PM"]]);
  await p.click("#stClose");
}));

test("'반영'을 누르면 미리본 대로 상태가 바뀌고 없는 회사는 직접 등록으로 추가된다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await openSt(p);
  await preview(p, oneLine());
  await p.click("#stApply");
  await p.waitForFunction(() => !document.getElementById("stDlg").open);
  assert.match(await p.textContent("#toast"), /^반영했어요 · 연결 2건 · 새로 추가 1건 · 미지원 1건/);
  const d = await getDb(p);
  assert.deepEqual([d.apps["shinhan-life"].applied, d.apps["shinhan-life"].doc], [true, "불합격"]);
  assert.deepEqual([d.apps["wanted-384558"].applied, d.apps["wanted-384558"].doc], [true, "합격"]);
  assert.deepEqual([d.apps["wanted-384515"].applied, d.apps["wanted-384515"].skip], [false, true]);
  const c = d.custom.find(x => x.company === "QA가상회사");
  assert.ok(c && d.apps[c.id].applied && d.apps[c.id].doc === "대기");
}));

test("[BUG-08] 한 줄 형식에 '불합격'이라고 쓰면 탈락으로 읽는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await openSt(p);
  const rows = await preview(p, `${J["wanted-384558"]} 불합격\n${J["shinhan-life"]} 서류 불합격`);
  await snap(p, "bug-paste-fail-as-pass");
  await p.click("#stClose");
  assert.deepEqual(rows.map(r => r[0]), ["탈락", "탈락"], "미리보기: " + JSON.stringify(rows.map(r => r.slice(0, 2))));
}));
