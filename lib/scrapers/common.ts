/**
 * 各校 scraper 共用工具:
 * - HTTP 取頁(處理 TLS/重導/編碼)
 * - 從標題推測活動類型
 * - 民國年 → 西元年
 */
import https from "https";
import http from "http";
import crypto from "crypto";
import type { ActivityType } from "../types";

const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION =
  (crypto.constants as any).SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION ?? 0x00040000;

const legacyAgent = new https.Agent({
  secureOptions: SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
});

const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; InternX-CareerActivity/1.0)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "zh-TW,zh;q=0.9",
};

export async function fetchHtml(url: string, opts?: { timeoutMs?: number; useLegacyTls?: boolean }): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const lib: any = isHttps ? https : http;
    const reqOpts: any = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      headers: COMMON_HEADERS,
    };
    if (isHttps && opts?.useLegacyTls) reqOpts.agent = legacyAgent;
    const req = lib.get(reqOpts, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        res.resume();
        fetchHtml(redirectUrl, opts).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`));
    });
    req.on("error", reject);
  });
}

export function inferActivityType(title: string): ActivityType | null {
  if (!title) return null;
  const rules: Array<[RegExp, ActivityType]> = [
    [/企業參訪|產業參訪|公司參訪|參訪/, "企業參訪"],
    [/博覽會|徵才博覽|校園徵才/, "博覽會"],
    [/說明會/, "說明會"],
    [/工作坊|workshop|履歷健檢|履歷健診|模擬面試/i, "工作坊"],
    [/競賽|大賽|錦標賽|競試|hackathon|hack/i, "競賽"],
    [/校園大使|大使招募/, "校園大使"],
    [/創業|新創|startup/i, "創業活動"],
    [/交流會|交流活動|分享會|沙龍|座談|gathering|networking/i, "交流活動"],
    [/講座|演講|論壇|大師|名人/, "講座"],
    [/徵才|招募|求才|誠徵|聘/, "其他"],
  ];
  for (const [re, type] of rules) {
    if (re.test(title)) return type;
  }
  return null;
}

export function rocToAdYear(rocOrAd: number): number {
  if (rocOrAd >= 1911) return rocOrAd;
  return rocOrAd + 1911;
}

export function parseDateLoose(s: string): Date | null {
  if (!s || typeof s !== "string") return null;
  // 找出 (yyyy/mm/dd) 或 (民國 yyy/mm/dd);民國年要 >= 80(1991),否則 2 位數可能是日期被誤判
  // 例如 "(報名日期：4/20-05/04)" 不該解析成 20/05/04 = 民國20年5月4日 = 1931
  const matches = Array.from(s.matchAll(/(\d{2,4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/g));
  for (const m of matches) {
    const yRaw = parseInt(m[1], 10);
    // 拒絕看起來不像年份的數字
    if (yRaw < 80) continue;
    const y = rocToAdYear(yRaw);
    if (y < 2000 || y > 2100) continue;
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const date = new Date(y, mo - 1, d, 0, 0, 0);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

export function applyTimeRange(timeText: string, baseDate: Date): { start: Date; end: Date } {
  const t = (timeText || "").trim();
  const m = t.match(/(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const start = new Date(baseDate); start.setHours(+m[1], +m[2], 0, 0);
    const end = new Date(baseDate); end.setHours(+m[3], +m[4], 0, 0);
    return { start, end };
  }
  const m2 = t.match(/(\d{1,2}):(\d{2})/);
  if (m2) {
    const start = new Date(baseDate); start.setHours(+m2[1], +m2[2], 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return { start, end };
  }
  const start = new Date(baseDate);
  const end = new Date(baseDate); end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

/**
 * \u5f9e cheerio \u7269\u4ef6\u6293\u4e3b\u8981\u5167\u5bb9,\u53bb\u6389\u5c0e\u89bd\u5217/\u9801\u5c3e/\u5ee3\u544a/CSS/JS \u7b49\u96dc\u8a0a\u3002
 *
 * \u6d41\u7a0b:
 *   1. \u628a\u6574\u9846 DOM \u4e2d\u7684 script/style/nav/header/footer/aside \u7b49\u5148\u79fb\u9664
 *   2. \u5617\u8a66\u5e38\u898b\u7684\u300c\u4e3b\u5167\u5bb9\u300dselector,\u6311\u6587\u5b57\u6700\u8c50\u5bcc\u7684\u90a3\u500b
 *   3. \u6c92\u6709\u547d\u4e2d\u5c31\u56de\u50b3\u5168 body \u6587\u5b57(\u5df2\u6e05\u904e)
 */
export function extractMainContent($: any, customSelectors: string[] = []): string {
  // 1) \u79fb\u9664\u660e\u986f\u975e\u5167\u5bb9\u5143\u7d20(\u76f4\u63a5\u5f9e DOM \u62ff\u6389,\u5f8c\u9762 .text() \u624d\u4e0d\u6703\u62ff\u5230)
  $(
    "script, style, noscript, iframe, " +
    "nav, header, footer, aside, " +
    '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
    ".nav, .navbar, .navigation, .menu, .sidebar, .breadcrumb, .breadcrumbs, " +
    ".header, .footer, .top-bar, .bottom-bar, .copyright, " +
    ".social-links, .share-buttons, .share, .pagination, " +
    "#header, #footer, #nav, #navigation, #menu, #sidebar, #top, #bottom"
  ).remove();

  // 2) \u5617\u8a66\u5e38\u898b\u5167\u5bb9\u5bb9\u5668,\u6311\u6587\u5b57\u6700\u591a\u7684\u90a3\u500b
  const selectors = [
    ...customSelectors,
    "main",
    "article",
    "[role='main']",
    ".main-content", ".content-main", ".post-content", ".article-content",
    ".news-detail", ".announcement-detail", ".event-detail", ".activity-detail",
    "#main", "#content", "#main-content", "#article",
    ".content", ".main", ".inner",
  ];

  let best = "";
  for (const sel of selectors) {
    try {
      const text = normalizeText($(sel).first().text());
      if (text.length > best.length) best = text;
    } catch { /* selector \u53ef\u80fd\u7121\u6548,\u5ffd\u7565 */ }
  }

  if (best.length > 50) return best;

  // 3) fallback: \u6574\u500b body
  return normalizeText($("body").text());
}

/**
 * \u5075\u6e2c description \u662f\u5426\u770b\u8d77\u4f86\u662f\u300c\u5c0e\u89bd\u5217\u96dc\u8a0a\u300d\u800c\u975e\u771f\u6b63\u6d3b\u52d5\u63cf\u8ff0\u3002
 *
 * \u5224\u5b9a\u539f\u5247(\u4efb\u4e00\u6210\u7acb\u5c31\u7b97\u96dc\u8a0a):
 *   - \u542b\u592a\u591a\u7368\u7acb\u7684\u55ae\u5b57\u884c(\u6bcf\u884c \u2264 4 \u5b57),\u5178\u578b nav menu \u6a23\u5f0f
 *   - \u91cd\u8907\u51fa\u73fe\u300c\u95dc\u65bc\u8077\u6daf\u767c\u5c55\u4e2d\u5fc3 \u7c21\u4ecb \u516c\u544a ...\u300d\u985e\u9078\u55ae\u95dc\u9375\u5b57
 *   - \u542b\u5927\u91cf CSS / JS \u7a0b\u5f0f\u78bc\u7247\u6bb5
 *   - \u6574\u6bb5\u4e2d\u6587\u5b57\u6578\u4f54\u6bd4\u904e\u4f4e
 */
export function isLikelyNavText(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 30) return true;

  // CSS / JS \u6f0f\u9032\u4f86\u7684\u5fb5\u5146
  if (/\.[a-zA-Z][\w\-]*\s*\{|\}\s*\.[a-zA-Z]/.test(t)) return true;
  if (/<\/?script|<\/?style|function\s*\(|var\s+\w+\s*=/.test(t)) return true;

  // \u884c\u5f88\u77ed\u7684\u6bd4\u4f8b(\u2264 4 \u5b57\u7684\u884c\u4f54\u8d85\u904e 40%)
  const lines = t.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 5) {
    const shortRatio = lines.filter(l => l.length <= 4).length / lines.length;
    if (shortRatio > 0.4) return true;
  }

  // \u4e2d\u6587\u5b57\u4f54\u6bd4(< 30% \u8996\u70ba\u975e\u4e2d\u6587\u6d3b\u52d5\u63cf\u8ff0)
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk / t.length < 0.15) return true;

  return false;
}

/**
 * \u62bd\u53d6\u300c\u4e7e\u6de8\u7684\u6d3b\u52d5\u63cf\u8ff0\u300d:
 *   - \u7528 extractMainContent \u53d6\u4e3b\u5167\u5bb9
 *   - \u7528 isLikelyNavText \u5224\u65b7\u662f\u4e0d\u662f\u96dc\u8a0a
 *   - \u96dc\u8a0a\u5247\u56de\u50b3 null,\u8b93\u4e0a\u5c64\u6c7a\u5b9a fallback \u6587\u6848
 */
export function extractDescription($: any, customSelectors: string[] = []): string | null {
  const raw = extractMainContent($, customSelectors);
  if (isLikelyNavText(raw)) return null;
  // \u622a 2500 \u5b57\u4ee5\u514d payload \u904e\u5927
  return raw.slice(0, 2500);
}

export function settled<T>(promises: Array<Promise<T>>, label: string): Promise<T[]> {
  return Promise.allSettled(promises).then((results) => {
    const ok: T[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") ok.push(r.value);
      else console.warn(`[${label}] item ${i} failed:`, r.reason?.message || r.reason);
    });
    return ok;
  });
}
