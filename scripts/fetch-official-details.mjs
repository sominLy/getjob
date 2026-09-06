#!/usr/bin/env node
// 확정 공고(예상 일정 제외)의 공식 채용페이지를 헤드리스 브라우저로 실제로 띄워서
// 화면에 보이는 본문 텍스트를 통째로 긁어 job.detail에 저장한다.
// 이미 detail이 있는 공고는 건너뛰므로, 매일 크론에서는 그날 새로 추가된 공고만 처리된다.
//
// 회사마다 페이지 구조가 다 달라서 표로 구조화하지 않고, 사람이 페이지를 열어 읽는 것과
// 같은 수준의 원문 텍스트를 그대로 저장한다(가공 없음). SPA(예: Nuxt/React) 사이트는
// 단순 fetch로는 빈 껍데기만 오기 때문에 실제 브라우저 렌더링이 필요하다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = path.join(__dirname, "..", "data", "jobs.json");
const DETAILS_PATH = path.join(__dirname, "..", "data", "details.json");

const MAX_CHARS = 4000;
const CONCURRENCY = 4;
const NAV_TIMEOUT = 25000;

async function gotoResilient(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
  } catch {
    // 일부 사이트는 계속 폴링 연결을 유지해서 networkidle에 절대 도달하지 않는다 —
    // 기본 load 이벤트 + 약간의 대기로 재시도
    await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
    await page.waitForTimeout(1500);
  }
}

function cleanText(raw) {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

// 사이드바/푸터/메뉴만 긁혀도 글자 수는 쉽게 넘기기 때문에, 실제 공고 내용에 흔한
// 키워드가 있는지까지 같이 확인한다. 둘 다 아니면 "진짜 내용"으로 보지 않는다.
const CONTENT_HINT = /수행\s*업무|우대\s*사항|자격\s*요건|담당\s*업무|주요\s*업무|채용\s*절차|지원\s*자격|근무\s*조건|모집\s*분야|지원\s*방법/;
function looksLikeRealContent(text) {
  return text.length > 800 && CONTENT_HINT.test(text);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return fallback; }
}

async function main() {
  const db = await readJson(JOBS_PATH, null);
  if (!db) throw new Error("jobs.json을 읽지 못했습니다");
  const details = await readJson(DETAILS_PATH, { updated: "", items: {} });

  // 본문은 details.json에 따로 모은다(jobs.json은 목록만 담아 가볍게 유지).
  const targets = db.jobs.filter(
    (j) => j.confirmed === true && j.url && !details.items[j.id]
  );
  console.log(`대상 ${targets.length}건 (확정 공고 중 본문 없는 것만)`);
  if (targets.length === 0) return;

  const browser = await chromium.launch();
  const today = new Date().toISOString().slice(0, 10);
  let idx = 0, ok = 0, fail = 0;

  async function worker() {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    while (idx < targets.length) {
      const job = targets[idx++];
      try {
        await gotoResilient(page, job.url);
        const text = await page.evaluate(() => document.body.innerText);
        const cleaned = cleanText(text || "");
        const hasRealText = looksLikeRealContent(cleaned);

        // 텍스트가 부실하면(메뉴/사이드바뿐) 실제 내용이 포스터 이미지일 가능성이 커서
        // 화면에 크게 보이는 이미지 중 가장 큰 것도 같이 확인한다.
        const posterUrl = hasRealText
          ? ""
          : await page.evaluate(() => {
              const imgs = [...document.querySelectorAll("img")]
                .filter((i) => i.naturalWidth > 400 && i.naturalHeight > 400)
                .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
              return imgs[0]?.src || "";
            });

        if (hasRealText) {
          details.items[job.id] = { detail: cleaned, at: today };
          ok++;
        } else if (posterUrl) {
          details.items[job.id] = { image: posterUrl, at: today };
          ok++;
        } else {
          fail++;
        }
      } catch (err) {
        fail++;
      }
      if (idx % 20 === 0) console.log(`진행 ${idx}/${targets.length} (성공 ${ok}, 실패 ${fail})`);
    }
    await ctx.close();
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();

  details.updated = today;
  await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");
  console.log(`완료. 성공 ${ok}건, 실패(접근차단/타임아웃 등) ${fail}건.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
