#!/usr/bin/env node
// 일회성 마이그레이션: 이미 저장된 자소설닷컴 공고를 duty-groups 기반으로 재분류하고,
// 경력만 뽑는 공고(annual/신입 표현 없음)는 제거한다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const ROLE_KEYWORDS = [
  { role: "PM/서비스기획", pattern: /서비스\s*기획|프로덕트|PM\b|product manager|PO\b/i },
  { role: "기획/전략", pattern: /경영기획|사업기획|전략기획|기획\/경영|기획팀|사업전략|경영전략/i },
];
const BATCH_PATTERN = /대졸\s*신입|신입\s*공채|공채|대규모/;
const BATCH_EXCLUDE = /생산|기술직|현장|영업직|엔지니어|디자이너|개발자|R&D|연구소|판매|매장|간호|약사|의사/i;
function classify(text) {
  const roles = new Set();
  for (const { role, pattern } of ROLE_KEYWORDS) if (pattern.test(text)) roles.add(role);
  if (roles.size > 0) return { roles: [...roles], hist: "자동 수집" };
  if (BATCH_PATTERN.test(text) && !BATCH_EXCLUDE.test(text)) {
    return { roles: ["PM/서비스기획", "기획/전략"], hist: "자동 수집 · 대졸 신입 공채 — 기획 트랙 포함 여부는 공고에서 직접 확인하세요" };
  }
  return null;
}
const EXPERIENCED_ONLY = /경력/;
const NOT_EXPERIENCED_ONLY_HINT = /신입|인턴|수시|채용연계형|무관|공채|졸업예정/;
function isExperiencedOnly(text) {
  return EXPERIENCED_ONLY.test(text) && !NOT_EXPERIENCED_ONLY_HINT.test(text);
}
function mapCompanyType(item) {
  if (item.business_type === "public_institution") return "공기업";
  if (item.business_size === "big_business") return "대기업";
  if (item.business_size === "middle_market") return "중견기업";
  return "";
}

async function main() {
  const db = JSON.parse(await readFile(JOBS_PATH, "utf-8"));

  const dutyRes = await fetch("https://jasoseol.com/api/v1/duty-groups", { headers: { "User-Agent": UA } });
  const dutyList = await dutyRes.json();
  const dutyGroupNames = new Map(dutyList.map((g) => [g.id, g.name]));

  const start = new Date();
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const calRes = await fetch("https://jasoseol.com/employment/calendar_list.json", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ start_time: start.toISOString(), end_time: end.toISOString() }),
  });
  const calData = await calRes.json();
  const byId = new Map((calData.employment ?? []).map((item) => [String(item.id), item]));

  let reclassified = 0, removed = 0;
  db.jobs = db.jobs.filter((job) => {
    if (job.source !== "자소설닷컴" || !job.id.startsWith("jasoseol-")) return true;
    const jid = job.id.replace("jasoseol-", "");
    const item = byId.get(jid);
    if (!item) return true; // 캘린더 범위 밖(이미 지난 공고 등) — 그대로 둔다

    const dutyNames = (item.employments ?? [])
      .flatMap((e) => e.duty_groups ?? [])
      .map((g) => dutyGroupNames.get(g.group_id))
      .filter(Boolean)
      .join(" ");
    const text = `${item.title ?? ""} ${item.name ?? ""} ${dutyNames}`;

    if (isExperiencedOnly(text)) { removed++; return false; }

    const hit = classify(text);
    const newRoles = hit ? hit.roles : [];
    const newHist = hit ? hit.hist : "자동 수집 · 직무 확인 필요";
    const newType = mapCompanyType(item);
    if (JSON.stringify(newRoles) !== JSON.stringify(job.roles) || newHist !== job.hist || newType !== job.type) {
      job.roles = newRoles; job.hist = newHist; job.type = newType; reclassified++;
    }
    return true;
  });

  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log(`재분류 ${reclassified}건, 경력전용 제거 ${removed}건. 총 ${db.jobs.length}건 남음.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
