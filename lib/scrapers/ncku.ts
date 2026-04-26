/**
 * 成大生涯發展組(grad-osa.ncku.edu.tw)爬蟲
 *
 * 成大職涯活動沒有單獨頁面,而是用「講座列表表格」呈現,每筆是一行(時間/講者/講題/地點)。
 * 我們抓兩個來源頁面:
 *   - /p/412-1054-15473.php:生涯規劃與名人書香系列講座
 *   - /p/412-1054-29890.php:職涯講座 x 學長姐分享/企業參訪
 * 每筆活動的 sourceUrl 統一指向其所在的列表頁(因為沒有獨立詳情頁)。
 *
 * 民國年常見格式:114/10/14、114年10月14日 → 西元 2025/10/14
 */
import * as cheerio from "cheerio";
import { fetchHtml, inferActivityType, normalizeText, applyTimeRange, parseDateLoose } from "./common";
import type { Activity, ActivityType } from "../types";

const BASE = "https://grad-osa.ncku.edu.tw";
const SOURCES: Array<{ url: string; defaultType: ActivityType; sourceTag: string }> = [
  {
    url: `${BASE}/p/412-1054-15473.php?Lang=zh-tw`,
    defaultType: "講座",
    sourceTag: "lecture",
  },
  {
    url: `${BASE}/p/412-1054-29890.php?Lang=zh-tw`,
    defaultType: "講座",
    sourceTag: "career",
  },
];

interface RawRow {
  rocDate: string;
  timeRange: string;
  speaker: string;
  title: string;
  venue: string;
}

/**
 * 從 HTML 中找出含「時間/講者/講題/地點」表頭的表格,逐列解析。
 * 表格欄序:時間 | 講者 | 講題 | 地點(個別頁面表頭可能略有差異)
 */
function parseTable(html: string): RawRow[] {
  const $ = cheerio.load(html);
  const rows: RawRow[] = [];

  $("table").each((_: number, table: any) => {
    const $table = $(table);
    const headerText = normalizeText($table.find("tr").first().text());
    // 篩選出包含「時間」「講題」(或「講者」)的表格
    if (!/時\s*間/.test(headerText)) return;
    if (!/(講題|題目|主題|內容)/.test(headerText) && !/講者/.test(headerText)) return;

    $table.find("tr").each((rowIdx: number, tr: any) => {
      if (rowIdx === 0) return; // 跳過表頭
      const $tr = $(tr);
      const cells = $tr.find("td").map((__: number, td: any) => normalizeText($(td).text())).get();
      if (cells.length < 3) return;

      // cells 通常是:[時間, 講者, 講題, 地點];有些列可能多一格
      const timeCell = cells[0] || "";
      // 抓日期(支援民國 / 西元)
      const dateMatch = timeCell.match(/(\d{2,4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
      if (!dateMatch) return;
      const rocDate = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
      const timeRange = (timeCell.match(/(\d{1,2}):\d{2}\s*[-~至]\s*\d{1,2}:\d{2}/) || [""])[0];

      const speaker = cells[1] || "";
      // 講題與地點:優先從第 3、4 欄取
      const titleRaw = cells[2] || "";
      const venue = cells[3] || cells[cells.length - 1] || "";

      // 標題清理:移除書名號、星號等多餘符號
      const title = titleRaw.replace(/^[「」『』《》【】\s*]+|[「」『』《》【】\s*]+$/g, "").trim();
      if (!title || title.length < 2) return;

      rows.push({ rocDate, timeRange, speaker: speaker.trim(), title, venue: venue.trim() });
    });
  });

  return rows;
}

function buildActivity(
  row: RawRow,
  source: typeof SOURCES[number],
  index: number
): Activity {
  const baseDate = parseDateLoose(row.rocDate) || new Date();
  const range = applyTimeRange(row.timeRange, baseDate);
  const fullTitle = row.speaker ? `${row.title}｜${row.speaker}` : row.title;

  // 類型推測:標題優先,若沒命中用 source.defaultType
  let activityType: ActivityType = inferActivityType(fullTitle) || source.defaultType;

  // 構造一個穩定 ID:source.tag + 日期 + 標題雜湊
  const dateKey = baseDate.toISOString().slice(0, 10).replace(/-/g, "");
  const titleSlug = row.title.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").slice(0, 12);
  const id = `ncku_${source.sourceTag}_${dateKey}_${titleSlug || index}`;

  return {
    id,
    school: "ncku",
    sourceExternalId: id.replace("ncku_", ""),
    sourceUrl: source.url,
    title: fullTitle,
    description: row.venue
      ? `講者:${row.speaker || "—"}\n地點:${row.venue}\n\n本活動由成大生涯發展組舉辦,詳情請見原始頁面。`
      : `講者:${row.speaker || "—"}\n\n本活動由成大生涯發展組舉辦,詳情請見原始頁面。`,
    activityType,
    organizerName: "成大生涯發展與就業輔導組",
    startDateTime: range.start.toISOString(),
    endDateTime: range.end.toISOString(),
    registrationDeadline: null,
    venueType: row.venue ? "physical" : "unknown",
    venueAddress: row.venue || null,
    feeType: "free",
    feeAmount: null,
    contact: { email: null, phone: null, contactPersonName: null },
    maxCapacity: null,
  };
}

export async function scrapeNckuActivities(): Promise<Activity[]> {
  const all: Activity[] = [];

  for (const source of SOURCES) {
    try {
      const html = await fetchHtml(source.url);
      const rows = parseTable(html);
      rows.forEach((row, idx) => {
        try {
          all.push(buildActivity(row, source, idx));
        } catch (err: any) {
          console.warn(`[ncku] build row failed:`, err?.message);
        }
      });
    } catch (err: any) {
      console.warn(`[ncku] fetch ${source.url} failed:`, err?.message);
    }
  }

  // 去重(同 id)
  const seen = new Set<string>();
  return all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}
