import type { Activity } from "./types";
import { cleanDescription } from "./scrapers/common";
import { scrapeNccuActivities } from "./scrapers/nccu";
import { scrapeNtuActivities } from "./scrapers/ntu";
import { scrapeNthuActivities } from "./scrapers/nthu";
import { scrapeNckuActivities } from "./scrapers/ncku";
import { scrapeNycuActivities } from "./scrapers/nycu";
import { scrapeNtnuActivities } from "./scrapers/ntnu";
import { scrapeNcuActivities } from "./scrapers/ncu";
import { scrapeNsysuActivities } from "./scrapers/nsysu";
import { scrapeTkuActivities } from "./scrapers/tku";
import { scrapeCcuActivities } from "./scrapers/ccu";
import { scrapeNchuActivities } from "./scrapers/nchu";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘

interface CacheEntry {
  fetchedAt: number;
  activities: Activity[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<Activity[]> | null = null;

async function scrapeAll(): Promise<Activity[]> {
  // 各校爬蟲在這裡平行執行;失敗的學校不阻擋其他學校
  const sources = [
    // 5 大校 + 師大
    { name: "nccu", run: () => scrapeNccuActivities() },
    { name: "ntu", run: () => scrapeNtuActivities() },
    { name: "nthu", run: () => scrapeNthuActivities() },
    { name: "ncku", run: () => scrapeNckuActivities() },
    { name: "nycu", run: () => scrapeNycuActivities() },
    { name: "ntnu", run: () => scrapeNtnuActivities() },
    // 中字輩
    { name: "ncu", run: () => scrapeNcuActivities() },     // 中央
    { name: "nchu", run: () => scrapeNchuActivities() },   // 中興
    { name: "ccu", run: () => scrapeCcuActivities() },     // 中正
    { name: "nsysu", run: () => scrapeNsysuActivities() }, // 中山
    // 雙北
    { name: "tku", run: () => scrapeTkuActivities() },     // 淡江(新北)
  ];

  const results = await Promise.allSettled(sources.map((s) => s.run()));
  const rawActivities: Activity[] = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      rawActivities.push(...r.value);
    } else {
      console.error(`[scraper:${sources[idx].name}] failed`, r.reason);
    }
  });

  // 全域品質過濾 — 確保使用者看到的每一筆都符合最低品質
  const NOW = Date.now();
  const ONE_YEAR_FUTURE = NOW + 365 * 24 * 3600 * 1000;
  const NINETY_DAYS_AGO = NOW - 90 * 24 * 3600 * 1000;

  const activities = rawActivities
    .filter((a) => {
      // 1) 標題太短或空 → 丟棄
      if (!a.title || a.title.trim().length < 4) return false;

      // 2) 起始日期必須有效且在合理範圍(< 1 年後)
      const start = new Date(a.startDateTime).getTime();
      if (Number.isNaN(start)) return false;
      if (start > ONE_YEAR_FUTURE) return false;

      // 3) end < start → 丟棄
      const end = new Date(a.endDateTime).getTime();
      if (Number.isNaN(end) || end < start) return false;

      // 4) 結束已超過 90 天 → 丟棄(過期太久,使用者不需要看到)
      if (end < NINETY_DAYS_AGO) return false;

      // 5) sourceUrl 必須存在
      if (!a.sourceUrl || !/^https?:\/\//.test(a.sourceUrl)) return false;

      return true;
    })
    .map((a) => {
      let out = a;

      // 標題雜訊清理:NBSP、首尾空白、首尾標點
      const cleanedTitle = (out.title || "")
        .replace(/\xa0/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/^[\s\.\-_,，。:：;；]+/, "")
        .trim();
      if (cleanedTitle !== out.title) {
        out = { ...out, title: cleanedTitle };
      }

      // 描述清理:開頭重複標題、多餘換行、報名系統 metadata
      if (out.description && !out.description.startsWith("📌")) {
        // 不動 NYCU 的結構化 fallback (📌 開頭)
        const cleaned = cleanDescription(out.description, out.title);
        if (cleaned !== out.description) {
          out = { ...out, description: cleaned };
        }
      }

      // 修正:報名截止日不該晚於活動開始日,若有矛盾就清掉 deadline
      if (out.registrationDeadline) {
        const rd = new Date(out.registrationDeadline).getTime();
        const sd = new Date(out.startDateTime).getTime();
        if (rd > sd) {
          out = { ...out, registrationDeadline: null };
        }
      }

      // 詳情頁抓不到內容(常見於 NYCU 等需登入站點)時,
      // 用 fallback 文案,但盡量補齊有用資訊
      const desc = out.description || "";
      const isLowQualityDesc =
        desc.length < 50 && /詳情請見.+原始頁面/.test(desc);
      if (isLowQualityDesc) {
        const startDate = new Date(out.startDateTime);
        const dateStr = `${startDate.getFullYear()}/${(startDate.getMonth() + 1)
          .toString()
          .padStart(2, "0")}/${startDate.getDate().toString().padStart(2, "0")}`;
        const enriched = [
          `📌 活動類型:${out.activityType}`,
          `🏛 主辦單位:${out.organizerName || "—"}`,
          `📅 預計舉辦:${dateStr}(以原始公告為準)`,
          out.venueAddress ? `📍 地點:${out.venueAddress}` : "",
          "",
          "由於此活動的詳情頁需登入或無法直接擷取,完整時間、地點、報名方式、講者資訊等,請點選下方「外部連結」前往原始公告查看。",
        ]
          .filter(Boolean)
          .join("\n");
        out = { ...out, description: enriched };
      }

      return out;
    });

  // 依活動開始時間遞增排序(最近的活動在前)
  activities.sort((a, b) => {
    const ta = new Date(a.startDateTime).getTime();
    const tb = new Date(b.startDateTime).getTime();
    return ta - tb;
  });

  // 同校 + 同(去除前綴後的)標題 → 只保留 sourceExternalId 較大者(較新公告)
  const dedupKey = (a: Activity) => {
    const t = a.title.replace(/^【[^】]+】\s*/, "").slice(0, 40);
    return `${a.school}::${t}`;
  };
  const seenKeys = new Map<string, Activity>();
  for (const a of activities) {
    const k = dedupKey(a);
    const existing = seenKeys.get(k);
    if (!existing) {
      seenKeys.set(k, a);
    } else {
      // 比較 sourceExternalId(數字較大通常較新)
      const newer = (a.sourceExternalId || "") > (existing.sourceExternalId || "");
      if (newer) seenKeys.set(k, a);
    }
  }
  const deduped = Array.from(seenKeys.values()).sort((a, b) => {
    return new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime();
  });

  console.log(
    `[cache] raw=${rawActivities.length} filtered=${activities.length} deduped=${deduped.length}`
  );
  return deduped;
}

export async function getActivities(options?: { force?: boolean }): Promise<{
  activities: Activity[];
  fetchedAt: number;
  fresh: boolean;
}> {
  const now = Date.now();
  const cacheValid =
    cache && !options?.force && now - cache.fetchedAt < CACHE_TTL_MS;
  if (cacheValid) {
    return { activities: cache!.activities, fetchedAt: cache!.fetchedAt, fresh: false };
  }

  if (!inflight) {
    inflight = scrapeAll().then(
      (activities) => {
        cache = { fetchedAt: Date.now(), activities };
        inflight = null;
        return activities;
      },
      (err) => {
        inflight = null;
        // 抓取失敗時,若還有舊快取就回舊資料,免讓使用者看到完全空白
        if (cache) return cache.activities;
        throw err;
      }
    );
  }

  const activities = await inflight;
  return { activities, fetchedAt: cache?.fetchedAt ?? Date.now(), fresh: true };
}

export function getActivityById(activities: Activity[], id: string): Activity | null {
  return activities.find((a) => a.id === id) || null;
}
