import { Redis } from "@upstash/redis";

let memoryDataset: any[] = [];

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const method = req.method?.toUpperCase();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redis = url && token ? new Redis({ url, token }) : null;

  if (method === "GET") {
    try {
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:dataset");
        if (Array.isArray(cached)) {
          memoryDataset = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 資料集失敗，切換至本機快取:", err);
    }
    return res.status(200).json(memoryDataset);
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (Array.isArray(body)) {
        memoryDataset = body.slice(0, 1000);
      } else if (body && typeof body === "object") {
        memoryDataset.unshift(body);
        if (memoryDataset.length > 1000) {
          memoryDataset = memoryDataset.slice(0, 1000);
        }
      }
      if (redis) {
        await redis.set("hsuehshan:shared:dataset", memoryDataset);
      }
      return res.status(200).json({ success: true, total: memoryDataset.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
