import Header from "@/components/Header";
import Link from "next/link";
import { SCHOOLS } from "@/lib/types";

export default function About() {
  return (
    <>
      <Header />
      <main>
        <div className="container" style={{ maxWidth: 760, padding: "40px 24px 80px" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, marginTop: 0 }}>關於本站</h1>
          <p style={{ color: "#444", lineHeight: 1.8 }}>
            本站是「實習通 InternX」的獨立分支站點,專門整合各大學職涯中心舉辦的公開活動 ——
            講座、工作坊、履歷健檢、畢業參訪、企業說明會等。
          </p>

          <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, borderLeft: "3px solid var(--theme-color)", paddingLeft: 10 }}>
            核心功能
          </h2>
          <ul style={{ color: "#444", lineHeight: 2 }}>
            <li>抓取各大學職涯中心公開活動列表</li>
            <li>依活動時間排序(最近開始的優先顯示)</li>
            <li>依活動類型分類:講座、說明會、工作坊、博覽會、交流活動、競賽、企業參訪、校園大使、創業活動、其他</li>
            <li>依學校、日期、關鍵字篩選</li>
            <li>30 分鐘自動更新一次最新資料</li>
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, borderLeft: "3px solid var(--theme-color)", paddingLeft: 10 }}>
            目前涵蓋學校
          </h2>
          <ul style={{ color: "#444", lineHeight: 2 }}>
            {Object.values(SCHOOLS).map((s) => (
              <li key={s.key}>
                {s.name}
                {s.key === "nccu" ? " ✅(已上線)" : " · 開發中"}
                {" "}—{" "}
                <a
                  href={s.homepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--link-color)" }}
                >
                  {s.homepageUrl}
                </a>
              </li>
            ))}
          </ul>

          <h2 style={{ fontSize: 20, fontWeight: 600, marginTop: 32, borderLeft: "3px solid var(--theme-color)", paddingLeft: 10 }}>
            資料來源與聲明
          </h2>
          <p style={{ color: "#444", lineHeight: 1.8 }}>
            本站僅整合各大學公開的活動列表頁面,所有報名資訊均導向各校原始網站,本站不儲存
            個人報名資料、不收費,也不影響各校現有報名系統。如有錯誤、需更正或下架活動,
            請聯絡我們。
          </p>

          <p style={{ marginTop: 32 }}>
            <Link href="/" style={{ color: "var(--link-color)" }}>
              ← 回到活動列表
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
