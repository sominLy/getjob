#!/usr/bin/env python3
"""
주니어 기획·마케팅 공고판 아티팩트용 수집 스크립트.
그리팅(greetinghr) 24곳 + Greenhouse 3곳(쿠팡·당근·센드버드)을 직접 수집한다.
구글/앤스로픽/노션/OpenAI는 jobboard/data/ai-companies-jobs.json(같은 저장소의
fetch-ai-companies.mjs가 매일 갱신)을 그대로 재사용한다 — 중복 수집하지 않는다.

실행: python3 collect.py
출력: data.json (이 폴더에 저장, 다음 실행에서 신규 배지 판정에 씀)
"""
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
JOBBOARD_AI_JSON = HERE.parent / "data" / "ai-companies-jobs.json"
OUT_PATH = HERE / "data.json"
PREV_PATH = HERE / "data.json"  # 직전 실행 결과(신규 배지 판정용, 실행 전에 읽음)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

GREETINGHR = [
    ("BAT", "https://bat.career.greetinghr.com"),
    ("CJ올리브영", "https://career.oliveyoung.com"),
    ("pfct", "https://pfct.career.greetinghr.com"),
    ("강남언니", "https://career.gangnamunni.com"),
    ("넛지헬스케어", "https://cashwalk12.career.greetinghr.com"),
    ("라이드플럭스", "https://rideflux.career.greetinghr.com"),
    ("뤼튼", "https://career.wrtn.io"),
    ("마이리얼트립", "https://myrealtrip.career.greetinghr.com"),
    ("마카롱팩토리", "https://mycle.career.greetinghr.com"),
    ("메가스터디교육", "https://megastudyedu.career.greetinghr.com"),
    ("무신사", "https://www.musinsacareers.com"),
    ("스캐터랩", "https://www.scatterlab.co.kr"),
    ("아우토크립트", "https://autocrypt.career.greetinghr.com"),
    ("업스테이지", "https://careers.upstage.ai"),
    ("에코마케팅", "https://career.echomarketing.co.kr"),
    ("와디즈", "https://job.wadiz.io"),
    ("직방", "https://zigbang.career.greetinghr.com"),
    ("카카오페이", "https://kakaopay.career.greetinghr.com"),
    ("코나아이", "https://konai.career.greetinghr.com"),
    ("팀스파르타", "https://career.spartaclub.kr"),
    ("하이브", "https://careers.hybecorp.com"),
    ("하이컨시", "https://hiconsy.career.greetinghr.com"),
    ("헥토", "https://www.hectocareers.co.kr"),
]

GREENHOUSE = [
    ("쿠팡", "coupang", "https://www.coupang.jobs/en/jobs/?gh_jid={id}"),
    ("당근", "daangn", "https://about.daangn.com?gh_jid={id}"),
    ("센드버드", "sendbird", "https://job-boards.greenhouse.io/sendbird/jobs/{id}"),
]

CAREER_TYPE_KO = {
    "NEW_COMER": "신입",
    "NOT_MATTER": "경력무관",
}
EMP_TYPE_KO = {
    "FULL_TIME_WORKER": "정규직",
    "CONTRACT_WORKER": "계약직",
    "INTERN_WORKER": "인턴",
    "MILITARY_SERVICE": "병역특례",
    "PART_TIME_WORKER": "파트타임",
}

EXCLUDE_TITLE = re.compile(
    r"팀장|디렉터|Director|Head\s*of|리드\b|Lead\b|CTO|CEO|COO|CFO|이사|상무|전무|"
    r"\bVP\b|개발자|Engineer|Developer|백엔드|프론트엔드|디자이너|Designer|UX|UI\s*디자인|"
    r"QA\b|바리스타",
    re.I,
)

CATEGORY_RULES = [
    ("기획·PM/PO", re.compile(r"기획|PM\b|PO\b|Product\s*(Manager|Owner)|Program\s*Manager|프로덕트", re.I)),
    ("마케팅·브랜딩", re.compile(r"마케|브랜드|브랜딩|Marketing|Brand|PR\b|홍보|광고|IMC|콘텐츠|Content|크리에이터", re.I)),
    ("데이터·리서치", re.compile(r"데이터\s*분석|데이터분석|Data\s*(Analyst|Strategist)|리서치|Research", re.I)),
    ("세일즈·CX·제휴", re.compile(r"영업|세일즈|Sales|CX\b|고객|상담|Account\s*(Manager|Executive)|제휴|Partnership|Consultant|컨설턴트|CS\b", re.I)),
    ("전략·사업", re.compile(r"전략|Strategy|사업개발|Business\s*Development|Corp\.?\s*Dev|Business\s*Analyst", re.I)),
    ("운영·오퍼레이션", re.compile(r"운영|Operations?\b|Ops\b|물류|SCM|정산|검수|Assistant|보안|Compliance", re.I)),
]


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def extract_balanced_objects(html, marker):
    objs = []
    for m in re.finditer(re.escape(marker), html):
        start = m.start()
        depth = 0
        i = start
        in_str = False
        esc = False
        end = None
        while i < len(html):
            c = html[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            i += 1
        if end is None:
            continue
        try:
            objs.append(json.loads(html[start:end]))
        except Exception:
            pass
    return objs


def career_text(career):
    if not career:
        return "-"
    ct = career.get("careerType")
    if ct in CAREER_TYPE_KO:
        return CAREER_TYPE_KO[ct]
    if ct == "EXPERIENCED":
        frm = career.get("careerFrom")
        to = career.get("careerTo")
        if frm is None:
            return "-"
        return f"경력 {frm}년~{to if to else ''}"
    return "-"


def emp_text(emp):
    if not emp:
        return "-"
    et = emp.get("employmentType")
    return EMP_TYPE_KO.get(et, et or "-")


def classify(title):
    for cat, pat in CATEGORY_RULES:
        if pat.search(title):
            return cat
    return None


def is_junior(career):
    """국내 기업만: 인턴·신입·경력무관·정보없음·경력 0~1년 시작만 남긴다."""
    if not career:
        return True
    ct = career.get("careerType")
    if ct in ("NEW_COMER", "NOT_MATTER"):
        return True
    if ct == "EXPERIENCED":
        frm = career.get("careerFrom")
        return frm is not None and frm <= 1
    return True


def collect_greetinghr(name, base):
    try:
        html = fetch(f"{base}/ko")
    except Exception as e:
        print(f"[greetinghr] {name} 수집 실패: {e}")
        return []
    objs = extract_balanced_objects(html, '{"deploy":')
    rows = []
    for o in objs:
        if not o.get("deploy"):
            continue
        ojp = o.get("openingJobPosition") or {}
        positions = ojp.get("openingJobPositions") or []
        pos = positions[0] if positions else {}
        title = (o.get("title") or "").strip()
        if not title or EXCLUDE_TITLE.search(title):
            continue
        cat = classify(title)
        if not cat:
            continue
        career = pos.get("jobPositionCareer")
        emp = pos.get("jobPositionEmployment")
        if not is_junior(career):
            continue
        opening_id = o.get("openingId")
        due = o.get("dueDate")
        due_fmt = due[:10] if due else "상시"
        rows.append(
            {
                "회사": name,
                "플랫폼": "greetinghr",
                "title": title,
                "career": career_text(career),
                "emp": emp_text(emp),
                "due": due_fmt,
                "link": f"{base}/ko/o/{opening_id}",
                "cat": cat,
                "intern": emp_text(emp) == "인턴",
                "openDate": (o.get("openDate") or "")[:10],
            }
        )
    return rows


def collect_greenhouse(name, token, url_tmpl):
    try:
        raw = fetch(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs")
    except Exception as e:
        print(f"[greenhouse] {name} 수집 실패: {e}")
        return []
    data = json.loads(raw)
    rows = []
    junior_signal = re.compile(r"인턴|신입|Junior|Associate\b|대졸신입", re.I)
    for j in data.get("jobs", []):
        title = (j.get("title") or "").strip()
        loc = (j.get("location") or {}).get("name") or ""
        if "korea" not in loc.lower() and "seoul" not in loc.lower():
            continue
        if not junior_signal.search(title):
            continue
        if EXCLUDE_TITLE.search(title):
            continue
        cat = classify(title)
        if not cat:
            continue
        rows.append(
            {
                "회사": name,
                "플랫폼": "greenhouse",
                "title": title,
                "career": "주니어(제목 기준)",
                "emp": "-",
                "due": loc,
                "link": url_tmpl.format(id=j.get("id")),
                "cat": cat,
                "intern": bool(re.search(r"인턴|Intern", title, re.I)),
                "openDate": (j.get("first_published") or j.get("updated_at") or "")[:10],
            }
        )
    return rows


def load_prev_links():
    if not PREV_PATH.exists():
        return set()
    try:
        prev = json.loads(PREV_PATH.read_text(encoding="utf-8"))
        return {r["link"] for r in prev.get("rows", [])}
    except Exception:
        return set()


def main():
    prev_links = load_prev_links()

    all_rows = []
    for name, base in GREETINGHR:
        rows = collect_greetinghr(name, base)
        print(f"[greetinghr] {name}: {len(rows)}건")
        all_rows.extend(rows)
        time.sleep(0.3)

    for name, token, tmpl in GREENHOUSE:
        rows = collect_greenhouse(name, token, tmpl)
        print(f"[greenhouse] {name}: {len(rows)}건")
        all_rows.extend(rows)

    for r in all_rows:
        r["new"] = r["link"] not in prev_links

    ai_rows = []
    if JOBBOARD_AI_JSON.exists():
        ai_data = json.loads(JOBBOARD_AI_JSON.read_text(encoding="utf-8"))
        for j in ai_data.get("jobs", []):
            ai_rows.append(
                {
                    "회사": j["company"],
                    "플랫폼": "global",
                    "title": j["title"],
                    "career": "-",
                    "emp": "-",
                    "due": j.get("location", ""),
                    "link": j["url"],
                    "cat": "외국계 AI (연차 미표기)",
                    "intern": False,
                    "new": j["url"] not in prev_links,
                    "openDate": j.get("updated", ""),
                }
            )
        print(f"[global] AI 4사(jobboard 재사용): {len(ai_rows)}건")
    else:
        print("[global] jobboard/data/ai-companies-jobs.json 없음 — AI 4사 섹션 비움")

    out = {
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "rows": all_rows + ai_rows,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n총 {len(out['rows'])}건 저장 → {OUT_PATH}")


if __name__ == "__main__":
    main()
