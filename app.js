/* 지원 보드 앱 — index.html에서 분리(2026-10-14). supabase-js는 index.html의 <head>에서 먼저 로드된다 */
"use strict";

const KEY = "jobboard-v2";              /* 예전(계정 구분 없는) 이 기기 사본. 지금은 계정마다 KEY + ":" + uid */
const SNAP_KEY = "jobboard-v2-snapshot"; /* 예상→실제 공고 자동 이동 직전 사본(B04) */
const ROLES = ["PM/서비스기획","기획/전략","사업개발","마케팅","브랜드","콘텐츠","MD",
               "영업","영업관리","고객/CS","HR/인사","금융/심사","리서치","홍보/PR"];
const TYPES = ["대기업","중견기업","유니콘","스타트업","금융","공기업","외국계"];
let STAGES = ["서류 발표","AI 역량검사","적성검사","인적성검사","GSAT","1차 면접","2차 면접","최종 면접"];
/* "서류 마감 → 서류 발표 → 1차 면접 → 최종 면접" 업계 통상 간격(일). 실제 데이터 기반 예측이 아닌
   대략적인 초안 제안용 — 소민님이 그대로 쓰거나 직접 고칠 수 있게 항상 "예상"임을 표시한다. */
const STAGE_OFFSET_PRESETS = [
  {name:"서류 발표", days:14},
  {name:"1차 면접",  days:21},
  {name:"최종 면접", days:35},
];
let SEED = [];
/* 실험 변형(03 문서 1.1): ?v=a | b1 | b2. 이 탭(세션) 동안 유지하고, 값이 없으면 a(현행).
   변형 코드는 VARIANT 조건 안에만 둔다 — 파라미터 없는 접속에서 B 요소가 보이면 출시 차단 결함(02 문서 R5) */
const VARIANT = (function(){
  let v = new URLSearchParams(location.search).get("v");
  try{
    if(v) sessionStorage.setItem("jb-variant", v);
    else v = sessionStorage.getItem("jb-variant");
  }catch(e){}
  return v === "b1" || v === "b2" ? v : "a";
})();
document.documentElement.dataset.variant = VARIANT;

/* ---------- 저장소 ---------- */
const SUPABASE_URL = "https://mtmhkojervdqiftglcnq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_soR7fHjBKYKExEGeLsJ9IQ_ejf4TH3K";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function defaultDb(){
  return {profile:{roles:[],types:[],onboarded:false,theme:{mode:"system",accent:"lime"}},
          apps:{}, custom:[], todos:{}, arc:{exp:[], cov:[], res:"", pf:""}};
}
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/* 불러온 데이터(계정·백업·이 기기 사본)를 앱이 쓰는 모양으로 맞춘다. 빠진 항목은 기본값으로 채우고(B28),
   객체가 아니거나 주요 항목의 형식이 틀리면 null — 그때는 빈 보드로 바꾸지 않는다. */
function normalizeDb(r){
  if(!isObj(r)) return null;
  if(!["apps", "custom", "todos", "arc", "profile"].some(k => r[k] !== undefined)) return null;
  if(["apps", "todos", "arc", "profile"].some(k => r[k] !== undefined && !isObj(r[k]))) return null;
  if(r.custom !== undefined && !Array.isArray(r.custom)) return null;
  const d = defaultDb();
  r.apps = r.apps || {}; r.custom = r.custom || []; r.todos = r.todos || {};
  r.arc = Object.assign(d.arc, r.arc || {});
  r.profile = Object.assign(d.profile, r.profile || {});
  if(!isObj(r.profile.theme)) r.profile.theme = {mode:"system", accent:"lime"};
  if(!Array.isArray(r.profile.roles)) r.profile.roles = [];
  if(!Array.isArray(r.profile.types)) r.profile.types = [];
  Object.keys(r.apps).forEach(id => { if(isObj(r.apps[id])) fillApp(r.apps[id]); else delete r.apps[id]; });
  return r;
}
/* 계정 구분이 없던 예전 이 기기 사본(로그인 기능 전) — 새 계정을 만들 때만 가져오기를 묻는다(B26) */
function loadLegacy(){
  try{ return normalizeDb(JSON.parse(localStorage.getItem(KEY))); }
  catch(e){ return null; }
}
const localKey = uid => KEY + ":" + uid;
let db = defaultDb();
/* 계정 데이터를 다 불러오기 전에는 저장하지 않는다(B28). 불러오기에 실패한 채 저장하면 서버 기록이 빈 보드로 덮인다 */
let dbReady = false;
let syncTimer = null, saveSeq = 0, savedSeq = 0, inflight = null, saveFailed = false, savingTimer = null, sessionToken = "";
/* 다른 기기·탭 덮어쓰기 감지(B21 최소판): 불러올 때 받은 updated_at(서버 문자열 그대로)을 기억하고, 저장은 그 값이 그대로일 때만 바꾼다.
   null이면(옛 행·서버가 값을 안 줌) 예전처럼 upsert. conflict면 자동 저장을 멈추고 사용자가 고르게 한다 */
let loadedAt = null, conflict = false, conflictAsking = false;
const unsaved = () => dbReady && !!currentUserId && savedSeq < saveSeq;
/* 이 기기 사본에는 저장 상태도 적는다 — 계정에 못 올린 변경(dirty)이 있으면 다음에 열 때 어느 쪽을 쓸지 묻는다 */
let localAt = "";
function writeLocal(){
  if(unsaved()) localAt = new Date().toISOString();
  try{ localStorage.setItem(localKey(currentUserId), JSON.stringify(Object.assign(persistCopy(), {_local: {seq: saveSeq, savedAt: localAt || new Date().toISOString(), dirty: unsaved()}}))); }
  catch(e){ toast("이 기기 저장 공간이 가득 찼어요. 백업 파일을 받은 뒤 오래된 내용을 지워 주세요."); }
}
function readLocal(uid){ try{ return JSON.parse(localStorage.getItem(localKey(uid)) || "null"); }catch(e){ return null; } }
const rowAt = res => { const d = Array.isArray(res.data) ? res.data[0] : res.data; return d && d.updated_at || null; };
function save(){
  if(!dbReady || !currentUserId) return;
  saveSeq++;
  writeLocal();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; sync(); }, 800);
}
/* 계정에 올리기 — 한 번에 하나씩. 실패하면 한 번 더 시도하고, 그래도 안 되면 '저장 못 했어요 · 다시 시도'(B08) */
/* 저장 요청 하나: loadedAt이 있으면 조건부 update(0행이면 {conflict}), 없거나 조건부 update가 서버 오류면 upsert */
async function pushDb(uid, data, force){
  const now = new Date().toISOString();
  if(loadedAt && !force){
    const res = await sb.from("jobboard_data").update({data, updated_at: now}).eq("user_id", uid).eq("updated_at", loadedAt).select("updated_at");
    if(!res.error && Array.isArray(res.data)) return res.data.length ? {at: rowAt(res)} : {conflict: true};
    if(res.error && (!res.status || !res.error.code)) throw res.error;              /* 네트워크 오류는 그대로 실패(자동 재시도) */
    console.warn("조건부 저장을 쓸 수 없어 예전 방식(upsert)으로 저장해요:", res.error ? res.error.message : "응답 형식");
  }
  const res = await sb.from("jobboard_data").upsert({user_id: uid, data, updated_at: now}).select("updated_at");
  if(res.error) throw res.error;
  return {at: rowAt(res)};
}
async function sync(retried){
  while(inflight) await inflight.catch(() => {});
  if(conflict){ setSaveState("failed"); askConflict(); return false; }
  if(!unsaved()){ if(!saveFailed) setSaveState("saved"); return !saveFailed; }
  const seq = saveSeq, uid = currentUserId, base = loadedAt;
  clearTimeout(savingTimer); savingTimer = setTimeout(() => setSaveState("saving"), 400);
  let out = null, err = null;
  inflight = pushDb(uid, persistCopy());
  try{ out = await inflight; }catch(e){ err = e || new Error("저장 실패"); }
  inflight = null; clearTimeout(savingTimer);
  if(uid !== currentUserId) return !err;      /* 그 사이 로그아웃 */
  if(out && out.conflict){
    if(loadedAt !== base) return sync(retried);   /* 그 사이 이 기기의 다른 요청(닫힐 때 보낸 저장)이 먼저 바꿨다 — 다시 시도 */
    conflict = true; saveFailed = true; setSaveState("failed"); askConflict(); return false;
  }
  if(!err){ if(out && out.at) loadedAt = out.at; savedSeq = Math.max(savedSeq, seq); saveFailed = false; writeLocal(); setSaveState(unsaved() ? "saving" : "saved"); return true; }
  console.warn("계정에 저장하지 못했어요:", err.message || err);
  if(!retried){ await new Promise(r => setTimeout(r, 1500)); return sync(true); }
  saveFailed = true; setSaveState("failed");
  toast("저장하지 못했어요. 연결을 확인하고 ‘다시 시도’를 눌러 주세요.");
  return false;
}
/* 글자 입력은 칸을 벗어나기 전에도 잠깐 쉬면 저장한다 — 새로고침·탭 닫기 때 쓰던 글이 사라지지 않게(CR-04) */
let soonTimer = null;
function saveSoon(){ clearTimeout(soonTimer); soonTimer = setTimeout(() => { soonTimer = null; save(); }, 300); }
function saveNow(){ if(soonTimer){ clearTimeout(soonTimer); soonTimer = null; save(); } }
/* 기다리는 저장을 바로 보내고 끝날 때까지 기다린다(로그아웃·다시 시도) */
function flushSave(){
  saveNow();
  clearTimeout(syncTimer); syncTimer = null;
  if(conflict){ askConflict(); return Promise.resolve(false); }
  if(!unsaved() && !inflight && !saveFailed) return Promise.resolve(true);
  if(saveFailed) saveFailed = false;
  return sync();
}
/* 다른 기기에서 먼저 바꾼 것을 알았을 때 — 자동 저장은 멈춘 채로 고르게 한다 */
async function askConflict(){
  if(conflictAsking) return;
  conflictAsking = true;
  const pick = await confirmDlg({title: "다른 기기에서 바뀐 내용이 있어요",
    body: "이 화면을 연 뒤 다른 기기나 탭에서 보드가 저장됐어요. 다른 기기 내용을 불러오면 이 화면에서 바꾼 내용은 백업 파일로 받아 둬요. 지금 내용으로 덮어쓰면 다른 기기에서 바꾼 내용이 사라져요."},
    "다른 기기 내용 불러오기", "닫기", {extra: "지금 내용으로 덮어쓰기"});
  conflictAsking = false;
  if(pick === true){ exportBackup(); await reloadFromServer(); }
  else if(pick === "extra"){
    try{ const out = await pushDb(currentUserId, persistCopy(), true); if(out.at) loadedAt = out.at; savedSeq = saveSeq; conflict = false; saveFailed = false; writeLocal(); setSaveState("saved"); toast("지금 내용으로 저장했어요"); }
    catch(e){ console.warn("덮어쓰기 저장 실패:", e.message || e); toast("저장하지 못했어요. 연결을 확인하고 ‘다시 시도’를 눌러 주세요."); }
  }
}
/* 서버에 있는 내용으로 바꾸기(다른 기기 내용 불러오기) */
async function reloadFromServer(){
  const res = await sb.from("jobboard_data").select("data, updated_at").eq("user_id", currentUserId).maybeSingle();
  const d = res.data && normalizeDb(res.data.data);
  if(res.error || !d){ toast("다른 기기 내용을 불러오지 못했어요. 잠시 후 다시 해 주세요."); return; }
  replaceDb(d); loadedAt = res.data.updated_at || null;
  conflict = false; saveFailed = false; savedSeq = saveSeq; writeLocal(); setSaveState("saved");
  renderAll(); toast("다른 기기 내용을 불러왔어요");
}
function setSaveState(s){
  const el = document.getElementById("saveState"); if(!el) return;
  el.dataset.state = s;
  const t = el.querySelector(".save-t");
  t.textContent = s === "saving" ? "저장 중…" : s === "saved" ? "저장됨" : s === "failed" ? "저장 못 했어요" : "";
  if(s === "saved"){ const n = new Date(); el.title = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0") + "에 저장"; }
  else el.removeAttribute("title");
  document.getElementById("saveRetry").hidden = s !== "failed";
}
/* ---------- 빈 기록은 저장 사본에서 뺀다(B09) ----------
   '빈 기록' = 모든 칸이 app()이 만드는 기본값과 같은 기록. 화면이 들고 있는 메모리 속 기록은 지우지 않는다
   (지우면 그 객체에 이어지는 별 표시 같은 변경이 사라진다). 아래 기본값 표에 없는 칸(snap·ovr·check·skip·flow·fold·resultAt·
   docAt·movedFrom·linkSkip·sent 등)은 값이 하나라도 있으면 내용으로 본다 — 모르는 칸은 남기는 쪽으로. */
const BLANK_APP = {applied:false, starred:false, doc:"대기", note:"", cover:"", resume:"", folio:"", myEnd:"", at:"",
                   role:"", req:"", pref:"", myEndTime:"", check:false, skip:false};
const isBlank = v => v === undefined || v === null || v === "" || v === false ||
  (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
function isEmptyRecord(a){
  if(!isObj(a)) return true;
  for(const k in a){
    const v = a[k];
    if(k === "stages" || k === "essays"){ if(Array.isArray(v) && v.length) return false; continue; }
    if(k === "submit"){ if(isObj(v) && Object.values(v).some(Boolean)) return false; continue; }
    if(k === "fold"){ if(v !== undefined) return false; continue; }   /* 직접 접고 편 상태도 사용자가 한 일 */
    if(k === "snap") continue;   /* 공고 요약은 담음·관심·미지원일 때만 쓰이고, 그 셋은 그 자체로 내용이다 */
    if(k in BLANK_APP){ if(v !== BLANK_APP[k] && !isBlank(v)) return false; continue; }
    if(!isBlank(v)) return false;
  }
  return true;
}
/* 저장할 사본(localStorage·계정) — 빈 기록만 뺀 얕은 사본 */
let persistLogged = false;
function persistCopy(){
  const apps = {}; let dropped = 0;
  for(const id in db.apps){ if(isEmptyRecord(db.apps[id])) dropped++; else apps[id] = db.apps[id]; }
  if(!persistLogged){ persistLogged = true; console.info("[저장] 기록 " + (Object.keys(apps).length + dropped) + "개 중 빈 기록 " + dropped + "개는 저장 사본에서 뺐어요(화면의 기록은 그대로)."); }
  return Object.assign({}, db, {apps});
}
/* ---------- 내 지원 상태 하나로(UX 04 B-3-1) — 표·카드·레일·'오늘'이 같은 판정을 쓴다 ----------
   우선순위: 확인 필요 > 탈락 > 합격·진행 > 마감 전 > 결과 대기 > 미지원 */
const CHECK_AFTER_DAYS = 14;   /* 발표 예정일이 없으면 서류 마감 후 이만큼 지나도 '대기'일 때 확인 필요(02 문서 B02) */
function needsCheck(a, j){
  if(!a.applied || a.doc !== "대기") return false;
  if(VARIANT === "b2" && a.sent === false) return false;   /* 실험 2 B: 낸 적이 없으니 결과를 확인할 일도 없다 */
  if(a.resultAt) return dleft(a.resultAt) < 0;
  const dl = deadline(j);
  return !!dl && dleft(dl) < -CHECK_AFTER_DAYS;
}
function statusOf(a, j){
  if(!a.applied) return a.skip ? "미지원" : null;
  if(a.check || needsCheck(a, j)) return "확인필요";
  if(a.doc === "불합격" || a.stages.some(s => s.result === "불합격")) return "탈락";
  if(a.doc === "합격") return "합격";
  /* 실험 2 B(?v=b2): 담기만 한 공고는 '제출 전', [제출했어요]를 누른 공고는 마감 전이어도 '결과 대기'. sent가 없는 기존 기록은 낸 것으로 본다 */
  if(VARIANT === "b2") return a.sent === false ? "제출전" : "대기";
  const dl = deadline(j);
  return dl && dleft(dl) >= 0 ? "마감전" : "대기";
}
/* 상태 칩 [글자, class] — 마감 전은 D-day가 대신 보이므로 null. 칩 글자는 B-3-1·B-3-2 규칙 */
function stateChip(a, j){
  const st = statusOf(a, j);
  if(st === "확인필요") return ["확인 필요", "check"];
  if(st === "탈락"){
    const failed = a.doc === "합격" && a.stages.find(s => s.result === "불합격");
    return [(failed ? failed.name : "서류") + " 탈락", "fail"];
  }
  if(st === "합격"){
    const last = a.stages[a.stages.length - 1];
    if(last && last.result === "합격") return [/최종/.test(last.name) ? "최종 합격" : last.name + " 합격", "pass"];
    const next = a.stages.find(s => s.result !== "합격");
    return next ? [next.name + (next.result === "완료" ? " 결과 대기" : " 준비"), "pass"] : ["서류 합격", "pass"];
  }
  if(st === "대기") return ["결과 대기", "wait"];
  if(st === "제출전"){ const dl = deadline(j); return [dl && dleft(dl) < 0 ? "제출 전 · 마감 지남" : "제출 전", "pre"]; }
  if(st === "미지원") return ["미지원", "skip"];
  return null;
}
/* 서류 결과를 바꿀 때마다 그날을 docAt에 적는다(원인 분석용, 화면 변화 없음) */
function setDoc(a, v){
  if(a.doc !== v){ a.doc = v; a.docAt = iso(TODAY); }
  if(VARIANT === "b2" && v !== "대기") markSent(a);   /* 결과가 왔다면 낸 것이다(03 문서 3.3) */
}
/* 실험 2 B: 제출 표시 */
function markSent(a){ if(a.sent !== true){ a.sent = true; a.sentAt = iso(TODAY); } }
/* '예상' 날짜인가 — 담은 예상 공고의 마감(내가 직접 넣은 마감일은 실제 날짜로 본다) */
const estDeadline = (j, a) => !j.confirmed && !(a.applied && a.myEnd);
const EST_TIP = {end: "지난 공고 패턴으로 짐작한 마감일이에요. 실제 공고가 뜨면 공고에서 날짜를 확인해 주세요.",
                 stage: "서류 마감 뒤 보통 걸리는 날짜로 넣었어요. 실제 날짜로 고쳐 주세요."};
function estTag(kind){
  const s = document.createElement("span"); s.className = "est-tag"; s.textContent = "예상";
  s.title = EST_TIP[kind || "end"]; return s;
}
/* 외부 링크는 http·https만(B06). 아니면 빈 글자 — 부르는 쪽은 링크 대신 글자를 그린다 */
function safeUrl(u){
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\/\S/i.test(s) ? s : "";
}
/* 새 탭으로 여는 링크. 주소가 http·https가 아니면 같은 글자를 링크 없이(span) */
function extLink(u, text, cls){
  const url = safeUrl(u);
  const el = document.createElement(url ? "a" : "span");
  if(cls) el.className = cls;
  if(url){ el.href = url; el.target = "_blank"; el.rel = "noopener"; }
  el.textContent = text;
  return el;
}
/* 기록 읽기(appOf)와 쓰기(app)를 나눈다(B09). 화면을 그릴 때는 appOf — 기록이 없으면 저장하지 않는 기본값을 돌려준다.
   버튼·입력 처리처럼 실제로 바꿀 때만 app(id)로 기록을 만든다. */
const EMPTY_APP = deepFreeze(fillApp({applied:false, note:"", doc:"대기", stages:[], cover:"", resume:"", folio:"", myEnd:"", at:""}));
function deepFreeze(o){ Object.values(o).forEach(v => { if(v && typeof v === "object") deepFreeze(v); }); return Object.freeze(o); }
function appOf(id){ return db.apps[id] || EMPTY_APP; }
function app(id){
  if(!db.apps[id]) db.apps[id] = {applied:false, note:"", doc:"대기", stages:[],
                                  cover:"", resume:"", folio:"", myEnd:"", at:""};
  return fillApp(db.apps[id]);
}
/* 예전 기록에 없던 칸을 기본값으로 채운다 */
function fillApp(a){
  if(!Array.isArray(a.stages)) a.stages = [];
  if(a.doc === undefined) a.doc = "대기";
  if(a.note === undefined) a.note = "";
  if(a.cover === undefined) a.cover = "";
  if(a.resume === undefined) a.resume = "";
  if(a.applied === undefined) a.applied = false;
  if(a.folio === undefined) a.folio = "";
  if(a.myEnd === undefined) a.myEnd = "";
  if(a.at === undefined) a.at = "";
  if(a.role === undefined) a.role = "";      // 이 공고에 어떤 직무로 넣었는지
  if(a.req === undefined) a.req = "";        // 그 직무의 자격요건
  if(a.pref === undefined) a.pref = "";      // 우대사항
  if(!a.essays){                             // 자소서를 문항별로 쪼갭니다
    a.essays = a.cover ? [{q:"", limit:0, a:a.cover}] : [];
  }
  /* 서류로 무엇을 냈는지 체크. 포트폴리오는 요구하는 곳만 있어서 필요할 때 추가한다. */
  if(!a.submit) a.submit = {cover:false, resume:false, folio:false, hasFolio:false};
  if(a.myEndTime === undefined) a.myEndTime = "";   // 공고에 시각이 없을 때 직접 확인해 넣은 마감 시각
  if(a.starred === undefined) a.starred = false;    // 지원 전 "일단 관심"으로 찜해두는 단계
  a.stages.forEach(st => { if(st && !st.result) st.result = "예정"; });
  return a;
}
/* 공백 포함·제외 글자수 */
function counts(s){ s = s || ""; return {all:s.length, noSpace:s.replace(/\s/g,"").length}; }
/* 지원한 공고의 마감일 — 내가 적은 게 있으면 그걸 우선 */
function deadline(j){ const a = appOf(j.id); return (a.applied && a.myEnd) ? a.myEnd : j.end; }
/* 마감 "시각" — 내가 직접 확인해 넣은 값이 우선. 둘 다 없으면 아직 모르는 것이다. */
function deadlineTime(j){ const a = appOf(j.id); return a.myEndTime || (a.myEnd ? "" : (j.endTime || "")); }
let SHARED = [];    /* 다른 사람이 올린 제보 공고 */
let ARCHIVE = [];   /* 마감된 공고 — 무거워서 필요할 때만 불러온다 */
/* 같은 공고(id)가 목록·보관함에 겹쳐 들어와도 한 번만 */
/* 담은(관심·미지원 포함) 공고가 목록·보관함에서 빠져도(마감 다음 날 보관함으로, 45일 뒤 삭제) 기록이 사라지지 않게
   담을 때 공고 요약(snap)을 기록에 남기고, 어디에도 없는 공고는 그 요약으로 되살린다(CR-01, restored:true) */
function allJobs(){
  const seen = new Set();
  const list = SEED.concat(SHARED, ARCHIVE, db.custom).filter(j => !j.deleted && !seen.has(j.id) && seen.add(j.id));
  for(const id in db.apps){
    const a = db.apps[id];
    if(a.snap && (a.applied || a.starred || a.skip) && !seen.has(id)) list.push(Object.assign({id, restored: true}, a.snap, a.ovr || {}));
  }
  return list;
}
const SNAP_KEYS = ["company", "title", "roles", "type", "start", "end", "endTime", "url", "source", "hist", "confirmed"];
function snapJob(j){
  const s = {};
  SNAP_KEYS.forEach(k => { const v = j[k]; if(v !== undefined && v !== "" && v !== null) s[k] = Array.isArray(v) ? v.slice() : v; });
  return s;
}
const isCustomId = id => db.custom.some(c => c.id === id);
function keepSnap(j, a){ if(j && !j.restored && !isCustomId(j.id)) a.snap = snapJob(j); }
/* 공고 목록을 받을 때마다 담은 기록의 요약을 지금 값으로 맞춘다(바뀐 것이 있을 때만 저장) */
function refreshSnaps(){
  if(!dbReady) return;
  const byId = new Map(SEED.concat(SHARED, ARCHIVE).filter(j => !j.deleted).map(j => [j.id, j]));
  /* 메모리에서만 맞추고, 곧 목록에서 빠질(보관함에만 있는) 공고의 요약을 처음 채운 때만 바로 저장한다 —
     불러오기만으로 계정에 쓰지 않게(나머지는 다음 저장 때 함께 올라간다) */
  const inSeed = new Set(SEED.map(j => j.id));
  let urgent = false;
  for(const id in db.apps){
    const a = db.apps[id], j = byId.get(id);
    if(!j || !(a.applied || a.starred || a.skip)) continue;
    const s = snapJob(j);
    if(JSON.stringify(s) !== JSON.stringify(a.snap)){ if(!a.snap && !inSeed.has(id)) urgent = true; a.snap = s; }
  }
  if(urgent) save();
}
/* 내가 고쳐 둔 공용 공고 값(ovr)을 받은 목록에 덮는다 */
/* 덮기 전 원래 값을 기억해 두었다가 db를 바꿀 때 되돌린다(같은 탭에서 복원·계정 내용 교체 뒤 앞 사람이 고친 값이 남지 않게) */
const OVR_ORIG = new Map();
function ovrJob(s, o){
  const keep = OVR_ORIG.get(s.id) || {};
  Object.keys(o).forEach(k => { if(!(k in keep)) keep[k] = s[k]; });
  OVR_ORIG.set(s.id, keep); Object.assign(s, o);
}
function applyOvr(list){ list.forEach(s => { const o = db.apps[s.id] && db.apps[s.id].ovr; if(o) ovrJob(s, o); }); }
function resetOvr(){
  [SEED, SHARED, ARCHIVE].forEach(list => list.forEach(s => { const keep = OVR_ORIG.get(s.id); if(keep) Object.assign(s, keep); }));
  OVR_ORIG.clear();
}

/* 마감 공고는 당장 지원할 수 없어 첫 화면에는 없어도 된다.
   "마감" 필터를 켜거나 회사를 검색할 때만 받아 온다. */
let archivePromise = null;
let ARCHIVE_OK = false, SHARED_OK = false, ARCHIVE_FAIL = false;   /* 불러오기에 성공했는가 — 현황표 '정리'는 둘 다 성공했을 때만(B27) */
function loadArchive(){
  if(archivePromise) return archivePromise;
  archivePromise = fetch("data/archive.json?t=" + Date.now())
    .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { ARCHIVE = d.jobs || []; ARCHIVE_OK = true; ARCHIVE_FAIL = false; applyOvr(ARCHIVE); jobsChanged(); if(dbReady){ refreshSnaps(); migrateDonePredictions(); renderAll(); } })
    .catch(e => { console.warn("지난 공고를 불러오지 못했어요:", e.message); archivePromise = null; ARCHIVE_FAIL = true; if(dbReady) renderList(); });
  return archivePromise;
}

/* ---------- 날짜 ---------- */
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const parse = s => { const p = s.split("-").map(Number); return new Date(p[0], p[1]-1, p[2]); };
const dleft = s => Math.round((parse(s) - TODAY) / 86400000);
const fmt = s => { const d = parse(s); return (d.getMonth()+1)+"월 "+d.getDate()+"일"; };
/* 마감이 지난 날짜에 "D--6"처럼 마이너스가 두 번 붙지 않게 한다 */
const dday = s => { const n = dleft(s); return n === 0 ? "오늘" : n > 0 ? "D-" + n : Math.abs(n) + "일 지남"; };
/* 마감 시각까지 아는 공고는 "9월 7일 16:00"으로 보여준다 */
const fmtAt = (date, time) => fmt(date) + (time ? " " + time : "");

/* ---------- 상태 판정 ---------- */
function state(j){
  if(!j.start && !j.end) return {k:"roll", label:"상시", cls:"p-roll"};
  const s = j.start ? dleft(j.start) : null;
  const e = j.end ? dleft(j.end) : null;
  if(e !== null && e < 0) return {k:"shut", label:"마감", cls:"p-shut"};
  /* 예상 일정은 기간이 시작됐어도 실제 공고가 뜨기 전까지 '예상'(접수 중으로 보이지 않게) */
  if(!j.confirmed && (s !== null || e !== null)) return {k:"est", label: e === 0 ? "예상 마감" : s !== null && s <= 0 ? "예상 · 열릴 무렵" : "예상", cls:"p-est"};
  /* 접수 중 알약 색은 D-day 규칙(UX 04 B-3-4): 0~3일 기본(빨강), 4~10일 .s, 11일 이상 .n */
  if((s === null || s <= 0) && e !== null) return {k:"open", label: e === 0 ? "오늘 마감" : "접수 중 D-"+e, cls:"p-open" + (e <= 3 ? "" : e <= 10 ? " s" : " n")};
  /* 시작은 했는데 마감일을 아직 못 확인한 공고 */
  if(s !== null && s <= 0 && e === null) return {k:"open", label:"접수 중", cls:"p-open"};
  if(!j.confirmed) return {k:"est", label:"예상", cls:"p-est"};
  return {k:"soon", label: s !== null ? "오픈 예정 D-"+s : "오픈 예정", cls:"p-soon"};
}
function pill(j){
  const st = state(j), el = document.createElement("span");
  el.className = "pill " + st.cls; el.textContent = st.label; return el;
}
/* 내 조건에 맞는가 */
function fits(j){
  const p = db.profile;
  /* 직무와 기업 형태 모두, 정보가 없는 공고는 조건에 걸러지지 않는다(B03).
     형태 정보가 없는 공고는 내 조건 창의 '기업 형태 정보가 없는 공고도 보기'를 끄면 숨긴다. */
  if(p.roles.length && (j.roles || []).length && !j.roles.some(r => p.roles.includes(r))) return false;
  if(p.types.length && !p.types.includes(j.type) && !(!j.type && p.unknownType !== false)) return false;
  return true;
}
/* 과거 패턴으로 잡아 둔 '예상' 일정은 같은 회사의 실제 공고가 올라오면 숨긴다(관심·지원한 것은 남김).
   실제 공고의 회사 키는 공고 목록이 바뀔 때만 다시 센다(B12 — 공고마다 전체 목록을 훑지 않게) */
const coKey = s => (s || "").replace(/\(.*?\)|㈜|주식회사|\s/g, "").toLowerCase();
let CONF = null;
function jobsChanged(){ CONF = null; }
/* 회사 키 → 그 회사 확정 공고의 날짜(ms, 날짜 없는 상시 공고는 null) */
function confirmedKeys(){
  if(CONF) return CONF;
  const keys = new Map();
  [SEED, SHARED, ARCHIVE].forEach(list => list.forEach(x => {
    if(!x.confirmed || x.deleted) return;
    const k = coKey(x.company), d = x.end || x.start;
    if(!keys.has(k)) keys.set(k, []);
    keys.get(k).push(d ? parse(d).getTime() : null);
  }));
  return (CONF = {keys, list: [...keys.keys()]});
}
/* 같은 시즌만 근거로(CR-11): 예상 날짜 ±90일 안에 그 회사의 확정 공고가 있을 때. 보관함의 이번 시즌 공고가 다음 해 예상을 숨기지 않게 */
const SEASON_MS = 90 * 864e5;
const sameSeason = (dates, d) => !d || dates.some(x => x === null || Math.abs(x - d) <= SEASON_MS);
function superseded(j, cids){
  if(j.confirmed || (cids ? cids.has(j.id) : db.custom.some(c => c.id === j.id))) return false;
  /* 담음·관심을 먼저 본다 — 관심만 찍은 예상도 숨지 않게(CR-12) */
  const a = db.apps[j.id]; if(a && (a.applied || a.starred)) return false;
  if(j.doneBy) return true;   /* 이번 시즌 실제 공고가 이미 나온 예상(매일 수집 때 표시) */
  const k = coKey(j.company), C = confirmedKeys(), jd = (j.end || j.start) ? parse(j.end || j.start).getTime() : 0;
  if(C.keys.has(k) && sameSeason(C.keys.get(k), jd)) return true;
  /* '삼성그룹'처럼 그룹 단위 예상은 계열사(삼성전자 등) 공고가 올라와도 숨긴다 */
  const grp = /그룹$/.test(k) ? k.replace(/그룹$/, "") : "";
  if(grp.length < 2) return false;
  return C.list.some(xk => xk.startsWith(grp) && sameSeason(C.keys.get(xk), jd));
}
/* ---------- 예상 → 실제 공고 옮기기(B04) ----------
   담아 둔(또는 관심) 예상 공고에 이번 시즌 실제 공고(doneBy)가 나오면, 회사 이름 키(coKey)가 같을 때만 기록을 옮긴다.
   '카카오그룹 → 카카오뱅크'처럼 회사가 다르면 옮기지 않고 내 지원 위에 제안만 띄운다(연결 / 무시는 사용자가 고른다). */
function predCands(){
  const byId = new Map(allJobs().map(j => [j.id, j]));
  return allJobs().filter(j => !j.confirmed && j.doneBy && db.apps[j.id] && (db.apps[j.id].applied || db.apps[j.id].starred))
    .map(j => ({j, to: byId.get(j.doneBy) || null}))
    .filter(c => !c.to || db.apps[c.j.id].linkSkip !== c.to.id);
}
const sameCo = c => !!c.to && coKey(c.to.company) === coKey(c.j.company);
/* 옮기기 직전 db를 이 기기에 한 번 남겨 둔다(되돌리기·복구용, 로그아웃하면 지운다) */
function snapshotDb(){
  const raw = JSON.stringify(persistCopy());
  try{ localStorage.setItem(SNAP_KEY, JSON.stringify({at: new Date().toISOString(), uid: currentUserId, db: JSON.parse(raw)})); }catch(e){}
  return raw;
}
/* 예상 공고 기록(from)을 실제 공고 기록(cur)으로 합친다 — 어느 쪽 내용도 버리지 않는다.
   cur에 이미 적힌 값은 그대로 두고, 빈 칸만 from으로 채우며, 전형·자소서는 이어 붙이고 메모는 둘 다 남긴다 */
function moveRecord(j, to){
  const from = JSON.parse(JSON.stringify(db.apps[j.id])), cur = db.apps[to.id];
  const rec = cur ? JSON.parse(JSON.stringify(cur)) : {};
  Object.keys(from).forEach(k => {
    if(k === "ovr" || k === "linkSkip" || k === "snap" || k === "movedFrom") return;
    if(k === "stages") rec.stages = (rec.stages || []).concat((from.stages || []).filter(s => !(rec.stages || []).some(x => stKey(x.name) === stKey(s.name))));
    else if(k === "essays") rec.essays = (rec.essays || []).concat((from.essays || []).filter(e => !(rec.essays || []).some(x => x.q === e.q && x.a === e.a)));
    else if(k === "note"){ if(from.note && !(rec.note || "").includes(from.note)) rec.note = ((rec.note || "") + " " + from.note).trim(); }
    else if(k === "applied" || k === "starred") rec[k] = !!(rec[k] || from[k]);
    else if(k === "submit") rec.submit = Object.assign({}, from.submit, rec.submit && Object.fromEntries(Object.entries(rec.submit).filter(([, v]) => v)));
    else if(k === "doc"){ if(!rec.doc || rec.doc === "대기") rec.doc = from.doc; }
    else if(isBlank(rec[k])) rec[k] = from[k];
  });
  if(rec.applied) rec.skip = false;
  if(!rec.movedFrom) rec.movedFrom = j.id;
  keepSnap(to, rec);
  db.apps[to.id] = fillApp(rec);
  db.apps[j.id].applied = false; db.apps[j.id].starred = false;
}
/* 실제 공고 기록에 이미 내용이 있으면 자동으로 옮기지 않고 제안으로 보낸다(사용자가 고르게) */
const curEmpty = c => !db.apps[c.to.id] || isEmptyRecord(db.apps[c.to.id]);
function restoreFrom(raw){ const d = normalizeDb(JSON.parse(raw)); if(d){ replaceDb(d); save(); renderAll(); } return !!d; }
/* db 통째로 바꾸기(복원·되돌리기·다른 기기 내용 불러오기·이 기기 사본) — 앞 db가 덮어 둔 공고 값(ovr)을 걷어 내고 새 db 것으로 다시 덮는다 */
function replaceDb(next){
  resetOvr(); db = next;
  applyOvr(SEED); applyOvr(SHARED); applyOvr(ARCHIVE);
  jobsChanged(); applyTheme();
}
function migrateDonePredictions(){
  if(!SEED.length || !dbReady) return 0;
  const cands = predCands();
  if(!cands.length) return 0;
  /* 공고 목록과 보관함을 둘 다 받은 뒤에만 판단한다(CR-12). 옮길 공고가 보관함에 있을 수 있다 */
  if(!ARCHIVE_OK){ loadArchive(); return 0; }
  const same = cands.filter(c => sameCo(c) && curEmpty(c));
  if(!same.length) return 0;
  const before = snapshotDb();
  same.forEach(c => moveRecord(c.j, c.to));
  save();
  /* 어느 회사인지 적고, 5초 뒤나 다른 화면으로 가면 사라진다 */
  toast(same[0].j.company + (same.length > 1 ? " 외 " + (same.length - 1) + "건" : "") + " 예상 일정을 실제 공고로 옮겼어요", {label: "되돌리기", run: () => {
    /* 되돌리면 다음에 열 때 다시 옮기지 않고 제안으로만 보여 준다 */
    if(restoreFrom(before)){ same.forEach(c => { if(db.apps[c.j.id]) db.apps[c.j.id].linkSkip = c.to.id; }); save(); renderAll(); toast("되돌렸어요"); }
  }}, {ms: 5000, navClose: true});
  return same.length;
}
/* 회사가 달라 옮기지 않은 후보 — 내 지원 위 제안 줄 */
let linkAll = false;   /* 제안 줄을 다 펼쳤는가 */
function linkBanner(){
  if(!SEED.length || !ARCHIVE_OK) return null;
  /* 이미 마감한 후보는 제안하지 않는다 — 지금 담아 둔 예상 일정과 같은 공고일 수 없다 */
  const list = predCands().filter(c => c.to && (!sameCo(c) || !curEmpty(c)) && !(c.to.end && dleft(c.to.end) < 0));
  if(!list.length) return null;
  const box = document.createElement("div"); box.className = "link-bars";
  (linkAll ? list : list.slice(0, 1)).forEach(c => {
    const bar = document.createElement("div"); bar.className = "dup-bar link-bar";
    const t = document.createElement("span");
    t.textContent = c.j.company + " 예상 일정과 같은 공고일까요? " + c.to.company + (c.to.end ? " · " + fmt(c.to.end) + " 마감" : "");
    const yes = document.createElement("button"); yes.type = "button"; yes.className = "primary"; yes.textContent = "같은 공고예요";
    yes.setAttribute("aria-label", c.j.company + " 기록을 " + c.to.company + " 공고로 옮기기");
    yes.onclick = () => {
      const before = snapshotDb();
      moveRecord(c.j, c.to); save(); renderAll();
      toast(c.j.company + " 기록을 " + c.to.company + " 공고로 옮겼어요", {label: "되돌리기", run: () => { if(restoreFrom(before)) toast("되돌렸어요"); }});
    };
    const no = document.createElement("button"); no.type = "button"; no.className = "ghost"; no.textContent = "아니에요";
    no.setAttribute("aria-label", c.j.company + "와 " + c.to.company + "는 다른 공고예요");
    no.onclick = () => { app(c.j.id).linkSkip = c.to.id; save(); renderMine(); };
    bar.append(t, yes, no); box.append(bar);
  });
  if(list.length > 1){
    const more = document.createElement("button"); more.type = "button"; more.className = "ghost link-more";
    more.textContent = linkAll ? "후보 접기" : "후보 " + (list.length - 1) + "건 더 보기";
    more.setAttribute("aria-expanded", linkAll);
    more.onclick = () => { linkAll = !linkAll; renderMine(); };
    box.append(more);
  }
  return box;
}
/* 목록에 보일 공고: 내 조건에 맞는 것 + 담은 것 · 관심(B03) · 직접 넣은 것은 조건과 무관하게 */
function scoped(){
  const cids = new Set(db.custom.map(c => c.id));
  return allJobs().filter(j => {
    const a = db.apps[j.id];
    return cids.has(j.id) || (a && (a.applied || a.starred)) || (fits(j) && !superseded(j, cids));
  });
}

/* ---------- 시작/마감 보기 기준 ---------- */
/* 전체공고와 캘린더가 같은 기준을 쓴다. "마감만" 상태에서는 접수 시작 일정이 빠져
   마감일만 남으므로, 마감 임박한 것만 훑어볼 때 쓴다. */
const DATE_MODES = [["all","시작일·마감일 모두 보기"],["end","마감일만 보기"],["start","시작일만 보기"]];
let dateMode = "all";
function dateModeLabel(){
  const cur = DATE_MODES.find(m => m[0] === dateMode);
  return cur ? cur[1] : DATE_MODES[0][1];
}
function cycleDateMode(){
  const i = DATE_MODES.findIndex(m => m[0] === dateMode);
  dateMode = DATE_MODES[(i + 1) % DATE_MODES.length][0];
  renderList(); renderCal();
}
/* 내 조건: 지금 상태(글자)와 누르면 할 일(버튼)을 나눠 보인다 — 목록·캘린더 공통 */
function wireScope(btnId, stateId){
  const scopeOn = db.profile.roles.length || db.profile.types.length;
  document.getElementById(stateId).textContent = scopeOn ? "내 조건 적용 중" : "전체 보는 중";
  const b = document.getElementById(btnId);
  b.textContent = scopeOn ? "전체 보기" : db.profile._bak ? "내 조건으로 보기" : "내 조건 고르기";
  b.onclick = () => {
    if(scopeOn){ db.profile._bak = {roles:db.profile.roles, types:db.profile.types};
      db.profile.roles = []; db.profile.types = []; save(); renderAll(); }
    else if(db.profile._bak){ db.profile.roles = db.profile._bak.roles;
      db.profile.types = db.profile._bak.types; save(); renderAll(); }
    else openPref();
  };
}
function wireDateModeBtn(id){
  const b = document.getElementById(id);
  b.textContent = dateModeLabel();
  b.title = "시작·마감 중 무엇을 볼지 바꿔요";
  b.onclick = cycleDateMode;
}

/* ---------- 전체 공고 ---------- */
/* 처음 열었을 때 이미 끝난 공고가 위에 깔리면 쓸모가 없어서 '접수 중'부터 보여준다 */
let filter = "open", sortKey = "end", sortDir = 1, query = "";
/* ---------- 올라온 날 · 처음 발견한 날 ----------
   posted: 회사·플랫폼이 밝힌 게시일(접수 시작일), found: 지원보드가 처음 발견한 날.
   수시·상시 공고는 빨리 낼수록 유리해서 '올라온 지 며칠'을 눈에 띄게 보여 준다. */
const NEW_DAYS = 3;
function postedInfo(x){
  const today = iso(TODAY);
  const posted = x.posted || (x.start && x.start <= today ? x.start : "");
  const found = x.found || "";
  const since = posted || found;
  if(!since) return null;
  const age = -dleft(since);
  return {posted, found, since, age, isNew: !!found && -dleft(found) < NEW_DAYS, rolling: !x.end};
}
const mdOf = k => { const d = parse(k); return (d.getMonth() + 1) + "/" + d.getDate(); };
/* 짧은 표시: "NEW · 10/2 발견" / "9/18 게시 · 15일 전" — 수시는 '올라온 지 N일' */
function postedTag(x){
  const p = postedInfo(x); if(!p) return null;
  const el = document.createElement("span");
  el.className = "pt" + (p.isNew ? " pt-new" : p.rolling && p.age > 21 ? " pt-old" : "");
  const when = p.posted ? mdOf(p.posted) + " 게시" : mdOf(p.found) + " 발견";
  const ago = p.age <= 0 ? "오늘" : p.age + "일 전";
  el.textContent = (p.isNew ? "NEW · " : "") + (p.rolling ? "올라온 지 " + (p.age <= 0 ? "오늘" : p.age + "일") + " · " + when : when + " · " + ago);
  el.title = [p.posted ? "게시일 " + p.posted : "", p.found ? "지원보드가 처음 발견한 날 " + p.found : ""].filter(Boolean).join("\n") +
    (p.rolling ? "\n수시·상시 공고는 먼저 낼수록 검토 기회가 커요" : "");
  return el;
}

const FILTERS = [["all","전체"],["new","새로 뜸"],["open","접수 중"],["star","관심"],["soon","오픈 예정"],["est","예상"],["roll","상시"],["shut","마감"]];
const LIST_PAGE = 40;
let listShown = LIST_PAGE, listSig = "", JOBS_FAIL = false, DATA_VER = "";
/* 공고 데이터 기준일이 2일 넘게 지났으면 목록 위에 알린다. 닫으면 그날은 다시 안 띄운다(B11) */
const STALE_KEY = "jobboard-stale-closed", TYPE_KEY = "jobboard-type-closed";
document.getElementById("typeClose").onclick = () => {
  try{ localStorage.setItem(TYPE_KEY, iso(TODAY)); }catch(e){}
  document.getElementById("typeNotice").hidden = true;
};
function showStale(updated){
  const el = document.getElementById("staleNotice");
  const day = String(updated || "").slice(0, 10), n = /^\d{4}-\d{2}-\d{2}$/.test(day) ? -dleft(day) : 0;
  let closed = ""; try{ closed = localStorage.getItem(STALE_KEY) || ""; }catch(e){}
  el.hidden = !(n > 2 && closed !== iso(TODAY));
  el.querySelector(".notice-t").textContent = el.hidden ? "" : "공고 데이터가 " + n + "일 전 기준이에요. 그 뒤에 올라온 공고는 아직 목록에 없을 수 있어요.";
}
document.getElementById("staleClose").onclick = () => {
  try{ localStorage.setItem(STALE_KEY, iso(TODAY)); }catch(e){}
  document.getElementById("staleNotice").hidden = true;
};
function renderList(){
  const base = scoped();
  const fb = document.getElementById("filters");
  fb.innerHTML = "";
  FILTERS.forEach(function(f){
    const n = f[0]==="all" ? base.length
            : f[0]==="star" ? base.filter(j => appOf(j.id).starred).length
            : f[0]==="new" ? base.filter(j => { const p = postedInfo(j); return p && p.isNew && state(j).k !== "shut"; }).length
            : base.filter(j => state(j).k===f[0]).length;
    const b = document.createElement("button");
    b.textContent = f[1] + " " + n;
    b.setAttribute("aria-pressed", filter===f[0]);
    b.onclick = () => {
      filter = f[0];
      if(f[0] === "shut" || f[0] === "all") loadArchive();
      renderList();
    };
    fb.appendChild(b);
  });

  wireScope("scopeBtn", "scopeState");
  wireDateModeBtn("dateModeBtn");
  /* 회사를 검색할 때는 지금 켜둔 상태 필터(접수 중 등)에 막히면 안 된다 —
     "그 회사 공고가 있었나"를 찾는 것이므로 마감된 것까지 함께 뒤진다. */
  const q = query.trim().toLowerCase();
  let rows = q || filter === "all" ? base
           : filter === "star" ? base.filter(j => appOf(j.id).starred)
           : filter === "new" ? base.filter(j => { const p = postedInfo(j); return p && p.isNew && state(j).k !== "shut"; })
           : base.filter(j => state(j).k===filter);
  if(q) rows = rows.filter(j => (j.company || "").toLowerCase().includes(q));
  /* 마감만/시작만 보기: 해당 날짜가 있는 공고만 남기고 그 날짜로 정렬한다. 원래 정렬 기준(sortKey)은 바꾸지 않는다(QA-13) */
  if(dateMode !== "all") rows = rows.filter(j => j[dateMode]);
  const sk = dateMode !== "all" && sortKey !== "company" ? dateMode : sortKey;
  const key = j => sk==="company" ? (j.company||"") : (j[sk] || "9999-99-99");
  /* 이미 끝난 공고는 정렬과 무관하게 항상 아래로 내린다 */
  const shut = j => state(j).k === "shut" ? 1 : 0;
  rows = rows.slice().sort((a,b) =>
    (shut(a) - shut(b)) || key(a).localeCompare(key(b),"ko") * sortDir);

  document.getElementById("listCount").textContent =
    rows.length + "건" + (q ? " · ‘" + query.trim() + "’ 검색 (마감 포함)" : "");
  document.getElementById("c-list").textContent = base.length;
  /* 기업 형태 정보가 없어 조건을 통과한 공고 수(B03) — 내 조건에서 끌 수 있다 */
  { const p = db.profile, tn = document.getElementById("typeNotice");
    const unk = p.types.length && p.unknownType !== false
      ? rows.filter(j => !j.type && !db.custom.some(c => c.id === j.id) && !appOf(j.id).applied && !appOf(j.id).starred).length : 0;
    let closed = ""; try{ closed = localStorage.getItem(TYPE_KEY) || ""; }catch(e){}
    tn.hidden = !unk || closed === iso(TODAY);   /* 닫으면 그날은 다시 안 띄운다 */
    tn.querySelector(".notice-t").textContent = unk ? "기업 형태 정보가 없는 공고 " + unk + "건도 함께 보여요. ⋯ 메뉴의 내 조건에서 끌 수 있어요." : ""; }

  const body = document.getElementById("listBody");
  body.innerHTML = "";
  const more = document.getElementById("listMore");
  more.hidden = true;
  if(!rows.length){
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 8; td.style.cssText = "color:var(--muted);padding:24px 12px";
    td.textContent = JOBS_FAIL && !SEED.length ? "공고 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요."
      : (filter === "shut" || query) && !ARCHIVE_OK ? (ARCHIVE_FAIL ? "지난 공고를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요." : "지난 공고를 불러오는 중이에요…")
      : "조건에 맞는 공고가 없어요. 내 조건을 넓히거나 공고를 직접 추가해 보세요.";
    tr.appendChild(td); body.appendChild(tr); return;
  }
  /* 한 번에 40줄씩(B15). 필터·검색·정렬이 바뀌면 처음 40줄부터 */
  const sig = [filter, q, dateMode, sortKey, sortDir].join("|");
  if(sig !== listSig){ listSig = sig; listShown = LIST_PAGE; }
  if(rows.length > listShown){
    const rest = rows.length - listShown;
    more.hidden = false;
    more.textContent = Math.min(rest, LIST_PAGE) + "개 더 보기 (남은 " + rest + "개)";
    more.onclick = () => { listShown += LIST_PAGE; renderList(); };
  }
  /* 공고 목록을 못 받았으면 제보·보관 공고가 보여도 맨 위에 안내를 남긴다(QA-18) */
  if(JOBS_FAIL){
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = 8; td.style.cssText = "color:var(--muted);padding:12px"; td.className = "list-fail";
    td.textContent = "공고 데이터를 불러오지 못했어요. 지금은 제보·지난 공고만 보여요. 잠시 뒤 새로고침해 주세요.";
    tr.appendChild(td); body.appendChild(tr);
  }
  rows.slice(0, listShown).forEach(function(j){
    const a = appOf(j.id), tr = document.createElement("tr");
    tr.appendChild(cell(pill(j), "stt"));
    const coTd = cell(j.company, "co");
    const coB = myBadge(j.id); if(coB) coTd.appendChild(coB);
    { const pi = postedInfo(j); if(pi && (pi.isNew || !j.end)){ const t = postedTag(j); t.classList.add("pt-row"); coTd.appendChild(t); } }
    tr.appendChild(coTd);
    /* 직무 분류가 없으면 공고 제목을 보여 준다(QA-11) */
    tr.appendChild(cell((j.roles||[]).join(", ") || j.title || "직무 정보 없음", "ro"));
    tr.appendChild(cell(j.start ? fmt(j.start) : j.found ? mdOf(j.found) + " 발견" : "—", "dt dt-start"));
    tr.appendChild(cell(j.end ? fmtAt(j.end, j.endTime) : "상시·수시", "dt dt-end"));
    tr.appendChild(cell(j.hist ? j.hist.replace(/\s*[—–]\s*/g, " · ") : "—", "hist"));
    tr.appendChild(cell(j.source || "—", "src", "color:var(--muted);font-size:12px"));

    const act = document.createElement("td"); act.className = "act";
    /* 450건을 한 번에 지원 여부로 가르기는 어려워서, 먼저 찜해두고 나중에 추리게 한다 */
    const st = document.createElement("button");
    st.textContent = a.starred ? "★ 관심" : "☆ 관심";
    st.className = a.starred ? "on" : "";
    st.title = a.starred ? "관심에서 빼기" : "관심 공고로 찜하기";
    st.setAttribute("aria-pressed", !!a.starred);
    st.onclick = () => { const w = app(j.id); w.starred = !w.starred; if(w.starred) keepSnap(j, w); save(); renderList(); };
    act.appendChild(st);
    /* 담기 · 담음(B25): 담아도 화면은 그대로, 담음을 다시 누르면 빼기 */
    const ap = document.createElement("button");
    ap.textContent = a.applied ? "담음" : "담기";
    ap.className = a.applied ? "on" : "";
    ap.title = a.applied ? j.company + " 내 지원에서 빼기" : j.company + " 내 지원에 담기";
    ap.setAttribute("aria-pressed", !!a.applied);
    ap.onclick = () => { if(appOf(j.id).applied) unapplyJob(j); else applyJob(j); };
    act.appendChild(ap);
    const url = safeUrl(j.url);
    if(url){
      const l = document.createElement("a");
      l.href = url; l.target = "_blank"; l.rel = "noopener"; l.textContent = "원문 ↗"; l.setAttribute("aria-label", j.company + " 공고 원문");
      act.appendChild(l);
    }
    const ed = document.createElement("button");
    ed.textContent = "편집"; ed.onclick = () => openForm(j.id); act.appendChild(ed);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}
/* 소민 전용 기능(매칭 아카이브 · 부탁/운세 표시)은 소민 계정으로 로그인했을 때만 보이고,
   헤더 버튼으로 켜고 끌 수 있다. 공개 저장소라 이메일 원문 대신 해시로 비교한다. */
const OWNER_HASH = "9f8aab6396d4b630923807854d5070db20b178bc76291b82525dd2ac74e39c9d";
let IS_OWNER = false;
async function checkOwner(email){
  if(!email || !crypto.subtle) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("") === OWNER_HASH;
}
const privOn = () => IS_OWNER && db.profile.privOn !== false;
function applyPrivate(){
  const btn = document.getElementById("privBtn");
  btn.hidden = !IS_OWNER;
  btn.textContent = "소민 전용 " + (privOn() ? "켜짐" : "꺼짐");
  btn.setAttribute("aria-pressed", privOn());
  Object.entries(SL_MODES).forEach(([mode, m]) => {
    const on = !!db.profile[m.flag];
    const btn = document.getElementById(m.btn);
    btn.textContent = m.title + " 모아보기 " + (on ? "끄기" : "켜기"); btn.setAttribute("aria-pressed", on);
    const tab = document.querySelector('nav.tabs button[data-mode="' + mode + '"]');
    tab.hidden = !on;
    if(!on && tab.getAttribute("aria-selected") === "true") document.querySelector('nav.tabs button[data-v="list"]').click();
  });
  /* 매칭 아카이브는 누구나 쓴다(각자 계정의 경험 키워드로). 운세·운 궁합만 소민 전용 */
  document.querySelector('nav.tabs button[data-v="match"]').hidden = false;
}
document.getElementById("privBtn").onclick = async function(){
  db.profile.privOn = !privOn(); save();
  if(privOn()) await loadMyNotes(); else MY_NOTES = {};
  applyPrivate(); renderAll();
};

/* 내가 직접 분석을 부탁해 등록한 공고와 운세 판정 — 계정별 표(jobboard_my_notes)에만 있어 남에게 안 보인다 */
let MY_NOTES = {};
async function loadMyNotes(){
  if(!privOn()){ MY_NOTES = {}; return; }
  loadDays();
  const { data, error } = await sb.from("jobboard_my_notes").select("job_id,fortune,fortune_note,checked_at");
  if(error){ console.warn("jobboard_my_notes:", error.message); MY_NOTES = {}; return; }
  MY_NOTES = Object.fromEntries((data || []).map(r => [r.job_id, r]));
}
/* ---------- 일별 운세 점수(소민 전용) ----------
   data/owner-days.json: 날짜별 통합 지표(원문 앵커 60% + 명리 30% + 천문 10%, 원문 없는 날은 명리 78% + 천문 22%).
   상징적 행동 우선순위일 뿐 합격 확률이 아니다. 출생 정보·원국·해석 근거는 파일에 없다. */
let DAYS = null, daysPromise = null;
function loadDays(){
  if(daysPromise) return daysPromise;
  daysPromise = fetch("data/owner-days.json?t=" + Date.now()).then(r => r.ok ? r.json() : null)
    .then(o => { DAYS = o && o.days; if(DAYS) renderAll(); }).catch(() => {});
  return daysPromise;
}
const FX_COLS = ["dp", "mp", "src", "bazi", "astro", "score", "verdict", "retro", "exam", "interview", "result"];
/* 목적별 운: 서류 제출(통합) · 시험(인적성·코테·필기) · 면접 · 합격소식 */
const FX_KINDS = [["score", "서류", "서류 제출"], ["exam", "시험", "시험(인적성·코테·필기)"], ["interview", "면접", "면접"], ["result", "합격", "합격소식"]];
const fxVerdict = n => n >= 85 ? "최우수" : n >= 78 ? "좋음" : n >= 70 ? "무난" : n >= 62 ? "주의" : "신중";
/* 전형 이름으로 어떤 운을 볼지 */
const fxKindOf = name => /면접|PT|토론|인터뷰|interview/i.test(name) ? "interview" : /인적성|코딩|코테|필기|시험|테스트|과제|역량검사|NCS|SKCT|GSAT/i.test(name) ? "exam" : /발표|결과|합격|오퍼|최종/i.test(name) ? "result" : "score";
function fxDay(k){
  if(!DAYS || !privOn() || !DAYS[k]) return null;
  const o = {}; FX_COLS.forEach((c, i) => o[c] = DAYS[k][i]); o.date = k; return o;
}
const fxTone = n => n >= 85 ? "hi" : n >= 78 ? "good" : n >= 70 ? "mid" : n >= 62 ? "warn" : "low";
const fxHelp = n => n >= 85 ? "제출 후보일 — 완성된 지원서일 때만, 마감과 품질이 우선"
  : n >= 78 ? "제출에 무난 — 체크리스트를 마치면 진행"
  : n >= 70 ? "검토·수정 후 제출 가능 — 날짜보다 완성도와 마감이 우선"
  : n >= 62 ? "초안 검토·버전 정리에 쓰고, 제출하면 이중 확인"
  : "중요 제출은 여유가 있으면 피하고, 불가피하면 제3자 검토 후";
function fxBadge(k, withVerdict, kind){
  const x = fxDay(k); if(!x) return null;
  kind = kind || "score";
  const v = x[kind] != null ? x[kind] : x.score, lab = FX_KINDS.find(f => f[0] === kind)[1];
  const b = document.createElement("span"); b.className = "fx fx-" + fxTone(v);
  /* withVerdict === "bare": 달력 칸처럼 좁은 곳은 숫자만 */
  b.textContent = (withVerdict === "bare" ? "" : lab + " ") + v + (withVerdict && withVerdict !== "bare" ? " " + fxVerdict(v) : "");
  b.title = k + " " + x.dp + "일 · " + x.mp + "월\n" + FX_KINDS.map(([c, , full]) => full + " " + (x[c] != null ? x[c] : "—") + (x[c] != null ? " " + fxVerdict(x[c]) : "")).join("\n") +
    (x.src != null ? " (원문 " + x.src + ")" : "") + (x.retro ? " · " + (x.retro.includes("m") ? "수성 역행 " : "") + (x.retro.includes("v") ? "금성 역행" : "") : "") +
    "\n" + fxHelp(x.score) + "\n※ 상징 지표, 합격 확률 아님";
  return b;
}
/* 제출 추천일: 마감형은 오늘~D-2 중 통합 점수가 가장 높은 날(같으면 이른 날), 수시·상시는 준비되는 즉시 */
function bestSubmit(j){
  if(!DAYS || !privOn()) return null;
  const end = deadline(j);
  if(!end) return {kind: "now", text: "수시·상시 — 준비되는 즉시 제출"};
  const n = dleft(end);
  if(n < 0) return null;
  if(n < 2) return {kind: "due", text: "마감 임박 — 체크리스트 후 바로 제출"};
  let best = null;
  for(let i = 0; i <= n - 2; i++){
    const d = new Date(TODAY); d.setDate(TODAY.getDate() + i);
    const x = fxDay(iso(d)); if(!x) continue;
    if(!best || x.score > best.score) best = x;
  }
  if(!best) return null;
  const DOW = ["일","월","화","수","목","금","토"], d = parse(best.date);
  return {kind: "day", date: best.date, score: best.score,
    text: (d.getMonth() + 1) + "/" + d.getDate() + "(" + DOW[d.getDay()] + ") " + best.score + " " + best.verdict};
}
function submitHint(j){
  const b = bestSubmit(j); if(!b) return null;
  const el = document.createElement("span"); el.className = "fx-hint" + (b.kind === "day" ? " fx-" + fxTone(b.score) : "");
  el.textContent = (b.kind === "day" ? "제출 추천 " : "") + b.text;
  el.title = "D-2까지 제출 원칙 안에서 일운 통합 점수가 가장 높은 날 · 상징 지표, 합격 확률 아님";
  return el;
}

/* ---------- 운적 궁합(소민 전용, 규칙 기반) ----------
   '공고 운세 판정 프롬프트'의 원칙을 규칙으로 옮긴 상징 지표. 합격 확률이 아니다.
   - 업종을 오행 하나로 판정하지 않고, 실제로 하는 일을 십성 성격(식상·인성·재성·관성·비겁)으로 나눠 본다.
   - 단순 운영보다 문제를 찾아 구조를 개선하는 직무를 높게 본다(식상·인성 중심, 관성 과다는 압박).
   - 기업 규모는 이름이 아니라 체계·권한·Product/Data 접근성으로, 계약형태는 경험 가치로 본다.
   직무 40% + 산업 20% + 기업 규모 20% + 계약형태 20%. */
const UN_ROLE = [
  ["식상", 5, "기획·구조화·문제해결·표현", /기획|설계|구조|개선|문제|가설|실험|분석|데이터|프로덕트|product|\bP[OM]\b|요구사항|화면|UX|콘텐츠|컨텐츠|content|카피|브랜딩|크리에이티브|전략|strategy/i],
  ["인성", 3.5, "학습·문서·전문지식", /리서치|research|인사이트|insight|문서|가이드|교육|연구|트렌드|시장\s*(조사|분석)|컨설팅|consult/i],
  ["재성", 2, "시장·고객·성과", /영업|세일즈|sales|매출|커머스|commerce|\bMD\b|상품|고객사|파트너|제휴|사업\s*개발|\bBD\b|퍼포먼스|광고|그로스|growth|CRM|정산|재무|FP&A|account/i],
  ["관성", 0.5, "조직·책임·규율", /관리|프로젝트|PMO|품질|검수|컴플라이언스|규정|감사|총무|인사|\bHR\b|이해관계자|조율|리스크/i],
  ["비겁", -2, "실적 경쟁·압박", /실적|할당|목표\s*달성|현장\s*영업|방문\s*영업|인바운드\s*영업/i],
  ["반복 운영", -4, "단순·반복 운영 비중", /운영\s*지원|\bCS\b|상담|고객\s*응대|콜센터|사무\s*보조|데이터\s*입력|어시스턴트|assistant|단순/i],
];
const UN_IND = [
  [2.5, "기술·플랫폼·AI", /\bAI\b|LLM|인공지능|플랫폼|platform|SaaS|클라우드|cloud|테크|tech|\bIT\b|앱\s*(서비스|기획|개발)|모바일|소프트웨어|software|데이터|업스테이지|뤼튼|스캐터랩|토스|당근|네이버|카카오|쏘카|숨고|직방|크몽|라인플러스|LINE\b|NHN|google|anthropic|openai|notion|snowflake|salesforce|세일즈포스|adobe|어도비|몰로코|42dot|크래프톤/i],
  [1.5, "커머스·콘텐츠·라이프스타일", /커머스|commerce|콘텐츠|미디어|엔터|게임|뷰티|패션|여행|모빌리티|교육|에듀|무신사|컬리|쿠팡|에이블리|W컨셉|SSG닷컴|11번가|하이브|넷플릭스|올리브영|여기어때|마이리얼트립|야놀자|캐치테이블|강남언니|오늘의집|번개장터/i],
  [1, "금융·핀테크", /금융|은행|증권|보험|카드|핀테크|fintech|결제|투자|핀다|pfct/i],
  [-0.5, "제조·설비·전통 산업", /제조|건설|화학|철강|중공업|에너지|설비|플랜트|조선|물류/i],
  [-0.5, "공공·준정부(관성 과다)", /공사$|공단|재단|진흥원|공공|연구원/],
];
const UN_SIZE = {"외국계": [8, "체계+글로벌 기준, Product/Data 접근성"], "유니콘": [8, "성장 속도와 권한, Product/Data 접근성"],
  "대기업": [7, "체계·안정, 권한은 좁을 수 있음"], "금융": [6.5, "체계·안정, 규율 비중 큼"], "스타트업": [6.5, "권한 큼, 체계·배울 사람은 확인 필요"],
  "중견기업": [6, "체계·권한 중간"], "공기업": [5, "규율·평가 비중 큼(관성 과다)"]};
const UN_FOREIGN = /google|anthropic|openai|notion|netflix|넷플릭스|agoda|아고다|airbnb|에어비앤비|salesforce|세일즈포스|adobe|어도비|intel|인텔|visa|비자|snowflake|\b2k\b|몰로코|42dot/i;
const UN_UNICORN = /쏘카|카카오모빌리티|카카오페이|숨고|직방|크몽|W컨셉|SSG닷컴|11번가|토스|당근|무신사|컬리|크래프톤|야놀자|여기어때|오늘의집|리디|하이브|업스테이지|뤼튼|캐치테이블|마이리얼트립|강남언니|핀다|스캐터랩|직방|번개장터|크림|우아한|쿠팡|에이블리|CJ올리브영/;
function unSize(company, type){
  if(UN_SIZE[type]) return [type].concat(UN_SIZE[type]);
  const t = UN_FOREIGN.test(company) ? "외국계" : UN_UNICORN.test(company) ? "유니콘" : "";
  return t ? [t].concat(UN_SIZE[t]) : ["미상", 6, "기업 형태 정보 없음"];
}
function unContract(text){
  if(/체험형/.test(text)) return [4, "체험형 인턴 — 경험 가치 위주"];
  if(/전환형|채용\s*연계|정규직\s*전환|전환\s*기회/.test(text)) return [7, "전환형 — 자리 현실화 가능"];
  if(/계약직|기간제|파견|휴직\s*대체|contract/i.test(text)) return [5, "계약직 — 핵심 경험이면 예외 검토"];
  if(/인턴|intern/i.test(text)) return [6, "인턴"];
  return [8, "정규직(표시 없음 포함) — 대운의 '자리·시장가치 현실화'와 맞음"];
}
/* job: {company, title, type, roles, kw(JD 키워드 라벨→가중치)} */
function unScore(job){
  if(!privOn()) return null;
  const title = [job.title || "", (job.roles || []).join(" ")].join(" ");
  const kw = job.kw || {};
  const cnt = {}; let tot = 0;
  UN_ROLE.forEach(([c, , , re]) => {
    let n = (title.match(new RegExp(re.source, "gi")) || []).length * 2;
    Object.entries(kw).forEach(([k, w]) => { if(re.test(k)) n += w; });
    cnt[c] = n; tot += n;
  });
  let role = 5; const roleWhy = [];
  if(tot){
    role = 4 + UN_ROLE.reduce((sum, [c, w]) => sum + cnt[c] / tot * w, 0);
    UN_ROLE.filter(([c]) => cnt[c]).sort((a, b) => cnt[b[0]] - cnt[a[0]]).slice(0, 3)
      .forEach(([c, , why]) => roleWhy.push(c + "(" + why + ") " + Math.round(cnt[c] / tot * 100) + "%"));
  } else roleWhy.push("직무 정보 부족");
  role = Math.max(1, Math.min(10, role));
  /* 산업은 JD 본문 키워드(플랫폼·데이터 같은 흔한 말)가 아니라 회사 이름·직무 제목·기업 형태로만 보고,
     좋은 쪽은 가장 강한 하나만, 부담 요소는 모두 반영한다 */
  const itext = [job.company, title, job.type || ""].join(" ");
  let best = 0, minus = 0; const indWhy = [];
  UN_IND.forEach(([w, why, re]) => { if(re.test(itext)){ if(w > 0){ if(w > best){ best = w; indWhy.unshift(why); } } else { minus += w; indWhy.push(why); } } });
  let ind = 5.5 + best + minus;
  ind = Math.max(1, Math.min(10, ind));
  const [sizeT, size, sizeWhy] = unSize(job.company, job.type);
  const [con, conWhy] = unContract(title);
  const total = Math.round((role * 0.4 + ind * 0.2 + size * 0.2 + con * 0.2) * 10);
  const v = total >= 77 ? ["🟢", "적극"] : total >= 71 ? ["🟡", "지원"] : total >= 65 ? ["🟠", "조건부"] : ["🔴", "후순위"];
  return {total, mark: v[0], label: v[1], parts: [
    ["직무", role, roleWhy.join(", ")], ["산업", ind, indWhy.join(", ") || "특이 요소 없음(기본)"],
    ["기업 규모", size, sizeT + " — " + sizeWhy], ["계약형태", con, conWhy]]};
}
function unChip(job){
  const u = unScore(job); if(!u) return null;
  const el = document.createElement("span"); el.className = "un-chip un-" + u.label;
  el.textContent = u.mark + " 운 궁합 " + u.total;
  el.title = "운적 궁합 " + u.total + " · " + u.label + "\n" + u.parts.map(([k, n, why]) => k + " " + n.toFixed(1) + "/10 — " + why).join("\n") +
    "\n※ 원국·대운 기준 규칙으로 계산한 상징 지표, 합격 확률 아님";
  return el;
}
const unJob = j => ({company: j.company, title: [((DETAILS && DETAILS[j.id] && DETAILS[j.id].tracks) || []).map(t => t.name).join(" "), j.hist || ""].join(" "),
  type: j.type, roles: j.roles});

function myBadge(id){
  const n = MY_NOTES[id];
  if(!n) return null;
  const s = document.createElement("span"); s.className = "mybadge";
  s.textContent = "📌 부탁" + (n.fortune ? " · " + n.fortune : "");
  s.title = "직접 분석을 부탁한 공고" + (n.fortune_note ? "\n운세: " + n.fortune_note : "");
  return s;
}
function cell(content, cls, style){
  const td = document.createElement("td");
  if(cls) td.className = cls;
  if(style) td.style.cssText = style;
  if(content instanceof Node) td.appendChild(content); else td.textContent = content;
  return td;
}

/* ---------- 내 지원 ---------- */
function myJobs(){ return allJobs().filter(j => appOf(j.id).applied); }

/* 지원이 어디서 막히는지 한 판에 — 서류에서 막히면 자소서를, 면접에서 막히면 답변을 손본다.
   그리고 마감이 지났는데 아직 "대기"인 건은 결과 확인을 놓치기 쉬워 따로 짚어준다. */
function funnelBoard(list){
  const box = document.createElement("section"); box.className = "ddb";
  const applied = list.length;
  /* 결과를 적어야 할 공고 — 표의 '확인 필요'와 같은 판정(발표 예정일이 지났거나, 없으면 마감 후 14일) */
  const stale = list.filter(j => statusOf(appOf(j.id), j) === "확인필요");

  const h = document.createElement("div"); h.className = "ddb-h";
  const t = document.createElement("h3"); t.textContent = "지원 현황";
  const sub = document.createElement("span"); sub.className = "sub";
  sub.textContent = applied ? "담은 공고 " + applied + "건" : "";
  h.append(t, sub); box.appendChild(h);
  /* 표 보기와 같은 타일·같은 셈(B16) */
  box.append(statusTiles(list.map(j => statusOf(appOf(j.id), j))), rateLine(list.map(j => appOf(j.id))));
  { const link = linkBanner(); if(link) box.append(link); }

  if(stale.length){
    const p = document.createElement("p"); p.className = "warn";
    p.style.marginTop = "8px";
    p.textContent = "결과를 확인할 공고가 " + stale.length + "건 있어요(" + stale.slice(0,3).map(j => j.company).join(", ") +
                    (stale.length > 3 ? " 외" : "") + "). 발표 예정일이 지났거나, 서류 마감 뒤 " + CHECK_AFTER_DAYS + "일이 지났어요. 서류 결과를 적어 주세요.";
    box.appendChild(p);
  }
  return box;
}

/* 일정 한 줄(.dd)의 칸 — 카드 보기 '다가오는 일정'과 '오늘' 화면이 같이 쓴다.
   예상 날짜는 D-day 뒤에 '예상' 꼬리표, 예상 마감이 오늘이면 「오늘」 + 「예상 마감 · 공고 확인」(UX 04 B-3-3) */
function ddCls(date, est){ const d = dleft(date); return "dd" + (d <= 3 ? " u" : d <= 10 ? " s" : "") + (est ? " est" : ""); }
function ddRow(r){
  const d = dleft(r.date), isEnd = r.what === "서류 마감", estToday = r.est && isEnd && d === 0;
  const n = document.createElement("div"); n.className = "dd-n";
  n.textContent = dday(r.date);
  if(r.est) n.append(estTag(isEnd ? "end" : "stage"));
  const co = document.createElement("div"); co.className = "dd-co"; co.textContent = r.j.company;
  const ddB = myBadge(r.j.id); if(ddB) co.appendChild(ddB);
  const wt = document.createElement("div"); wt.className = "dd-w"; wt.textContent = estToday ? "예상 마감 · 공고 확인" : r.what;
  const dt = document.createElement("div"); dt.className = "dd-d"; dt.textContent = fmtAt(r.date, r.time);
  return [n, co, wt, dt];
}
/* 담은 공고의 마감·전형 일정을 D-day 순으로 한 판에 */
function ddayBoard(list){
  const rows = [];
  list.forEach(function(j){
    const a = appOf(j.id), dl = deadline(j);
    if(dl && a.doc === "대기") rows.push({date:dl, what:"서류 마감", j:j, time: deadlineTime(j), est: estDeadline(j, a)});
    a.stages.forEach(s => { if(s.date) rows.push({date:s.date, what:s.name, j:j, time:s.time || "", est: !!s.est}); });
  });
  rows.sort((x,y) => x.date.localeCompare(y.date));
  const up = rows.filter(r => dleft(r.date) >= 0);
  const past = rows.length - up.length;

  const box = document.createElement("section"); box.className = "ddb";
  const h = document.createElement("div"); h.className = "ddb-h";
  const t = document.createElement("h3"); t.textContent = "다가오는 일정";
  const s = document.createElement("span"); s.className = "sub";
  s.textContent = up.length ? up.length + "건" + (past ? " · 지난 일정 " + past + "건은 숨김" : "")
                            : "마감일이 잡힌 일정이 없어요";
  h.append(t, s); box.appendChild(h);

  if(!up.length){
    const p = document.createElement("p"); p.className = "sub";
    p.style.padding = "4px 2px 2px";
    p.textContent = "카드의 서류 마감 칸에 날짜를 넣으면 여기 D-day로 모여요. 상시 공고는 날짜를 직접 정해 주세요.";
    box.appendChild(p);
    return box;
  }
  const ul = document.createElement("div"); ul.className = "ddb-list";
  up.forEach(function(r){
    const row = document.createElement("div");
    row.className = ddCls(r.date, r.est);
    row.append(...ddRow(r));
    /* 눌러서 바로 공고로 — 행 전체는 상세, 링크는 회사 채용페이지로 */
    row.onclick = () => openJob(r.j.id);
    const url = safeUrl(r.j.url);
    if(url){
      const go = document.createElement("a");
      go.className = "dd-go"; go.href = url; go.target = "_blank"; go.rel = "noopener";
      go.textContent = "공고 ↗";
      go.onclick = e => e.stopPropagation();
      row.appendChild(go);
    }
    ul.appendChild(row);
  });
  box.appendChild(ul);
  return box;
}
/* ---------- 같은 회사 이름 맞추기 · 중복 지원 합치기 ----------
   '한국후지필름'과 '후지필름_18시', 'SKT'와 'SK텔레콤'처럼 표기만 다른 이름을 같은 회사로 본다. */
const CO_ALIAS = {skt: "sk텔레콤", "기아자동차": "기아", "현대차": "현대자동차", "lg엔솔": "lg에너지솔루션", "kt&g": "ktng", "케이티앤지": "ktng"};
function canonCo(s){
  let k = (s || "").split(/[_(\[]/)[0].toLowerCase().replace(/주식회사|㈜|[\s·\-—]/g, "");
  k = CO_ALIAS[k] || k;
  return k.length > 3 ? k.replace(/^한국/, "") : k;
}
const roleKey = (j, a) => (a.role || (j.source === "직접 등록" ? j.hist || "" : "")).toLowerCase().replace(/[\s·\-—_/()]/g, "");
/* 내 지원 안에서 같은 회사·같은 직무로 보이는 짝 — 직무가 분명히 다르면(메가스터디 고등/유초중) 짝이 아니다 */
function findDupes(){
  const list = myJobs(), pairs = [], used = new Set();
  for(let i = 0; i < list.length; i++) for(let k = i + 1; k < list.length; k++){
    const x = list[i], y = list[k];
    if(used.has(x.id) || used.has(y.id) || canonCo(x.company) !== canonCo(y.company)) continue;
    const rx = roleKey(x, appOf(x.id)), ry = roleKey(y, appOf(y.id));
    if(rx && ry && !rx.includes(ry) && !ry.includes(rx)) continue;
    /* 같은 회사라도 공고 제목이나 직무 분류가 다르면 다른 공고다(QA-10 · NHN 직무별 공고 등) */
    const tk = j => (j.title || "").toLowerCase().replace(/\s/g, "");
    if(tk(x) && tk(y) && tk(x) !== tk(y)) continue;
    if((x.roles || []).length && (y.roles || []).length && !x.roles.some(r => y.roles.includes(r))) continue;
    pairs.push([x, y]); used.add(x.id); used.add(y.id);
  }
  return pairs;
}
/* 남길 쪽: 지원보드 공고 > 내용이 많은 쪽. 나머지의 직무·결과·전형·메모·자소서를 옮기고 지운다 */
function mergeDupe(x, y){
  const isCustom = j => db.custom.some(c => c.id === j.id);
  const weight = j => { const a = app(j.id); return (isCustom(j) ? 0 : 100) + a.stages.length * 5 + (a.essays || []).length * 3 + (a.note ? 1 : 0) + (a.doc !== "대기" ? 2 : 0); };
  const [keep, drop] = weight(x) >= weight(y) ? [x, y] : [y, x];
  const a = app(keep.id), b = app(drop.id);
  if(!a.role) a.role = b.role || (isCustom(drop) ? drop.hist || "" : "");
  if(a.doc === "대기" && b.doc !== "대기") a.doc = b.doc;
  b.stages.forEach(st => { if(!a.stages.some(s => s.name === st.name)) a.stages.push(st); });
  if(b.note && !(a.note || "").includes(b.note)) a.note = ((a.note || "") + " " + b.note).trim();
  /* 자소서는 합치고(같은 문항·답 제외), 글은 비어 있으면 옮기고 둘 다 있으면 뒤에 붙인다 — 지우는 쪽 글이 사라지지 않게(CR-08) */
  a.essays = (a.essays || []).concat((b.essays || []).filter(e => !(a.essays || []).some(x => x.q === e.q && x.a === e.a)));
  ["cover", "resume", "folio", "req", "pref"].forEach(f => { if(b[f] && !a[f]) a[f] = b[f]; else if(b[f] && a[f] !== b[f] && !a[f].includes(b[f])) a[f] = a[f] + "\n\n" + b[f]; });
  ["resultAt", "myEnd"].forEach(f => { if(!a[f] && b[f]) a[f] = b[f]; });
  if(b.check) a.check = true;
  b.applied = false;
  if(isCustom(drop)){ db.custom = db.custom.filter(c => c.id !== drop.id); delete db.apps[drop.id]; }
}
function dupBanner(){
  const pairs = findDupes();
  if(!pairs.length) return null;
  const box = document.createElement("div"); box.className = "dup-bar";
  const t = document.createElement("span");
  t.textContent = "같은 공고로 보이는 지원 " + pairs.length + "쌍: " + pairs.slice(0, 4).map(([x, y]) => x.company + " ↔ " + y.company).join(", ") + (pairs.length > 4 ? " 외" : "");
  const b = document.createElement("button"); b.className = "primary"; b.textContent = "하나로 합치기";
  /* 한꺼번에 바꾸는 일이라 합칠 쌍을 보여 주고 묻는다(QA-10) */
  const label = j => j.company + (j.title ? "(" + j.title + ")" : (j.roles || []).length ? "(" + j.roles.join(", ") + ")" : "");
  b.onclick = async () => {
    const ok = await confirmDlg({title: "같은 공고로 보이는 지원 " + pairs.length + "쌍을 하나로 합칠까요?",
      body: pairs.map(([x, y]) => label(x) + " ↔ " + label(y)).join(" · ") + ". 직무·결과·전형·메모·자소서는 남기는 쪽으로 옮겨요."}, "합치기", "닫기");
    if(!ok) return;
    pairs.forEach(([x, y]) => mergeDupe(x, y)); save(); renderAll(); toast(pairs.length + "쌍을 합쳤어요 · 직무·결과·메모는 남긴 쪽으로 옮겼어요");
  };
  box.append(t, b); return box;
}

/* ---------- 내 지원: 표로 관리 ----------
   상태는 합격(진행 중)·대기·탈락·확인 필요·미지원 다섯 가지. 칸을 바로 고치면 저장된다. */
const T_STATUS = ["합격", "대기", "탈락", "확인필요", "미지원"];
const T_LABEL = {"합격": "합격·진행", "대기": "결과 대기", "탈락": "탈락", "확인필요": "확인 필요", "미지원": "미지원", "제출전": "제출 전"};
let tFilter = "", tQuery = "";
/* 표의 상태 칸에 고를 값 — 화면 상태(statusOf)의 '마감 전'은 '대기'를 고른 것과 같다 */
function tStatus(a, j){ const s = statusOf(a, j); return s === "마감전" ? "대기" : s; }
function setTStatus(a, v){
  a.check = false; a.skip = false; a.applied = true;
  if(VARIANT === "b2"){
    if(v === "제출전"){ a.sent = false; delete a.sentAt; setDoc(a, "대기"); return; }
    if(v !== "미지원") markSent(a);
  }
  if(v === "합격"){ setDoc(a, "합격"); a.stages.forEach(s => { if(s.result === "불합격") s.result = "예정"; }); }
  else if(v === "대기"){ setDoc(a, "대기"); }
  else if(v === "탈락"){
    const last = a.stages[a.stages.length - 1];
    if(a.doc === "합격" && last) last.result = "불합격"; else setDoc(a, "불합격");
  }
  else if(v === "확인필요"){ a.check = true; }
  else if(v === "미지원"){ a.applied = false; a.skip = true; }
}
/* 직무 칸에 링크·주소가 섞여 들어온 경우(현황표의 링크 칸 등) 글자만 남긴다 */
function cleanRole(s){
  return String(s || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S*/gi, "").replace(/\bwww\.\S+/gi, "")
    .replace(/\s{2,}/g, " ").replace(/^[\s,·|/-]+|[\s,·|/-]+$/g, "").trim();
}
/* ---------- 전형 단계: 기본 흐름 + 회사마다 고칠 수 있음(a.flow) ----------
   단계를 고르면 그 앞 단계는 합격, 고른 단계는 진행 중(예정)으로 카드 보기의 전형 목록과 같이 맞춘다. */
/* 표의 기본 전형 순서는 카드의 전형 이름(STAGES: AI 역량검사 · 적성검사 · 인적성검사 · 필기전형 · GSAT · 과제 · 1·2·최종 면접)과 같게(B13) */
const stDisp = s => String(s || "").replace(/^서류합격$/, "서류 합격").replace(/^최종합격$/, "최종 합격");
const stKey = s => String(s || "").replace(/\s/g, "").replace(/검사$|전형$/, "").replace(/^서류발표$/, "서류합격");
const stdFlow = () => ["서류합격"].concat(STAGES.filter(n => stKey(n) !== "서류합격"));
function flowOf(a){ return (a.flow && a.flow.length) ? a.flow : stdFlow(); }
function stageNow(a){
  if(!a.applied) return "";
  if(a.doc !== "합격") return a.doc === "불합격" ? "서류 탈락" : "서류 제출";
  if(!a.stages.length) return "서류합격";
  const fail = a.stages.find(s => s.result === "불합격");
  if(fail) return fail.name + " 탈락";
  const last = a.stages[a.stages.length - 1];
  if(last.result === "합격" && /최종/.test(last.name)) return "최종합격";
  const cur = a.stages.find(s => s.result !== "합격") || last;
  return cur.name;
}
function setStage(a, name){
  const flow = flowOf(a).filter(n => stKey(n) !== "서류합격");
  a.applied = true; a.skip = false;
  if(name === "서류 제출"){ setDoc(a, "대기"); a.stages = a.stages.filter(s => s.date || s.result === "불합격" || flow.every(n => stKey(n) !== stKey(s.name))); return; }
  setDoc(a, "합격"); a.check = false;
  if(name === "최종합격"){
    const last = flow[flow.length - 1];
    a.stages.forEach(s => { if(s.result !== "불합격") s.result = "합격"; });
    if(last && !a.stages.some(s => stKey(s.name) === stKey(last))) a.stages.push({name: last, date: "", result: "합격"});
    return;
  }
  const k = name === "서류합격" ? -1 : flow.findIndex(n => stKey(n) === stKey(name));
  flow.forEach((n, i) => {
    let st = a.stages.find(s => stKey(s.name) === stKey(n));
    /* 앞 단계는 실제로 거친 것(이미 적어 둔 것)만 합격으로 — 회사마다 없는 전형을 만들어 넣지 않는다 */
    if(i < k){ if(st && st.result !== "불합격") st.result = "합격"; }
    else if(i === k){ if(!st){ st = {name: n, date: ""}; a.stages.push(st); } if(st.result !== "불합격") st.result = st.result === "완료" ? "완료" : "예정"; }
    else if(st && !st.date && st.result !== "불합격") a.stages.splice(a.stages.indexOf(st), 1);
  });
  // 흐름 순서대로(직접 넣은 전형은 뒤에 그대로)
  const ord = s => { const i = flow.findIndex(n => stKey(n) === stKey(s.name)); return i < 0 ? 99 : i; };
  a.stages.sort((x, y) => ord(x) - ord(y));
}
function stageSelect(a, j){
  const sel = document.createElement("select"); sel.className = "tb-stage"; sel.setAttribute("aria-label", j.company + " 진행 단계");
  const now = stageNow(a);
  const opts = ["서류 제출"].concat(flowOf(a).map(n => stKey(n) === "서류합격" ? "서류합격" : n), ["최종합격"]);
  if(now && !opts.includes(now)) opts.push(now);
  opts.forEach(o => { const op = document.createElement("option"); op.value = o; op.textContent = stDisp(o); op.selected = o === now || stKey(o) === stKey(now); sel.append(op); });
  const ed = document.createElement("option"); ed.value = "__edit"; ed.textContent = "전형 순서 고치기…"; sel.append(ed);
  if(/탈락/.test(now)) sel.classList.add("fail"); else if(now === "최종합격") sel.classList.add("pass");
  sel.onchange = () => {
    /* 전형 순서는 화면 안 입력칸으로(B20 · UX 04 B-4 표 1번) */
    if(sel.value === "__edit"){ INL = {kind: "flow", id: j.id}; renderMine(); focusInline(); return; }
    if(/탈락$/.test(sel.value)) return;
    setStage(a, sel.value); save(); renderAll();
  };
  return sel;
}
function mineTable(){
  const all = allJobs().map(j => ({j, a: db.apps[j.id]})).filter(r => r.a && statusOf(r.a, r.j));
  all.forEach(r => { r.view = statusOf(r.a, r.j); r.st = r.view === "마감전" ? "대기" : r.view; });
  const box = document.createElement("div"); box.className = "tb-wrap";

  box.append(statusTiles(all.map(r => r.view)), rateLine(all.filter(r => r.a.applied).map(r => r.a)));
  { const link = linkBanner(); if(link) box.append(link); }   /* 예상 일정의 실제 공고 후보는 요약 타일 아래 */

  const bar = document.createElement("div"); bar.className = "tb-bar";
  const q = document.createElement("input"); q.type = "search"; q.placeholder = "기업·직무 검색"; q.value = tQuery; q.className = "tb-q";
  q.setAttribute("aria-label", "기업·직무 검색");
  /* 검색칸은 다시 만들지 않고 줄만 다시 그린다 — 한글 조합 중에 칸이 바뀌면 글자가 깨진다(CR-15) */
  let qTimer = null;
  const onQ = () => { tQuery = q.value; clearTimeout(qTimer); qTimer = setTimeout(fillRows, 150); };
  q.addEventListener("input", e => { if(!e.isComposing) onQ(); });
  q.addEventListener("compositionend", onQ);
  /* 행 추가는 화면 안 입력칸으로(B20 · UX 04 B-4 표 2번) */
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.className = "primary"; addBtn.textContent = "+ 행 추가";
  const add = inlineSlot("addrow", "", addBtn, {label: "회사 이름", placeholder: "회사 이름", ok: "추가", onSubmit: c => {
    const id = "u" + Date.now();
    db.custom.push({id, company: c, roles: [], start: "", end: "", confirmed: true, source: "직접 등록", type: "", hist: "", url: ""});
    const a = app(id); a.applied = true; a.at = iso(TODAY); save(); renderAll();
    toast(c + " · 내 지원에 담았어요. 마감일을 넣어 주세요.");
  }});
  const exp = document.createElement("button"); exp.className = "ghost"; exp.textContent = "내보내기";
  exp.onclick = () => {
    /* 표 프로그램이 수식으로 읽지 않게 = + - @ 탭으로 시작하는 값 앞에 ' (CSV 수식 주입 방지) */
    const esc = v => { let s = String(v || ""); if(/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const lines = [["기업", "직무", "상태", "진행 단계", "발표 예정일", "마감", "메모"].join(",")].concat(all.map(r => [r.j.company, cleanRole(r.a.role), r.view === "마감전" ? "마감 전" : T_LABEL[r.st], stDisp(stageNow(r.a)), r.a.resultAt || "", deadline(r.j) || "", r.a.note || ""].map(esc).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\n")], {type: "text/csv"});
    const l = document.createElement("a"); l.href = URL.createObjectURL(blob); l.download = "지원현황_" + iso(new Date()) + ".csv"; l.click();
  };
  const sp = document.createElement("span"); sp.className = "hspace";
  bar.append(sp, q, add, exp); box.append(bar);

  const order = r => T_STATUS.indexOf(r.st);
  const t = document.createElement("table"); t.className = "tb";
  t.innerHTML = "<thead><tr><th>기업</th><th>직무</th><th>상태</th><th>진행 단계</th><th>발표 예정일</th><th>마감</th><th>메모</th><th></th></tr></thead>";
  const tb = document.createElement("tbody");
  fillRows();
  function fillRows(){
  const ql = tQuery.trim().toLowerCase();
  const rows = all.filter(r => (tFilter ? r.view === tFilter : r.view !== "미지원") &&
      (!ql || (r.j.company + " " + (r.a.role || "") + " " + (r.a.note || "")).toLowerCase().includes(ql)))
    .sort((x, y) => order(x) - order(y) || (deadline(x.j) || "9999").localeCompare(deadline(y.j) || "9999"));
  tb.replaceChildren();
  if(!rows.length){ const tr = document.createElement("tr"); tr.innerHTML = '<td colspan="8" class="tb-empty">' + (tFilter ? "‘" + (Object.fromEntries(tileDefs())[tFilter] || T_LABEL[tFilter] || tFilter) + "’ 지원이 없어요." : "담은 공고가 없어요. 전체 공고에서 ‘담기’를 누르면 여기 모여요.") + '</td>'; tb.append(tr); }
  rows.forEach(({j, a, st, view}) => {
    const tr = document.createElement("tr"); tr.className = "s-" + view;
    const td = (cls, label) => { const c = document.createElement("td"); c.className = cls; c.dataset.label = label; tr.append(c); return c; };
    const custom = db.custom.find(c => c.id === j.id);
    const cCo = td("tb-co", "기업");
    if(custom){
      const i = document.createElement("input"); i.value = j.company; i.setAttribute("aria-label", "기업");
      i.onchange = () => { custom.company = i.value.trim() || custom.company; save(); renderAll(); }; cCo.append(i);
    } else {
      const s = document.createElement("span"); s.textContent = j.company; cCo.append(s);
      const url = safeUrl(j.url);
      if(url){ const l = document.createElement("a"); l.href = url; l.target = "_blank"; l.rel = "noopener"; l.textContent = "↗"; l.title = j.company + " 공고 원문"; l.setAttribute("aria-label", j.company + " 공고 원문"); l.className = "tb-link"; cCo.append(l); }
    }
    { const uj = unJob(j); uj.title = cleanRole(a.role) + " " + uj.title;
      const uc = unChip(uj); if(uc){ uc.classList.add("un-sm"); uc.textContent = uc.textContent.replace(" 운 궁합", ""); const w = document.createElement("div"); w.className = "tb-un"; w.append(uc); cCo.append(w); } }
    const cRole = td("tb-role", "직무");
    if(a.role && a.role !== cleanRole(a.role)){ a.role = cleanRole(a.role); save(); }
    const ri = document.createElement("input"); ri.value = a.role || (custom ? cleanRole(j.hist) : ""); ri.placeholder = (j.roles || []).join(", ") || "직무";
    ri.setAttribute("aria-label", j.company + " 직무");
    ri.oninput = () => { a.role = ri.value.trim(); saveSoon(); };
    ri.onchange = () => { a.role = ri.value.trim(); save(); };
    cRole.append(ri);
    const cSt = td("tb-st", "상태");
    const ss = document.createElement("select"); ss.className = "tb-pill s-" + view; ss.setAttribute("aria-label", j.company + " 상태");
    /* 고른 상태는 칩 규칙(UX 04 B-3-1)대로 지금 단계까지 보여 준다 — 예: 「AI 역량검사 준비 · D-2」「서류 결과 대기」. 나머지 선택지는 타일과 같은 이름 */
    (VARIANT === "b2" ? ["제출전"].concat(T_STATUS) : T_STATUS).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = k === st ? rowChip(a, j, view) : T_LABEL[k]; o.selected = k === st; ss.append(o); });
    ss.onchange = () => {
      setTStatus(a, ss.value); save(); renderAll();
      /* 발표 예정일(없으면 마감 후 14일)이 지나 다시 '확인 필요'로 보이면 이유를 알려 준다 */
      if(ss.value === "대기" && needsCheck(a, j)) toast("발표 예정일이 지나 ‘확인 필요’로 보여요. 발표 예정일을 고치면 그날까지 결과 대기로 보여요.");
    };
    cSt.append(ss);
    if(VARIANT === "b2" && view === "제출전") cSt.append(sentBtn(a, j));
    const cStg = td("tb-stg", "단계");
    cStg.append(stageSelect(a, j));
    if(inlOpen("flow", j.id)) cStg.append(inlineAdd("flow", j.id, null, {label: j.company + " 전형 순서", value: flowOf(a).join(", "), ok: "저장",
      help: "쉼표로 나눠 적어 주세요. 예: 서류합격, 인적성, 1차 면접, 최종 면접",
      onSubmit: v => { const f = v.split(/[,，>→\n]+/).map(x => x.trim()).filter(Boolean); if(f.length) a.flow = f; else delete a.flow; save(); renderAll(); }}));
    /* 서류 다음 단계로 가 있으면 그 단계의 날짜·시각을 표에서 바로(B13) */
    const cur = a.doc === "합격" ? a.stages.find(s => s.result !== "합격" && s.result !== "불합격") : null;
    if(cur) cStg.append(stageWhen(a, j, cur));
    /* 발표 예정일 — 지나도 결과가 대기면 '확인 필요'(B02) */
    const cRes = td("tb-date", "발표 예정일");
    const rd = document.createElement("input"); rd.type = "date"; rd.value = a.resultAt || ""; rd.setAttribute("aria-label", j.company + " 발표 예정일");
    if(!rd.value) cRes.classList.add("empty");
    rd.onchange = () => { a.resultAt = rd.value; save(); renderAll(); };
    cRes.append(rd);
    const cEnd = td("tb-date", "마감");
    const ed = document.createElement("input"); ed.type = "date"; ed.value = deadline(j) || ""; ed.setAttribute("aria-label", j.company + " 마감일");
    if(!ed.value) cEnd.classList.add("empty");
    if(st === "대기" || st === "확인필요"){ const h = submitHint(j); if(h && h.textContent.startsWith("제출")) cEnd.append(h); }
    ed.onchange = () => { if(custom) custom.end = ed.value; else a.myEnd = ed.value; save(); renderAll(); };
    cEnd.prepend(ed);
    if(ed.value && estDeadline(j, a)) ed.after(estTag("end"));
    const cNote = td("tb-note", "메모");
    const ni = document.createElement("input"); ni.value = a.note || ""; ni.placeholder = "—"; ni.setAttribute("aria-label", j.company + " 메모");
    ni.oninput = () => { a.note = ni.value; saveSoon(); };
    ni.onchange = () => { a.note = ni.value; save(); };
    cNote.append(ni);
    const cX = td("tb-x", "");
    /* 빼기는 확인 없이 바로, 토스트의 [되돌리기]로 원래대로(B25). 적어 둔 내용은 그대로 남는다 */
    const x = document.createElement("button"); x.type = "button"; x.className = "tb-del"; x.textContent = "×";
    x.title = j.company + " 내 지원에서 빼기"; x.setAttribute("aria-label", j.company + " 내 지원에서 빼기");
    x.onclick = () => unapplyJob(j);
    cX.append(x);
    tb.append(tr);
  });
  }
  t.append(tb); box.append(t);
  /* 미지원은 지원 합계에서 빠지므로 타일 대신 표 아래 글자 버튼으로(UX 04 B-3-1) */
  const nSkip = all.filter(r => r.view === "미지원").length;
  if(nSkip || tFilter === "미지원"){
    const sk = document.createElement("button"); sk.type = "button"; sk.className = "ghost tb-skip";
    sk.textContent = tFilter === "미지원" ? "담은 공고 보기" : "미지원 " + nSkip + "건 보기";
    sk.setAttribute("aria-pressed", tFilter === "미지원");
    sk.onclick = () => { tFilter = tFilter === "미지원" ? "" : "미지원"; renderMine(); };
    box.append(sk);
  }
  return box;
}
/* 표 상태 칸의 글자(칩 규칙): 합격·진행은 단계 + 준비/결과 대기(+ 다음 일정 D-day), 대기는 '서류 결과 대기' */
function rowChip(a, j, view){
  if(view === "마감전") return "마감 전";
  if(view === "대기") return "서류 결과 대기";
  const c = stateChip(a, j);
  if(!c) return T_LABEL[view] || view;
  if(view === "합격"){
    const next = a.stages.find(s => s.result !== "합격" && s.result !== "불합격" && s.date && dleft(s.date) >= 0);
    return c[0] + (next ? " · " + dday(next.date) : "");
  }
  return c[0];
}
/* 상태 타일(표·카드 공통, UX 04 B-3-1): 흐름 순서로 전체 · 마감 전 · 결과 대기 · 확인 필요 · 합격·진행 · 탈락. 누르면 그 상태만 */
function tileDefs(){
  /* 실험 2 B: '제출 전'이 '마감 전' 자리를 대신한다(03 문서 3.3) */
  return [["", "전체"], VARIANT === "b2" ? ["제출전", "제출 전"] : ["마감전", "마감 전"], ["대기", "결과 대기"], ["확인필요", "확인 필요"], ["합격", "합격·진행"], ["탈락", "탈락"]];
}
/* 실험 2 B: [제출했어요] — 누르면 결과 대기로, 토스트 [되돌리기] */
function sentBtn(a, j){
  const b = document.createElement("button"); b.type = "button"; b.className = "ghost sent-btn"; b.textContent = "제출했어요";
  b.setAttribute("aria-label", j.company + " 서류를 제출했어요");
  b.onclick = () => {
    markSent(a); save(); renderAll(); if(jobDlg.open && jdId === j.id) openJob(j.id);
    toast(j.company + " · 제출했다고 적었어요", {label: "되돌리기", run: () => { a.sent = false; delete a.sentAt; save(); renderAll(); if(jobDlg.open && jdId === j.id) openJob(j.id); toast("되돌렸어요"); }});
  };
  return b;
}
function statusTiles(views){
  const tiles = document.createElement("div"); tiles.className = "tb-tiles";
  tileDefs().forEach(([k, l]) => {
    const n = k ? views.filter(v => v === k).length : views.filter(v => v !== "미지원").length;
    const b = document.createElement("button"); b.type = "button"; b.className = "tb-tile " + (k ? "s-" + k : "s-all");
    b.setAttribute("aria-pressed", tFilter === k);
    const nn = document.createElement("b"); nn.textContent = n; const ll = document.createElement("span"); ll.textContent = l;
    b.append(nn, ll); b.onclick = () => { tFilter = tFilter === k ? "" : k; renderMine(); }; tiles.append(b);
  });
  return tiles;
}
/* 서류 합격률은 한 가지 정의: 서류 합격 ÷ (서류 합격 + 서류 탈락) — 숫자 옆에 정의를 함께 쓴다(B16) */
function rateLine(apps){
  const pass = apps.filter(a => a.doc === "합격").length, fail = apps.filter(a => a.doc === "불합격").length;
  const stagePass = apps.filter(a => a.stages.some(s => s.result === "합격")).length;
  const finalPass = apps.filter(a => a.stages.some(s => /최종/.test(s.name) && s.result === "합격")).length;
  const p = document.createElement("p"); p.className = "sub fnl-sum";
  p.textContent = (pass + fail ? "서류 결과가 나온 " + (pass + fail) + "건 중 " + pass + "건 합격(" + Math.round(pass / (pass + fail) * 100) + "%)" : "아직 서류 결과가 나온 공고가 없어요") +
    " · 전형 통과 " + stagePass + "건 · 최종 합격 " + finalPass + "건";
  p.title = "서류 합격률 = 서류 합격 ÷ (서류 합격 + 서류 탈락). 결과를 기다리는 공고는 셈에 넣지 않아요.";
  return p;
}
document.getElementById("mvTable").onclick = () => { db.profile.mineView = "table"; save(); renderMine(); };
document.getElementById("mvCard").onclick = () => { db.profile.mineView = "card"; save(); renderMine(); };

/* 카드의 접이식 칸 — 다시 그려도 펼친 상태를 그대로 둔다(CR-14) */
const OPEN_FOLDS = new Set();
function foldEl(key){
  const d = document.createElement("details"); d.className = "fold";
  d.open = OPEN_FOLDS.has(key);
  d.addEventListener("toggle", () => { if(d.open) OPEN_FOLDS.add(key); else OPEN_FOLDS.delete(key); });
  return d;
}
function renderMine(){
  const wrap = document.getElementById("apps");
  wrap.innerHTML = "";
  const list = myJobs().sort(function(x,y){
    return (deadline(x) || "9999").localeCompare(deadline(y) || "9999");
  });
  document.getElementById("c-mine").textContent = list.length || "";
  const view = db.profile.mineView || "table";
  document.getElementById("mvTable").setAttribute("aria-pressed", view === "table");
  document.getElementById("mvCard").setAttribute("aria-pressed", view === "card");
  if(JOBS_FAIL) wrap.insertAdjacentHTML("beforeend", '<p class="notice notice-warn">공고 데이터를 불러오지 못했어요. 담은 공고 중 일부가 지금 안 보일 수 있어요. 잠시 뒤 새로고침해 주세요.</p>');
  const dup = dupBanner(); if(dup) wrap.appendChild(dup);
  if(view === "table"){ wrap.appendChild(mineTable()); return; }
  if(!list.length){
    wrap.insertAdjacentHTML("beforeend", '<div class="empty">아직 담은 공고가 없어요.<br>전체 공고에서 <b>담기</b>를 누르면 여기 모이고, 마감일과 전형 일정을 관리할 수 있어요.</div>');
    return;
  }
  wrap.appendChild(funnelBoard(list));
  wrap.appendChild(ddayBoard(list));
  list.filter(j => !tFilter || statusOf(appOf(j.id), j) === tFilter).forEach(function(j){
    const a = appOf(j.id);
    const card = document.createElement("div"); card.className = "app";

    const h = document.createElement("div"); h.className = "app-h";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = j.company;
    const nmB = myBadge(j.id); if(nmB) nm.appendChild(nmB);
    const rl = document.createElement("span"); rl.className = "rl"; rl.textContent = a.role || (j.roles||[]).join(", ");
    const dl0 = deadline(j);
    /* 지금 어디까지 왔는지 한눈에 — 표와 같은 상태 판정(statusOf), 접힌 카드에서도 보이게 이름 옆에 둔다 */
    const stc = stateChip(a, j);
    h.append(nm);
    if(stc){ const c = document.createElement("span"); c.className = "st-chip " + stc[1]; c.textContent = stc[0]; h.append(c); }
    if(dl0 && dleft(dl0) >= 0 && a.doc === "대기"){
      const dd = document.createElement("span");
      const n = dleft(dl0), est = estDeadline(j, a);
      dd.className = "hd-dday" + (n <= 3 ? " u" : n <= 10 ? " s" : "") + (est ? " est" : "");
      dd.textContent = n === 0 ? (est ? "예상 마감 오늘 · 공고 확인" : "오늘 마감") : "D-" + n;
      if(est && n !== 0) dd.append(estTag("end"));
      h.appendChild(dd);
    }
    h.appendChild(rl);
    const sp = document.createElement("span"); sp.className = "hspace"; h.appendChild(sp);
    const url = safeUrl(j.url);
    if(url){
      const l = document.createElement("a"); l.href = url; l.target = "_blank"; l.rel = "noopener";
      l.textContent = "공고 열기"; l.style.cssText = "font-size:12.5px;color:var(--muted)"; h.appendChild(l);
    }
    const rm = document.createElement("button"); rm.className = "ghost"; rm.textContent = "내 지원에서 빼기";
    rm.onclick = () => unapplyJob(j);
    /* 카드 접기: 서류에서 떨어졌거나 마감이 지나 대기 중인 공고는 기본으로 접는다. 직접 접고 편 상태는 기억한다 */
    const ended = a.doc === "불합격" || (dl0 && dleft(dl0) < 0 && a.doc === "대기");
    const folded = a.fold === undefined ? ended : a.fold;
    const foldBtn = document.createElement("button"); foldBtn.className = "ghost fold-btn";
    foldBtn.setAttribute("aria-expanded", String(!folded));
    foldBtn.textContent = folded ? "펼치기 ▾" : "접기 ▴";
    h.appendChild(foldBtn);
    h.appendChild(rm);
    card.appendChild(h);

    const b = document.createElement("div"); b.className = "app-b";
    b.hidden = folded;
    if(folded) card.classList.add("folded");
    foldBtn.onclick = () => {
      a.fold = !b.hidden; save();
      b.hidden = a.fold; card.classList.toggle("folded", a.fold);
      foldBtn.textContent = a.fold ? "펼치기 ▾" : "접기 ▴"; foldBtn.setAttribute("aria-expanded", String(!a.fold));
    };

    /* 전형 트랙 */
    const track = document.createElement("div"); track.className = "track";
    const s0 = document.createElement("div");
    s0.className = "step" + (a.doc==="합격" ? " done" : a.doc==="불합격" ? " fail" : " next");
    const s0n = document.createElement("div"); s0n.className = "sn"; s0n.textContent = "서류 마감";
    const s0d = document.createElement("div"); s0d.className = "sd";
    const dl = deadline(j);
    if(dl && !a.myEnd){
      s0d.textContent = fmtAt(dl, deadlineTime(j)) + " (" + dday(dl) + ")";
      if(estDeadline(j, a)) s0d.append(estTag("end"));
      /* 날짜만 있고 시각을 모르면 "그날 자정까지"로 착각하기 쉬워 반드시 확인시킨다 */
      if(!deadlineTime(j) && dleft(dl) >= 0 && a.doc === "대기"){
        const w = document.createElement("div"); w.className = "warn-row";
        const lab = document.createElement("span"); lab.className = "warn";
        lab.textContent = "마감 시각을 아직 몰라요. 원문에서 확인해 넣어 주세요";
        const ti = document.createElement("input");
        ti.type = "time"; ti.value = "";
        ti.setAttribute("aria-label", j.company + " 마감 시각 직접 입력");
        ti.onchange = () => { a.myEndTime = ti.value; save(); renderAll(); };
        w.append(lab, ti);
        s0d.appendChild(w);
      }
    } else {
      /* 상시 공고이거나 내가 마감일을 바꾼 경우 — 직접 입력 */
      if(!j.end && !a.myEnd){
        const w = document.createElement("div"); w.className = "warn";
        w.textContent = "마감일이 없어요. 상시 채용인지 원문에서 확인해 주세요";
        s0d.appendChild(w);
      }
      const di = document.createElement("input");
      di.type = "date"; di.value = a.myEnd || "";
      di.setAttribute("aria-label", j.company + " 서류 마감일");
      di.onchange = () => { a.myEnd = di.value; save(); renderAll(); };
      s0d.appendChild(di);
      if(dl){
        const dd = document.createElement("div");
        dd.style.cssText = "font-size:10.5px;color:var(--muted)";
        dd.textContent = dday(dl);
        s0d.appendChild(dd);
      }
    }
    const s0r = document.createElement("select");
    s0r.setAttribute("aria-label", j.company + " 서류 결과");
    ["대기","합격","불합격"].forEach(function(o){
      const op = document.createElement("option"); op.value = o;
      op.textContent = {"대기": "서류 결과 대기", "합격": "서류 합격", "불합격": "서류 탈락"}[o]; op.selected = (a.doc===o); s0r.appendChild(op);
    });
    s0r.className = "res-sel" + (a.doc==="합격" ? " res-pass" : a.doc==="불합격" ? " res-fail" : "");
    s0r.onchange = () => { setDoc(a, s0r.value); save(); renderAll(); };
    if(VARIANT === "b2" && statusOf(a, j) === "제출전"){
      /* 실험 2 B: 아직 안 낸 공고는 결과 선택 대신 「아직 내지 않았어요」 + [제출했어요] */
      const nt = document.createElement("div"); nt.className = "sub not-sent"; nt.textContent = "아직 내지 않았어요";
      s0.append(s0n, s0d, nt, sentBtn(a, j));
    } else s0.append(s0n, s0d, s0r);

    /* 무엇을 냈는지 체크 — 포트폴리오는 요구하는 곳만 있어서 필요할 때 추가한다. */
    const sub = document.createElement("div"); sub.className = "subm";
    const checks = [["cover","자소서"], ["resume","이력서"]];
    if(a.submit.hasFolio) checks.push(["folio","포트폴리오"]);
    checks.forEach(function(c){
      const lab = document.createElement("label");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!a.submit[c[0]];
      cb.onchange = () => { a.submit[c[0]] = cb.checked; save(); renderMine(); };
      lab.append(cb, document.createTextNode(c[1]));
      sub.appendChild(lab);
    });
    const fb = document.createElement("button"); fb.type = "button";
    fb.textContent = a.submit.hasFolio ? "포트폴리오 빼기" : "+ 포트폴리오";
    fb.onclick = () => {
      a.submit.hasFolio = !a.submit.hasFolio;
      if(!a.submit.hasFolio) a.submit.folio = false;
      save(); renderMine();
    };
    sub.appendChild(fb);
    s0.appendChild(sub);
    track.appendChild(s0);

    a.stages.forEach(function(st, i){
      const el = document.createElement("div");
      el.className = "step" + (st.result==="합격" ? " done" : st.result==="불합격" ? " fail" :
                               st.result==="완료" ? " next" : "");
      const n = document.createElement("div"); n.className = "sn"; n.textContent = st.name;
      /* 통상 간격으로 채운 날짜는 '예상' 꼬리표 — 설명은 꼬리표의 도움말로(UX 04 M-15) */
      if(st.est && st.date) n.append(estTag("stage"));
      const d = document.createElement("input"); d.type = "date"; d.value = st.date || "";
      d.setAttribute("aria-label", j.company + " " + st.name + " 일정");
      d.onchange = () => { st.date = d.value; st.est = false; save(); renderAll(); if(st.date) offerIcs(j.company + " " + st.name); };
      const tm = document.createElement("input"); tm.type = "time"; tm.value = st.time || "";
      tm.setAttribute("aria-label", j.company + " " + st.name + " 시각");
      tm.onchange = () => { st.time = tm.value; save(); renderAll(); };
      /* 이 전형을 봤는지, 붙었는지 여기서 바로 바꾼다 */
      const res = document.createElement("select");
      res.className = "st-res" + (st.result==="합격" ? " res-pass" : st.result==="불합격" ? " res-fail" : "");
      res.setAttribute("aria-label", j.company + " " + st.name + " 상태");
      ["예정","완료","합격","불합격"].forEach(function(o){
        const op = document.createElement("option"); op.value = o; op.textContent = {"예정": "준비", "완료": "결과 대기", "합격": "합격", "불합격": "탈락"}[o];
        op.selected = (st.result === o); res.appendChild(op);
      });
      res.onchange = () => { st.result = res.value; save(); renderAll(); };

      const x = document.createElement("button"); x.className = "x"; x.textContent = "이 전형 빼기";
      x.setAttribute("aria-label", j.company + " " + st.name + " 전형 빼기");
      x.onclick = () => {
        const gone = a.stages.splice(i,1)[0]; save(); renderAll();
        toast(st.name + " 전형을 뺐어요", {label: "되돌리기", run: () => { a.stages.splice(Math.min(i, a.stages.length), 0, gone); save(); renderAll(); toast("되돌렸어요"); }});
      };
      el.append(n, d, tm, res, x);
      if(st.date){ const fb = fxBadge(st.date, true, fxKindOf(st.name)); if(fb){ fb.classList.add("fx-stage"); el.insertBefore(fb, res); } }
      track.appendChild(el);
    });
    b.appendChild(track);

    /* 다음 전형 붙이기 — 서류 합격 이후에만 */
    if(a.doc === "합격"){
      const add = document.createElement("div"); add.className = "stage-add";
      const lbl = document.createElement("span");
      lbl.className = "sub"; lbl.style.marginRight = "2px"; lbl.textContent = "다음 전형 붙이기";
      add.appendChild(lbl);
      STAGES.filter(s => !a.stages.some(x => x.name===s)).forEach(function(s){
        const btn = document.createElement("button"); btn.textContent = "+ " + s;
        btn.onclick = () => {
          const preset = STAGE_OFFSET_PRESETS.find(p => p.name === s);
          const base = deadline(j);
          let date = "", est = false;
          if(preset && base){
            const dt = parse(base); dt.setDate(dt.getDate() + preset.days);
            date = iso(dt); est = true;
          }
          a.stages.push({name:s, date, est});
          save(); renderAll();
        };
        add.appendChild(btn);
      });
      /* 직접 입력은 화면 안 입력칸으로 — 연달아 넣을 수 있게 열린 채로(B20 · UX 04 B-4 표 5번) */
      const otherBtn = document.createElement("button"); otherBtn.type = "button"; otherBtn.textContent = "+ 직접 입력";
      add.appendChild(inlineSlot("stage", j.id, otherBtn, {label: j.company + " 전형 이름", placeholder: "전형 이름 (예: 포트폴리오 발표)", keep: true,
        onSubmit: v => { a.stages.push({name: v, date: "", result: "예정"}); save(); renderAll(); }}));
      b.appendChild(add);
    } else if(a.doc === "불합격"){
      const p = document.createElement("p"); p.className = "sub";
      p.className = "sub app-note";
      p.textContent = "쓴 자소서·이력서는 다음 시즌에 다시 쓸 수 있게 그대로 남아 있어요.";
      b.appendChild(p);
    }

    /* 지원 직무 */
    const rl2 = document.createElement("div"); rl2.className = "rowline";
    const rlab = document.createElement("label"); rlab.textContent = "지원 직무";
    const rsel = document.createElement("select");
    rsel.setAttribute("aria-label", j.company + " 지원 직무");
    const opts = (j.roles || []).slice();
    if(a.role && opts.indexOf(a.role) === -1) opts.push(a.role);
    const none = document.createElement("option");
    none.value = ""; none.textContent = "— 고르기 —"; none.selected = !a.role;
    rsel.appendChild(none);
    opts.forEach(function(o){
      const op = document.createElement("option");
      op.value = o; op.textContent = o; op.selected = (o === a.role); rsel.appendChild(op);
    });
    const other = document.createElement("option");
    other.value = "__etc"; other.textContent = "직접 입력…"; rsel.appendChild(other);
    /* '직접 입력…'은 옆에 입력칸을 연다. 닫으면 원래 직무 그대로(B20 표 6번 · CR-24) */
    rsel.onchange = () => {
      if(rsel.value === "__etc"){ INL = {kind: "role", id: j.id}; renderMine(); focusInline(); return; }
      a.role = rsel.value; save(); renderMine();
    };
    rl2.append(rlab, rsel);
    if(inlOpen("role", j.id)){
      rsel.value = "__etc";
      rl2.append(inlineAdd("role", j.id, null, {label: j.company + " 지원 직무", placeholder: "공고에 적힌 직무 이름", value: a.role || "", ok: "저장",
        onSubmit: v => { a.role = v; save(); renderMine(); }, onClose: () => renderMine()}));
    }
    if(a.role){
      const tg = document.createElement("span"); tg.className = "tg"; tg.textContent = a.role;
      rl2.appendChild(tg);
    }
    b.appendChild(rl2);

    /* 직무 요구사항 아카이빙 */
    const rqf = foldEl(j.id + ":req");
    const rqs = document.createElement("summary");
    rqs.textContent = "이 직무의 자격요건 · 우대사항" +
      ((a.req || a.pref) ? "" : " · 공고에서 복사해 두세요");
    const rqi = document.createElement("div"); rqi.className = "docs two";
    rqi.appendChild(memoBox("자격요건", a, "req", "공고의 자격요건을 그대로 붙여넣어 주세요."));
    rqi.appendChild(memoBox("우대사항", a, "pref", "우대사항을 붙여넣고 내가 충족하는 항목에 표시해 두면 자소서 소재가 돼요."));
    rqf.append(rqs, rqi);
    b.appendChild(rqf);

    /* 자소서 — 문항별 */
    const ef = foldEl(j.id + ":essay");
    const es = document.createElement("summary");
    const done = a.essays.filter(e => (e.a || "").trim()).length;
    es.textContent = a.essays.length
      ? "자소서 · " + a.essays.length + "문항 (작성 " + done + "/" + a.essays.length + ")"
      : "자소서 · 문항을 추가해 주세요";
    const ei = document.createElement("div");
    ei.style.cssText = "display:flex;flex-direction:column;gap:12px";
    a.essays.forEach(function(e, i){ ei.appendChild(essayBox(a, e, i, j)); });
    const eadd = document.createElement("div"); eadd.className = "stage-add";
    const eb = document.createElement("button");
    eb.textContent = "+ 문항 추가";
    eb.onclick = () => { a.essays.push({q:"", limit:0, a:""}); save(); renderMine(); };
    eadd.appendChild(eb);
    if(db.arc.cov.length){
      const mb = document.createElement("button");
      mb.textContent = "마스터 자소서 문항 가져오기";
      mb.onclick = () => {
        db.arc.cov.forEach(q => a.essays.push({q:q.q, limit:0, a:q.a}));
        save(); renderMine(); toast("마스터 문항 " + db.arc.cov.length + "개를 가져왔어요");
      };
      eadd.appendChild(mb);
    }
    ei.appendChild(eadd);
    ef.append(es, ei);
    b.appendChild(ef);

    /* 이력서 · 포트폴리오 */
    const fold = foldEl(j.id + ":docs");
    const sum = document.createElement("summary");
    const lens = [["이력서", (a.resume||"").length], ["포트폴리오", (a.folio||"").length]].filter(x => x[1]);
    sum.textContent = "이력서 · 포트폴리오" +
      (lens.length ? " (" + lens.map(x => x[0] + " " + x[1] + "자").join(", ") + ")" : " · 아직 비어 있어요");
    const inner = document.createElement("div"); inner.className = "docs two";
    inner.appendChild(docBox("이력서", a, "resume", j));
    inner.appendChild(docBox("포트폴리오", a, "folio", j));
    fold.append(sum, inner);
    b.appendChild(fold);

    if(a.at){
      const meta = document.createElement("p");
      meta.className = "sub"; meta.style.fontSize = "11.5px";
      meta.textContent = "담은 날 " + fmt(a.at);
      b.appendChild(meta);
    }

    card.appendChild(b);
    wrap.appendChild(card);
  });
}
/* 자소설닷컴처럼 문항별로 제한 글자수를 걸고 실시간으로 셉니다 */
function essayBox(a, e, i, j){
  const box = document.createElement("div"); box.className = "essay";

  const head = document.createElement("div"); head.className = "e-head";
  const num = document.createElement("span"); num.className = "e-num"; num.textContent = i + 1;
  const q = document.createElement("input");
  q.type = "text"; q.value = e.q || ""; q.className = "e-q";
  q.placeholder = "문항을 그대로 붙여넣어 주세요 (예: 지원 동기와 입사 후 포부를 기술해 주십시오)";
  q.setAttribute("aria-label", (i+1) + "번 문항");
  q.oninput = () => { e.q = q.value; saveSoon(); }; q.onblur = save;

  const lim = document.createElement("input");
  lim.type = "number"; lim.min = "0"; lim.step = "100"; lim.className = "e-lim";
  lim.value = e.limit || ""; lim.placeholder = "제한";
  lim.setAttribute("aria-label", (i+1) + "번 문항 제한 글자수");

  const del = document.createElement("button");
  del.className = "e-del"; del.textContent = "×";
  del.setAttribute("aria-label", (i+1) + "번 문항 삭제");
  /* 답안이 비었으면 바로 지우고 [되돌리기], 글이 있으면 확인 창(B20 · UX 04 B-4 표 7번) */
  del.onclick = async () => {
    const len = (e.a || "").length;
    if(len && !(await confirmDlg({title: (i+1) + "번 문항을 지울까요?", body: "적은 답안 " + len + "자도 함께 지워져요."}, "문항 지우기", "닫기", {danger: true}))) return;
    const gone = a.essays.splice(i, 1)[0]; save(); renderMine();
    if(!len) toast((i+1) + "번 문항을 지웠어요", {label: "되돌리기", run: () => { a.essays.splice(Math.min(i, a.essays.length), 0, gone); save(); renderMine(); toast("되돌렸어요"); }});
  };
  head.append(num, q, lim, document.createTextNode("자"), del);

  const ta = document.createElement("textarea");
  ta.value = e.a || ""; ta.style.minHeight = "150px";
  ta.setAttribute("aria-label", (i+1) + "번 문항 답안");
  ta.placeholder = "답안을 적어 주세요. 붙여넣어도 글자수를 바로 세요.";

  const bar = document.createElement("div"); bar.className = "e-bar";
  const cnt = document.createElement("span"); cnt.className = "e-cnt";
  const gauge = document.createElement("div"); gauge.className = "e-gauge";
  const fill = document.createElement("i");
  gauge.appendChild(fill);

  function refresh(){
    const c = counts(ta.value), L = Number(e.limit) || 0;
    if(L){
      const over = c.all > L;
      cnt.textContent = c.all + " / " + L + "자 · 공백 제외 " + c.noSpace + "자" +
                        (over ? " · " + (c.all - L) + "자 초과" : " · " + (L - c.all) + "자 남음");
      cnt.className = "e-cnt" + (over ? " over" : c.all >= L * 0.9 ? " near" : "");
      gauge.hidden = false;
      fill.style.width = Math.min(100, (c.all / L) * 100) + "%";
      fill.className = over ? "over" : "";
    } else {
      cnt.textContent = c.all + "자 · 공백 제외 " + c.noSpace + "자";
      cnt.className = "e-cnt"; gauge.hidden = true;
    }
  }
  ta.oninput = () => { e.a = ta.value; refresh(); saveSoon(); };
  ta.onblur = save;
  lim.oninput = () => { e.limit = Number(lim.value) || 0; refresh(); };
  lim.onblur = save;   /* refresh()가 글자수 표시를 이미 고쳤으므로 카드를 다시 그리지 않는다(CR-14) */
  refresh();

  bar.append(cnt, gauge);
  box.append(head, ta, bar);
  return box;
}

/* 자격요건·우대사항처럼 그냥 붙여넣어 두는 칸 */
function memoBox(title, a, field, ph){
  const d = document.createElement("div"); d.className = "doc";
  const lab = document.createElement("label");
  const t = document.createElement("span"); t.textContent = title;
  lab.appendChild(t);
  const ta = document.createElement("textarea");
  ta.value = a[field] || ""; ta.placeholder = ph;
  ta.setAttribute("aria-label", title);
  ta.oninput = () => { a[field] = ta.value; saveSoon(); }; ta.onblur = save;
  d.append(lab, ta);
  return d;
}

function docBox(title, a, field, j){
  const d = document.createElement("div"); d.className = "doc";
  const lab = document.createElement("label");
  const t = document.createElement("span"); t.textContent = title;
  const cc = document.createElement("span"); cc.className = "cc";
  cc.textContent = (a[field]||"").length + "자";
  const cp = document.createElement("button");
  cp.className = "ghost"; cp.textContent = "마스터 불러오기";
  cp.style.cssText = "padding:2px 8px;font-size:11px";
  cp.onclick = () => {
    const src = field==="cover" ? db.arc.cov.map(q => q.q + "\n" + q.a).join("\n\n")
              : field==="resume" ? db.arc.res
              : db.arc.pf;
    if(!src){ toast("아카이브에 저장된 마스터 " + title + "가 없어요"); return; }
    /* 묻지 않고 바꾸되, 바꾸기 전 내용은 [되돌리기]로(B20 표 8번) */
    const prev = a[field] || "";
    a[field] = src; save(); renderMine();
    toast("마스터 " + title + "를 불러왔어요", prev ? {label: "되돌리기", run: () => { a[field] = prev; save(); renderMine(); toast("되돌렸어요"); }} : undefined);
  };
  lab.append(t, cc, cp);
  const ta = document.createElement("textarea");
  ta.value = a[field] || "";
  ta.placeholder = j.company + "에 낸 " + title + " 본문을 붙여넣어 두면 면접 준비 때 다시 볼 수 있어요.";
  ta.setAttribute("aria-label", j.company + " " + title + " 본문");
  ta.oninput = () => { a[field] = ta.value; cc.textContent = ta.value.length + "자"; saveSoon(); };
  ta.onblur = save;
  d.append(lab, ta);
  return d;
}

/* ---------- 일정 모음 (캘린더·플래너 공용) ---------- */
let mineOnly = false;
function events(forceMineOnly){
  const only = forceMineOnly !== undefined ? forceMineOnly : mineOnly;
  const out = {};
  const push = (date, obj) => { if(date) (out[date] = out[date] || []).push(obj); };
  scoped().forEach(function(j){
    const a = appOf(j.id);
    if(only && !a.applied) return;
    if(!a.applied) {
      if(dateMode !== "end") push(j.start, {kind:"start", label:"시작", name:j.company, est:!j.confirmed, mine:false, id:j.id});
      if(dateMode !== "start") push(j.end, {kind:"end", label:"마감", name:j.company, est:!j.confirmed, mine:false, id:j.id});
      return;
    }
    /* 지원한 공고 — 내가 정한 마감일을 우선하고, 전형 일정도 함께 올린다. 예상 날짜는 '예상' 꼬리표(B05) */
    if(dateMode !== "end") push(j.start, {kind:"start", label:"시작", name:j.company, est:!j.confirmed, mine:true, id:j.id});
    if(dateMode !== "start") push(deadline(j), {kind:"end", label:"마감", name:j.company, est:estDeadline(j, a), mine:true, id:j.id});
    a.stages.forEach(s => push(s.date,
      {kind:"stage", label:s.name + (s.time ? " " + s.time : ""), name:j.company, est:!!s.est, mine:true, id:j.id}));
  });
  return out;
}
/* 일정 버튼 안 '예상' 꼬리표 — 담은 공고의 예상 날짜에만(안 담은 예상 공고는 점선 테두리로 이미 구분) */
function evEst(b, e){
  if(!(e.est && e.mine)) return;
  const t = estTag(e.kind === "stage" ? "stage" : "end"), pre = b.querySelector(".pre");
  if(pre) pre.after(t); else b.append(t);   /* 회사 이름은 버튼 끝에 그대로 둔다 */
}

/* ---------- 캘린더 ---------- */
let curMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
function renderCal(){
  wireDateModeBtn("calDateModeBtn");
  wireScope("calScopeBtn", "calScopeState");
  document.getElementById("mLbl").textContent = curMonth.getFullYear()+"년 "+(curMonth.getMonth()+1)+"월";
  const grid = document.getElementById("calGrid"); grid.innerHTML = "";
  const first = new Date(curMonth), start = new Date(first);
  start.setDate(1 - first.getDay());
  const ev = events();
  for(let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const c = document.createElement("div");
    c.className = "cell" + (d.getMonth()!==curMonth.getMonth() ? " out" : "") +
                  (iso(d)===iso(TODAY) ? " is-today" : "");
    const n = document.createElement("div"); n.className = "dnum"; n.textContent = d.getDate();
    const fb = fxBadge(iso(d), "bare"); if(fb) n.appendChild(fb);
    c.appendChild(n);
    (ev[iso(d)] || []).forEach(function(e){
      const b = document.createElement("button");
      b.className = "ev ev-" + e.kind + (e.est ? " est" : "") + (e.mine ? " mine" : "");
      if(e.mine) b.title = "내가 지원한 공고";
      const note = MY_NOTES[e.id];
      if(note){
        b.classList.add("asked");
        b.title = (b.title ? b.title + " · " : "") + "직접 부탁한 공고" + (note.fortune ? " · 운세 " + note.fortune : "");
      }
      const pre = document.createElement("span"); pre.className = "pre"; pre.textContent = e.label;
      b.appendChild(pre);
      /* 운세 판정은 칸이 좁아 이모지 하나만 붙인다 */
      if(note) b.appendChild(document.createTextNode((note.fortune ? note.fortune.split(" ")[0] : "📌") + " "));
      b.appendChild(document.createTextNode(e.name));
      evEst(b, e);
      b.onclick = () => openJob(e.id);
      c.appendChild(b);
    });
    grid.appendChild(c);
  }
  renderCalList(ev);
}
/* 좁은 화면에서는 7칸 달력 대신 이번 달 일정을 날짜별 목록으로 보여 준다(오늘 이후부터) */
function renderCalList(ev){
  const box = document.getElementById("calList"); box.replaceChildren();
  const y = curMonth.getFullYear(), m = curMonth.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const DOW = ["일","월","화","수","목","금","토"];
  const fromDay = (y === TODAY.getFullYear() && m === TODAY.getMonth()) ? TODAY.getDate() : 1;
  let any = false;
  for(let day = fromDay; day <= last; day++){
    const d = new Date(y, m, day), list = ev[iso(d)] || [];
    if(!list.length) continue;
    any = true;
    const sec = document.createElement("section"); sec.className = "cl-day" + (iso(d) === iso(TODAY) ? " is-today" : "");
    const h = document.createElement("h3"); h.className = "cl-h";
    h.textContent = (m + 1) + "월 " + day + "일 (" + DOW[d.getDay()] + ")" + (iso(d) === iso(TODAY) ? " · 오늘" : "");
    const fb = fxBadge(iso(d), true); if(fb) h.append(" ", fb);
    sec.append(h);
    list.forEach(function(e){
      const b = document.createElement("button");
      b.className = "ev ev-" + e.kind + (e.est ? " est" : "") + (e.mine ? " mine" : "");
      const pre = document.createElement("span"); pre.className = "pre"; pre.textContent = e.label;
      b.append(pre, document.createTextNode(e.name));
      evEst(b, e);
      b.onclick = () => openJob(e.id);
      sec.append(b);
    });
    box.append(sec);
  }
  if(!any){ const p = document.createElement("p"); p.className = "empty"; p.textContent = "이 달에 남은 일정이 없어요."; box.append(p); }
}

/* ---------- 공고 상세 ---------- */
const jobDlg = document.getElementById("jobDlg");

/* 공고 본문(data/details.json)은 목록보다 훨씬 무거워서 첫 화면 로딩을 늦춘다.
   공고를 실제로 열어볼 때 한 번만 받아 캐시해 둔다. */
let DETAILS = null, detailsPromise = null;
function loadDetails(){
  if(DETAILS) return Promise.resolve(DETAILS);
  if(!detailsPromise){
    /* 7MB짜리 본문 파일은 공고 데이터가 바뀐 날에만 새로 받는다(CR-20) */
    detailsPromise = fetch("data/details.json?v=" + encodeURIComponent(DATA_VER || String(Date.now())))
      .then(r => r.ok ? r.json() : {items:{}})
      .then(d => (DETAILS = d.items || {}))
      .catch(() => (DETAILS = {}));
  }
  return detailsPromise;
}
function showDetail(id){
  const poster = document.getElementById("jdPoster");
  const posterFail = document.getElementById("jdPosterFail");
  const detail = document.getElementById("jdDetail");
  const secs = document.getElementById("jdSections");
  const trk = document.getElementById("jdTracks");
  poster.hidden = true; posterFail.hidden = true; secs.hidden = true; secs.innerHTML = "";
  trk.hidden = true; trk.innerHTML = "";
  detail.hidden = false; detail.textContent = "공고 내용을 불러오는 중…";

  loadDetails().then(function(items){
    if(jdId !== id) return;              /* 그 사이 다른 공고를 열었으면 무시 */
    const d = items[id];
    if(!d){ detail.hidden = true; return; }

    /* 한 공고에 직무가 여러 개면 직무별로 접었다 펴서 자소서 문항까지 본다 */
    if(d.tracks && d.tracks.length){
      trk.hidden = false;
      const h = document.createElement("p"); h.className = "trk-h";
      h.textContent = "모집 직무 " + d.tracks.length + "개 · 직무를 누르면 자소서 문항이 나와요"
        + (d.applicants ? " · 전체 지원자 " + d.applicants.toLocaleString() + "명" : "");
      trk.appendChild(h);
      d.tracks.forEach(function(t, i){
        const box = document.createElement("details");
        if(d.tracks.length === 1 || i === 0) box.open = (d.tracks.length === 1);
        const sum = document.createElement("summary");
        const bits = [];
        if(t.questions.length) bits.push("문항 " + t.questions.length + "개");
        /* 이 직무에 자소서를 쓰고 있는 사람 수 — 직무 간 경쟁 강도를 비교할 수 있다 */
        if(t.applicants) bits.push("지원자 " + t.applicants.toLocaleString() + "명");
        sum.textContent = t.name + (bits.length ? "  (" + bits.join(" · ") + ")" : "");
        const zone = document.createElement("div"); zone.className = "qz";
        if(t.questions.length){
          t.questions.forEach(function(q, n){
            const p = document.createElement("p"); p.className = "q";
            const lab = document.createElement("b");
            lab.textContent = "문항 " + (n+1) + (q.limit ? " · " + q.limit + "자" + (q.space ? " (공백 포함)" : " (공백 제외)") : "");
            p.appendChild(lab);
            p.appendChild(document.createTextNode(q.q));
            zone.appendChild(p);
          });
        } else {
          const p = document.createElement("p"); p.className = "none";
          p.textContent = "이 직무는 등록된 자소서 문항이 없어요.";
          zone.appendChild(p);
        }
        box.append(sum, zone);
        trk.appendChild(box);
      });
    }

    /* 항목별로 나뉜 공고는 접었다 펼 수 있게 보여준다. 첫 항목만 펼친 채로 시작. */
    if(d.sections && d.sections.length){
      detail.hidden = true;
      secs.hidden = false;
      d.sections.forEach(function(sec, i){
        const box = document.createElement("details");
        if(i === 0) box.open = true;
        const sum = document.createElement("summary");
        sum.textContent = sec.title;
        const body = document.createElement("p");
        body.className = "sec-body";
        body.textContent = sec.body;
        box.append(sum, body);
        secs.appendChild(box);
      });
    } else {
      detail.textContent = d.detail || "";
      detail.hidden = !d.detail;
    }
    /* 본문이 포스터 이미지인 공고. 회사가 외부 도메인 표시를 막아둔 경우(핫링크 차단)
       깨진 이미지 대신 안내 문구를 띄운다. */
    if(d.image){
      poster.hidden = false;
      poster.onerror = () => { poster.hidden = true; posterFail.hidden = false; };
      poster.src = d.image;
    } else {
      poster.removeAttribute("src");
    }
  });
}
let jdId = null;
function openJob(id){
  const j = allJobs().find(x => x.id === id);
  if(!j) return;
  jdId = id;
  const a = appOf(id);

  const h = document.getElementById("jdCompany");
  h.textContent = j.company;
  h.appendChild(pill(j));
  const hB = myBadge(id); if(hB) h.appendChild(hB);

  /* 공고 제목도 함께(QA-11) — 직무 분류가 없는 공고는 제목이 유일한 단서다 */
  document.getElementById("jdRoles").textContent = [j.title, (j.roles || []).join(" · ")].filter(Boolean).join(" · ") || "직무 정보 없음";

  const facts = document.getElementById("jdFacts");
  facts.innerHTML = "";
  const add = (k, v) => {
    if(!v) return;
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    facts.append(dt, dd);
  };
  add("접수 시작", j.start ? fmt(j.start) : (j.end ? "—" : "상시 · 수시"));
  add("접수 마감", j.end ? fmtAt(j.end, j.endTime) + " (" + dday(j.end) + ")" : "");
  add("기업 형태", j.type);
  add("출처", j.source);
  if(j.found) add("처음 발견", fmt(j.found) + " (" + (-dleft(j.found) <= 0 ? "오늘" : -dleft(j.found) + "일 전") + ")" + (!j.end ? " · 수시·상시라 먼저 낼수록 유리" : ""));
  if(!a.applied || a.doc === "대기"){ const sb = bestSubmit(j); if(sb) add("제출 추천일", sb.kind === "day" ? sb.text + " (D-2까지 중 일운 최고)" : sb.text); }
  { const u = unScore(unJob(j)); if(u) add("운적 궁합", u.mark + " " + u.total + " " + u.label + " — " + u.parts.map(([k, n]) => k + " " + n.toFixed(1)).join(" · ")); }
  if(MY_NOTES[id] && MY_NOTES[id].fortune)
    add("운세 판정", MY_NOTES[id].fortune + (MY_NOTES[id].fortune_note ? " — " + MY_NOTES[id].fortune_note : ""));
  if(a.applied){
    add("서류 결과", a.doc);
    a.stages.forEach(s => add(s.name, s.date ? fmt(s.date) : "날짜 미정"));
  }

  const hist = document.getElementById("jdHist");
  /* 수집할 때 적어 둔 메모(지난 접수 기간 등) — 내 메모와 구분해 캡션 아래 흐린 글자로 */
  hist.replaceChildren();
  if(j.hist){
    const cap = document.createElement("span"); cap.className = "jd-cap"; cap.textContent = "수집 메모";
    const tx = document.createElement("span"); tx.className = "jd-collect"; tx.textContent = j.hist.replace(/\s*[—–]\s*/g, " · ");
    hist.append(cap, tx);
  }
  hist.hidden = !j.hist;

  const note = document.getElementById("jdNote");
  note.textContent = a.note || "";
  note.hidden = !a.note;

  showDetail(id);
  renderPick(id);

  const link = document.getElementById("jdLink"), url = safeUrl(j.url);
  if(url){ link.href = url; link.hidden = false; } else { link.removeAttribute("href"); link.hidden = true; }

  /* 상세 창의 주 버튼은 하나라 대상을 붙인다(B25): 내 지원에 담기 / 내 지원에서 빼기 */
  const ap = document.getElementById("jdApply");
  ap.textContent = a.applied ? "내 지원에서 빼기" : "내 지원에 담기";
  ap.className = a.applied ? "ghost" : "primary";
  /* 실험 2 B: 담았지만 아직 안 냈으면 [제출했어요] */
  const sb = document.getElementById("jdSent");
  sb.hidden = !(VARIANT === "b2" && a.applied && a.sent === false);
  sb.onclick = () => { const w = app(id); markSent(w); save(); renderAll(); openJob(id); toast(j.company + " · 제출했다고 적었어요", {label: "되돌리기", run: () => { w.sent = false; delete w.sentAt; save(); renderAll(); if(jobDlg.open) openJob(id); }}); };

  if(!jobDlg.open) jobDlg.showModal();
}
document.getElementById("jdApply").onclick = function(){
  if(!jdId) return;
  const j = allJobs().find(x => x.id === jdId); if(!j) return;
  if(appOf(jdId).applied) unapplyJob(j); else applyJob(j);
  openJob(jdId);
};
document.getElementById("jdEdit").onclick = function(){
  const id = jdId; jobDlg.close(); openForm(id);
};
document.getElementById("jdClose").onclick = () => jobDlg.close();

/* ---------- 주간 플래너 ---------- */
let weekStart = mondayOf(TODAY);
function mondayOf(d){ const m = new Date(d); m.setDate(d.getDate() - ((d.getDay()+6)%7)); m.setHours(0,0,0,0); return m; }
function renderWeek(){
  const end = new Date(weekStart); end.setDate(weekStart.getDate()+6);
  document.getElementById("wLbl").textContent =
    (weekStart.getMonth()+1)+"/"+weekStart.getDate()+" – "+(end.getMonth()+1)+"/"+end.getDate();
  const names = ["월","화","수","목","금","토","일"];
  const wrap = document.getElementById("week"); wrap.innerHTML = "";
  const ev = events(true); /* 주간 플래너는 내가 지원한 공고 일정만 — 캘린더의 "전체 보기" 토글과 무관 */
  for(let i=0;i<7;i++){
    const d = new Date(weekStart); d.setDate(weekStart.getDate()+i);
    const k = iso(d);
    const day = document.createElement("div");
    day.className = "day" + (k===iso(TODAY) ? " is-today" : "") +
      (!(ev[k] || []).length && !(db.todos[k] || []).length && !(k === iso(TODAY) && fxDay(k)) ? " is-empty" : "");
    const h = document.createElement("h3");
    h.appendChild(document.createTextNode(names[i]));
    const bb = document.createElement("b"); bb.textContent = d.getDate(); h.appendChild(bb);
    day.appendChild(h);
    if(fxDay(k)){
      const row = document.createElement("div"); row.className = "fx-row";
      FX_KINDS.forEach(([c]) => { const bb = fxBadge(k, false, c); if(bb) row.appendChild(bb); });
      day.appendChild(row);
    }
    if(k === iso(TODAY) && fxDay(k)){
      const t = document.createElement("p"); t.className = "fx-today"; t.textContent = fxHelp(fxDay(k).score); day.appendChild(t);
    }

    (ev[k] || []).forEach(function(e){
      const p = document.createElement("button");
      p.type = "button";
      p.className = "pev " + (e.kind==="start" ? "s" : e.kind==="end" ? "e" : "g") + (e.est && e.mine ? " est" : "");
      p.textContent = e.label + " · " + e.name;
      evEst(p, e);
      p.onclick = () => openJob(e.id);
      day.appendChild(p);
    });

    const list = document.createElement("div"); list.className = "todos";
    (db.todos[k] || []).forEach(function(t, idx){
      const row = document.createElement("div"); row.className = "todo" + (t.done ? " done" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!t.done;
      cb.setAttribute("aria-label", t.text);
      cb.onchange = () => { db.todos[k][idx].done = cb.checked; save(); renderWeek(); };
      const sp = document.createElement("span"); sp.textContent = t.text;
      const x = document.createElement("button"); x.textContent = "×";
      x.setAttribute("aria-label","할 일 삭제");
      x.onclick = () => { db.todos[k].splice(idx,1); save(); renderWeek(); };
      row.append(cb, sp, x); list.appendChild(row);
    });
    /* 할 일은 화면 안 입력칸으로 — 연달아 적을 수 있게 열린 채로(B20 표 9번) */
    const add = document.createElement("button"); add.type = "button"; add.className = "addtodo"; add.textContent = "+ 할 일";
    list.appendChild(inlineSlot("todo", k, add, {label: names[i] + "요일 할 일", placeholder: "할 일 적기", keep: true,
      onSubmit: v => { (db.todos[k] = db.todos[k] || []).push({text: v, done: false}); save(); renderWeek(); }}));
    day.appendChild(list);
    wrap.appendChild(day);
  }
}

/* ---------- 아카이브 ---------- */
let arcTab = "exp";
function renderArc(){
  document.querySelectorAll("#arcTabs button").forEach(b =>
    b.setAttribute("aria-pressed", b.dataset.a === arcTab));
  const box = document.getElementById("arcBody");
  box.innerHTML = "";

  if(arcTab === "exp"){
    const add = document.createElement("button");
    add.className = "primary"; add.textContent = "+ 경험 추가";
    add.style.marginBottom = "14px";
    add.onclick = () => { db.arc.exp.unshift({id:"e"+Date.now(), title:"", tags:"", s:"", t:"", a:"", r:""}); save(); renderArc(); };
    box.appendChild(add);

    if(!db.arc.exp.length){
      box.insertAdjacentHTML("beforeend",
        '<div class="empty">경험을 상황·과제·행동·결과로 나눠 적으면 자소서를 쓸 때 꺼내 쓸 수 있어요.<br>결과에는 숫자를 넣어 주세요.</div>');
      return;
    }
    const g = document.createElement("div"); g.className = "arcgrid";
    db.arc.exp.forEach(function(e, i){
      const c = document.createElement("div"); c.className = "acard";
      c.appendChild(inp(e, "title", "경험 이름 (예: 커뮤니티 위기 대응)", "at"));
      c.appendChild(inp(e, "tags", "태그 — 쉼표로 구분 (예: PM, 위기관리)"));
      const dl = document.createElement("dl"); dl.className = "star";
      [["상황","s"],["과제","t"],["행동","a"],["결과","r"]].forEach(function(p){
        const dt = document.createElement("dt"); dt.textContent = p[0];
        const dd = document.createElement("dd");
        const ta = document.createElement("textarea");
        ta.value = e[p[1]] || ""; ta.style.minHeight = "48px";
        ta.setAttribute("aria-label", p[0]);
        ta.oninput = () => { e[p[1]] = ta.value; saveSoon(); };
        ta.onblur = save;
        dd.appendChild(ta); dl.append(dt, dd);
      });
      c.appendChild(dl);
      const row = document.createElement("div"); row.className = "row";
      const del = document.createElement("button"); del.textContent = "삭제";
      /* 내용이 있으면 확인 창, 빈 카드는 바로 지우고 [되돌리기](B20 표 10번) */
      del.onclick = async () => {
        const filled = ["title", "tags", "s", "t", "a", "r"].some(k => (e[k] || "").trim());
        if(filled && !(await confirmDlg({title: "‘" + (e.title || "제목 없는") + "’ 경험 카드를 지울까요?", body: "상황·과제·행동·결과에 적은 내용도 함께 지워져요."}, "카드 지우기", "닫기", {danger: true}))) return;
        const gone = db.arc.exp.splice(i, 1)[0]; save(); renderArc();
        if(!filled) toast("빈 경험 카드를 지웠어요", {label: "되돌리기", run: () => { db.arc.exp.splice(Math.min(i, db.arc.exp.length), 0, gone); save(); renderArc(); }});
      };
      row.appendChild(del); c.appendChild(row);
      g.appendChild(c);
    });
    box.appendChild(g);
  }

  if(arcTab === "cov"){
    const add = document.createElement("button");
    add.className = "primary"; add.textContent = "+ 문항 추가"; add.style.marginBottom = "14px";
    add.onclick = () => { db.arc.cov.push({id:"q"+Date.now(), q:"", a:""}); save(); renderArc(); };
    box.appendChild(add);
    if(!db.arc.cov.length){
      box.insertAdjacentHTML("beforeend",
        '<div class="empty">지원동기·협업 경험·직무 역량처럼 자주 나오는 문항의 기본 답안을 만들면<br>공고마다 앞뒤만 고쳐 쓸 수 있어요.</div>');
      return;
    }
    const g = document.createElement("div");
    g.style.cssText = "display:flex;flex-direction:column;gap:12px";
    db.arc.cov.forEach(function(q, i){
      const c = document.createElement("div"); c.className = "qa";
      const qh = document.createElement("div"); qh.className = "qh";
      const qi = document.createElement("input"); qi.type = "text"; qi.value = q.q;
      qi.placeholder = "문항 (예: 지원 동기와 입사 후 포부)";
      qi.setAttribute("aria-label","문항");
      qi.oninput = () => { q.q = qi.value; saveSoon(); }; qi.onblur = save;
      const cc = document.createElement("span");
      cc.className = "sub"; cc.textContent = (q.a||"").length + "자";
      const del = document.createElement("button");
      del.className = "ghost"; del.textContent = "삭제";
      del.onclick = async () => {
        const len = (q.a || "").length;
        if(len && !(await confirmDlg({title: "‘" + (q.q || "제목 없는") + "’ 문항을 지울까요?", body: "적은 답안 " + len + "자도 함께 지워져요."}, "문항 지우기", "닫기", {danger: true}))) return;
        const gone = db.arc.cov.splice(i, 1)[0]; save(); renderArc();
        if(!len) toast("빈 문항을 지웠어요", {label: "되돌리기", run: () => { db.arc.cov.splice(Math.min(i, db.arc.cov.length), 0, gone); save(); renderArc(); }});
      };
      qh.append(qi, cc, del);
      const ta = document.createElement("textarea");
      ta.value = q.a; ta.style.minHeight = "130px";
      ta.setAttribute("aria-label","답안");
      ta.oninput = () => { q.a = ta.value; cc.textContent = ta.value.length + "자"; saveSoon(); };
      ta.onblur = save;
      c.append(qh, ta); g.appendChild(c);
    });
    box.appendChild(g);
  }

  if(arcTab === "res" || arcTab === "pf"){
    const isRes = arcTab === "res";
    const field = isRes ? "res" : "pf";
    if(db.arc[field] === undefined) db.arc[field] = "";
    const desc = isRes
      ? "경력·학력·자격증·수상을 한 벌로 써 두고, 지원할 때 필요한 줄만 골라 써요."
      : "포트폴리오 링크와 프로젝트 설명을 한 벌로 써 둬요. 파일은 올릴 수 없으니 노션·피그마 링크를 적어 주세요.";
    const c = document.createElement("div"); c.className = "qa";
    const lab = document.createElement("div"); lab.className = "sub";
    const setLab = n => { lab.textContent = desc + " (" + n + "자)"; };
    setLab((db.arc[field] || "").length);
    const ta = document.createElement("textarea");
    ta.value = db.arc[field]; ta.style.minHeight = "420px";
    ta.setAttribute("aria-label", isRes ? "마스터 이력서" : "마스터 포트폴리오");
    ta.placeholder = isRes
      ? "예)\n[경력]\n2026.02–현재 · 대학내일 비즈니스임팩트3팀 · 인플루언서 캐스팅 BDC, PPL 마케팅\n\n[프로젝트]\n\n[자격증]\n\n[수상]"
      : "예)\n[포트폴리오 링크] https://...\n\n[프로젝트 1] 이름 / 기간 / 역할\n- 문제:\n- 한 일:\n- 결과(숫자):\n\n[프로젝트 2]";
    ta.oninput = () => { db.arc[field] = ta.value; setLab(ta.value.length); saveSoon(); };
    ta.onblur = save;
    c.append(lab, ta); box.appendChild(c);
  }
}
function inp(obj, field, ph, cls){
  const i = document.createElement("input");
  i.type = "text"; i.value = obj[field] || ""; i.placeholder = ph;
  i.setAttribute("aria-label", ph);
  if(cls) i.className = cls;
  i.style.cssText = "width:100%;border:0;border-bottom:1px solid var(--line-2);border-radius:0;" +
                    "background:none;padding:3px 0" + (cls==="at" ? ";font-size:14.5px;font-weight:700" : "");
  i.oninput = () => { obj[field] = i.value; saveSoon(); }; i.onblur = save;
  return i;
}

/* ---------- D-day 레일 ---------- */
function renderRail(){
  const mine = [], rest = [];
  myJobs().forEach(function(j){
    const a = appOf(j.id), dl = deadline(j);
    /* 실험 2 B: 제출했다고 적은 공고(sent === true)의 서류 마감만 뺀다. sent가 없는 기존 기록은 그대로 보인다 */
    if(dl && dleft(dl) >= 0 && a.doc === "대기" && !(VARIANT === "b2" && a.sent === true))
    {
      const dt = deadlineTime(j), est = estDeadline(j, a);
      mine.push({d:dleft(dl), name:j.company, id:j.id, est,
                 what: est ? (dleft(dl) === 0 ? "예상 마감 · 공고 확인" : "서류 마감") : "서류 마감" + (dt ? " " + dt : " (시각 확인 필요)"), mine:true});
    }
    a.stages.forEach(function(s){
      if(s.date && dleft(s.date) >= 0)
        mine.push({d:dleft(s.date), name:j.company, id:j.id, what:s.name + (s.time ? " " + s.time : ""), est: !!s.est, mine:true});
    });
  });
  /* 안 담은 공고는 실제 공고만 — 안 담은 예상 마감은 레일에서 뺀다(B05) */
  scoped().forEach(function(j){
    if(!appOf(j.id).applied && j.confirmed && j.end && dleft(j.end) >= 0 && state(j).k !== "shut")
      rest.push({d:dleft(j.end), name:j.company, id:j.id,
                 what:"마감" + (j.endTime ? " " + j.endTime : ""), mine:false});
  });
  mine.sort((a,b) => a.d - b.d);
  rest.sort((a,b) => a.d - b.d);
  /* 같은 회사가 같은 날 마감하는 공고 여러 개(NHN 직무별 공고 등)는 한 칸으로 묶는다 */
  for(let i = rest.length - 1; i > 0; i--){
    const k = rest.findIndex(x => x.d === rest[i].d && coKey(x.name) === coKey(rest[i].name));
    if(k < i){ rest[k].n = (rest[k].n || 1) + 1; rest.splice(i, 1); }
  }
  rest.forEach(x => { if(x.n) x.what += " · 공고 " + x.n + "개"; });

  const rail = document.getElementById("rail");
  rail.innerHTML = "";

  /* 지원한 것부터 앞에 세웁니다 */
  const items = mine.concat(rest.slice(0, Math.max(3, 10 - mine.length)));
  if(!items.length){
    rail.innerHTML = '<p class="sub" style="margin:0">다가오는 일정이 없어요. 공고를 담으면 마감 D-day가 여기 떠요.</p>';
    return;
  }
  if(mine.length){
    const lead = document.createElement("div");
    lead.className = "rail-lead";
    /* 세는 기준을 이름에(담은 공고 수가 아니라 다가오는 마감·전형 수) */
    lead.innerHTML = '<b>다가오는 내 일정</b><span>' + mine.length + '건</span>';
    rail.appendChild(lead);
  }
  /* 휴대폰은 칩 6개까지(B15) — 나머지는 내 지원·캘린더에서 본다 */
  items.slice(0, window.matchMedia("(max-width:640px)").matches ? 6 : 12).forEach(function(it, i){
    if(it.mine === false && i > 0 && items[i-1].mine === true){
      const sep = document.createElement("div");
      sep.className = "rail-lead dim";
      sep.innerHTML = '<b>곧 마감하는 공고</b>';
      rail.appendChild(sep);
    }
    const el = document.createElement("button");
    el.type = "button";
    el.className = "dchip" + (it.d <= 3 ? " u" : it.d <= 10 ? " s" : "") + (it.mine ? " mine" : " dim") + (it.est ? " est" : "");
    el.onclick = () => openJob(it.id);
    el.title = it.name + " 공고 보기";
    const d = document.createElement("div"); d.className = "d";
    /* 레일은 지난 일정을 애초에 안 담는다. 예상 날짜는 「D-3 예상」, 예상 마감이 오늘이면 큰 글자 「오늘」 */
    d.textContent = it.d === 0 ? (it.est || !/마감/.test(it.what) ? "오늘" : "오늘 마감") : "D-" + it.d;
    if(it.est && it.d !== 0) d.append(estTag(/마감/.test(it.what) ? "end" : "stage"));
    const c = document.createElement("div"); c.className = "c"; c.textContent = it.name;
    const k = document.createElement("div"); k.className = "k"; k.textContent = it.what;
    el.append(d, c, k); rail.appendChild(el);
  });
}

/* ---------- 공고 폼 ---------- */
const dlg = document.getElementById("dlg"), form = document.getElementById("form");
let editId = null, formRoleSel = [];
function openForm(id){
  editId = id || null;
  const j = id ? allJobs().find(x => x.id === id) : null;
  const isCustom = j && db.custom.some(c => c.id === j.id);
  document.getElementById("dlgTitle").textContent = j ? j.company : "공고 추가";
  form.company.value = j ? j.company : "";
  formRoleSel = j ? (j.roles || []).slice() : [];
  chips("formRoles", ROLES, formRoleSel);
  form.start.value = j ? (j.start||"") : "";
  form.end.value = j ? (j.end||"") : "";
  form.confirmed.checked = j ? !!j.confirmed : true;
  /* 선택지에 없는 값(예: '예상(작년 자소설닷컴 기록)', 형태 정보 없음)도 그대로 보여 줘서, 저장만 눌러도 값이 바뀌지 않게 한다 */
  const pickOpt = (sel, v) => {
    sel.querySelectorAll("option[data-tmp]").forEach(o => o.remove());
    if(![...sel.options].some(o => o.value === v)){ const o = document.createElement("option"); o.value = v; o.textContent = v || "정보 없음"; o.dataset.tmp = "1"; sel.append(o); }
    sel.value = v;
  };
  pickOpt(form.source, j ? (j.source || "") : "링커리어");
  pickOpt(form.type, j ? (j.type || "") : "대기업");
  form.hist.value = j ? (j.hist || "") : "";
  syncHistField();
  form.url.value = j ? (j.url || "") : "";
  form.note.value = j ? (appOf(j.id).note || "") : "";
  document.getElementById("delBtn").hidden = !isCustom;
  dlg.showModal();
}
form.addEventListener("submit", function(){
  const v = {
    company: form.company.value.trim(),
    roles: formRoleSel.slice(),
    start: form.start.value, end: form.end.value,
    confirmed: form.confirmed.checked,
    source: form.source.value, type: form.type.value,
    hist: form.hist.value.trim(), url: form.url.value.trim()
  };
  if(editId){
    const own = db.custom.find(c => c.id === editId);
    if(own) Object.assign(own, v);
    else {
      /* 공용 공고는 원본을 안 건드리고, 내가 바꾼 칸만 ovr로 덮는다(CR-09) — 메모만 고치면 ovr을 만들지 않아
         이후 공고 갱신(마감 연장·링크 정정)이 그대로 보인다 */
      const orig = allJobs().find(s => s.id === editId), diff = {};
      if(orig) Object.keys(v).forEach(k => {
        const cur = orig[k] !== undefined && orig[k] !== null ? orig[k] : Array.isArray(v[k]) ? [] : typeof v[k] === "boolean" ? false : "";
        if(JSON.stringify(v[k]) !== JSON.stringify(cur)) diff[k] = v[k];
      });
      if(Object.keys(diff).length){
        const a = app(editId); a.ovr = Object.assign(a.ovr || {}, diff);
        [SEED, SHARED, ARCHIVE].forEach(list => { const x = list.find(s => s.id === editId); if(x) ovrJob(x, diff); });
        if(a.snap) Object.assign(a.snap, snapJob(Object.assign({}, a.snap, diff)));
      }
    }
    const note = form.note.value.trim();
    if(note || appOf(editId).note) app(editId).note = note;
  } else {
    const id = "u" + Date.now();
    db.custom.push(Object.assign({id:id}, v));
    const note = form.note.value.trim();
    if(note) app(id).note = note;
  }
  jobsChanged();
  save(); editId = null; renderAll(); toast("저장했어요");
});
document.getElementById("cancelBtn").onclick = () => { editId = null; dlg.close(); };
/* 직접 추가한 공고 지우기 — 되돌릴 수 없어 확인 창(B20 표 12번) */
document.getElementById("delBtn").onclick = async function(){
  if(!editId) return;
  const c0 = db.custom.find(c => c.id === editId);
  dlg.close();
  const ok = await confirmDlg({title: "직접 추가한 ‘" + (c0 ? c0.company : "") + "’ 공고를 지울까요?", body: "이 공고에 적은 자소서·전형 기록도 함께 지워지고 되돌릴 수 없어요."}, "공고 지우기", "닫기", {danger: true});
  if(!ok){ dlg.showModal(); return; }
  const i = db.custom.findIndex(c => c.id === editId);
  if(i > -1) db.custom.splice(i,1);
  delete db.apps[editId];
  save(); editId = null; dlg.close(); renderAll(); toast("공고를 지웠어요");
};
/* 역대 오픈은 아직 공고가 안 뜬 자리를 과거 패턴으로 추정할 때만 쓰는 칸이라,
   '확정 일정'을 해제했을 때만 보여준다. */
function syncHistField(){
  document.getElementById("histField").hidden = form.confirmed.checked;
}
form.confirmed.addEventListener("change", syncHistField);
document.getElementById("addBtn").onclick = () => openForm(null);

/* ---------- 공고 제보(모두에게 보이는 공용 목록) ---------- */
const shareDlg = document.getElementById("shareDlg");
let shareRoleSel = [];

/* 제보 목록을 서버에서 받아 공고 목록에 섞는다. 실패해도 앱은 그대로 돌아간다. */
async function loadShared(){
  const { data, error } = await sb
    .from("jobboard_shared_jobs")
    .select("id, company, roles, url, end_date, note, created_at")
    .order("created_at", { ascending: false });
  if(error){ console.warn("제보 공고를 불러오지 못했어요:", error.message); SHARED = []; SHARED_OK = false; return; }
  SHARED_OK = true;
  SHARED = (data || []).map(r => ({
    id: "shared-" + r.id,
    company: r.company,
    type: "",
    roles: r.roles || [],
    start: "",
    end: r.end_date || "",
    confirmed: true,
    source: "제보",
    url: r.url,
    hist: r.note || "",
  }));
}

document.getElementById("shareBtn").onclick = function(){
  shareRoleSel = [];
  chips("shareRoles", ROLES, shareRoleSel);
  const f = document.getElementById("shareForm");
  f.reset();
  document.getElementById("shareMsg").hidden = true;
  shareDlg.showModal();
};
document.getElementById("shareCancel").onclick = () => shareDlg.close();

document.getElementById("shareForm").onsubmit = async function(e){
  e.preventDefault();
  const f = e.target, msg = document.getElementById("shareMsg");
  const btn = document.getElementById("shareSubmit");
  if(!currentUserId){ msg.textContent = "로그인해야 올릴 수 있어요."; msg.hidden = false; return; }
  /* 모두에게 보이는 링크라 http·https 주소만, 길이도 제한한다(B06 · QA-09: 회사 40자 · 메모 100자 · 링크 500자) */
  if(!safeUrl(f.url.value)){ msg.textContent = "링크는 http:// 또는 https://로 시작하는 주소만 올릴 수 있어요."; msg.hidden = false; f.url.focus(); return; }
  const tooLong = [["company", 40, "회사 이름"], ["note", 100, "메모"], ["url", 500, "링크"]].find(([k, n]) => f[k].value.trim().length > n);
  if(tooLong){ msg.textContent = tooLong[2] + "는 " + tooLong[1] + "자까지 올릴 수 있어요."; msg.hidden = false; f[tooLong[0]].focus(); return; }

  btn.disabled = true; msg.hidden = true;
  const { error } = await sb.from("jobboard_shared_jobs").insert({
    company: f.company.value.trim(),
    roles: shareRoleSel,
    url: safeUrl(f.url.value),
    end_date: f.end.value || null,
    note: f.note.value.trim() || null,
    created_by: currentUserId,
  });
  btn.disabled = false;

  if(error){
    msg.textContent = error.message.includes("does not exist")
      ? "지금은 공고를 올릴 수 없어요. 잠시 후 다시 해 주세요."
      : "올리지 못했어요. 잠시 후 다시 해 주세요.";
    console.warn("제보를 올리지 못했어요:", error.message);
    msg.hidden = false;
    return;
  }
  await loadShared();
  shareDlg.close();
  renderAll();
  toast(f.company.value.trim() + " 공고를 올렸어요. 모두에게 보여요");
};

/* ---------- 내 조건 ---------- */
const prefDlg = document.getElementById("prefDlg");
/* 창은 사본을 고친다 — 「저장」을 눌렀을 때만 반영하고, 닫기·Esc는 버린다(QA-12).
   '전체 보기'로 잠시 풀어 둔 동안에도 저장해 둔 조건을 보여 준다(BUG-16) */
let prefTmp = null;
function openPref(){
  const src = db.profile._bak || db.profile;
  prefTmp = {roles: src.roles.slice(), types: src.types.slice()};
  chips("roleChips", ROLES, prefTmp.roles);
  chips("typeChips", TYPES, prefTmp.types);
  document.getElementById("prefUnknown").checked = db.profile.unknownType !== false;
  prefDlg.showModal();
}
document.getElementById("prefCancel").onclick = () => prefDlg.close();
function chips(elId, opts, arr){
  const box = document.getElementById(elId); box.innerHTML = "";
  opts.forEach(function(o){
    const b = document.createElement("button"); b.type = "button"; b.textContent = o;
    b.setAttribute("aria-pressed", arr.includes(o));
    b.onclick = () => {
      const i = arr.indexOf(o);
      if(i > -1) arr.splice(i,1); else arr.push(o);
      b.setAttribute("aria-pressed", arr.includes(o));
    };
    box.appendChild(b);
  });
}
document.getElementById("prefBtn").onclick = openPref;
document.getElementById("prefDone").onclick = function(){
  if(prefTmp){ db.profile.roles = prefTmp.roles; db.profile.types = prefTmp.types; }
  db.profile.onboarded = true; delete db.profile._bak;
  db.profile.unknownType = document.getElementById("prefUnknown").checked;
  save(); prefDlg.close(); renderAll();
  const n = scoped().length;
  toast(db.profile.roles.length || db.profile.types.length ? "내 조건에 맞는 공고 " + n + "건을 보여 줘요" : "조건 없이 전체 공고 " + n + "건을 보여 줘요");
};

/* ---------- 일정 내보내기 (휴대폰 캘린더) ----------
   브라우저 알림은 앱을 열어둬야만 와서 마감을 놓치기 쉽다. 대신 캘린더에 넣어두면
   휴대폰이 알아서 울려준다. 마감은 하루 전과 6시간 전, 두 번 알림을 건다. */
function icsEscape(t){ return String(t).replace(/\r/g, "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n"); }
function icsStamp(d){ return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; }
/* 한 줄은 75옥텟까지, 넘으면 다음 줄 앞에 공백을 두고 잇는다(RFC 5545 줄 접기, 한글이 글자 중간에서 잘리지 않게) */
function icsFold(line){
  const enc = new TextEncoder(), out = [];
  let cur = "", n = 0;
  for(const ch of line){
    const b = enc.encode(ch).length;
    if(n + b > (out.length ? 74 : 75)){ out.push(cur); cur = ""; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
/* 마감 시각을 알면 그 시각에, 모르면 그날 23:59(한국 시간)로 잡는다 */
function icsMoment(date, time){
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "23:59").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm));   /* KST → UTC */
}
const icsDate = s => s.replace(/-/g, "");
/* 이미 지난 일정은 넣지 않는다. 시각을 모르는 전형은 종일 일정으로, 알림은 전날 9시(CR-19) */
function buildIcs(){
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//지원 보드//KR", "CALSCALE:GREGORIAN",
                 "METHOD:PUBLISH", "X-WR-CALNAME:지원 보드"];
  const now = icsStamp(new Date());
  let count = 0;

  myJobs().forEach(function(j){
    const a = appOf(j.id), url = safeUrl(j.url);
    const push = (when, title, alarms, note) => {
      if(!when || !when.date || dleft(when.date) < 0) return;
      const ev = ["BEGIN:VEVENT", "UID:" + j.id + "-" + title.replace(/\s/g, "") + "@jobboard", "DTSTAMP:" + now];
      if(when.allDay){
        const next = parse(when.date); next.setDate(next.getDate() + 1);
        ev.push("DTSTART;VALUE=DATE:" + icsDate(when.date), "DTEND;VALUE=DATE:" + icsDate(iso(next)));
      } else {
        const start = icsMoment(when.date, when.time);
        /* 시각 모르는 마감(23:59)은 1분짜리로 — 다음 날로 넘어가지 않게 */
        ev.push("DTSTART:" + icsStamp(start), "DTEND:" + icsStamp(new Date(start.getTime() + (when.time ? 30 : 1) * 60000)));
      }
      ev.push("SUMMARY:" + icsEscape(j.company + " " + title),
        "DESCRIPTION:" + icsEscape([(j.roles || []).join(", "), note || "", url].filter(Boolean).join("\n")));
      if(url) ev.push("URL:" + url);
      alarms.forEach(function(al){
        ev.push("BEGIN:VALARM", "ACTION:DISPLAY",
          "DESCRIPTION:" + icsEscape(j.company + " " + title + " " + al[1]),
          "TRIGGER:" + al[0], "END:VALARM");
      });
      ev.push("END:VEVENT");
      ev.forEach(l => lines.push(icsFold(l)));
      count++;
    };

    const dl = deadline(j);
    if(dl && a.doc === "대기"){
      /* 하루 전, 6시간 전 두 번 */
      const t = deadlineTime(j);
      push({date: dl, time: t}, "서류 마감", [["-P1D", "하루 전"], ["-PT6H", "6시간 전"]],
           t ? "" : "마감 시각을 몰라 그날 23:59로 넣었어요. 공고에서 시각을 확인해 주세요.");
    }
    a.stages.forEach(function(st){
      if(!st.date || st.result === "불합격") return;
      if(st.time) push({date: st.date, time: st.time}, st.name, [["-P1D", "하루 전"]]);
      else push({date: st.date, allDay: true}, st.name, [["-PT15H", "내일"]]);   /* 종일 일정 0시 기준 15시간 전 = 전날 9시 */
    });
  });

  lines.push("END:VCALENDAR");
  return {text: lines.join("\r\n"), count: count};
}
/* 일정 파일(.ics) 내려받기 — ⋯ 메뉴 · 내 지원 화면 · 전형 날짜를 넣은 직후(B19)가 같은 파일을 만든다 */
function exportIcs(){
  const ics = buildIcs();
  if(!ics.count){ toast("내보낼 일정이 없어요. 공고를 담고 마감일이나 전형 날짜를 넣어 주세요."); return; }
  const blob = new Blob([ics.text], {type:"text/calendar;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "지원보드-일정.ics";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("일정 " + ics.count + "건을 파일로 받았어요. 파일을 열면 휴대폰 캘린더에 들어가요. 새로 담은 공고는 다시 내보내야 해요");
}
document.getElementById("icsBtn").onclick = exportIcs;
document.getElementById("mineIcs").onclick = exportIcs;
/* 전형 날짜를 넣은 직후 — 휴대폰 캘린더에 바로 넣을 수 있게 토스트 버튼으로(B19) */
function offerIcs(what){ toast(what + " 날짜를 넣었어요", {label: "휴대폰 캘린더에 넣기", run: exportIcs}); }
/* 표 보기의 지금 전형 날짜·시각 칸(B13) */
function stageWhen(a, j, cur){
  const w = document.createElement("div"); w.className = "tb-when";
  const di = document.createElement("input"); di.type = "date"; di.value = cur.date || "";
  di.setAttribute("aria-label", j.company + " " + cur.name + " 일정");
  const ti = document.createElement("input"); ti.type = "time"; ti.value = cur.time || "";
  ti.setAttribute("aria-label", j.company + " " + cur.name + " 시각");
  di.onchange = () => { cur.date = di.value; cur.est = false; save(); renderAll(); if(cur.date) offerIcs(j.company + " " + cur.name); };
  ti.onchange = () => { cur.time = ti.value; save(); renderAll(); };
  w.append(di, ti);
  if(cur.est && cur.date) w.append(estTag("stage"));
  return w;
}

/* ---------- 백업 / 복원 ---------- */
function exportBackup(){
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "지원보드-백업-" + iso(new Date()) + ".json";
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("백업 파일을 받았어요");
}
document.getElementById("expBtn").onclick = exportBackup;
document.getElementById("impBtn").onclick = () => document.getElementById("fileIn").click();
document.getElementById("fileIn").onchange = function(e){
  const f = e.target.files[0]; if(!f) return;
  const rd = new FileReader();
  rd.onload = async function(){
    let r;
    try{ r = JSON.parse(rd.result); }catch(err){ r = null; }
    /* 빠진 항목(할 일·직접 등록 공고 등)은 빈 값으로 채워 복원한다(B28과 같은 normalizeDb) */
    /* 검증을 다 통과하기 전에는 아무것도 저장하지 않는다(QA-02) */
    if(!r || !r.apps || !r.profile || !normalizeDb(r)){ toast("지원 보드 백업 파일이 아니에요. 백업 파일 받기로 받은 .json 파일을 골라 주세요"); return; }
    /* 바꾸기 전에 확인 창 — 지금 내용을 먼저 받을 수 있게(B20 표 13번) */
    const n = Object.values(r.apps).filter(a => a.applied).length;
    const fileDay = f.lastModified ? iso(new Date(f.lastModified)) : "";
    let pick;
    while((pick = await confirmDlg({title: "백업 파일 내용으로 바꿀까요?",
      body: "지금 보드의 내용이 모두 백업 파일 내용으로 바뀌어요(" + (fileDay ? "파일 날짜 " + fmt(fileDay) + ", " : "") + "담은 공고 " + n + "건). 바꾸기 전에 지금 내용을 파일로 받을 수 있어요."},
      "바꾸기", "닫기", {danger: true, extra: "지금 내용 받기"})) === "extra") exportBackup();
    if(pick !== true) return;
    replaceDb(r); save(); renderAll(); toast("백업 파일 내용으로 바꿨어요");
  };
  rd.readAsText(f); e.target.value = "";
};

/* ---------- 채용 레이더 ----------
   data/radar.json(scripts/fetch-radar.mjs가 매일 갱신)을 탭을 처음 열 때만 받는다. */
let radarPromise = null;
const RD_BUCKETS = [["open","연차 제한 없음"],["unstated","연차 명시 없음"],["junior","1–2년"],["senior","3년 이상"]];
const RD_SRC = {toss:"토스", google:"Google", notion:"Notion", anthropic:"Anthropic"};
const RD_ROLES = ["프로덕트 기획","운영","마케팅·브랜드","솔루션·컨설팅","세일즈·파트너십","전략·재무","엔지니어링","HR","인재풀","기타"];
const RD_ORDER = {open:0, unstated:1, junior:2, senior:3};
function loadRadar(){
  if(radarPromise) return radarPromise;
  radarPromise = fetch("data/radar.json?t=" + Date.now())
    .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(initRadar)
    .catch(() => {
      radarPromise = null;
      document.getElementById("rdStamp").textContent = "레이더 공고를 불러오지 못했어요. 잠시 후 탭을 다시 눌러 주세요.";
    });
  return radarPromise;
}
function initRadar(data){
  /* 휴대폰에서는 필터가 화면을 다 차지하므로 접어 둔다 */
  if(window.matchMedia("(max-width:640px)").matches) document.getElementById("rdFilter").open = false;
  const jobs = data.jobs || [];
  const rolesOf = j => (j.roles && j.roles.length) ? j.roles : ["기타"];
  const latest = jobs.reduce((m, j) => j.firstSeen > m ? j.firstSeen : m, "");
  const isNew = j => j.firstSeen === latest && jobs.some(x => x.firstSeen < latest);
  const st = {buckets:new Set(["open","unstated","junior"]), companies:new Set(Object.keys(RD_SRC)), roles:new Set(RD_ROLES), newOnly:false};
  const cnt = b => jobs.filter(j => j.bucket === b).length;

  const d = new Date(data.collectedAt);
  document.getElementById("rdStamp").textContent = "토스(프로덕트·마케팅)·Google·Notion·Anthropic 채용 페이지에서 모은 서울 공고예요. 경력 공고가 많아요. · 마지막 수집 " +
    d.toLocaleString("ko-KR", {month:"long", day:"numeric", hour:"2-digit", minute:"2-digit"});

  const tally = document.getElementById("rdTally"); tally.replaceChildren();
  [["전체 공고", jobs.length]].concat(RD_BUCKETS.map(([k, l]) => [l, cnt(k)])).forEach(([l, n]) => {
    const el = document.createElement("div");
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = l;
    el.append(b, s); tally.append(el);
  });

  function chip(parentId, label, n, pressed, toggle){
    const b = document.createElement("button"); b.type = "button";
    b.textContent = label + (n != null ? " " + n : "");
    b.setAttribute("aria-pressed", pressed);
    b.onclick = () => { toggle(); b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); render(); };
    document.getElementById(parentId).append(b);
  }
  const flip = (set, k) => () => set.has(k) ? set.delete(k) : set.add(k);
  ["rdBucket","rdCompany","rdRole","rdExtra"].forEach(id => document.getElementById(id).replaceChildren());
  RD_BUCKETS.forEach(([k, l]) => chip("rdBucket", l, cnt(k), st.buckets.has(k), flip(st.buckets, k)));
  Object.entries(RD_SRC).forEach(([k, l]) => chip("rdCompany", l, jobs.filter(j => j.source === k).length, true, flip(st.companies, k)));
  RD_ROLES.forEach(r => { const n = jobs.filter(j => rolesOf(j).includes(r)).length; if(n) chip("rdRole", r, n, true, flip(st.roles, r)); });
  chip("rdExtra", "이번에 새로 뜬 공고만", jobs.filter(isNew).length, false, () => { st.newOnly = !st.newOnly; });

  function render(){
    const list = document.getElementById("rdList"); list.replaceChildren();
    const rows = jobs.filter(j => st.buckets.has(j.bucket) && st.companies.has(j.source) &&
        rolesOf(j).some(r => st.roles.has(r)) && (!st.newOnly || isNew(j)))
      .sort((a, b) => (b.fit - a.fit) || (RD_ORDER[a.bucket] - RD_ORDER[b.bucket]) || a.company.localeCompare(b.company));
    if(!rows.length){
      const e = document.createElement("li"); e.className = "rd-empty";
      e.textContent = "조건에 맞는 공고가 없어요. 경력 조건 필터를 더 켜 보세요."; list.append(e); return;
    }
    for(const j of rows){
      const li = document.createElement("li"); li.className = "rd-job";
      const co = document.createElement("div"); co.className = "rd-co"; co.textContent = j.company;
      const main = document.createElement("div"); main.className = "rd-main";
      const a = extLink(j.url, j.title, "rd-t");
      const meta = document.createElement("div"); meta.className = "rd-meta";
      if(isNew(j)){ const n = document.createElement("span"); n.className = "rd-new"; n.textContent = "NEW"; meta.append(n); }
      if(j.firstSeen) meta.append(mdOf(j.firstSeen) + " 발견 · ");
      meta.append(j.location || "");
      if(j.level) meta.append(" · 레벨 " + j.level);
      const tags = document.createElement("div"); tags.className = "rd-tags";
      rolesOf(j).forEach(r => { const t = document.createElement("span"); t.className = "rd-tag role"; t.textContent = r; tags.append(t); });
      (j.reqs || []).forEach(r => { const t = document.createElement("span"); t.className = "rd-tag"; t.textContent = r; tags.append(t); });
      main.append(a, meta, tags);
      if(j.evidence){ const q = document.createElement("p"); q.className = "rd-ev"; q.textContent = j.evidence; main.append(q); }
      const p = document.createElement("span"); p.className = "rd-pill " + j.bucket;
      p.textContent = j.bucket === "open" ? "연차 제한 없음" : j.bucket === "unstated" ? "연차 명시 없음" : j.years + "년 이상";
      li.append(co, main, p); list.append(li);
    }
  }
  render();

  const foot = document.getElementById("rdFoot"); foot.replaceChildren();
  ["쿠팡은 사이트가 자동 수집을 막아 목록에 없어요.",
   "Anthropic 공고는 연차가 주로 우대 요건에 적혀 있어요. 필수 조건이 아니어도 연차 조건으로 분류했어요."]
    .concat(Object.entries(data.errors || {}).map(([k, v]) => (RD_SRC[k] || k) + " 수집 실패로 이전 결과를 보여줘요: " + v))
    .forEach(t => { const p = document.createElement("div"); p.textContent = t; foot.append(p); });
}

/* ---------- 영업·세일즈 모아보기 ----------
   여러 출처에서 영업·세일즈·어카운트 직무만 골라 한 목록으로. 지원보드 공고는 '지원'으로 바로 담을 수 있다. */
const SALES_RE = /영업|세일즈|sales|account\s*(executive|manager|strategist|director)|\bAE\b|\bSDR\b|\bBDR\b|key\s*account|어카운트|판매|채널\s*관리|대리점/i;
const MKT_RE = /마케팅|마케터|marketing|marketer|브랜드|brand|그로스|growth|퍼포먼스|performance|\bCRM\b|\bPR\b|홍보|광고|캠페인|campaign|\bSNS\b|소셜|social\s*media|인플루언서|influencer|\bIMC\b|\bGTM\b/i;
const SL_KIND = [["B2B·기업영업", /B2B|기업|법인|enterprise|엔터프라이즈|솔루션|account|어카운트|cloud|SaaS|기술\s*영업/i],
  ["해외영업", /해외|글로벌|global|overseas|수출|무역|international/i],
  ["금융영업", /금융|은행|증권|보험|카드|자산|wealth|PB\b/i],
  ["영업관리·채널", /영업\s*관리|영업지원|채널|대리점|점포|매장|리테일|retail|유통|MD/i]];
const MKT_KIND = [["퍼포먼스·그로스", /퍼포먼스|performance|그로스|growth|\bCRM\b|광고\s*운영|\bads?\b|\bUA\b|리텐션|retention/i],
  ["브랜드·캠페인", /브랜드|brand|캠페인|campaign|\bIMC\b|\bBX\b|\bGTM\b|go[-\s]to[-\s]market/i],
  ["콘텐츠·SNS", /콘텐츠|컨텐츠|content|\bSNS\b|소셜|social|인플루언서|influencer|크리에이터|creator|에디터/i],
  ["PR·홍보", /\bPR\b|홍보|커뮤니케이션|communication|언론/i]];
/* 모드별 설정: 제목·켜기 플래그·메뉴 버튼·직무 글자·지원보드 직무 분류·레이더 직무 유형·종류 칩 */
const SL_MODES = {
  sales: {title: "영업·세일즈", flag: "salesOn", btn: "salesBtn", re: SALES_RE, board: /영업/, radar: "세일즈·파트너십", kinds: SL_KIND, other: "일반 영업",
    desc: "영업·세일즈·어카운트", foot: "영업·세일즈·Sales·Account Executive"},
  mkt: {title: "마케팅", flag: "mktOn", btn: "mktBtn", re: MKT_RE, board: /마케팅|브랜드|홍보|콘텐츠/, radar: "마케팅·브랜드", kinds: MKT_KIND, other: "일반 마케팅",
    desc: "마케팅·브랜드·그로스·콘텐츠·PR", foot: "마케팅·브랜드·그로스·퍼포먼스·콘텐츠·PR"},
};
let salesPromise = null, slData = null, slSrc = "", slKind = "", slMode = "sales";
Object.entries(SL_MODES).forEach(([mode, m]) => {
  document.getElementById(m.btn).onclick = function(){
    db.profile[m.flag] = !db.profile[m.flag]; save(); applyPrivate();
    if(db.profile[m.flag]){ document.querySelector('nav.tabs button[data-mode="' + mode + '"]').click(); toast("‘" + m.title + "’ 탭을 켰어요"); }
  };
});
function loadSales(){
  if(salesPromise) return salesPromise;
  const get = u => fetch(u + "?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
  salesPromise = Promise.all([get("data/radar.json"), get("artifact/data.json"), get("data/company-jobs.json"), loadDetails()])
    .then(([radar, junior, comp]) => { slData = {radar, junior, comp}; renderSales(); });
  return salesPromise;
}
const TALENT_RE = /인재\s*풀|인재\s*pool|talent\s*(pool|community|network)|인재\s*(등록|DB)|상시\s*인재|future\s*opportunit|general\s*application|open\s*application|자유\s*지원/i;
const isProgramName = s => /부트\s*캠프|bootcamp|\bcamp\b|캠프|K-?Digital|K-?디지털|K-?뉴딜|아카데미|academy|교육생|훈련생|내일배움|양성\s*과정/i.test(s || "");
function salesRows(){
  const today = iso(new Date()), out = [], seen = new Set();
  /* 지금 실제로 접수 중인 공고만: 인재풀·이력서 등록, 예상 일정, 마감·시작 전 공고, 오래된 상시 글은 뺀다 */
  const old = d => d && Date.parse(d) < Date.now() - 45 * 864e5;
  const push = (x) => {
    if(TALENT_RE.test(x.title || "") || isProgramName(x.company + " " + (x.title || ""))) return;
    const k = coKey(x.company) + "|" + (x.url || x.title);
    if(seen.has(k)) return; seen.add(k); out.push(x);
  };
  /* 1) 지원보드 공고: 직무 분류가 영업이거나, 모집 부문 이름에 영업이 들어간 것 */
  allJobs().forEach(j => {
    if(!j.confirmed || state(j).k !== "open" || superseded(j)) return;
    const M = SL_MODES[slMode];
    const tracks = ((DETAILS && DETAILS[j.id] && DETAILS[j.id].tracks) || []).map(t => t.name).filter(n => n && M.re.test(n));
    const byRole = (j.roles || []).some(r => M.board.test(r));
    if(!byRole && !tracks.length && !M.re.test(j.hist || "")) return;
    push({src: "board", id: j.id, company: j.company, title: tracks.slice(0, 3).join(" · ") || (j.roles || []).filter(r => M.board.test(r)).join(" · ") || M.title,
          url: j.url, end: j.end || "", years: null, junior: true, posted: j.start && j.start <= iso(new Date()) ? j.start : "", found: j.found || ""});
  });
  const d = slData || {};
  /* 2) 채용 레이더(외국계·AI·IT) */
  ((d.radar && d.radar.jobs) || []).forEach(j => {
    if(!SL_MODES[slMode].re.test(j.title) && !(j.roles || []).includes(SL_MODES[slMode].radar)) return;
    push({src: "radar", company: j.company, title: j.title, url: j.url, end: "", years: j.years, junior: j.bucket !== "senior", found: j.firstSeen || ""});
  });
  /* 3) 주니어 공고판 */
  ((d.junior && d.junior.rows) || []).forEach(r => {
    if(!SL_MODES[slMode].re.test(r.title)) return;
    const end = /^\d{4}-/.test(r.due || "") ? r.due : "";
    if(end && end < today) return;
    if(!end && old(r.openDate || r.found)) return;
    push({src: "junior", company: r["회사"], title: r.title, url: r.link, end, years: null, junior: true, posted: r.openDate || "", found: r.found || ""});
  });
  /* 4) 스타트업·유니콘·외국계 공식 채용 */
  ((d.comp && d.comp.jobs) || []).forEach(j => {
    if(!SL_MODES[slMode].re.test(j.title)) return;
    push({src: "company", company: j.company, title: j.title, url: j.url, end: "", years: j.years, junior: j.years === null || j.years <= 2, posted: j.posted || "", found: j.found || ""});
  });
  const M2 = SL_MODES[slMode];
  out.forEach(x => { x.kind = (M2.kinds.find(([, re]) => re.test(x.company + " " + x.title)) || [M2.other])[0]; });
  /* 마감 있는 것은 마감 순, 수시·상시는 최근에 올라온 것부터(빨리 낼수록 유리) */
  const since = x => (postedInfo(x) || {}).since || "";
  return out.sort((a, b) => (a.end || "9999").localeCompare(b.end || "9999") || since(b).localeCompare(since(a)) || a.company.localeCompare(b.company, "ko"));
}
const SL_SRC = {board: "채용 공고", radar: "채용 레이더", junior: "주니어 공고판", company: "기업 채용"};
function renderSales(){
  const all = salesRows(), jr = document.getElementById("slJunior").checked;
  const base = all.filter(x => !jr || x.junior);
  const chipRow = (id, items, cur, set) => {
    const box = document.getElementById(id); box.replaceChildren();
    items.forEach(([k, l, n]) => {
      if(k && !n) return;
      const b = document.createElement("button"); b.type = "button"; b.textContent = l + " " + n;
      b.setAttribute("aria-pressed", cur === k); b.onclick = () => { set(k); renderSales(); }; box.append(b);
    });
  };
  const bySrc = base.filter(x => !slKind || x.kind === slKind), byKind = base.filter(x => !slSrc || x.src === slSrc);
  chipRow("slSrc", [["", "전체 출처", bySrc.length]].concat(Object.entries(SL_SRC).map(([k, l]) => [k, l, bySrc.filter(x => x.src === k).length])), slSrc, k => slSrc = k);
  const M = SL_MODES[slMode];
  document.getElementById("slTitle").textContent = M.title;
  document.getElementById("slDesc").textContent = "전체 공고 · 채용 레이더 · 주니어 공고판 · 기업 채용에서 " + M.desc + " 직무만 모았어요. 마감 지난 공고는 빠져요.";
  chipRow("slKind", [["", "모든 종류", byKind.length]].concat(M.kinds.map(([k]) => k).concat([M.other]).map(k => [k, k, byKind.filter(x => x.kind === k).length])), slKind, k => slKind = k);
  const rows = base.filter(x => (!slSrc || x.src === slSrc) && (!slKind || x.kind === slKind));
  const ul = document.getElementById("slList"); ul.replaceChildren();
  if(!rows.length){ const e = document.createElement("li"); e.className = "rd-empty"; e.textContent = "조건에 맞는 " + M.title + " 공고가 없어요. 위 칩을 ‘전체’로 바꿔 보세요."; ul.append(e); }
  rows.forEach(x => {
    const li = document.createElement("li"); li.className = "rd-job";
    const co = document.createElement("div"); co.className = "rd-co"; co.textContent = x.company;
    const main = document.createElement("div"); main.className = "rd-main";
    const a = extLink(x.url, x.title, "rd-t");
    const meta = document.createElement("div"); meta.className = "rd-meta";
    meta.textContent = [SL_SRC[x.src], x.kind, x.end ? "마감 " + x.end.slice(5).replace("-", "/") + " (" + dday(x.end) + ")" : "상시·마감 미표기"].join(" · ");
    { const t = postedTag(x); if(t){ meta.append(" · "); meta.append(t); } }
    main.append(a, meta);
    const side = document.createElement("div"); side.className = "sl-side";
    const p = document.createElement("span"); p.className = "rd-pill " + (x.years ? (x.junior ? "junior" : "senior") : "open");
    p.textContent = x.years ? x.years + "년 이상" : "연차 표시 없음"; side.append(p);
    if(x.id){
      const b = document.createElement("button"); b.type = "button"; b.className = "ghost sl-add";
      const on = appOf(x.id).applied, j = allJobs().find(y => y.id === x.id);
      b.textContent = on ? "담음" : "담기"; b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", x.company + (on ? " 내 지원에서 빼기" : " 내 지원에 담기"));
      b.onclick = () => { if(!j) return; if(appOf(x.id).applied) unapplyJob(j); else applyJob(j); renderSales(); };
      side.append(b);
    }
    li.append(co, main, side); ul.append(li);
  });
  document.getElementById("slFoot").textContent = "총 " + all.length + "건 · 회사·제목에 " + M.foot + " 등이 들어간 공고를 모았어요. ‘담기’는 지원 보드 공고에만 있어요. 담은 공고는 내 지원에 모여요.";
}
document.getElementById("slJunior").onchange = renderSales;

/* ---------- 공채·그룹 공고: 직무 하나 고르기 ----------
   data/gongchae.json(매일 수집 때 scripts/build-gongchae.mjs가 만듦)의 직무별 JD 키워드·채용 규모·경쟁·뉴스·매출로
   공고 안의 직무들을 줄 세운다. 계산은 모두 브라우저에서(내 경험 키워드는 내 계정에만 있음). */
let GC = null, GC_GROUPS = [], gcPromise = null;
function loadGongchae(){
  if(gcPromise) return gcPromise;
  gcPromise = fetch("data/gongchae.json?t=" + Date.now()).then(r => r.ok ? r.json() : null)
    .then(o => { GC = {}; ((o && o.items) || []).forEach(x => GC[x.id] = x); GC_GROUPS = (o && o.groups) || []; }).catch(() => { GC = {}; });
  return gcPromise;
}
/* 삼성·신세계처럼 전 계열사 중 하나만 지원하는 그룹은 계열사 공고들의 직무를 한데 모아 한 공고처럼 다룬다 */
function gcGroupItem(g){
  const items = g.ids.map(id => GC[id]).filter(x => x && (!x.end || x.end >= iso(new Date())));
  if(!items.length) return null;
  const tracks = [];
  items.forEach(x => x.tracks.forEach(t => tracks.push(Object.assign({}, t, {
    name: (t.affiliate !== x.company ? x.company + " " : x.company + " · ") + t.name.replace(/^\s*\[[^\]]+\]\s*/, t.affiliate !== x.company ? "[" + t.affiliate + "] " : ""),
    affiliate: t.affiliate !== x.company ? t.affiliate : x.company, from: x.id}))));
  const maxApp = Math.max(1, ...tracks.map(t => t.applicants || 0));
  tracks.forEach(t => { t.competition = (t.applicants || 0) / maxApp; });
  return {id: "group:" + g.name, company: g.name + "그룹", type: items[0].type, group: g.name, note: g.note, oneOnly: true,
    end: items.map(x => x.end).sort()[0], why: [g.note, "공고 " + items.length + "개"], jdSource: [...new Set(items.map(x => x.jdSource))].join("·"),
    revenue: null, ids: items.map(x => x.id), tracks};
}
/* 기획·마케팅·영업·운영·경영지원 계열이 아닌 직무(개발·설계·생산·연구·전문 자격 등) — 추천에서 맨 뒤로 */
const GC_OFF = /개발|엔지니어|engineer|SW|HW|설계|생산|제조|공정|품질|설비|연구|R&D|회로|반도체|토목|건축|구조|기계|전기|전자|화학|배합|시설|검사|정보보안|보안|클라우드|인프라|네트워크|디자인|designer|간호|약사|조리|영양|의료|임상|운전|정비|IB\b|PF\b|트레이딩|애널리스트|퀀트|법무|변호사|세무사|회계사/i;
/* 직무 이름 → 직무 계열(ROLES와 같은 이름 + 경영지원). 위에서부터 먼저 맞는 것 하나만 */
const GC_FAM = [
  ["PM/서비스기획", /서비스\s*기획|\bP[MO]\b|프로덕트|product|AI\s*기획|플랫폼\s*기획|UX\s*기획/i],
  ["MD", /\bMD\b|머천|바이어|상품\s*기획|매입|이커머스|커머스|리테일\s*기획/i],
  ["마케팅", /마케팅|marketing|그로스|CRM|광고|퍼포먼스/i],
  ["브랜드", /브랜드|브랜딩/],
  ["콘텐츠", /콘텐츠|컨텐츠|\bPD\b|에디터|크리에이티브|방송/i],
  ["사업개발", /사업\s*개발|신사업|제휴|\bBD\b/i],
  ["기획/전략", /기획|전략|리징|공간|컨설팅|AX|DX/i],
  ["영업관리", /영업\s*관리|점포|매장|스토어|지점/],
  ["영업", /영업|세일즈|sales|수주/i],
  ["홍보/PR", /홍보|\bPR\b|대외|커뮤니케이션/i],
  ["고객/CS", /\bCS\b|\bCX\b|고객/i],
  ["리서치", /리서치|조사|research/i],
  ["HR/인사", /인사|\bHR\b|채용|조직\s*문화|교육\s*담당/i],
  ["금융/심사", /재무|회계|자금|세무|\bIR\b|심사|여신|금융/i],
  ["경영지원", /경영\s*지원|총무|구매|법무|SCM|물류|제조|생산|관리\s*직|사무/i],
];
/* 소민님처럼 기획·마케팅 쪽을 노리는 사람의 기본 관심 직무(설정에서 고른 직무가 있으면 그걸 쓴다) */
const GC_CORE = ["PM/서비스기획","기획/전략","사업개발","마케팅","브랜드","콘텐츠","MD"];
/* 누구나 이력서에 쓰는 말 — 경쟁자도 다 갖고 있어 강점이 되기 어렵다 */
const GC_GENERIC = /이해관계자|문서화|커뮤니케이션|협업|프로세스\s*개선|리더십|엑셀|오피스|글로벌|해외|일정\s*관리/;
const gcFam = name => (GC_FAM.find(([, re]) => re.test(name)) || [""])[0];
function gcFit(name){
  const fam = gcFam(name);
  const mineRoles = (db.profile.roles && db.profile.roles.length) ? db.profile.roles : GC_CORE;
  if(!fam) return [50, "", "직무 계열을 이름으로 알 수 없음"];
  if(mineRoles.includes(fam)) return [100, fam, fam + " — 내 관심 직무"];
  if(fam === "경영지원" || fam === "금융/심사" || fam === "HR/인사") return [15, fam, fam + " — 관심 직무와 거리가 멀어 강점을 보이기 어려움"];
  if(GC_CORE.includes(fam) || fam === "영업" || fam === "홍보/PR" || fam === "리서치") return [65, fam, fam + " — 관심 직무와 가까움"];
  return [40, fam, fam + " — 관심 직무 밖"];
}
function gcRank(item){
  const mine = typeof mtMine === "function" ? mtMine() : new Set();
  const hasMine = !!(db.match && mine.size);
  const cnt = (db.match && db.match.counts) || {};
  const maxCnt = Math.max(1, ...Object.values(cnt));
  const maxAff = Math.max(1, ...item.tracks.map(t => t.affiliateTracks || 1));
  const anyApp = item.tracks.some(t => t.applicants > 0);
  const maxHead = Math.max(0, ...item.tracks.map(t => t.headcount || 0));
  /* 이 공고(그룹) 안에서 키워드가 얼마나 흔한지 — 모든 직무에 다 붙는 회사 소개 말은 차이를 만들지 못한다 */
  const N = item.tracks.length, df = {};
  item.tracks.forEach(t => Object.keys(t.w || {}).forEach(k => df[k] = (df[k] || 0) + 1));
  const idf = k => Math.log((N + 1) / ((df[k] || 0) + 0.5)) / Math.log(N + 1 + 1e-9) * (GC_GENERIC.test(k) ? 0.3 : 1);
  return item.tracks.map(t => {
    const f = [];   // [이름, 0~100 점수, 비중, 설명]
    const nm = t.name.replace(/^\s*\[[^\]]+\]/, "");
    /* 개발자·엔지니어 직함은 무조건 다른 직군, 그 밖의 기술 단어는 기획·마케팅 같은 말이 같이 있으면 남긴다(예: 인프라 전략기획) */
    const off = /engineer|developer|architect|개발자|엔지니어|backend|frontend|코딩|프로그래머|scientist/i.test(nm) ||
      (GC_OFF.test(nm) && !/기획|마케팅|영업|사업|전략|서비스\s*기획|MD|PM|PO|경영/.test(nm));
    const [fit, fam, fitWhy] = gcFit(nm);
    f.push(["직무 적합", fit, 30, fitWhy]);
    const why = {fam, edge: [], common: [], miss: []};
    if(hasMine){
      /* 경쟁자 대비 강점: 이 직무에서만 두드러지는 키워드를 내가 '깊게'(경험 여러 번) 갖고 있을수록 높다 */
      let num = 0, den = 0;
      Object.entries(t.w || {}).forEach(([k, w]) => {
        const v = w * idf(k); den += v;
        if(mine.has(k)){
          const depth = 0.5 + 0.5 * Math.min(1, (cnt[k] || 0) / (maxCnt * 0.5));
          num += v * depth;
          (idf(k) >= 0.35 ? why.edge : why.common).push(k);
        } else if(idf(k) >= 0.35 && w >= 2) why.miss.push(k);
      });
      const edge = den ? Math.round(num / (den + 0.5) * 100) : 0;
      f.push(["강점", edge, 35, den ? "이 직무에서 두드러지는 JD 키워드 중 내 경험이 깊은 것 " + edge + "%" + (t.ownJd ? "" : " (직무 이름·공통 본문 기준)") : "JD 키워드가 없어 비교할 수 없음"]);
    }
    const u = privOn() ? unScore({company: t.affiliate || item.company, title: t.name, type: item.type}) : null;
    if(u) f.push(["운", u.total, 10, "운 궁합 " + u.mark + " " + u.total]);
    const vol = maxHead ? Math.round(30 + 70 * (t.headcount || 0) / maxHead) : Math.round(30 + 70 * (t.affiliateTracks || 1) / maxAff);
    f.push(["채용 규모", vol, 10, maxHead && t.headcount ? "모집 " + t.headcount + "명" : (t.affiliate !== item.company ? t.affiliate + " 직무 " + t.affiliateTracks + "개" : "공고 안 직무 " + item.tracks.length + "개")]);
    if(anyApp) f.push(["경쟁", Math.round(100 - 70 * (t.competition || 0)), 10, "자소설 지원 준비 " + (t.applicants || 0) + "명" + (t.headcount ? "(모집 " + t.headcount + "명)" : "") + (t.competition >= 0.7 ? " (붐빔)" : t.competition <= 0.3 ? " (한산)" : "")]);
    if(item.revenue && item.revenue.growth != null) f.push(["성장", Math.max(0, Math.min(100, Math.round(50 + item.revenue.growth * 2))), 5, item.revenue.year + "년 매출 " + (item.revenue.growth >= 0 ? "+" : "") + item.revenue.growth + "%"]);
    if(t.news && t.news.n30) f.push(["뉴스", Math.min(100, 40 + t.news.role * 15), 5, "최근 30일 기사 " + t.news.n30 + "건 중 이 직무 관련 " + t.news.role + "건"]);
    const wsum = f.reduce((s, x) => s + x[2], 0);
    let total = Math.round(f.reduce((s, x) => s + x[1] * x[2], 0) / (wsum || 1));
    /* 관심 직무 밖인데 키워드만 많이 겹치는 경우(예: 총무·경영지원)는 위로 올라오지 않게 */
    if(fit <= 15) total = Math.min(total, 55);
    return {t, total: off ? Math.min(total, 40) : total, f, off, fit, why, noExp: !hasMine};
  }).sort((a, b) => (a.off - b.off) || b.total - a.total || b.fit - a.fit);
}
function gcRow(r, i){
  const li = document.createElement("li"); li.className = "gc-row" + (i === 0 ? " best" : "");
  const n = document.createElement("div"); n.className = "gc-n"; n.textContent = (i + 1) + "";
  const m = document.createElement("div"); m.className = "gc-m";
  const b = document.createElement("b"); b.textContent = r.t.name; m.append(b);
  if(r.off){ const o = document.createElement("span"); o.className = "sub"; o.textContent = "  다른 직군(개발·설계·전문직 등)"; m.append(o); li.classList.add("off"); }
  const chips = document.createElement("div"); chips.className = "rd-tags";
  r.f.forEach(([k, v, , why]) => { const c = document.createElement("span"); c.className = "rd-tag" + (v >= 70 ? " role" : ""); c.textContent = k + " " + v; c.title = why; chips.append(c); });
  m.append(chips);
  /* 왜 이 순위인지: 직무 계열 + 내 강점 키워드 / 누구나 겹치는 키워드 / 부족한 키워드 */
  const w = document.createElement("p"); w.className = "gc-why";
  const add = (label, arr, cls) => { if(!arr.length) return; const s = document.createElement("span"); s.className = cls; s.textContent = label + " " + arr.slice(0, 5).join(", "); w.append(s); };
  add("직무", [r.f[0][3]], "w-fit");
  add("✓ 강점 키워드", r.why.edge, "w-edge");
  add("△ 흔한 겹침", r.why.common, "w-common");
  add("✗ 부족", r.why.miss, "w-miss");
  if(r.noExp){ const s = document.createElement("span"); s.className = "w-common"; s.textContent = "JD 키워드 " + Object.keys(r.t.w || {}).slice(0, 5).join(", "); w.append(s); }
  m.append(w);
  if(r.t.news && r.t.news.top && r.t.news.top.length && i < 3){ const p = document.createElement("p"); p.className = "gc-news"; p.textContent = "뉴스: " + r.t.news.top.slice(0, 2).join(" · "); m.append(p); }
  const sc = document.createElement("div"); sc.className = "mt-pct"; sc.textContent = r.total; const sm = document.createElement("small"); sm.textContent = "종합"; sc.append(sm);
  li.append(n, m, sc); return li;
}
async function renderPick(id){
  const box = document.getElementById("jdPick"); box.hidden = true; box.replaceChildren();
  await loadGongchae();
  if(jdId !== id || !GC[id]) return;
  const g = GC[id].group && GC_GROUPS.find(x => x.name === GC[id].group);
  const item = (g && gcGroupItem(g)) || GC[id], ranked = gcRank(item);
  const h = document.createElement("h3"); h.textContent = g ? g.name + " 공채 전체에서 하나만 고른다면" : "이 공고에서 하나만 고른다면";
  const sub = document.createElement("p"); sub.className = "sub";
  sub.textContent = "공채 판단: " + item.why.join(" · ") + " · JD 출처: " + item.jdSource + (item.oneOnly ? " · ⚠ 공고에 '한 직무(계열사)만 지원' 조건이 있어요" : "") +
    (ranked[0] && ranked[0].noExp ? " · 매칭 아카이브에 경험을 넣으면 '경험' 점수가 더해져요" : "");
  const how = document.createElement("p"); how.className = "sub";
  how.textContent = "순위 기준: 직무 적합 30(내 관심 직무인지) · 강점 35(그 직무에서만 두드러지는 JD 키워드를 내가 깊게 갖고 있는지 — 누구나 쓰는 ‘이해관계자 조율·문서화’ 같은 말은 적게 침) · 채용 규모·경쟁 각 10" + (privOn() ? " · 운 10" : "") + ". 관심 직무 밖(경영지원·총무·재무 등)은 키워드가 겹쳐도 55점을 넘지 않아요.";
  box.append(h, sub, how);
  /* 그룹이면 계열사마다 가장 나은 직무 하나씩 — 계열사가 순위 밖으로 밀려 안 보이는 일이 없게 */
  if(g){
    const best = new Map();
    ranked.filter(r => !r.off).forEach(r => { const k = r.t.affiliate || r.t.from; if(!best.has(k)) best.set(k, r); });
    const p = document.createElement("div"); p.className = "gc-aff";
    const l = document.createElement("span"); l.className = "sub"; l.textContent = "계열사별 1위"; p.append(l);
    [...best.values()].forEach(r => { const c = document.createElement("span"); c.className = "rd-tag" + (r === ranked[0] ? " role" : ""); c.textContent = r.t.name.replace(/\s*·\s*/, " ") + " " + r.total; p.append(c); });
    box.append(p);
  }
  const ul = document.createElement("ol"); ul.className = "rd-jobs gc-list";
  ranked.slice(0, 8).forEach((r, i) => { const li = gcRow(r, i); if(g && r.t.from === id) li.classList.add("here"); ul.append(li); });
  box.append(ul);
  if(g){ const here = ranked.findIndex(r => r.t.from === id); if(here >= 8){ const p = document.createElement("p"); p.className = "sub"; p.textContent = "이 공고의 가장 높은 직무는 그룹 전체 " + ranked.length + "개 중 " + (here + 1) + "위예요(" + ranked[here].t.name + " " + ranked[here].total + "점)."; box.append(p); } }
  if(ranked.length > 8){
    const more = document.createElement("details"); more.className = "gc-more";
    const sm = document.createElement("summary"); sm.textContent = "나머지 " + (ranked.length - 8) + "개 직무도 보기"; more.append(sm);
    const ul2 = document.createElement("ol"); ul2.className = "rd-jobs gc-list"; ul2.start = 9;
    ranked.slice(8).forEach((r, i) => { const li = gcRow(r, i + 8); if(g && r.t.from === id) li.classList.add("here"); ul2.append(li); });
    more.append(ul2); box.append(more);
  }
  box.hidden = false;
}
function renderGcBox(){
  const box = document.getElementById("gcBox");
  if(!GC){ loadGongchae().then(renderGcBox); return; }
  const items = Object.values(GC).filter(x => !x.end || x.end >= iso(new Date()));
  box.hidden = !items.length;
  document.getElementById("gcFxNote").textContent = privOn() ? " · 운 궁합 15%(소민 전용)" : "";
  const groupItems = GC_GROUPS.map(gcGroupItem).filter(Boolean);
  const inGroup = new Set(groupItems.flatMap(x => x.ids));
  const rows = groupItems.concat(items.filter(x => !inGroup.has(x.id))).map(x => ({x, r: gcRank(x).filter(y => !y.off)})).filter(o => o.r.length)
    .sort((a, b) => (!!b.x.ids - !!a.x.ids) || b.r[0].total - a.r[0].total);  /* 그룹 공채(하나만 지원)를 맨 위에 */
  document.getElementById("gcSum").textContent = rows.length + "개 공고";
  const ul = document.getElementById("gcList"); ul.replaceChildren();
  rows.slice(0, 40).forEach(({x, r}) => {
    const li = document.createElement("li"); li.className = "rd-job";
    const co = document.createElement("div"); co.className = "rd-co"; co.textContent = x.company;
    const main = document.createElement("div"); main.className = "rd-main";
    const a = document.createElement("a"); a.className = "rd-t"; a.href = "#"; a.textContent = "추천: " + r[0].t.name;
    a.onclick = (e) => { e.preventDefault(); openJob(x.ids ? r[0].t.from : x.id); };
    if(x.oneOnly && x.ids) li.classList.add("gc-group");
    const meta = document.createElement("div"); meta.className = "rd-meta";
    meta.textContent = [x.ids ? "계열사 공고 " + x.ids.length + "개 · 전체 " + x.tracks.length + "개 직무 중 하나만" : x.tracks.length + "개 직무 중", r[1] ? "다음: " + r[1].t.name + " " + r[1].total : "", x.end ? "마감 " + x.end.slice(5).replace("-", "/") : "", x.oneOnly ? "한 직무만 지원" : ""].filter(Boolean).join(" · ");
    main.append(a, meta);
    const sc = document.createElement("div"); sc.className = "mt-pct"; sc.textContent = r[0].total; const sm = document.createElement("small"); sm.textContent = "종합"; sc.append(sm);
    li.append(co, main, sc); ul.append(li);
  });
}

/* ---------- 매칭 아카이브 ----------
   공고 쪽 키워드(data/jd-keywords.json)는 공개 데이터, 내 쪽 키워드(db.match)는 내 계정에만 있다.
   매칭률 = JD 키워드 가중치 중 내 키워드에 해당하는 비율. 가중치는 JD에 나온 횟수(최대 3). */
const MT_TIERS = [["적극지원", 80, "tier-1"], ["적합지원", 70, "tier-2"], ["상향지원", 60, "tier-3"], ["연습지원", 50, "tier-4"]];
const MT_SRC = {board:"지원보드", radar:"채용 레이더", junior:"주니어 공고판", company:"기업 채용", linkedin:"링크드인"};
let mtEditing = false;
let matchPromise = null, mtData = null, mtDict = null, mtDictG = null, mtTier = "", mtCo = "", mtRole = "", mtSortBy = "pct", mtYr = "jr", mtGrp = "";
/* 연차 묶음 — years: null(표시 없음·무관) 또는 최소 연차 숫자 */
const MT_YRS = [["jr", "신입·~2년", y => y === null || y <= 2], ["mid", "3~4년", y => y !== null && y >= 3 && y <= 4], ["sr", "5년+", y => y !== null && y >= 5], ["", "연차 전체", () => true]];
const mtYrLabel = y => y === null || y === undefined ? "연차 무관·미표기" : y <= 0 ? "신입" : "경력 " + y + "년+";
/* 회사 묶음 — 위에서부터 먼저 맞는 것 하나 */
const MT_GRPS = [
  ["대형 IT 7곳", /네이버|naver|카카오|kakao|라인|\bLINE\b|쿠팡|coupang|우아한|배달의민족|배민|당근|토스|비바리퍼블리카/i],
  ["야놀자·두나무·센드버드", /야놀자|놀유니버스|\bNOL\b|두나무|업비트|센드버드|sendbird/i],
  ["외국계", new RegExp(UN_FOREIGN.source + "|텐센트|tencent|구글|노션|앤트로픽|오픈AI|스노우플레이크|아마존|amazon|microsoft|마이크로소프트|meta|애플|apple|bat\\b|사노피|로레알|p&g", "i")],
  ["대기업·금융·공기업", null],
  ["유니콘·스케일업", UN_UNICORN],
  ["스타트업·기타", null],
];
function mtGrpOf(j, type){
  for(const [g, re] of MT_GRPS){ if(re && re.test(j.company)) return g; }
  if(/대기업|금융|공기업/.test(type || "")) return "대기업·금융·공기업";
  if(/외국계/.test(type || "")) return "외국계";
  if(/유니콘/.test(type || "")) return "유니콘·스케일업";
  return "스타트업·기타";
}
/* 매칭 아카이브 직무 묶음 — 공고 제목으로 나눈다(위에서부터 먼저 맞는 것) */
const MT_ROLES = [
  ["기획·PM", /기획|\bPM\b|\bPO\b|product|프로덕트|program\s*manag/i],
  ["마케팅·브랜드", /마케|marketing|브랜드|brand|그로스|growth|\bCRM\b|퍼포먼스|광고|홍보|\bPR\b|campaign/i],
  ["콘텐츠·커뮤니티", /콘텐츠|컨텐츠|content|에디터|커뮤니티|community|크리에이터|creator/i],
  ["영업·세일즈", /영업|세일즈|sales|account\s*(executive|manager)|어카운트|\bAE\b/i],
  ["전략·사업개발", /전략|strategy|사업|business|\bBD\b|제휴|partnership|GTM|컨설/i],
  ["운영·CX", /운영|operation|ops\b|\bCX\b|\bCS\b|고객|customer|상담|물류|\bSCM\b|\bMD\b|머천/i],
  ["데이터·리서치", /데이터|data|분석|analyst|리서치|research|insight/i],
];
const mtRoleOf = t => (MT_ROLES.find(([, re]) => re.test(t)) || ["기타"])[0];
function loadMatch(){
  if(!matchPromise){
    matchPromise = Promise.all([
      fetch("data/jd-keywords.json?t=" + Date.now()).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("data/keyword-dict.json?t=" + Date.now()).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
    ]).then(([data, dict]) => {
      mtData = data;
      mtDict = dict.map(([label, src]) => [label, new RegExp(src, "i")]);
      mtDictG = dict.map(([label, src]) => [label, new RegExp(src, "gi")]);
    }).catch(() => { matchPromise = null; });
  }
  return matchPromise.then(renderMatch, () => {
    document.getElementById("mtOut").textContent = "매칭 데이터를 불러오지 못했어요. 잠시 후 탭을 다시 눌러 주세요.";
  });
}
function mtSplit(text){
  const parts = /^#{1,4}\s/m.test(text) ? text.split(/\n(?=#{1,4}\s)/) : text.split(/\n\s*\n/);
  return parts.map(p => p.trim()).filter(p => p.length > 40);
}
function mtExtract(text){ return mtDict.filter(([, re]) => re.test(text)).map(([l]) => l); }
/* 붙여넣은 경험정리는 제목(#) 단위로 쪼개 아카이브 > 경험 정리에 카드로도 보관한다(내 계정에만 저장).
   다시 붙여넣으면 이전에 붙여넣은 카드만 새것으로 바꾸고, 직접 쓴 카드는 그대로 둔다. */
function mtArchive(text){
  const parts = mtSplit(text);
  const today = new Date().toISOString().slice(0, 10);
  const cards = parts.map((p, i) => {
    const lines = p.split("\n");
    const title = lines[0].replace(/^#+\s*/, "").trim().slice(0, 80) || ("경험 " + (i + 1));
    return {id: "p" + Date.now() + "-" + i, src: "paste", at: today, title, tags: "경험정리 원문", s: lines.slice(1).join("\n").trim(), t: "", a: "", r: ""};
  });
  db.arc.exp = (db.arc.exp || []).filter(e => e.src !== "paste").concat(cards);
  return cards.length;
}
/* 긴 글을 경험 단위로 나눈다. 제목·빈 줄이 없는 글(PDF에서 뽑은 이력서 등)은 줄을 모아 약 400자씩 */
function mtChunks(text){
  const parts = mtSplit(text);
  if(parts.length > 1 || text.length < 700) return parts.length ? parts : (text.trim().length > 40 ? [text.trim()] : []);
  const out = []; let cur = "";
  text.split(/\n+/).forEach(l => { cur += l + "\n"; if(cur.length > 400){ out.push(cur.trim()); cur = ""; } });
  if(cur.trim().length > 40) out.push(cur.trim());
  return out;
}
/* 키워드를 셀 경험 단위: 아카이브 경험 카드 + 아카이브 자소서·이력서·포트폴리오 + 내 지원에 쓴 자소서 문항·이력서 */
function mtUnits(){
  const cardText = e => [e.title, e.tags, e.s, e.t, e.a, e.r].join("\n");
  const units = (db.arc.exp || []).map(cardText);
  (db.arc.cov || []).forEach(q => { if((q.a || "").trim().length > 40) units.push([q.q || "", q.a].join("\n")); });  /* 마스터 자소서 문항 */
  ["res", "pf"].forEach(f => { if(typeof db.arc[f] === "string" && db.arc[f].trim()) units.push(...mtChunks(db.arc[f])); });
  Object.values(db.apps || {}).forEach(a => {
    (a.essays || []).forEach(e => { if((e.a || "").trim().length > 40) units.push([e.q || "", e.a].join("\n")); });
    ["resume", "folio"].forEach(f => { if(a[f]) units.push(...mtChunks(a[f])); });
  });
  /* 같은 글을 두 번 세지 않게(같은 자소서를 여러 회사에 낸 경우 등) */
  const seen = new Set();
  return units.filter(u => { const k = u.replace(/\s+/g, "").slice(0, 300); if(u.trim().length <= 40 || seen.has(k)) return false; seen.add(k); return true; });
}
function mtBuild(){
  const exps = mtUnits();
  const counts = {};
  exps.forEach(e => mtExtract(e).forEach(k => { counts[k] = (counts[k] || 0) + 1; }));
  const prev = db.match || {};
  db.match = {counts, n: exps.length, at: iso(new Date()), on: prev.on || [], off: prev.off || []};
  save();
  return exps.length;
}
/* 올린 파일은 파일 이름별로 경험 카드로 보관(같은 파일을 다시 올리면 그 파일 카드만 바뀜) */
function mtArchiveFile(name, text){
  const chunks = mtChunks(text);
  const today = iso(new Date());
  db.arc.exp = (db.arc.exp || []).filter(e => !(e.src === "file" && e.file === name)).concat(chunks.map((c, i) => {
    const first = c.split("\n")[0].replace(/^#+\s*/, "").trim();
    return {id: "f" + Date.now() + "-" + i, src: "file", file: name, at: today, title: (first.length <= 60 ? first : name + " " + (i + 1)), tags: "파일: " + name, s: c, t: "", a: "", r: ""};
  }));
  return chunks.length;
}
const loadScript = src => new Promise((ok, no) => { const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = no; document.head.append(el); });
async function fileText(f){
  const name = f.name.toLowerCase();
  if(/\.(txt|md)$/.test(name) || f.type.startsWith("text/")) return f.text();
  const buf = await f.arrayBuffer();
  if(/\.pdf$/.test(name)){
    if(!window.pdfjsLib) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({data: buf}).promise;
    let out = "";
    for(let i = 1; i <= pdf.numPages; i++){
      const tc = await (await pdf.getPage(i)).getTextContent();
      out += tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n\n";
    }
    return out;
  }
  if(/\.docx$/.test(name)){
    if(!window.mammoth) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    return (await mammoth.extractRawText({arrayBuffer: buf})).value;
  }
  throw new Error("지원하지 않는 형식");
}
/* 경험 수의 8% 이상에서 나온 키워드를 '내 것'으로 본다(문서가 길수록 우연히 한 번 스친 단어가 많아서) */
function mtThreshold(){ const m = db.match; return m ? Math.max(1, Math.round(m.n * 0.08)) : 1; }
function mtMine(){
  const m = db.match; if(!m) return new Set();
  const th = mtThreshold();
  return new Set(Object.keys(m.counts).filter(k => (m.counts[k] >= th && !m.off.includes(k)) || m.on.includes(k)));
}
/* ---------- 링크드인 붙여넣기 ----------
   링크드인은 자동 수집이 약관상 금지라, 내가 화면에서 복사한 글을 붙여넣으면 거기서 공고를 뽑는다.
   목록 항목: 제목이 두 번 붙어 나오는 줄(스크린리더용 중복) → 다음 줄 회사 → 그다음 줄 지역.
   상세 본문: "[제목](…/jobs/view/번호…)" 링크 뒤 "채용공고 정보"부터 지원자 비교·회사 소개 전까지. */
function liParse(text){
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  const clean = t => t.replace(/\(인증 완료된 채용공고\)/g, "").trim();
  for(let i = 0; i < lines.length - 2; i++){
    const L = clean(lines[i]);
    const half = L.length / 2;
    if(L.length < 6 || L.length % 2 || L.slice(0, half) !== L.slice(half)) continue;
    const title = L.slice(0, half).trim();
    const company = lines[i+1], loc = lines[i+2];
    if(/^\[|https?:/.test(company) || company.length > 60) continue;
    items.push({title, company, loc: /서울|대한민국|성남|판교|역삼|인천|경기|korea|seoul|화성|수원|부산/i.test(loc) ? loc : ""});
  }
  const det = text.match(/\[([^\]]+)\]\((https:\/\/www\.linkedin\.com\/jobs\/view\/(\d+))[^)]*\)/);
  if(det){
    const start = text.indexOf("채용공고 정보", det.index);
    if(start > 0){
      const rest = text.slice(start + 6);
      const end = rest.search(/지원을 클릭한 다른 사람과 비교하기|나 vs\. 다른 지원자|회사 소개\n|\n회사 소개/);
      const jd = (end > 0 ? rest.slice(0, end) : rest.slice(0, 6000)).replace(/… 더보기\s*$/, "").trim();
      const title = det[1].trim();
      const it = items.find(x => x.title === title);
      const co = (text.slice(Math.max(0, det.index - 300), det.index).match(/\[([^\]]+)\]\(https:\/\/www\.linkedin\.com\/company\/[^)]*\)\s*$/) || [])[1];
      if(it){ it.jd = jd; it.url = det[2]; }
      else items.push({title, company: co || "", loc: "", jd, url: det[2]});
    }
  }
  return items;
}
function liYears(t){
  const mins = [];
  [/(\d+)\s*(?:[~\-–]\s*\d+\s*)?\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/gi, /(\d+)\s*(?:[~\-–]\s*\d+\s*)?\+\s*years/gi,
   /(?:경력|경험|실무)\s*(\d+)\s*년/g, /(\d+)\s*(?:[~\-–]\s*\d+\s*)?년\s*(?:이상|차)?\s*(?:의)?\s*(?:경력|경험|실무|이상)/g]
    .forEach(re => { for(const m of t.matchAll(re)) mins.push(+m[1]); });
  const v = mins.filter(n => n > 0 && n < 30);
  return v.length ? Math.max(...v) : null;
}
function liWeights(t){
  const w = {};
  mtDictG.forEach(([l, re]) => { const n = (t.match(re) || []).length; if(n) w[l] = Math.min(n, 3); });
  return w;
}
function liImport(text){
  const got = liParse(text);
  db.linkedin = db.linkedin || [];
  let added = 0, withJd = 0;
  got.forEach(g => {
    const key = (g.company + "|" + g.title).toLowerCase();
    let cur = db.linkedin.find(x => x.key === key);
    if(!cur){ cur = {key, title: g.title, company: g.company, loc: g.loc, at: new Date().toISOString().slice(0, 10)}; db.linkedin.unshift(cur); added++; }
    if(g.url) cur.url = g.url;
    if(g.jd){ cur.years = liYears(g.jd); cur.w = liWeights(g.title + "\n" + g.jd); withJd++; }
  });
  db.linkedin = db.linkedin.slice(0, 500);
  save();
  return {found: got.length, added, withJd};
}
function liJobs(){
  return (db.linkedin || []).filter(x => x.w && x.years === null && Object.keys(x.w).length >= 3)
    .map(x => ({src: "linkedin", company: x.company, title: x.title,
                url: safeUrl(x.url) || "https://www.linkedin.com/jobs/search/?keywords=" + encodeURIComponent(x.company + " " + x.title), end: "", w: x.w}));
}
function renderLinkedin(){
  const li = db.linkedin || [];
  const noJd = li.filter(x => !x.w);
  document.getElementById("liStat").textContent = li.length
    ? "저장 " + li.length + "건 · 본문 있음 " + (li.length - noJd.length) + "건 · 연차 표시로 제외 " + li.filter(x => x.w && x.years !== null).length + "건"
    : "링크드인 공고를 붙여넣으면 여기에 모여요";
  document.getElementById("liClearBtn").hidden = !li.length;
  const box = document.getElementById("liNoJd"); box.replaceChildren();
  if(!noJd.length) return;
  const d = document.createElement("details");
  const sm = document.createElement("summary"); sm.className = "sub";
  sm.textContent = "본문이 없어 매칭 못 한 공고 " + noJd.length + "건 · 링크드인에서 공고를 눌러 상세가 열린 상태로 다시 붙여넣으면 매칭돼요";
  d.append(sm);
  const ul = document.createElement("ul"); ul.className = "rd-jobs";
  noJd.forEach(x => {
    const it = document.createElement("li"); it.className = "rd-job";
    const co = document.createElement("div"); co.className = "rd-co"; co.textContent = x.company;
    const main = document.createElement("div"); main.className = "rd-main";
    const a = extLink(safeUrl(x.url) || "https://www.linkedin.com/jobs/search/?keywords=" + encodeURIComponent(x.company + " " + x.title), x.title, "rd-t");
    const meta = document.createElement("div"); meta.className = "rd-meta"; meta.textContent = [x.loc, "저장 " + x.at].filter(Boolean).join(" · ");
    main.append(a, meta); it.append(co, main, document.createElement("span")); ul.append(it);
  });
  d.append(ul); box.append(d);
}

/* 소민 계정인데 아직 경험 키워드가 없으면, 미리 뽑아 둔 키워드 개수(data/owner-match.json)로 채운다.
   이 파일에는 키워드 이름과 개수만 있고 경험 원문은 없다. */
let ownerSeedTried = false;
async function seedOwnerMatch(){
  if(ownerSeedTried || !IS_OWNER || db.match) return;
  ownerSeedTried = true;
  try{
    const r = await fetch("data/owner-match.json?t=" + Date.now());
    if(!r.ok) return;
    const o = await r.json();
    db.match = {counts: o.counts, n: o.n, at: o.at, on: [], off: [], seeded: true};
    save(); renderMatch();
  }catch(e){}
}

function renderMatch(){
  if(!mtData) return;
  if(!db.match && IS_OWNER){ seedOwnerMatch(); }
  renderLinkedin();
  const m = db.match, mine = mtMine();
  document.getElementById("mtMeStat").textContent = m
    ? "경험 " + m.n + "개에서 뽑음 · " + m.at + " · 내 키워드 " + mine.size + "개" + (m.seeded ? " · 미리 넣어 둔 경험정리 기준" : "")
    : "아직 키워드가 없어요. 아래 세 방법 중 하나로 경험을 넣어 주세요.";
  /* 키워드가 없을 때만 입력창과 설정을 펼쳐 둔다(직접 열었으면 그대로 둔다) */
  if(!m){ document.getElementById("mtEditor").hidden = false; document.getElementById("mtSettings").open = true; }
  else if(!mtEditing) document.getElementById("mtEditor").hidden = true;
  { const ess = Object.values(db.apps || {}).reduce((n, a) => n + (a.essays || []).filter(e => (e.a || "").trim().length > 40).length, 0);
    const master = (db.arc.cov || []).filter(q => (q.a || "").trim().length > 40).length;
    const docs = ["res", "pf"].filter(f => typeof db.arc[f] === "string" && db.arc[f].trim()).length, cards = (db.arc.exp || []).length;
    document.getElementById("mtAutoStat").textContent = "지원별 자소서 " + ess + "문항 · 마스터 자소서 " + master + "문항 · 이력서·포트폴리오 " + docs + "개 · 경험 카드 " + cards + "개"; }
  document.getElementById("mtSetSum").textContent = (m ? "내 경험 키워드 " + mine.size + "개" : "내 경험 키워드 없음") +
    " · 링크드인 저장 " + (db.linkedin || []).length + "건";

  document.getElementById("mtRule").textContent = m
    ? "경험 " + mtThreshold() + "개 이상에서 나온 키워드만 ‘내 것’으로 쳐요(숫자는 나온 경험 수). 칩을 눌러 켜고 끌 수 있어요." : "";
  const chips = document.getElementById("mtChips"); chips.replaceChildren();
  if(m){
    const th = mtThreshold();
    Object.entries(m.counts).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
      const b = document.createElement("button"); b.type = "button";
      b.textContent = k + " " + n;
      b.setAttribute("aria-pressed", mine.has(k));
      b.onclick = () => {
        const on = mine.has(k);
        m.on = m.on.filter(x => x !== k); m.off = m.off.filter(x => x !== k);
        if(on && n >= th) m.off.push(k);
        if(!on && n < th) m.on.push(k);
        save(); renderMatch();
      };
      chips.append(b);
    });
  }

  const rows = [];
  if(m) for(const j of mtData.jobs.concat(liJobs())){
    const entries = Object.entries(j.w);
    const tot = entries.reduce((s, [, w]) => s + w, 0);
    const hit = entries.reduce((s, [k, w]) => s + (mine.has(k) ? w : 0), 0);
    /* 키워드가 몇 개 안 되는 짧은 JD가 쉽게 100%가 되지 않도록, 겹치지 않은 키워드 2개 분량을 기본으로 깔고 계산한다 */
    const pct = Math.round(hit / (tot + 2) * 100);
    const tier = MT_TIERS.find(t => pct >= t[1]);
    if(tier) rows.push({j, pct, tier, got: entries.filter(([k]) => mine.has(k)).map(([k]) => k), miss: entries.filter(([k]) => !mine.has(k)).map(([k]) => k)});
  }
  rows.sort((a, b) => b.pct - a.pct);
  /* 같은 공고가 여러 경로(주니어 공고판·기업 채용 등)로 들어오면 한 번만, 마감 지난 공고는 빼고 지금 떠 있는 것만 */
  const today = iso(new Date()), seenT = new Set();
  const live = rows.filter(r => {
    if(r.j.end && r.j.end < today) return false;
    const k = coKey(r.j.company) + "|" + r.j.title.replace(/\s/g, "").toLowerCase();
    if(seenT.has(k)) return false;
    seenT.add(k); r.role = mtRoleOf(r.j.title); return true;
  });
  /* 연차·회사 묶음으로 먼저 거른다(아래 회사·직무 선택지는 거른 결과 기준) */
  const typeOf0 = j => j.type || ((j.src === "board" && (allJobs().find(x => x.id === j.id) || {}).type) || "");
  live.forEach(r => { r.yr = r.j.years === undefined ? null : r.j.years; r.grp = mtGrpOf(r.j, typeOf0(r.j)); });
  const yrTest = (MT_YRS.find(x => x[0] === mtYr) || MT_YRS[3])[2];
  { const yc = document.getElementById("mtYrChips"); yc.replaceChildren();
    MT_YRS.forEach(([k, l, t]) => { const b = document.createElement("button"); b.type = "button"; b.textContent = l + " " + live.filter(r => t(r.yr)).length;
      b.setAttribute("aria-pressed", mtYr === k); b.onclick = () => { mtYr = k; renderMatch(); }; yc.append(b); }); }
  const byYr = live.filter(r => yrTest(r.yr));
  { const gc = document.getElementById("mtGrpChips"); gc.replaceChildren();
    [["", "모든 회사"]].concat(MT_GRPS.map(g => [g[0], g[0]])).forEach(([k, l]) => {
      const n = byYr.filter(r => !k || r.grp === k).length;   // 0건이어도 묶음은 늘 보이게(예: 야놀두센 공고가 아직 없을 때)
      const b = document.createElement("button"); b.type = "button"; b.textContent = l + " " + n;
      b.setAttribute("aria-pressed", mtGrp === k); b.onclick = () => { mtGrp = k; mtCo = ""; renderMatch(); }; gc.append(b); }); }
  live.splice(0, live.length, ...byYr.filter(r => !mtGrp || r.grp === mtGrp));
  /* 회사·직무로 골라 보기 — 선택지는 지금 떠 있는 공고 기준 */
  const coCount = {};
  live.filter(r => !mtRole || r.role === mtRole).forEach(r => { coCount[r.j.company] = (coCount[r.j.company] || 0) + 1; });
  if(mtCo && !coCount[mtCo]) mtCo = "";
  const cs = document.getElementById("mtCo"); cs.replaceChildren();
  const all = document.createElement("option"); all.value = ""; all.textContent = "전체 회사 (" + Object.keys(coCount).length + "곳)"; cs.append(all);
  Object.entries(coCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).forEach(([c, n]) => {
    const o = document.createElement("option"); o.value = c; o.textContent = c + " · " + n; o.selected = c === mtCo; cs.append(o);
  });
  cs.onchange = () => { mtCo = cs.value; renderMatch(); };
  const roleCount = {};
  live.filter(r => !mtCo || r.j.company === mtCo).forEach(r => { roleCount[r.role] = (roleCount[r.role] || 0) + 1; });
  if(mtRole && !roleCount[mtRole]) mtRole = "";
  const rc = document.getElementById("mtRoleChips"); rc.replaceChildren();
  [["", "모든 직무"]].concat(MT_ROLES.map(x => [x[0], x[0]]), [["기타", "기타"]]).forEach(([k, l]) => {
    const n = k ? roleCount[k] || 0 : Object.values(roleCount).reduce((x, y) => x + y, 0);
    if(k && !n) return;
    const b = document.createElement("button"); b.type = "button"; b.textContent = l + " " + n;
    b.setAttribute("aria-pressed", mtRole === k);
    b.onclick = () => { mtRole = k; renderMatch(); };
    rc.append(b);
  });
  /* 운적 궁합(소민 전용) — 정렬에도 쓴다 */
  const typeOf = j => { const b = j.src === "board" && allJobs().find(x => x.id === j.id); return b ? b.type : ""; };
  live.forEach(r => { r.type = typeOf(r.j); const u = unScore({company: r.j.company, title: r.j.title, kw: r.j.w, type: r.type}); r.un = u ? u.total : 0; });
  const sortBox = document.getElementById("mtSort");
  sortBox.hidden = false;
  sortBox.replaceChildren();
  [["pct", "매칭률순"], ["new", "새로 뜬 순"]].concat(privOn() ? [["un", "운 궁합순"]] : []).forEach(([k, l]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.setAttribute("aria-pressed", mtSortBy === k);
    b.onclick = () => { mtSortBy = k; renderMatch(); }; sortBox.append(b);
  });
  if(mtSortBy === "un" && privOn()) live.sort((a, b) => b.un - a.un || b.pct - a.pct);
  if(mtSortBy === "new"){ const sk = r => (postedInfo(r.j) || {}).since || ""; live.sort((a, b) => sk(b).localeCompare(sk(a)) || b.pct - a.pct); }
  rows.length = 0;
  live.filter(r => (!mtCo || r.j.company === mtCo) && (!mtRole || r.role === mtRole)).forEach(r => rows.push(r));

  const tc = document.getElementById("mtTierChips"); tc.replaceChildren();
  [["", "전체", rows.length]].concat(MT_TIERS.map(t => [t[0], t[0], rows.filter(r => r.tier[0] === t[0]).length])).forEach(([k, l, n]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = l + " " + n;
    b.setAttribute("aria-pressed", mtTier === k);
    b.onclick = () => { mtTier = k; renderMatch(); };
    tc.append(b);
  });

  renderGcBox();
  const out = document.getElementById("mtOut"); out.replaceChildren();
  if(!m){ return; }
  if(!rows.length){
    const e = document.createElement("p"); e.className = "rd-empty";
    e.textContent = (mtCo || mtRole || mtGrp || mtYr) ? "고른 연차·회사·직무에 맞는 공고가 없어요. 위에서 ‘연차 전체’나 ‘모든 회사’로 바꿔 보세요."
      : "50% 넘게 겹치는 공고가 아직 없어요. 키워드 칩을 더 켜 보거나 경험 원문을 보강해 보세요."; out.append(e); return;
  }
  /* 매칭률순은 등급별로 묶고, 새로 뜬 순·운 궁합순은 한 줄로 쭉(등급은 각 행 오른쪽에) */
  const flat = mtSortBy !== "pct";
  const groups = flat ? [[null, rows.filter(r => !mtTier || r.tier[0] === mtTier)]]
    : MT_TIERS.filter(t => !mtTier || t[0] === mtTier).map(t => [t, rows.filter(r => r.tier[0] === t[0])]);
  groups.forEach(([t, list]) => {
    if(!list.length) return;
    const h = document.createElement("h3"); h.className = "mt-grp";
    if(t){
      const pill = document.createElement("span"); pill.className = "rd-pill " + t[2]; pill.textContent = t[0];
      const sm = document.createElement("small"); sm.textContent = "매칭 " + t[1] + "% 이상 · " + list.length + "건";
      h.append(pill, sm);
    } else {
      const sm = document.createElement("small"); sm.textContent = (mtSortBy === "new" ? "최근에 올라온 순" : "운 궁합 높은 순") + " · " + list.length + "건"; h.append(sm);
    }
    out.append(h);
    const ul = document.createElement("ul"); ul.className = "rd-jobs";
    list.forEach(r => {
      const li = document.createElement("li"); li.className = "rd-job";
      const co = document.createElement("div"); co.className = "rd-co"; co.textContent = r.j.company;
      const main = document.createElement("div"); main.className = "rd-main";
      const a = extLink(r.j.url, r.j.title, "rd-t");
      const meta = document.createElement("div"); meta.className = "rd-meta";
      meta.append(MT_SRC[r.j.src] || r.j.src);
      { const y = document.createElement("span"); y.className = "mt-yr" + (r.yr !== null && r.yr >= 3 ? " sr" : ""); y.textContent = mtYrLabel(r.yr); meta.append(" · "); meta.append(y); }
      { const t = postedTag(r.j); if(t){ meta.append(" · "); meta.append(t); } }
      if(r.j.end){ meta.append(" · 마감 " + r.j.end); const h = submitHint(r.j); if(h){ meta.append(" · "); meta.append(h); } }
      const tags = document.createElement("div"); tags.className = "rd-tags";
      r.got.forEach(k => { const s = document.createElement("span"); s.className = "rd-tag role"; s.textContent = k; tags.append(s); });
      r.miss.forEach(k => { const s = document.createElement("span"); s.className = "rd-tag mt-tag-miss"; s.textContent = k; s.title = "내 경험에 없는 키워드"; tags.append(s); });
      main.append(a, meta, tags);
      if(r.un){ const uc = unChip({company: r.j.company, title: r.j.title, kw: r.j.w, type: r.type}); if(uc){ meta.append(" · "); meta.append(uc); } }
      const pct = document.createElement("div"); pct.className = "mt-pct"; pct.textContent = r.pct + "%";
      const sm2 = document.createElement("small"); sm2.textContent = flat ? r.tier[0] : "매칭"; pct.append(sm2);
      li.append(co, main, pct); ul.append(li);
    });
    out.append(ul);
  });
  document.getElementById("mtFoot").textContent = "공고 키워드 기준일 " + mtData.updated +
    " · 연차는 공고 본문·채용 사이트의 경력 조건에서 읽었어요(표시 없으면 ‘무관·미표기’). 본문이 이미지뿐인 공고는 빠져 있어요. 키워드가 적은 짧은 JD는 매칭률을 조금 낮춰 계산해요. 초록 칩은 겹치는 키워드, 줄 그은 칩은 내 경험에 없는 키워드예요.";
}
document.getElementById("liEditBtn").onclick = () => { document.getElementById("liEditor").hidden = false; document.getElementById("liText").focus(); };
document.getElementById("liCancelBtn").onclick = () => { document.getElementById("liEditor").hidden = true; };
document.getElementById("liClearBtn").onclick = async () => {
  const n = (db.linkedin || []).length;
  if(!(await confirmDlg({title: "저장한 링크드인 공고 " + n + "건을 모두 지울까요?", body: "되돌릴 수 없어요."}, "모두 지우기", "닫기", {danger: true}))) return;
  db.linkedin = []; save(); renderMatch();
};
document.getElementById("liRunBtn").onclick = () => {
  if(!mtDictG){ toast("매칭 데이터를 아직 불러오고 있어요"); return; }
  const r = liImport(document.getElementById("liText").value);
  document.getElementById("liText").value = "";
  document.getElementById("liEditor").hidden = true;
  renderMatch();
  toast(r.found ? "공고 " + r.found + "건 읽음 · 새로 저장 " + r.added + "건 · 본문 " + r.withJd + "건" : "공고를 찾지 못했어요. 검색 결과 화면 전체를 복사했는지 확인해 주세요");
};
document.getElementById("mtEditBtn").onclick = () => { mtEditing = true; document.getElementById("mtEditor").hidden = false; document.getElementById("mtText").focus(); };
document.getElementById("mtCancelBtn").onclick = () => { mtEditing = false; document.getElementById("mtEditor").hidden = true; };
document.getElementById("mtAutoBtn").onclick = () => {
  if(!mtDict){ toast("매칭 데이터를 아직 불러오고 있어요"); return; }
  const n = mtBuild();
  if(!n){ toast("아직 지원보드에 쓴 자소서·이력서가 없어요. 파일을 올리거나 붙여넣어 주세요"); return; }
  mtEditing = false; document.getElementById("mtEditor").hidden = true;
  renderMatch(); renderArc();
  toast("글 " + n + "개에서 키워드를 뽑았어요");
};
document.getElementById("mtFiles").onchange = async (ev) => {
  const files = [...ev.target.files]; ev.target.value = "";
  if(!files.length) return;
  if(!mtDict){ toast("매칭 데이터를 아직 불러오고 있어요"); return; }
  const stat = document.getElementById("mtFileStat");
  let ok = 0, parts = 0; const bad = [];
  for(const f of files){
    stat.textContent = f.name + " 읽는 중…";
    try{ const t = await fileText(f); const n = t && t.trim().length > 40 ? mtArchiveFile(f.name, t) : 0; if(n){ ok++; parts += n; } else bad.push(f.name + "(글자 없음 — 스캔 이미지일 수 있어요)"); }
    catch(e){ bad.push(f.name); }
  }
  stat.textContent = "";
  if(!ok){ toast("파일을 읽지 못했어요: " + bad.join(", ")); return; }
  const n = mtBuild();
  mtEditing = false; document.getElementById("mtEditor").hidden = true;
  renderMatch(); renderArc();
  toast("파일 " + ok + "개(" + parts + "조각) 보관 · 글 " + n + "개에서 키워드를 뽑았어요" + (bad.length ? " · 못 읽음: " + bad.join(", ") : ""));
};
document.getElementById("mtRunBtn").onclick = () => {
  if(!mtDict){ toast("매칭 데이터를 아직 불러오고 있어요"); return; }
  const t = document.getElementById("mtText").value;
  if(!t.trim() && !(db.arc.exp || []).length){ toast("경험정리를 붙여넣어 주세요"); return; }
  const saved = t.trim() ? mtArchive(t) : 0;
  mtBuild();
  document.getElementById("mtText").value = "";
  mtEditing = false;
  document.getElementById("mtEditor").hidden = true;
  renderMatch(); renderArc();
  toast(saved ? "경험 " + saved + "개를 아카이브에 보관하고 키워드를 저장했어요" : "경험 키워드를 다시 뽑았어요");
};

/* ---------- 주소 해시로 보던 화면 기억(B18) ----------
   쓰는 형식은 UX 04 B-1-8 '지금 탭' 열(#/jobs · #/mine · #/schedule/month/2026-10 · #/schedule/week/2026-10-12 · #/docs/exp ·
   #/jobs/radar · #/jobs/match · #/jobs/sales · #/jobs/mkt · #/today) — 탭 개편 뒤에도 주소가 그대로 유효하다.
   짧은 형식(#/list · #/cal · #/plan · #/arc · #/radar · #/match · #/sales · #/mkt)도 읽는다. ?v= · ?sales=1 같은 검색 파라미터는 건드리지 않는다. */
const ym = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
function routeOf(b){
  const v = b.dataset.v;
  if(v === "list") return "#/jobs";
  if(v === "sales") return "#/jobs/" + (b.dataset.mode || "sales");
  if(v === "radar" || v === "match") return "#/jobs/" + v;
  if(v === "cal") return "#/schedule/month/" + ym(curMonth);
  if(v === "plan") return "#/schedule/week/" + iso(weekStart);
  if(v === "arc") return "#/docs/" + arcTab;
  return "#/" + v;   /* mine · today */
}
function parseRoute(h){
  const p = String(h || "").replace(/^#\/?/, "").split(/[/?]/).filter(Boolean);
  if(!p.length) return null;
  const [a, b, c] = p;
  if(a === "jobs" || a === "list") return !b ? {v: "list"} : b === "sales" || b === "mkt" ? {v: "sales", mode: b} : b === "radar" || b === "match" ? {v: b} : null;
  if(a === "sales" || a === "mkt") return {v: "sales", mode: a};
  if(["mine", "radar", "match", "today"].includes(a)) return {v: a};
  if(a === "cal" || (a === "schedule" && b === "month")) return {v: "cal", arg: a === "cal" ? b : c};
  if(a === "plan" || (a === "schedule" && b === "week")) return {v: "plan", arg: a === "plan" ? b : c};
  if(a === "arc" || a === "docs") return {v: "arc", arg: b};
  return null;
}
let routing = false;
function setHash(h, push){
  if(!h || location.hash === h) return;
  const url = location.pathname + location.search + h;
  try{ if(push) history.pushState(null, "", url); else history.replaceState(null, "", url); }catch(e){}
}
const curTab = () => document.querySelector('nav.tabs button[aria-selected="true"]');
/* 주소에 맞는 화면을 연다. 없는 화면·꺼진 탭이면 기본 화면으로 보내고 주소도 고친다 */
function applyRoute(h){
  const r = parseRoute(h);
  const btn = r && document.querySelector('nav.tabs button[data-v="' + r.v + '"]' + (r.mode ? '[data-mode="' + r.mode + '"]' : ""));
  if(!btn || btn.hidden){ routing = true; goTab(defaultTab()); routing = false; setHash(routeOf(curTab()), false); return; }
  if(r.v === "cal" && /^\d{4}-\d{2}$/.test(r.arg || "")){ const [y, m] = r.arg.split("-").map(Number); curMonth = new Date(y, m - 1, 1); }
  if(r.v === "plan" && /^\d{4}-\d{2}-\d{2}$/.test(r.arg || "")) weekStart = mondayOf(parse(r.arg));
  if(r.v === "arc" && ["exp", "cov", "res", "pf"].includes(r.arg)){ arcTab = r.arg; renderArc(); }
  routing = true; btn.click(); routing = false;
  if(r.v === "cal") renderCal();
  if(r.v === "plan") renderWeek();
  setHash(routeOf(btn), false);
}
function defaultTab(){ return VARIANT === "b1" ? "today" : "list"; }
/* 실험 변형 화면 켜기 — 파라미터가 없으면(a) 아무것도 하지 않는다 */
function applyVariant(){
  if(VARIANT === "b1"){
    document.querySelector('nav.tabs button[data-v="today"]').hidden = false;
    const rail = document.querySelector("#appHeader .rail"); rail.hidden = true; rail.style.display = "none";   /* '오늘'이 같은 정보를 보여 준다 */
  }
  if(VARIANT === "b2") document.getElementById("mineDesc").textContent = "담은 공고가 모여요. 서류를 냈으면 ‘제출했어요’를 눌러 주세요.";
}
window.addEventListener("popstate", () => { if(dbReady) applyRoute(location.hash); });
document.querySelectorAll("nav.tabs button").forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll("nav.tabs button").forEach(x => { x.setAttribute("aria-selected", x === b); x.tabIndex = x === b ? 0 : -1; });
    document.querySelectorAll(".view").forEach(v => v.hidden = (v.id !== "v-" + b.dataset.v));
    b.scrollIntoView({block: "nearest", inline: "center", behavior: "smooth"}); /* 모바일에서 뒤쪽 탭이 화면 밖에 숨지 않게 */
    if(b.dataset.v === "radar") loadRadar();
    if(b.dataset.v === "match") loadMatch();
    if(b.dataset.v === "sales"){
      if(slMode !== (b.dataset.mode || "sales")){ slMode = b.dataset.mode || "sales"; slSrc = ""; slKind = ""; }
      (slData ? Promise.resolve() : loadSales()).then(renderSales);
    }
    if(!routing) setHash(routeOf(b), true);   /* 탭 바꾸기는 뒤로 가기로 돌아올 수 있게 */
    if(toastNav) closeToast();                 /* 이 화면에 대한 안내(예상 일정 옮김)는 다른 화면으로 가면 닫는다 */
  };
});
/* 탭 줄 키보드: ← → 로 옆 탭, Home·End로 처음·끝 */
document.querySelector("nav.tabs").addEventListener("keydown", e => {
  if(!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = [...document.querySelectorAll("nav.tabs button")].filter(x => !x.hidden);
  const i = tabs.indexOf(document.activeElement); if(i < 0) return;
  const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); tabs[n].focus(); tabs[n].click();
});
document.querySelectorAll("#arcTabs button").forEach(function(b){
  b.onclick = () => { arcTab = b.dataset.a; renderArc(); setHash(routeOf(curTab()), false); };
});
document.getElementById("q").oninput = function(){
  query = this.value;
  if(query.trim()) loadArchive();   /* 지난 공고까지 뒤져야 검색이 쓸모 있다 */
  renderList();
};
document.querySelectorAll("th.sortable").forEach(function(th){
  th.onclick = () => { const k = th.dataset.s;
    sortDir = (sortKey === k) ? -sortDir : 1; sortKey = k; renderList(); };
});
document.getElementById("mineBtn").onclick = function(){
  mineOnly = !mineOnly;
  this.setAttribute("aria-pressed", mineOnly);
  this.textContent = mineOnly ? "전체 보기" : "내 지원만";
  renderCal(); renderWeek();
};
/* 달·주 이동은 주소만 바꾼다(뒤로 가기 기록을 쌓지 않음) */
const syncHash = () => { const b = curTab(); if(b) setHash(routeOf(b), false); };
document.getElementById("mPrev").onclick = () => { curMonth.setMonth(curMonth.getMonth()-1); renderCal(); syncHash(); };
document.getElementById("mNext").onclick = () => { curMonth.setMonth(curMonth.getMonth()+1); renderCal(); syncHash(); };
document.getElementById("wPrev").onclick = () => { weekStart.setDate(weekStart.getDate()-7); renderWeek(); syncHash(); };
document.getElementById("wNext").onclick = () => { weekStart.setDate(weekStart.getDate()+7); renderWeek(); syncHash(); };
document.getElementById("wToday").onclick = () => { weekStart = mondayOf(TODAY); renderWeek(); syncHash(); };

/* ---------- 테마 ---------- */
const MODES = [["system","시스템 따라"],["light","밝게"],["dark","어둡게"]];
const ACCENTS = [["lime","바이올렛","#6B5CE7"],["sky","더스티 블루","#4C7496"],["lavender","라벤더그레이","#776A91"],["peach","클레이","#98644D"],["rose","로즈베이지","#95636B"],["mustard","세이지","#53795B"]];
function applyTheme(){
  const t = db.profile.theme || (db.profile.theme = {mode:"system", accent:"lime"});
  const r = document.documentElement;
  if(t.mode === "system") r.removeAttribute("data-theme");
  else r.setAttribute("data-theme", t.mode);
  r.setAttribute("data-accent", t.accent || "lime");
}
function openTheme(){
  const t = db.profile.theme;
  const mb = document.getElementById("modeChips"); mb.innerHTML = "";
  MODES.forEach(function(m){
    const b = document.createElement("button"); b.type = "button"; b.textContent = m[1];
    b.setAttribute("aria-pressed", t.mode === m[0]);
    b.onclick = () => { t.mode = m[0]; save(); applyTheme(); openTheme(); };
    mb.appendChild(b);
  });
  const ab = document.getElementById("accentChips"); ab.innerHTML = "";
  ACCENTS.forEach(function(c){
    const b = document.createElement("button"); b.type = "button";
    b.setAttribute("aria-pressed", (t.accent || "lime") === c[0]);
    b.setAttribute("aria-label", c[1] + " 테마");
    const sw = document.createElement("i"); sw.style.background = c[2];
    const nm = document.createElement("span"); nm.textContent = c[1];
    b.append(sw, nm);
    b.onclick = () => { t.accent = c[0]; save(); applyTheme(); openTheme(); };
    ab.appendChild(b);
  });
  document.getElementById("themeDlg").showModal();
}
document.getElementById("themeBtn").onclick = openTheme;
document.getElementById("themeDone").onclick = () => document.getElementById("themeDlg").close();
applyTheme();

/* 도움말 패널 */
const helpEl = document.getElementById("help"), helpBtn = document.getElementById("helpBtn");
function toggleHelp(on){
  helpEl.hidden = !on;
  helpBtn.setAttribute("aria-expanded", on);
  helpBtn.textContent = on ? "×" : "?";
}
helpBtn.onclick = () => toggleHelp(helpEl.hidden);
/* ⋯ 메뉴의 '도움말' — 휴대폰에서는 떠 있는 '?' 버튼 대신 이것을 쓴다(UX G-12) */
document.getElementById("helpMenuBtn").onclick = e => {
  e.stopPropagation();   /* 같은 클릭이 '바깥 클릭'으로 읽혀 도움말이 바로 닫히지 않게 */
  const pop = document.getElementById("menuPop"); pop.hidden = true; document.getElementById("menuBtn").setAttribute("aria-expanded", "false");
  toggleHelp(true); document.getElementById("helpClose").focus();
};
document.getElementById("helpClose").onclick = () => toggleHelp(false);
document.addEventListener("keydown", e => { if(e.key === "Escape" && !helpEl.hidden) toggleHelp(false); });
document.addEventListener("click", function(e){
  if(!helpEl.hidden && !helpEl.contains(e.target) && e.target !== helpBtn) toggleHelp(false);
});

/* 토스트(UX 04 B-4-b). act = {label, run}이면 버튼(되돌리기 · 내 지원 보기)을 붙이고 6초 동안 띄운다.
   새 토스트가 뜨면 앞 토스트의 버튼은 사라진다(되돌리기 확정). 마우스·포커스가 있으면 시간을 멈춘다. */
let tt, toastHold = false, toastMs = 0;
let toastNav = false;   /* 다른 화면으로 가면 닫을 토스트인가 */
function closeToast(){ const t = document.getElementById("toast"); clearTimeout(tt); t.classList.remove("on"); toastNav = false; }
function toast(m, act, opt){
  opt = opt || {};
  toastNav = !!opt.navClose;
  const t = document.getElementById("toast");
  const msg = document.createElement("span"); msg.className = "toast-msg"; msg.textContent = m;
  t.replaceChildren(msg);
  if(act){
    const b = document.createElement("button"); b.type = "button"; b.className = "toast-act"; b.textContent = act.label;
    b.onclick = () => { clearTimeout(tt); t.classList.remove("on"); t.replaceChildren(); act.run(); };
    t.append(b);
  }
  t.classList.add("on");
  toastMs = opt.ms || (act ? 6000 : Math.min(7000, 3000 + Math.floor(m.length / 20) * 1000));
  clearTimeout(tt); if(!toastHold) tt = setTimeout(() => t.classList.remove("on"), toastMs);
}
(function(){
  const t = document.getElementById("toast");
  const hold = () => { toastHold = true; clearTimeout(tt); };
  const go = () => { toastHold = false; clearTimeout(tt); if(t.classList.contains("on")) tt = setTimeout(() => t.classList.remove("on"), 2000); };
  t.addEventListener("mouseenter", hold); t.addEventListener("mouseleave", go);
  t.addEventListener("focusin", hold); t.addEventListener("focusout", go);
})();
/* 탭 열기(코드에서) — 탭 버튼을 누른 것과 같다 */
function goTab(v, mode){
  const b = document.querySelector('nav.tabs button[data-v="' + v + '"]' + (mode ? '[data-mode="' + mode + '"]' : ""));
  if(b && !b.hidden) b.click();
}
const showMine = {label: "내 지원 보기", run: () => { if(jobDlg.open) jobDlg.close(); goTab("mine"); }};
/* 담기 · 빼기(B25) — 화면은 그대로 두고 토스트로 알린다. 빼기는 확인 없이 바로, [되돌리기]로 원래대로 */
function applyJob(j){
  const a = app(j.id);
  const fresh = !a.applied;
  a.applied = true; a.skip = false; a.at = iso(TODAY); keepSnap(j, a);
  if(VARIANT === "b2" && fresh && a.doc === "대기"){ a.sent = false; delete a.sentAt; }   /* 실험 2 B: 담으면 '제출 전' */
  save(); renderAll();
  toast(j.end || a.myEnd ? j.company + " · 내 지원에 담았어요" : j.company + " · 내 지원에 담았어요. 상시 공고라 마감일을 직접 넣어 주세요", showMine);
}
function unapplyJob(j){
  const a = app(j.id), prev = {applied: a.applied, skip: a.skip};
  a.applied = false; a.skip = false;
  save(); renderAll();
  toast(j.company + " · 내 지원에서 뺐어요", {label: "되돌리기", run: () => { const b = app(j.id); b.applied = prev.applied; b.skip = prev.skip; save(); renderAll(); if(jobDlg.open && jdId === j.id) openJob(j.id); toast("되돌렸어요"); }});
}
/* 확인 창(UX 04 B-4-c): 되돌릴 수 없는 일과 한꺼번에 바꾸는 일에만 쓴다.
   msg는 글자 또는 {title, body}. opt.danger면 첫 포커스를 '닫기'에, opt.extra면 보조 버튼을 하나 더.
   돌려주는 값: true(주 버튼) · false(닫기·Esc·바깥) · "extra"(보조 버튼) */
function confirmDlg(msg, yes, no, opt){
  opt = opt || {};
  const d = document.getElementById("confirmDlg");
  const m = typeof msg === "string" ? {title: msg} : msg;
  const y = document.getElementById("confirmYes"), n = document.getElementById("confirmNo"), x = document.getElementById("confirmExtra");
  const opener = document.activeElement;
  d.querySelector(".confirm-msg").textContent = m.title;
  const body = d.querySelector(".confirm-body"); body.textContent = m.body || ""; body.hidden = !m.body;
  y.textContent = yes; n.textContent = no || "닫기";
  y.classList.toggle("is-danger", !!opt.danger);
  x.hidden = !opt.extra; x.textContent = opt.extra || "";
  if(d.open) d.close();
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if(done) return; done = true;
      y.onclick = n.onclick = x.onclick = d.onclick = d.oncancel = d.onclose = null;
      if(d.open) d.close();
      if(opener && opener.focus && document.contains(opener)) opener.focus();
      resolve(v);
    };
    /* opt.noValue: '닫기' 버튼만 따로 알고 싶을 때(Esc·바깥은 언제나 false) */
    y.onclick = () => finish(true); n.onclick = () => finish(opt.noValue !== undefined ? opt.noValue : false); x.onclick = () => finish("extra");
    d.oncancel = e => { e.preventDefault(); finish(false); };
    d.onclose = () => finish(false);
    d.onclick = e => {
      if(e.target !== d) return;
      const r = d.getBoundingClientRect();
      if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish(false);
    };
    d.showModal();
    (opt.danger ? n : y).focus();
  });
}
/* 화면 안 입력칸(UX 04 B-4-a): Enter 저장 · Esc 닫기 · 빈 값이면 '추가' 비활성.
   inlineSlot(kind, id, trigger, o)는 평소엔 트리거 버튼을, 열려 있으면 입력칸을 돌려준다.
   o = {label, placeholder, value, ok, help, keep, onSubmit(v), onClose}. keep이면 저장 뒤에도 열린 채 다음 입력을 받는다.
   저장하면 화면을 다시 그리므로, 열려 있다는 상태는 INL에 둔다. */
let INL = null;   /* {kind, id} — 지금 열려 있는 입력칸 */
const inlOpen = (kind, id) => !!INL && INL.kind === kind && INL.id === id;
function inlineSlot(kind, id, trigger, o){
  if(inlOpen(kind, id)) return inlineAdd(kind, id, trigger, o);
  trigger.addEventListener("click", () => {
    INL = {kind, id};
    trigger.replaceWith(inlineAdd(kind, id, trigger, o));
    focusInline();
  });
  return trigger;
}
function inlineAdd(kind, id, trigger, o){
  const f = document.createElement("form"); f.className = "inline-add"; f.dataset.inl = kind;
  const i = document.createElement("input"); i.type = "text"; i.value = o.value || ""; i.placeholder = o.placeholder || "";
  i.setAttribute("aria-label", o.label); i.autocomplete = "off"; i.enterKeyHint = "done"; i.maxLength = 120;
  const ok = document.createElement("button"); ok.type = "submit"; ok.className = "primary"; ok.textContent = o.ok || "추가";
  const close = document.createElement("button"); close.type = "button"; close.className = "ghost"; close.textContent = "닫기";
  const sync = () => { ok.disabled = !i.value.trim(); };
  i.oninput = sync; sync();
  /* 닫으면 그 자리에 트리거를 되돌린다(다시 그리지 않아서 옆 버튼을 누른 것이 사라지지 않는다) */
  const shut = focusBack => {
    if(inlOpen(kind, id)) INL = null;
    if(!f.isConnected) return;
    if(trigger){ f.replaceWith(trigger); if(focusBack) trigger.focus(); } else f.remove();
    if(o.onClose) o.onClose();
  };
  f.onsubmit = e => {
    e.preventDefault();
    const v = i.value.trim(); if(!v) return;
    if(!o.keep) INL = null;
    o.onSubmit(v);
    focusInline();
  };
  i.onkeydown = e => { if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); shut(true); } };
  close.onclick = () => shut(true);
  /* 바깥을 눌러 빠져나가면: 적은 글이 없으면 닫고, 있으면 그대로 둔다 */
  f.addEventListener("focusout", () => setTimeout(() => {
    if(f.isConnected && !f.contains(document.activeElement) && !i.value.trim()) shut(false);
  }, 0));
  f.append(i, ok, close);
  if(o.help){ const h = document.createElement("p"); h.className = "sub inline-help"; h.textContent = o.help; f.append(h); }
  return f;
}
/* 다시 그린 뒤 열려 있던 입력칸에 포커스(글자는 끝으로) */
function focusInline(){
  if(!INL) return;
  const i = document.querySelector('form.inline-add[data-inl="' + INL.kind + '"] input');
  if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function renderAll(){ renderRail(); renderList(); renderMine(); renderCal(); renderWeek(); renderArc(); if(VARIANT === "b1") renderToday(); }

/* ---------- '오늘' 화면(실험 1 변형 B, ?v=b1에서만 — 03 문서 2.2 · UX 04 B-2 축소판) ----------
   새 저장 필드는 만들지 않는다. 기존 판정(statusOf · deadline · postedInfo · scoped)과 같은 함수만 쓴다. */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
function todayBlock(key, title, count, more){
  const sec = document.createElement("section"); sec.className = "ddb today-block"; sec.setAttribute("aria-labelledby", "tb-" + key);
  const h = document.createElement("div"); h.className = "ddb-h";
  const t = document.createElement("h3"); t.id = "tb-" + key; t.textContent = title;
  const s = document.createElement("span"); s.className = "sub"; s.textContent = count ? count + "건" : "";
  h.append(t, s);
  if(more){ const sp = document.createElement("span"); sp.className = "hspace"; const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.textContent = more.label; b.onclick = more.run; h.append(sp, b); }
  sec.append(h);
  return sec;
}
const emptyLine = text => { const p = document.createElement("p"); p.className = "sub"; p.textContent = text; return p; };
function renderToday(){
  const body = document.getElementById("todayBody"); if(!body) return;
  body.replaceChildren();
  document.getElementById("todayDate").textContent = (TODAY.getMonth() + 1) + "월 " + TODAY.getDate() + "일 " + DOW[TODAY.getDay()] + "요일";
  const mine = myJobs();
  /* 1. 내 마감: 서류 결과 대기인 담은 공고의 서류 마감과 날짜 있는 전형, 오늘부터 14일 */
  const dues = [];
  mine.forEach(j => {
    const a = appOf(j.id), dl = deadline(j);
    if(dl && a.doc === "대기" && dleft(dl) >= 0 && dleft(dl) <= 14) dues.push({date: dl, what: "서류 마감", j, time: deadlineTime(j), est: estDeadline(j, a)});
    a.stages.forEach(s => { if(s.date && s.result !== "불합격" && dleft(s.date) >= 0 && dleft(s.date) <= 14) dues.push({date: s.date, what: s.name, j, time: s.time || "", est: !!s.est}); });
  });
  dues.sort((x, y) => x.date.localeCompare(y.date));
  /* 2. 결과 확인 필요: 표의 '확인 필요'와 같은 판정, 오래된 순 */
  const checks = mine.filter(j => statusOf(appOf(j.id), j) === "확인필요").sort((x, y) => (deadline(x) || "").localeCompare(deadline(y) || ""));
  /* 3. 이번 주 전형(월~일) */
  const mon = mondayOf(TODAY), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const week = [];
  mine.forEach(j => appOf(j.id).stages.forEach(s => { if(s.date && s.date >= iso(mon) && s.date <= iso(sun)) week.push({date: s.date, what: s.name, j, time: s.time || ""}); }));
  week.sort((x, y) => x.date.localeCompare(y.date));
  /* 5. 새로 뜬 공고: 최근 3일 안에 들어온, 내 조건에 맞고 마감 전인 것 */
  const fresh = scoped().filter(j => { const p = postedInfo(j); return p && p.isNew && state(j).k !== "shut" && !appOf(j.id).applied; })
    .sort((x, y) => (x.end || "9999").localeCompare(y.end || "9999"));

  const sum = [[dues.length, "내 일정"], [checks.length, "결과 확인"], [week.length, "이번 주 전형"]].filter(x => x[0]).map(x => x[1] + " " + x[0] + "건");
  document.getElementById("todaySum").textContent = sum.length ? sum.join(" · ") : "오늘 챙길 일정이 없어요.";

  /* 마감과 전형을 함께 보여 주므로 제목은 '내 일정', 건수는 보이는 줄 수(넘치면 전체 수를 함께) */
  const b1 = todayBlock("due", "내 일정", Math.min(dues.length, 5), dues.length > 5 ? {label: "모두 보기", run: () => goTab("mine")} : null);
  if(dues.length > 5) b1.querySelector(".ddb-h .sub").textContent = "5건 · 전체 " + dues.length + "건";
  if(!dues.length) b1.append(emptyLine("앞으로 14일 안에 마감하는 공고가 없어요."));
  else { const list = document.createElement("div"); list.className = "ddb-list";
    dues.slice(0, 5).forEach(r => {
      const row = document.createElement("div"); row.className = ddCls(r.date, r.est); row.append(...ddRow(r));
      row.onclick = () => openJob(r.j.id);
      const url = safeUrl(r.j.url);
      if(url){ const go = document.createElement("a"); go.className = "dd-go"; go.href = url; go.target = "_blank"; go.rel = "noopener"; go.textContent = "원문 ↗"; go.onclick = e => e.stopPropagation(); row.append(go); }
      list.append(row);
    });
    b1.append(list); }

  const b2 = todayBlock("check", "결과 확인 필요", checks.length, checks.length > 5 ? {label: (checks.length - 5) + "건 더 보기", run: () => { tFilter = "확인필요"; goTab("mine"); renderMine(); }} : null);
  if(!checks.length) b2.append(emptyLine("지금 결과를 적을 공고가 없어요."));
  else { const list = document.createElement("div"); list.className = "ddb-list";
    checks.slice(0, 5).forEach(j => {
      const a = appOf(j.id), dl = deadline(j);
      const row = document.createElement("div"); row.className = "dd";
      const co = document.createElement("div"); co.className = "dd-co"; co.textContent = j.company;
      const w = document.createElement("div"); w.className = "dd-w"; w.textContent = dl ? fmt(dl) + " 마감 · " + dday(dl) : "마감일 없음";
      row.append(co, w); row.onclick = () => openJob(j.id);
      const act = document.createElement("div"); act.className = "dd-act";
      const cur = a.doc === "합격" ? a.stages.find(s => s.result !== "합격" && s.result !== "불합격") : null;
      const name = cur ? cur.name : "서류";
      [["합격", name + " 합격"], ["탈락", "탈락"]].forEach(([v, label]) => {
        const b = document.createElement("button"); b.type = "button"; b.className = v === "합격" ? "primary" : "ghost"; b.textContent = label;
        b.setAttribute("aria-label", j.company + " " + (v === "합격" ? name + " 합격" : name + " 탈락") + "으로 기록");
        b.onclick = e => {
          e.stopPropagation();
          const w2 = app(j.id), before = JSON.stringify(w2);
          /* 표 보기의 상태 바꾸기와 같은 함수(setTStatus) — 진행 중인 전형이면 그 전형의 결과로 */
          if(cur && v === "합격") cur.result = "합격"; else setTStatus(w2, v);
          save(); renderAll();
          toast(j.company + " · " + (v === "합격" ? name + " 합격" : name + " 탈락") + "으로 적었어요", {label: "되돌리기", run: () => { db.apps[j.id] = fillApp(JSON.parse(before)); save(); renderAll(); toast("되돌렸어요"); }});
          const next = document.querySelector("#tb-check") ; if(next) next.closest("section").querySelector(".dd-act button, h3").focus();
        };
        act.append(b);
      });
      list.append(row, act);
    });
    b2.append(list); }

  const b3 = todayBlock("week", "이번 주 전형", week.length);
  if(!week.length) b3.append(emptyLine("이번 주 전형 일정이 없어요."));
  else { const list = document.createElement("div"); list.className = "ddb-list";
    week.forEach(r => {
      const d = parse(r.date), row = document.createElement("div"); row.className = "dd" + (dleft(r.date) < 0 ? " past" : "");
      const n = document.createElement("div"); n.className = "dd-n"; n.textContent = (d.getMonth() + 1) + "/" + d.getDate() + " (" + DOW[d.getDay()] + ")";
      const co = document.createElement("div"); co.className = "dd-co"; co.textContent = r.j.company;
      const w = document.createElement("div"); w.className = "dd-w"; w.textContent = r.what + (r.time ? " " + r.time : "");
      row.append(n, co, w); row.onclick = () => openJob(r.j.id); list.append(row);
    });
    b3.append(list); }

  /* 4. 오늘 할 일: 보기·체크만. 적기는 주간 플래너에서 */
  const k = iso(TODAY), todos = db.todos[k] || [];
  const b4 = todayBlock("todo", "오늘 할 일", todos.length, {label: "주간 플래너에서 추가", run: () => goTab("plan")});
  if(!todos.length) b4.append(emptyLine("오늘 할 일이 없어요."));
  else { const list = document.createElement("div"); list.className = "todos";
    todos.forEach((t, idx) => {
      const row = document.createElement("label"); row.className = "todo" + (t.done ? " done" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!t.done; cb.setAttribute("aria-label", t.text);
      cb.onchange = () => { db.todos[k][idx].done = cb.checked; save(); renderToday(); renderWeek(); };
      const sp = document.createElement("span"); sp.textContent = t.text;
      row.append(cb, sp); list.append(row);
    });
    b4.append(list); }

  const b5 = todayBlock("new", "새로 뜬 공고 · 최근 " + NEW_DAYS + "일", fresh.length, fresh.length > 3 ? {label: fresh.length + "건 모두 보기", run: () => { filter = "new"; goTab("list"); renderList(); }} : null);
  if(!fresh.length) b5.append(emptyLine("최근 " + NEW_DAYS + "일 동안 내 조건에 맞는 새 공고가 없어요."));
  else { const list = document.createElement("div"); list.className = "ddb-list";
    fresh.slice(0, 3).forEach(j => {
      const row = document.createElement("div"); row.className = "dd";
      const co = document.createElement("div"); co.className = "dd-co"; co.textContent = j.company;
      const w = document.createElement("div"); w.className = "dd-w"; w.textContent = (j.roles || []).join(", ") || j.title || "직무 정보 없음";
      const d = document.createElement("div"); d.className = "dd-d"; d.textContent = j.end ? fmt(j.end) + " 마감" : "상시";
      row.append(co, w, d); row.onclick = () => openJob(j.id);
      const act = document.createElement("div"); act.className = "dd-act";
      const st = document.createElement("button"); st.type = "button"; const on = appOf(j.id).starred;
      st.textContent = on ? "★" : "☆"; st.setAttribute("aria-pressed", on); st.setAttribute("aria-label", j.company + (on ? " 관심에서 빼기" : " 관심 공고로 찜하기"));
      st.onclick = e => { e.stopPropagation(); const w2 = app(j.id); w2.starred = !w2.starred; if(w2.starred) keepSnap(j, w2); save(); renderAll(); };
      const ap = document.createElement("button"); ap.type = "button"; ap.className = "primary"; ap.textContent = "담기";
      ap.setAttribute("aria-label", j.company + " 내 지원에 담기");
      ap.onclick = e => { e.stopPropagation(); applyJob(j); };
      act.append(st, ap);
      list.append(row, act);
    });
    b5.append(list); }

  body.append(b1, b2, b3, b4, b5);
}

/* ---------- 시작 ---------- */
function setTodayLbl(){
  document.getElementById("todayLbl").textContent =
    TODAY.getFullYear() + "." + String(TODAY.getMonth()+1).padStart(2,"0") + "." + String(TODAY.getDate()).padStart(2,"0");
}
setTodayLbl();
/* 켜 둔 채 자정이 지나면 D-day가 하루씩 틀어지므로, 화면으로 돌아올 때 날짜가 바뀌었으면 다시 센다 */
function refreshToday(){
  const now = new Date(); now.setHours(0,0,0,0);
  if(now.getTime() === TODAY.getTime()) return;
  TODAY.setTime(now.getTime()); setTodayLbl();
  if(dbReady && SEED.length) renderAll();
}
document.addEventListener("visibilitychange", () => { if(!document.hidden) refreshToday(); });
window.addEventListener("focus", refreshToday);

function boot(){
  applyTheme();
  loadShared().then(() => { applyOvr(SHARED); jobsChanged(); if(SEED.length) refreshSnaps(); renderAll(); }).catch(() => {});
  fetch("data/jobs.json?t=" + Date.now())
    .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(d){
      SEED = d.jobs || [];
      jobsChanged();
      if(d.stages && d.stages.length) STAGES = d.stages;
      if(!STAGES.includes("과제")){ const i = STAGES.indexOf("1차 면접"); STAGES.splice(i < 0 ? STAGES.length : i, 0, "과제"); }
      /* 내가 고쳐둔 공용 공고는 내 값으로 되돌립니다 */
      applyOvr(SEED);
      JOBS_FAIL = false;
      DATA_VER = d.updated || "";
      refreshSnaps();
      showStale(d.updated);
      /* 담은 공고가 목록에 없으면(마감돼 보관함으로 감) 보관함을 바로 받는다(CR-01) */
      { const known = new Set(SEED.map(j => j.id)); db.custom.forEach(c => known.add(c.id));
        if(Object.keys(db.apps).some(id => db.apps[id].applied && !known.has(id) && !/^shared-/.test(id))) loadArchive(); }
      document.getElementById("footnote").innerHTML =
        '<span><b>공고 데이터</b> ' + (d.updated || "—") + ' 기준이에요. 매일 한 번 자동으로 새로 모아요.</span>' +
        '<span><b>내 데이터</b>는 로그인한 계정에 저장돼서 어느 기기에서 열어도 같고, 다른 사람에게는 보이지 않아요. 가끔 ⋯ 메뉴의 <b>백업 파일 받기</b>로 파일도 받아 두세요.</span>' +
        '<span><b>예상과 확정</b> 점선 ‘예상’은 지난 공고 패턴으로 짐작한 날짜예요. 실제 공고가 뜨면 확정으로 바뀌고, 직접 고칠 수도 있어요.</span>';
      /* 담아 둔 예상 공고의 실제 공고가 나왔으면 옮기기 — 공고 목록을 받은 뒤에만 판단한다(BUG-15) */
      migrateDonePredictions();
      renderAll();
      if(!db.profile.onboarded) openPref();
    })
    .catch(function(err){
      console.warn("공고 데이터를 불러오지 못했어요:", err.message);
      JOBS_FAIL = true;   /* 나중에 제보 목록이 와서 다시 그려도 이 안내를 지우지 않게(QA-18) */
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 8; td.style.cssText = "color:var(--muted);padding:24px 12px";
      td.textContent = "공고 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.";
      tr.append(td); document.getElementById("listBody").replaceChildren(tr);
    });
}

/* ---------- 인증 ---------- */
let currentUserId = null;
let currentEmail = "";
const authScreen = document.getElementById("authScreen");
const appHeader = document.getElementById("appHeader");
const appWrap = document.getElementById("appWrap");
const authMsg = document.getElementById("authMsg");
let authMode = "login";

const loadFail = document.getElementById("loadFail");
function showApp(){ authScreen.hidden = true; loadFail.hidden = true; appHeader.hidden = false; appWrap.hidden = false; }
function showAuth(){ authScreen.hidden = false; loadFail.hidden = true; appHeader.hidden = true; appWrap.hidden = true; }

function authErrorMessage(m){
  if(m.includes("Invalid login")) return "이메일이나 비밀번호가 맞지 않아요.";
  if(m.includes("least 6")) return "비밀번호는 6자 이상이어야 해요.";
  if(m.includes("already registered")) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if(m.includes("signups are disabled")) return "지금은 가입과 로그인을 할 수 없어요. 잠시 후 다시 해 주세요.";
  if(m.includes("Email not confirmed")) return "메일 인증이 아직 안 됐어요. 받은 메일함에서 인증 링크를 눌러 주세요.";
  console.warn("로그인 오류:", m);
  return "로그인하지 못했어요. 잠시 후 다시 해 주세요.";
}

document.getElementById("authSwitch").onclick = function(){
  authMode = authMode === "login" ? "signup" : "login";
  document.getElementById("authSubmit").textContent = authMode === "login" ? "로그인" : "가입하기";
  this.textContent = authMode === "login" ? "계정이 없어요 · 가입하기" : "계정이 있어요 · 로그인하기";
  authMsg.hidden = true;
};

document.getElementById("authForm").onsubmit = async function(e){
  e.preventDefault();
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPw").value;
  const submitBtn = document.getElementById("authSubmit");
  submitBtn.disabled = true; authMsg.hidden = true;
  const { error } = authMode === "login"
    ? await sb.auth.signInWithPassword({ email, password })
    : await sb.auth.signUp({ email, password });
  submitBtn.disabled = false;
  if(error){
    authMsg.textContent = authErrorMessage(error.message);
    authMsg.hidden = false;
  } else if(authMode === "signup"){
    authMsg.textContent = "확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.";
    authMsg.hidden = false;
    document.getElementById("authSwitch").click();
  }
  // 로그인 성공 시에는 onAuthStateChange가 처리
};

/* ---------- 지원 현황표 붙여넣기 ----------
   로컬에서 정리한 '지원 현황표'(마크다운)를 읽어 내 지원 상태를 한 번에 맞춘다.
   제목(## N. 합격/탈락 확정/탈락 추정/결과 미발표/미지원)으로 상태를 정하고, 표의 첫 칸(기업)·둘째 칸(직무)으로
   공고를 찾는다. 못 찾으면 '직접 등록' 공고로 새로 만든다. 반영 전에 미리보기로 연결을 확인한다. */
let stPlan = null;
function stParse(text){
  const rows = []; let sec = null;
  for(const line of text.split(/\r?\n/)){
    const h = line.match(/^#{2,3}\s*\d+\.\s*(.+)/);
    if(h){
      const t = h[1];
      sec = /탈락 확정/.test(t) ? "fail" : /탈락 추정/.test(t) ? "guess" : /미발표/.test(t) ? "wait"
          : /미지원/.test(t) ? "skip" : /합격/.test(t) ? "pass" : null;
      continue;
    }
    if(/^#{1,3}\s/.test(line)){ sec = null; continue; }
    if(!sec || !/^\s*\|/.test(line) || /^\s*\|\s*:?-/.test(line)) continue;
    const c = line.split("|").slice(1, -1).map(x => x.replace(/\*\*|`/g, "").trim());
    if(!c[0] || c[0] === "기업") continue;
    rows.push({sec, company: c[0], role: c[1] && c[1] !== "—" ? cleanRole(c[1]) : "", stage: sec === "fail" ? (c[2] || "") : ""});
  }
  if(rows.length) return rows;
  /* 표가 없으면 한 줄씩: "회사 [직무] [단계] 상태" — 상태 말은 줄 끝에 */
  let coNames = null;
  /* 탈락을 합격보다 먼저 본다 — '불합격'의 끝 '합격'이 합격으로 읽히지 않게(CR-07) */
  const ST_WORDS = [
    [/탈락\s*추정|연락\s*없음?|발표\s*지남/, "guess"], [/불합격?|탈락|떨어짐|떨어졌어|광탈/, "fail"],
    [/(?<!불)(최종\s*)?합격|붙음|붙었어|통과|오퍼/, "pass"], [/대기|미발표|기다리는\s*중|결과\s*전|진행\s*중/, "wait"], [/미지원|안\s*씀|안\s*냄|포기|패스/, "skip"]];
  for(let line of text.split(/\r?\n/)){
    line = line.replace(/^[\s\-*•·]+|^\d+[.)]\s*/g, "").trim();
    if(!line || /^#/.test(line)) continue;
    let hit = null;
    for(const [re, sec] of ST_WORDS){ const m = line.match(new RegExp("(" + re.source + ")[\\s.!~]*$", "i")); if(m){ hit = {sec, m}; break; } }
    if(!hit) continue;
    let before = line.slice(0, hit.m.index).replace(/[,:\-–—|/]+\s*$/, "").trim();
    const st = before.match(/(서류|인적성|코딩\s*테스트|과제|1차\s*면접|2차\s*면접|임원\s*면접|최종\s*면접|면접)$/);
    const stage = st ? st[1] : "";
    if(st) before = before.slice(0, -stage.length).trim();
    /* 회사 이름에 공백이 있을 수 있다('NHN Cloud', 'LIG D&A') — 공고 목록의 회사 이름 중 가장 길게 맞는 것을 먼저 쓴다(QA-05) */
    if(!coNames) coNames = [...new Set(allJobs().map(j => (j.company || "").trim()).filter(n => /\s/.test(n)))].sort((x, y) => y.length - x.length);
    const lower = before.toLowerCase();
    const long = coNames.find(n => lower.startsWith(n.toLowerCase()) && (before.length === n.length || /\s/.test(before[n.length])));
    const [company, ...roleParts] = long ? [before.slice(0, long.length)].concat(before.slice(long.length).trim().split(/\s+/).filter(Boolean)) : before.split(/\s+/);
    if(!company) continue;
    rows.push({sec: hit.sec, company, role: cleanRole(roleParts.join(" ")), stage: hit.sec === "fail" ? stage : ""});
  }
  return rows;
}
const stNorm = s => (s || "").toLowerCase().replace(/\(.*?\)|주식회사|㈜|[\s·\-—_]/g, "");
function stFind(row, used){
  const key = stNorm(row.company.split(/[·(]/)[0]);
  if(!key) return null;
  const rk = stNorm(row.role).slice(0, 4);
  const cands = allJobs().filter(j => {
    const c = stNorm(j.company);
    /* '두산'이 '두산건설'에 붙지 않도록, 이름 뒤에 붙는 말은 그룹·자동차 같은 일반 꼬리만 허용한다 */
    const tail = /^(그룹|계열포함|ds부문|코리아|자동차|주식회사)$/;
    return c && !used.has(j.id) && (c === key || canonCo(j.company) === canonCo(row.company) || (c.startsWith(key) && tail.test(c.slice(key.length))) ||
      (key.startsWith(c) && tail.test(key.slice(c.length))));
  });
  const score = j => (appOf(j.id).applied ? 4 : 0) + (stNorm(j.company) === key ? 2 : 0) +
    (rk && stNorm((j.roles || []).join("") + (j.hist || "")).includes(rk) ? 2 : 0) + ((j.end || "") >= "2026-08-01" ? 1 : 0);
  return cands.sort((a, b) => score(b) - score(a))[0] || null;
}
const ST_LABEL = {pass: "합격", fail: "탈락", guess: "탈락 추정", wait: "결과 대기", skip: "미지원"};
async function stPreview(){
  await loadArchive();
  const rows = stParse(document.getElementById("stText").value);
  const used = new Set();
  stPlan = rows.map(r => { const j = stFind(r, used); if(j) used.add(j.id); return {r, j}; });
  const known = new Set(allJobs().map(j => j.id));
  const orphans = Object.keys(db.apps).filter(id => db.apps[id].applied && !known.has(id));
  stPlan.orphans = orphans;
  /* '정리'는 기본으로 꺼 두고(B27), 지난 공고·제보 공고를 다 불러온 때만 보여 준다 —
     못 불러온 공고의 실제 기록이 '회사명 없음'으로 잘못 잡히기 때문이다 */
  const canClean = ARCHIVE_OK && SHARED_OK && orphans.length > 0;
  document.getElementById("stOrphanRow").hidden = !canClean;
  if(!canClean) document.getElementById("stOrphan").checked = false;
  document.getElementById("stOrphanLbl").textContent = "회사명 없이 ‘담음’으로만 남은 기록 " + orphans.length + "건 정리(담음 표시만 끄고 내용은 그대로 둬요)";
  const box = document.getElementById("stPreview"); box.replaceChildren();
  if(!rows.length){ box.textContent = "읽을 수 있는 줄이 없어요. ‘회사 상태’ 한 줄 형식이나 ‘## 1. 합격’ 같은 제목과 표가 있는지 확인해 주세요."; document.getElementById("stApply").disabled = true; return; }
  const t = document.createElement("table");
  t.innerHTML = "<thead><tr><th>상태</th><th>현황표</th><th>연결될 공고</th></tr></thead>";
  const tb = document.createElement("tbody");
  stPlan.forEach(({r, j}) => {
    const tr = document.createElement("tr");
    const a = document.createElement("td"); a.textContent = ST_LABEL[r.sec] + (r.stage && !/서류|미확인/.test(r.stage) ? " (" + r.stage + ")" : "");
    const b = document.createElement("td"); b.textContent = r.company + (r.role ? " · " + r.role : "");
    const c = document.createElement("td");
    if(j){ c.textContent = j.company + " · " + ((j.roles || []).join(", ") || j.hist || "") + (j.end ? " (마감 " + j.end + ")" : ""); }
    else if(r.sec === "skip"){ c.textContent = "보드에 없음 — 그대로 둠"; c.className = "skip"; }
    else { c.textContent = "새로 추가(직접 등록)"; c.className = "new"; }
    tr.append(a, b, c); tb.append(tr);
  });
  t.append(tb); box.append(t);
  document.getElementById("stApply").disabled = false;
}
function stApply(){
  if(!stPlan) return;
  let added = 0, updated = 0, skipped = 0;
  stPlan.forEach(({r, j}, i) => {
    if(r.sec === "skip"){ if(j){ const s = app(j.id); s.applied = false; s.skip = true; keepSnap(j, s); skipped++; } return; }
    let id = j && j.id;
    if(!id){
      id = "u" + Date.now() + i;
      db.custom.push({id, company: r.company, roles: [], start: "", end: "", confirmed: true, source: "직접 등록", type: "", hist: r.role, url: ""});
      added++;
    } else updated++;
    const a = app(id);
    a.applied = true; if(j) keepSnap(j, a);
    if(r.role && !a.role) a.role = r.role;
    if(r.sec === "pass" || r.sec === "wait") setDoc(a, r.sec === "pass" ? "합격" : "대기");
    else if(r.sec === "fail" && r.stage && !/서류|미확인/.test(r.stage)){
      setDoc(a, "합격");
      if(!a.stages.some(s => s.name === r.stage)) a.stages.push({name: r.stage, date: "", result: "불합격"});
    } else {
      setDoc(a, "불합격");
      if(r.sec === "guess" && !/탈락 추정/.test(a.note || "")) a.note = ((a.note || "") + " 탈락 추정(결과 통보 없음)").trim();
    }
  });
  let cleaned = 0;
  if(ARCHIVE_OK && SHARED_OK && document.getElementById("stOrphan").checked) (stPlan.orphans || []).forEach(id => { db.apps[id].applied = false; cleaned++; });
  save(); renderAll();
  document.getElementById("stDlg").close();
  toast("반영했어요 · 연결 " + updated + "건 · 새로 추가 " + added + "건 · 미지원 " + skipped + "건" + (cleaned ? " · 정리 " + cleaned + "건" : ""));
  stPlan = null;
}
document.getElementById("stBtn").onclick = () => {
  stPlan = null; document.getElementById("stPreview").replaceChildren(); document.getElementById("stApply").disabled = true;
  document.getElementById("stOrphan").checked = false; document.getElementById("stOrphanRow").hidden = true;
  document.getElementById("stDlg").showModal();
};
document.getElementById("stClose").onclick = () => document.getElementById("stDlg").close();
document.getElementById("stPrevBtn").onclick = stPreview;
document.getElementById("stText").oninput = () => { document.getElementById("stApply").disabled = true; };
document.getElementById("stApply").onclick = stApply;
document.getElementById("stCopyPrompt").onclick = async () => {
  try{ await navigator.clipboard.writeText(document.getElementById("stPromptText").textContent); toast("프롬프트를 복사했어요"); }
  catch(e){ toast("복사가 막혀 있어요. 칸을 길게 눌러 직접 복사해 주세요"); }
};

function openMe(){
  const rows = [["로그인 아이디", currentEmail || "알 수 없음"],
    ["내 지원", Object.values(db.apps || {}).filter(a => a.applied).length + "건"],
    ["아카이브 경험 카드", (db.arc.exp || []).length + "개"]];
  if(IS_OWNER){
    rows.push(["소민 전용 기능", privOn() ? "켜짐 (⋯ 메뉴에서 끄고 켤 수 있어요)" : "꺼짐"]);
    const m = db.match;
    rows.push(["경험 키워드", m ? mtMine().size + "개 · 경험 " + m.n + "개 기준 · " + m.at : "아직 없음"]);
    rows.push(["링크드인 저장", (db.linkedin || []).length + "건"]);
  }
  const dl = document.getElementById("meBody"); dl.replaceChildren();
  rows.forEach(([k, v]) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); });
  document.getElementById("meDlg").showModal();
}
document.getElementById("meBtn").onclick = openMe;
/* ⋯ 메뉴: 버튼으로 열고, 항목을 누르거나 바깥을 누르거나 Esc면 닫는다 */
(function(){
  const btn = document.getElementById("menuBtn"), pop = document.getElementById("menuPop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); };
  pop.addEventListener("click", (e) => { if(e.target.closest("button")) close(); });
  document.addEventListener("click", (e) => { if(!pop.hidden && !e.target.closest(".menu-wrap")) close(); });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape" && !pop.hidden){ close(); btn.focus(); } });
})();
/* ---------- 업데이트 기록(data/update-log.json, scripts/log-update.mjs가 매일 쌓음) ---------- */
document.getElementById("logDone").onclick = () => document.getElementById("logDlg").close();
document.getElementById("logBtn").onclick = async function(){
  const dlg = document.getElementById("logDlg"), body = document.getElementById("logBody");
  dlg.showModal();
  let log;
  try{ const r = await fetch("data/update-log.json?t=" + Date.now()); if(!r.ok) throw 0; log = await r.json(); }
  catch(e){ body.textContent = "기록을 불러오지 못했어요. 잠시 후 다시 열어 주세요."; return; }
  body.replaceChildren();
  const wd = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
  log.entries.slice().reverse().forEach((e, i) => {
    const det = document.createElement("details"); det.className = "log-day"; det.open = i === 0;
    const sm = document.createElement("summary");
    const b = document.createElement("b"); b.textContent = e.date.slice(5).replace("-", "/") + " (" + wd(e.date) + ")";
    const n = document.createElement("span"); n.className = "n"; n.textContent = "새 공고 " + e.added.length;
    const o = document.createElement("span");
    o.textContent = ["마감·보관 " + e.archived.length, e.removed.length ? "제외 " + e.removed.length : "", e.compNew.length ? "기업 채용 새 공고 " + e.compNew.length : ""].filter(Boolean).join(" · ");
    sm.append(b, n, o); det.append(sm);
    const list = (title, items, fmt) => {
      if(!items.length) return;
      const h = document.createElement("h4"); h.textContent = title; det.append(h);
      const ul = document.createElement("ul");
      items.forEach(x => { const li = document.createElement("li"); fmt(li, x); ul.append(li); });
      det.append(ul);
    };
    const link = (li, text, url) => li.append(extLink(url, text));
    list("새로 들어온 공고", e.added, (li, x) => link(li, x.company + (x.title ? " — " + x.title : x.roles && x.roles.length ? " — " + x.roles.join(", ") : "") + (x.end ? " (마감 " + x.end.slice(5).replace("-", "/") + ")" : ""), x.url));
    list("기업 채용 새 공고", e.compNew.slice(0, 40), (li, x) => link(li, x.company + " — " + x.title, x.url));
    if(e.compNew.length > 40){ const p = document.createElement("p"); p.className = "sub"; p.textContent = "…외 " + (e.compNew.length - 40) + "건(첫 수집일이라 많아요)"; det.append(p); }
    list("교육과정·인재풀 등으로 제외", e.removed, (li, x) => li.append(x.company + (x.title ? " — " + x.title : "")));
    list("마감돼 보관함으로", e.archived, (li, x) => li.append(x.company + (x.end ? " (" + x.end.slice(5).replace("-", "/") + " 마감)" : "")));
    body.append(det);
  });
};
document.getElementById("meClose").onclick = () => document.getElementById("meDlg").close();
document.getElementById("meLogout").onclick = () => { document.getElementById("meDlg").close(); document.getElementById("logoutBtn").click(); };
/* 로그아웃(B26): 기다리는 저장을 먼저 끝내고, 성공하면 이 기기의 내 사본을 지운다.
   저장에 실패하면 로그아웃을 멈춘다 — 사본을 지우면 아직 계정에 못 올린 변경이 사라진다. */
function dropLocalCopies(uid){
  try{
    if(uid) localStorage.removeItem(localKey(uid));
    const s = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    if(!s || !s.uid || s.uid === uid) localStorage.removeItem(SNAP_KEY);
  }catch(e){}
}
let loggingOut = false;
document.getElementById("logoutBtn").onclick = async function(){
  if(dbReady && currentUserId){
    const ok = await flushSave();
    if(!ok){ toast("저장하지 못한 변경이 있어요. 연결을 확인한 뒤 다시 시도해 주세요", {label: "다시 시도", run: () => document.getElementById("logoutBtn").click()}); return; }
  }
  const uid = currentUserId, wasReady = dbReady;
  loggingOut = true;
  dropLocalCopies(uid);
  dbReady = false;
  const { error } = await sb.auth.signOut();
  if(error){
    /* 로그아웃이 안 됐으면 앱을 그대로 쓰게 되돌리고, 지운 이 기기 사본도 다시 쓴다 */
    loggingOut = false; dbReady = wasReady; if(dbReady) writeLocal();
    console.warn("로그아웃하지 못했어요:", error.message);
    toast("로그아웃하지 못했어요", {label: "다시 시도", run: () => document.getElementById("logoutBtn").click()});
  }
};
document.getElementById("saveRetry").onclick = () => { flushSave(); };
/* 저장이 끝나지 않았거나 실패한 채로 떠나려 하면 브라우저가 한 번 묻는다(B08) */
window.addEventListener("beforeunload", e => {
  if(!(unsaved() || inflight || saveFailed)) return;
  /* 문서가 아직 살아 있는 이 순간에 남은 저장을 바로 보낸다(떠나기를 고르면 그 사이 끝나는 경우가 많다) */
  saveNow(); if(unsaved() && !inflight && !conflict) flushSave();
  e.preventDefault(); e.returnValue = "";
});
/* 페이지를 닫거나 새로고침할 때·화면이 가려질 때(휴대폰에서 다른 앱으로) 남은 저장을 바로 보낸다.
   올리는 중인 요청이 있어도 보낸다 — 그 뒤에 바꾼 내용이 있을 수 있다. keepalive는 64KB까지라 넘으면 일반 요청으로라도 보낸다.
   조건은 보통 저장과 같다(updated_at이 그대로일 때만). 실패해도 이 기기 사본에 '저장 안 됨' 표시가 남아 다음에 열 때 묻는다 */
function flushOnLeave(){
  saveNow();
  if(!unsaved() || !sessionToken || conflict) return;
  clearTimeout(syncTimer); syncTimer = null;
  const seq = saveSeq, now = new Date().toISOString(), data = persistCopy();
  let url = SUPABASE_URL + "/rest/v1/jobboard_data", method = "POST", body, prefer = "return=representation";
  if(loadedAt){
    url += "?user_id=eq." + encodeURIComponent(currentUserId) + "&updated_at=eq." + encodeURIComponent(loadedAt) + "&select=updated_at";
    method = "PATCH"; body = JSON.stringify({data, updated_at: now});
  } else {
    url += "?select=updated_at"; prefer = "resolution=merge-duplicates,return=representation";
    body = JSON.stringify({user_id: currentUserId, data, updated_at: now});
  }
  const big = new TextEncoder().encode(body).length > 63000;
  try{
    fetch(url, {method, keepalive: !big, body,
      headers: {"apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + sessionToken, "Content-Type": "application/json", "Prefer": prefer}})
      .then(r => r.ok ? r.json() : null)
      .then(rows => {   /* 페이지가 살아 있으면(화면만 가려진 경우) 결과를 반영한다 */
        if(!Array.isArray(rows) || !rows.length || !rows[0].updated_at) return;
        loadedAt = rows[0].updated_at;
        if(seq > savedSeq){ savedSeq = seq; saveFailed = false; }
        writeLocal(); if(!unsaved()) setSaveState("saved");
      }).catch(() => {});
  }catch(e){}
}
/* 화면이 가려질 때(새로고침·탭 닫기 직전 포함)는 보통 저장으로 바로 보낸다 — 문서가 아직 살아 있어 끝까지 가는 경우가 많다.
   이미 올리는 중이면 기다리지 않고 keepalive로 하나 더 보낸다. pagehide에서는 keepalive만(브라우저에 따라 사전 요청이 필요한 keepalive가 안 갈 수 있다) */
document.addEventListener("visibilitychange", () => {
  if(!document.hidden || !dbReady) return;
  saveNow();
  if(!unsaved() || conflict) return;
  if(inflight) flushOnLeave(); else flushSave();
});
window.addEventListener("pagehide", flushOnLeave);

/* 계정 데이터 불러오기(B28) — {db} · {db, fresh} · {fail:"load"|"shape", ...}.
   조회가 실패했거나 형식을 못 읽으면 빈 보드로 시작하지 않는다(그 상태로 저장하면 서버 기록이 지워진다).
   서버에 행이 없는 진짜 첫 로그인만 새 보드로 시작한다. */
async function loadUserData(userId){
  let res;
  try{ res = await sb.from("jobboard_data").select("data, updated_at").eq("user_id", userId).maybeSingle(); }
  catch(e){ res = {error: e}; }
  if(res.error){ console.warn("계정 데이터를 불러오지 못했어요:", res.error.message || res.error); return {fail: "load"}; }
  if(res.data){
    const d = normalizeDb(res.data.data);
    if(!d){ console.warn("계정 데이터 형식을 읽지 못했어요"); return {fail: "shape", raw: res.data.data}; }
    /* 이미 있는 계정: 계정 구분 없는 예전 사본은 묻지 않고 지운다(공유 기기에서 다른 사람 기록이 섞이지 않게) */
    try{ localStorage.removeItem(KEY); }catch(e){}
    return {db: d, at: res.data.updated_at || null};
  }
  /* 첫 로그인: 이 브라우저에 로그인 기능 전 예전 기록이 있으면 옮길지 묻는다 */
  let initial = defaultDb(), dropLegacy = false;
  const legacy = loadLegacy();
  if(legacy){
    const n = Object.values(legacy.apps).filter(a => a.applied).length;
    const last = Object.values(legacy.apps).map(a => a.at || "").filter(Boolean).sort().pop();
    let pick;
    while((pick = await confirmDlg({title: "이 브라우저에 예전 기록이 있어요",
      body: "로그인 기능이 생기기 전 이 브라우저에 쓰던 기록이에요(담은 공고 " + n + "건" + (last ? ", 마지막으로 담은 날 " + fmt(last) : "") +
            "). 이 계정으로 옮길까요? 다른 사람이 이 브라우저를 썼다면 옮기지 마세요. 새로 시작하면 이 기기의 예전 기록은 지워져요. 필요하면 먼저 백업 파일로 받아 두세요."},
      "옮기기", "새로 시작", {extra: "백업 파일 받기", noValue: "fresh"})) === "extra") downloadJson(legacy, "지원보드-예전기록-" + iso(new Date()) + ".json");
    if(pick === true){ initial = legacy; dropLegacy = true; }
    else if(pick === "fresh") dropLegacy = true;     /* 닫기·Esc는 예전 기록을 그대로 둔다 */
  }
  /* 새 행은 insert로만 만든다 — 조회가 잘못 0행을 돌려준 경우에도 이미 있는 행을 덮지 않는다(중복 키로 실패 → 불러오기 실패 화면) */
  const up = await sb.from("jobboard_data").insert({ user_id: userId, data: initial, updated_at: new Date().toISOString() }).select("updated_at");
  if(up.error){ console.warn("새 보드를 계정에 만들지 못했어요:", up.error.message); return {fail: "load"}; }
  if(dropLegacy){ try{ localStorage.removeItem(KEY); }catch(e){} }   /* 계정에 만든 뒤에만 예전 기록을 지운다 */
  return {db: initial, fresh: true, at: rowAt(up)};
}
function downloadJson(obj, name){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: "application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/* 불러오기 실패 화면 — 다시 시도 · (형식 오류면) 원본 내려받기 · 로그아웃 */
function showLoadFail(r){
  authScreen.hidden = true; appHeader.hidden = true; appWrap.hidden = true; loadFail.hidden = false;
  document.getElementById("loadFailMsg").textContent = r.fail === "shape"
    ? "계정 데이터의 형식을 읽지 못했어요. 덮어쓰지 않고 그대로 두었어요. 원본을 내려받아 보관해 주세요."
    : "계정 데이터를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요. 불러오기 전에는 아무것도 저장하지 않아요.";
  const raw = document.getElementById("loadRaw");
  raw.hidden = r.fail !== "shape";
  raw.onclick = () => {
    const blob = new Blob([JSON.stringify(r.raw, null, 2)], {type: "application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "지원보드-계정원본-" + iso(new Date()) + ".json"; a.click(); URL.revokeObjectURL(a.href);
  };
  document.getElementById("loadRetry").focus();
}
document.getElementById("loadRetry").onclick = function(){
  this.disabled = true; this.textContent = "불러오는 중…";
  startForUser().finally(() => { this.disabled = false; this.textContent = "다시 시도"; });
};
document.getElementById("loadFailLogout").onclick = async () => { loggingOut = true; dropLocalCopies(currentUserId); const { error } = await sb.auth.signOut(); if(error){ loggingOut = false; toast("로그아웃하지 못했어요"); } };
async function startForUser(){
  const uid = currentUserId;
  const r = await loadUserData(uid);
  if(uid !== currentUserId) return;
  if(r.fail){ dbReady = false; showLoadFail(r); return; }
  /* 이 기기 사본에 계정에 못 올린 변경이 있고 서버보다 새것이면 어느 쪽을 쓸지 묻는다 */
  let next = r.db, useLocal = false;
  const loc = readLocal(uid), meta = loc && loc._local;
  let dirtyNewer = meta && meta.dirty && (!r.at || Date.parse(meta.savedAt) > Date.parse(r.at));
  if(dirtyNewer && r.at){
    /* 닫힐 때 보낸 저장이 막 도착하는 중일 수 있어 한 번만 잠깐 기다렸다 다시 본다 */
    await new Promise(res => setTimeout(res, 1200));
    const again = await sb.from("jobboard_data").select("data, updated_at").eq("user_id", uid).maybeSingle();
    if(!again.error && again.data && again.data.updated_at && Date.parse(again.data.updated_at) >= Date.parse(meta.savedAt)){
      const d2 = normalizeDb(again.data.data);
      if(d2){ next = d2; r.at = again.data.updated_at; dirtyNewer = false; }
    }
  }
  if(dirtyNewer){
    const t = new Date(meta.savedAt), when = (t.getMonth() + 1) + "월 " + t.getDate() + "일 " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
    const pick = await confirmDlg({title: "이 기기에 저장 안 된 변경이 있어요",
      body: "이 기기에서 " + when + "에 바꾼 내용이 계정에 올라가지 못했어요. 이 기기 내용을 쓰면 계정에 다시 저장해요. 서버 내용을 쓰면 이 기기 내용은 백업 파일로 받아 둬요."},
      "이 기기 내용 쓰기", "서버 내용 쓰기");
    const local = normalizeDb(Object.assign({}, loc, {_local: undefined}));
    if(pick === true && local){ delete local._local; next = local; useLocal = true; }
    else { const copy = Object.assign({}, loc); delete copy._local; downloadJson(copy, "지원보드-이기기-" + iso(new Date()) + ".json"); }
  }
  replaceDb(next); loadedAt = r.at || null; conflict = false;
  dbReady = true; saveSeq = savedSeq = 0; saveFailed = false; localAt = "";
  setSaveState("idle");
  if(useLocal) save(); else writeLocal();
  IS_OWNER = await checkOwner(currentEmail);
  await loadMyNotes();
  showApp();
  boot();
  /* 공유 링크(?sales=1 · ?mkt=1)로 들어오면 그 탭을 켜고 바로 연다 — 내 화면 설정만 바뀐다 */
  const qs = new URLSearchParams(location.search);
  const wantMode = qs.get("sales") === "1" ? "sales" : qs.get("mkt") === "1" ? "mkt" : "";
  if(wantMode && !db.profile[SL_MODES[wantMode].flag]){ db.profile[SL_MODES[wantMode].flag] = true; save(); }
  applyPrivate();
  applyVariant();
  /* 처음 열 때: 공유 링크(?sales=1 · ?mkt=1)면 그 탭, 주소에 해시가 있으면 그 화면(B18), 없으면 기본 화면(b1은 '오늘') */
  applyRoute(wantMode ? "#/jobs/" + wantMode : location.hash);
}

sb.auth.onAuthStateChange(function(event, session){
  sessionToken = session ? session.access_token || "" : "";
  if(session && session.user){
    if(currentUserId === session.user.id) return; // 이미 로드됨(예: 탭 포커스 시 재발화)
    currentUserId = session.user.id;
    currentEmail = session.user.email || "";
    /* 인증 콜백 안에서 Supabase 호출을 기다리지 않는다(라이브러리 잠금과 겹칠 수 있음, CR-23) */
    setTimeout(startForUser, 0);
  } else {
    const hadUser = !!currentUserId;
    /* 세션이 만료돼 끊긴 경우: 못 올린 변경은 이 기기 사본에 '저장 안 됨'으로 남겨 다음 로그인 때 묻는다 */
    if(hadUser && !loggingOut && dbReady){ saveNow(); if(unsaved()) writeLocal(); }
    if(event === "SIGNED_OUT" && hadUser){ dbReady = false; location.reload(); return; }   /* 같은 탭에서 다른 계정으로 들어갈 때 이전 화면·고친 값이 남지 않게 */
    currentUserId = null;
    currentEmail = "";
    dbReady = false; db = defaultDb();
    clearTimeout(syncTimer); syncTimer = null; saveFailed = false;
    IS_OWNER = false;
    MY_NOTES = {};
    applyPrivate();
    showAuth();
  }
});
