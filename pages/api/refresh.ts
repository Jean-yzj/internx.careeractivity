import type { NextApiRequest, NextApiResponse } from "next";
import { getActivities } from "@/lib/activities-cache";

/**
 * 手動觸發重新爬取(可被 Zeabur cron 排程呼叫)
 * 安全:若設定環境變數 REFRESH_SECRET,則需在 query 帶 ?secret=xxx 才會生效
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const required = process.env.REFRESH_SECRET;
  if (required && req.query.secret !== required) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  try {
    const { activities, fetchedAt } = await getActivities({ force: true });
    res.status(200).json({ ok: true, count: activities.length, fetchedAt });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}
