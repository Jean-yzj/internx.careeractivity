/**
 * 政治大學職涯活動爬蟲(改自實習通主站 pages/api/nccu-sync-activities.js)
 * 來源:moltke.nccu.edu.tw 報名系統,篩選「活動類型=職涯發展、承辦單位=學務處」。
 */
import * as cheerio from "cheerio";
import https from "https";
import crypto from "crypto";
import type { Activity, ActivityType } from "../types";

const QUERY_URL = "https://moltke.nccu.edu.tw/Registration/registration.do?action=query";
const BASE_URL = "https://moltke.nccu.edu.tw/Registration/";

const SEARCH_FORM = new URLSearchParams({
  curtpe: "13",
  unit: "M00",
  sdate: "",
  edate: "",
  curnam: "",
}).toString();

// 政大伺服器使用較舊的 TLS renegotiation,Node 18+ 預設關閉,需允許 legacy renegotiation
const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION =
  (crypto.constants as any).SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION ?? 0x00040000;
const legacyAgent = new https.Agent({
  secureOptions: SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
});

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; InternX-CareerActivity/1.0)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-TW,zh;q=0.9",
        },
        agent: legacyAgent,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
  });
}

function httpsPost(url: string, formBody: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(formBody, "utf8");
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; InternX-CareerActivity/1.0)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "zh-TW,zh;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": String(body.length),
        },
        agent: legacyAgent,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// NCCU 改用 common.ts 的 inferActivityType (規則更完整),
// 若 common 判斷不出再 fallback 到本檔案的補充規則
import { inferActivityType as commonInferType } from "./common";

const ACTIVITY_TYPE_KEYWORDS: Array<[string, ActivityType]> = [
  ["企業參訪", "企業參訪"],
  ["說明會", "說明會"],
  ["講座", "講座"],
  ["工作坊", "工作坊"],
  ["博覽會", "博覽會"],
  ["交流活動", "交流活動"],
  ["競賽", "競賽"],
  ["校園大使", "校園大使"],
  ["創業", "創業活動"],
  ["履歷", "工作坊"],
  ["模擬面試", "工作坊"],
  // 額外:面試/求職/職涯類關鍵字 → 講座
  ["面試", "講座"],
  ["求職", "講座"],
  ["職涯", "講座"],
  ["公職", "講座"],
  ["AI 新手", "工作坊"],
  ["培訓", "工作坊"],
  ["新手村", "工作坊"],
];

function inferActivityType(title: string): ActivityType {
  // 先用 common 規則(更完整),命中就回傳
  const common = commonInferType(title);
  if (common && common !== "其他") return common;
  // 再用本檔案規則
  for (const [keyword, atype] of ACTIVITY_TYPE_KEYWORDS) {
    if (title && title.includes(keyword)) return atype;
  }
  return "其他";
}

function parseDateTw(s: string): Date | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(y, mo - 1, d, 0, 0, 0);
  return isNaN(date.getTime()) ? null : date;
}

function parseTimeRange(timeText: string, baseDate: Date | null): [Date | null, Date | null] {
  if (!baseDate) return [null, null];
  const t = (timeText || "").trim();

  let m = t.match(/中午?\s*(\d{1,2}):(\d{2})至(\d{1,2}):(\d{2})/);
  if (m) {
    const [, h1, mi1, h2, mi2] = m.map(Number);
    const startDt = new Date(baseDate); startDt.setHours(h1, mi1, 0, 0);
    const endDt = new Date(baseDate); endDt.setHours(h2, mi2, 0, 0);
    return [startDt, endDt];
  }

  m = t.match(/(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const [, h1, mi1, h2, mi2] = m.map(Number);
    const startDt = new Date(baseDate); startDt.setHours(h1, mi1, 0, 0);
    const endDt = new Date(baseDate); endDt.setHours(h2, mi2, 0, 0);
    return [startDt, endDt];
  }

  m = t.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const [, h1, mi1] = m.map(Number);
    const startDt = new Date(baseDate); startDt.setHours(h1, mi1, 0, 0);
    const endDt = new Date(startDt.getTime());
    return [startDt, endDt];
  }

  const startDt = new Date(baseDate);
  const endDt = new Date(baseDate); endDt.setHours(23, 59, 59, 999);
  return [startDt, endDt];
}

function parseRegistrationPeriod(text: string): Date | null {
  if (!text || typeof text !== "string") return null;
  const matches = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const parts = last.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!parts) return null;
  const [, y, mo, d] = parts.map(Number);
  const date = new Date(y, mo - 1, d, 23, 59, 0);
  return isNaN(date.getTime()) ? null : date;
}

interface ListItem {
  conference_id: string;
  title: string;
  summary: string;
  date_text: string;
  time_text: string;
}

async function fetchList(): Promise<ListItem[]> {
  const html = await httpsPost(QUERY_URL, SEARCH_FORM);
  const $ = cheerio.load(html);
  const items: ListItem[] = [];

  $("div.row.enr-list-sec").each((_: number, row: any) => {
    const $row = $(row);
    const $col9 = $row.find("div.col-sm-9").first();
    if (!$col9.length) return;

    const $a = $col9.find('h4 a[href*="conferenceID="]').first();
    if (!$a.length) return;
    const href = $a.attr("href") || "";
    const confMatch = href.match(/conferenceID=([A-Za-z0-9]+)/);
    const conference_id = confMatch ? confMatch[1] : "";
    if (!conference_id) return;

    const title = ($a.text() || "").trim();
    const summaryP = $col9.find("p.small.hidden-xs").first();
    const summary = summaryP.length ? summaryP.text().replace(/\s+/g, " ").trim() : "";

    let date_text = "";
    let time_text = "";
    $col9.find("div.row p").each((__: number, p: any) => {
      const $p = $(p);
      const html2 = $p.html() || "";
      const text = $p.text().trim();
      if (html2.includes("glyphicon-calendar")) date_text = text;
      else if (html2.includes("glyphicon-time")) time_text = text;
    });

    items.push({ conference_id, title, summary, date_text, time_text });
  });

  return items;
}

interface DetailFields {
  title?: string;
  date_text?: string;
  time_text?: string;
  venue?: string;
  organizer_name?: string;
  contact_line?: string;
  email?: string;
  description?: string;
  registration_period_text?: string;
  max_capacity_text?: string;
}

async function fetchDetail(conferenceId: string): Promise<DetailFields | null> {
  const url = `${BASE_URL}registration.do?action=conferenceInfo&conferenceID=${conferenceId}`;
  let html: string;
  try {
    html = await httpsGet(url);
  } catch {
    return null;
  }
  const $ = cheerio.load(html);
  const out: DetailFields = {};

  const h3 = $("h3.text-primary").first();
  if (h3.length) out.title = h3.text().trim();

  $("div.col-xs-12.small p").each((_: number, p: any) => {
    const $p = $(p);
    const html2 = $p.html() || "";
    const t = $p.text();
    if (t.includes("活動日期") && html2.includes("glyphicon-calendar")) {
      out.date_text = t.replace("活動日期:", "").replace("活動日期：", "").trim();
    }
    if (html2.includes("glyphicon-time")) {
      out.time_text = t.replace(/時間[:：]\s*/, "").split(/\s/)[0].trim();
    }
    if (html2.includes("glyphicon-map-marker")) {
      out.venue = t.replace("地點:", "").replace("地點：", "").trim();
    }
    if (html2.includes("glyphicon-info-sign")) {
      out.organizer_name = t.replace("承辦單位:", "").replace("承辦單位：", "").trim();
    }
    if (html2.includes("glyphicon-earphone")) {
      out.contact_line = t.replace("聯絡人:", "").replace("聯絡人：", "").trim();
    }
  });

  const mailA = $('a[href^="mailto:"]').first();
  if (mailA.length) {
    out.email = (mailA.attr("href") || "").replace("mailto:", "").trim();
  }

  function normalizeParagraphText(s: string): string {
    if (!s || typeof s !== "string") return "";
    return s.replace(/\r\n?|\n/g, "\n").replace(/\n+/g, "\n").replace(/[ \t]+/g, " ").trim();
  }
  $("h3").each((_: number, el: any) => {
    if (/簡介/.test($(el).text())) {
      const parent = $(el).closest("div.row");
      const parts: string[] = [];
      parent.find("p").each((__: number, p: any) => {
        if ($(p).closest("div.well").length) return;
        const text = normalizeParagraphText($(p).text());
        if (text && !text.includes("講座姓名")) parts.push(text);
      });
      if (parts.length) out.description = parts.join("\n\n");
    }
  });

  $("p.text-muted.small").each((_: number, tag: any) => {
    if ($(tag).text().includes("報名期間")) {
      out.registration_period_text = $(tag).text();
    }
  });

  $("div.text-info.small p").each((_: number, p: any) => {
    if ($(p).text().includes("招收名額")) {
      out.max_capacity_text = $(p).text().trim();
    }
  });

  return Object.keys(out).length ? out : null;
}

function buildActivity(listItem: ListItem, detail: DetailFields | null): Activity {
  const conferenceId = listItem.conference_id;
  const title = (detail && detail.title) || listItem.title || "";
  let description = (detail && detail.description) || listItem.summary || "";
  if (!description.trim()) description = "(無簡介)";

  const date_text = (detail && detail.date_text) || listItem.date_text || "";
  const time_text = (detail && detail.time_text) || listItem.time_text || "";

  const baseDate = parseDateTw(date_text) || new Date();
  const [startDt, endDt] = parseTimeRange(time_text, baseDate);

  const venue_address = (detail && detail.venue) || "";
  const organizer_name = (detail && detail.organizer_name) || "學務處職涯中心";
  const contact_line = (detail && detail.contact_line) || "";
  const email = (detail && detail.email) || "";

  let contact_name = contact_line;
  let phone = "";
  if (contact_line && /\d/.test(contact_line)) {
    const parts = contact_line.split(/\s+/);
    if (parts.length >= 2) {
      contact_name = parts[0];
      phone = parts.slice(1).join(" ");
    }
  }

  const reg_period_text = (detail && detail.registration_period_text) || "";
  const registration_deadline = parseRegistrationPeriod(reg_period_text);
  const start = startDt || baseDate;
  const end = endDt || start;

  // 用 action=conferenceInfo (活動詳情頁) 而非 action=register (報名表單)
  // register 對未登入訪客直接 HTTP 500,conferenceInfo 任何人都能看
  const source_url = `${BASE_URL}registration.do?action=conferenceInfo&conferenceID=${conferenceId}`;
  const activity_type = inferActivityType(title);

  const venueType: Activity["venueType"] = venue_address ? "physical" : "unknown";

  let maxCapacity: number | null = null;
  const capText = (detail && detail.max_capacity_text) || "";
  const capMatch = capText.match(/(\d+)\s*人/);
  if (capMatch) maxCapacity = parseInt(capMatch[1], 10);

  return {
    id: `nccu_${conferenceId}`,
    school: "nccu",
    sourceExternalId: conferenceId,
    sourceUrl: source_url,
    title,
    description,
    activityType: activity_type,
    organizerName: organizer_name,
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: registration_deadline ? registration_deadline.toISOString() : null,
    venueType,
    venueAddress: venue_address || null,
    feeType: "free",
    feeAmount: null,
    contact: {
      email: email || null,
      phone: phone || null,
      contactPersonName: contact_name || null,
    },
    maxCapacity,
  };
}

export async function scrapeNccuActivities(options?: { limit?: number }): Promise<Activity[]> {
  const listItems = await fetchList();
  if (!listItems || listItems.length === 0) return [];

  const seen = new Set<string>();
  const unique: ListItem[] = [];
  for (const item of listItems) {
    const cid = (item.conference_id || "").trim();
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    unique.push(item);
  }

  const toProcess = options?.limit ? unique.slice(0, options.limit) : unique;
  const activities: Activity[] = [];

  for (const item of toProcess) {
    let detail: DetailFields | null = null;
    try {
      detail = await fetchDetail(item.conference_id);
    } catch {
      detail = null;
    }
    activities.push(buildActivity(item, detail));
  }

  return activities;
}
