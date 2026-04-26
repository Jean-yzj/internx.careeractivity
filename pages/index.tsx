import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Header from "@/components/Header";
import CategoryTabs from "@/components/CategoryTabs";
import ActivityCard from "@/components/ActivityCard";
import { getActivities } from "@/lib/activities-cache";
import { Activity, ActivityType, SCHOOLS, SchoolKey } from "@/lib/types";
import styles from "./index.module.css";

interface HomeProps {
  activities: Activity[];
  fetchedAt: number;
  errorMessage?: string;
}

type SortKey = "upcoming" | "newest" | "deadline";

export default function Home({ activities, fetchedAt, errorMessage }: HomeProps) {
  const [selectedType, setSelectedType] = useState<ActivityType | "">("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolKey | "">("");
  const [hidePast, setHidePast] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("upcoming");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of activities) {
      if (hidePast && new Date(a.endDateTime).getTime() < Date.now()) continue;
      m[a.activityType] = (m[a.activityType] || 0) + 1;
    }
    return m;
  }, [activities, hidePast]);

  const totalForFilter = useMemo(() => {
    if (!hidePast) return activities.length;
    return activities.filter((a) => new Date(a.endDateTime).getTime() >= Date.now()).length;
  }, [activities, hidePast]);

  const filtered = useMemo(() => {
    let list = activities.slice();

    if (hidePast) {
      const now = Date.now();
      list = list.filter((a) => new Date(a.endDateTime).getTime() >= now);
    }
    if (selectedType) list = list.filter((a) => a.activityType === selectedType);
    if (selectedSchool) list = list.filter((a) => a.school === selectedSchool);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.organizerName.toLowerCase().includes(q) ||
          (a.description || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (sortKey === "newest") {
        return new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime();
      }
      if (sortKey === "deadline") {
        const da = a.registrationDeadline
          ? new Date(a.registrationDeadline).getTime()
          : Number.POSITIVE_INFINITY;
        const db = b.registrationDeadline
          ? new Date(b.registrationDeadline).getTime()
          : Number.POSITIVE_INFINITY;
        return da - db;
      }
      return new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime();
    });

    return list;
  }, [activities, selectedType, selectedSchool, hidePast, sortKey, search]);

  const updatedText = fetchedAt
    ? new Date(fetchedAt).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <>
      <Header />
      <main>
        <section className={styles.hero}>
          <div className="container">
            <h1 className={styles.heroTitle}>大學職涯活動,一站搞定</h1>
            <p className={styles.heroSubtitle}>
              整合各大學職涯中心的講座、工作坊、履歷健檢、企業參訪等公開活動,依時間排序、按類型分類。
            </p>
            <div className={styles.heroMeta}>
              <span className={styles.heroPill}>共 {activities.length} 筆活動</span>
              <span className={styles.heroPill}>資料更新於 {updatedText}</span>
              <span className={styles.heroPill}>30 分鐘自動更新</span>
            </div>
          </div>
        </section>

        <CategoryTabs
          selected={selectedType}
          counts={counts}
          total={totalForFilter}
          onChange={setSelectedType}
        />

        <section className="container">
          <div className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              <input
                className={styles.search}
                placeholder="搜尋活動標題、主辦單位..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className={styles.toolbarGroup}>
              <label className={styles.selectWrap}>
                <span className={styles.selectLabel}>學校</span>
                <select
                  value={selectedSchool}
                  onChange={(e) => setSelectedSchool(e.target.value as SchoolKey | "")}
                  className={styles.select}
                >
                  <option value="">全部學校</option>
                  {Object.values(SCHOOLS).map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.shortName}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.selectWrap}>
                <span className={styles.selectLabel}>排序</span>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className={styles.select}
                >
                  <option value="upcoming">最近活動優先</option>
                  <option value="newest">最新發布優先</option>
                  <option value="deadline">報名截止優先</option>
                </select>
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={hidePast}
                  onChange={(e) => setHidePast(e.target.checked)}
                />
                <span>隱藏已結束</span>
              </label>
            </div>
          </div>

          {errorMessage && (
            <div className={styles.alert}>
              抓取活動時發生錯誤:{errorMessage},顯示快取資料(若有)。
            </div>
          )}

          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <p>目前沒有符合條件的活動。</p>
              <p className={styles.emptyHint}>試著調整類型、學校或關鍵字看看。</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {filtered.map((a) => (
                <ActivityCard key={a.id} activity={a} />
              ))}
            </div>
          )}
        </section>

        <footer className={styles.footer}>
          <div className="container">
            <p>
              © {new Date().getFullYear()} 實習通 InternX 分支站 · 資料來源為各大學職涯中心公開頁面
            </p>
            <p className={styles.footerNote}>
              本站不儲存個人資料,所有活動報名均導向各校原始網站。
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async ({ res }) => {
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1200");
  try {
    const { activities, fetchedAt } = await getActivities();
    return {
      props: {
        activities,
        fetchedAt,
      },
    };
  } catch (e: any) {
    return {
      props: {
        activities: [],
        fetchedAt: 0,
        errorMessage: e?.message || "未知錯誤",
      },
    };
  }
};
