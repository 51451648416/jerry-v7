export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cameraId = req.body?.cameraId || req.query?.cameraId;

  return res.status(200).json({
    success: true,
    triggerResult: {
      enqueued: true,
      message: cameraId ? `鏡頭 ${cameraId} 已加入巡檢排程` : "已排入全線鏡頭循環巡檢隊列",
      queueLength: 1,
    },
    queueStatus: {
      isProcessing: false,
      queueLength: 0,
      nextAllowedCallInSec: 0,
      sequentialIntervalSec: 4.5,
      estimatedQueueClearTimeSec: 0,
    },
  });
}
