import type { Request, Response } from "express";
import { getRedis, memoryStore } from "../_redis";

export default async function handler(req: Request, res: Response) {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:keys");
        if (cached) {
          memoryStore.keys = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 金鑰失敗，切換至本機快取:", err);
    }
    if (!memoryStore.keys) return res.status(200).json([]);
    return res.status(200).json(memoryStore.keys);
  }

  if (method === "POST") {
    try {
      const body = req.body;
      memoryStore.keys = body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:keys", body);
      }
      return res.status(200).json({ success: true, timestamp: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
