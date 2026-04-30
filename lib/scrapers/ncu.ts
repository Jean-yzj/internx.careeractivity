/**
 * 中央大學 學務處職涯發展中心 (careercenter.ncu.edu.tw) 爬蟲
 * - 列表: /news (含【徵才】【實習】【活動】【甄試】【課程】【考試】【競賽】等分類前綴)
 * - 詳情: /news/show/{ID}
 *
 * 過濾原則:只取與「活動」相關的類別 — 活動/課程/競賽/講座
 * 排除:徵才/實習/甄試/考試(那些是工作機會而非活動)
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://careercenter.ncu.edu.tw";

const ACCEPT_CATEGORIES = ["活動", "課程", "競賽", "講座", "說明會", "工作坊"];
const REJECT_CATEGORIES = ["徵才", "實習", "甄試", "考試", "招募"];

interface ListItem {
  id: string;
  title: string;
  date: string;
  category: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="/news/show/"]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/\/news\/show\/(\d+)/);
    if (!m) return;
    const id = m[1];
    if (items.find((x) => x.id === id)) return;

    let fullTitle = normalizeText($a.text());
    if (!fullTitle || fullTitle.length < 4) return;

    // NCU anchor 文字結構:「YYYY-MM-DD點閱：N【類別】標題 YYYY-MM-DD【類別】標題(重複截斷)」
    // 第 1 步:剝掉開頭的日期 + 點閱次數
    fullTitle = fullTitle
      .replace(/^\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2}\s*/, "")
      .replace(/^點閱[:：]\s*\d+\s*/, "")
      .trim();
    // 第 2 步:剝掉中間出現的下一個日期之後的所有內容(那是重複)
    const nextDate = fullTitle.match(/\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2}/);
    if (nextDate && nextDate.index !== undefined && nextDate.index > 5) {
      fullTitle = fullTitle.slice(0, nextDate.index).trim();
    }
    fullTitle = fullTitle.replace(/\s*點閱[:：]\s*\d+\s*$/, "").trim();

    // 抓出前綴分類【XXX】
    const catMatch = fullTitle.match(/^【([^】]+)】/);
    const category = catMatch ? catMatch[1] : "";

    // 標題去掉前綴(顯示用)
    const title = fullTitle.replace(/^【[^】]+】\s*/, "").trim() || fullTitle;
    if (title.length < 4) return;

    const $row = $a.closest("li, tr, div, article");
    const rowText = normalizeText($row.text());
    const dateMatch = rowText.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "";

    items.push({ id, title, date, category });
  });
  return items;
}

interface DetailFields {
  description: string;
  venue: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  registrationDeadline: Date | null;
  registrationLink: string | null;
}

function parseDetail(html: string, fallbackDate: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = extractMainContent($, [".news-detail", ".news-content", ".article", ".article-body"]);

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
  const deadlineText = grab(/(?:報名截止|報名期限|截止)[:：\s]+([^\n]+)/, 50);

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

  const cleanDesc = isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 2500);

  return {
    description: cleanDesc || "詳情請見中央大學職涯發展中心原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: deadlineText ? parseDateLoose(deadlineText) : null,
    registrationLink: regLink,
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  // 由列表分類 + 標題綜合判斷類型
  let activityType: ActivityType;
  if (item.category === "活動") activityType = inferActivityType(item.title) || "講座";
  else if (item.category === "說明會") activityType = "說明會";
  else if (item.category === "工作坊") activityType = "工作坊";
  else if (item.category === "競賽") activityType = "競賽";
  else if (item.category === "課程") activityType = inferActivityType(item.title) || "工作坊";
  else if (item.category === "講座") activityType = "講座";
  else activityType = inferActivityType(item.title) || "其他";

  return {
    id: `ncu_${item.id}`,
    school: "ncu",
    sourceExternalId: item.id,
    sourceUrl: `${BASE}/news/show/${item.id}`,
    title: item.title,
    description: detail?.description || "詳情請見中央大學職涯發展中心原始頁面。",
    activityType,
    organizerName: "中央大學學務處職涯發展中心",
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

export async function scrapeNcuActivities(): Promise<Activity[]> {
  let html: string;
  try {
    html = await fetchHtml(`${BASE}/news`);
  } catch (err: any) {
    console.warn("[ncu] list failed:", err?.message);
    return [];
  }
  const items = parseList(html);
  if (items.length === 0) return [];

  // 過濾掉非活動類(徵才/實習/甄試/考試)
  const filtered = items.filter((it) => {
    if (REJECT_CATEGORIES.includes(it.category)) return false;
    // 沒有分類的:用 inferActivityType 嘗試,若回 null 也丟棄
    if (!it.category) return inferActivityType(it.title) !== null && !/徵才|招募/.test(it.title);
    return ACCEPT_CATEGORIES.includes(it.category);
  });

  // 限制詳情頁抓取
  const toFetch = filtered.slice(0, 30);
  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/news/show/${item.id}`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "ncu:detail"
  );
}
