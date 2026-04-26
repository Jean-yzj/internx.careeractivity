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
