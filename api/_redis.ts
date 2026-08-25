import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
      return redisClient;
    } catch (e) {
      console.warn("Upstash Redis 連線初始化失敗:", e);
    }
  }
  return null;
}

// In-Memory cache fallback for serverless warm instances
export const memoryStore: {
  keys: any;
  model: any;
  dataset: any[];
  endpoint: any;
  weights: any;
} = {
  keys: null,
  model: null,
  dataset: [],
  endpoint: null,
  weights: null,
};
