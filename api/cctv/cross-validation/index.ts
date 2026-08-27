import { Redis } from "@upstash/redis";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = req.query || {};
  const direction: "N" | "S" = String(query.direction || "N").toUpperCase() === "S" ? "S" : "N";
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      const redis = new Redis({ url, token });
      const redisKey = `hsuehshan:cctv:cross_validation:${direction}`;
      const cached: any = await redis.get(redisKey);
      if (cached) {
        const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
        const cctvResult = parsed.cctvResult || parsed;
        const now = Date.now();
        const cachedAt = parsed.cachedAt || now;
        const elapsedSec = Math.floor((now - cachedAt) / 1000);
        const cacheTtlRemainingSec = Math.max(0, 360 - elapsedSec);

        return res.status(200).json({
          success: true,
          direction,
          ...cctvResult,
          cacheTtlRemainingSec,
          cachedAt,
          isUpdating: false,
        });
      }
    } catch (err) {
      console.error("Failed to read CCTV state from Redis:", err);
    }
  }

  // 徹底移除任何 Heuristic 假資料：若 Redis 尚無資料或快取過期，明確回傳資料正在更新中
  return res.status(200).json({
    success: false,
    status: "UPDATING",
    direction,
    hasAbnormalGap: false,
    gapLane: 0,
    confidence: 0,
    observationText: "資料正在更新中，背景定時巡檢中...",
    analyzedAt: null,
    modelName: null,
    cacheTtlRemainingSec: 0,
    isUpdating: true,
    message: "目前尚無最新推論快取，背景定時巡檢（Vercel Cron）即將更新",
  });
}
