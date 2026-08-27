import { Redis } from "@upstash/redis";

let memoryWeights: any = null;

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
        const cached = await redis.get("hsuehshan:model:weights");
        if (cached) {
          memoryWeights = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型權重失敗，切換至本機快取:", err);
    }
    if (!memoryWeights) {
      return res.status(404).json({ error: "No global weights found" });
    }
    return res.status(200).json(memoryWeights);
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      memoryWeights = body;
      if (redis) {
        await redis.set("hsuehshan:model:weights", body);
      }
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
