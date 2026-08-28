import { Redis } from "@upstash/redis";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

const CAMERA_IDS = ["s18k", "s21k", "s24k", "s26k", "n26k", "n23k", "n19k", "n16k"];

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const startTime = Date.now();
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({
      success: false,
      isRedisConfigured: false,
      message: "Upstash Redis 尚未配置，前端可改用直連備援",
      traffic: null,
      cctv: {},
      durationMs: Date.now() - startTime,
    });
  }

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });

    // 批量讀取：TDX 即時交通快取 + 8 支攝影機快取 + 下一鏡頭索引
    const keysToFetch = [
      "hsuehshan:tdx:traffic_realtime",
      "hsuehshan:cctv:next_cam_index",
      ...CAMERA_IDS.map((id) => `hsuehshan:cctv:cam:${id}`),
    ];

    const results = await Promise.all(
      keysToFetch.map(async (key) => {
        try {
          return await redis.get(key);
        } catch (e) {
          return null;
        }
      })
    );

    const trafficRaw = results[0];
    const nextCamIndex = results[1] ?? 0;
    const cctvResults: Record<string, any> = {};

    for (let i = 0; i < CAMERA_IDS.length; i++) {
      const camId = CAMERA_IDS[i];
      const rawCam = results[2 + i];
      if (rawCam) {
        const parsed = typeof rawCam === "string" ? JSON.parse(rawCam) : rawCam;
        cctvResults[camId] = parsed.record || parsed;
      } else {
        cctvResults[camId] = null;
      }
    }

    let parsedTraffic: any = null;
    if (trafficRaw) {
      parsedTraffic = typeof trafficRaw === "string" ? JSON.parse(trafficRaw) : trafficRaw;
    }

    const elapsed = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      traffic: parsedTraffic,
      cctv: cctvResults,
      nextCamIndex,
      isRealtimeAvailable: Boolean(parsedTraffic),
      durationMs: elapsed,
      cachedAt: parsedTraffic?.syncedAt || null,
      serverTimestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Traffic Overview] 讀取 Redis 異常:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch traffic overview from Redis cache",
      durationMs: Date.now() - startTime,
    });
  }
}
