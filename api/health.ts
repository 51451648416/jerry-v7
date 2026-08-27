import { Redis } from "@upstash/redis";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  let redisConnected = false;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      const redis = new Redis({ url, token });
      await redis.ping();
      redisConnected = true;
    } catch {
      redisConnected = false;
    }
  }

  return res.status(200).json({
    status: "ok",
    redisConnected,
    mode: redisConnected ? "upstash_redis_cloud" : "local_memory_fallback",
    timestamp: new Date().toISOString(),
  });
}
