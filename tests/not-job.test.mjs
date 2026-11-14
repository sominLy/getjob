import test from "node:test";
import assert from "node:assert/strict";
import { isNotJob } from "../scripts/lib/not-job.mjs";

test("교육 과정과 취업 준비 트랙을 채용 공고에서 제외한다", () => {
  for (const [company, title] of [
    ["서울경제진흥원", "2026년 하반기 디지털 역량(AI) 교육과정"],
    ["서울경제진흥원", "디지털 역량 교육 과정 참여 안내 마케팅 PM/서비스기획"],
    ["현대건설 기술교육원", "THE FIELD 실전 취업 트랙 HR/인사 영업"],
    ["현대건설 기술교육원", "THE FIELD 실전취업트랙 https://edu.hdec.co.kr/"],
    ["교육기관", "K-Digital Training 교육생 모집"],
  ]) {
    assert.equal(isNotJob(company, title), true, title);
  }
});

test("교육과 취업 서비스를 운영하는 실제 채용은 유지한다", () => {
  for (const [company, title] of [
    ["에듀테크기업", "교육과정 기획 및 운영 매니저 채용"],
    ["취업서비스", "커리어 플랫폼 마케팅 매니저"],
    ["현대건설", "2026년 신입사원 채용"],
    ["서울경제진흥원", "사업기획 및 마케팅 담당자 채용"],
  ]) {
    assert.equal(isNotJob(company, title), false, title);
  }
});
