import Link from "next/link";
import { Activity } from "@/lib/types";
import { SCHOOLS } from "@/lib/types";
import styles from "./ActivityCard.module.css";

interface ActivityCardProps {
  activity: Activity;
}

const TYPE_ICONS: Record<string, string> = {
  "講座": "🎤",
  "說明會": "📢",
  "工作坊": "🛠️",
  "博覽會": "🏪",
  "交流活動": "💬",
  "競賽": "🏆",
  "企業參訪": "🏢",
  "校園大使": "🎒",
  "創業活動": "🚀",
  "其他": "📌",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function isPast(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

export default function ActivityCard({ activity }: ActivityCardProps) {
  const ended = isPast(activity.endDateTime);
  const school = SCHOOLS[activity.school];

  return (
    <Link href={`/activity/${activity.id}`} className={styles.cardLink}>
      <article className={`${styles.card} ${ended ? styles.cardEnded : ""}`}>
        <div className={styles.imageContainer}>
          <div
            className={styles.imagePlaceholder}
            style={{ backgroundColor: ended ? "#9ca3af" : "var(--theme-color)" }}
          >
            <span className={styles.imageIcon}>
              {TYPE_ICONS[activity.activityType] || "📌"}
            </span>
            <span className={styles.imageSchool}>{school?.shortName || activity.school}</span>
          </div>
          <div className={`${styles.typeTag} ${ended ? styles.typeTagEnded : ""}`}>
            {TYPE_ICONS[activity.activityType] || "📌"} {activity.activityType}
          </div>
        </div>
        <div className={styles.content}>
          <div className={styles.dateRow}>
            <span>{formatDate(activity.startDateTime)}</span>
            <span className={styles.dot}>·</span>
            <span>{formatTime(activity.startDateTime)}</span>
          </div>
          <h3 className={styles.title}>{activity.title}</h3>
          <div className={styles.metaInfo}>
            <div className={styles.metaItem}>
              <span className={styles.metaIcon}>🏛️</span>
              <span className={styles.metaText}>{activity.organizerName || school?.name || "—"}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaIcon}>📍</span>
              <span className={styles.metaText}>
                {activity.venueAddress
                  ? activity.venueAddress
                  : activity.venueType === "online"
                  ? "線上活動"
                  : "地點待公布"}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaIcon}>💰</span>
              <span className={styles.metaText}>
                {activity.feeType === "free"
                  ? "免費"
                  : activity.feeType === "paid"
                  ? activity.feeAmount
                    ? `NT$${activity.feeAmount}`
                    : "收費(詳洽主辦方)"
                  : "費用詳洽主辦方"}
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
