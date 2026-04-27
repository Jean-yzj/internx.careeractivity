# 技術交接文件 (Handoff)

> 給接手工程師看的快速啟動文件。

---

## 1. 程式碼在哪裡

| 項目 | 位置 |
|---|---|
| **GitHub repo** | https://github.com/Jean-yzj/internx.careeractivity |
| **本地路徑** | `~/Desktop/internx.careeractivity` |
| **線上部署** | https://careeractivity.zeabur.app |
| **部署平台** | [Zeabur](https://zeabur.com) (項目 ID: `69ed8ad02c891a4cefac2b36`) |

```bash
git clone https://github.com/Jean-yzj/internx.careeractivity.git
cd internx.careeractivity
npm install
npm run dev   # http://localhost:3000
```

---

## 2. 技術棧

- **框架**: Next.js 14 (Pages Router) + TypeScript
- **依賴**: 只有 4 個 — `next`, `react`, `react-dom`, `cheerio`
- **資料庫**: 無 — 使用 30 分鐘記憶體快取
- **部署**: Zeabur (auto-deploy on push to `main`)

---

## 3. 架構

```
使用者瀏覽器
   │
   ▼
pages/index.tsx (首頁,SSR)
   │  getServerSideProps
   ▼
pages/api/activities.ts (REST API)
   │
   ▼
lib/activities-cache.ts ──── 30 分鐘記憶體快取
   │
   ▼ Promise.allSettled (任一失敗不阻擋其他)
   │
   ├── lib/scrapers/nccu.ts   → moltke.nccu.edu.tw
   ├── lib/scrapers/ntu.ts    → career.ntu.edu.tw
   ├── lib/scrapers/nthu.ts   → career.site.nthu.edu.tw
   ├── lib/scrapers/ncku.ts   → grad-osa.ncku.edu.tw
   ├── lib/scrapers/nycu.ts   → osa.nycu.edu.tw
   ├── lib/scrapers/ntnu.ts   → careercenter.ntnu.edu.tw
   ├── lib/scrapers/ncu.ts    → careercenter.ncu.edu.tw
   └── lib/scrapers/nsysu.ts  → ag-osa.nsysu.edu.tw
```

### 關鍵檔案

| 檔案 | 作用 |
|---|---|
| `lib/types.ts` | `Activity`, `SchoolKey`, `SCHOOLS` 等型別與常數 |
| `lib/activities-cache.ts` | 8 校爬蟲協調,記憶體快取,30 分鐘 TTL |
| `lib/scrapers/common.ts` | 共用工具:`fetchHtml`, `parseDateLoose`, `applyTimeRange`, `inferActivityType` |
| `lib/scrapers/{school}.ts` | 各校獨立爬蟲(可單獨壞掉不影響其他校) |
| `pages/api/activities.ts` | List endpoint,支援 `?force=1` 強制重抓 |
| `pages/index.tsx` | 首頁:搜尋、學校/類型過濾、排序、隱藏已結束 |
| `pages/activity/[id].tsx` | 活動詳情頁 |

---

## 4. 各校爬蟲狀態

| 學校 | 來源 URL | 筆數 | 狀態 |
|---|---|---:|---|
| 政大 NCCU | `moltke.nccu.edu.tw` | 15 | ✅ 全部未來活動 |
| 台師大 NTNU | `careercenter.ntnu.edu.tw/lecture.php` | 30 | ✅ 充實 |
| 中央 NCU | `careercenter.ncu.edu.tw/news` | 30 | ✅ 充實 |
| 清大 NTHU | `career.site.nthu.edu.tw` | 9 | ✅ |
| 台大 NTU | `career.ntu.edu.tw` 公告 | 29 | ⚠️ 公告日 ≠ 事件日,要修 detail 頁解析 |
| 陽明交大 NYCU | `osa.nycu.edu.tw` 職涯講座 | 5 | ⚠️ 來源頁本身只 8 條 |
| 中山 NSYSU | `ag-osa.nsysu.edu.tw` | 2 | ⚠️ 過濾後剩 2 條 |
| 成大 NCKU | `grad-osa.ncku.edu.tw` | 5 | ⚠️ 來源沒更新 2026 春季 |

---

## 5. 增加新學校的步驟

1. 在 `lib/scrapers/` 加一個 `<school>.ts`,export 一個 `scrape<School>Activities(): Promise<Activity[]>`
2. 在 `lib/types.ts` 的 `SchoolKey` union 與 `SCHOOLS` 物件加入新學校
3. 在 `lib/activities-cache.ts` 的 `sources` 陣列註冊新爬蟲
4. 推到 main → Zeabur 自動部署

**模板**:可以直接複製 `lib/scrapers/ntnu.ts` 改造,結構最乾淨。

---

## 6. 常見維護工作

### 任務:某校爬蟲壞了
1. 檢查線上資料: `curl https://careeractivity.zeabur.app/api/activities?force=1 | jq '.activities | group_by(.school) | map({school: .[0].school, count: length})'`
2. 看 Zeabur logs(在 Zeabur 控制台)— 失敗的學校會 console.error
3. 開來源網站確認 HTML 結構是否變動
4. 修對應 `lib/scrapers/{school}.ts` 的 selector / regex
5. 本地 `npm run dev` 測 `http://localhost:3000/api/activities?force=1`
6. push 到 main

### 任務:強制重新抓取(線上)
```bash
curl https://careeractivity.zeabur.app/api/activities?force=1
```

### 任務:本地測試單一爬蟲
建一個 `scripts/test-scraper.ts`:
```typescript
import { scrapeNcuActivities } from "../lib/scrapers/ncu";
scrapeNcuActivities().then(acts => console.log(JSON.stringify(acts, null, 2)));
```
跑 `npx tsx scripts/test-scraper.ts`。

---

## 7. 已知 TODO(優先序)

1. **★★★ NTU 事件日修正** — 從 detail 頁解析「活動時間」欄位,目前抓的是公告日
2. **★★ NCKU 換資料源** — `activity.ncku.edu.tw` 有 Ajax 端點,比 grad-osa 新
3. **★★ NYCU 加第二來源** — `infonews.nycu.edu.tw` 有大量公告
4. **★ List API 描述截短** — 目前平均 1464 字,改 200 字可省 75% payload
5. **★ 加「我的最愛」localStorage** — 提升 retention
6. **★ RSS / iCal 訂閱端點** — 學生可訂閱進 Google Calendar

---

## 8. 部署細節

**Zeabur 自動部署**:推到 `main` → 自動 build & deploy(~2 分鐘)

**手動部署**(如果有需要):
```bash
npx zeabur@latest deploy \
  --project-id 69ed8ad02c891a4cefac2b36 \
  --service-id 69ed8ad825f731cd0f6d5c5f
```

**環境變數**:目前沒有任何 env vars 需要設定。

**沒有資料庫**:全部用記憶體快取 — 重啟後第一個請求會觸發完整爬取(約 10-20 秒),之後 30 分鐘內所有請求都吃快取(<1 秒)。

---

## 9. 設計決策(why we did this)

**為什麼用爬蟲不用各校 API?**
答:沒有大學提供公開 API。爬蟲是唯一選項。

**為什麼沒有資料庫?**
答:資料量小(<200 筆活動)、不需歷史記錄、加 DB 會增加部署複雜度。30 分鐘記憶體快取已夠用。

**為什麼用 Pages Router 不用 App Router?**
答:此專案需求簡單,Pages Router 學習曲線低,且 SSR 模式對 SEO 友善。

**為什麼每校獨立檔案不是統一抽象?**
答:8 所大學的 HTML 結構天差地別 — Plone CMS、SiteCake、自製 PHP、Vue SPA 都有。強行抽象會讓每個 case 都很彆扭。獨立檔案讓修一校 bug 不影響其他校。
