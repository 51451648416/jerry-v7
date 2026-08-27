import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";

export const maxDuration = 30; // 允許最多 30 秒執行時長
export const dynamic = "force-dynamic";

const DIRECTION_CCTV_URLS: Record<"N" | "S", string[]> = {
  N: [
    "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bba9e7d7-cd6f-427f-b82d-6bff1bd0f1ed", // 國5 北向 26K 頭城端
    "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a", // 國5 北向 25K
  ],
  S: [
    "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=68764cce-c1f1-4ef7-a911-b33ed35e0c6f", // 國5 南向 18K 坪林端
    "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=0165bb74-a3e7-42ed-bda8-609f215fc9e5", // 國5 南向 19K
  ],
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
              chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
              totalLength += value.length;

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

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const query = req.query || {};
    const direction: "N" | "S" =
      String(body.direction || query.direction || "N").toUpperCase() === "S" ? "S" : "N";
    const candidateUrls = DIRECTION_CCTV_URLS[direction];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const err = new Error("GEMINI_API_KEY environment variable is not configured");
      console.error("Gemini API Key Missing:", err.message, err.stack);
      throw err;
    }

    const ai = new GoogleGenAI({ apiKey });

    // 1. 透過 fetch 取得真實 CCTV 圖片 Buffer (包含 12s 超時與自動重試)
    const buffer = await fetchCctvImageWithRetry(candidateUrls, 1);
    const base64Data = buffer.toString("base64");

    // 2. 使用 @google/genai 呼叫真實的 Gemini 多模態 API (gemini-3.1-flash-lite / gemini-3.7-flash / gemini-flash-latest)
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
                {
                  text: '請辨識此雪隧即時畫面，專注於車道空間幾何結構與前方異常大淨空，僅回傳 JSON：{"hasAbnormalGap": boolean, "gapLane": 0|1|2, "confidence": number, "observationText": string}',
                },
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
        console.warn(`Vision model ${m} attempt failed in analyze.ts:`, mErr.message || mErr);
      }
    }

    if (!response) {
      throw lastModelError || new Error("All vision models failed to return content");
    }

    const text = response.text || "{}";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const result = {
      hasAbnormalGap: Boolean(parsed.hasAbnormalGap),
      gapLane: parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : 0,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.95,
      observationText: parsed.observationText || (parsed.hasAbnormalGap ? `雲端視覺辨識偵測到第 ${parsed.gapLane === 1 ? "1 (內側)" : "2 (外側)"} 車道前方出現顯著空間淨空隊列` : "車道幾何空間分佈均勻正常，各車道無異常帶頭壓速淨空。"),
      direction,
      analyzedAt: new Date().toISOString(),
      modelName: usedModel,
    };

    // 3. 寫入 Upstash Redis 快取，務必加上 240 秒過期設定
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      try {
        const redis = new Redis({ url, token });
        const redisKey = `hsuehshan:cctv:cross_validation:${direction}`;
        await redis.set(
          redisKey,
          JSON.stringify({
            cctvResult: result,
            cachedAt: Date.now(),
          }),
          { ex: 240 }
        );
      } catch (redisErr: any) {
        console.error("Failed to write CCTV result to Redis:", redisErr.message, redisErr.stack);
      }
    }

    return res.status(200).json({
      success: true,
      direction,
      ...result,
    });
  } catch (err: any) {
    console.error("Vercel Serverless CCTV Vision Analysis Error:", err.message, err.stack);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error during CCTV multi-modal analysis",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
}

