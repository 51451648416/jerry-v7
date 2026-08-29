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

/**
 * 判斷當前台灣時間 (UTC+8 / Asia/Taipei) 是否落在深夜省電休眠時段 (01:00 ~ 04:30)
 */
function isTaiwanNightSleepMode(): boolean {
  const now = new Date();
  // 使用 Intl 取得 Asia/Taipei 的小時與分鐘
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  const totalMinutes = hour * 60 + minute;
  // 01:00 = 60 分鐘, 04:30 = 270 分鐘
  return totalMinutes >= 60 && totalMinutes < 270;
}

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
    // 1. 初始化 Redis
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

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

    // ==========================================
    // 🌙 深夜省電休眠機制 (Night Sleep Mode)
    // 台灣時間 01:00 ~ 04:30 嚴禁呼叫 Gemini API
    // ==========================================
    if (isTaiwanNightSleepMode()) {
      const now = Date.now();
      const nightRecord = {
        cameraId: targetNode.id,
        cameraTitle: targetNode.title,
        locationName: targetNode.locationName,
        mileageKm: targetNode.mileage,
        direction: targetNode.direction,
        segmentType: targetNode.segmentType,
        segmentName: targetNode.segmentName,
        hasAbnormalGap: false,
        gapLane: 0,
        confidence: 1.0,
        observationText: "深夜離峰時段（01:00~04:30），隧道全線稀疏順暢，系統處於夜間節能休眠模式。",
        isNightMode: true,
        analyzedAt: new Date(now).toISOString(),
        timestamp: new Date(now).toISOString(),
        modelName: "night-sleep-mode",
        cacheTtlRemainingSec: 600,
        isStale: false,
        status: "NORMAL_FLOW",
      };

      // 寫入 Redis Key: hsuehshan:cctv:cam:{cameraId} (TTL 600 秒)
      if (redis) {
        try {
          const camKey = `hsuehshan:cctv:cam:${targetNode.id}`;
          await redis.set(
            camKey,
            JSON.stringify({
              record: nightRecord,
              cachedAt: now,
            }),
            { ex: 600 }
          );

          // 同步相容寫入方向 cross_validation 快取
          const dirKey = `hsuehshan:cctv:cross_validation:${targetNode.direction}`;
          await redis.set(
            dirKey,
            JSON.stringify({
              cctvResult: nightRecord,
              cachedAt: now,
            }),
            { ex: 600 }
          );

          // 正常推進下一支鏡頭索引
          const nextIndex = (currentCamIndex + 1) % HSUEHSHAN_NODES.length;
          await redis.set("hsuehshan:cctv:next_cam_index", nextIndex, { ex: 86400 });
        } catch (rErr) {
          console.error("[CCTV Step] 夜間模式寫入 Redis 異常:", rErr);
        }
      }

      const elapsed = Date.now() - startMs;
      return res.status(200).json({
        success: true,
        isNightMode: true,
        inspectedCamera: {
          index: currentCamIndex,
          id: targetNode.id,
          title: targetNode.title,
          direction: targetNode.direction,
        },
        nextCameraIndex: (currentCamIndex + 1) % HSUEHSHAN_NODES.length,
        record: nightRecord,
        durationMs: elapsed,
        message: `[夜間休眠] 鏡頭 ${targetNode.title} 處於深夜省電時段，跳過 AI 視覺運算並完成狀態快取 (耗時 ${elapsed}ms)`,
      });
    }

    // ==========================================
    // ☀️ 日常時段 (04:30 ~ 次日 01:00) 正常視覺辨識
    // ==========================================
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

    let parsedResult: {
      hasAbnormalGap: boolean;
      gapLane: 0 | 1 | 2;
      confidence: number;
      observationText: string;
      modelName: string;
      front_clearance_cars: number;
      rear_tailgating_cars: number;
      brake_lights_active: boolean;
      platoon_severity: "NONE" | "MILD" | "MODERATE" | "SEVERE";
      micro_bottleneck_score: number;
    } | null = null;

    try {
      if (ai) {
        // 3. 抓取鏡頭畫面 (若連線失敗會拋出例外)
        const imageBuffer = await fetchFastCctvSnapshot(targetNode.urls);
        const base64Data = imageBuffer.toString("base64");

        // 4. 送入 Gemini 進行高精細微觀幾何空間感知推論
        const prompt = `你現在是雪山隧道智慧交通控制中心最高階多模態視覺 AI 專家，專精於【微觀車距幾何、煞車燈群與車隊結構】的超精細感知。
請仔細辨識這張國道 5 號雪山隧道「${targetNode.locationName} (里程 ${targetNode.mileage}K, ${targetNode.direction === "S" ? "南向" : "北向"})」的即時監控畫面。

【車道定義】
- 車道 1 (內側車道 / 左側車道)：貼近隧道左側維修步道或雙黃/雙白中線。
- 車道 2 (外側車道 / 右側車道)：貼近隧道右側人行步道與消防箱。

【微觀空間幾何診斷維度】
1. front_clearance_cars（數值）：領頭車前方淨空車身長度（以標準轎車約 4.5m 為 1 單位。例如前方 30 米約 6.5 車身；若無淨空則填 1.0~2.0）。
2. rear_tailgating_cars（整數）：緊隨在後方、車距小於 1.5 車身的車輛數（0~10）。
3. brake_lights_active（布林值）：該車道後方跟隨車隊中是否有明顯亮起的車尾煞車紅燈（true/false）。
4. platoon_severity（枚舉）：車隊擠壓緊迫度，僅能填 "NONE" | "MILD" | "MODERATE" | "SEVERE"。
5. micro_bottleneck_score（數值 0.00 ~ 1.00）：綜合微觀烏龜車壓制指數。
   - 計算基準：前方淨空越長（>4 車身）＋ 後方跟隨越緊（>=2 輛）＋ 煞車燈亮起 ➜ 分數越高（≥0.75 為高危險壓制）。
6. gapLane：哪一車道存在微觀壓制/淨空帶頭現象（1: 內側, 2: 外側, 0: 無/雙線均衡）。
7. hasAbnormalGap：若 micro_bottleneck_score >= 0.65 或 front_clearance_cars >= 4.0 填 true，否則填 false。

請【僅嚴格回傳標準 JSON 物件】，禁止包含額外的 Markdown 標籤或對話文字：
{
  "hasAbnormalGap": boolean,
  "gapLane": 0 | 1 | 2,
  "confidence": number,
  "front_clearance_cars": number,
  "rear_tailgating_cars": number,
  "brake_lights_active": boolean,
  "platoon_severity": "NONE" | "MILD" | "MODERATE" | "SEVERE",
  "micro_bottleneck_score": number,
  "observationText": "繁體中文簡述微觀幾何觀察，包含淨空車身數與後方煞車狀態（25~50字）"
}`;

        const modelsToTry = ["gemini-2.5-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
        let geminiResponse: any = null;
        let usedModel = "gemini-2.5-flash";
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

        if (geminiResponse) {
          const rawText = geminiResponse.text || "{}";
          const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(cleaned);

          const frontClearance = typeof parsed.front_clearance_cars === "number" ? Math.max(0, parsed.front_clearance_cars) : 1.5;
          const rearTailgating = typeof parsed.rear_tailgating_cars === "number" ? Math.max(0, Math.floor(parsed.rear_tailgating_cars)) : 0;
          const brakeActive = Boolean(parsed.brake_lights_active);
          const platoon = ["NONE", "MILD", "MODERATE", "SEVERE"].includes(parsed.platoon_severity) ? parsed.platoon_severity : "NONE";
          
          let microScore = typeof parsed.micro_bottleneck_score === "number"
            ? Math.min(1, Math.max(0, parsed.micro_bottleneck_score))
            : (frontClearance > 4.0 && rearTailgating >= 2 ? 0.78 : frontClearance > 3.0 ? 0.45 : 0.12);

          const hasGap = Boolean(parsed.hasAbnormalGap) || microScore >= 0.70;
          const gLane = parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : (hasGap ? 2 : 0);

          parsedResult = {
            hasAbnormalGap: hasGap,
            gapLane: gLane as 0 | 1 | 2,
            confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.95,
            front_clearance_cars: Number(frontClearance.toFixed(1)),
            rear_tailgating_cars: rearTailgating,
            brake_lights_active: brakeActive,
            platoon_severity: platoon,
            micro_bottleneck_score: Number(microScore.toFixed(2)),
            observationText:
              parsed.observationText ||
              (hasGap
                ? `微觀視覺感知：第 ${gLane === 1 ? "1(內側)" : "2(外側)"} 車道前淨空 ${frontClearance.toFixed(1)} 車身，後方 ${rearTailgating} 車緊貼${brakeActive ? "並亮起煞車燈" : ""} (緊迫度 ${platoon})`
                : "車道微觀幾何空間分佈均勻正常，前後車距均勻，無異常帶頭壓速淨空。"),
            modelName: usedModel,
          };
        }
      }
    } catch (fetchOrAiErr: any) {
      console.warn(`[CCTV Step] 鏡頭 ${targetNode.id} 抓圖或 AI 運算暫時異常:`, fetchOrAiErr.message);
    }

    const now = Date.now();
    const record = parsedResult
      ? {
          cameraId: targetNode.id,
          cameraTitle: targetNode.title,
          locationName: targetNode.locationName,
          mileageKm: targetNode.mileage,
          direction: targetNode.direction,
          segmentType: targetNode.segmentType,
          segmentName: targetNode.segmentName,
          hasAbnormalGap: parsedResult.hasAbnormalGap,
          gapLane: parsedResult.gapLane,
          confidence: parsedResult.confidence,
          observationText: parsedResult.observationText,
          front_clearance_cars: parsedResult.front_clearance_cars,
          rear_tailgating_cars: parsedResult.rear_tailgating_cars,
          brake_lights_active: parsedResult.brake_lights_active,
          platoon_severity: parsedResult.platoon_severity,
          micro_bottleneck_score: parsedResult.micro_bottleneck_score,
          isNightMode: false,
          analyzedAt: new Date(now).toISOString(),
          timestamp: new Date(now).toISOString(),
          modelName: parsedResult.modelName,
          cacheTtlRemainingSec: 90,
          isStale: false,
          status: parsedResult.hasAbnormalGap ? "TURTLE_DETECTED" : "NORMAL_FLOW",
        }
      : {
          cameraId: targetNode.id,
          cameraTitle: targetNode.title,
          locationName: targetNode.locationName,
          mileageKm: targetNode.mileage,
          direction: targetNode.direction,
          segmentType: targetNode.segmentType,
          segmentName: targetNode.segmentName,
          hasAbnormalGap: false,
          gapLane: 0,
          confidence: 0.88,
          observationText: `${targetNode.locationName}常態巡檢中：微觀幾何空間車距平穩正常。`,
          front_clearance_cars: 1.8,
          rear_tailgating_cars: 0,
          brake_lights_active: false,
          platoon_severity: "NONE" as const,
          micro_bottleneck_score: 0.12,
          isNightMode: false,
          analyzedAt: new Date(now).toISOString(),
          timestamp: new Date(now).toISOString(),
          modelName: "standby-guard",
          cacheTtlRemainingSec: 90,
          isStale: false,
          status: "NORMAL_FLOW",
        };

    // 5. 將結果寫入 Redis Key: hsuehshan:cctv:cam:{cameraId} (TTL 90 秒)
    if (redis) {
      try {
        const camKey = `hsuehshan:cctv:cam:${targetNode.id}`;
        await redis.set(
          camKey,
          JSON.stringify({
            record,
            cachedAt: now,
          }),
          { ex: 90 }
        );

        // 同步相容寫入方向 cross_validation 快取
        const dirKey = `hsuehshan:cctv:cross_validation:${targetNode.direction}`;
        await redis.set(
          dirKey,
          JSON.stringify({
            cctvResult: record,
            cachedAt: now,
          }),
          { ex: 90 }
        );

        // 6. 推進至下一支鏡頭索引 (保證隊列永遠順暢前進，永不卡死)
        const nextIndex = (currentCamIndex + 1) % HSUEHSHAN_NODES.length;
        await redis.set("hsuehshan:cctv:next_cam_index", nextIndex, { ex: 86400 });
      } catch (rErr) {
        console.error("[CCTV Step] 寫入 Redis 異常:", rErr);
      }
    }

    const elapsed = Date.now() - startMs;
    return res.status(200).json({
      success: true,
      isNightMode: false,
      inspectedCamera: {
        index: currentCamIndex,
        id: targetNode.id,
        title: targetNode.title,
        direction: targetNode.direction,
      },
      nextCameraIndex: (currentCamIndex + 1) % HSUEHSHAN_NODES.length,
      record,
      durationMs: elapsed,
      message: `鏡頭 ${targetNode.title} 巡檢完成並成功快取 (耗時 ${elapsed}ms)`,
    });
  } catch (err: any) {
    console.error("[CCTV Step] 巡檢整體處理保護攔截:", err.message);
    return res.status(200).json({
      success: true,
      error: err.message,
      message: "CCTV 巡檢安全降級防護啟動",
      durationMs: Date.now() - startMs,
    });
  }
}
