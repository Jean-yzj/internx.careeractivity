/**
 * 中山大學 校園生活與職涯發展組 (ag-osa.nsysu.edu.tw) 爬蟲
 * - 列表: /p/403-1087-5196-1.php?Lang=zh-tw (徵才/實習/職涯)
 * - 詳情: /p/406-1087-{編號},r5196.php?Lang=zh-tw
 *
 * 使用 Plone CMS,標題前綴有【徵才】【工讀】【講座】【活動】【重要資訊】等。
 * 過濾:只取【講座】【活動】,排除【徵才】【工讀】(那是工作機會)
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://ag-osa.nsysu.edu.tw";
const LIST_URL = `${BASE}/p/403-1087-5196-1.php?Lang=zh-tw`;

const ACCEPT_CATEGORIES = ["講座", "活動", "課程", "工作坊", "說明會", "競賽"];

interface ListItem {
  id: string;
  title: string;
  date: string;
  category: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="406-1087-"]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/406-1087-(\d+)/);
    if (!m) return;
    const id = m[1];
    if (items.find((x) => x.id === id)) return;

    const fullTitle = normalizeText($a.text());
    if (!fullTitle || fullTitle.length < 4) return;

    const catMatch = fullTitle.match(/^【([^】]+)】/);
    const category = catMatch ? catMatch[1] : "";
    const title = fullTitle.replace(/^【[^】]+】\s*/, "").trim() || fullTitle;

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
  const bodyText = extractMainContent($, [".mpgdetail", ".article-body", ".meditor"]);

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
    description: cleanDesc || "詳情請見中山大學職涯組原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: null,
    registrationLink: regLink,
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  let activityType: ActivityType;
  if (item.category === "講座") activityType = "講座";
  else if (item.category === "活動") activityType = inferActivityType(item.title) || "講座";
  else if (item.category === "工作坊") activityType = "工作坊";
  else if (item.category === "說明會") activityType = "說明會";
  else if (item.category === "競賽") activityType = "競賽";
  else if (item.category === "課程") activityType = inferActivityType(item.title) || "工作坊";
  else activityType = inferActivityType(item.title) || "其他";

  return {
    id: `nsysu_${item.id}`,
    school: "nsysu",
    sourceExternalId: item.id,
    sourceUrl: `${BASE}/p/406-1087-${item.id},r5196.php?Lang=zh-tw`,
    title: item.title,
    description: detail?.description || "詳情請見中山大學職涯組原始頁面。",
    activityType,
    organizerName: "中山大學校園生活與職涯發展組",
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

export async function scrapeNsysuActivities(): Promise<Activity[]> {
  let html: string;
  try {
    html = await fetchHtml(LIST_URL);
  } catch (err: any) {
    console.warn("[nsysu] list failed:", err?.message);
    return [];
  }
  const items = parseList(html);
  if (items.length === 0) return [];

  const filtered = items.filter((it) => ACCEPT_CATEGORIES.includes(it.category));
  const toFetch = filtered.slice(0, 25);
  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/p/406-1087-${item.id},r5196.php?Lang=zh-tw`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "nsysu:detail"
  );
}
