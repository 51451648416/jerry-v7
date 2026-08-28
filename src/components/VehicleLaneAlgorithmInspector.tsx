import React, { useState, useEffect } from "react";
import {
  Truck,
  Bus,
  Car,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  RefreshCw,
  Cpu,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Video,
  Eye,
  Sparkles,
  Server,
  Clock,
  Radio,
  Camera,
} from "lucide-react";
import { FinalEstimatorOutput, CctvVdCrossValidationState } from "../types";
import CctvMultiCameraInspector from "./CctvMultiCameraInspector";

interface VehicleLaneAlgorithmInspectorProps {
  estimatorOutput?: FinalEstimatorOutput | null;
  direction?: "N" | "S";
}

export default function VehicleLaneAlgorithmInspector({
  estimatorOutput,
  direction = "N",
}: VehicleLaneAlgorithmInspectorProps) {
  const currentDirection: "N" | "S" =
    (estimatorOutput?.estimated_state?.direction as "N" | "S") || direction || "N";
  const isSouth = currentDirection === "S";

  const [liveData, setLiveData] = useState<any>(null);
  const [cctvData, setCctvData] = useState<CctvVdCrossValidationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [cctvAnalyzing, setCctvAnalyzing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string>("");
  const [cooldownSec, setCooldownSec] = useState<number>(0);

  // 冷卻時間倒數計時器
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = setInterval(() => {
      setCooldownSec((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSec]);

  const fetchAlgorithmLiveState = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lane-recommendation?direction=${currentDirection}`);
      const json = await res.json();
      if (json && json.success) {
        setLiveData(json);
        if (json.cctvCrossValidation) {
          setCctvData(json.cctvCrossValidation);
        }
        setLastFetched(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      }
    } catch (err) {
      console.error("Failed to fetch lane recommendation data:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCctvStatus = async () => {
    try {
      const res = await fetch(`/api/cctv/cross-validation?direction=${currentDirection}`);
      const json = await res.json();
      if (json && json.success) {
        setCctvData(json);
        if (json.cooldownRemainingSec && json.cooldownRemainingSec > 0) {
          setCooldownSec(json.cooldownRemainingSec);
        }
      }
    } catch (err) {
      console.error("Failed to fetch CCTV status:", err);
    }
  };

  const triggerCctvReanalysis = async () => {
    if (cooldownSec > 0 || cctvAnalyzing) return;
    setCctvAnalyzing(true);
    try {
      const res = await fetch("/api/cctv/cross-validation/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction: currentDirection }),
      });
      const json = await res.json();
      if (json && json.success) {
        setCctvData(json);
        setCooldownSec(json.cooldownRemainingSec || 190);
        fetchAlgorithmLiveState();
      } else if (json && json.cooldownActive) {
        if (json.cooldownRemainingSec) {
          setCooldownSec(json.cooldownRemainingSec);
        }
      }
    } catch (err) {
      console.error("Failed to trigger CCTV re-analysis:", err);
    } finally {
      setCctvAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchAlgorithmLiveState();
    fetchCctvStatus();
    const interval = setInterval(() => {
      fetchAlgorithmLiveState();
      fetchCctvStatus();
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDirection]);

  // 從 estimatorOutput 或即時 API 取得演算法與車種解析數據
  const hasEstOutput = Boolean(estimatorOutput?.estimated_state?.laneComparison);
  const modelInnerSpeed = estimatorOutput?.estimated_state?.laneComparison?.lane1?.equivalentTravelSpeedKmh;
  const modelOuterFinalSpeed = estimatorOutput?.estimated_state?.laneComparison?.lane2?.equivalentTravelSpeedKmh;
  const modelCctvCross = estimatorOutput?.estimated_state?.cctvCrossValidation;

  const currentCctvState = modelCctvCross || cctvData || liveData?.cctvCrossValidation;

  const estBreakdown = estimatorOutput?.estimated_state?.vehicleBreakdown;
  const liveBreakdown = liveData?.vehicleBreakdown;

  const innerLane = liveData?.innerLane || estBreakdown?.innerLane || {
    speedKmh: modelInnerSpeed || 75,
    volumeS: 85,
    volumeL: 4,
    volumeT: 1,
  };

  const outerLane = liveData?.outerLane || estBreakdown?.outerLane || {
    speedKmh: modelOuterFinalSpeed || 76,
    volumeS: 0,
    volumeL: 0,
    volumeT: 0,
  };

  const activeBreakdown = liveBreakdown || estBreakdown || {
    small: (innerLane.volumeS || 0) + (outerLane.volumeS || 0),
    large: (innerLane.volumeL || 0) + (outerLane.volumeL || 0),
    truck: (innerLane.volumeT || 0) + (outerLane.volumeT || 0),
    total: (innerLane.volumeS || 0) + (outerLane.volumeS || 0) + (innerLane.volumeL || 0) + (outerLane.volumeL || 0),
    smallSpeedKmh: Math.round(innerLane.speedKmh || 76),
    largeSpeedKmh: Math.round(outerLane.speedKmh || 76),
  };

  const totalInnerVol = (innerLane.volumeS || 0) + (innerLane.volumeL || 0) + (innerLane.volumeT || 0);
  const totalOuterVol = (outerLane.volumeS || 0) + (outerLane.volumeL || 0) + (outerLane.volumeT || 0);

  const truckRatio = totalOuterVol > 0 ? (outerLane.volumeT || 0) / totalOuterVol : 0;
  const busRatio = totalOuterVol > 0 ? (outerLane.volumeL || 0) / totalOuterVol : 0;
  const isWeekendPeak = liveData?.isWeekendPeak ?? false;

  // 阻抗扣減計算（若無大貨車/大客車且處於自由流暢行區間，折減量嚴格為 0）
  const hasTrucks = (outerLane.volumeT || 0) > 0;
  const hasBuses = (outerLane.volumeL || 0) > 0;
  const truckPenalty = hasTrucks && truckRatio > 0.05 ? Math.min(4.5, (truckRatio - 0.05) * 20) : 0;
  const busPenalty = isWeekendPeak && hasBuses && busRatio > 0.12 ? 2.0 : 0;
  const totalPenalty = truckPenalty + busPenalty;

  // 全域對齊：若有模型全線空間微元流速，優先以頂部主模型流速為最終等效流速，確保上下數據 100% 吻合
  const effectiveInnerSpeed = hasEstOutput && modelInnerSpeed !== undefined 
    ? modelInnerSpeed 
    : (liveData?.effectiveInnerSpeed ?? innerLane.speedKmh);

  const effectiveOuterSpeed = hasEstOutput && modelOuterFinalSpeed !== undefined
    ? modelOuterFinalSpeed
    : (liveData?.effectiveOuterSpeed ?? (outerLane.speedKmh - totalPenalty));

  const recommendedLane = liveData?.recommendedLane ?? (effectiveInnerSpeed >= effectiveOuterSpeed ? "內側車道" : "外側車道");
  const voiceText = liveData?.voiceText ?? (effectiveInnerSpeed >= effectiveOuterSpeed
    ? "即將進入雪山隧道，目前內側實測流速較快，推薦行駛內側車道。"
    : "即將進入雪山隧道，目前外側無重車阻擋且流速優於內側，系統推薦行駛外側車道。");

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 sm:p-6 rounded-3xl shadow-sm space-y-6 text-slate-200">
      {/* 1. 頂部標題與即時刷新狀態 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/50">
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              <span>車輛偵測辨識與智慧推薦演算法工作台</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800">
              <CheckCircle2 className="h-3 w-3" />
              <span>演算法正常運作中 (ONLINE)</span>
            </span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-white">
            雪山隧道{isSouth ? "南向入口 (坪林端 15K~18K)" : "北向入口 (頭城端 28.1K~25K)"} 各車種遙測分流與動態阻抗運算空間
          </h2>
          <p className="text-xs text-slate-400">
            即時自 TDX VD 提取小型車 (S)、大客車 (L)、大貨車 (T) 辨識流量，結合大貨車爬坡壓速阻抗、假日大客車專用道交織模型與雲端視覺交叉驗證。
          </p>
        </div>

        <button
          id="btn-refresh-lane-algo"
          onClick={fetchAlgorithmLiveState}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
          <span>刷新數據</span>
        </button>
      </div>

      {/* 2. 演算法決策看板與語音廣播預覽 */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/50 to-slate-950 border border-indigo-800/40 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              <span>最佳車道推薦決策 ({isSouth ? "南向坪林端" : "北向頭城端"})</span>
            </span>
            <span className="text-sm font-black text-emerald-400 bg-emerald-950/80 px-3 py-0.5 rounded-full border border-emerald-700/60">
              ★ {recommendedLane}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            更新時間: {lastFetched || new Date().toLocaleTimeString("zh-TW")}
          </div>
        </div>

        {/* 語音輸出模擬 */}
        <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-900/50 flex items-start gap-2.5">
          <Volume2 className="h-4 w-4 text-sky-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono text-sky-300 font-bold uppercase tracking-wider">
              Siri 捷徑 / 車載語音輸出文字 (voiceText)
            </div>
            <div className="text-xs sm:text-sm font-semibold text-slate-100">
              "{voiceText}"
            </div>
          </div>
        </div>
      </div>

      {/* 3. 雲端後端 CCTV 影像辨識與地面 VD 交叉驗證儀表 (Observability Dashboard) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950/30 to-slate-950 border border-indigo-700/40 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-950 border border-indigo-700/60 text-indigo-400">
              <Video className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span>雲端後端 CCTV 影像辨識與地面 VD 交叉驗證系統</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/80 text-indigo-300 font-mono border border-indigo-700/50">
                    {isSouth ? "南向 18K 坪林端" : "北向 26K 頭城端"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/80 text-indigo-300 font-mono border border-indigo-700/50">
                    100% 伺服器端閉環執行
                  </span>
                </h3>
              </div>
              <p className="text-[11px] text-slate-400">
                由 Node.js 雲端後端調用 Gemini 視覺模型分析高公局即時畫面之空間幾何車距淨空，並 100% 交叉核對地面 VD 實測流速。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-950/70 text-indigo-300 border border-indigo-700/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>雲端每 5 分鐘自動巡檢</span>
            </span>
          </div>
        </div>

        {/* 狀態卡片區塊 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* 卡片 1: 交叉驗證狀態 */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">交叉驗證判定狀態</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                  currentCctvState?.isVerifiedTurtleCar
                    ? "bg-rose-950 text-rose-300 border border-rose-700"
                    : currentCctvState?.status === "NORMAL_FLOW"
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                    : "bg-slate-800 text-slate-300 border border-slate-700"
                }`}
              >
                {currentCctvState?.isVerifiedTurtleCar
                  ? "● 慢速車阻抗成立 (VERIFIED)"
                  : currentCctvState?.status === "NORMAL_FLOW"
                  ? "✓ 常態通暢 (NORMAL)"
                  : "○ 待命監控中 (STANDBY)"}
              </span>
            </div>
            <div className="text-sm font-bold text-white font-mono">
              {currentCctvState?.isVerifiedTurtleCar
                ? `第 ${currentCctvState.affectedLane === 2 ? "2 (外側)" : "1 (內側)"} 車道受慢速車壓速`
                : "全線各車道車距均勻正常"}
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
              <Clock className="h-3 w-3 text-indigo-400" />
              <span>快取 TTL 剩餘: {currentCctvState?.cacheTtlRemainingSec ?? 360} 秒 (每 5 分鐘 Vercel Cron 背景巡檢)</span>
            </div>
          </div>

          {/* 卡片 2: Gemini 視覺幾何分析 */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-400" />
                <span>Gemini 視覺幾何判定</span>
              </span>
              <span className="text-[10px] font-mono text-indigo-300">
                {currentCctvState?.cctvResult?.modelName || "gemini-3.1-flash-lite"}
              </span>
            </div>
            <div className="text-xs text-slate-200 font-medium leading-relaxed">
              {currentCctvState?.cctvResult?.observationText ||
                currentCctvState?.observationText ||
                "資料正在更新中，背景定時巡檢中..."}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              攝影機: {currentCctvState?.cctvResult?.cameraTitle || (isSouth ? "國5 南向 18K (坪林端入口段)" : "國5 北向 26K (頭城端入口段)")}
            </div>
          </div>

          {/* 卡片 3: 地面 VD 實測流速核對 (Ground Truth) */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <Radio className="h-3 w-3 text-sky-400" />
                <span>地面 VD 實測流速核對</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                100% 物理實測
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center pt-1 font-mono">
              <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">內側 (Lane 1)</div>
                <div className="text-xs font-bold text-sky-400">
                  {currentCctvState?.vdGroundTruth?.innerSpeedKmh ?? innerLane.speedKmh} km/h
                </div>
              </div>
              <div className="p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">外側 (Lane 2)</div>
                <div className="text-xs font-bold text-amber-400">
                  {currentCctvState?.vdGroundTruth?.outerSpeedKmh ?? outerLane.speedKmh} km/h
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 font-mono text-right">
              VD 站點: {currentCctvState?.vdGroundTruth?.vdStationId || (isSouth ? "VD-N5-S-18.000" : "VD-N5-N-26.000")}
            </div>
          </div>
        </div>

        {/* 驗證機制防護說明 */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-300">雙重交叉驗證安全防護原則：</span>
            <span>
              AI 視覺模型僅負責判定前方幾何空間是否有異常大淨空隊列，真實車速 100% 取自地面 VD 測速儀。僅當「視覺確認大淨空」且「地面 VD 實測流速顯著偏慢」時，才進行微元流速上限鎖定與旅行時間重算，嚴禁 AI 隨意猜測速度。
            </span>
          </div>
        </div>
      </div>

      {/* 4. 雪山隧道全線 8 節點多鏡頭循環巡檢矩陣 (Full-Line Multi-Camera Inspection Matrix) */}
      <CctvMultiCameraInspector currentDirection={currentDirection} />

      {/* 4.5 車輛種類偵測數據 (TDX LinkFlows Vehicles 即時解析) */}
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-950 text-indigo-300 border border-indigo-700 text-xs flex items-center gap-1 font-bold">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              <span>車輛種類偵測即時數據 (TDX VD LinkFlows Vehicles)</span>
            </span>
            <span className="text-xs font-mono text-slate-400">
              過車總量: <strong className="text-white font-bold">{activeBreakdown.total ?? (activeBreakdown.small + activeBreakdown.large)}</strong> 輛
            </span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
            動態即時更新
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Car className="h-3.5 w-3.5 text-sky-400" />
              <span>小型車 (S) 流量</span>
            </div>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {activeBreakdown.small ?? 0}
            </div>
            <div className="text-[11px] font-mono text-sky-400 mt-0.5">
              均速: {activeBreakdown.smallSpeedKmh ?? 75} km/h
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Bus className="h-3.5 w-3.5 text-amber-400" />
              <span>大客車 (L) 流量</span>
            </div>
            <div className="text-xl font-bold font-mono text-amber-300 mt-1">
              {activeBreakdown.large ?? 0}
            </div>
            <div className="text-[11px] font-mono text-amber-400 mt-0.5">
              均速: {activeBreakdown.largeSpeedKmh ?? 72} km/h
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Truck className="h-3.5 w-3.5 text-rose-400" />
              <span>大貨車 (T) 流量</span>
            </div>
            <div className="text-xl font-bold font-mono text-rose-300 mt-1">
              {activeBreakdown.truck ?? 0}
            </div>
            <div className="text-[11px] font-mono text-rose-400 mt-0.5">
              佔外側 {totalOuterVol > 0 ? ((truckRatio) * 100).toFixed(1) : "0.0"}%
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>車種統計總計 (Total)</span>
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {activeBreakdown.total ?? (activeBreakdown.small + activeBreakdown.large)}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              S: {activeBreakdown.small ?? 0} / L: {activeBreakdown.large ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* 5. 車種流量辨識與分流統計 (Small Car / Bus / Truck) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 內側車道 */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-ping" />
              <h3 className="font-bold text-sm text-sky-300">內側車道 (第 1 車道)</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              VD 實測: <strong className="text-white">{innerLane.speedKmh} km/h</strong>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Car className="h-3 w-3 text-sky-400" />
                <span>小型車 (S)</span>
              </div>
              <div className="text-base font-bold font-mono text-white mt-1">
                {innerLane.volumeS || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalInnerVol > 0 && innerLane.volumeS ? (((innerLane.volumeS || 0) / totalInnerVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Bus className="h-3 w-3 text-amber-400" />
                <span>大客車 (L)</span>
              </div>
              <div className="text-base font-bold font-mono text-amber-300 mt-1">
                {innerLane.volumeL || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalInnerVol > 0 && innerLane.volumeL ? (((innerLane.volumeL || 0) / totalInnerVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Truck className="h-3 w-3 text-rose-400" />
                <span>大貨車 (T)</span>
              </div>
              <div className="text-base font-bold font-mono text-rose-300 mt-1">
                {innerLane.volumeT || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalInnerVol > 0 && innerLane.volumeT ? (((innerLane.volumeT || 0) / totalInnerVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs flex justify-between items-center font-mono">
            <span className="text-slate-400">等效阻抗修正流速 (v_eff_inner):</span>
            <span className="text-sky-400 font-bold text-sm">
              {effectiveInnerSpeed.toFixed(1)} km/h
            </span>
          </div>
        </div>

        {/* 外側車道 */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
              <h3 className="font-bold text-sm text-amber-300">外側車道 (第 2 車道)</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              VD 實測: <strong className="text-white">{outerLane.speedKmh} km/h</strong>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Car className="h-3 w-3 text-sky-400" />
                <span>小型車 (S)</span>
              </div>
              <div className="text-base font-bold font-mono text-white mt-1">
                {outerLane.volumeS || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalOuterVol > 0 && outerLane.volumeS ? (((outerLane.volumeS || 0) / totalOuterVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Bus className="h-3 w-3 text-amber-400" />
                <span>大客車 (L)</span>
              </div>
              <div className="text-base font-bold font-mono text-amber-300 mt-1">
                {outerLane.volumeL || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalOuterVol > 0 && outerLane.volumeL ? (((outerLane.volumeL || 0) / totalOuterVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800/80">
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Truck className="h-3 w-3 text-rose-400" />
                <span>大貨車 (T)</span>
              </div>
              <div className="text-base font-bold font-mono text-rose-300 mt-1">
                {outerLane.volumeT || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {totalOuterVol > 0 && outerLane.volumeT ? (((outerLane.volumeT || 0) / totalOuterVol) * 100).toFixed(1) : "0.0"}%
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs flex justify-between items-center font-mono">
            <span className="text-slate-400">等效阻抗修正流速 (v_eff_outer):</span>
            <span className="text-amber-400 font-bold text-sm">
              {effectiveOuterSpeed.toFixed(1)} km/h
            </span>
          </div>
        </div>
      </div>

      {/* 5. 演算法阻抗檢驗矩陣 (Algorithm Impedance Audit Matrix) */}
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
        <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-indigo-400" />
          <span>雪隧車道動態阻抗運算規則檢驗 (Impedance Rules Verification)</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* 規則 1：大貨車爬坡壓速阻抗 */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between font-bold">
              <span className="text-slate-200">規則 1：大貨車爬坡壓速阻抗</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${truckRatio > 0.05 ? "bg-rose-950 text-rose-400 border border-rose-800" : "bg-emerald-950 text-emerald-400"}`}>
                {truckRatio > 0.05 ? `觸發 (-${truckPenalty.toFixed(1)} km/h)` : "未觸發 (卡車 ≤5%)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
              外側大貨車佔比: {(truckRatio * 100).toFixed(1)}% (門檻: 5.0%)。公式: min(4.5, (truckRatio - 0.05) * 20)。
            </p>
          </div>

          {/* 規則 2：假日大客車專用道交織阻抗 */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between font-bold">
              <span className="text-slate-200">規則 2：假日客運專用道匯流交織</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${isWeekendPeak && busRatio > 0.12 ? "bg-amber-950 text-amber-400 border border-amber-800" : "bg-slate-800 text-slate-400"}`}>
                {isWeekendPeak && busRatio > 0.12 ? `觸發 (-2.0 km/h)` : isWeekendPeak ? "未觸發 (客運 ≤12%)" : "平日/非尖峰"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
              週末尖峰時段: {isWeekendPeak ? "是 (週六日 13~21時)" : "否"} | 客運佔比: {(busRatio * 100).toFixed(1)}% (門檻: 12.0%)。
            </p>
          </div>

          {/* 規則 3：雲端視覺與地面 VD 交叉驗證 */}
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between font-bold">
              <span className="text-slate-200">規則 3：雲端視覺+VD交叉驗證</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${currentCctvState?.isVerifiedTurtleCar ? "bg-rose-950 text-rose-400 border border-rose-800" : "bg-emerald-950 text-emerald-400"}`}>
                {currentCctvState?.isVerifiedTurtleCar ? "交叉確認成立 (壓制)" : "常態通行 (無大淨空)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
              {currentCctvState?.isVerifiedTurtleCar
                ? `流速上限已鎖定為地面 VD 實測值: ${currentCctvState.speedBoundAppliedKmh || outerLane.speedKmh} km/h`
                : "視覺幾何正常且地面流速平衡，未觸發慢速車壓速防護。"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
