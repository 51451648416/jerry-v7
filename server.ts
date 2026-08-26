import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Redis } from "@upstash/redis";
import { globalTdxKeyManager } from "./src/services/tdxKeyRotator";

// Lazy Upstash Redis Client with Safe Fallback
let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
      return redisClient;
    } catch (e) {
      console.warn("Upstash Redis 初始化失敗，將自動切換為本機記憶體備援模式:", e);
    }
  }
  return null;
}

// VDLaneData interface and calculateAdvancedLaneRecommendation
export interface VDLaneData {
  speedKmh: number;
  volumeS: number;
  volumeL: number;
  volumeT: number;
}

export function calculateAdvancedLaneRecommendation(
  innerLane: VDLaneData,
  outerLane: VDLaneData,
  isWeekendPeak: boolean
) {
  let effectiveInnerSpeed = innerLane.speedKmh;
  let effectiveOuterSpeed = outerLane.speedKmh;
  let outerPenaltyReasons: string[] = [];

  const totalOuterVolume = outerLane.volumeS + outerLane.volumeL + outerLane.volumeT;
  const truckRatio = totalOuterVolume > 0 ? outerLane.volumeT / totalOuterVolume : 0;
  const busRatio = totalOuterVolume > 0 ? outerLane.volumeL / totalOuterVolume : 0;

  // 規則 1：大貨車爬坡壓速阻抗
  if (truckRatio > 0.03) {
    const truckPenalty = Math.min(8.0, truckRatio * 30);
    effectiveOuterSpeed -= truckPenalty;
    outerPenaltyReasons.push(`卡車佔比達 ${(truckRatio * 100).toFixed(0)}% 易受爬坡壓速`);
  }

  // 規則 2：假日大客車專用道交織阻抗
  if (isWeekendPeak && busRatio > 0.10) {
    effectiveOuterSpeed -= 3.5;
    outerPenaltyReasons.push("尖峰客運高頻匯流");
  }

  effectiveOuterSpeed = Math.max(0, effectiveOuterSpeed);
  const recommendInner = effectiveInnerSpeed >= effectiveOuterSpeed;

  let voiceText = "";
  if (recommendInner) {
    if (outerPenaltyReasons.length > 0) {
      voiceText = `即將進入雪山隧道，目前外側${outerPenaltyReasons.join("且")}，系統推薦行駛內側車道。`;
    } else {
      voiceText = `即將進入雪山隧道，目前內側實測流速較快，推薦行駛內側車道。`;
    }
  } else {
    voiceText = `即將進入雪山隧道，目前外側無重車阻擋且流速優於內側，系統推薦行駛外側車道。`;
  }

  return {
    recommendedLane: recommendInner ? "內側車道" : "外側車道",
    effectiveInnerSpeed: Number(effectiveInnerSpeed.toFixed(1)),
    effectiveOuterSpeed: Number(effectiveOuterSpeed.toFixed(1)),
    truckRatio: Number(truckRatio.toFixed(3)),
    busRatio: Number(busRatio.toFixed(3)),
    voiceText: voiceText,
  };
}

// 全域車道推薦快取（供所有 API 端點如 /api/dataset、/api/lane-recommendation 隨時讀取）
let globalLatestLaneRecommendation: any = {
  recommendedLane: "內側車道",
  effectiveInnerSpeed: 75.0,
  effectiveOuterSpeed: 72.0,
  truckRatio: 0.015,
  busRatio: 0.04,
  voiceText: "即將進入雪山隧道，目前內側實測流速較快，推薦行駛內側車道。",
  timestamp: new Date().toISOString(),
};

// 輔助函式：自 TDX VD 數據中解析北向雪隧入口（28.1K ~ 25K）的各車道車速與車種流量 (S/L/T)
export function extractNorthEntranceVdData(vdPayload: any): { innerLane: VDLaneData; outerLane: VDLaneData; vdCount: number } {
  const rawList: any[] = Array.isArray(vdPayload?.VDLives)
    ? vdPayload.VDLives
    : Array.isArray(vdPayload)
    ? vdPayload
    : Array.isArray(vdPayload?.data)
    ? vdPayload.data
    : [];

  let innerSpeeds: number[] = [];
  let outerSpeeds: number[] = [];
  let innerVolS = 0;
  let innerVolL = 0;
  let innerVolT = 0;
  let outerVolS = 0;
  let outerVolL = 0;
  let outerVolT = 0;
  let matchedVdCount = 0;

  for (const item of rawList) {
    if (!item) continue;
    const vdid = String(item.VDID || item.detectorId || "");

    // 檢查是否為北向 (N)
    const isNorth =
      /-N-|-NB-|-N(?=[-_]|$)|北向|北上|\bNB\b/i.test(vdid) ||
      String(item.Direction || "").toUpperCase() === "N" ||
      String(item.Direction || "").toUpperCase() === "NB";

    if (!isNorth) continue;

    // 提取里程數 (聚焦雪隧北向入口 28.1K ~ 25K)
    let mileageKm = 0;
    if (typeof item.Mileage === "number") mileageKm = item.Mileage;
    else if (typeof item.mileageKm === "number") mileageKm = item.mileageKm;
    else {
      const match = vdid.match(/(\d+(?:\.\d+)?)/);
      if (match) mileageKm = parseFloat(match[1]);
    }

    // 判斷是否位於北向入口區間 (24.8K ~ 28.5K)
    const isInNorthEntranceBounds =
      (mileageKm >= 24.8 && mileageKm <= 28.5) ||
      vdid.includes("28.1") ||
      vdid.includes("28.0") ||
      vdid.includes("27.5") ||
      vdid.includes("27.0") ||
      vdid.includes("26.0") ||
      vdid.includes("25.0");

    if (!isInNorthEntranceBounds && mileageKm > 0) continue;

    matchedVdCount++;

    // 解析 LinkFlows[0].Lanes
    const lanes =
      (Array.isArray(item.LinkFlows) && item.LinkFlows[0] && Array.isArray(item.LinkFlows[0].Lanes)
        ? item.LinkFlows[0].Lanes
        : Array.isArray(item.Lanes)
        ? item.Lanes
        : Array.isArray(item.lanes)
        ? item.lanes
        : []) as any[];

    lanes.forEach((laneObj: any, lIdx: number) => {
      // 交通部 TDX 國道車道劃分標準：
      // LaneID: 1 -> 第 1 車道（最內側車道）
      // LaneID: 2+ -> 第 2 車道/外側車道
      // 0-indexed fallback: 若 LaneID 為 0 或使用陣列 index 0 則視為內側車道
      let isInner = false;
      if (laneObj.LaneID !== undefined && laneObj.LaneID !== null) {
        const numId = Number(laneObj.LaneID);
        isInner = numId === 1 || numId === 0;
      } else {
        isInner = lIdx === 0;
      }

      let laneSpeed = typeof laneObj.Speed === "number" && laneObj.Speed > 0 ? laneObj.Speed : 0;
      let vS = 0;
      let vL = 0;
      let vT = 0;

      if (Array.isArray(laneObj.Vehicles)) {
        let weightedSpeedSum = 0;
        let totalVeh = 0;

        laneObj.Vehicles.forEach((v: any) => {
          const vol = typeof v.Volume === "number" ? v.Volume : 0;
          const spd = typeof v.Speed === "number" ? v.Speed : 0;
          const vType = String(v.VehicleType || "").toUpperCase();

          if (vType === "S" || vType === "SMALL" || vType === "1" || vType === "CAR") {
            vS += vol;
          } else if (vType === "L" || vType === "LARGE" || vType === "2" || vType === "BUS") {
            vL += vol;
          } else if (vType === "T" || vType === "TRUCK" || vType === "3" || vType === "TRAILER" || vType === "TT") {
            vT += vol;
          } else {
            vS += vol; // 預設歸為小型車
          }

          if (vol > 0 && spd > 0) {
            weightedSpeedSum += vol * spd;
            totalVeh += vol;
          }
        });

        if (laneSpeed <= 0 && totalVeh > 0) {
          laneSpeed = Math.round(weightedSpeedSum / totalVeh);
        }
      } else if (typeof laneObj.Volume === "number") {
        vS = laneObj.Volume;
      }

      if (isInner) {
        if (laneSpeed > 0) innerSpeeds.push(laneSpeed);
        innerVolS += vS;
        innerVolL += vL;
        innerVolT += vT;
      } else {
        if (laneSpeed > 0) outerSpeeds.push(laneSpeed);
        outerVolS += vS;
        outerVolL += vL;
        outerVolT += vT;
      }
    });
  }

  const avgInnerSpeed = innerSpeeds.length > 0 ? innerSpeeds.reduce((a, b) => a + b, 0) / innerSpeeds.length : 75;
  const avgOuterSpeed = outerSpeeds.length > 0 ? outerSpeeds.reduce((a, b) => a + b, 0) / outerSpeeds.length : 72;

  return {
    innerLane: {
      speedKmh: Math.round(avgInnerSpeed * 10) / 10,
      volumeS: innerVolS,
      volumeL: innerVolL,
      volumeT: innerVolT,
    },
    outerLane: {
      speedKmh: Math.round(avgOuterSpeed * 10) / 10,
      volumeS: outerVolS,
      volumeL: outerVolL,
      volumeT: outerVolT,
    },
    vdCount: matchedVdCount,
  };
}

// 判定是否為週日或連假 13:00~21:00 尖峰時段 (台北時間)
export function isWeekendPeakTime(date: Date = new Date()): boolean {
  try {
    const tzString = date.toLocaleString("en-US", { timeZone: "Asia/Taipei" });
    const localDate = new Date(tzString);
    const day = localDate.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = localDate.getHours();
    return (day === 0 || day === 6) && hour >= 13 && hour <= 21;
  } catch {
    const day = date.getDay();
    const hour = date.getHours();
    return (day === 0 || day === 6) && hour >= 13 && hour <= 21;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON request bodies
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", async (req, res) => {
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
    res.json({
      status: "ok",
      redisConnected,
      mode: redisConnected ? "upstash_redis_cloud" : "local_memory_fallback",
      timestamp: new Date().toISOString(),
    });
  });

  // Global in-memory storage for Model Weights
  let globalLearnedWeights: any = null;

  // Global shared training state
  let globalSharedModelWeights: any = null;
  let globalSharedDatasetRecords: any[] = [];
  let globalSavedTdxKeys: any = null;
  let globalSavedApiConfig: any = null;

  // Standard Vercel Serverless Equivalent Endpoints (/api/keys, /api/model, /api/dataset)
  app.get("/api/keys", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSavedTdxKeys;
      if (redis) {
        data = (await redis.get("tdx_keys")) || (await redis.get("hsuehshan:config:keys")) || data;
      }
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/keys", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      globalSavedTdxKeys = body;
      const keysArray = Array.isArray(body) ? body : body?.keys;
      if (Array.isArray(keysArray)) {
        globalTdxKeyManager.setCustomKeys(keysArray);
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("tdx_keys", body);
        await redis.set("hsuehshan:config:keys", body);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/model", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSharedModelWeights || globalLearnedWeights;
      if (redis) {
        data = (await redis.get("model_weights")) || (await redis.get("hsuehshan:shared:model")) || data;
      }
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/model", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      globalSharedModelWeights = body;
      globalLearnedWeights = body;
      const redis = getRedis();
      if (redis) {
        await redis.set("model_weights", body);
        await redis.set("hsuehshan:shared:model", body);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/dataset", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSharedDatasetRecords;
      if (redis) {
        data = (await redis.get("dataset_records")) || (await redis.get("hsuehshan:shared:dataset")) || data || [];
      }
      return res.json({
        success: true,
        data: data || [],
        // 頂層相容附加即時車道推薦（方便 iOS 捷徑、語音助理直接解析頂層欄位）
        voiceText: globalLatestLaneRecommendation?.voiceText || "即將進入雪山隧道，系統推薦行駛內側車道。",
        recommendedLane: globalLatestLaneRecommendation?.recommendedLane || "內側車道",
        effectiveInnerSpeed: globalLatestLaneRecommendation?.effectiveInnerSpeed || 75.0,
        effectiveOuterSpeed: globalLatestLaneRecommendation?.effectiveOuterSpeed || 72.0,
        truckRatio: globalLatestLaneRecommendation?.truckRatio || 0,
        busRatio: globalLatestLaneRecommendation?.busRatio || 0,
        updateTime: globalLatestLaneRecommendation?.timestamp || new Date().toISOString(),
      });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/dataset", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const redis = getRedis();
      
      const mergeRecords = (existing: any[], incoming: any) => {
        const map = new Map<string, any>();
        for (const item of existing || []) {
          if (item && typeof item === "object") {
            const id = item.id || `item_${item.timestamp || Math.random()}`;
            map.set(id, item);
          }
        }
        if (Array.isArray(incoming)) {
          for (const item of incoming) {
            if (item && typeof item === "object") {
              const id = item.id || `item_${item.timestamp || Math.random()}`;
              map.set(id, item);
            }
          }
        } else if (incoming && typeof incoming === "object") {
          const id = incoming.id || `item_${incoming.timestamp || Math.random()}`;
          map.set(id, incoming);
        }
        const merged = Array.from(map.values())
          .sort((a: any, b: any) => (b.unixTimestampMs || b.timestamp || 0) - (a.unixTimestampMs || a.timestamp || 0))
          .slice(0, 400);
        return merged;
      };

      globalSharedDatasetRecords = mergeRecords(globalSharedDatasetRecords, body);

      if (redis) {
        let redisCurrent: any[] = (await redis.get("dataset_records")) || (await redis.get("hsuehshan:shared:dataset")) || [];
        if (typeof redisCurrent === "string") {
          try { redisCurrent = JSON.parse(redisCurrent); } catch {}
        }
        const updated = mergeRecords(redisCurrent, body);
        await redis.set("dataset_records", updated);
        await redis.set("hsuehshan:shared:dataset", updated);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // In-memory queue fallback for pending predictions
  let globalPendingQueue: any[] = [];

  // Vercel Serverless Equivalent Endpoint (/api/reconcile)
  app.post("/api/reconcile", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { predictedSec, modelWeightsSnapshot } = body;
      const redis = getRedis();
      let queue: any[] = redis ? ((await redis.get("pending_predictions_queue")) || []) : globalPendingQueue;
      const newRecord = {
        id: "pred_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        timestamp: Date.now(),
        predictedSec,
        modelWeightsSnapshot,
        status: "pending",
      };
      queue.push(newRecord);
      if (queue.length > 50) queue = queue.slice(-50);
      globalPendingQueue = queue;
      if (redis) {
        await redis.set("pending_predictions_queue", queue);
      }
      return res.status(200).json({ success: true, queuedId: newRecord.id });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/reconcile", async (req, res) => {
    try {
      const redis = getRedis();
      let queue: any[] = redis ? ((await redis.get("pending_predictions_queue")) || []) : globalPendingQueue;
      let dataset: any[] = redis ? ((await redis.get("dataset_records")) || []) : globalSharedDatasetRecords;
      const currentEtcSec = Number(req.query.currentEtcSec);
      const now = Date.now();

      let resolvedCount = 0;
      const remainingQueue: any[] = [];

      for (const item of queue) {
        const elapsedSec = (now - item.timestamp) / 1000;
        if (elapsedSec >= item.predictedSec && !isNaN(currentEtcSec) && currentEtcSec > 0) {
          dataset.push({
            timestamp: item.timestamp,
            predictedSec: item.predictedSec,
            etcTravelTimeSec: currentEtcSec,
            deltaSec: item.predictedSec - currentEtcSec,
            aligned: true,
            modelWeights: item.modelWeightsSnapshot,
          });
          resolvedCount++;
        } else {
          remainingQueue.push(item);
        }
      }

      globalPendingQueue = remainingQueue;
      if (resolvedCount > 0) {
        if (dataset.length > 400) dataset = dataset.slice(-400);
        globalSharedDatasetRecords = dataset;
        if (redis) {
          await redis.set("dataset_records", dataset);
          await redis.set("pending_predictions_queue", remainingQueue);
        }
      } else if (redis) {
        await redis.set("pending_predictions_queue", remainingQueue);
      }

      return res.status(200).json({
        success: true,
        resolvedCount,
        pendingQueueSize: remainingQueue.length,
        totalDatasetSize: dataset.length,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 模型權重共用 API (支援 Upstash Redis 與 In-Memory 雙重同步)
  app.get("/api/shared/model", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:model");
        if (cached) {
          globalSharedModelWeights = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型失敗，切換至本機快取:", err);
    }
    return res.json(globalSharedModelWeights || { success: false, message: "No model trained yet" });
  });

  app.post("/api/shared/model", async (req, res) => {
    try {
      globalSharedModelWeights = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:model", req.body);
      }
      return res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 訓練資料集共用 API (支援 Upstash Redis 與 In-Memory 雙重同步)
  app.get("/api/shared/dataset", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:dataset");
        if (Array.isArray(cached)) {
          globalSharedDatasetRecords = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 資料集失敗，切換至本機快取:", err);
    }
    return res.json(globalSharedDatasetRecords);
  });

  app.post("/api/shared/dataset", async (req, res) => {
    try {
      if (Array.isArray(req.body)) {
        globalSharedDatasetRecords = req.body.slice(0, 1000);
      } else if (req.body && typeof req.body === "object") {
        globalSharedDatasetRecords.unshift(req.body);
        if (globalSharedDatasetRecords.length > 1000) {
          globalSharedDatasetRecords = globalSharedDatasetRecords.slice(0, 1000);
        }
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:dataset", globalSharedDatasetRecords);
      }
      return res.json({ success: true, total: globalSharedDatasetRecords.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Compatibility Endpoint for /api/config/keys
  app.get("/api/config/keys", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:keys");
        if (cached) {
          globalSavedTdxKeys = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 金鑰失敗，切換至本機快取:", err);
    }
    if (!globalSavedTdxKeys) return res.json([]);
    return res.json(globalSavedTdxKeys);
  });

  app.post("/api/config/keys", async (req, res) => {
    try {
      globalSavedTdxKeys = req.body;
      const keysArray = Array.isArray(req.body) ? req.body : req.body?.keys;
      if (Array.isArray(keysArray)) {
        globalTdxKeyManager.setCustomKeys(keysArray);
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:keys", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/config/endpoint", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          globalSavedApiConfig = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (!globalSavedApiConfig) return res.status(404).json({ error: "No api config found" });
    return res.json(globalSavedApiConfig);
  });

  app.post("/api/config/endpoint", async (req, res) => {
    try {
      globalSavedApiConfig = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:endpoint", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/model/weights", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:model:weights");
        if (cached) {
          globalLearnedWeights = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型權重失敗，切換至本機快取:", err);
    }
    if (!globalLearnedWeights) {
      return res.status(404).json({ error: "No global weights found" });
    }
    return res.json(globalLearnedWeights);
  });

  app.post("/api/model/weights", async (req, res) => {
    try {
      globalLearnedWeights = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:model:weights", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // TDX Key Rotation System Status
  app.get("/api/tdx/keys/status", (req, res) => {
    try {
      const status = globalTdxKeyManager.getStatus();
      return res.json(status);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Sync custom keys to server TDX Key Rotation Manager
  app.post("/api/tdx/keys/sync", (req, res) => {
    try {
      const { keys } = req.body;
      if (Array.isArray(keys)) {
        globalTdxKeyManager.setCustomKeys(keys);
        return res.json({ success: true, count: keys.length, status: globalTdxKeyManager.getStatus() });
      }
      return res.status(400).json({ error: "Invalid keys array payload" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Unified endpoint for Freeway VD data with Automatic Key Rotation, Failover & Advanced Lane Recommendation
  const handleFreewayVd = async (req: express.Request, res: express.Response) => {
    try {
      const tdxUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";

      const result = await globalTdxKeyManager.executeWithFailover<any>(tdxUrl);
      const rawData = result.data;

      // 提取北向雪隧入口 (28.1K ~ 25K) 各車種流量與速度
      const { innerLane, outerLane, vdCount } = extractNorthEntranceVdData(rawData);
      const isWeekendPeak = isWeekendPeakTime();

      // 計算升級版雪山隧道即時車道推薦演算法
      const recommendation = calculateAdvancedLaneRecommendation(innerLane, outerLane, isWeekendPeak);
      globalLatestLaneRecommendation = {
        ...recommendation,
        innerLane,
        outerLane,
        isWeekendPeak,
        matchedVdCount: vdCount,
        timestamp: new Date().toISOString(),
      };

      // 回傳無損向下相容之 JSON 結構
      if (Array.isArray(rawData)) {
        // 若原始回傳為陣列，提供完整相容（若 query 要求 json 物件或一般請求）
        if (req.query.format === "object" || req.query.include_recommendation === "true") {
          return res.json({
            data: rawData,
            ...recommendation,
            northEntranceInnerLane: innerLane,
            northEntranceOuterLane: outerLane,
            isWeekendPeak,
            matchedEntranceVdCount: vdCount,
            updateTime: new Date().toISOString(),
          });
        }
        // 直接在 Array 物件上附加欄位或回傳陣列
        (rawData as any).recommendedLane = recommendation.recommendedLane;
        (rawData as any).effectiveInnerSpeed = recommendation.effectiveInnerSpeed;
        (rawData as any).effectiveOuterSpeed = recommendation.effectiveOuterSpeed;
        (rawData as any).truckRatio = recommendation.truckRatio;
        (rawData as any).busRatio = recommendation.busRatio;
        (rawData as any).voiceText = recommendation.voiceText;
        (rawData as any).advancedLaneRecommendation = recommendation;

        return res.json(rawData);
      } else if (rawData && typeof rawData === "object") {
        return res.json({
          ...rawData,
          recommendedLane: recommendation.recommendedLane,
          effectiveInnerSpeed: recommendation.effectiveInnerSpeed,
          effectiveOuterSpeed: recommendation.effectiveOuterSpeed,
          truckRatio: recommendation.truckRatio,
          busRatio: recommendation.busRatio,
          voiceText: recommendation.voiceText,
          advancedLaneRecommendation: recommendation,
          northEntranceInnerLane: innerLane,
          northEntranceOuterLane: outerLane,
          isWeekendPeak,
        });
      }

      return res.json(rawData);
    } catch (err: any) {
      console.error("TDX Freeway-VD fetch error:", err);
      return res.status(502).json({
        error: err.message || "無法連線至交通部 TDX 伺服器，所有金鑰輪轉嘗試皆未成功，請稍後重試",
      });
    }
  };

  // 專屬雪隧車道推薦與語音朗讀 API 端點 (便於 Siri 捷徑、語音助理與第三方系統直接調用)
  app.get("/api/lane-recommendation", async (req, res) => {
    try {
      const tdxUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";
      const result = await globalTdxKeyManager.executeWithFailover<any>(tdxUrl);
      const { innerLane, outerLane, vdCount } = extractNorthEntranceVdData(result.data);
      const isWeekendPeak = isWeekendPeakTime();
      const recommendation = calculateAdvancedLaneRecommendation(innerLane, outerLane, isWeekendPeak);
      globalLatestLaneRecommendation = {
        ...recommendation,
        innerLane,
        outerLane,
        isWeekendPeak,
        matchedVdCount: vdCount,
        timestamp: new Date().toISOString(),
      };

      return res.json({
        success: true,
        ...recommendation,
        innerLane,
        outerLane,
        isWeekendPeak,
        matchedVdCount: vdCount,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/tdx/freeway-vd", handleFreewayVd);
  app.get("/api/v1/freeway-vd", handleFreewayVd);
  app.get("/api/traffic/vd", handleFreewayVd);
  app.get("/api/n5/vd", handleFreewayVd);

  // Unified endpoint for Freeway Live Events data with Automatic Key Rotation & Failover
  const handleFreewayLiveEvents = async (req: express.Request, res: express.Response) => {
    try {
      // TDX API: 國道即時路況事件端點
      const tdxEventsUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/LiveEvent/Freeway?$filter=contains(Location/FreeExpressHighway/Road,%20%27國道5號%27)&$format=JSON";

      try {
        const result = await globalTdxKeyManager.executeWithFailover<any>(tdxEventsUrl);
        return res.json(result.data);
      } catch (innerErr: any) {
        // 若端點無事件或過濾結果為空/返回 404，依規範安全回傳空事件結構，不中斷系統
        console.info("TDX 即時事件端點返回無活躍事件或路徑通知，回傳空事件結構");
        return res.json({
          UpdateTime: new Date().toISOString(),
          UpdateInterval: 300,
          LiveEvents: [],
        });
      }
    } catch (err: any) {
      console.error("TDX Freeway Live Events fetch error:", err);
      return res.json({
        UpdateTime: new Date().toISOString(),
        UpdateInterval: 300,
        LiveEvents: [],
      });
    }
  };

  app.get("/api/tdx/freeway-live-events", handleFreewayLiveEvents);
  app.get("/api/v1/freeway-live-events", handleFreewayLiveEvents);
  app.get("/api/traffic/live-events", handleFreewayLiveEvents);
  app.get("/api/n5/events", handleFreewayLiveEvents);

  // TDX Auth Token Proxy (compatibility with rotation fallback)
  app.post("/api/tdx/token", async (req, res) => {
    try {
      const { clientId, clientSecret } = req.body;
      if (clientId && clientSecret) {
        // If specific credentials passed, use direct token request
        const authUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
        const requestBody = `grant_type=client_credentials&client_id=${encodeURIComponent(
          clientId
        )}&client_secret=${encodeURIComponent(clientSecret)}`;

        const response = await fetch(authUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: requestBody,
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).json({ error: `TDX 認證伺服器回應錯誤: ${errText}` });
        }

        const data = await response.json();
        return res.json({ access_token: data.access_token });
      }

      // Default: Use rotation manager
      const { token } = await globalTdxKeyManager.getValidAccessToken();
      return res.json({ access_token: token });
    } catch (err: any) {
      console.error("Error in /api/tdx/token proxy:", err);
      return res.status(500).json({ error: err.message || "TDX 連線認證失敗" });
    }
  });

  // TDX Data Proxy
  app.get("/api/tdx/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      const authHeader = req.headers.authorization;

      if (!targetUrl) {
        return res.status(400).json({ error: "Missing 'url' query parameter" });
      }
      if (!authHeader) {
        return res.status(400).json({ error: "Missing 'Authorization' header" });
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `TDX fetch failed: ${errText}` });
      }

      const data = await response.json();
      return res.json(data);
    } catch (err: any) {
      console.error("Error in /api/tdx/proxy:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
