# 大學職涯活動整合站 (InternX 分支)

獨立 Next.js 站點,整合各大學職涯中心活動。**完全獨立於 InternX 主站,不影響主站資料與程式碼。**

## Zeabur Deployment

- Project ID: `69ed8ad02c891a4cefac2b36`
- Service ID: `69ed8ad825f731cd0f6d5c5f`
- Environment ID: `69ed8ad0d34cd657ee3468c9`
- Region: `server-69c8c404726b92873462484f` (新加坡 Tencent Cloud)
- Dashboard: https://zeabur.com/projects/69ed8ad02c891a4cefac2b36

### Redeploy

```bash
cd ~/Desktop/internx.careeractivity
npx zeabur@latest deploy \
  --project-id 69ed8ad02c891a4cefac2b36 \
  --service-id 69ed8ad825f731cd0f6d5c5f \
  --json
```

⚠️ **重要**:redeploy 一定要帶 `--service-id`,否則會建一個重複的 service。

## GitHub

- Repo: https://github.com/Jean-yzj/internx.careeractivity
- Branch: `main`

## 架構摘要

- Next.js 14 Pages Router + TypeScript
- Scraper 在 `lib/scrapers/<school>.ts`,目前只有 `nccu.ts`(政大,改自實習通主站)
- `lib/activities-cache.ts` 統籌所有 scraper、做 30 分鐘 in-memory 快取
- `pages/index.tsx` 首頁列表 + 類型 tab + 學校/排序/搜尋篩選
- `pages/activity/[id].tsx` 活動詳情頁,「前往原始活動頁面」外連
- `pages/api/refresh.ts` 可被 cron 呼叫(若設定 `REFRESH_SECRET` 則需帶 secret)

## 加新學校的步驟

1. 在 `lib/scrapers/<school>.ts` 新增爬蟲(模仿 `nccu.ts`)
2. 在 `lib/activities-cache.ts` 的 `sources` 陣列加入新爬蟲
3. 在 `lib/types.ts` 的 `SCHOOLS` 加入學校 metadata
4. push 到 main → Zeabur auto-redeploy(若用 git deploy);否則手動 redeploy
