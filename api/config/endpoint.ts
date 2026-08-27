import { Redis } from "@upstash/redis";

let memoryEndpoint: any = null;

export const dynamic = "force-dynamic";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const method = req.method?.toUpperCase();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redis = url && token ? new Redis({ url, token }) : null;

  const defaultEndpoint = {
    success: true,
    endpoint: process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "https://jerry-sepia.vercel.app",
    status: "ACTIVE",
    version: "1.0.0",
  };

  if (method === "GET") {
    try {
      if (redis) {
        const cached: any = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          memoryEndpoint = cached;
          const result = typeof cached === "object" ? { ...defaultEndpoint, ...cached } : { ...defaultEndpoint, endpoint: cached };
          return res.status(200).json(result);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (memoryEndpoint) {
      const result = typeof memoryEndpoint === "object" ? { ...defaultEndpoint, ...memoryEndpoint } : { ...defaultEndpoint, endpoint: memoryEndpoint };
      return res.status(200).json(result);
    }
    return res.status(200).json(defaultEndpoint);
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      memoryEndpoint = body;
      if (redis) {
        await redis.set("hsuehshan:config:endpoint", body);
      }
      return res.status(200).json({ success: true, ...defaultEndpoint, ...(typeof body === "object" ? body : { endpoint: body }) });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

