/**
 * 中正大學 中正徵才月 (gc.ccu.edu.tw) 爬蟲
 *
 * Plone-style site,結構與中山大學 (ag-osa.nsysu.edu.tw) 雷同。
 * 三類列表:
 * - 系列活動最新消息: /p/403-1040-100-1.php
 * - 企業說明會最新消息: /p/403-1040-515-1.php
 * - 就業博覽會最新消息: /p/403-1040-3815-1.php
 * 詳情頁: /p/406-1040-{ID},r{block}.php
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose, settled, extractMainContent, isLikelyNavText, extractDateFromTitle } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://gc.ccu.edu.tw";

interface SourceList {
  block: string; // r 參數的數字部分
  url: string;
  defaultType: ActivityType;
}

const LISTS: SourceList[] = [
  { block: "100", url: `${BASE}/p/403-1040-100-1.php`, defaultType: "講座" },     // 系列活動
  { block: "515", url: `${BASE}/p/403-1040-515-1.php`, defaultType: "說明會" },   // 企業說明會
  { block: "3815", url: `${BASE}/p/403-1040-3815-1.php`, defaultType: "博覽會" }, // 就業博覽會
];

interface ListItem {
  id: string;
  block: string;
  title: string;
  date: string;
  defaultType: ActivityType;
}

// 中正徵才月網的標題很多是行政公告(停車、棚架、預約狀況、報名公告等)而非活動本身。
// 這些一律過濾掉。
const NON_EVENT_REJECT = [
  // 工程/場地佈置
  "停車", "車輛", "棚架", "施工", "規定", "配置圖", "場地", "工程", "走廊",
  "場勘", "佈置", "搭設",
  // 行政流程
  "預約狀況", "報名公告", "招商", "招募廠商", "廠商招募",
  "重要通知", "重要事項", "注意事項", "須知", "辦法", "流程", "簡介",
  "退費", "繳費", "繳款", "票券",
  // 資料/影片
  "宣傳片", "形象片", "影片", "回顧", "懶人包", "成果報告", "簡報",
  // 給雇主的訊息
  "致企業", "敬告", "感謝廠商", "成果分享",
];

function isRealEvent(title: string): boolean {
  if (NON_EVENT_REJECT.some((kw) => title.includes(kw))) return false;
  // 「公告」開頭的標題 + 「企業/廠商報名」字眼通常是給雇主的徵才資訊,跳過
  if (/^【?公告】?/.test(title) && /(企業報名|廠商報名|報名公告)/.test(title)) return false;
  return true;
}

function parseList(html: string, block: string, defaultType: ActivityType): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  // detail link 樣式: /p/406-1040-XXXXX,rNNN.php
  $(`a[href*="406-1040-"]`).each((_: number, a: any) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const m = href.match(/406-1040-(\d+)/);
    if (!m) return;
    const id = m[1];
    if (items.find((x) => x.id === id)) return;
    const fullTitle = normalizeText($a.text());
    if (!fullTitle || fullTitle.length < 4) return;
    if (!isRealEvent(fullTitle)) return; // 過濾行政公告

    const $row = $a.closest("li, tr, div, article");
    const rowText = normalizeText($row.text());
    const dateMatch = rowText.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "";

    items.push({ id, block, title: fullTitle, date, defaultType });
  });
  return items;
}

interface DetailFields {
  description: string;
  venue: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
}

function parseDetail(html: string, fallbackDate: string): DetailFields {
  const $ = cheerio.load(html);
  const bodyText = extractMainContent($, [".meditor", ".mpgdetail", ".article-body"]);

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

  const baseDate = parseDateLoose(timeText) || parseDateLoose(fallbackDate) || new Date();
  let start: Date | null = baseDate;
  let end: Date | null = (() => { const d = new Date(baseDate); d.setHours(23, 59, 59, 999); return d; })();
  if (timeText) {
    const range = applyTimeRange(timeText, baseDate);
    start = range.start;
    end = range.end;
  }

  const cleanDesc = isLikelyNavText(bodyText) ? "" : bodyText.slice(0, 2500);

  return {
    description: cleanDesc || "詳情請見中正徵才月原始頁面。",
    venue: venueText,
    startDateTime: start,
    endDateTime: end,
  };
}

function buildActivity(item: ListItem, detail: DetailFields | null): Activity {
  // CCU 列表日期是「發布日」,不是活動日。改以 標題日期 > 詳情頁 > 發布日 為序
  const titleDate = extractDateFromTitle(item.title);
  const start = titleDate || detail?.startDateTime || parseDateLoose(item.date) || new Date();
  const end = detail?.endDateTime || (() => { const d = new Date(start); d.setHours(23, 59, 59, 999); return d; })();

  const activityType: ActivityType = inferActivityType(item.title) || item.defaultType;

  return {
    id: `ccu_${item.id}`,
    school: "ccu",
    sourceExternalId: item.id,
    sourceUrl: `${BASE}/p/406-1040-${item.id},r${item.block}.php?Lang=zh-tw`,
    title: item.title,
    description: detail?.description || "詳情請見中正徵才月原始頁面。",
    activityType,
    organizerName: "中正大學職涯發展中心",
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    registrationDeadline: null,
    venueType: detail?.venue ? "physical" : "unknown",
    venueAddress: detail?.venue || null,
    feeType: "unknown",
    feeAmount: null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: null,
  };
}

export async function scrapeCcuActivities(): Promise<Activity[]> {
  // 平行抓 3 個列表
  const lists = await Promise.allSettled(
    LISTS.map(async (s) => {
      const html = await fetchHtml(s.url);
      return parseList(html, s.block, s.defaultType);
    })
  );

  const allItems: ListItem[] = [];
  const seen = new Set<string>();
  lists.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          allItems.push(item);
        }
      }
    } else {
      console.warn(`[ccu] list ${LISTS[idx].url} failed:`, r.reason?.message);
    }
  });

  if (allItems.length === 0) return [];

  // 限制詳情頁抓取
  const toFetch = allItems.slice(0, 30);
  return settled(
    toFetch.map(async (item) => {
      try {
        const detailHtml = await fetchHtml(`${BASE}/p/406-1040-${item.id},r${item.block}.php?Lang=zh-tw`);
        return buildActivity(item, parseDetail(detailHtml, item.date));
      } catch {
        return buildActivity(item, null);
      }
    }),
    "ccu:detail"
  );
}
