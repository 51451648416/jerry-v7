import type { Request, Response } from "express";
import { getRedis } from "./_redis";

export default async function handler(req: Request, res: Response) {
  const redis = getRedis();
  let redisConnected = false;
  if (redis) {
    try {
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
