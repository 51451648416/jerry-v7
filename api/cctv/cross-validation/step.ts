import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";

export const maxDuration = 10; // Vercel 免費版 10 秒上限嚴格控管
export const dynamic = "force-dynamic";

// 雪山隧道關鍵監控節點清單 (共 8 個關鍵監控節點：南向 4 點、北向 4 點)
export const HSUEHSHAN_NODES = [
  // 南向 (S)
  {
    id: "s18k",
    title: "國5 南向 18K",
    locationName: "雪山隧道南向 18K (坪林端入口)",
    mileage: 18.0,
    direction: "S" as const,
    segmentType: "ENTRANCE",
    segmentName: "南向入口段 (坪林端)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=68764cce-c1f1-4ef7-a911-b33ed35e0c6f",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=0165bb74-a3e7-42ed-bda8-609f215fc9e5",
    ],
  },
  {
    id: "s21k",
    title: "國5 南向 21K",
    locationName: "雪山隧道南向前段 21K",
    mileage: 21.0,
    direction: "S" as const,
    segmentType: "MID_FRONT",
    segmentName: "南向前段 (21K 隧道深處)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=be36ad29-6962-4895-97a8-4d5468c565e9",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=94c5e7cd-1a1f-41ba-9f48-5d363146bf89",
    ],
  },
  {
    id: "s24k",
    title: "國5 南向 24K",
    locationName: "雪山隧道南向中後段 24K",
    mileage: 24.0,
    direction: "S" as const,
    segmentType: "MID_REAR",
    segmentName: "南向中後段 (24K 爬坡段)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=5d5e6222-34f7-4dc4-9e56-2f8faf9adb3b",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bd6e6640-de85-4a89-92e8-4560d590d826",
    ],
  },
  {
    id: "s26k",
    title: "國5 南向 26K",
    locationName: "雪山隧道南向出口段 26K",
    mileage: 26.0,
    direction: "S" as const,
    segmentType: "EXIT",
    segmentName: "南向出口段 (頭城端湧流)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=2149a025-840c-4d32-8a18-a347e406a34f",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=dd506814-9405-4033-a7db-d16a369c025c",
    ],
  },
  // 北向 (N)
  {
    id: "n26k",
    title: "國5 北向 26K",
    locationName: "雪山隧道北向 26K (頭城端入口)",
    mileage: 26.0,
    direction: "N" as const,
    segmentType: "ENTRANCE",
    segmentName: "北向入口段 (頭城端入隧道)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bba9e7d7-cd6f-427f-b82d-6bff1bd0f1ed",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a",
    ],
  },
  {
    id: "n23k",
    title: "國5 北向 23K",
    locationName: "雪山隧道北向中段 23K",
    mileage: 23.0,
    direction: "N" as const,
    segmentType: "MID_TUNNEL",
    segmentName: "北向中段 (23K 上坡段)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=d3df6a83-fc30-48e3-9e97-85ae75f7c33c",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a",
    ],
  },
  {
    id: "n19k",
    title: "國5 北向 19K",
    locationName: "雪山隧道北向前段 19K",
    mileage: 19.0,
    direction: "N" as const,
    segmentType: "MID_FRONT",
    segmentName: "北向前段 (19K 避車彎前)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=7fe38a25-2f6c-4594-9f3c-a1b88aa960a2",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=f268f53f-0bae-4723-9c6e-091c643c5a14",
    ],
  },
  {
    id: "n16k",
    title: "國5 北向 16K",
    locationName: "雪山隧道北向出口段 16K",
    mileage: 16.0,
    direction: "N" as const,
    segmentType: "EXIT",
    segmentName: "北向出口段 (坪林端出隧道)",
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=7d452116-b9b7-41d8-8624-06cd1f9a706d",
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=f268f53f-0bae-4723-9c6e-091c643c5a14",
    ],
  },
];

// 高速抓取單幀 CCTV 畫面 (3 秒超時，取得首張完整 JPEG 即刻中斷串流)
async function fetchFastCctvSnapshot(candidateUrls: string[]): Promise<Buffer> {
  let lastErr: any = null;

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://1968.freeway.gov.tw/",
          Accept: "image/avif,image/webp,image/apng,image/jpeg,image/*,*/*;q=0.8",
        },
      });

      if (!response.ok || !response.body) {
        clearTimeout(timeoutId);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("image/jpeg") || contentType.includes("image/jpg") || contentType.includes("image/png")) {
        const ab = await response.arrayBuffer();
        clearTimeout(timeoutId);
        return Buffer.from(ab);
      }

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
          }

          const combined = Buffer.concat(chunks);
          const startIdx = combined.indexOf(Buffer.from([0xff, 0xd8]));
          if (startIdx !== -1) {
            const endIdx = combined.indexOf(Buffer.from([0xff, 0xd9]), startIdx + 2);
            if (endIdx !== -1) {
              await reader.cancel();
              clearTimeout(timeoutId);
              return combined.subarray(startIdx, endIdx + 2);
            }
          }

          if (combined.length > 1024 * 1024) {
            await reader.cancel();
            break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastErr = err;
    }
  }

  throw lastErr || new Error("無法從指定 CCTV 取得有效影像");
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const startMs = Date.now();

  try {
    // 1. 初始化 Redis 與 Gemini API
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY 環境變數未配置，無法執行真實多模態分析");
    }
    const ai = new GoogleGenAI({ apiKey });

    // 2. 從 Redis 讀取當前待巡檢鏡頭索引 (hsuehshan:cctv:next_cam_index)
    let currentCamIndex = 0;
    if (redis) {
      try {
        const idx = await redis.get<number>("hsuehshan:cctv:next_cam_index");
        if (typeof idx === "number" && !isNaN(idx)) {
          currentCamIndex = idx % HSUEHSHAN_NODES.length;
        }
      } catch {}
    }

    const targetNode = HSUEHSHAN_NODES[currentCamIndex];

    // 3. 抓取鏡頭畫面
    const imageBuffer = await fetchFastCctvSnapshot(targetNode.urls);
    const base64Data = imageBuffer.toString("base64");

    // 4. 送入 Gemini 進行多模態空間幾何推論 (嚴格回傳真實推論，嚴禁假資料)
    const prompt = `你現在是雪山隧道智慧交通控制中心的專業多模態視覺 AI 檢驗專家。
請仔細辨識這張國道 5 號雪山隧道「${targetNode.locationName} (里程 ${targetNode.mileage}K, ${targetNode.direction === "S" ? "南向" : "北向"})」的即時監控畫面。

【車道定義】
- 車道 1 (內側車道 / 左側車道)：貼近隧道左側維修步道或雙黃/雙白中線。
- 車道 2 (外側車道 / 右側車道)：貼近隧道右側人行步道與消防箱。

【判斷核心指標：慢速車阻抗與異常大淨空】
1. 是否有單一車道出現前方異常大淨空（超過 100~150 公尺無車，但該車道後方緊跟大批車流隊列）？
2. 若有，是哪一個車道前方被壓速出現大淨空？（1 代表內側，2 代表外側，0 代表雙車道均勻無異常淨空）
3. 若畫面淨空完全無車、或雙車道車流皆正常均勻行駛、或隧道全線停滯塞車，皆填 false, gapLane: 0。

請【僅嚴格回傳標準 JSON 物件】，不要輸出額外的 Markdown 標籤或對話：
{
  "hasAbnormalGap": boolean,
  "gapLane": 0 | 1 | 2,
  "confidence": number (0.00 ~ 1.00),
  "observationText": "繁體中文簡述空間幾何分佈觀察（25~45字）"
}`;

    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.7-flash"];
    let geminiResponse: any = null;
    let usedModel = "gemini-3.1-flash-lite";
    let lastGenError: any = null;

    for (const m of modelsToTry) {
      try {
        geminiResponse = await ai.models.generateContent({
          model: m,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/jpeg", data: base64Data } },
                { text: prompt },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
          },
        });
        usedModel = m;
        break;
      } catch (err: any) {
        lastGenError = err;
        console.warn(`[CCTV Step] 模型 ${m} 失敗，嘗試備援模型:`, err.message);
      }
    }

    if (!geminiResponse) {
      throw lastGenError || new Error("所有 Gemini 視覺模型均無法回傳分析結果");
    }

    const rawText = geminiResponse.text || "{}";
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const now = Date.now();
    const record = {
      cameraId: targetNode.id,
      cameraTitle: targetNode.title,
      locationName: targetNode.locationName,
      mileageKm: targetNode.mileage,
      direction: targetNode.direction,
      segmentType: targetNode.segmentType,
      segmentName: targetNode.segmentName,
      hasAbnormalGap: Boolean(parsed.hasAbnormalGap),
      gapLane: parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : 0,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.95,
      observationText:
        parsed.observationText ||
        (parsed.hasAbnormalGap
          ? `雲端視覺辨識偵測到第 ${parsed.gapLane === 1 ? "1 (內側)" : "2 (外側)"} 車道前方出現顯著空間淨空隊列`
          : "車道幾何空間分佈均勻正常，各車道無異常帶頭壓速淨空。"),
      analyzedAt: new Date(now).toISOString(),
      modelName: usedModel,
      cacheTtlRemainingSec: 360,
      isStale: false,
      status: parsed.hasAbnormalGap ? "TURTLE_DETECTED" : "NORMAL_FLOW",
    };

    // 5. 將真實分析結果寫入 Redis Key: hsuehshan:cctv:cam:{cameraId} (TTL 360 秒)
    if (redis) {
      try {
        const camKey = `hsuehshan:cctv:cam:${targetNode.id}`;
        await redis.set(
          camKey,
          JSON.stringify({
            record,
            cachedAt: now,
          }),
          { ex: 360 }
        );

        // 同步相容寫入方向 cross_validation 快取
        const dirKey = `hsuehshan:cctv:cross_validation:${targetNode.direction}`;
        await redis.set(
          dirKey,
          JSON.stringify({
            cctvResult: record,
            cachedAt: now,
          }),
          { ex: 360 }
        );

        // 6. 推進至下一支鏡頭索引
        const nextIndex = (currentCamIndex + 1) % HSUEHSHAN_NODES.length;
        await redis.set("hsuehshan:cctv:next_cam_index", nextIndex, { ex: 86400 });
      } catch (rErr) {
        console.error("[CCTV Step] 寫入 Redis 異常:", rErr);
      }
    }

    const elapsed = Date.now() - startMs;
    return res.status(200).json({
      success: true,
      inspectedCamera: {
        index: currentCamIndex,
        id: targetNode.id,
        title: targetNode.title,
        direction: targetNode.direction,
      },
      nextCameraIndex: (currentCamIndex + 1) % HSUEHSHAN_NODES.length,
      record,
      durationMs: elapsed,
      message: `鏡頭 ${targetNode.title} 已成功完成單步真實視覺辨識並寫入 Redis (耗時 ${elapsed}ms)`,
    });
  } catch (err: any) {
    console.error("[CCTV Step] 單步輪巡辨識失敗 (嚴禁回退假資料):", err.message);
    // 依規範：抓圖或推論失敗時跳過更新該鏡頭，嚴禁假資料
    return res.status(500).json({
      success: false,
      error: err.message || "CCTV 影像辨識失敗",
      durationMs: Date.now() - startMs,
    });
  }
}
