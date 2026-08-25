import type { Request, Response } from "express";
import { getRedis, memoryStore } from "../_redis";

export default async function handler(req: Request, res: Response) {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          memoryStore.endpoint = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (!memoryStore.endpoint) return res.status(404).json({ error: "No api config found" });
    return res.status(200).json(memoryStore.endpoint);
  }

  if (method === "POST") {
    try {
      memoryStore.endpoint = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:endpoint", req.body);
      }
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
