#!/usr/bin/env node
// details.json의 본문 텍스트를 "회사 소개 / 모집 부문 / 자격 요건 ..." 항목으로 쪼개
// sections로 저장한다. 화면에서 항목별로 접었다 펼 수 있게 하기 위한 것.
// 파서 규칙을 고친 뒤 다시 돌리면 기존 본문도 새 규칙으로 다시 나뉜다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { splitSections } from "./lib/sections.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DETAILS_PATH = path.join(__dirname, "..", "data", "details.json");

async function main() {
  const details = JSON.parse(await readFile(DETAILS_PATH, "utf-8"));
  let split = 0, plain = 0;

  for (const item of Object.values(details.items ?? {})) {
    if (!item.detail) continue;
    const sections = splitSections(item.detail);
    if (sections.length) {
      item.sections = sections;
      delete item.detail;   // 항목으로 나눴으면 원문 중복 저장은 불필요
      split++;
    } else {
      delete item.sections;
      plain++;
    }
  }

  await writeFile(DETAILS_PATH, JSON.stringify(details, null, 2) + "\n", "utf-8");
  console.log(`항목 분리 ${split}건, 원문 그대로 ${plain}건.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
