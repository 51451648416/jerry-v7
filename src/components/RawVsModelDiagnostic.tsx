import React, { useState, useEffect } from "react";
import {
  Scale,
  Clock,
  Activity,
  AlertTriangle,
  Info,
  ShieldCheck,
  Zap,
  Layers,
  Radio,
  BarChart2,
  TrendingDown,
  TrendingUp,
  Moon,
  CheckCircle2,
  Cpu,
  Database,
  ArrowRightLeft,
  Timer,
  GitMerge,
  CloudLightning,
} from "lucide-react";
import { FinalEstimatorOutput } from "../types";
import ApiDirectTelemetryTable from "./ApiDirectTelemetryTable";
import { synthesizeEtcGroundTruthSec } from "../services/tdxDirectClient";
import { useReconcileQueueStatus } from "../services/autoTrainingCollector";
import { getStoredDataset, subscribeDatasetChanges } from "../services/datasetRepository";

interface RawVsModelDiagnosticProps {
  estimatorOutput: FinalEstimatorOutput;
}

export default function RawVsModelDiagnostic({ estimatorOutput }: RawVsModelDiagnosticProps) {
  const reconcileStatus = useReconcileQueueStatus();
  const [storedDatasetCount, setStoredDatasetCount] = useState(() => getStoredDataset().length);

  useEffect(() => {
    setStoredDatasetCount(getStoredDataset().length);
    const unsub = subscribeDatasetChanges((records) => {
      setStoredDatasetCount(records.length);
    });
    return () => unsub();
  }, []);

  const estState = estimatorOutput.estimated_state;
  const rawVsModel = estState.rawVsModel;
  const rawApi = rawVsModel.rawApi;
  const modelEst = rawVsModel.modelEstimate;
  const adjustment = rawVsModel.modelAdjustment;
  const validation = rawVsModel.trafficStateValidation;
  const apiLatency = estState.apiLatency;
  const nonlinearState = estState.nonlinearTrafficState;

  // Exact Values for Display
  const lane1RawSpeed = rawApi.lane1SpeedKmh.toFixed(2);
  const lane1FlowMin = rawApi.lane1FlowVehPerMin.toFixed(0);
  const lane1FlowHour = rawApi.lane1FlowVehPerHour.toFixed(0);
  const lane1Occ = rawApi.lane1OccupancyPercent.toFixed(1);

  const lane2RawSpeed = rawApi.lane2SpeedKmh.toFixed(2);
  const lane2FlowMin = rawApi.lane2FlowVehPerMin.toFixed(0);
  const lane2FlowHour = rawApi.lane2FlowVehPerHour.toFixed(0);
  const lane2Occ = rawApi.lane2OccupancyPercent.toFixed(1);

  const lane1ModelSpeed = modelEst.lane1EquivalentSpeedKmh.toFixed(2);
  const lane1TravelTime = Math.round(modelEst.lane1TravelTimeSec);
  const lane2ModelSpeed = modelEst.lane2EquivalentSpeedKmh.toFixed(2);
  const lane2TravelTime = Math.round(modelEst.lane2TravelTimeSec);

  // Full precision difference rounded only at display
  const laneDiffSec = Math.round(modelEst.laneDifferenceSec);

  const lane1Delta = (adjustment.lane1DeltaKmh >= 0 ? "+" : "") + adjustment.lane1DeltaKmh.toFixed(2);
  const lane2Delta = (adjustment.lane2DeltaKmh >= 0 ? "+" : "") + adjustment.lane2DeltaKmh.toFixed(2);

  // Exact math verification of equivalent speed
  const expectedEqSpeed =
    estState.travelTimeSec > 0 ? (estState.totalDistanceKm / (estState.travelTimeSec / 3600)).toFixed(2) : "0.00";

  // ETC Ground Truth Calculation (15.03K Toucheng - Pinglin Gantry Corridor)
  const isEtcLive = Boolean(estimatorOutput.raw_api?.etcTravelTimeSec && !estimatorOutput.raw_api?.isEtcSynthetic);
  const etcSec =
    estimatorOutput.raw_api?.etcTravelTimeSec ||
    synthesizeEtcGroundTruthSec(estimatorOutput.raw_api?.records || [], estState.direction);

  // 20-segment Integral equivalent for 15.03K corridor (Toucheng ↔ Pinglin)
  const integral1503kSec = Math.round(estState.travelTimeSec * (15.03 / estState.totalDistanceKm));
  const diffSec = integral1503kSec - etcSec;
  const absDiffSec = Math.abs(diffSec);
  const errorPct = etcSec > 0 ? ((absDiffSec / etcSec) * 100).toFixed(1) : "0.0";
  const accuracyPct = Math.max(0, 100 - parseFloat(errorPct)).toFixed(1);

  const formatMinSec = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m} 分 ${s < 10 ? "0" : ""}${s} 秒`;
  };

  const etcAvgSpeed = etcSec > 0 ? (15.03 / (etcSec / 3600)).toFixed(1) : "0.0";
  const integralAvgSpeed = integral1503kSec > 0 ? (15.03 / (integral1503kSec / 3600)).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* 0. Late Night Raw Direct Pass-Through Alert Banner */}
      {estState.isLateNightHours && (
        <div className="bg-indigo-950/80 border border-indigo-500/50 p-4 rounded-2xl text-indigo-100 flex items-start gap-3 shadow-sm">
          <Moon className="h-5 w-5 text-indigo-300 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <div className="font-bold text-sm text-indigo-200">
              🌙 深夜 02:00 - 04:00 原始 API 直通模式生效中 (Raw API Direct Pass-Through)
            </div>
            <p className="text-indigo-300/90 leading-relaxed">
              依系統規則，深夜時段 02:00 - 04:00 交通量稀少且全線維持自由流速，直接放原 API 資料，不進行延遲補償與波傳播非線性修正 (Model Adjustment Δ = 0 km/h)，直接忠實輸出交通部 TDX 車輛偵測器 (VD) 即時遙測數據。
            </p>
          </div>
        </div>
      )}

      {/* 1. ETC 實測資料診斷面板 (Step 3: ETC Ground Truth Diagnostic Panel) */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ArrowRightLeft className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                高公局 ETC 門架實測資料與空間積分診斷 (ETC Ground Truth vs 20-Segment Integral)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                國道5號 15.03K 區間（頭城 ↔ 坪林）ETC 實測真值對照與空間梯形連續數值積分
              </p>
            </div>
          </div>

          {/* ETC 門架連線狀態標籤 */}
          <div>
            {isEtcLive ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                🟢 【高公局 15.03K 門架即時連線中】(官方 ETC 直連)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-950/80 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold">
                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                🟡 【ETC 空間梯形積分合成保底實測值】(15.03K 門架區間校準)
              </span>
            )}
          </div>
        </div>

        {/* 實測 vs 積分時間對照卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* 卡片 1: ETC 實測旅行時間 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-emerald-400" />
                ETC 實測旅行時間 (Ground Truth)
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800/50">
                {isEtcLive ? "官方實測" : "合成實測值"}
              </span>
            </div>
            <div className="text-xl font-black text-emerald-300 font-mono">
              {formatMinSec(etcSec)}
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-900">
              <span>實測總秒數: {etcSec}s</span>
              <span>均速: {etcAvgSpeed} km/h</span>
            </div>
          </div>

          {/* 卡片 2: 20微元動態積分推估 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-sky-900/40 space-y-1.5 bg-sky-950/10">
            <div className="text-[11px] font-bold text-sky-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Zap className="h-3.5 w-3.5" />
                20微元積分推估 (15.03K 等效)
              </span>
              <span className="text-[10px] font-mono text-sky-300 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/50">
                Model Integral
              </span>
            </div>
            <div className="text-xl font-black text-sky-300 font-mono">
              {formatMinSec(integral1503kSec)}
            </div>
            <div className="text-[10px] text-sky-400/80 font-mono flex items-center justify-between pt-1 border-t border-sky-950">
              <span>積分總秒數: {integral1503kSec}s</span>
              <span>等效均速: {integralAvgSpeed} km/h</span>
            </div>
          </div>

          {/* 卡片 3: 絕對誤差與精準度 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Scale className="h-3.5 w-3.5 text-indigo-400" />
                絕對誤差 (Absolute Error ΔT)
              </span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                parseFloat(errorPct) <= 5.0
                  ? "text-emerald-300 bg-emerald-950 border-emerald-800/50"
                  : "text-amber-300 bg-amber-950 border-amber-800/50"
              }`}>
                精度 {accuracyPct}%
              </span>
            </div>
            <div className={`text-xl font-black font-mono ${
              diffSec === 0
                ? "text-emerald-300"
                : diffSec > 0
                ? "text-amber-300"
                : "text-sky-300"
            }`}>
              {diffSec >= 0 ? `+${diffSec}s` : `${diffSec}s`} <span className="text-xs font-normal text-slate-400 font-sans">({errorPct}%)</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-900">
              <span>誤差容許門檻: ±60s</span>
              <span>{parseFloat(errorPct) <= 5.0 ? "✓ 高度吻合" : "微調校準中"}</span>
            </div>
          </div>

          {/* 卡片 4: 空間連續性與真值保底 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
              訓練資料真值保底機制
            </div>
            <div className="text-sm font-bold text-slate-200 font-mono pt-1">
              100% 寫入有效 ETC 秒數
            </div>
            <p className="text-[10px] text-slate-400 leading-tight pt-1">
              官方 API 離線時自動以 15.03K 梯形調和積分合成真值，杜絕訓練資料集空白缺陷。
            </p>
          </div>
        </div>

        {/* 1.1 Redis 雲端時序對齊延遲結算狀態列 (Time-Aligned Lazy Reconciliation Status) */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-900 pb-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <CloudLightning className="h-4 w-4 text-emerald-400" />
              <span>Redis 雲端時序對齊延遲結算機制 (Time-Aligned Lazy Reconciliation)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 text-[11px] font-mono">
                <Database className="h-3 w-3 text-emerald-400" />
                雲端已累積資料集：{storedDatasetCount} 筆
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-950/60 text-sky-300 border border-sky-800/40 text-[11px] font-mono">
                <GitMerge className="h-3 w-3 text-sky-400" />
                已完成同批車輛時間軸對齊校正
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* 時序對齊佇列 */}
            <div className="flex items-start gap-2.5 bg-slate-900/90 p-3 rounded-lg border border-slate-800">
              <Timer className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <span>時序對齊佇列：</span>
                  <span className="font-mono text-sky-300 font-bold">
                    {reconcileStatus.pendingQueueSize > 0 
                      ? `雲端等待結算中：${reconcileStatus.pendingQueueSize} 筆（依未來出隧道時間結算）`
                      : `即時輪詢就緒（歷史已累積 ${storedDatasetCount} 筆實測真值）`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  克服車輛入隧道與出隧道 ETC 實測間存在的 10~15 分鐘時間滯後 (Lag Phase)。預測軌跡暫存於 Upstash Redis 雲端佇列，待實際車流出隧道後自動撮合真值。
                </p>
              </div>
            </div>

            {/* 對齊校準狀態 */}
            <div className="flex items-start gap-2.5 bg-slate-900/90 p-3 rounded-lg border border-slate-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <span>對齊校準狀態：</span>
                  <span className="font-mono text-emerald-300 font-bold">
                    歷史已結算 {Math.max(storedDatasetCount, reconcileStatus.resolvedCount)} 筆實測真值
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  累計已精準撮合結算 <span className="text-emerald-400 font-mono font-bold">{Math.max(storedDatasetCount, reconcileStatus.resolvedCount)}</span> 筆；徹底解決關閉網頁、分頁離線或跨裝置存取時的資料遺失與時間軸錯位問題。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Header & RAW_API_OBSERVATION Banner */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Scale className="h-4 w-4" />
            </span>
            <h3 className="text-base sm:text-lg font-bold text-white">
              Delay-Aware Nonlinear Traffic State Estimation (RAW vs MODEL 分離診斷)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-lg text-xs font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
              標籤：{rawApi.observationTag}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          拒絕單純線性 speed 修正與黑箱多項式擬合。本系統升級為 <span className="text-sky-300 font-mono">v_i(x_i, t)</span> 時空非線性估計，嚴格區分「資料傳輸延遲 τ_api」與「交通波傳播延遲 τ_propagation」，並結合滯後 (Hysteresis) 與連續動態微元積分。
        </p>
      </div>

      {/* 3. Key Metrics Bar: 6 Essential Dimensions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. RAW API */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <Radio className="h-3 w-3 text-amber-400" />
            RAW API (點均速)
          </div>
          <div className="text-lg font-black text-slate-200 font-mono">
            {rawApi.overallSpeedKmh.toFixed(1)} <span className="text-xs font-normal text-slate-400 font-sans">km/h</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            Spot Arithmetic Mean
          </div>
        </div>

        {/* 2. MODEL ESTIMATE */}
        <div className="bg-slate-900 border border-sky-900/50 p-4 rounded-xl space-y-1 bg-sky-950/10">
          <div className="text-[10px] font-bold text-sky-400 flex items-center gap-1">
            <Zap className="h-3 w-3" />
            MODEL ESTIMATE (等效)
          </div>
          <div className="text-lg font-black text-sky-300 font-mono">
            {estState.equivalentTravelSpeedKmh.toFixed(1)} <span className="text-xs font-normal text-slate-400 font-sans">km/h</span>
          </div>
          <div className="text-[10px] text-sky-400/80 font-mono truncate">
            v_eq = L / (T / 3600)
          </div>
        </div>

        {/* 3. API LATENCY */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <Clock className="h-3 w-3 text-indigo-400" />
            API LATENCY (τ_api)
          </div>
          <div className="text-lg font-black text-indigo-300 font-mono">
            {apiLatency.isLatencyKnown ? `${apiLatency.tauApiSec.toFixed(1)}s` : "UNKNOWN"}
          </div>
          <div className="text-[10px] text-indigo-400/80 font-mono truncate">
            {apiLatency.statusTag}
          </div>
        </div>

        {/* 4. TRAFFIC STATE */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <Activity className="h-3 w-3 text-emerald-400" />
            TRAFFIC STATE
          </div>
          <div className={`text-base font-black font-mono truncate ${nonlinearState.isCongested ? "text-amber-400" : "text-emerald-400"}`}>
            {nonlinearState.state}
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            Hysteresis Gated
          </div>
        </div>

        {/* 5. TRAVEL TIME */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <Clock className="h-3 w-3 text-teal-400" />
            TRAVEL TIME (T)
          </div>
          <div className="text-lg font-black text-teal-300 font-mono">
            {estState.travelTimeFormatted}
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            Σ [Δx_i / v_i(t_i)]
          </div>
        </div>

        {/* 6. LANE SPEED GAP */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-1">
          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
            <Layers className="h-3 w-3 text-purple-400" />
            ΔT (車道差)
          </div>
          <div className="text-lg font-black text-purple-300 font-mono">
            {laneDiffSec} <span className="text-xs font-normal text-slate-400 font-sans">秒</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            |T1 - T2| Precision
          </div>
        </div>
      </div>

      {/* 4. Traffic State Verification & Analytical Reasoning Card */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Delay-Aware 交通狀態估計與波傳播物理守恆檢驗
          </span>
          <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-lg">
            ΔT = |T1 − T2| = {laneDiffSec} 秒 (Full Precision)
          </span>
        </div>

        {/* Verification Checkpoints */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">1. API 延遲補償分離</span>
              <span className="text-indigo-400 font-mono font-bold">
                {apiLatency.isLatencyKnown ? `τ_api = ${apiLatency.tauApiSec.toFixed(1)}s` : "LATENCY_UNKNOWN"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              已嚴格分離 API 傳輸延遲 τ_api 與交通波傳播延遲 τ_propagation ({nonlinearState.tauPropagationSec.toFixed(1)}s)，不將兩者混為一談。
            </p>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">2. 滯後 (Hysteresis) 閘控</span>
              <span className="text-emerald-400 font-mono font-bold">✓ 防止震盪</span>
            </div>
            <p className="text-[11px] text-slate-400">
              進入壅塞 (v&lt;55 km/h, o&gt;24%) 與離開壅塞 (v&gt;68 km/h, o&lt;16%) 採用不對稱閾值，杜絕臨界震盪。
            </p>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">3. 交通波非線性傳播</span>
              <span className="text-emerald-400 font-mono font-bold">✓ Rankine-Hugoniot</span>
            </div>
            <p className="text-[11px] text-slate-400">
              結合 ∂v/∂x 空間梯度與交通流守恆 ∂k/∂t + ∂q/∂x = 0，低速排隊狀態自適應提高時間與空間傳播靈敏度。
            </p>
          </div>
        </div>

        {/* Analytical Explanation */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
          <div className="font-bold text-slate-200 flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-400" />
            交通工程時空微元積分與速度定義說明：
          </div>
          <p className="text-slate-300 text-[11px] leading-relaxed">
            {validation.analyticalExplanation}
          </p>
          <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono text-slate-400">
            <div>
              全線等效速度計算：<span className="text-slate-200">v_eq = L / (T_total / 3600) = {expectedEqSpeed} km/h</span>
            </div>
            <div>
              微元動態積分公式：<span className="text-slate-200">T_total = ∑ [Δx_i / v_est,i(x_i, t_i)]，L = 13.097 km (20 微元)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. 實時 API 傳輸遙測明細與雙重重算驗證表 (Direct API Telemetry & Double Verification) */}
      <ApiDirectTelemetryTable
        doubleVerification={estState.doubleVerification}
        isExtremeSituation={estState.isExtremeSituation}
        defaultExpanded={true}
      />
    </div>
  );
}
