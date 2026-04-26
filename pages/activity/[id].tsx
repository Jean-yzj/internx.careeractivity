import type { GetServerSideProps } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import { getActivities, getActivityById } from "@/lib/activities-cache";
import { Activity, SCHOOLS } from "@/lib/types";
import styles from "./activity.module.css";

interface ActivityPageProps {
  activity: Activity | null;
}

const TYPE_ICONS: Record<string, string> = {
  "講座": "🎤", "說明會": "📢", "工作坊": "🛠️", "博覽會": "🏪",
  "交流活動": "💬", "競賽": "🏆", "企業參訪": "🏢",
  "校園大使": "🎒", "創業活動": "🚀", "其他": "📌",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW", {
    year: "numeric", month: "long", day: "numeric",
    weekday: "long", hour: "2-digit", minute: "2-digit",
  });
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("zh-TW", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
}

export default function ActivityPage({ activity }: ActivityPageProps) {
  if (!activity) {
    return (
      <>
        <Header />
        <main>
          <div className="container" style={{ padding: "60px 0", textAlign: "center" }}>
            <h2>找不到此活動</h2>
            <p style={{ color: "#666" }}>可能是已下架,或快取尚未刷新。</p>
            <Link href="/" className={styles.backLink}>
              ← 回到活動列表
            </Link>
          </div>
        </main>
      </>
    );
  }

  const school = SCHOOLS[activity.school];
  const ended = new Date(activity.endDateTime).getTime() < Date.now();
  const registrationClosed = activity.registrationDeadline
    ? new Date(activity.registrationDeadline).getTime() < Date.now()
    : false;

  return (
    <>
      <Header />
      <main>
        <div className={styles.heroSection}>
          <div className="container">
            <Link href="/" className={styles.backLink}>
              ← 回到活動列表
            </Link>
            <div className={styles.tagRow}>
              <span className={`${styles.typeTag} ${ended ? styles.typeTagEnded : ""}`}>
                {TYPE_ICONS[activity.activityType] || "📌"} {activity.activityType}
              </span>
              {school && <span className={styles.schoolTag}>{school.name}</span>}
              {ended && <span className={styles.endedTag}>已結束</span>}
              {!ended && registrationClosed && (
                <span className={styles.endedTag}>報名已截止</span>
              )}
            </div>
            <h1 className={styles.title}>{activity.title}</h1>
            <p className={styles.organizer}>{activity.organizerName}</p>
          </div>
        </div>

        <div className="container">
          <div className={styles.body}>
            <div className={styles.main}>
              <h2 className={styles.sectionTitle}>活動簡介</h2>
              <div className={styles.description}>
                {activity.description.split("\n").map((line, i) => (
                  <p key={i}>{line || "\u00A0"}</p>
                ))}
              </div>
            </div>

            <aside className={styles.sidebar}>
              <div className={styles.infoCard}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>📅 開始</span>
                  <span className={styles.infoValue}>{formatDateTime(activity.startDateTime)}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>🏁 結束</span>
                  <span className={styles.infoValue}>{formatDateTime(activity.endDateTime)}</span>
                </div>
                {activity.registrationDeadline && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>⏰ 報名截止</span>
                    <span className={styles.infoValue}>
                      {formatDateOnly(activity.registrationDeadline)}
                    </span>
                  </div>
                )}
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>📍 地點</span>
                  <span className={styles.infoValue}>
                    {activity.venueAddress
                      ? activity.venueAddress
                      : activity.venueType === "online"
                      ? "線上活動"
                      : "地點待公布"}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>💰 費用</span>
                  <span className={styles.infoValue}>
                    {activity.feeType === "free"
                      ? "免費"
                      : activity.feeType === "paid"
                      ? activity.feeAmount
                        ? `NT$${activity.feeAmount}`
                        : "收費(詳洽主辦方)"
                      : "費用詳洽主辦方"}
                  </span>
                </div>
                {activity.maxCapacity != null && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>👥 名額</span>
                    <span className={styles.infoValue}>{activity.maxCapacity} 人</span>
                  </div>
                )}
                {activity.contact.contactPersonName && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>📞 聯絡人</span>
                    <span className={styles.infoValue}>
                      {activity.contact.contactPersonName}
                      {activity.contact.phone ? ` · ${activity.contact.phone}` : ""}
                    </span>
                  </div>
                )}
                {activity.contact.email && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>📧 Email</span>
                    <a href={`mailto:${activity.contact.email}`} className={styles.infoLink}>
                      {activity.contact.email}
                    </a>
                  </div>
                )}
              </div>

              <a
                href={activity.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.ctaBtn} ${
                  ended || registrationClosed ? styles.ctaBtnDisabled : ""
                }`}
              >
                {ended ? "活動已結束" : registrationClosed ? "報名已截止" : "前往原始活動頁面 →"}
              </a>
              <p className={styles.sourceHint}>
                報名/詳細資訊請以 {school?.shortName || activity.school} 原始頁面為準
              </p>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<ActivityPageProps> = async (ctx) => {
  const id = ctx.params?.id as string;
  try {
    const { activities } = await getActivities();
    const activity = getActivityById(activities, id);
    if (!activity) {
      ctx.res.statusCode = 404;
      return { props: { activity: null } };
    }
    return { props: { activity } };
  } catch {
    return { props: { activity: null } };
  }
};
