# 大學職涯活動整合站 (InternX 分支)

整合各大學職涯中心的講座、工作坊、履歷健檢、企業參訪等活動,依時間排序、按類型分類,讓學生一站找到所有公開活動。

本專案是「實習通 InternX」的獨立分支站點,完全獨立於主站運作,不影響主站資料。

## 目前資料來源

- 政治大學 學務處職涯中心(`moltke.nccu.edu.tw`)

未來會加入:台大、成大、清華、陽明交大、師大等。

## 活動分類(對齊實習通主站)

講座、說明會、工作坊、博覽會、交流活動、競賽、企業參訪、校園大使、創業活動、其他。

## 本地開發

```bash
npm install
npm run dev
# 開啟 http://localhost:3000
```

## 技術

- Next.js 14 (Pages Router)
- TypeScript
- cheerio(HTML 解析)
- 伺服器端記憶體快取(無資料庫,部署即可用)

## 部署

支援 Zeabur 一鍵部署(`output: "standalone"` + Dockerfile-free)。
