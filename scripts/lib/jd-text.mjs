// 공고 본문 텍스트 추출 공용 함수(build-jd-keywords.mjs · fetch-companies.mjs가 함께 씀)

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const stripHtml = (h) => h
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<\/(li|p|h\d|div|br)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** JSON 안에서 가장 긴 문자열 값(대개 공고 본문 HTML)을 찾는다 */
function longestString(node, best = "") {
  if (typeof node === "string") return node.length > best.length ? node : best;
  if (node && typeof node === "object") for (const v of Object.values(node)) best = longestString(v, best);
  return best;
}

export async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

// 그리팅 공고 페이지는 서버에서 그려진 Next.js 페이지다. 페이지 데이터(__NEXT_DATA__)에서
// 가장 긴 문자열이 공고 본문이라, 메뉴·다른 공고 제목이 섞이지 않게 그것만 쓴다.
export async function greetingJd(url) {
  const html = await fetchText(url);
  // 그리팅은 '경력사항: 경력 5년 이상'을 본문이 아닌 옆 칸(jobPositionCareer)에 따로 둔다 — 본문 앞에 붙여 연차 판정에 쓰이게 한다
  const career = greetingCareer(html);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const body = stripHtml(longestString(JSON.parse(m[1])));
      if (body.length > 200) return career + body;
    } catch {}
  }
  const main = html.match(/<main[\s\S]*?<\/main>/i);
  return career + stripHtml(main ? main[0] : html);
}

/** 그리팅 페이지 데이터의 경력 조건 → "경력 5년 이상\n" / "신입\n" / "" */
export function greetingCareer(html) {
  const mins = [];
  let newcomer = false;
  for (const m of html.matchAll(/"careerType"\s*:\s*"(\w+)"[^{}]*?/g)) {
    // careerType이 있는 객체 하나(중괄호 안)를 잘라 careerFrom을 찾는다
    const start = html.lastIndexOf("{", m.index), end = html.indexOf("}", m.index);
    const obj = html.slice(start, end + 1);
    if (m[1] === "EXPERIENCED") {
      const f = obj.match(/"careerFrom"\s*:\s*(\d+)/);
      if (f && Number(f[1]) > 0) mins.push(Number(f[1]));
    } else if (m[1] === "NEW_COMER") newcomer = true;
  }
  if (mins.length) return `경력 ${Math.min(...mins)}년 이상\n`;
  return newcomer ? "신입\n" : "";
}
