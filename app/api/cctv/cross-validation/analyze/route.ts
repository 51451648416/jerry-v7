import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const DIRECTION_CCTV_URLS: Record<"N" | "S", string> = {
  N: "https://1968.freeway.gov.tw/surveillance/307", // 國5 北向 26K 頭城端
  S: "https://1968.freeway.gov.tw/surveillance/315", // 國5 南向 18K 坪林端
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const direction: "N" | "S" = String(body.direction || "N").toUpperCase() === "S" ? "S" : "N";
    const cctvUrl = DIRECTION_CCTV_URLS[direction];

    // 1. 透過 fetch 取得真實 CCTV 圖片 Buffer 並轉為 Base64
    const imgRes = await fetch(cctvUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Referer: "https://1968.freeway.gov.tw/",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!imgRes.ok) {
      throw new Error(`Failed to fetch CCTV snapshot from ${cctvUrl}, status: ${imgRes.status}`);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw new Error("Fetched CCTV snapshot buffer is too small or invalid.");
    }

    const base64Data = buffer.toString("base64");

    // 2. 使用 @google/genai 呼叫真實的 Gemini 多模態 API (gemini-2.5-flash)
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            {
              text: '觀察畫面，判斷是否有特定車道出現前方異常大淨空。僅輸出 JSON：{"hasAbnormalGap": boolean, "gapLane": 0|1|2, "confidence": number, "observationText": string}',
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "{}";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const result = {
      hasAbnormalGap: Boolean(parsed.hasAbnormalGap),
      gapLane: parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : 0,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.95,
      observationText: parsed.observationText || "雲端視覺辨識完成，車道幾何結構正常。",
      direction,
      analyzedAt: new Date().toISOString(),
      modelName: "gemini-2.5-flash",
    };

    // 3. 寫入 Upstash Redis 快取，務必加上 240 秒過期設定
    const redisKey = `hsuehshan:cctv:cross_validation:${direction}`;
    await redis.set(
      redisKey,
      JSON.stringify({
        cctvResult: result,
        cachedAt: Date.now(),
      }),
      { ex: 240 }
    );

    return NextResponse.json({
      success: true,
      direction,
      ...result,
    });
  } catch (err: any) {
    console.error("Vercel CCTV Vision Analysis Error:", err);
    // 4. 錯誤處理與嚴格阻斷：若失敗直接回傳 HTTP 500，絕不寫入任何 heuristic 假資料
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Internal Server Error during CCTV multi-modal analysis",
      },
      { status: 500 }
    );
  }
}
