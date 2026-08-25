import React, { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Compass,
  CornerDownRight,
  Gauge,
  HelpCircle,
  Layers,
  MapPin,
  Radio,
  Route,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { FinalEstimatorOutput, Direction } from "../types";
import {
  ComprehensiveMeteringState,
  SignalTimingResult,
  ThreeTierTravelTimeResult,
  evaluateFreeway5MeteringSystem,
} from "../estimator/rampMeteringEngine";

interface RampMeterPulseMeterProps {
  estimatorOutput: FinalEstimatorOutput | null;
  direction: Direction;
  onSelectInterchange?: (name: string) => void;
}

/**
 * 逼真擬真實體交通號誌燈箱組件 (Realistic Highway Traffic Light Assembly)
 */
function RealisticTrafficLight({
  currentPhase, // "GREEN" | "YELLOW" | "RED"
  secondsRemaining,
  title,
  subtitle,
}: {
  currentPhase: "GREEN" | "YELLOW" | "RED";
  secondsRemaining: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center bg-slate-950/90 rounded-2xl p-4 border border-slate-800/90 shadow-2xl relative">
      <div className="text-center mb-3">
        <div className="text-xs font-bold text-slate-200 tracking-wide">{title}</div>
        <div className="text-[10px] text-slate-400 font-mono">{subtitle}</div>
      </div>

      <div className="relative p-2.5 bg-gradient-to-b from-yellow-400 via-amber-400 to-yellow-500 rounded-2xl shadow-[0_10px_25px_rgba(0,0,0,0.8),inset_0_2px_4px_rgba(255,255,255,0.4)] border-2 border-yellow-500">
        <div className="bg-gradient-to-b from-neutral-900 via-zinc-950 to-neutral-900 rounded-xl p-3 shadow-inner border border-neutral-800 flex flex-col items-center gap-3 w-24">
          
          {/* 1. 紅燈 */}
          <div className="relative flex flex-col items-center">
            <div className="w-16 h-3 bg-neutral-900 rounded-t-full border-t border-x border-neutral-700 shadow-md -mb-1 z-10 opacity-90" />
            <div
              className={`w-14 h-14 rounded-full border-2 transition-all duration-300 flex items-center justify-center relative overflow-hidden ${
                currentPhase === "RED"
                  ? "bg-rose-600 border-rose-400 shadow-[0_0_28px_rgba(239,68,68,1),0_0_50px_rgba(244,63,94,0.6),inset_0_0_12px_#ffffff]"
                  : "bg-rose-950/30 border-rose-950/60 shadow-inner"
              }`}
            >
              <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 rounded-full blur-[1px] transform -rotate-45 pointer-events-none" />
              <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px] opacity-30" />
              {currentPhase === "RED" && (
                <span className="text-white font-mono font-black text-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10">
                  {secondsRemaining}s
                </span>
              )}
            </div>
          </div>

          {/* 2. 黃燈 */}
          <div className="relative flex flex-col items-center">
            <div className="w-16 h-3 bg-neutral-900 rounded-t-full border-t border-x border-neutral-700 shadow-md -mb-1 z-10 opacity-90" />
            <div
              className={`w-14 h-14 rounded-full border-2 transition-all duration-300 flex items-center justify-center relative overflow-hidden ${
                currentPhase === "YELLOW"
                  ? "bg-amber-400 border-amber-300 shadow-[0_0_28px_rgba(245,158,11,1),0_0_50px_rgba(251,191,36,0.6),inset_0_0_12px_#ffffff]"
                  : "bg-amber-950/30 border-amber-950/60 shadow-inner"
              }`}
            >
              <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 rounded-full blur-[1px] transform -rotate-45 pointer-events-none" />
              <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px] opacity-30" />
              {currentPhase === "YELLOW" && (
                <span className="text-neutral-950 font-mono font-black text-sm drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)] z-10">
                  {secondsRemaining}s
                </span>
              )}
            </div>
          </div>

          {/* 3. 綠燈 */}
          <div className="relative flex flex-col items-center">
            <div className="w-16 h-3 bg-neutral-900 rounded-t-full border-t border-x border-neutral-700 shadow-md -mb-1 z-10 opacity-90" />
            <div
              className={`w-14 h-14 rounded-full border-2 transition-all duration-300 flex items-center justify-center relative overflow-hidden ${
                currentPhase === "GREEN"
                  ? "bg-emerald-500 border-emerald-300 shadow-[0_0_28px_rgba(16,185,129,1),0_0_50px_rgba(52,211,153,0.6),inset_0_0_12px_#ffffff] animate-pulse"
                  : "bg-emerald-950/30 border-emerald-950/60 shadow-inner"
              }`}
            >
              <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 rounded-full blur-[1px] transform -rotate-45 pointer-events-none" />
              <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px] opacity-30" />
              {currentPhase === "GREEN" && (
                <span className="text-white font-mono font-black text-xs drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10">
                  {secondsRemaining > 0 ? `${secondsRemaining}s` : "暢行"}
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      <div className="mt-3 text-center">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-black tracking-wider shadow-md ${
            currentPhase === "GREEN" && secondsRemaining === 0
              ? "bg-emerald-600 text-white shadow-emerald-950/60"
              : currentPhase === "GREEN"
              ? "bg-emerald-500 text-white shadow-emerald-900/50"
              : currentPhase === "YELLOW"
              ? "bg-amber-400 text-neutral-950 shadow-amber-900/50"
              : "bg-rose-600 text-white shadow-rose-900/50"
          }`}
        >
          {secondsRemaining === 0 ? "🟢 全線暢通 (暢行常開)" : currentPhase === "GREEN" ? "綠燈 2s 放行" : currentPhase === "YELLOW" ? "黃燈 清空" : "紅燈 停等"}
        </span>
      </div>
    </div>
  );
}

export default function RampMeterPulseMeter({
  estimatorOutput,
  direction,
}: RampMeterPulseMeterProps) {
  // 確保每次輪詢或資料更新時，使用全新 Object 結構觸發 React 重新渲染
  const [meteringState, setMeteringState] = useState<ComprehensiveMeteringState>(() => {
    const rawRecords = estimatorOutput?.raw_api?.records || [];
    const travelSec = estimatorOutput?.estimated_state?.travelTimeSec || 660;
    return evaluateFreeway5MeteringSystem(rawRecords, [], travelSec);
  });

  useEffect(() => {
    const rawRecords = estimatorOutput?.raw_api?.records || [];
    const travelSec = estimatorOutput?.estimated_state?.travelTimeSec || 660;
    const newState = evaluateFreeway5MeteringSystem(rawRecords, [], travelSec);
    // 以全新的 Object 結構進行 state 更新
    setMeteringState({ ...newState, lastUpdated: new Date().toLocaleTimeString("zh-TW", { hour12: false }) });
  }, [estimatorOutput]);

  const [selectedExchangeName, setSelectedExchangeName] = useState<string>("頭城匝道");
  const [showTheoryModal, setShowTheoryModal] = useState<boolean>(false);

  const mainlineSignal = meteringState?.mainlineSignal;
  const isMainlineSelected = selectedExchangeName === "主線";

  const currentRamp: SignalTimingResult = isMainlineSelected
    ? {
        exchangeName: "頭城 30.5K 主線號誌",
        isMetered: mainlineSignal?.isMainlineMeterActive ?? false,
        cycleSec: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.cycleSec || 35) : 0,
        greenSec: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.greenSec || 2) : 0,
        redSec: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.redSec || 33) : 0,
        vph: 1800,
        queueDelayMinutes: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.mainlineQueueDelayMin || 3) : 0,
        intensity: mainlineSignal?.intensity || "OFF",
        intensityLabel: mainlineSignal?.isMainlineMeterActive ? "🔴 主線儀控管制中" : "🟢 主線開放通行 (未啟動管制)",
        intensityColorClass: mainlineSignal?.isMainlineMeterActive ? "text-amber-400 bg-amber-950/60 border-amber-500/40" : "text-emerald-400 bg-emerald-950/60 border-emerald-500/30",
        pulseIntervalSec: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.cycleSec || 35) : 0,
        description: mainlineSignal?.description || "頭城 30.5K 主線號誌狀態",
        upstreamQueueLengthMeters: mainlineSignal?.isMainlineMeterActive ? Math.round((mainlineSignal?.upstreamQueueLengthKm || 1.5) * 1000) : 0,
        rampOccupancy: mainlineSignal?.kMainOccupancy || 12,
      }
    : (meteringState?.rampSignals?.find((r) => r.exchangeName === selectedExchangeName) ||
        meteringState?.rampSignals?.[0] || {
          exchangeName: "頭城匝道",
          isMetered: true,
          cycleSec: 6,
          greenSec: 2,
          redSec: 4,
          vph: 600,
          queueDelayMinutes: 8,
          intensity: "MODERATE",
          intensityLabel: "常態調控 (黃)",
          intensityColorClass: "text-amber-400 bg-amber-950/60 border-amber-500/40",
          pulseIntervalSec: 6.0,
          description: "放行週期 6秒 (綠燈 2s / 紅燈 4s)",
          upstreamQueueLengthMeters: 450,
          rampOccupancy: 14.5,
        });

  const currentThreeTier: ThreeTierTravelTimeResult = isMainlineSelected
    ? {
        originExchangeName: "頭城 30.5K 主線",
        rampQueueDelayMin: 0,
        mainlineQueueDelayMin: mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.mainlineQueueDelayMin || 3) : 0,
        tunnelTravelTimeMin: meteringState?.tunnelTravelTimeMin || 11,
        totalTravelTimeMin: (mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.mainlineQueueDelayMin || 3) : 0) + (meteringState?.tunnelTravelTimeMin || 11),
        totalTravelTimeFormatted: `${(mainlineSignal?.isMainlineMeterActive ? (mainlineSignal?.mainlineQueueDelayMin || 3) : 0) + (meteringState?.tunnelTravelTimeMin || 11)} 分鐘`,
        detourAdvice: mainlineSignal?.isMainlineMeterActive ? "目前主線實施儀控管制，請配合號誌指示減速慢行。" : "主線車流順暢，未啟動儀控管制，全線開放通行。",
        shouldTakeAlternativeRoute: false,
        suggestedAlternativeRoute: "國道 5 號主線",
      }
    : (meteringState?.threeTierTimes?.[selectedExchangeName] || {
        originExchangeName: selectedExchangeName,
        rampQueueDelayMin: currentRamp?.queueDelayMinutes || 0,
        mainlineQueueDelayMin: meteringState?.mainlineSignal?.mainlineQueueDelayMin || 0,
        tunnelTravelTimeMin: meteringState?.tunnelTravelTimeMin || 11,
        totalTravelTimeMin:
          (currentRamp?.queueDelayMinutes || 0) +
          (meteringState?.mainlineSignal?.mainlineQueueDelayMin || 0) +
          (meteringState?.tunnelTravelTimeMin || 11),
        totalTravelTimeFormatted: `${
          (currentRamp?.queueDelayMinutes || 0) +
          (meteringState?.mainlineSignal?.mainlineQueueDelayMin || 0) +
          (meteringState?.tunnelTravelTimeMin || 11)
        } 分鐘`,
        detourAdvice: "目前排隊時間在合理範圍，建議維持行駛國道 5 號。",
        shouldTakeAlternativeRoute: false,
        suggestedAlternativeRoute: "國道 5 號主線",
      });

  const [timerSec, setTimerSec] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimerSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isMetered = currentRamp.isMetered ?? true;
  const isOff = !isMetered || currentRamp.intensity === "OFF" || currentRamp.cycleSec === 0;

  const cycle = Math.max(3, currentRamp.cycleSec || 6);
  const green = 2; // 固定綠燈 2 秒
  const yellow = 1;
  const red = Math.max(1, cycle - green - yellow);

  const currentSecInCycle = timerSec % cycle;
  let currentPhase: "GREEN" | "YELLOW" | "RED" = "GREEN";
  let remainingSec = 0;

  if (isOff) {
    currentPhase = "GREEN";
    remainingSec = 0;
  } else if (currentSecInCycle < green) {
    currentPhase = "GREEN";
    remainingSec = green - currentSecInCycle;
  } else if (currentSecInCycle < green + yellow) {
    currentPhase = "YELLOW";
    remainingSec = green + yellow - currentSecInCycle;
  } else {
    currentPhase = "RED";
    remainingSec = cycle - currentSecInCycle;
  }

  const getIntensityBadge = (intensity?: string) => {
    switch (intensity) {
      case "STRICT":
        return {
          bg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
          dot: "bg-rose-500 animate-ping",
          colorText: "text-rose-400",
        };
      case "MODERATE":
        return {
          bg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          dot: "bg-amber-500 animate-pulse",
          colorText: "text-amber-400",
        };
      case "SMOOTH":
        return {
          bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          dot: "bg-emerald-500",
          colorText: "text-emerald-400",
        };
      default:
        return {
          bg: "bg-slate-700/40 text-slate-300 border-slate-600/40",
          dot: "bg-slate-500",
          colorText: "text-slate-400",
        };
    }
  };

  const currentBadge = getIntensityBadge(currentRamp?.intensity);
  const mainlineBadge = getIntensityBadge(mainlineSignal?.intensity);

  return (
    <div
      id="ramp-meter-pulse-meter-container"
      className="bg-slate-900/95 backdrop-blur-xl border border-slate-800/90 rounded-3xl p-5 md:p-7 text-slate-100 shadow-2xl relative overflow-hidden transition-all duration-300"
    >
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-72 h-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

      {/* Header 標題區 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-800/80 relative z-10">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-amber-500 flex items-center justify-center shadow-lg shadow-emerald-900/40">
            <Radio className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                國道 5 號北向 雙軌匝道儀控與主線號誌即時監控
              </h2>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                LIVE VD SYNC
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              最新運算時間戳記：<span className="font-mono text-cyan-400 font-bold">{meteringState.lastUpdated}</span> ‧ 實測通過流量 (VPH) 與隊列佔有率雙軌連動
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTheoryModal(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <HelpCircle className="w-4 h-4 text-cyan-400" />
            <span>雙軌演算法解析</span>
          </button>
        </div>
      </div>

      {/* 交流道選擇 TAB */}
      <div className="mt-5 flex flex-wrap items-center gap-2 relative z-10">
        <span className="text-xs text-slate-400 font-semibold flex items-center gap-1 mr-1">
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          選擇匝道/主線：
        </span>
        {meteringState?.rampSignals?.map((ramp) => {
          const isSelected = ramp.exchangeName === selectedExchangeName;
          const badge = getIntensityBadge(ramp.intensity);
          return (
            <button
              key={ramp.exchangeName}
              onClick={() => setSelectedExchangeName(ramp.exchangeName)}
              className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-2 border ${
                isSelected
                  ? "bg-slate-800 text-white border-emerald-500 shadow-md shadow-emerald-950/60"
                  : "bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-slate-200 hover:border-slate-700"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
              <span>{ramp.exchangeName}</span>

            </button>
          );
        })}

        <button
          onClick={() => setSelectedExchangeName("主線")}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-2 border ${
            isMainlineSelected
              ? "bg-slate-800 text-white border-amber-500 shadow-md shadow-amber-950/60"
              : "bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-slate-200 hover:border-slate-700"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${mainlineBadge.dot}`} />
          <span>頭城 30.5K 主線號誌</span>
          <span className="text-[10px] opacity-90 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
            {mainlineSignal?.isMainlineMeterActive ? "管制中" : "常態暢行"}
          </span>
        </button>
      </div>

      {/* 核心顯示區：擬真燈箱 + 雙軌 VD 數據面板 */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center relative z-10">
        
        {/* 左側：擬真實體紅綠燈燈箱 */}
        <div className="lg:col-span-4 flex justify-center">
          <RealisticTrafficLight
            currentPhase={currentPhase}
            secondsRemaining={remainingSec}
            title={currentRamp.exchangeName}
            subtitle={currentRamp.intensityLabel}
          />
        </div>

        {/* 右側：雙軌感測器數值與排隊時間面板 */}
        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* 1. 放行節奏與週期 */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-slate-800/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-semibold">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  即時放行節奏 (Release Rhythm)
                </span>
                <span className="font-mono text-emerald-400 font-bold">固定綠燈 2s</span>
              </div>
              <div className="text-2xl font-black text-white mt-1 font-mono">
                {currentRamp.greenSec}秒綠 / {currentRamp.redSec}秒紅
              </div>
              <div className="text-xs text-slate-300 mt-1">
                總週期：<span className="font-mono font-bold text-amber-400">{currentRamp.cycleSec} 秒 / 輛</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-slate-400">放行容量率 (VPH):</span>
              <span className="font-mono font-bold text-cyan-300">{Math.round(currentRamp.vph)} 輛/小時</span>
            </div>
          </div>

          {/* 2. 排隊等候時間 */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-slate-800/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-semibold">
                  <Gauge className="w-3.5 h-3.5 text-amber-400" />
                  排隊停等時間 (Queue Delay)
                </span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded ${currentBadge.bg}`}>
                  {currentRamp.intensityLabel}
                </span>
              </div>
              <div className="text-2xl font-black text-amber-300 mt-1 font-mono">
                ~ {currentRamp.queueDelayMinutes} 分鐘
              </div>
              <div className="text-xs text-slate-300 mt-1">
                估算排隊長度：<span className="font-mono font-bold text-white">{currentRamp.upstreamQueueLengthMeters} 公尺</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-slate-400">匝道佔有率 (Occ):</span>
              <span className="font-mono font-bold text-amber-400">{currentRamp.rampOccupancy ?? 12.5}%</span>
            </div>
          </div>

          {/* 3. 三重旅行時間結構拆解 */}
          <div className="sm:col-span-2 bg-slate-950/70 rounded-2xl p-4 border border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">北向三重旅行時間模型 (Three-Tier Corridor Breakdown)</span>
              </div>
              <span className="text-xs font-mono font-extrabold text-cyan-400 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-500/40">
                總預估：{currentThreeTier.totalTravelTimeFormatted}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                <div className="text-[10px] text-slate-400">1. 入口匝道排隊</div>
                <div className="text-sm font-black font-mono text-amber-400 mt-0.5">+{currentThreeTier.rampQueueDelayMin} 分</div>
              </div>
              <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                <div className="text-[10px] text-slate-400">2. 頭城 30.5K 主線號誌</div>
                <div className="text-sm font-black font-mono text-amber-400 mt-0.5">+{currentThreeTier.mainlineQueueDelayMin} 分</div>
              </div>
              <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-800">
                <div className="text-[10px] text-slate-400">3. 雪隧內部動態通行</div>
                <div className="text-sm font-black font-mono text-emerald-400 mt-0.5">+{currentThreeTier.tunnelTravelTimeMin} 分</div>
              </div>
            </div>

            {currentThreeTier.shouldTakeAlternativeRoute && (
              <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-bounce" />
                <div>
                  <span className="font-bold">替代道路建議：</span> {currentThreeTier.detourAdvice}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 演算法原理彈窗 */}
      {showTheoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 text-slate-100 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Zap className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-white">雙軌感測器與匝道儀控時制演算法</h3>
              </div>
              <button
                onClick={() => setShowTheoryModal(false)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 font-bold transition"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-2">
              <p>
                本系統完全依據高公局交控架構（ATMS），透過雙軌感測器聯立即時計算：
              </p>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-emerald-400">1. 主線狀態判定基準：</div>
                <p className="text-slate-400">
                  即時讀取雪山隧道南口與內部容量判定 VD。若平均流速 V_main &lt; 45 km/h 或佔有率 &gt; 25%，即自動切換至高強度儀控模式 (STRICT)；若 V_main &gt;= 60 km/h 則維持順暢放行。
                </p>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-cyan-400">2. 匝道實測 VD 動態時制：</div>
                <p className="text-slate-400">
                  讀取各交流道通過流量 q_ramp 與隊列佔有率 Occ_ramp。週期計算公式為 <code className="text-cyan-300 font-mono">T_cycle = 3600 / max(q_ramp, 100)</code>，其中綠燈時間固定為 2 秒，紅燈時間隨流量與主線雍塞程度動態調整。
                </p>
              </div>
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="font-bold text-amber-400">3. 排隊延遲與脈衝渲染：</div>
                <p className="text-slate-400">
                  停等時間基於排隊車輛與週期換算，每次 90 秒輪詢獲得最新 VD 時強制更新物件參考，確保 React 燈箱與倒數計時器零延遲同步。
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowTheoryModal(false)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/60 transition"
              >
                了解並關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
