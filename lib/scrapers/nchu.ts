/**
 * 中興大學 學務處生涯發展中心 (osa.nchu.edu.tw) 爬蟲
 *
 * 資料源:eguide 活動報名系統
 * - 列表: /osa/cdc/sys/modules/eguide/
 * - 詳情: /osa/cdc/sys/modules/eguide/event.php?eid={eid}
 *
 * 注意:同系統含「全民原教週」「原住民資源中心」活動,需過濾掉非職涯活動
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://www.osa.nchu.edu.tw/osa/cdc/sys/modules/eguide";

// 排除非職涯類關鍵字(原民/族語/部落/社團 等)
const REJECT_KEYWORDS = ["原教", "原住民族", "族語", "部落", "魯凱", "排灣", "賽夏", "鄒族", "阿美", "泰雅", "布農", "卑南", "達悟"];

// 接受的職涯類關鍵字
const ACCEPT_KEYWORDS = [
  "職涯", "職業", "履歷", "面試", "實習", "徵才", "招募", "求職", "求才",
  "業師", "業界", "校友", "公司", "招生", "創業", "新創", "工作坊",
  "企業", "說明會", "博覽會", "參訪", "DISC", "性格", "適性",
  "妝容", "形象", "面談", "職場", "新鮮人",
];

interface ListItem {
  eid: string;
  title: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  $('a[href*="event.php?eid="]').each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/eid=(\d+)/);
    if (!m) return;
    const eid = m[1];
    if (items.find((x) => x.eid === eid)) return;
    const title = normalizeText($a.text());
    if (!title || title.length < 4) return;
    items.push({ eid, title });
  });
  return items;
}

function isCareerRelated(title: string): boolean {
  // 含「原教/族語」一律拒絕
  if (REJECT_KEYWORDS.some((kw) => title.includes(kw))) return false;
  // 含職涯關鍵字 → 通過
  return ACCEPT_KEYWORDS.some((kw) => title.includes(kw));
}

interface DetailFields {
  description: string;
  venue: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  registrationDeadline: Date | null;
  organizer: string;
}

function parseDetail(html: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = extractMainContent($, [".eguide", ".event-detail", ".content-area"]);

  const STOP = /[\n。;；]|報名|時\s*間|地\s*點|地\s*址|對\s*象|名\s*額|費\s*用|聯絡/;
  const grab = (re: RegExp, max = 100): string => {
    const m = bodyText.match(re);
    if (!m) return "";
    let s = m[1].slice(0, max);
    const stopIdx = s.search(STOP);
    if (stopIdx > 5) s = s.slice(0, stopIdx);
    return s.trim();
  };

  const timeText = grab(/(?:活動時間|時\s*間|日\s*期)[:：\s]+([^\n]+)/, 100);
  const venueText = grab(/(?:地\s*點|地址|位置)[:：\s]+([^\n]+)/, 100);
  const deadlineText = grab(/(?:報名截止|報名期限|截止)[:：\s]+([^\n]+)/, 80);
  const orgText = grab(/(?:主辦單位|主辦|承辦)[:：\s]+([^\n]+)/, 50);

  const baseDate = parseDateLoose(timeText) || new Date();
  let start: Date | null = baseDate;
  let end: Date | null = (() => { const d = new Date(baseDate); d.setHours(23, 59, 59, 999); return d; })();
  if (timeText) {
    const range = applyTimeRange(timeText, baseDate);
    start = range.start;
    end = range.end;
  }

  const cleanDesc = isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 2500);

  return {
    description: cleanDesc || "詳情請見中興大學生涯發展中心原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: parseDateLoose(deadlineText),
    organizer: orgText || "中興大學生涯發展中心",
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  // 標題剝去【XXX】前綴方便閱讀
  const cleanTitle = item.title.replace(/^【[^】]+】\s*/, "").trim() || item.title;
  const activityType: ActivityType = inferActivityType(item.title) || "講座";

  return {
    id: `nchu_${item.eid}`,
    school: "nchu",
    sourceExternalId: item.eid,
    sourceUrl: `${BASE}/event.php?eid=${item.eid}`,
    title: cleanTitle,
    description: detail?.description || "詳情請見中興大學生涯發展中心原始頁面。",
    activityType,
    organizerName: detail?.organizer || "中興大學生涯發展中心",
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

export async function scrapeNchuActivities(): Promise<Activity[]> {
  let html: string;
  try {
    html = await fetchHtml(`${BASE}/`);
  } catch (err: any) {
    console.warn("[nchu] list failed:", err?.message);
    return [];
  }
  const items = parseList(html);
  if (items.length === 0) return [];

  // 過濾掉非職涯活動(原住民相關等)
  const careerItems = items.filter((it) => isCareerRelated(it.title));

  // 限制詳情頁抓取
  const toFetch = careerItems.slice(0, 30);
  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/event.php?eid=${item.eid}`);
        return buildActivity(item, parseDetail(detailHtml));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "nchu:detail"
  );
}
