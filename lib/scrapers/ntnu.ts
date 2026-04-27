/**
 * 台灣師範大學 職涯資源網 (careercenter.ntnu.edu.tw) 爬蟲
 *
 * 三個來源頁:
 * - 徵才說明會: /lecture.php → 詳情 /lecture-detail.php?sid={id}
 * - 校外徵才活動: /zone1.php → 詳情 /seminar-detail.php?sid={id}
 * - 校外職涯活動: /list.php?type=info-recruit → 詳情 /list-detail.php?type=info-recruit&sid={id}
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://careercenter.ntnu.edu.tw";

type SourceKind = "lecture" | "seminar" | "info-recruit";

interface ListItem {
  sid: string;
  title: string;
  date: string;
  source: SourceKind;
}

function parseList(html: string, source: SourceKind): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  const detailPath = source === "lecture" ? "lecture-detail.php" : source === "seminar" ? "seminar-detail.php" : "list-detail.php";
  $(`a[href*="${detailPath}"]`).each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/sid=(\d+)/);
    if (!m) return;
    const sid = m[1];
    if (items.find((x) => x.sid === sid)) return;
    const title = normalizeText($a.text());
    if (!title || title.length < 4) return;

    const $row = $a.closest("li, tr, div, article");
    const rowText = normalizeText($row.text());
    const dateMatch = rowText.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "";

    items.push({ sid, title, date, source });
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
  const orgText = grab(/(?:主辦|公司|徵才單位|單位)[:：\s]+([^\n]+)/, 30);

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

  return {
    description: bodyText.slice(0, 2500) || "詳情請見台師大職涯資源網原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: null,
    organizer: orgText || "台師大職涯資源網",
    registrationLink: regLink,
  };
}

function detailUrl(item: ListItem): string {
  if (item.source === "lecture") return `${BASE}/lecture-detail.php?lang=zh-tw&sid=${item.sid}`;
  if (item.source === "seminar") return `${BASE}/seminar-detail.php?lang=zh-tw&sid=${item.sid}`;
  return `${BASE}/list-detail.php?lang=zh-tw&type=info-recruit&sid=${item.sid}`;
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  // 三個來源的預設類型不同
  const fallbackType: ActivityType =
    item.source === "lecture" ? "說明會" : item.source === "seminar" ? "說明會" : "講座";
  const activityType: ActivityType = inferActivityType(item.title) || fallbackType;

  // sid 在不同來源可能會撞,前綴避免衝突
  const idPrefix = item.source === "lecture" ? "L" : item.source === "seminar" ? "S" : "R";

  return {
    id: `ntnu_${idPrefix}${item.sid}`,
    school: "ntnu",
    sourceExternalId: `${idPrefix}${item.sid}`,
    sourceUrl: detailUrl(item),
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
  const sources: { kind: SourceKind; url: string }[] = [
    { kind: "lecture", url: `${BASE}/lecture.php` },
    { kind: "seminar", url: `${BASE}/zone1.php` },
    { kind: "info-recruit", url: `${BASE}/list.php?lang=zh-tw&type=info-recruit` },
  ];

  // 平行抓三個列表
  const lists = await Promise.allSettled(
    sources.map(async (s) => {
      const html = await fetchHtml(s.url);
      return parseList(html, s.kind);
    })
  );

  // 合併、去重(以 source+sid 為 key)
  const allItems: ListItem[] = [];
  const seen = new Set<string>();
  lists.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        const key = `${item.source}_${item.sid}`;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
        }
      }
    } else {
      console.warn(`[ntnu] list ${sources[idx].kind} failed:`, r.reason?.message);
    }
  });

  if (allItems.length === 0) return [];

  // 過濾掉太舊的(列表頁日期是「發布日」,大於 1 年前的不抓詳情頁省時間)
  const oneYearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  const recent = allItems.filter((it) => {
    const d = parseDateLoose(it.date);
    if (!d) return true; // 沒日期的保留
    return d.getTime() > oneYearAgo;
  });

  // 3 來源各取最多 25 筆,合計約 75 筆詳情頁
  const byKind: Record<SourceKind, ListItem[]> = { lecture: [], seminar: [], "info-recruit": [] };
  for (const it of recent) byKind[it.source].push(it);
  const toFetch = [
    ...byKind.lecture.slice(0, 25),
    ...byKind.seminar.slice(0, 25),
    ...byKind["info-recruit"].slice(0, 30),
  ];

  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(detailUrl(item));
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "ntnu:detail"
  );
}
