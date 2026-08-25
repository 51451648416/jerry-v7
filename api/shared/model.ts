import type { Request, Response } from "express";
import { getRedis, memoryStore } from "../_redis";

export default async function handler(req: Request, res: Response) {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:model");
        if (cached) {
          memoryStore.model = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型失敗，切換至本機快取:", err);
    }
    return res.status(200).json(memoryStore.model || { success: false, message: "No model trained yet" });
  }

  if (method === "POST") {
    try {
      const body = req.body;
      memoryStore.model = body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:model", body);
      }
      return res.status(200).json({ success: true, timestamp: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
