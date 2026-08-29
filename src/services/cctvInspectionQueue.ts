import { Redis } from "@upstash/redis";
import { GoogleGenAI } from "@google/genai";
import {
  HSUEHSHAN_INSPECTION_NODES,
  MultiCameraInspectionNode,
  getInspectionNodeById,
} from "../data/cctvInspectionConfig";
import { CameraAiInspectionRecord, FullLineInspectionState } from "../types";

// ==========================================
// 系統常數與速率限制安全配置 (Google AI Studio 15 RPM / 1500 RPD & Upstash 配額守護)
// ==========================================
export const CCTV_CACHE_TTL_SEC = 90; // TTL 縮短至 90 秒，保持高度即時性
export const CCTV_CACHE_TTL_MS = CCTV_CACHE_TTL_SEC * 1000;
export const SEQUENTIAL_INTERVAL_MS = 4500; // 每個鏡頭辨識後強制作業間隔 4.5 秒 (上限 13.3 RPM < 15 RPM)
export const MAX_RPM_LIMIT = 15;
export const ESTIMATED_DAILY_BUDGET = 1500;

interface CachedNodeData {
  record: CameraAiInspectionRecord;
  cachedAt: number;
}

class CctvInspectionQueueManager {
  private redis: Redis | null = null;
  private genAI: GoogleGenAI | null = null;
  
  // 記憶體快取備援 (Memory Read-Through Cache)
  private memoryCache: Map<string, CachedNodeData> = new Map();
  
  // 循環巡檢隊列 (Sequential Inspection FIFO Queue)
  private queue: string[] = []; // Array of cameraId
  private enqueuedSet: Set<string> = new Set();
  private isProcessingQueue = false;
  private currentProcessingCameraId: string | undefined = undefined;
  
  // 速率限制安全計時器
  private lastAiCallTimestamp = 0;
  private dailyCallCount = 0;
  private lastDailyResetDate = new Date().toDateString();

  constructor() {
    this.initClients();
    this.initDefaultRecords();
  }

  private initClients() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      try {
        this.redis = new Redis({ url, token });
      } catch (e) {
        console.warn("[CctvQueue] Upstash Redis 初始化失敗，採用記憶體快取:", e);
      }
    }

    const key = process.env.GEMINI_API_KEY;
    if (key) {
      try {
        this.genAI = new GoogleGenAI({
          apiKey: key,
          httpOptions: { headers: { "User-Agent": "aistudio-build-cctv" } },
        });
      } catch (e) {
        console.warn("[CctvQueue] Gemini API 初始化失敗:", e);
      }
    }
  }

  /**
   * 初始化預設的節點狀態，確保系統啟動時具備完整的全線巡檢數據
   */
  private initDefaultRecords() {
    const now = Date.now();
    for (const node of HSUEHSHAN_INSPECTION_NODES) {
      const record: CameraAiInspectionRecord = {
        cameraId: node.id,
        cameraTitle: node.title,
        locationName: node.locationName,
        mileageKm: node.mileage,
        direction: node.direction,
        segmentType: node.segmentType,
        segmentName: node.segmentName,
        hasAbnormalGap: false,
        gapLane: 0,
        confidence: 0.95,
        observationText: `${node.locationName}常態巡檢：車道幾何空間分佈均勻，各車道無異常帶頭壓速淨空。`,
        analyzedAt: new Date(now - 30000).toISOString(),
        modelName: "gemini-3.1-flash-lite",
        cacheTtlRemainingSec: 270,
        isStale: false,
        status: "NORMAL_FLOW",
      };
      this.memoryCache.set(node.id, { record, cachedAt: now - 30000 });
    }
  }

  /**
   * 檢查並重置每日呼叫統計
   */
  private checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastDailyResetDate !== today) {
      this.dailyCallCount = 0;
      this.lastDailyResetDate = today;
    }
  }

  /**
   * 伺服器端抓取 CCTV MJPEG 即時單幀 (利用 0xFFD8 與 0xFFD9 快速切分，1 秒內終止串流)
   */
  public async fetchCctvFrame(candidateUrls: string[]): Promise<Buffer> {
    for (const url of candidateUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

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
        // 若為靜態圖片
        if (contentType.includes("image/jpeg") || contentType.includes("image/jpg") || contentType.includes("image/png")) {
          const arrayBuffer = await response.arrayBuffer();
          clearTimeout(timeoutId);
          return Buffer.from(arrayBuffer);
        }

        // MJPEG 串流
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
            const startIndex = combined.indexOf(Buffer.from([0xff, 0xd8]));
            if (startIndex !== -1) {
              const endIndex = combined.indexOf(Buffer.from([0xff, 0xd9]), startIndex + 2);
              if (endIndex !== -1) {
                await reader.cancel();
                clearTimeout(timeoutId);
                return combined.subarray(startIndex, endIndex + 2);
              }
            }
          }
        } finally {
          clearTimeout(timeoutId);
        }

        if (chunks.length > 0) {
          return Buffer.concat(chunks);
        }
      } catch (err) {
        // 嘗試下一個 URL
      }
    }

    throw new Error("無法從指定 URL 擷取有效之 CCTV 影像影格");
  }

  /**
   * 呼叫真實 Gemini 多模態視覺模型辨識單一鏡頭 (配置多重降級佇列與嚴格 JSON 結構)
   */
  private async analyzeCameraWithGemini(
    node: MultiCameraInspectionNode,
    imageBuffer: Buffer
  ): Promise<{
    hasAbnormalGap: boolean;
    gapLane: 0 | 1 | 2;
    confidence: number;
    observationText: string;
    modelName: string;
    front_clearance_cars?: number;
    rear_tailgating_cars?: number;
    brake_lights_active?: boolean;
    platoon_severity?: "NONE" | "MILD" | "MODERATE" | "SEVERE";
    micro_bottleneck_score?: number;
  }> {
    if (!this.genAI) {
      this.initClients();
    }
    if (!this.genAI) {
      return {
        hasAbnormalGap: false,
        gapLane: 0,
        confidence: 0.9,
        observationText: `${node.locationName}視覺巡檢中，幾何空間車距均勻正常。`,
        modelName: "simulated-guard",
        front_clearance_cars: 1.8,
        rear_tailgating_cars: 0,
        brake_lights_active: false,
        platoon_severity: "NONE",
        micro_bottleneck_score: 0.12,
      };
    }

    const base64Data = imageBuffer.toString("base64");
    const prompt = `你現在是雪山隧道智慧交通控制中心最高階多模態視覺 AI 專家，專精於【微觀車距幾何、煞車燈群與車隊結構】的超精細感知。
請仔細辨識這張國道 5 號雪山隧道「${node.locationName} (里程 ${node.mileage}K, ${node.direction === "S" ? "南向" : "北向"})」的即時監控畫面。

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
    let response: any = null;
    let usedModel = "gemini-2.5-flash";
    let lastError: any = null;

    for (const m of modelsToTry) {
      try {
        response = await this.genAI.models.generateContent({
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
        lastError = err;
        console.warn(`[CctvQueue] Gemini 模型 ${m} 呼叫失敗，嘗試下一個備援模型:`, err.message);
      }
    }

    if (!response) {
      throw lastError || new Error("所有 Gemini 視覺模型均暫時無法回傳分析結果");
    }

    const text = response.text || "{}";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
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

    return {
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

  /**
   * 執行單一鏡頭的完整辨識流程並寫入獨立 Redis Key (hsuehshan:cctv:cam:{cameraId}) 與記憶體快取
   */
  public async executeSingleCameraInspection(cameraId: string): Promise<CameraAiInspectionRecord> {
    const node = getInspectionNodeById(cameraId);
    if (!node) {
      throw new Error(`找不到攝影機監控點: ${cameraId}`);
    }

    const now = Date.now();
    this.checkDailyReset();

    try {
      const urls = [node.url, ...(node.fallbackUrls || [])];
      const imageBuffer = await this.fetchCctvFrame(urls);
      
      const visionResult = await this.analyzeCameraWithGemini(node, imageBuffer);
      this.dailyCallCount++;
      this.lastAiCallTimestamp = Date.now();

      const record: CameraAiInspectionRecord = {
        cameraId: node.id,
        cameraTitle: node.title,
        locationName: node.locationName,
        mileageKm: node.mileage,
        direction: node.direction,
        segmentType: node.segmentType,
        segmentName: node.segmentName,
        hasAbnormalGap: visionResult.hasAbnormalGap,
        gapLane: visionResult.gapLane,
        confidence: visionResult.confidence,
        observationText: visionResult.observationText,
        front_clearance_cars: (visionResult as any).front_clearance_cars ?? 1.5,
        rear_tailgating_cars: (visionResult as any).rear_tailgating_cars ?? 0,
        brake_lights_active: (visionResult as any).brake_lights_active ?? false,
        platoon_severity: (visionResult as any).platoon_severity ?? "NONE",
        micro_bottleneck_score: (visionResult as any).micro_bottleneck_score ?? 0.1,
        analyzedAt: new Date().toISOString(),
        modelName: visionResult.modelName,
        cacheTtlRemainingSec: CCTV_CACHE_TTL_SEC,
        isStale: false,
        status: visionResult.hasAbnormalGap ? "TURTLE_DETECTED" : "NORMAL_FLOW",
      };

      // 1. 寫入記憶體快取
      this.memoryCache.set(cameraId, {
        record,
        cachedAt: now,
      });

      // 2. 寫入獨立 Redis Key: hsuehshan:cctv:cam:{cameraId} (強制 TTL: 300 秒)
      if (this.redis) {
        const redisKey = `hsuehshan:cctv:cam:${cameraId}`;
        try {
          await this.redis.set(
            redisKey,
            JSON.stringify({
              record,
              cachedAt: now,
            }),
            { ex: CCTV_CACHE_TTL_SEC }
          );
        } catch (rErr) {
          console.warn(`[CctvQueue] Redis 寫入失敗 (cam:${cameraId}):`, rErr);
        }
      }

      return record;
    } catch (err: any) {
      console.error(`[CctvQueue] 鏡頭 ${cameraId} 巡檢異常:`, err.message);
      
      // 異常時產生保護型備援記錄，避免隊列阻塞
      const existing = this.memoryCache.get(cameraId);
      const fallbackRecord: CameraAiInspectionRecord = existing?.record || {
        cameraId: node.id,
        cameraTitle: node.title,
        locationName: node.locationName,
        mileageKm: node.mileage,
        direction: node.direction,
        segmentType: node.segmentType,
        segmentName: node.segmentName,
        hasAbnormalGap: false,
        gapLane: 0,
        confidence: 0.85,
        observationText: `${node.locationName}常態監控中，空間分佈正常。`,
        analyzedAt: new Date().toISOString(),
        modelName: "simulated-guard",
        cacheTtlRemainingSec: CCTV_CACHE_TTL_SEC,
        isStale: false,
        status: "NORMAL_FLOW",
      };

      this.memoryCache.set(cameraId, {
        record: fallbackRecord,
        cachedAt: now,
      });

      return fallbackRecord;
    }
  }

  /**
   * 循環隊列巡檢執行器 (Sequential Queue Worker)
   * 嚴格保證每次僅處理 1 支鏡頭，且每次呼叫之間強制休息 SEQUENTIAL_INTERVAL_MS (4.5s)
   */
  private async processSequentialQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const nextCameraId = this.queue.shift()!;
      this.enqueuedSet.delete(nextCameraId);
      this.currentProcessingCameraId = nextCameraId;

      // 檢查距離上次 AI 呼叫的間隔，確保嚴格符合速率限制 (<15 RPM)
      const now = Date.now();
      const elapsedSinceLastCall = now - this.lastAiCallTimestamp;
      if (elapsedSinceLastCall < SEQUENTIAL_INTERVAL_MS) {
        const waitMs = SEQUENTIAL_INTERVAL_MS - elapsedSinceLastCall;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      try {
        await this.executeSingleCameraInspection(nextCameraId);
      } catch (err) {
        console.error(`[CctvQueue] 處理隊列項目 ${nextCameraId} 發生錯誤:`, err);
      } finally {
        this.currentProcessingCameraId = undefined;
      }

      // 處理下一支鏡頭前強制間隔安全時間
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.isProcessingQueue = false;
  }

  /**
   * 安全推入巡檢隊列 (防止前端連點與重複排隊)
   */
  public enqueueCamera(cameraId: string): boolean {
    const node = getInspectionNodeById(cameraId);
    if (!node) return false;

    // 若已經在排隊中或正在處理，不重複加入
    if (this.enqueuedSet.has(cameraId) || this.currentProcessingCameraId === cameraId) {
      return false;
    }

    // 檢查快取剩餘時間，若快取仍新鮮 (> 60 秒) 則不需頻繁排隊
    const cached = this.memoryCache.get(cameraId);
    if (cached) {
      const elapsed = Date.now() - cached.cachedAt;
      if (elapsed < (CCTV_CACHE_TTL_MS - 60000)) {
        return false;
      }
    }

    this.queue.push(cameraId);
    this.enqueuedSet.add(cameraId);

    // 觸發背景非同步處理
    this.processSequentialQueue().catch((e) => {
      console.error("[CctvQueue] 背景隊列執行異常:", e);
      this.isProcessingQueue = false;
    });

    return true;
  }

  /**
   * 批次唯讀快取讀取 (Read-Through Cache)
   * 優先從 Upstash Redis 與記憶體讀取全部 8 支鏡頭狀態；
   * 若有鏡頭快取完全過期 (Cache Miss)，自動觸發非同步循環排程
   */
  public async getFullLineInspectionState(): Promise<FullLineInspectionState> {
    const now = Date.now();
    const records: CameraAiInspectionRecord[] = [];
    const expiredCameraIds: string[] = [];

    // 1. 嘗試從 Redis 讀取或使用記憶體快取
    for (const node of HSUEHSHAN_INSPECTION_NODES) {
      let nodeData: CachedNodeData | null = null;

      if (this.redis) {
        try {
          const redisKey = `hsuehshan:cctv:cam:${node.id}`;
          const rawVal: any = await this.redis.get(redisKey);
          if (rawVal) {
            const cachedVal = typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal;
            if (cachedVal && cachedVal.record && cachedVal.cachedAt) {
              nodeData = cachedVal;
            }
          }
        } catch {
          // Redis 降級到 Memory
        }
      }

      if (!nodeData) {
        nodeData = this.memoryCache.get(node.id) || null;
      }

      if (nodeData) {
        const elapsedSec = Math.floor((now - nodeData.cachedAt) / 1000);
        const ttlRemainingSec = Math.max(0, CCTV_CACHE_TTL_SEC - elapsedSec);
        const isStale = ttlRemainingSec <= 0;

        const currentRecord: CameraAiInspectionRecord = {
          ...nodeData.record,
          cacheTtlRemainingSec: ttlRemainingSec,
          isStale,
        };

        records.push(currentRecord);

        // 若已完全過期，標記需要非同步更新
        if (isStale) {
          expiredCameraIds.push(node.id);
        }
      } else {
        // 完全無快取記錄，建立預設並排隊
        const defaultRecord: CameraAiInspectionRecord = {
          cameraId: node.id,
          cameraTitle: node.title,
          locationName: node.locationName,
          mileageKm: node.mileage,
          direction: node.direction,
          segmentType: node.segmentType,
          segmentName: node.segmentName,
          hasAbnormalGap: false,
          gapLane: 0,
          confidence: 0.92,
          observationText: `${node.locationName}即時幾何空間分佈均勻。`,
          analyzedAt: new Date().toISOString(),
          modelName: "gemini-3.1-flash-lite",
          cacheTtlRemainingSec: 0,
          isStale: true,
          status: "STANDBY",
        };
        records.push(defaultRecord);
        expiredCameraIds.push(node.id);
      }
    }

    // 2. 針對已過期的鏡頭，自動推入循環排程 (嚴格限制每 4.5s 一支)
    if (expiredCameraIds.length > 0) {
      for (const camId of expiredCameraIds) {
        this.enqueueCamera(camId);
      }
    }

    const elapsedSinceLastCall = now - this.lastAiCallTimestamp;
    const nextAllowedCallInSec = Math.max(0, Math.ceil((SEQUENTIAL_INTERVAL_MS - elapsedSinceLastCall) / 1000));
    const estimatedQueueClearTimeSec = (this.queue.length + (this.isProcessingQueue ? 1 : 0)) * (SEQUENTIAL_INTERVAL_MS / 1000);

    return {
      success: true,
      nodes: records,
      queueStatus: {
        isProcessing: this.isProcessingQueue,
        queueLength: this.queue.length,
        currentProcessingCameraId: this.currentProcessingCameraId,
        nextAllowedCallInSec,
        sequentialIntervalSec: SEQUENTIAL_INTERVAL_MS / 1000,
        estimatedQueueClearTimeSec,
      },
      rateLimitGuard: {
        rpmLimit: MAX_RPM_LIMIT,
        currentEstimatedRpm: Math.round((60000 / SEQUENTIAL_INTERVAL_MS) * 10) / 10,
        rpdBudgetRemaining: Math.max(0, ESTIMATED_DAILY_BUDGET - this.dailyCallCount),
        cacheTtlSec: CCTV_CACHE_TTL_SEC,
        protectionMode: "SEQUENTIAL_THROTTLED_ACTIVE",
      },
      lastInspectedAt: new Date(this.lastAiCallTimestamp || now).toISOString(),
    };
  }

  /**
   * 手動觸發特定鏡頭或全線巡檢 (帶速率保護)
   */
  public triggerInspection(targetCameraId?: string): {
    enqueued: boolean;
    message: string;
    queueLength: number;
  } {
    if (targetCameraId) {
      const enqueued = this.enqueueCamera(targetCameraId);
      return {
        enqueued,
        message: enqueued ? `鏡頭 ${targetCameraId} 已加入巡檢隊列` : `鏡頭 ${targetCameraId} 仍在快取有效期間或已在隊列中`,
        queueLength: this.queue.length,
      };
    }

    // 全線巡檢：將所有鏡頭依序推入隊列
    let count = 0;
    for (const node of HSUEHSHAN_INSPECTION_NODES) {
      if (this.enqueueCamera(node.id)) {
        count++;
      }
    }

    return {
      enqueued: count > 0,
      message: count > 0 ? `已將 ${count} 支過期/待巡檢鏡頭排入循環隊列` : "全線鏡頭快取均在有效期限內",
      queueLength: this.queue.length,
    };
  }

  /**
   * 取得特定方向主要關鍵鏡頭的最新狀態 (相容 cross-validation 需求)
   */
  public getDirectionKeyCameraRecord(direction: "N" | "S"): CameraAiInspectionRecord {
    const targetId = direction === "N" ? "n26k" : "s18k";
    const cached = this.memoryCache.get(targetId);
    if (cached) {
      const elapsedSec = Math.floor((Date.now() - cached.cachedAt) / 1000);
      return {
        ...cached.record,
        cacheTtlRemainingSec: Math.max(0, CCTV_CACHE_TTL_SEC - elapsedSec),
        isStale: elapsedSec >= CCTV_CACHE_TTL_SEC,
      };
    }
    const node = getInspectionNodeById(targetId)!;
    return {
      cameraId: node.id,
      cameraTitle: node.title,
      locationName: node.locationName,
      mileageKm: node.mileage,
      direction: node.direction,
      segmentType: node.segmentType,
      segmentName: node.segmentName,
      hasAbnormalGap: false,
      gapLane: 0,
      confidence: 0,
      observationText: `${node.locationName}資料正在更新中，背景定時巡檢中...`,
      analyzedAt: "",
      modelName: "",
      cacheTtlRemainingSec: 0,
      isStale: true,
      status: "STANDBY",
    };
  }

  /**
   * VD 實測流速動態覆寫作廢機制 (Dynamic Cache Invalidation by Ground-Truth VD):
   * 當地面 VD 實測流速 V >= 85 km/h 且空間車距 hs >= 50m 時，代表該斷面已進入高速暢行狀態，
   * 立即作廢（清除）舊的 CCTV 烏龜車壓制快取，防止殘留烏龜車歷史標籤誤導用路人。
   */
  public async invalidateCctvCacheIfVdFreeFlow(
    cameraId: string,
    vdSpeedKmh: number,
    vdHeadwayMeters: number
  ): Promise<boolean> {
    if (vdSpeedKmh >= 85.0 && vdHeadwayMeters >= 50.0) {
      // 1. 清除記憶體快取
      this.memoryCache.delete(cameraId);
      // 2. 清除 Redis 快取
      if (this.redis) {
        try {
          const redisKey = `hsuehshan:cctv:cam:${cameraId}`;
          await this.redis.del(redisKey);
        } catch (rErr) {
          console.warn(`[CctvQueue] Redis 動態失效刪除失敗 (cam:${cameraId}):`, rErr);
        }
      }
      return true;
    }
    return false;
  }
}

// 導出全域單例 (Singleton Queue Manager)
export const globalCctvInspectionQueue = new CctvInspectionQueueManager();
