/**
 * 台灣師範大學 職涯資源網 (careercenter.ntnu.edu.tw) 爬蟲
 * - 徵才說明會列表: /lecture.php
 * - 詳情頁: /lecture-detail.php?lang=zh-tw&sid={id}
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://careercenter.ntnu.edu.tw";

interface ListItem {
  sid: string;
  title: string;
  date: string;
  company?: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="lecture-detail.php"]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/sid=(\d+)/);
    if (!m) return;
    const sid = m[1];
    if (items.find((x) => x.sid === sid)) return;
    const title = normalizeText($a.text());
    if (!title || title.length < 2) return;

    const $row = $a.closest("li, tr, div, article");
    const rowText = normalizeText($row.text());
    const dateMatch = rowText.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "";

    items.push({ sid, title, date });
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
  registrationLink: string | null;
}

function parseDetail(html: string, fallbackDate: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = normalizeText($("main, article, .content, #content, body").first().text());

  const STOP = /[\n。;；]|報名|時\s*間|地\s*點|地\s*址|對\s*象|名\s*額|費\s*用|聯絡/;
  const grab = (re: RegExp, max = 80): string => {
    const m = bodyText.match(re);
    if (!m) return "";
    let s = m[1].slice(0, max);
    const stopIdx = s.search(STOP);
    if (stopIdx > 5) s = s.slice(0, stopIdx);
    return s.trim();
  };

  const timeText = grab(/(?:活動時間|時\s*間|日\s*期)[:：\s]+([^\n]+)/, 80);
  const venueText = grab(/(?:地\s*點|地址|位置)[:：\s]+([^\n]+)/, 100);
  const orgText = grab(/(?:主辦|公司|徵才單位)[:：\s]+([^\n]+)/, 30);

  const baseDate = parseDateLoose(fallbackDate) || new Date();
  let start: Date | null = baseDate;
  let end: Date | null = (() => { const d = new Date(baseDate); d.setHours(23, 59, 59, 999); return d; })();
  if (timeText) {
    const explicit = parseDateLoose(timeText);
    const dateBase = explicit || baseDate;
    const range = applyTimeRange(timeText, dateBase);
    start = range.start;
    end = range.end;
  }

  let regLink: string | null = null;
  $('a[href*="forms.gle"], a[href*="docs.google"], a[href*="bit.ly"]').each((_: number, a: any) => {
    if (!regLink) regLink = $(a).attr("href") || null;
  });

  const description = bodyText.slice(0, 2500) || "詳情請見台師大職涯資源網原始頁面。";

  return {
    description,
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: null,
    organizer: orgText || "台師大職涯資源網",
    registrationLink: regLink,
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  // NTNU lecture.php 全部都是徵才說明會
  let activityType: ActivityType = inferActivityType(item.title) || "說明會";

  return {
    id: `ntnu_${item.sid}`,
    school: "ntnu",
    sourceExternalId: item.sid,
    sourceUrl: `${BASE}/lecture-detail.php?lang=zh-tw&sid=${item.sid}`,
    title: item.title,
    description: detail?.description || "詳情請見台師大職涯資源網原始頁面。",
    activityType,
    organizerName: detail?.organizer || "台師大職涯資源網",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: detail?.registrationDeadline?.toISOString() || null,
    venueType: detail?.venue ? "physical" : "unknown",
    venueAddress: detail?.venue || null,
    feeType: "unknown",
    feeAmount: null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: null,
  };
}

export async function scrapeNtnuActivities(): Promise<Activity[]> {
  let html: string;
  try {
    html = await fetchHtml(`${BASE}/lecture.php`);
  } catch (err: any) {
    console.warn("[ntnu] list failed:", err?.message);
    return [];
  }
  const items = parseList(html);
  if (items.length === 0) return [];

  // 限制詳情頁抓取量到前 30 筆,避免太慢
  const toFetch = items.slice(0, 30);
  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/lecture-detail.php?lang=zh-tw&sid=${item.sid}`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "ntnu:detail"
  );
}
