/**
 * 台大職涯中心(career.ntu.edu.tw/board)爬蟲
 * - 列表頁:/board/index/tab/{tab}/page/{n}
 *   tab 5=說明會, 6=活動 (徵才/實習/獎學金不抓 — 那是工作機會,不是活動)
 * - 詳情頁:/board/detail/sn/{sn}
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://career.ntu.edu.tw";

interface ListItem {
  sn: string;
  title: string;
  date: string;
  category: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="/board/detail/sn/"]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/\/board\/detail\/sn\/(\d+)/);
    if (!m) return;
    const sn = m[1];
    const title = normalizeText($a.text()).trim();
    if (!title) return;

    const $container = $a.closest("li, div.item, tr, article");
    const containerText = normalizeText($container.text());
    const dateMatch = containerText.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    const date = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
      : "";

    let category = "";
    const catMatch = containerText.match(/(置頂公告|活動|說明會|徵才|實習|獎學金|流向調查)/);
    if (catMatch) category = catMatch[1];

    if (!items.find((x) => x.sn === sn)) {
      items.push({ sn, title, date, category });
    }
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
}

function parseDetail(html: string, fallbackDate: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = extractMainContent($, [".board-detail", ".detail", ".article-content", ".post-content"]);

  const timeMatch = bodyText.match(/(?:活動時間|時\s*間|日\s*期)[:：\s]+([^\n。]{0,80})/);
  const venueMatch = bodyText.match(/(?:地\s*點|地點|地址)[:：\s]+([^\n。]{0,120})/);
  const deadlineMatch = bodyText.match(/(?:報名截止|報名期限|截止日期)[:：\s]+([^\n。]{0,80})/);
  const organizerMatch = bodyText.match(/(?:主辦單位|主辦|承辦)[:：\s]+([^\n。]{0,80})/);

  const baseDate = parseDateLoose(fallbackDate) || new Date();
  let startDateTime: Date | null = null;
  let endDateTime: Date | null = null;
  if (timeMatch) {
    const tt = timeMatch[1];
    const explicit = parseDateLoose(tt);
    const dateBase = explicit || baseDate;
    const range = applyTimeRange(tt, dateBase);
    startDateTime = range.start;
    endDateTime = range.end;
  } else {
    startDateTime = baseDate;
    endDateTime = new Date(baseDate); endDateTime.setHours(23, 59, 59, 999);
  }

  let registrationDeadline: Date | null = null;
  if (deadlineMatch) {
    registrationDeadline = parseDateLoose(deadlineMatch[1]);
  }

  // bodyText 已經是 extractMainContent 清過 nav/script/style 的版本
  let description = isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 3000);
  if (description.length < 30) description = "詳情請見台大職涯中心原始公告頁面。";

  return {
    description,
    venue: venueMatch ? venueMatch[1].trim() : "",
    startDateTime,
    endDateTime,
    registrationDeadline,
    organizer: organizerMatch ? organizerMatch[1].trim() : "臺大學生職業生涯發展中心",
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  let activityType: ActivityType = "其他";
  if (item.category === "說明會") activityType = "說明會";
  else if (item.category === "活動") activityType = inferActivityType(item.title) || "講座";
  else activityType = inferActivityType(item.title) || "其他";

  return {
    id: `ntu_${item.sn}`,
    school: "ntu",
    sourceExternalId: item.sn,
    sourceUrl: `${BASE}/board/detail/sn/${item.sn}`,
    title: item.title,
    description: detail?.description || "詳情請見台大職涯中心原始頁面。",
    activityType,
    organizerName: detail?.organizer || "臺大學生職業生涯發展中心",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: detail?.registrationDeadline ? detail.registrationDeadline.toISOString() : null,
    venueType: detail?.venue ? "physical" : "unknown",
    venueAddress: detail?.venue || null,
    feeType: "unknown",
    feeAmount: null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: null,
  };
}

export async function scrapeNtuActivities(options?: { maxPages?: number }): Promise<Activity[]> {
  const maxPages = options?.maxPages ?? 3;
  const allItems: ListItem[] = [];

  const tabs: number[] = [6, 5];

  for (const tab of tabs) {
    for (let page = 1; page <= maxPages; page++) {
      try {
        const html = await fetchHtml(`${BASE}/board/index/tab/${tab}/page/${page}`);
        const items = parseList(html);
        if (items.length === 0) break;
        allItems.push(...items);
      } catch (err: any) {
        console.warn(`[ntu] list tab=${tab} page=${page} failed:`, err?.message);
        break;
      }
    }
  }

  const seen = new Set<string>();
  const unique = allItems.filter((it) => {
    if (seen.has(it.sn)) return false;
    seen.add(it.sn);
    return true;
  });

  const filtered = unique.filter((it) => !["徵才", "實習", "獎學金", "流向調查"].includes(it.category));
  const toFetch = filtered.slice(0, 30);

  const activities = await settled(
    toFetch.map(async (item) => {
      try {
        const html = await fetchHtml(`${BASE}/board/detail/sn/${item.sn}`);
        const detail = parseDetail(html, item.date);
        return buildActivity(item, detail);
      } catch {
        return buildActivity(item, null);
      }
    }),
    "ntu:detail"
  );

  return activities;
}
