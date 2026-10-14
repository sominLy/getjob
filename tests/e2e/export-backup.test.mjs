// 일정 내보내기(.ics) · 백업 받기 · 복원 라운드트립 · 잘못된/불완전한 백업
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tab, openMenu, restore } from "./helpers.mjs";
import { open, finish, getDb, guard, snap, closeAll, setPrompt, downloadText, restoreSeed, reloadApp, seedDb, jobsData, todayKST, OUT, isEmptyRecord, waitForSync } from "./support.mjs";

let S, BACKUP;
const g = guard(() => S.page, "export");
before(async () => { S = await open({ seed: true, tag: "export-backup" }); }, { timeout: 120000 });
after(async () => { setPrompt(null); await finish(S); });

/** 시드와 공고 데이터만으로 따로 계산한 일정 파일 기대값 */
function expectedIcs(){
  const seed = seedDb(), jobs = new Map(jobsData().jobs.concat(seed.custom).map(j => [j.id, j]));
  const out = [];
  for(const [id, a] of Object.entries(seed.apps)){
    const j = jobs.get(id); if(!a.applied || !j) continue;
    const dl = a.myEnd || j.end;
    if(dl && a.doc === "대기") out.push({ co: j.company, what: "서류 마감", date: dl, time: a.myEndTime || (a.myEnd ? "" : j.endTime || "") });
    for(const s of a.stages || []) if(s.date && s.result !== "불합격") out.push({ co: j.company, what: s.name, date: s.date, time: s.time || "", allDay: !s.time });
  }
  return out.filter(w => w.date >= todayKST());   // 이미 지난 일정은 넣지 않는다(BUG-25)
}
const kstToUtc = (date, time) => { const [h, m] = (time || "23:59").split(":").map(Number); return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - 9, m)).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; };
async function ics(p){ await closeAll(p); await openMenu(p); return downloadText(p, () => p.click("#icsBtn")); }
const vevents = text => text.replace(/\r\n[ \t]/g, "").split("BEGIN:VEVENT").slice(1).map(b => Object.fromEntries(b.split("\r\n").filter(l => /^[A-Z]+[:;]/.test(l)).map(l => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1)])));

test("일정 내보내기(.ics)에는 서류 마감과 전형 일정이 하나씩 VEVENT로 들어간다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const want = expectedIcs();
  const { name, text, failure } = await ics(p);
  assert.equal(failure, null);
  assert.equal(name, "지원보드-일정.ics");
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.trimEnd().endsWith("END:VCALENDAR"));
  const ev = vevents(text);
  assert.equal(ev.length, want.length, `VEVENT ${ev.length}개, 기대 ${want.length}개(마감 ${want.filter(w => w.what === "서류 마감").length} · 전형 ${want.filter(w => w.what !== "서류 마감").length})`);
  assert.equal(ev.filter(e => / 서류 마감$/.test(e.SUMMARY)).length, want.filter(w => w.what === "서류 마감").length);
  for(const w of want){
    const e = ev.find(x => x.SUMMARY === (w.co + " " + w.what).replace(/([,;\\])/g, "\\$1"));
    assert.ok(e, "없는 일정: " + w.co + " " + w.what);
    if(w.allDay) assert.equal(e["DTSTART;VALUE=DATE"], w.date.replace(/-/g, ""), w.co + " " + w.what + " — 시각 모르는 전형은 종일 일정");
    else assert.equal(e.DTSTART, kstToUtc(w.date, w.time), w.co + " " + w.what + " 시각(시각 모르면 그날 23:59 KST)");
  }
  assert.equal((text.match(/BEGIN:VALARM/g) || []).length, want.reduce((n, w) => n + (w.what === "서류 마감" ? 2 : 1), 0), "마감은 하루 전·6시간 전, 전형은 하루 전 알림");
  assert.equal(await p.textContent("#toast"), "일정 " + want.length + "건을 파일로 받았어요. 파일을 열면 휴대폰 캘린더에 들어가요. 새로 담은 공고는 다시 내보내야 해요");
}));

test("[BUG-25] 일정 파일에는 이미 지난 마감·전형이 알림과 함께 들어가지 않는다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const { text } = await ics(p);
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const past = vevents(text).filter(e => e.DTSTART < now).map(e => e.SUMMARY + " " + e.DTSTART.slice(0, 8));
  assert.deepEqual(past, [], "지난 일정 " + past.length + "개가 알림과 함께 들어감");
}));

test("'백업 파일 받기'는 지금 보드 전체(profile·apps·custom·todos·arc)를 JSON으로 내려준다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  await closeAll(p); await openMenu(p);
  const { name, text } = await downloadText(p, () => p.click("#expBtn"));
  assert.equal(name, "지원보드-백업-" + todayKST() + ".json");
  BACKUP = JSON.parse(text);
  for(const k of ["profile", "apps", "custom", "todos", "arc"]) assert.ok(BACKUP[k] && typeof BACKUP[k] === "object", k + " 없음");
  const seed = seedDb();
  const applied = o => Object.entries(o.apps).filter(([, a]) => a.applied).map(([id]) => id).sort();
  assert.deepEqual(applied(BACKUP), applied(seed));
  assert.deepEqual(BACKUP.todos, seed.todos);
  assert.deepEqual(BACKUP.custom, seed.custom);
  const n = Object.keys(BACKUP.apps).length, empty = Object.values(BACKUP.apps).filter(isEmptyRecord).length;
  writeFileSync(join(OUT, "backup-measure.json"), JSON.stringify({ bytes: Buffer.byteLength(text), apps: n, empty }, null, 1));
  writeFileSync(join(OUT, "tmp-backup-roundtrip.json"), text);
}));

test("백업을 복원하면 그 사이 바꾼 내용이 백업 시점으로 돌아간다(라운드트립)", { timeout: 60000 }, g(async () => {
  const p = S.page;
  assert.ok(BACKUP, "앞 테스트의 백업이 있어야 한다");
  await closeAll(p); await tab(p, "plan"); await p.click("#wToday");
  await p.locator("#week .day.is-today .addtodo").click();
  const box = p.locator('#week .day.is-today form.inline-add[data-inl="todo"] input');
  await box.fill("QA 라운드트립 할 일"); await box.press("Enter");
  await p.waitForFunction(() => Object.values(db.todos).flat().some(t => t.text === "QA 라운드트립 할 일"));
  await restoreSeed(p, join(OUT, "tmp-backup-roundtrip.json"));
  const d = await getDb(p);
  assert.deepEqual(d.todos, BACKUP.todos);
  assert.equal(Object.values(d.todos).flat().some(t => t.text === "QA 라운드트립 할 일"), false);
  assert.deepEqual(d.custom, BACKUP.custom);
}));

test("백업 형식이 아닌 파일을 고르면 '지원 보드 백업 파일이 아니에요'가 뜨고 보드는 그대로다", { timeout: 30000 }, g(async () => {
  const p = S.page;
  const f = join(OUT, "tmp-not-backup.json");
  writeFileSync(f, JSON.stringify({ hello: "world" }));
  const before = Object.keys((await getDb(p)).apps).length;
  await p.setInputFiles("#fileIn", f);
  await p.waitForFunction(() => document.getElementById("toast").textContent.startsWith("지원 보드 백업 파일이 아니에요"));
  assert.equal(Object.keys((await getDb(p)).apps).length, before);
}));

test("[BUG-04] 할 일·직접 등록 공고 항목이 빠진 백업은 거절하거나 빈 항목을 채워 복원한다", { timeout: 90000 }, g(async () => {
  const p = S.page;
  const part = seedDb(); delete part.todos; delete part.custom;
  const f = join(OUT, "tmp-partial-backup.json");
  writeFileSync(f, JSON.stringify(part));
  // 앱이 '형식이 아닙니다'라고 하면서도 서버로 올리는지 본다
  const uploaded = waitForSync(p, d => d.todos === undefined && d.custom === undefined, 8000).then(() => true, () => false);
  await p.setInputFiles("#fileIn", f);
  await p.waitForSelector("#confirmDlg[open], .toast.on", { timeout: 10000 });
  if(await p.locator("#confirmDlg[open]").count()) await p.click("#confirmYes");    // 받아들일 수 있는 파일이면 확인 창이 먼저 뜬다
  await p.waitForFunction(() => document.getElementById("toast").classList.contains("on"));
  const toastText = await p.textContent("#toast");
  const replacedInMemory = await p.evaluate(() => db.todos === undefined);
  const partialUploaded = await uploaded;
  await reloadApp(p);
  const appliedAfterReload = await p.evaluate(() => Object.values(db.apps).filter(a => a.applied).length);
  const onboardingShown = await p.evaluate(() => document.getElementById("prefDlg").open);
  await snap(p, "bug-partial-backup-after-reload");
  await closeAll(p);
  await restoreSeed(p);                          // QA 계정 원상 복구
  const got = { toastText, replacedInMemory, partialUploaded, appliedAfterReload, onboardingShown };
  // 기대: 거절했다면 보드를 건드리지 않고(올리지도 않고), 받아들였다면 새로고침 뒤에도 지원 10건이 그대로
  const ok = (toastText.startsWith("지원 보드 백업 파일이 아니에요") && !replacedInMemory && !partialUploaded) || (toastText === "백업 파일 내용으로 바꿨어요" && appliedAfterReload === 10 && !onboardingShown);
  assert.ok(ok, "결과: " + JSON.stringify(got) + " — '형식이 아닙니다'라고 알리면서 보드를 바꿔 서버에 올렸고, 새로고침하면 빈 보드와 첫 화면 '내 조건' 창이 뜸(여기서 저장하면 서버 기록이 지워짐)");
}));
