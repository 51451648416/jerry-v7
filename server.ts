import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Redis } from "@upstash/redis";
import { GoogleGenAI } from "@google/genai";
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

// Lazy Gemini AI Client for Cloud Vision Analysis (Server-side Only)
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      genAIClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      return genAIClient;
    } catch (e) {
      console.warn("Gemini API Client 初始化失敗:", e);
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

export interface CctvVisionAnalysisResult {
  hasAbnormalGap: boolean;
  gapLane: 0 | 1 | 2; // 0: None, 1: Inner, 2: Outer
  confidence: number;
  observationText: string;
  cameraId?: string;
  cameraTitle?: string;
  mileageKm?: number;
  direction?: "N" | "S";
  analyzedAt: string;
  modelName?: string;
}

export interface CctvVdCrossValidationState {
  status: "STANDBY" | "ACTIVE_VERIFIED" | "NORMAL_FLOW" | "UNCONFIRMED";
  isVerifiedTurtleCar: boolean;
  affectedLane: 0 | 1 | 2; // 0: None, 1: Inner, 2: Outer
  direction?: "N" | "S";
  cctvResult: CctvVisionAnalysisResult;
  vdGroundTruth: {
    vdStationId: string;
    mileageKm: number;
    innerSpeedKmh: number;
    outerSpeedKmh: number;
    speedDiffKmh: number;
  };
  speedBoundAppliedKmh?: number;
  cacheTtlRemainingSec: number;
  lastUpdated: string;
  systemHealth: {
    geminiVisionStatus: "AVAILABLE" | "FALLBACK" | "SIMULATED";
    cctvStreamStatus: "LIVE_OK" | "FALLBACK_CACHED" | "STANDBY";
    vdStationStatus: "SYNCED" | "INTERPOLATED";
  };
}

// 南北向專屬 CCTV 攝影機與地面站點配置 (北向 26K 頭城端 / 南向 18K 坪林端)
export const DIRECTION_CCTV_CONFIGS = {
  N: {
    id: "n26k",
    title: "國5 北向 26K (頭城端雪隧入口段)",
    mileage: 26.0,
    direction: "N" as const,
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bba9e7d7-cd6f-427f-b82d-6bff1bd0f1ed", // 國5 北向 26K 頭城端
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a", // 國5 北向 25K
    ],
    defaultVdStationId: "VD-N5-N-26.000",
    entranceName: "雪山隧道北向入口段 (頭城端 28.1K~25K)",
  },
  S: {
    id: "s18k",
    title: "國5 南向 18K (坪林端雪隧入口段)",
    mileage: 18.0,
    direction: "S" as const,
    urls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=68764cce-c1f1-4ef7-a911-b33ed35e0c6f", // 國5 南向 18K 坪林端
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=0165bb74-a3e7-42ed-bda8-609f215fc9e5", // 國5 南向 19K
    ],
    defaultVdStationId: "VD-N5-S-18.000",
    entranceName: "雪山隧道南向入口段 (坪林端 15K~18K)",
  },
};

// 雲端 CCTV 影像分析長效快取 (TTL: 240 秒 = 4 分鐘，南北向獨立快取)
const CCTV_VISION_CACHE_TTL_MS = 240 * 1000;
const CCTV_MANUAL_COOLDOWN_MS = 190 * 1000; // 190 秒冷卻時間
let lastManualAnalysisTimestamp: Record<"N" | "S", number> = {
  N: 0,
  S: 0,
};
let globalCctvCrossValidationCache: Record<
  "N" | "S",
  {
    state: CctvVdCrossValidationState;
    cachedAt: number;
  } | null
> = {
  N: null,
  S: null,
};

/**
 * 伺服器端抓取高公局 CCTV 即時截圖 (Node.js 閉環執行，絕不傳輸圖片到前端)
 */
async function fetchCctvSnapshotBuffer(urls: string[]): Promise<{ buffer: Buffer; mimeType: string }> {
  let lastError: any = null;

  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/avif,image/webp,image/apng,image/jpeg,image/*,*/*;q=0.8",
            Referer: "https://1968.freeway.gov.tw/",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP status ${response.status} from ${url}`);
        }

        if (!response.body) {
          throw new Error("Empty response body from CCTV stream");
        }

        const reader = response.body.getReader();
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
          return { buffer: frameBuffer, mimeType: "image/jpeg" };
        }

        const fullBuf = Buffer.concat(chunks);
        if (fullBuf.length > 100) {
          return { buffer: fullBuf, mimeType: "image/jpeg" };
        }

        throw new Error(`Buffer too small (${fullBuf.length} bytes) from ${url}`);
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        console.warn(`CCTV fetch attempt ${attempt + 1} for ${url} failed:`, err.message || err);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
  }

  throw lastError || new Error("Failed to fetch CCTV snapshot from all candidate URLs");
}

/**
 * 伺服器端調用 Gemini 視覺模型分析 CCTV 車道空間幾何淨空結構
 * (嚴禁 AI 猜測速度，僅回傳空間幾何 { hasAbnormalGap, gapLane, observationText })
 */
async function performCloudCctvVisionAnalysis(
  direction: "N" | "S" = "N",
  customCameraInfo?: {
    id: string;
    title: string;
    mileage: number;
    urls: string[];
  }
): Promise<CctvVisionAnalysisResult> {
  const cameraInfo = customCameraInfo || DIRECTION_CCTV_CONFIGS[direction];
  const ai = getGenAI();
  if (!ai) {
    const err = new Error("GEMINI_API_KEY environment variable is not configured on server");
    console.error("Gemini Vision Init Error:", err.message, err.stack);
    throw err;
  }

  const snapshot = await fetchCctvSnapshotBuffer(cameraInfo.urls);

  const directionDesc = direction === "S" ? "南向（台北/坪林往宜蘭）" : "北向（宜蘭/頭城往台北）";

  if (snapshot && ai) {
    try {
      const base64Data = snapshot.buffer.toString("base64");
      const prompt = `你是台灣國道5號雪山隧道的高精度雲端交通視覺辨識系統。
請分析這張雪山隧道即時監視器畫面（行駛方向：${directionDesc}，位置：${cameraInfo.title}，里程 ${cameraInfo.mileage}K），專注於「車道車流空間幾何結構」與「前方異常大淨空（帶頭慢速車/壓速隊列）」。

分析規範：
1. 嚴禁猜測或自行推估任何車速數值（真實時速由地面實體 VD 偵測器提供）。
2. 請仔細檢視各車道車輛的「空間幾何分佈與車距淨空」：
   - 是否有特定車道（外側或內側）出現單一帶頭車前方有異常巨大空白淨空（> 50~100 公尺），而其後方則跟隨多輛車形成緊密排隊隊列（龜速車隊列淨空現象）。
3. gapLane 欄位定義：
   - 0: 無異常淨空，兩車道車流均勻正常或各車道通暢。
   - 1: 內側車道（第1車道/左側）出現前方巨大淨空且後方有緊密跟隨隊列。
   - 2: 外側車道（第2車道/右側）出現前方巨大淨空且後方有緊密跟隨隊列。

請僅回傳標準 JSON 物件：
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
                inlineData: {
                  mimeType: snapshot.mimeType || "image/jpeg",
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
            config: {
              responseMimeType: "application/json",
            },
          });
          usedModel = m;
          break;
        } catch (mErr: any) {
          lastModelError = mErr;
          console.warn(`Vision model ${m} attempt failed:`, mErr.message || mErr);
        }
      }

      if (!response) {
        throw lastModelError || new Error("All vision models failed to return content");
      }

      const text = response.text || "{}";
      const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return {
        hasAbnormalGap: Boolean(parsed.hasAbnormalGap),
        gapLane: parsed.gapLane === 1 || parsed.gapLane === 2 ? parsed.gapLane : 0,
        confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.92,
        observationText:
          parsed.observationText ||
          (parsed.hasAbnormalGap
            ? `雲端視覺辨識偵測到第 ${parsed.gapLane === 1 ? "1 (內側)" : "2 (外側)"} 車道前方出現顯著空間淨空隊列`
            : "車道幾何空間分佈均勻正常，各車道無異常帶頭壓速淨空"),
        cameraId: cameraInfo.id,
        cameraTitle: cameraInfo.title,
        mileageKm: cameraInfo.mileage,
        direction,
        analyzedAt: new Date().toISOString(),
        modelName: usedModel,
      };
    } catch (aiErr: any) {
      console.error(`Gemini 視覺模型辨識時發生錯誤 (${direction}向):`, aiErr.message, aiErr.stack);
      throw aiErr;
    }
  }

  throw new Error(`無法完成 ${direction} 向 CCTV 視覺辨識（未取得影像幀或模型初始化異常）`);
}

/**
 * 雲端視覺與地面 VD 數據交叉驗證（Ground Truth Cross-Validation）
 * 成立條件：僅當「雲端視覺確認外側有異常淨空」且「該處地面 VD 實測外側流速慢於內側」時，才判定該車道受慢速車阻抗影響
 */
export function crossValidateCctvAndVd(
  cctvResult: CctvVisionAnalysisResult,
  groundVd: {
    vdStationId: string;
    mileageKm: number;
    innerSpeedKmh: number;
    outerSpeedKmh: number;
  },
  cacheTtlRemainingSec: number = 240,
  direction: "N" | "S" = "N"
): CctvVdCrossValidationState {
  const speedDiff = Math.abs(groundVd.innerSpeedKmh - groundVd.outerSpeedKmh);
  let status: "STANDBY" | "ACTIVE_VERIFIED" | "NORMAL_FLOW" | "UNCONFIRMED" = "STANDBY";
  let isVerified = false;
  let affectedLane: 0 | 1 | 2 = 0;
  let speedBoundApplied: number | undefined = undefined;

  if (cctvResult.hasAbnormalGap && cctvResult.gapLane > 0) {
    if (cctvResult.gapLane === 2) {
      // 雲端視覺偵測到外側大淨空 -> 交叉驗證：地面 VD 實測外側是否確實較慢？
      const isVdOuterSlower = groundVd.outerSpeedKmh < groundVd.innerSpeedKmh - 2 || groundVd.outerSpeedKmh < 65;
      if (isVdOuterSlower) {
        status = "ACTIVE_VERIFIED";
        isVerified = true;
        affectedLane = 2;
        speedBoundApplied = groundVd.outerSpeedKmh; // 100% 採用地面 VD 實測慢速值
      } else {
        // 視覺有淨空但地面 VD 流速正常甚至外側更快 -> 排除 AI 誤判，標記為 UNCONFIRMED
        status = "UNCONFIRMED";
        isVerified = false;
      }
    } else if (cctvResult.gapLane === 1) {
      // 內側異常淨空
      const isVdInnerSlower = groundVd.innerSpeedKmh < groundVd.outerSpeedKmh - 2 || groundVd.innerSpeedKmh < 65;
      if (isVdInnerSlower) {
        status = "ACTIVE_VERIFIED";
        isVerified = true;
        affectedLane = 1;
        speedBoundApplied = groundVd.innerSpeedKmh;
      } else {
        status = "UNCONFIRMED";
        isVerified = false;
      }
    }
  } else {
    status = "NORMAL_FLOW";
    isVerified = false;
  }

  return {
    status,
    isVerifiedTurtleCar: isVerified,
    affectedLane,
    direction: direction || cctvResult.direction || "N",
    cctvResult,
    vdGroundTruth: {
      vdStationId: groundVd.vdStationId,
      mileageKm: groundVd.mileageKm,
      innerSpeedKmh: groundVd.innerSpeedKmh,
      outerSpeedKmh: groundVd.outerSpeedKmh,
      speedDiffKmh: Math.round(speedDiff * 10) / 10,
    },
    speedBoundAppliedKmh: speedBoundApplied,
    cacheTtlRemainingSec,
    lastUpdated: new Date().toISOString(),
    systemHealth: {
      geminiVisionStatus: process.env.GEMINI_API_KEY ? "AVAILABLE" : "SIMULATED",
      cctvStreamStatus: "LIVE_OK",
      vdStationStatus: "SYNCED",
    },
  };
}

/**
 * 取得最新雲端 CCTV 與 VD 交叉驗證狀態（支援南北向獨立長效快取與 Redis 同步）
 */
export async function getLatestCctvCrossValidation(
  groundVd: {
    vdStationId: string;
    mileageKm: number;
    innerSpeedKmh: number;
    outerSpeedKmh: number;
  },
  forceRefresh = false,
  direction: "N" | "S" = "N"
): Promise<CctvVdCrossValidationState> {
  const now = Date.now();
  const cachedSlot = globalCctvCrossValidationCache[direction];

  // 若在快取有效期間內且未強制刷新，直接回傳快取結果
  if (!forceRefresh && cachedSlot && now - cachedSlot.cachedAt < CCTV_VISION_CACHE_TTL_MS) {
    const elapsedSec = Math.floor((now - cachedSlot.cachedAt) / 1000);
    const ttlRemaining = Math.max(0, Math.floor(CCTV_VISION_CACHE_TTL_MS / 1000) - elapsedSec);

    // 重新用最新的地面 VD 數據核對一次快取中的視覺幾何判定
    const updatedState = crossValidateCctvAndVd(
      cachedSlot.state.cctvResult,
      groundVd,
      ttlRemaining,
      direction
    );
    return updatedState;
  }

  // 嘗試從 Upstash Redis 讀取快取
  const redis = getRedis();
  const redisKey = `hsuehshan:cctv:cross_validation:${direction}`;
  if (!forceRefresh && redis) {
    try {
      const cachedRedis: any = await redis.get(redisKey);
      if (cachedRedis && cachedRedis.cctvResult && cachedRedis.cachedAt) {
        const elapsed = now - Number(cachedRedis.cachedAt);
        if (elapsed < CCTV_VISION_CACHE_TTL_MS) {
          const ttlRemaining = Math.max(0, Math.floor(CCTV_VISION_CACHE_TTL_MS / 1000) - Math.floor(elapsed / 1000));
          const state = crossValidateCctvAndVd(cachedRedis.cctvResult, groundVd, ttlRemaining, direction);
          globalCctvCrossValidationCache[direction] = { state, cachedAt: Number(cachedRedis.cachedAt) };
          return state;
        }
      }
    } catch (e) {
      console.warn(`Redis CCTV (${direction}向) 快取讀取失敗，直接執行後端辨識:`, e);
    }
  }

  // 執行即時雲端視覺分析
  const cctvResult = await performCloudCctvVisionAnalysis(direction);
  const state = crossValidateCctvAndVd(cctvResult, groundVd, Math.floor(CCTV_VISION_CACHE_TTL_MS / 1000), direction);

  globalCctvCrossValidationCache[direction] = {
    state,
    cachedAt: now,
  };

  if (redis) {
    try {
      await redis.set(
        redisKey,
        {
          cctvResult,
          cachedAt: now,
        },
        { ex: 240 }
      );
    } catch {}
  }

  return state;
}

export function calculateAdvancedLaneRecommendation(
  innerLane: VDLaneData,
  outerLane: VDLaneData,
  isWeekendPeak: boolean,
  cctvCrossValidation?: CctvVdCrossValidationState,
  direction: "N" | "S" = "N"
) {
  let effectiveInnerSpeed = innerLane.speedKmh;
  let effectiveOuterSpeed = outerLane.speedKmh;
  let outerPenaltyReasons: string[] = [];

  const totalOuterVolume = outerLane.volumeS + outerLane.volumeL + outerLane.volumeT;
  const truckRatio = totalOuterVolume > 0 ? outerLane.volumeT / totalOuterVolume : 0;
  const busRatio = totalOuterVolume > 0 ? outerLane.volumeL / totalOuterVolume : 0;

  // 規則 1：大貨車爬坡壓速阻抗
  if (truckRatio > 0.05) {
    const truckPenalty = Math.min(4.5, (truckRatio - 0.05) * 20);
    effectiveOuterSpeed -= truckPenalty;
    outerPenaltyReasons.push(`卡車佔比達 ${(truckRatio * 100).toFixed(1)}% 易受爬坡微幅壓速`);
  }

  // 規則 2：假日大客車專用道交織阻抗
  if (isWeekendPeak && busRatio > 0.12) {
    effectiveOuterSpeed -= 2.0;
    outerPenaltyReasons.push("尖峰客運高頻匯流");
  }

  // 規則 3：雲端後端 CCTV 影像辨識與地面 VD 交叉驗證成立之慢速車阻抗
  if (cctvCrossValidation && cctvCrossValidation.isVerifiedTurtleCar && cctvCrossValidation.affectedLane === 2) {
    const vdSlowSpeed = cctvCrossValidation.speedBoundAppliedKmh || outerLane.speedKmh;
    // 實測慢速值壓制上限
    effectiveOuterSpeed = Math.min(effectiveOuterSpeed, vdSlowSpeed);
    outerPenaltyReasons.push("雲端視覺與地面VD交叉確認外側前方受慢速車壓速隊列影響");
  }

  effectiveOuterSpeed = Math.max(0, effectiveOuterSpeed);
  const recommendInner = effectiveInnerSpeed >= effectiveOuterSpeed;

  const dirDesc = direction === "S" ? "南向坪林端" : "北向頭城端";
  let voiceText = "";
  if (recommendInner) {
    if (outerPenaltyReasons.length > 0) {
      voiceText = `即將進入雪山隧道（${dirDesc}），目前外側${outerPenaltyReasons.join("且")}，系統推薦行駛內側車道。`;
    } else {
      voiceText = `即將進入雪山隧道（${dirDesc}），目前內側實測流速較快，推薦行駛內側車道。`;
    }
  } else {
    voiceText = `即將進入雪山隧道（${dirDesc}），目前外側無重車阻擋且流速優於內側，系統推薦行駛外側車道。`;
  }

  return {
    recommendedLane: recommendInner ? "內側車道" : "外側車道",
    effectiveInnerSpeed: Number(effectiveInnerSpeed.toFixed(1)),
    effectiveOuterSpeed: Number(effectiveOuterSpeed.toFixed(1)),
    truckRatio: Number(truckRatio.toFixed(3)),
    busRatio: Number(busRatio.toFixed(3)),
    voiceText: voiceText,
    cctvCrossValidation,
    direction,
  };
}

// 全域南北向車道推薦快取（供所有 API 端點如 /api/dataset、/api/lane-recommendation 隨時讀取）
let globalLatestLaneRecommendation: Record<"N" | "S", any> = {
  N: {
    recommendedLane: "內側車道",
    effectiveInnerSpeed: 75.0,
    effectiveOuterSpeed: 72.0,
    truckRatio: 0.015,
    busRatio: 0.04,
    voiceText: "即將進入雪山隧道（北向頭城端），目前內側實測流速較快，推薦行駛內側車道。",
    timestamp: new Date().toISOString(),
    cctvCrossValidation: null,
    direction: "N",
  },
  S: {
    recommendedLane: "內側車道",
    effectiveInnerSpeed: 76.0,
    effectiveOuterSpeed: 74.0,
    truckRatio: 0.012,
    busRatio: 0.03,
    voiceText: "即將進入雪山隧道（南向坪林端），目前內側實測流速較快，推薦行駛內側車道。",
    timestamp: new Date().toISOString(),
    cctvCrossValidation: null,
    direction: "S",
  },
};

// 輔助函式：自 TDX VD 數據中解析北向(28.1K~25K)或南向(15K~18K)雪隧入口的各車道車速與車種流量 (S/L/T)
export function extractDirectionalEntranceVdData(
  vdPayload: any,
  direction: "N" | "S" = "N"
): { innerLane: VDLaneData; outerLane: VDLaneData; vdCount: number; direction: "N" | "S" } {
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

    const isMatchDirection =
      direction === "S"
        ? /-S-|-SB-|-S(?=[-_]|$)|南向|南下|\bSB\b/i.test(vdid) ||
          String(item.Direction || "").toUpperCase() === "S" ||
          String(item.Direction || "").toUpperCase() === "SB"
        : /-N-|-NB-|-N(?=[-_]|$)|北向|北上|\bNB\b/i.test(vdid) ||
          String(item.Direction || "").toUpperCase() === "N" ||
          String(item.Direction || "").toUpperCase() === "NB";

    if (!isMatchDirection) continue;

    // 提取里程數
    let mileageKm = 0;
    if (typeof item.Mileage === "number") mileageKm = item.Mileage;
    else if (typeof item.mileageKm === "number") mileageKm = item.mileageKm;
    else {
      const match = vdid.match(/(\d+(?:\.\d+)?)/);
      if (match) mileageKm = parseFloat(match[1]);
    }

    // 判斷是否位於入口區間 (北向頭城端 24.8K ~ 28.5K / 南向坪林端 14.5K ~ 18.8K)
    const isInEntranceBounds =
      direction === "S"
        ? (mileageKm >= 14.5 && mileageKm <= 18.8) ||
          vdid.includes("15.0") ||
          vdid.includes("15.3") ||
          vdid.includes("16.0") ||
          vdid.includes("17.0") ||
          vdid.includes("18.0")
        : (mileageKm >= 24.8 && mileageKm <= 28.5) ||
          vdid.includes("28.1") ||
          vdid.includes("28.0") ||
          vdid.includes("27.5") ||
          vdid.includes("27.0") ||
          vdid.includes("26.0") ||
          vdid.includes("25.0");

    if (!isInEntranceBounds && mileageKm > 0) continue;

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

  const defaultInner = direction === "S" ? 76 : 75;
  const defaultOuter = direction === "S" ? 74 : 72;
  const avgInnerSpeed = innerSpeeds.length > 0 ? innerSpeeds.reduce((a, b) => a + b, 0) / innerSpeeds.length : defaultInner;
  const avgOuterSpeed = outerSpeeds.length > 0 ? outerSpeeds.reduce((a, b) => a + b, 0) / outerSpeeds.length : defaultOuter;

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
    direction,
  };
}

// 相容別名函式：解析北向入口 VD 數據
export function extractNorthEntranceVdData(vdPayload: any) {
  return extractDirectionalEntranceVdData(vdPayload, "N");
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
      const direction: "N" | "S" = String(req.query.direction || "N").toUpperCase() === "S" ? "S" : "N";
      const redis = getRedis();
      let data = globalSharedDatasetRecords;
      if (redis) {
        data = (await redis.get("dataset_records")) || (await redis.get("hsuehshan:shared:dataset")) || data || [];
      }
      const dirRecommendation = globalLatestLaneRecommendation[direction] || globalLatestLaneRecommendation.N;
      return res.json({
        success: true,
        data: data || [],
        direction,
        // 頂層相容附加即時車道推薦（方便 iOS 捷徑、語音助理直接解析頂層欄位）
        voiceText: dirRecommendation?.voiceText || "即將進入雪山隧道，系統推薦行駛內側車道。",
        recommendedLane: dirRecommendation?.recommendedLane || "內側車道",
        effectiveInnerSpeed: dirRecommendation?.effectiveInnerSpeed || (direction === "S" ? 76.0 : 75.0),
        effectiveOuterSpeed: dirRecommendation?.effectiveOuterSpeed || (direction === "S" ? 74.0 : 72.0),
        truckRatio: dirRecommendation?.truckRatio || 0,
        busRatio: dirRecommendation?.busRatio || 0,
        recommendation: dirRecommendation,
        updateTime: dirRecommendation?.timestamp || new Date().toISOString(),
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
    const defaultEndpoint = {
      success: true,
      endpoint: process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "https://jerry-sepia.vercel.app",
      status: "ACTIVE",
      version: "1.0.0",
    };
    try {
      const redis = getRedis();
      if (redis) {
        const cached: any = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          globalSavedApiConfig = cached;
          const result = typeof cached === "object" ? { ...defaultEndpoint, ...cached } : { ...defaultEndpoint, endpoint: cached };
          return res.json(result);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (globalSavedApiConfig) {
      const result = typeof globalSavedApiConfig === "object" ? { ...defaultEndpoint, ...globalSavedApiConfig } : { ...defaultEndpoint, endpoint: globalSavedApiConfig };
      return res.json(result);
    }
    return res.json(defaultEndpoint);
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

  // 專屬雲端 CCTV 影像辨識與地面 VD 交叉驗證狀態 API (支援 direction: 'N' | 'S')
  app.get("/api/cctv/cross-validation", async (req, res) => {
    try {
      const direction: "N" | "S" = String(req.query.direction || "N").toUpperCase() === "S" ? "S" : "N";
      const config = DIRECTION_CCTV_CONFIGS[direction];
      const dirRec = globalLatestLaneRecommendation[direction];

      const now = Date.now();
      const lastTime = lastManualAnalysisTimestamp[direction] || 0;
      const elapsed = now - lastTime;
      const cooldownRemainingSec = elapsed < CCTV_MANUAL_COOLDOWN_MS ? Math.ceil((CCTV_MANUAL_COOLDOWN_MS - elapsed) / 1000) : 0;

      const state = await getLatestCctvCrossValidation(
        {
          vdStationId: config.defaultVdStationId,
          mileageKm: config.mileage,
          innerSpeedKmh: dirRec?.innerLane?.speedKmh || (direction === "S" ? 76.0 : 75.0),
          outerSpeedKmh: dirRec?.outerLane?.speedKmh || (direction === "S" ? 74.0 : 72.0),
        },
        req.query.refresh === "true",
        direction
      );
      return res.json({ success: true, direction, cooldownRemainingSec, ...state });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/cctv/cross-validation/analyze", async (req, res) => {
    try {
      const direction: "N" | "S" =
        String(req.body?.direction || req.query.direction || "N").toUpperCase() === "S" ? "S" : "N";
      
      const now = Date.now();
      const lastTime = lastManualAnalysisTimestamp[direction] || 0;
      const elapsed = now - lastTime;

      if (elapsed < CCTV_MANUAL_COOLDOWN_MS) {
        const remainingSec = Math.ceil((CCTV_MANUAL_COOLDOWN_MS - elapsed) / 1000);
        const cachedSlot = globalCctvCrossValidationCache[direction];
        const dirRec = globalLatestLaneRecommendation[direction];
        const config = DIRECTION_CCTV_CONFIGS[direction];

        let state = cachedSlot?.state;
        if (!state) {
          state = await getLatestCctvCrossValidation(
            {
              vdStationId: config.defaultVdStationId,
              mileageKm: config.mileage,
              innerSpeedKmh: dirRec?.innerLane?.speedKmh || (direction === "S" ? 76.0 : 75.0),
              outerSpeedKmh: dirRec?.outerLane?.speedKmh || (direction === "S" ? 74.0 : 72.0),
            },
            false,
            direction
          );
        }

        return res.json({
          success: false,
          cooldownActive: true,
          cooldownRemainingSec: remainingSec,
          message: `重新辨識冷卻中，請於 ${remainingSec} 秒後再試（冷卻時間 190 秒）`,
          direction,
          ...state,
        });
      }

      // 紀錄本次手動重新辨識時間
      lastManualAnalysisTimestamp[direction] = now;

      const config = DIRECTION_CCTV_CONFIGS[direction];
      const dirRec = globalLatestLaneRecommendation[direction];

      const state = await getLatestCctvCrossValidation(
        {
          vdStationId: config.defaultVdStationId,
          mileageKm: config.mileage,
          innerSpeedKmh: dirRec?.innerLane?.speedKmh || (direction === "S" ? 76.0 : 75.0),
          outerSpeedKmh: dirRec?.outerLane?.speedKmh || (direction === "S" ? 74.0 : 72.0),
        },
        true, // 強制立即重新抓圖與視覺分析
        direction
      );
      return res.json({ success: true, direction, cooldownRemainingSec: 190, ...state });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Unified endpoint for Freeway VD data with Automatic Key Rotation, Failover & Advanced Lane Recommendation
  const handleFreewayVd = async (req: express.Request, res: express.Response) => {
    try {
      const tdxUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";

      const result = await globalTdxKeyManager.executeWithFailover<any>(tdxUrl);
      const rawData = result.data;
      const requestedDirection: "N" | "S" =
        String(req.query.direction || "N").toUpperCase() === "S" ? "S" : "N";

      const isWeekendPeak = isWeekendPeakTime();

      // 提取北向 (28.1K ~ 25K) 與南向 (15K ~ 18K) 雪隧入口各車種流量與速度
      const northData = extractDirectionalEntranceVdData(rawData, "N");
      const southData = extractDirectionalEntranceVdData(rawData, "S");

      // 獲取雲端 CCTV 影像與地面 VD 交叉驗證狀態 (TTL 快取 240 秒)
      const northCctvState = await getLatestCctvCrossValidation(
        {
          vdStationId: DIRECTION_CCTV_CONFIGS.N.defaultVdStationId,
          mileageKm: DIRECTION_CCTV_CONFIGS.N.mileage,
          innerSpeedKmh: northData.innerLane.speedKmh,
          outerSpeedKmh: northData.outerLane.speedKmh,
        },
        false,
        "N"
      );

      const southCctvState = await getLatestCctvCrossValidation(
        {
          vdStationId: DIRECTION_CCTV_CONFIGS.S.defaultVdStationId,
          mileageKm: DIRECTION_CCTV_CONFIGS.S.mileage,
          innerSpeedKmh: southData.innerLane.speedKmh,
          outerSpeedKmh: southData.outerLane.speedKmh,
        },
        false,
        "S"
      );

      // 計算升級版雪山隧道即時車道推薦演算法（融合雲端視覺與地面實測交叉驗證）
      const northRecommendation = calculateAdvancedLaneRecommendation(
        northData.innerLane,
        northData.outerLane,
        isWeekendPeak,
        northCctvState,
        "N"
      );

      const southRecommendation = calculateAdvancedLaneRecommendation(
        southData.innerLane,
        southData.outerLane,
        isWeekendPeak,
        southCctvState,
        "S"
      );

      globalLatestLaneRecommendation.N = {
        ...northRecommendation,
        innerLane: northData.innerLane,
        outerLane: northData.outerLane,
        isWeekendPeak,
        matchedVdCount: northData.vdCount,
        cctvCrossValidation: northCctvState,
        timestamp: new Date().toISOString(),
        direction: "N",
      };

      globalLatestLaneRecommendation.S = {
        ...southRecommendation,
        innerLane: southData.innerLane,
        outerLane: southData.outerLane,
        isWeekendPeak,
        matchedVdCount: southData.vdCount,
        cctvCrossValidation: southCctvState,
        timestamp: new Date().toISOString(),
        direction: "S",
      };

      const primaryRecommendation = requestedDirection === "S" ? southRecommendation : northRecommendation;
      const primaryData = requestedDirection === "S" ? southData : northData;
      const primaryCctvState = requestedDirection === "S" ? southCctvState : northCctvState;

      // 回傳無損向下相容之 JSON 結構
      if (Array.isArray(rawData)) {
        if (req.query.format === "object" || req.query.include_recommendation === "true") {
          return res.json({
            data: rawData,
            ...primaryRecommendation,
            direction: requestedDirection,
            innerLane: primaryData.innerLane,
            outerLane: primaryData.outerLane,
            northEntranceInnerLane: northData.innerLane,
            northEntranceOuterLane: northData.outerLane,
            southEntranceInnerLane: southData.innerLane,
            southEntranceOuterLane: southData.outerLane,
            isWeekendPeak,
            cctvCrossValidation: primaryCctvState,
            directionalRecommendations: {
              N: globalLatestLaneRecommendation.N,
              S: globalLatestLaneRecommendation.S,
            },
            matchedEntranceVdCount: primaryData.vdCount,
            updateTime: new Date().toISOString(),
          });
        }
        // 直接在 Array 物件上附加欄位或回傳陣列
        (rawData as any).recommendedLane = primaryRecommendation.recommendedLane;
        (rawData as any).effectiveInnerSpeed = primaryRecommendation.effectiveInnerSpeed;
        (rawData as any).effectiveOuterSpeed = primaryRecommendation.effectiveOuterSpeed;
        (rawData as any).truckRatio = primaryRecommendation.truckRatio;
        (rawData as any).busRatio = primaryRecommendation.busRatio;
        (rawData as any).voiceText = primaryRecommendation.voiceText;
        (rawData as any).advancedLaneRecommendation = primaryRecommendation;
        (rawData as any).cctvCrossValidation = primaryCctvState;
        (rawData as any).directionalRecommendations = {
          N: globalLatestLaneRecommendation.N,
          S: globalLatestLaneRecommendation.S,
        };

        return res.json(rawData);
      } else if (rawData && typeof rawData === "object") {
        return res.json({
          ...rawData,
          ...primaryRecommendation,
          direction: requestedDirection,
          innerLane: primaryData.innerLane,
          outerLane: primaryData.outerLane,
          northEntranceInnerLane: northData.innerLane,
          northEntranceOuterLane: northData.outerLane,
          southEntranceInnerLane: southData.innerLane,
          southEntranceOuterLane: southData.outerLane,
          isWeekendPeak,
          cctvCrossValidation: primaryCctvState,
          directionalRecommendations: {
            N: globalLatestLaneRecommendation.N,
            S: globalLatestLaneRecommendation.S,
          },
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
      const direction: "N" | "S" = String(req.query.direction || "N").toUpperCase() === "S" ? "S" : "N";
      const config = DIRECTION_CCTV_CONFIGS[direction];
      const tdxUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";
      const result = await globalTdxKeyManager.executeWithFailover<any>(tdxUrl);
      const data = extractDirectionalEntranceVdData(result.data, direction);
      const isWeekendPeak = isWeekendPeakTime();

      const cctvCrossValidation = await getLatestCctvCrossValidation(
        {
          vdStationId: config.defaultVdStationId,
          mileageKm: config.mileage,
          innerSpeedKmh: data.innerLane.speedKmh,
          outerSpeedKmh: data.outerLane.speedKmh,
        },
        false,
        direction
      );

      const recommendation = calculateAdvancedLaneRecommendation(
        data.innerLane,
        data.outerLane,
        isWeekendPeak,
        cctvCrossValidation,
        direction
      );
      globalLatestLaneRecommendation[direction] = {
        ...recommendation,
        innerLane: data.innerLane,
        outerLane: data.outerLane,
        isWeekendPeak,
        cctvCrossValidation,
        matchedVdCount: data.vdCount,
        direction,
        timestamp: new Date().toISOString(),
      };

      return res.json({
        success: true,
        direction,
        ...recommendation,
        innerLane: data.innerLane,
        outerLane: data.outerLane,
        isWeekendPeak,
        cctvCrossValidation,
        matchedVdCount: data.vdCount,
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
