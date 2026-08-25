/**
 * Hsuehshan Tunnel Auto-Training & Continuous Data Collection Service (定時自動取樣與在線模型連續訓練引擎)
 * 
 * 核心功能：
 * 1. 僅限管理員後台啟用 (Guarded by Admin Auth)。
 * 2. 支援自訂「每隔多久寫入一筆」 (intervalSec: 10s ~ 3600s)。
 * 3. 支援自訂「連續執行多久」 (durationMinutes: 30m ~ 1440m，或 0 = 持續執行直至電腦關閉或手動停止)。
 * 4. 每次取樣自動由 TDX 取得即時國5路況，進行空間積分與微元流速估算，並寫入本機資料庫庫 (Dataset Repository)。
 * 5. 取樣寫入後自動啟動在線機器學習微調 (Online Gradient Descent Training)，讓模型參數持續進化。
 * 6. 提供即時狀態監控、倒數計時器、已採集筆數、訓練損失監測與日誌流。
 */

import { Direction, FinalEstimatorOutput } from "../types";
import { fetchDirectFreewayVd, fetchEtcTravelTimeData, synthesizeEtcGroundTruthSec } from "./tdxDirectClient";
import { runVdTrafficEstimator } from "../estimator/trafficEngine";
import { captureDetectionToDataset, getStoredDataset } from "./datasetRepository";
import { trainModelOnDataset, getLearnedParameters } from "../estimator/modelTrainingEngine";
import { getResolvedApiUrl, getResolvedApiHeaders } from "./apiConfig";

export interface AutoCollectionConfig {
  intervalSec: number; // 取樣間隔秒數 (例如 15, 30, 60, 120, 300)
  durationMinutes: number; // 持續時間 (分鐘，0 代表不限時間 / 電腦不關持續運行)
  targetDirection: "BOTH" | "S" | "N"; // 採集方向 (雙向輪流 / 僅南下 / 僅北上)
  autoTrainAfterCapture: boolean; // 取樣後是否自動進行在線梯度下降微調
}

export interface AutoCollectionLog {
  id: string;
  timestamp: string;
  timeFormatted: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  details?: string;
}

export interface AutoCollectionState {
  isRunning: boolean;
  config: AutoCollectionConfig;
  startTimeMs: number | null;
  elapsedSec: number;
  remainingSec: number | null; // null if indefinite
  totalCapturedInSession: number;
  lastCaptureTimestamp: string | null;
  lastCaptureTimeFormatted: string | null;
  lastCapturedDirection: Direction | null;
  nextCountdownSec: number;
  lastTrainingLoss: number | null;
  lastTrainedEpochs: number | null;
  logs: AutoCollectionLog[];
  isCapturingNow: boolean;
}

const DEFAULT_CONFIG: AutoCollectionConfig = {
  intervalSec: 60,
  durationMinutes: 120, // 預設 2 小時
  targetDirection: "BOTH",
  autoTrainAfterCapture: true,
};

class AutoTrainingCollectorService {
  private config: AutoCollectionConfig = { ...DEFAULT_CONFIG };
  private isRunning: boolean = false;
  private startTimeMs: number | null = null;
  private elapsedSec: number = 0;
  private totalCapturedInSession: number = 0;
  private lastCaptureTimestamp: string | null = null;
  private lastCaptureTimeFormatted: string | null = null;
  private lastCapturedDirection: Direction | null = null;
  private nextCountdownSec: number = 60;
  private lastTrainingLoss: number | null = null;
  private lastTrainedEpochs: number | null = null;
  private isCapturingNow: boolean = false;
  private logs: AutoCollectionLog[] = [];

  private timerHandle: any = null;
  private countdownHandle: any = null;
  private listeners: Array<(state: AutoCollectionState) => void> = [];
  private lastAlternatingDir: Direction = "S";

  constructor() {
    this.addLog("系統就緒：自動連續取樣與在線訓練引擎已初始化（限後台啟用）", "info");
  }

  public getState(): AutoCollectionState {
    const remainingSec =
      this.config.durationMinutes > 0 && this.startTimeMs
        ? Math.max(0, this.config.durationMinutes * 60 - this.elapsedSec)
        : null;

    return {
      isRunning: this.isRunning,
      config: { ...this.config },
      startTimeMs: this.startTimeMs,
      elapsedSec: this.elapsedSec,
      remainingSec,
      totalCapturedInSession: this.totalCapturedInSession,
      lastCaptureTimestamp: this.lastCaptureTimestamp,
      lastCaptureTimeFormatted: this.lastCaptureTimeFormatted,
      lastCapturedDirection: this.lastCapturedDirection,
      nextCountdownSec: this.nextCountdownSec,
      lastTrainingLoss: this.lastTrainingLoss,
      lastTrainedEpochs: this.lastTrainedEpochs,
      logs: [...this.logs],
      isCapturingNow: this.isCapturingNow,
    };
  }

  public subscribe(listener: (state: AutoCollectionState) => void): () => void {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(state);
      } catch (err) {
        console.error("AutoTrainingCollector listener error:", err);
      }
    });
  }

  private addLog(
    message: string,
    type: "info" | "success" | "warning" | "error" = "info",
    details?: string
  ) {
    const now = new Date();
    const newLog: AutoCollectionLog = {
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now.toISOString(),
      timeFormatted: now.toLocaleTimeString("zh-TW", { hour12: false }),
      message,
      type,
      details,
    };
    this.logs = [newLog, ...this.logs.slice(0, 49)]; // 保留最新 50 筆
    this.notify();
  }

  /**
   * 啟動定時自動取樣與連續訓練任務
   */
  public start(config?: Partial<AutoCollectionConfig>): boolean {
    if (this.isRunning) {
      this.addLog("自動取樣任務已在執行中，更新設定參數", "info");
      if (config) {
        this.config = { ...this.config, ...config };
      }
      this.notify();
      return true;
    }

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // 確保間隔安全下限 (至少 10 秒)
    if (this.config.intervalSec < 10) {
      this.config.intervalSec = 10;
    }

    this.isRunning = true;
    this.startTimeMs = Date.now();
    this.elapsedSec = 0;
    this.totalCapturedInSession = 0;
    this.nextCountdownSec = this.config.intervalSec;

    const durationLabel =
      this.config.durationMinutes > 0
        ? `${this.config.durationMinutes} 分鐘`
        : "不限時間（持續至關閉電腦或手動停止）";

    this.addLog(
      `🟢 已啟動自動連續取樣與在線訓練：每 ${this.config.intervalSec} 秒寫入一筆，預計持續 ${durationLabel}，採集方向：${
        this.config.targetDirection === "BOTH"
          ? "南下/北上雙向輪流"
          : this.config.targetDirection === "S"
          ? "僅南下"
          : "僅北上"
      }`,
      "success"
    );

    // 立即觸發第一次取樣
    this.executeSingleSamplingStep();

    // 啟動 1 秒精準倒數計時器
    this.countdownHandle = setInterval(() => {
      if (!this.isRunning) return;

      this.elapsedSec += 1;

      // 檢查是否超過設定的總持續時間
      if (this.config.durationMinutes > 0) {
        const totalDurationSec = this.config.durationMinutes * 60;
        if (this.elapsedSec >= totalDurationSec) {
          this.addLog(
            `🏁 已達到設定之總持續時間 (${this.config.durationMinutes} 分鐘)，自動停止採集。本次累計寫入 ${this.totalCapturedInSession} 筆訓練紀錄。`,
            "success"
          );
          this.stop();
          return;
        }
      }

      // 倒數計時
      if (this.nextCountdownSec > 1) {
        this.nextCountdownSec -= 1;
      } else {
        this.nextCountdownSec = this.config.intervalSec;
        this.executeSingleSamplingStep();
      }

      this.notify();
    }, 1000);

    this.notify();
    return true;
  }

  /**
   * 停止定時自動取樣任務
   */
  public stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    if (this.countdownHandle) {
      clearInterval(this.countdownHandle);
      this.countdownHandle = null;
    }

    this.addLog(
      `🔴 已停止定時自動取樣。本次會話共運行 ${Math.floor(this.elapsedSec / 60)} 分 ${
        this.elapsedSec % 60
      } 秒，成功寫入 ${this.totalCapturedInSession} 筆資料庫紀錄。`,
      "info"
    );

    this.notify();
  }

  /**
   * 執行單次取樣、寫入資料庫與連續微調
   */
  public async executeSingleSamplingStep(): Promise<{
    success: boolean;
    message: string;
    recordId?: string;
    autoTrainedAndCleared?: boolean;
  }> {
    if (this.isCapturingNow) {
      return { success: false, message: "前次取樣處理中，略過本次" };
    }

    this.isCapturingNow = true;
    this.notify();

    // 決定本次採集方向
    let targetDir: Direction = "S";
    if (this.config.targetDirection === "BOTH") {
      targetDir = this.lastAlternatingDir === "S" ? "N" : "S";
      this.lastAlternatingDir = targetDir;
    } else {
      targetDir = this.config.targetDirection;
    }

    try {
      // 1. 抓取 TDX 官方即時 VD 數據
      const customApiUrl = getResolvedApiUrl("freewayVd");
      let rawPayload: any = null;

      if (!customApiUrl) {
        rawPayload = await fetchDirectFreewayVd();
      } else {
        const response = await fetch(customApiUrl, {
          method: "GET",
          headers: getResolvedApiHeaders(),
        });
        if (!response.ok) {
          throw new Error(`API 連線回應異常 (HTTP ${response.status})`);
        }
        rawPayload = await response.json();
      }

      // 2. 空間微元積分與流態估算 (嚴格保持 20 微元與 IEEE 754 精度)
      const output: FinalEstimatorOutput = runVdTrafficEstimator(rawPayload, targetDir, 18);

      if (!output || output.raw_api.records.length === 0) {
        throw new Error("TDX 端點未回傳有效之雪山隧道車輛偵測器數據");
      }

      // 同步獲取 ETC 門架旅行時間 (若無直接回傳則依國5北上/南下 15.03K 區間梯形數值積分保底合成)
      let etcTravelTimeSec: number | undefined = undefined;
      try {
        const etcRaw = await fetchEtcTravelTimeData();
        if (etcRaw) {
          const list = Array.isArray(etcRaw) ? etcRaw : etcRaw.TravelTimes || etcRaw.LiveTravelTimes || [];
          for (const item of list) {
            const val = item.TravelTime ?? item.SectionTravelTime ?? item.ActualTravelTime;
            if (typeof val === "number" && val > 0) {
              etcTravelTimeSec = val;
              break;
            }
          }
        }
      } catch {}

      if (!etcTravelTimeSec || etcTravelTimeSec <= 0) {
        etcTravelTimeSec = synthesizeEtcGroundTruthSec(output.raw_api.records, targetDir);
      }

      // 3. 寫入資料庫庫存 (當達到 1,000 筆時，將自動執行 10 Epochs 深度訓練並清空資料庫)
      const { newRecord, totalCount, autoTrainedAndCleared } = captureDetectionToDataset(output, targetDir, etcTravelTimeSec);

      this.totalCapturedInSession += 1;
      this.lastCaptureTimestamp = newRecord.timestamp;
      this.lastCaptureTimeFormatted = newRecord.timeFormatted;
      this.lastCapturedDirection = targetDir;

      let logMsg = "";
      if (autoTrainedAndCleared) {
        logMsg = `🎉 [達成 1,000 筆自動訓練] 資料庫已累積達 1,000 筆上限！已自動完成深度模型梯度校準最佳化，新模型權重已儲存並成功清空資料庫，重啟新一輪採集循環！`;
        this.addLog(
          logMsg,
          "success",
          `10 Epochs 完整收斂完畢，已清空本機資料庫暫存以確保極致效能，新輪循環從 0 筆開始累計至 1000 筆。`
        );
      } else {
        // 4. 自動在線機器學習微調 (輕量梯度下降)
        let trainSummary = "";
        if (this.config.autoTrainAfterCapture) {
          try {
            const currentFullDataset = getStoredDataset();
            const trainResult = trainModelOnDataset(currentFullDataset.slice(0, 50), 3); // 輕量微調
            const finalLoss = trainResult.optimizedLoss.maeSec;
            const baselineLoss = trainResult.baselineLoss.maeSec;
            const improvementPct = baselineLoss > 0 ? ((baselineLoss - finalLoss) / baselineLoss) * 100 : 0;
            this.lastTrainingLoss = finalLoss;
            this.lastTrainedEpochs = 3;
            trainSummary = ` | MAE 誤差: ${finalLoss.toFixed(2)}s (優化率 ${improvementPct > 0 ? `+${improvementPct.toFixed(1)}%` : "0.0%"})`;
          } catch (e) {
            console.warn("Online learning step skipped:", e);
          }
        }

        logMsg = `✓ [${newRecord.timeFormatted}] 自動取樣成功 (${targetDir === "S" ? "南向" : "北向"})：雪隧等效車速 ${newRecord.tunnelEqSpeedKmh.toFixed(1)} km/h，全線 ${newRecord.corridor0to50TravelTimeMin} 分鐘，資料庫累計 ${totalCount} / 1000 筆${trainSummary}`;
        this.addLog(
          logMsg,
          "success",
          `ID: ${newRecord.id} | 車道1: ${newRecord.tunnelLane1SpeedKmh.toFixed(1)} km/h | 車道2: ${newRecord.tunnelLane2SpeedKmh.toFixed(1)} km/h`
        );
      }

      // 發送全域自訂事件，讓畫面上的訓練監控圖表即時重整
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("hsuehshan-dataset-updated", { detail: { totalCount, newRecord, autoTrainedAndCleared } })
        );
      }

      return {
        success: true,
        message: logMsg,
        recordId: newRecord.id,
        autoTrainedAndCleared,
      };
    } catch (err: any) {
      const errMsg = err?.message || "取樣發生異常";
      this.addLog(`✕ 取樣失敗 (${targetDir === "S" ? "南向" : "北向"})：${errMsg}`, "error");

      return {
        success: false,
        message: errMsg,
      };
    } finally {
      this.isCapturingNow = false;
      this.notify();
    }
  }
}

// 導出全域單例服務
export const globalAutoTrainingCollector = new AutoTrainingCollectorService();
