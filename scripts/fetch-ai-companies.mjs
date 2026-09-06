#!/usr/bin/env node
// 구글/앤스로픽/노션/OpenAI 한국(서울) 공고를 직무·경력 무관하게 전부 모은다.
// data/ai-companies-jobs.json(분석용 원본)에 통째로 갈아끼우고,
// 지원보드에서도 바로 보이도록 data/jobs.json에도 합친다.
// 노션·OpenAI는 Ashby, 앤스로픽은 Greenhouse — 둘 다 공식 공개 채용게시판 API.
// (OpenAI 자체 웹사이트는 봇 차단(403)이라 직접 스크래핑은 여전히 불가)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyPosting } from "./lib/classify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "ai-companies-jobs.json");
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ---------- Anthropic (Greenhouse) ----------
async function fetchAnthropic() {
  const res = await fetch("https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`anthropic fetch failed: ${res.status}`);
  const data = await res.json();
  return data.jobs
    .filter((j) => (j.offices ?? []).some((o) => o.id === 4043781008)) // Seoul office
    .map((j) => ({
      company: "Anthropic",
      title: j.title,
      location: j.offices?.map((o) => o.name).join(", ") ?? "",
      department: j.departments?.[0]?.name ?? "",
      url: j.absolute_url,
      updated: j.updated_at?.slice(0, 10) ?? "",
    }));
}

// ---------- Ashby 기반 회사 공용(Notion, OpenAI) ----------
async function fetchAshby(orgSlug, companyName) {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${orgSlug}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`${companyName} fetch failed: ${res.status}`);
  const data = await res.json();
  return data.jobs
    .filter((j) => /seoul|south korea/i.test(j.location ?? ""))
    .map((j) => ({
      company: companyName,
      title: j.title,
      location: j.location ?? "",
      department: j.department ?? j.team ?? "",
      url: j.jobUrl,
      updated: j.publishedAt?.slice(0, 10) ?? "",
    }));
}

// ---------- Google ----------
// 공개 API가 없어 검색결과 HTML에서 직접 파싱. 구글이 클래스명을 바꾸면 깨질 수 있음.
async function fetchGoogle() {
  const base =
    "https://www.google.com/about/careers/applications/jobs/results/?location=Korea%2C%20Republic%20of&hl=en-US";
  const seen = new Map();
  // 페이지네이션이 몇 페이지인지 안정적으로 알 수 없어 처음 몇 페이지만 순회한다.
  for (let page = 1; page <= 4; page++) {
    const url = page === 1 ? base : `${base}&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`google fetch failed: ${res.status}`);
    const html = await res.text();

    const liRe = /<li class="lLd3Je" ssk='18:(\d+)'>([\s\S]*?)<\/li>/g;
    let m;
    let foundOnPage = 0;
    while ((m = liRe.exec(html))) {
      const [, id, block] = m;
      if (seen.has(id)) continue;
      const titleMatch = block.match(/class="QJPWVe">([^<]+)<\/h3>/);
      const locMatch = block.match(/class="r0wTof "[^>]*>([^<]+)<\/span>/);
      if (!titleMatch) continue;
      foundOnPage++;
      seen.set(id, {
        company: "Google",
        title: titleMatch[1].trim(),
        location: locMatch?.[1]?.trim() ?? "",
        department: "",
        url: `https://www.google.com/about/careers/applications/jobs/results/${id}`,
        updated: "",
      });
    }
    if (foundOnPage === 0) break; // 더 이상 새 결과 없으면 중단
  }
  return [...seen.values()];
}

async function main() {
  const sources = await Promise.allSettled([
    fetchAnthropic(),
    fetchAshby("notion", "Notion"),
    fetchAshby("openai", "OpenAI"),
    fetchGoogle(),
  ]);

  const labels = ["anthropic", "notion", "openai", "google"];
  let all = [];
  sources.forEach((r, i) => {
    if (r.status === "fulfilled") {
      all = all.concat(r.value);
    } else {
      console.error(`${labels[i]} 수집 실패:`, r.reason.message);
    }
  });

  const out = {
    updated: new Date().toISOString().slice(0, 10),
    note: "구글/앤스로픽/노션/OpenAI 서울 오피스 공고 전체(직무·경력 무관).",
    jobs: all,
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  const added = await mergeIntoBoard(all);
  console.log(`총 ${all.length}건 저장 (Anthropic/Notion/OpenAI/Google). 지원보드에 새로 추가 ${added}건.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * 지원보드(jobs.json)에도 같은 공고를 넣는다. 여기 공고는 대부분 상시 채용이라
 * 마감일이 없고, 기업 형태는 "외국계"로 따로 표시한다.
 */
async function mergeIntoBoard(items) {
  let db;
  try {
    db = JSON.parse(await readFile(JOBS_PATH, "utf-8"));
  } catch {
    return 0;
  }
  const existing = new Set(db.jobs.map((j) => j.url));
  const fresh = [];
  for (const it of items) {
    if (!it.url || existing.has(it.url)) continue;
    const hit = classifyPosting({ title: it.title, company: it.company });
    fresh.push({
      id: `global-${it.company.toLowerCase()}-${it.url.split("/").pop().slice(0, 24)}`,
      company: it.company,
      type: "외국계",
      roles: hit ? hit.roles : [],
      start: "",
      end: "",
      confirmed: true,
      source: `${it.company} 채용페이지`,
      url: it.url,
      hist: [it.title, it.department].filter(Boolean).join(" · "),
    });
  }
  if (fresh.length === 0) return 0;
  db.jobs.push(...fresh);
  db.updated = new Date().toISOString().slice(0, 10);
  await writeFile(JOBS_PATH, JSON.stringify(db, null, 2) + "\n", "utf-8");
  return fresh.length;
}
