#!/usr/bin/env node
// 취준자료/지원기업/{회사}/00_공고정보.md 의 머리말(---)을 읽어 data/jobs.json에 올린다.
//
// 공고의 공개 정보(회사·직무·게시일·마감일·링크)만 옮긴다. 자소서·분석·진행 상태는
// 공개 저장소에 올리지 않고 로컬 md에만 남긴다.
// 로컬 전용 스크립트다(GitHub Actions에는 취준자료 폴더가 없다).
//
//   node scripts/sync-my-companies.mjs            반영
//   node scripts/sync-my-companies.mjs --dry-run  바뀔 내용만 출력

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "archive.json");
const COMPANY_DIR = process.env.COMPANY_DIR
  ?? path.join(__dirname, "..", "..", "취준자료", "지원기업");
const DRY = process.argv.includes("--dry-run");

const ROLES = ["PM/서비스기획", "기획/전략", "사업개발", "마케팅", "브랜드", "콘텐츠", "MD",
  "영업", "영업관리", "HR/인사", "금융/심사", "고객/CS", "홍보/PR", "리서치"];
const TYPES = ["대기업", "중견기업", "유니콘", "스타트업", "금융", "공기업", "외국계"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    // "마감일:   # [확인] ..." 처럼 값 대신 주석만 있는 칸은 빈 값으로 본다
    const val = line.slice(i + 1).replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    out[key] = val.replace(/^["']|["']$/g, "");
  }
  return out;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const archive = await readJson(ARCHIVE_PATH, { jobs: [] });

  const folders = (await readdir(COMPANY_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"));

  const problems = [];
  const notes = [];
  let added = 0, updated = 0, same = 0;

  for (const dir of folders) {
    const file = path.join(COMPANY_DIR, dir.name, "00_공고정보.md");
    let text;
    try { text = await readFile(file, "utf-8"); } catch { continue; }
    const fm = frontmatter(text);
    if (!fm || !fm["회사"]) { problems.push(`${dir.name}: 머리말(---)이나 회사 칸이 없음`); continue; }

    const id = "my-" + dir.name;
    const role = fm["직무분류"];
    const start = fm["게시일"] || "", end = fm["마감일"] || "", endTime = fm["마감시각"] || "";
    const bad = [];
    if (role && !ROLES.includes(role)) bad.push(`직무분류 '${role}'는 목록에 없음 (${ROLES.join(", ")})`);
    if (fm["기업형태"] && !TYPES.includes(fm["기업형태"])) bad.push(`기업형태 '${fm["기업형태"]}'는 목록에 없음`);
    if (start && !DATE.test(start)) bad.push(`게시일 '${start}'는 YYYY-MM-DD가 아님`);
    if (end && !DATE.test(end)) bad.push(`마감일 '${end}'는 YYYY-MM-DD가 아님`);
    if (endTime && !TIME.test(endTime)) bad.push(`마감시각 '${endTime}'는 HH:MM이 아님`);
    if (bad.length) { problems.push(`${dir.name}: ${bad.join(" / ")}`); continue; }

    const url = fm["링크"] || "";
    // 자동 수집으로 같은 공고가 이미 들어와 있으면 중복으로 올리지 않는다
    const dup = url && db.jobs.find((j) => j.id !== id && j.url === url);
    if (dup) { problems.push(`${dir.name}: 같은 링크의 공고가 이미 있음(${dup.id}) — 건너뜀`); continue; }

    const job = {
      id,
      company: fm["회사"],
      type: fm["기업형태"] || "",
      roles: role ? [role] : [],
      start, end,
      confirmed: true,
      source: "직접 등록",
      url,
      hist: [fm["직무"], fm["고용형태"], fm["근무지"]].filter(Boolean).join(" · "),
      ...(endTime ? { endTime } : {}),
    };

    const fortune = fm["운세"] || "";
    if (fortune && !/^(🟢 적극 지원|🟡 지원|🟠 조건부 지원|🔴 후순위)$/.test(fortune))
      problems.push(`${dir.name}: 운세 '${fortune}'는 4단계 표기가 아님 — 표시만 올리고 판정은 비움`);
    notes.push({
      job_id: id,
      fortune: /^(🟢 적극 지원|🟡 지원|🟠 조건부 지원|🔴 후순위)$/.test(fortune) ? fortune : null,
      fortune_note: fm["운세한줄"] || null,
      checked_at: DATE.test(fm["운세판정일"] || "") ? fm["운세판정일"] : null,
    });

    const idx = db.jobs.findIndex((j) => j.id === id);
    if (idx < 0) {
      if (archive.jobs.some((j) => j.id === id)) { same++; continue; }
      db.jobs.push(job); added++;
      console.log(`+ ${job.company} (${end || "상시"})`);
    } else if (JSON.stringify(db.jobs[idx]) !== JSON.stringify(job)) {
      db.jobs[idx] = job; updated++;
      console.log(`~ ${job.company} (${end || "상시"})`);
    } else same++;
  }

  for (const p of problems) console.warn("! " + p);
  console.log(`추가 ${added} · 수정 ${updated} · 그대로 ${same} · 문제 ${problems.length}`);

  if (!DRY && (added || updated)) {
    db.updated = new Date().toISOString().slice(0, 10);
    await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n");
  }

  await pushNotes(notes);
}

// '부탁한 공고' 표시와 운세 판정은 공개 jobs.json이 아니라 내 계정 전용 표에 올린다.
// 로그인 정보는 jobboard/.env.local (gitignore)에 둔다:
//   JOBBOARD_EMAIL=...
//   JOBBOARD_PASSWORD=...
async function pushNotes(notes) {
  if (!notes.length) return;
  const env = await readEnv(path.join(__dirname, "..", ".env.local"));
  const email = process.env.JOBBOARD_EMAIL ?? env.JOBBOARD_EMAIL;
  const password = process.env.JOBBOARD_PASSWORD ?? env.JOBBOARD_PASSWORD;
  if (!email || !password) {
    console.warn("! 운세·부탁 표시는 올리지 않음 — jobboard/.env.local에 JOBBOARD_EMAIL, JOBBOARD_PASSWORD 필요");
    return;
  }
  const html = await readFile(path.join(__dirname, "..", "index.html"), "utf-8");
  const url = html.match(/SUPABASE_URL = "([^"]+)"/)?.[1];
  const key = html.match(/SUPABASE_ANON_KEY = "([^"]+)"/)?.[1];
  if (!url || !key) throw new Error("index.html에서 Supabase 주소를 찾지 못했습니다");

  if (DRY) { notes.forEach((n) => console.log(`(dry) 표시 ${n.job_id} ${n.fortune ?? ""}`)); return; }

  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error("로그인 실패: " + (session.error_description || session.msg || auth.status));

  const rows = notes.map((n) => ({ ...n, user_id: session.user.id, updated_at: new Date().toISOString() }));
  const res = await fetch(`${url}/rest/v1/jobboard_my_notes?on_conflict=user_id,job_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`표시 저장 실패(${res.status}): ${t}` +
      (/jobboard_my_notes/.test(t) ? " — supabase/my_notes.sql을 먼저 실행하세요" : ""));
  }
  console.log(`내 계정 표시 ${rows.length}건 저장`);
}

async function readEnv(file) {
  try {
    const out = {};
    for (const line of (await readFile(file, "utf-8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch { return {}; }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
