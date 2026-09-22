#!/usr/bin/env python3
"""
collect.py가 만든 data.json으로 artifact.html(주니어 기획·마케팅 공고판)을 다시 만든다.
템플릿은 이 폴더의 template.html(이전 발행본 원본 shell)을 그대로 쓰고, 통계·칩·회사
드롭다운·DATA 배열만 치환한다. 'new' 배지는 template.html에 박혀 있는 직전 DATA의
링크 집합과 비교해서 판정한다(그래야 "이번 실행 vs 이번 실행" 자기비교가 안 됨).

실행: python3 build.py
출력: artifact.html (이걸 Artifact publish로 기존 URL에 올리면 됨)

매 실행 후 template.html을 이번 artifact.html로 갱신해둬야 다음 실행의 '신규' 판정
기준이 이번 수집일로 넘어간다(맨 아래 참고).
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
DATA_PATH = HERE / "data.json"
TEMPLATE_PATH = HERE / "template.html"
OUT_PATH = HERE / "artifact.html"

CATS = [
    "기획·PM/PO", "마케팅·브랜딩", "운영·오퍼레이션",
    "세일즈·CX·제휴", "전략·사업", "데이터·리서치",
    "외국계 AI (연차 미표기)",
]
N_MANUAL_SITES = 21  # 자체 채용 사이트 14 + 대기업 공채 7 (template.html 패널 안 li 개수)


def main():
    rows = json.loads(DATA_PATH.read_text(encoding="utf-8"))["rows"]
    html = TEMPLATE_PATH.read_text(encoding="utf-8")

    prev_data = re.search(r"const DATA = (\[.*?\]);", html, re.S)
    prev_links = {r["link"] for r in json.loads(prev_data.group(1))} if prev_data else set()
    for r in rows:
        r["new"] = r["link"] not in prev_links

    total = len(rows)
    companies = sorted({r["회사"] for r in rows})
    n_companies = len(companies)
    n_intern = sum(1 for r in rows if r["intern"])
    n_new = sum(1 for r in rows if r["new"])
    cat_counts = {c: sum(1 for r in rows if r["cat"] == c) for c in CATS}

    today = __import__("datetime").date.today().isoformat()

    html = re.sub(r"자동 수집 · \d{4}-\d{2}-\d{2} 기준", f"자동 수집 · {today} 기준", html)

    html = re.sub(
        r'<div class="tally">.*?</div>\s*</header>',
        f'''<div class="tally">
<div><b>{total}</b><span>공고</span></div>
<div><b>{n_companies}</b><span>회사</span></div>
<div><b>{n_intern}</b><span>인턴</span></div>
<div><b>{n_new}</b><span>신규</span></div>
</div>
</header>''',
        html, count=1, flags=re.S,
    )

    opts = "".join(f"<option>{c}</option>" for c in companies)
    html = re.sub(
        r'<select id="co" aria-label="회사 선택"><option value="">전체 회사</option>.*?</select>',
        f'<select id="co" aria-label="회사 선택"><option value="">전체 회사</option>{opts}</select>',
        html, count=1, flags=re.S,
    )

    chips_html = f'<button class="chip" data-c="" aria-pressed="true">전체 <em>{total}</em></button>\n' + \
        "\n".join(
            f'<button class="chip" data-c="{c}" aria-pressed="false">{c} <em>{cat_counts.get(c, 0)}</em></button>'
            for c in CATS
        )
    html = re.sub(
        r'<div class="chips" role="group" aria-label="직무 필터">.*?</div>',
        f'<div class="chips" role="group" aria-label="직무 필터">\n{chips_html}\n</div>',
        html, count=1, flags=re.S,
    )

    n_auto_sites = 30  # greetinghr 23 + greenhouse 3 + AI4사 4 (collect.py의 소스 목록 기준)
    html = re.sub(
        r"\d+개 채용 사이트를 직접 읽어 모은",
        f"{n_auto_sites + N_MANUAL_SITES}개 채용 사이트를 직접 읽어 모은",
        html, count=1,
    )

    html = re.sub(r"9월 \d+일 이후 새로 열린 공고", "직전 수집 이후 새로 열린 공고", html)
    html = re.sub(
        r"직전 수집은 \d{4}-\d{2}-\d{2}이고, 이번에 전부 다시 받.{0,20}\.",
        f"직전 수집은 {today} 이전 최신 실행 기준이고, 이번에 전부 다시 받았습니다.",
        html,
    )

    data_json = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    html = re.sub(r"const DATA = \[.*?\];", f"const DATA = {data_json};", html, count=1, flags=re.S)

    OUT_PATH.write_text(html, encoding="utf-8")
    print(f"built artifact.html: {total}건, {n_companies}개사, 인턴 {n_intern}, 신규 {n_new}")
    print("Artifact publish 후, 다음 실행의 '신규' 기준을 오늘로 넘기려면:")
    print(f"  cp {OUT_PATH} {TEMPLATE_PATH}")


if __name__ == "__main__":
    main()
