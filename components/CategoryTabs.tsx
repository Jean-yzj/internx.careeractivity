import { ACTIVITY_TYPES, ActivityType } from "@/lib/types";
import styles from "./CategoryTabs.module.css";

interface CategoryTabsProps {
  selected: ActivityType | "";
  counts: Record<string, number>;
  total: number;
  onChange: (key: ActivityType | "") => void;
}

const ICONS: Record<string, string> = {
  "": "🏠",
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

export default function CategoryTabs({ selected, counts, total, onChange }: CategoryTabsProps) {
  const tabs: Array<{ key: ActivityType | ""; label: string; count: number }> = [
    { key: "", label: "全部", count: total },
    ...ACTIVITY_TYPES.map((t) => ({ key: t, label: t, count: counts[t] || 0 })),
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.key || "all"}
            className={`${styles.tab} ${selected === tab.key ? styles.active : ""}`}
            onClick={() => onChange(tab.key)}
          >
            <span className={styles.icon}>{ICONS[tab.key] || "📌"}</span>
            <span className={styles.label}>{tab.label}</span>
            <span className={styles.count}>{tab.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
