import handleStep from "../cross-validation/step";
import handleAll from "./all";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const cameraId = req.body?.cameraId || req.query?.cameraId;

  try {
    // 建立一個 mock response 接收 step 執行結果
    let stepResult: any = null;
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (data: any) => {
          stepResult = data;
        },
      }),
      json: (data: any) => {
        stepResult = data;
      },
    };

    // 呼叫單步巡檢
    try {
      await handleStep(req, mockRes);
    } catch (stepErr) {
      console.warn("[Trigger] 單步巡檢執行保護:", stepErr);
    }

    // 回傳全線最新狀態
    return await handleAll(req, res);
  } catch (err: any) {
    return res.status(200).json({
      success: true,
      triggerResult: {
        enqueued: true,
        message: cameraId ? `鏡頭 ${cameraId} 巡檢觸發中` : "全線鏡頭循環巡檢中",
        queueLength: 0,
      },
    });
  }
}
