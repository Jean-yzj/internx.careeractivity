import type { NextApiRequest, NextApiResponse } from "next";
import { getActivities } from "@/lib/activities-cache";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const force = req.query.force === "1";
    const { activities, fetchedAt, fresh } = await getActivities({ force });
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1200");
    res.status(200).json({ ok: true, count: activities.length, fetchedAt, fresh, activities });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}
