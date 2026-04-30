import type { Activity } from "./types";
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
  const activities: Activity[] = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      activities.push(...r.value);
    } else {
      console.error(`[scraper:${sources[idx].name}] failed`, r.reason);
    }
  });

  // 預設依活動開始時間遞增排序(最近的活動在前)
  activities.sort((a, b) => {
    const ta = new Date(a.startDateTime).getTime();
    const tb = new Date(b.startDateTime).getTime();
    return ta - tb;
  });
  return activities;
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
