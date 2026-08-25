import { Redis } from "@upstash/redis";

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

interface PendingRecord {
  id: string;
  timestamp: number;
  predictedSec: number;
  modelWeightsSnapshot: any;
  status: "pending" | "resolved";
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!redis) {
    return res.status(200).json({ success: false, message: "Redis not configured" });
  }

  // 1. POST: 使用者進行即時推估時，將「預測軌跡」寫入雲端佇列
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { predictedSec, modelWeightsSnapshot } = body;
      
      let queue: PendingRecord[] = (await redis.get("pending_predictions_queue")) || [];
      const newRecord: PendingRecord = {
        id: "pred_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
        timestamp: Date.now(),
        predictedSec,
        modelWeightsSnapshot,
        status: "pending"
      };

      queue.push(newRecord);
      if (queue.length > 50) queue = queue.slice(-50); // 保留最新 50 筆
      await redis.set("pending_predictions_queue", queue);
      
      return res.status(200).json({ success: true, queuedId: newRecord.id });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // 2. GET: 任何裝置載入網頁時，觸發 Lazy Reconciliation（撮合已過期的預測與真實 ETC）
  if (req.method === "GET") {
    try {
      let queue: PendingRecord[] = (await redis.get("pending_predictions_queue")) || [];
      let dataset: any[] = (await redis.get("dataset_records")) || [];
      const currentEtcSec = Number(req.query.currentEtcSec); // 前端傳入當前結算的 ETC 秒數
      const now = Date.now();
      
      let resolvedCount = 0;
      const remainingQueue: PendingRecord[] = [];

      for (const item of queue) {
        const elapsedSec = (now - item.timestamp) / 1000;
        // 如果經過的時間已經大於該次預測耗時（代表車輛已出隧道，ETC 真值已結算）
        if (elapsedSec >= item.predictedSec && !isNaN(currentEtcSec) && currentEtcSec > 0) {
          dataset.push({
            timestamp: item.timestamp,
            predictedSec: item.predictedSec,
            etcTravelTimeSec: currentEtcSec,
            deltaSec: item.predictedSec - currentEtcSec,
            aligned: true,
            modelWeights: item.modelWeightsSnapshot
          });
          resolvedCount++;
        } else {
          // 還沒到時間的，繼續留在佇列中等待
          remainingQueue.push(item);
        }
      }

      if (resolvedCount > 0) {
        if (dataset.length > 400) dataset = dataset.slice(-400);
        await redis.set("dataset_records", dataset);
        await redis.set("pending_predictions_queue", remainingQueue);
      }

      return res.status(200).json({
        success: true,
        resolvedCount,
        pendingQueueSize: remainingQueue.length,
        totalDatasetSize: dataset.length
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
