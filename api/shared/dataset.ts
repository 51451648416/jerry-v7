import type { Request, Response } from "express";
import { getRedis, memoryStore } from "../_redis";

export default async function handler(req: Request, res: Response) {
  const method = req.method?.toUpperCase();

  if (method === "GET") {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:dataset");
        if (Array.isArray(cached)) {
          memoryStore.dataset = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 資料集失敗，切換至本機快取:", err);
    }
    return res.status(200).json(memoryStore.dataset || []);
  }

  if (method === "POST") {
    try {
      const body = req.body;
      if (Array.isArray(body)) {
        memoryStore.dataset = body.slice(0, 1000);
      } else if (body && typeof body === "object") {
        memoryStore.dataset.unshift(body);
        if (memoryStore.dataset.length > 1000) {
          memoryStore.dataset = memoryStore.dataset.slice(0, 1000);
        }
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:dataset", memoryStore.dataset);
      }
      return res.status(200).json({ success: true, total: memoryStore.dataset.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
