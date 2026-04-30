/**
 * 陽明交通大學 學務處職涯發展組 (osa.nycu.edu.tw) 爬蟲
 * - 列表: /osa/ch/app/data/list?module=nycu0106&id=3601 (職涯講座)
 * - 詳情: /osa/ch/app/data/view?module=nycu0106&id=3601&serno={id}
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://osa.nycu.edu.tw";
const LIST_URL = `${BASE}/osa/ch/app/data/list?module=nycu0106&id=3601&pageSize=50`;

interface ListItem {
  serno: string;
  title: string;
  date: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  // 只抓 module=nycu0106 的 view 連結(那才是職涯講座條目);
  // 其他 serno 連結是側邊選單/導覽,要排除
  $('a[href*="module=nycu0106"][href*="view"][href*="serno="]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/serno=([0-9]+)/);
    if (!m) return;
    const serno = m[1];
    if (items.find((x) => x.serno === serno)) return;
    let title = normalizeText($a.text());
    if (!title || title.length < 4) return;

    // 標題裡可能含「更新日期：114-10-13 發布單位：XXX」前綴,剝掉
    title = title
      .replace(/更新日期[:：]\s*\d{2,4}[\-\/]\d{1,2}[\-\/]\d{1,2}\s*/, "")
      .replace(/發布單位[:：]\s*[^\s】]+\s*/, "")
      .replace(/^[\s\n]+/, "")
      .replace(/\n+/g, " ")
      .trim();
    if (!title || title.length < 4) return;
    // 過濾掉導覽選項(無『講座/活動/工作坊/競賽/說明會/體驗/分享』等字眼且不以【開頭)
    const looksLikeActivity =
      /^【/.test(title) ||
      /講座|活動|工作坊|競賽|說明會|體驗|分享|博覽|論壇|徵才|招募|實習|研習|招生|培訓|諮詢/.test(title);
    if (!looksLikeActivity) return;

    const $row = $a.closest("tr, li, div");
    const rowText = normalizeText($row.text());
    const dateMatch = rowText.match(/(\d{2,4})[\-\/年](\d{1,2})[\-\/月](\d{1,2})/);
    let date = "";
    if (dateMatch) {
      const yRaw = parseInt(dateMatch[1], 10);
      const y = yRaw < 1911 ? yRaw + 1911 : yRaw;
      date = `${y}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
    }

    items.push({ serno, title, date });
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
  const bodyText = extractMainContent($, [".data-view", ".article-content", ".content-body"]);

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

  // 抓報名連結(若有 google form / 外部連結)
  let regLink: string | null = null;
  $('a[href*="forms.gle"], a[href*="docs.google"], a[href*="bit.ly"]').each((_: number, a: any) => {
    if (!regLink) regLink = $(a).attr("href") || null;
  });

  const description = (isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 2500)) || "詳情請見陽明交通大學職涯講座原始頁面。";

  return {
    description,
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

  let activityType: ActivityType = inferActivityType(item.title) || "講座";

  return {
    id: `nycu_${item.serno}`,
    school: "nycu",
    sourceExternalId: item.serno,
    sourceUrl: `${BASE}/osa/ch/app/data/view?module=nycu0106&id=3601&serno=${item.serno}`,
    title: item.title,
    description: detail?.description || "詳情請見陽明交通大學職涯講座原始頁面。",
    activityType,
    organizerName: "陽明交通大學學務處職涯發展組",
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

export async function scrapeNycuActivities(): Promise<Activity[]> {
  let html: string;
  try {
    html = await fetchHtml(LIST_URL);
  } catch (err: any) {
    console.warn("[nycu] list failed:", err?.message);
    return [];
  }
  const items = parseList(html);
  if (items.length === 0) return [];

  return settled(
    items.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/osa/ch/app/data/view?module=nycu0106&id=3601&serno=${item.serno}`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "nycu:detail"
  );
}
