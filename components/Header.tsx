import Link from "next/link";
import styles from "./Header.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandIcon}>🎓</span>
          <span className={styles.brandText}>
            大學職涯活動整合
            <span className={styles.brandSub}>InternX 分支站</span>
          </span>
        </Link>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>
            活動列表
          </Link>
          <Link href="/about" className={styles.navLink}>
            關於本站
          </Link>
        </nav>
      </div>
    </header>
  );
}
