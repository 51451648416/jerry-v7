import { Redis } from "@upstash/redis";

let memoryEndpoint: any = null;

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
        const cached = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          memoryEndpoint = cached;
          return res.status(200).json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (!memoryEndpoint) return res.status(404).json({ error: "No api config found" });
    return res.status(200).json(memoryEndpoint);
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      memoryEndpoint = body;
      if (redis) {
        await redis.set("hsuehshan:config:endpoint", body);
      }
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
