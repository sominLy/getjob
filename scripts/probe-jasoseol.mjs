#!/usr/bin/env node
// 점검용(일회성): 자소설닷컴 공고에서 '공고문 이미지'가 어디서 오는지 확인한다.
// 1) 공고 상세 API JSON의 필드 이름과, 글·이미지가 들어 있을 만한 긴 문자열
// 2) 브라우저로 공고 페이지를 열어 화면에 보이는 큰 이미지와 본문 글자 수
import { chromium } from "playwright";

const IDS = (process.env.IDS || "106234,106211,105604,106232").split(",");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function walk(o, path, out) {
  if (typeof o === "string") { if (o.length > 60 || /<img|https?:\/\//.test(o)) out.push(`${path} (${o.length}자): ${o.slice(0, 160).replace(/\s+/g, " ")}`); }
  else if (Array.isArray(o)) o.slice(0, 2).forEach((x, i) => walk(x, `${path}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, out);
  return out;
}

const browser = await chromium.launch();
for (const id of IDS) {
  const r = await fetch(`https://jasoseol.com/api/v1/employment_companies/${id}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const j = r.ok ? await r.json() : null;
  console.log(`\n### ${id} API ${r.status} keys: ${j ? Object.keys(j).join(",") : ""}`);
  if (j) walk(j, "", []).slice(0, 25).forEach((l) => console.log("  API", l));

  const page = await browser.newPage({ userAgent: UA, viewport: { width: 1280, height: 2000 } });
  const imgReqs = [];
  page.on("response", (res) => { const u = res.url(); if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u) || /image/.test(res.headers()["content-type"] || "")) imgReqs.push(u); });
  try {
    await page.goto(`https://jasoseol.com/recruit/${id}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({
      title: document.title,
      text: document.body.innerText.length,
      imgs: [...document.images].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight })).filter((i) => i.w * i.h > 200000).slice(0, 8),
      iframes: [...document.querySelectorAll("iframe")].map((f) => f.src).slice(0, 5),
      sample: document.body.innerText.slice(0, 600),
    }));
    console.log(`  PAGE title=${info.title} text=${info.text}`);
    info.imgs.forEach((i) => console.log(`  BIGIMG ${i.w}x${i.h} ${i.src.slice(0, 200)}`));
    info.iframes.forEach((f) => console.log(`  IFRAME ${f}`));
    console.log(`  SAMPLE ${info.sample.replace(/\s+/g, " ").slice(0, 600)}`);
    console.log(`  IMGREQ ${imgReqs.filter((u) => !/logo|icon|favicon|company_groups/.test(u)).slice(0, 10).join("\n         ")}`);
  } catch (e) { console.log("  PAGE fail", e.message.slice(0, 120)); }
  await page.close();
}
await browser.close();
