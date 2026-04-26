/**
 * 清大職涯發展組(ccd.nthu.edu.tw)爬蟲
 * - 列表頁:/events
 * - 詳情頁:/event/{id}
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://ccd.nthu.edu.tw";

interface ListItem {
  id: string;
  title: string;
  date: string;
  unit?: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="/event/"]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/\/event\/(\d+)/);
    if (!m) return;
    const id = m[1];
    if (items.find((x) => x.id === id)) return;

    const text = normalizeText($a.text());
    if (!text || text.length < 4) return;

    const dateMatch = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
      : "";

    // anchor 內含多個 div(日期、單位、標題);取最後一個非日期、非單位的 div 為標題
    const innerDivs = $a.find("div").map((__: number, d: any) => normalizeText($(d).text())).get().filter(Boolean);
    let title = "";
    // 從最後往前找第一個不是純日期、不是「學務處職涯發展組」之類單位名稱的
    for (let i = innerDivs.length - 1; i >= 0; i--) {
      const candidate = innerDivs[i];
      if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(candidate)) continue;
      if (/^學務處|職涯發展組|職涯中心$/.test(candidate)) continue;
      if (candidate.length < 4) continue;
      title = candidate;
      break;
    }
    // 後備:取整段文字並移除日期
    if (!title) {
      title = text
        .replace(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s*\([^)]+\)?/g, "")
        .replace(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, "")
        .replace(/週[一二三四五六日]/g, "")
        .replace(/\n+/g, " ")
        .trim();
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title) return;

    items.push({ id, title, date });
  });
  return items;
}

interface DetailFields {
  description: string;
  venue: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  registrationDeadline: Date | null;
  organizer: string;
  feeType: "free" | "paid" | "unknown";
  feeAmount: number | null;
  maxCapacity: number | null;
}

function parseDetail(html: string, fallbackDate: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = normalizeText($("main, article, .content, #content, body").first().text());

  // 限制長度避免吃到下一個欄位;只取到第一個常見欄位分隔符前
  const STOP = /[\n。;；]|報名|時\s*間|地\s*點|地\s*址|對\s*象|名\s*額|費\s*用|聯絡/;
  const grab = (re: RegExp, max = 40): string => {
    const m = bodyText.match(re);
    if (!m) return "";
    let s = m[1].slice(0, max);
    const stopIdx = s.search(STOP);
    if (stopIdx > 5) s = s.slice(0, stopIdx);
    return s.trim();
  };

  const timeText = grab(/(?:活動時間|時\s*間|日\s*期)[:：\s]+([^\n]+)/, 60);
  const venueText = grab(/(?:地\s*點|地址|位置)[:：\s]+([^\n]+)/, 80);
  const deadlineText = grab(/(?:報名截止|報名期限|截止)[:：\s]+([^\n]+)/, 50);
  const organizerText = grab(/(?:主\s*辦|承\s*辦)[:：\s]+([^\n]+)/, 30);
  const capacityMatch = bodyText.match(/(?:名額|人數|限額)[:：\s]+(\d+)/);
  const feeFree = /免費|不收費/.test(bodyText);
  const feeMatch = bodyText.match(/(?:費用|報名費|金額)[:：\s]*(?:NT\$|TWD|NTD|新台幣)?\s*(\d+)/);

  const baseDate = parseDateLoose(fallbackDate) || new Date();
  let startDateTime: Date | null = baseDate;
  let endDateTime: Date | null = (() => { const d = new Date(baseDate); d.setHours(23, 59, 59, 999); return d; })();

  if (timeText) {
    const explicit = parseDateLoose(timeText);
    const dateBase = explicit || baseDate;
    const range = applyTimeRange(timeText, dateBase);
    startDateTime = range.start;
    endDateTime = range.end;
  }

  let description = normalizeText($("main, article, .content, #content").first().text()).slice(0, 3000);
  if (description.length < 50) description = "詳情請見清大職涯發展組原始頁面。";

  const registrationDeadline = deadlineText ? parseDateLoose(deadlineText) : null;

  return {
    description,
    venue: venueText,
    startDateTime,
    endDateTime,
    registrationDeadline,
    organizer: organizerText || "清大職涯發展組",
    feeType: feeFree ? "free" : feeMatch ? "paid" : "unknown",
    feeAmount: feeMatch ? parseInt(feeMatch[1], 10) : null,
    maxCapacity: capacityMatch ? parseInt(capacityMatch[1], 10) : null,
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  let activityType: ActivityType =
    inferActivityType(item.title) ||
    (/諮詢|1對1|一對一/.test(item.title) ? "交流活動" : "其他");

  return {
    id: `nthu_${item.id}`,
    school: "nthu",
    sourceExternalId: item.id,
    sourceUrl: `${BASE}/event/${item.id}`,
    title: item.title,
    description: detail?.description || "詳情請見清大職涯發展組原始頁面。",
    activityType,
    organizerName: detail?.organizer || "清大職涯發展組",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: detail?.registrationDeadline ? detail.registrationDeadline.toISOString() : null,
    venueType: detail?.venue ? "physical" : "unknown",
    venueAddress: detail?.venue || null,
    feeType: detail?.feeType || "unknown",
    feeAmount: detail?.feeAmount ?? null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: detail?.maxCapacity ?? null,
  };
}

export async function scrapeNthuActivities(): Promise<Activity[]> {
  let listHtml: string;
  try {
    listHtml = await fetchHtml(`${BASE}/events`);
  } catch (err: any) {
    console.warn("[nthu] list failed:", err?.message);
    return [];
  }
  const items = parseList(listHtml);
  if (items.length === 0) return [];

  const activities = await settled(
    items.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/event/${item.id}`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "nthu:detail"
  );

  return activities;
}
