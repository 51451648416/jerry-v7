import type { Request, Response } from "express";
import { getRedis, memoryStore } from "../_redis";

export default async function handler(req: Request, res: Response) {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:model:weights");
        if (cached) {
          memoryStore.weights = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型權重失敗，切換至本機快取:", err);
    }
    if (!memoryStore.weights) {
      return res.status(404).json({ error: "No global weights found" });
    }
    return res.status(200).json(memoryStore.weights);
  }

  if (method === "POST") {
    try {
      memoryStore.weights = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:model:weights", req.body);
      }
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
