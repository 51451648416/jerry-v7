import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";

export const maxDuration = 60; // 允許最多 60 秒執行時長
export const dynamic = "force-dynamic";

const DIRECTION_CCTV_CONFIGS: Record<
  "N" | "S",
  {
    cameraId: string;
    cameraTitle: string;
    locationName: string;
    mileageKm: number;
    urls: string[];
  }
> = {
  N: {
    cameraId: "n26k",
    cameraTitle: "國5 北向 26K",
    locationName: "雪山隧道北向 26K (頭城端)",
    mileageKm: 26.0,
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bba9e7d7-cd6f-427f-b82d-6bff1bd0f1ed", // 國5 北向 26K 頭城端
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a", // 國5 北向 25K
    ],
  },
  S: {
    cameraId: "s18k",
    cameraTitle: "國5 南向 18K",
    locationName: "雪山隧道南向 18K (坪林端)",
    mileageKm: 18.0,
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=68764cce-c1f1-4ef7-a911-b33ed35e0c6f", // 國5 南向 18K 坪林端
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=0165bb74-a3e7-42ed-bda8-609f215fc9e5", // 國5 南向 19K
    ],
  },
};

async function fetchCctvImageWithRetry(urls: string[], maxRetries = 1): Promise<Buffer> {
  let lastError: any = null;

  for (const cctvUrl of urls) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const imgRes = await fetch(cctvUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/avif,image/webp,image/apng,image/jpeg,image/*,*/*;q=0.8",
            Referer: "https://1968.freeway.gov.tw/",
          },
          signal: controller.signal,
        });

        if (!imgRes.ok) {
          throw new Error(`HTTP status ${imgRes.status} from ${cctvUrl} on attempt ${attempt + 1}`);
        }

        if (!imgRes.body) {
          throw new Error("Empty response body from CCTV stream");
        }

        const reader = imgRes.body.getReader();
        const chunks: Buffer[] = [];
        let totalLength = 0;
        let frameBuffer: Buffer | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length > 0) {
              const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
              chunks.push(buf);
              totalLength += buf.length;

              // 僅在當前 chunk 含有 0xd9 (潛在 JPEG 檔尾 EOI) 且已累積合理長度時才進行單次拼接檢驗
              const hasPotentialEoi = buf.includes(0xd9);

              if (hasPotentialEoi && totalLength > 4096) {
                const combined = Buffer.concat(chunks);
                const startIdx = combined.indexOf(Buffer.from([0xff, 0xd8]));
                if (startIdx !== -1) {
                  const endIdx = combined.indexOf(Buffer.from([0xff, 0xd9]), startIdx + 2);
                  if (endIdx !== -1) {
                    frameBuffer = combined.subarray(startIdx, endIdx + 2);
                    await reader.cancel();
                    break;
                  }
                }
              }

              if (totalLength > 2 * 1024 * 1024) {
                await reader.cancel();
                throw new Error("Stream exceeded 2MB without finding complete JPEG");
              }
            }
          }
        } finally {
          clearTimeout(timeoutId);
        }

        if (frameBuffer && frameBuffer.length > 100) {
          return frameBuffer;
        }

        const fullBuf = Buffer.concat(chunks);
        if (fullBuf.length > 100) {
          return fullBuf;
        }

        throw new Error(`Buffer too small (${fullBuf.length} bytes) from ${cctvUrl}`);
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        console.warn(`CCTV fetch attempt ${attempt + 1} for ${cctvUrl} failed:`, err.message || err);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
  }

  throw lastError || new Error("Failed to fetch CCTV image after multiple URL attempts");
}

async function analyzeDirectionWithGemini(
  direction: "N" | "S",
  ai: GoogleGenAI
): Promise<{
  hasAbnormalGap: boolean;
  gapLane: 0 | 1 | 2;
  confidence: number;
  observationText: string;
  cameraId: string;
  cameraTitle: string;
  mileageKm: number;
  direction: "N" | "S";
  analyzedAt: string;
  modelName: string;
}> {
  const config = DIRECTION_CCTV_CONFIGS[direction];
  const buffer = await fetchCctvImageWithRetry(config.urls, 1);
  const base64Data = buffer.toString("base64");

  const prompt = `你現在是雪山隧道智慧交通控制中心的專業多模態視覺 AI 檢驗專家。
請仔細辨識這張國道 5 號雪山隧道「${config.locationName}」的即時監控畫面。

【判斷核心指標：慢速車阻抗與異常大淨空】
1. 是否有單一車道出現前方異常大淨空（超過 100~150 公尺無車，但該車道後方緊跟大批車流隊列）？
2. 若有，是哪一個車道前方被壓速出現大淨空？（1 代表內側/左側，2 代表外側/右側，0 代表雙車道均勻無異常淨空）
3. 若畫面淨空完全無車、或雙車道車流皆正常均勻行駛、或隧道全線停滯塞車，皆填 false, gapLane: 0。

請【僅嚴格回傳標準 JSON 物件】，不要輸出額外的 Markdown 標籤或對話：
{
  "hasAbnormalGap": boolean,
  "gapLane": 0 | 1 | 2,
  "confidence": number,
  "observationText": "繁體中文簡述空間幾何分佈觀察（25~45字）"
}`;

  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.7-flash", "gemini-flash-latest"];
  let response: any = null;
  let usedModel = "gemini-3.1-flash-lite";
  let lastModelError: any = null;

  for (const m of modelsToTry) {
    try {
      response = await ai.models.generateContent({
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
    } catch (mErr: any) {
      lastModelError = mErr;
      console.warn(`Vision model ${m} attempt failed for direction ${direction}:`, mErr.message || mErr);
    }
  }

  if (!response) {
    throw lastModelError || new Error(`All vision models failed to return content for direction ${direction}`);
  }

  const text = response.text || "{}";
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    hasAbnormalGap: Boolean(parsed.hasAbnormalGap),
    gapLane: parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : 0,
    confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.95,
    observationText:
      parsed.observationText ||
      (parsed.hasAbnormalGap
        ? `雲端視覺辨識偵測到第 ${parsed.gapLane === 1 ? "1 (內側)" : "2 (外側)"} 車道前方出現顯著空間淨空隊列`
        : "車道幾何空間分佈均勻正常，各車道無異常帶頭壓速淨空。"),
    cameraId: config.cameraId,
    cameraTitle: config.cameraTitle,
    mileageKm: config.mileageKm,
    direction,
    analyzedAt: new Date().toISOString(),
    modelName: usedModel,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const query = req.query || {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const err = new Error("GEMINI_API_KEY environment variable is not configured");
      console.error("Gemini API Key Missing:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }

    const ai = new GoogleGenAI({ apiKey });

    // 初始化 Redis 客戶端
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    let redis: Redis | null = null;
    if (url && token) {
      try {
        redis = new Redis({ url, token });
      } catch (rErr) {
        console.warn("Upstash Redis init failed in analyze handler:", rErr);
      }
    }

    // 若指定單一方向，則分析該方向；若為 Cron 觸發 (無指定特定方向)，則自動巡檢雙向 ("S", "N")
    const rawDir = (body.direction || query.direction || "").toUpperCase();
    const directionsToAnalyze: ("N" | "S")[] =
      rawDir === "S" || rawDir === "N" ? [rawDir as "N" | "S"] : ["S", "N"];

    const results: Record<string, any> = {};

    for (let i = 0; i < directionsToAnalyze.length; i++) {
      const dir = directionsToAnalyze[i];
      if (i > 0) {
        // 遵守速率保護間隔
        await new Promise((resolve) => setTimeout(resolve, 4500));
      }

      const visionResult = await analyzeDirectionWithGemini(dir, ai);
      results[dir] = visionResult;

      // 寫入 Upstash Redis 快取，設定 TTL 為 360 秒
      if (redis) {
        try {
          const redisKey = `hsuehshan:cctv:cross_validation:${dir}`;
          await redis.set(
            redisKey,
            JSON.stringify({
              cctvResult: visionResult,
              cachedAt: Date.now(),
            }),
            { ex: 360 }
          );

          // 同步寫入單鏡頭節點快取
          const camKey = `hsuehshan:cctv:cam:${visionResult.cameraId}`;
          await redis.set(
            camKey,
            JSON.stringify({
              record: {
                ...visionResult,
                cacheTtlRemainingSec: 360,
                isStale: false,
                status: visionResult.hasAbnormalGap ? "TURTLE_DETECTED" : "NORMAL_FLOW",
              },
              cachedAt: Date.now(),
            }),
            { ex: 360 }
          );
        } catch (redisErr: any) {
          console.error(`Failed to write direction ${dir} to Redis:`, redisErr.message);
        }
      }
    }

    // 若為單向請求，回傳該方向結果；若為 Cron 或雙向，回傳包含各方向結果之總結
    if (directionsToAnalyze.length === 1) {
      const singleDir = directionsToAnalyze[0];
      return res.status(200).json({
        success: true,
        direction: singleDir,
        ...results[singleDir],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vercel Cron / Background Inspection completed successfully for all directions",
      ttl: 360,
      results,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Vercel Serverless CCTV Vision Analysis Error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error during CCTV multi-modal analysis",
      isUpdating: false,
    });
  }
}
