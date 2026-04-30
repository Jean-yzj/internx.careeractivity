/**
 * 淡江大學 活動報名系統 (enroll.tku.edu.tw) 爬蟲
 * - 列表: /index.aspx?pg={1,2,3}  (table 結構)
 * - 詳情: /course.aspx?cid={活動代碼}
 *
 * 活動代碼前綴規則(觀察):
 *   AS = 社團輔導;  AL = 學術發展;  PN = ?;  TA = 認證培訓
 *
 * 因為沒有明確「職涯」分類,以關鍵字過濾標題:職涯/履歷/面試/實習/徵才/業界/業師/校友/職場/求職
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://enroll.tku.edu.tw";
const PAGES_TO_SCAN = 5;

// 職涯活動的核心關鍵字 — 標題必含其中之一才會被收錄
const CAREER_KEYWORDS = [
  "職涯", "履歷", "面試", "實習", "徵才", "業界", "業師", "校友",
  "職場", "求職", "企業參訪", "校園徵才", "招募", "就業", "業界導師",
  "職場力", "職能", "選才", "職涯探索", "職場新鮮人", "畢業生",
  "轉職", "薪資", "面談", "求職力",
];

// 非職涯活動關鍵字 — 即使含上面關鍵字,只要標題含這些也排除
const NON_CAREER_REJECT = [
  "學位論文", "口試", "選課", "註冊", "請領", "緩徵", "就學貸款",
  "個資蒐集", "宿舍", "校友會年會", "退休", "導師會",
];

interface ListItem {
  cid: string;
  title: string;
  startDate: string;
  endDate: string;
  organizer: string;
  registrationStart: string;
  registrationEnd: string;
}

function parseList(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];

  // 找到含「活動名稱」表頭的 table
  $("table").each((_: number, table: any) => {
    const $table = $(table);
    const headerText = normalizeText($table.find("tr").first().text());
    if (!/活動名稱|活動起迄/.test(headerText)) return;

    $table.find("tr").each((rowIdx: number, tr: any) => {
      if (rowIdx === 0) return; // 表頭
      const $tr = $(tr);
      const $cells = $tr.find("td");
      if ($cells.length < 5) return;

      // table 欄位順序:序號 | 活動起迄日 | 活動名稱 | 對象 | 報名起迄日 | 承辦單位 | 我要報名
      const datesText = normalizeText($cells.eq(1).text());
      const $titleCell = $cells.eq(2);
      const title = normalizeText($titleCell.text());
      const $titleLink = $titleCell.find('a[href*="course.aspx"], a[href*="cid="]').first();

      let cid = "";
      if ($titleLink.length) {
        const href = $titleLink.attr("href") || "";
        const m = href.match(/cid=([A-Za-z0-9]+)/);
        if (m) cid = m[1];
      }
      // 也檢查整列其他欄位的連結
      if (!cid) {
        $tr.find('a[href*="cid="]').each((_: number, a: any) => {
          if (cid) return;
          const href = $(a).attr("href") || "";
          const m = href.match(/cid=([A-Za-z0-9]+)/);
          if (m) cid = m[1];
        });
      }
      if (!cid || !title || title.length < 4) return;

      // 解析活動起迄日(可能是「2026/05/18 09:00 ~ 2026/05/18 12:00」這種格式)
      const dateRangeMatch = datesText.match(/(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})[^\d]*(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})?/);
      const startDate = dateRangeMatch?.[1] || "";
      const endDate = dateRangeMatch?.[2] || startDate;

      const organizer = $cells.length >= 6 ? normalizeText($cells.eq(5).text()) : "";
      const regText = $cells.length >= 5 ? normalizeText($cells.eq(4).text()) : "";
      const regRangeMatch = regText.match(/(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})[^\d]*(\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})?/);

      items.push({
        cid,
        title,
        startDate,
        endDate,
        organizer,
        registrationStart: regRangeMatch?.[1] || "",
        registrationEnd: regRangeMatch?.[2] || "",
      });
    });
  });

  return items;
}

function isCareerRelated(title: string): boolean {
  if (NON_CAREER_REJECT.some((kw) => title.includes(kw))) return false;
  return CAREER_KEYWORDS.some((kw) => title.includes(kw));
}

interface DetailFields {
  description: string;
  venue: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
  registrationDeadline: Date | null;
}

function parseDetail(html: string, fallbackStart: string, fallbackEnd: string, fallbackRegEnd: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = extractMainContent($, [".course-detail", ".activity-detail", ".event-content", "form"]);

  const STOP = /[\n。;；]|報名|時\s*間|地\s*點|地\s*址|對\s*象|名\s*額|費\s*用|聯絡/;
  const grab = (re: RegExp, max = 100): string => {
    const m = bodyText.match(re);
    if (!m) return "";
    let s = m[1].slice(0, max);
    const stopIdx = s.search(STOP);
    if (stopIdx > 5) s = s.slice(0, stopIdx);
    return s.trim();
  };

  const venueText = grab(/(?:活動地點|地\s*點|地址|位置)[:：\s]+([^\n]+)/, 100);

  const start = parseDateLoose(fallbackStart) || new Date();
  let end = parseDateLoose(fallbackEnd);
  if (!end) {
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  }
  // 嘗試從詳情頁解析時間範圍
  const timeMatch = bodyText.match(/(?:活動時間|時\s*間)[:：\s]+([^\n]+)/);
  if (timeMatch) {
    const range = applyTimeRange(timeMatch[1], start);
    if (range.start) end = range.end || end;
  }

  return {
    description: (isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 2500)) || "詳情請見淡江大學活動報名系統原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
    registrationDeadline: parseDateLoose(fallbackRegEnd),
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  const start = detail?.startDateTime || parseDateLoose(item.startDate) || new Date();
  const end = detail?.endDateTime || parseDateLoose(item.endDate) || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  const activityType: ActivityType = inferActivityType(item.title) || "講座";

  return {
    id: `tku_${item.cid}`,
    school: "tku",
    sourceExternalId: item.cid,
    sourceUrl: `${BASE}/course.aspx?cid=${item.cid}`,
    title: item.title,
    description: detail?.description || "詳情請見淡江大學活動報名系統原始頁面。",
    activityType,
    organizerName: item.organizer || "淡江大學",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: detail?.registrationDeadline?.toISOString() || parseDateLoose(item.registrationEnd)?.toISOString() || null,
    venueType: detail?.venue ? "physical" : "unknown",
    venueAddress: detail?.venue || null,
    feeType: "unknown",
    feeAmount: null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: null,
  };
}

export async function scrapeTkuActivities(): Promise<Activity[]> {
  // 平行抓 5 頁
  const pages = await Promise.allSettled(
    Array.from({ length: PAGES_TO_SCAN }, (_, i) => i + 1).map(async (pg) => {
      const html = await fetchHtml(`${BASE}/index.aspx?pg=${pg}`);
      return parseList(html);
    })
  );

  const allItems: ListItem[] = [];
  const seen = new Set<string>();
  pages.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        if (!seen.has(item.cid)) {
          seen.add(item.cid);
          allItems.push(item);
        }
      }
    } else {
      console.warn(`[tku] page ${idx + 1} failed:`, r.reason?.message);
    }
  });

  if (allItems.length === 0) return [];

  // 關鍵字過濾:只取職涯相關
  const careerItems = allItems.filter((it) => isCareerRelated(it.title));

  // 限制詳情頁抓取量
  const toFetch = careerItems.slice(0, 30);

  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/course.aspx?cid=${item.cid}`);
        return buildActivity(item, parseDetail(detailHtml, item.startDate, item.endDate, item.registrationEnd));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "tku:detail"
  );
}
