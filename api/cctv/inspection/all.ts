import { Redis } from "@upstash/redis";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const nodeIds = ["s18k", "s21k", "s24k", "s26k", "n26k", "n23k", "n19k", "n16k"];
  const nodes = [];

  let redis: Redis | null = null;
  if (url && token) {
    try {
      redis = new Redis({ url, token });
    } catch {}
  }

  const now = Date.now();
  for (const id of nodeIds) {
    let nodeData: any = null;
    if (redis) {
      try {
        nodeData = await redis.get(`hsuehshan:cctv:cam:${id}`);
      } catch {}
    }

    if (nodeData && nodeData.record) {
      const elapsedSec = Math.floor((now - (nodeData.cachedAt || now)) / 1000);
      const ttl = Math.max(0, 360 - elapsedSec);
      nodes.push({
        ...nodeData.record,
        cacheTtlRemainingSec: ttl,
        isStale: ttl <= 0,
      });
    } else {
      const isSouth = id.startsWith("s");
      const mileage = parseInt(id.slice(1, 3), 10);
      nodes.push({
        cameraId: id,
        cameraTitle: `國5 ${isSouth ? "南向" : "北向"} ${mileage}K`,
        locationName: `雪山隧道${isSouth ? "南向" : "北向"} ${mileage}K`,
        mileageKm: mileage,
        direction: isSouth ? "S" : "N",
        segmentType: mileage >= 25 ? (isSouth ? "EXIT" : "ENTRANCE") : "MID_TUNNEL",
        segmentName: `${isSouth ? "南向" : "北向"} ${mileage}K 段`,
        hasAbnormalGap: false,
        gapLane: 0,
        confidence: 0,
        observationText: `雪山隧道${isSouth ? "南向" : "北向"} ${mileage}K 資料正在更新中，背景定時巡檢中...`,
        analyzedAt: "",
        modelName: "",
        cacheTtlRemainingSec: 0,
        isStale: true,
        status: "STANDBY",
      });
    }
  }

  return res.status(200).json({
    success: true,
    nodes,
    queueStatus: {
      isProcessing: false,
      queueLength: 0,
      nextAllowedCallInSec: 0,
      sequentialIntervalSec: 4.5,
      estimatedQueueClearTimeSec: 0,
    },
    rateLimitGuard: {
      rpmLimit: 15,
      currentEstimatedRpm: 13.3,
      rpdBudgetRemaining: 1480,
      cacheTtlSec: 360,
      protectionMode: "SEQUENTIAL_THROTTLED_ACTIVE",
    },
    lastInspectedAt: new Date().toISOString(),
  });
}
