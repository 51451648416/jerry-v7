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
  isMainline = false,
}: {
  currentPhase: "GREEN" | "YELLOW" | "RED";
  secondsRemaining: number;
  title: string;
  subtitle: string;
  isMainline?: boolean;
}) {
  return (
    <div className="flex flex-col items-center bg-slate-950/90 rounded-2xl p-4 border border-slate-800/90 shadow-2xl relative">
      {/* 燈箱頂部標籤 */}
      <div className="text-center mb-3">
        <div className="text-xs font-bold text-slate-200 tracking-wide">{title}</div>
        <div className="text-[10px] text-slate-400 font-mono">{subtitle}</div>
      </div>

      {/* 擬真實體號誌燈外框 (黑金屬外殼 + 高公局公路黃色邊框) */}
      <div className="relative p-2.5 bg-gradient-to-b from-yellow-400 via-amber-400 to-yellow-500 rounded-2xl shadow-[0_10px_25px_rgba(0,0,0,0.8),inset_0_2px_4px_rgba(255,255,255,0.4)] border-2 border-yellow-500">
        {/* 黑色遮光內膽板 */}
        <div className="bg-gradient-to-b from-neutral-900 via-zinc-950 to-neutral-900 rounded-xl p-3 shadow-inner border border-neutral-800 flex flex-col items-center gap-3 w-24">
          
          {/* 1. 紅燈 (Red Lamp with Hood/Visor) */}
          <div className="relative flex flex-col items-center">
            {/* 遮光罩 (Visor) */}
            <div className="w-16 h-3 bg-neutral-900 rounded-t-full border-t border-x border-neutral-700 shadow-md -mb-1 z-10 opacity-90" />
            {/* 圓形燈芯 */}
            <div
              className={`w-14 h-14 rounded-full border-2 transition-all duration-300 flex items-center justify-center relative overflow-hidden ${
                currentPhase === "RED"
                  ? "bg-rose-600 border-rose-400 shadow-[0_0_28px_rgba(239,68,68,1),0_0_50px_rgba(244,63,94,0.6),inset_0_0_12px_#ffffff]"
                  : "bg-rose-950/30 border-rose-950/60 shadow-inner"
              }`}
            >
              {/* 燈面高光反射弧紋 */}
              <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 rounded-full blur-[1px] transform -rotate-45 pointer-events-none" />
              {/* LED 蜂巢紋路質地 */}
              <div className="absolute inset-0 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:4px_4px] opacity-30" />
              {currentPhase === "RED" && (
                <span className="text-white font-mono font-black text-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10">
                  {secondsRemaining}s
                </span>
              )}
            </div>
          </div>

          {/* 2. 黃燈 (Yellow/Amber Lamp with Hood/Visor) */}
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

          {/* 3. 綠燈 (Green Lamp with Hood/Visor) */}
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
                <span className="text-white font-mono font-black text-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] z-10">
                  {secondsRemaining}s
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 當前放行指示銘牌 */}
      <div className="mt-3 text-center">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-black tracking-wider shadow-md ${
            currentPhase === "GREEN"
              ? "bg-emerald-500 text-white shadow-emerald-900/50"
              : currentPhase === "YELLOW"
              ? "bg-amber-400 text-neutral-950 shadow-amber-900/50"
              : "bg-rose-600 text-white shadow-rose-900/50"
          }`}
        >
          {currentPhase === "GREEN" ? "綠燈 放行" : currentPhase === "YELLOW" ? "黃燈 清空" : "紅燈 停等"}
        </span>
      </div>
    </div>
  );
}

export default function RampMeterPulseMeter({
  estimatorOutput,
  direction,
}: RampMeterPulseMeterProps) {
  // 從 estimatorOutput 取得或即時推算綜合儀控狀態 (具有強健安全預設值)
  const meteringState: ComprehensiveMeteringState =
    estimatorOutput?.estimated_state?.comprehensiveMeteringState ||
    evaluateFreeway5MeteringSystem(
      estimatorOutput?.raw_api?.records || [],
      [],
      estimatorOutput?.estimated_state?.travelTimeSec || 660
    );

  const [selectedExchangeName, setSelectedExchangeName] = useState<string>("頭城匝道");
  const [showTheoryModal, setShowTheoryModal] = useState<boolean>(false);

  const mainlineSignal = meteringState?.mainlineSignal;
  const isMainlineSelected = selectedExchangeName === "主線";

  // 當前選取的交流道或主線儀控時相資料
  const currentRamp: SignalTimingResult = isMainlineSelected
    ? {
        exchangeName: "頭城 30.5K 主線號誌",
        isMetered: mainlineSignal?.isMainlineMeterActive ?? true,
        cycleSec: mainlineSignal?.cycleSec || 35,
        greenSec: mainlineSignal?.greenSec || 15,
        redSec: (mainlineSignal?.cycleSec || 35) - (mainlineSignal?.greenSec || 15) - 2,
        vph: 1800,
        queueDelayMinutes: mainlineSignal?.mainlineQueueDelayMin || 3,
        intensity: mainlineSignal?.intensity || "MODERATE",
        intensityLabel: mainlineSignal?.intensityLabel || "主線儀控中 (黃)",
        intensityColorClass: "text-amber-400 bg-amber-950/60 border-amber-500/40",
        pulseIntervalSec: mainlineSignal?.cycleSec || 35,
        description: "主線紅綠燈管制 (頭城 30.5K)",
        upstreamQueueLengthMeters: 350,
      }
    : (meteringState?.rampSignals?.find((r) => r.exchangeName === selectedExchangeName) ||
        meteringState?.rampSignals?.[0] || {
          exchangeName: "頭城匝道",
          isMetered: true,
          cycleSec: 6,
          greenSec: 2,
          redSec: 3,
          vph: 600,
          queueDelayMinutes: 8,
          intensity: "MODERATE",
          intensityLabel: "常態調控 (黃)",
          intensityColorClass: "text-amber-400 bg-amber-950/60 border-amber-500/40",
          pulseIntervalSec: 6.0,
          description: "放行間隔 6秒 (紅燈 3s / 綠燈 2s)",
          upstreamQueueLengthMeters: 520,
        });

  // 當前選取交流道或主線的三重耗時結構
  const currentThreeTier: ThreeTierTravelTimeResult = isMainlineSelected
    ? {
        originExchangeName: "頭城 30.5K 主線",
        rampQueueDelayMin: 0,
        mainlineQueueDelayMin: mainlineSignal?.mainlineQueueDelayMin || 3,
        tunnelTravelTimeMin: meteringState?.tunnelTravelTimeMin || 11,
        totalTravelTimeMin: (mainlineSignal?.mainlineQueueDelayMin || 3) + (meteringState?.tunnelTravelTimeMin || 11),
        totalTravelTimeFormatted: `${(mainlineSignal?.mainlineQueueDelayMin || 3) + (meteringState?.tunnelTravelTimeMin || 11)} 分鐘`,
        detourAdvice: "目前行駛主線 30.5K 號誌管制點，建議配合號誌燈號循序通過。",
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

  // 擬真即時紅綠燈秒數計時器 (秒級即時倒數切換)
  const [rampTimerSec, setRampTimerSec] = useState<number>(0);
  const [mainlineTimerSec, setMainlineTimerSec] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setRampTimerSec((prev) => prev + 1);
      setMainlineTimerSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 計算當前匝道紅綠燈狀態
  const rampCycle = Math.max(3, currentRamp.cycleSec || 6);
  const rampGreen = Math.max(1, currentRamp.greenSec || 2);
  const rampYellow = 1;
  const rampRed = Math.max(1, rampCycle - rampGreen - rampYellow);

  const rampCurrentSecInCycle = rampTimerSec % rampCycle;
  let rampPhase: "GREEN" | "YELLOW" | "RED" = "GREEN";
  let rampRemainingSec = 0;

  if (rampCurrentSecInCycle < rampGreen) {
    rampPhase = "GREEN";
    rampRemainingSec = rampGreen - rampCurrentSecInCycle;
  } else if (rampCurrentSecInCycle < rampGreen + rampYellow) {
    rampPhase = "YELLOW";
    rampRemainingSec = rampGreen + rampYellow - rampCurrentSecInCycle;
  } else {
    rampPhase = "RED";
    rampRemainingSec = rampCycle - rampCurrentSecInCycle;
  }

  // 計算主線 30.5K 號誌燈狀態
  const mainCycle = mainlineSignal?.cycleSec || 35;
  const mainGreen = mainlineSignal?.greenSec || 15;
  const mainYellow = 2;
  const mainRed = Math.max(1, mainCycle - mainGreen - mainYellow);

  const mainCurrentSecInCycle = mainlineTimerSec % mainCycle;
  let mainlinePhase: "GREEN" | "YELLOW" | "RED" = "GREEN";
  let mainlineRemainingSec = 0;

  if (!mainlineSignal?.isMainlineMeterActive) {
    mainlinePhase = "GREEN";
    mainlineRemainingSec = 99;
  } else if (mainCurrentSecInCycle < mainGreen) {
    mainlinePhase = "GREEN";
    mainlineRemainingSec = mainGreen - mainCurrentSecInCycle;
  } else if (mainCurrentSecInCycle < mainGreen + mainYellow) {
    mainlinePhase = "YELLOW";
    mainlineRemainingSec = mainGreen + mainYellow - mainCurrentSecInCycle;
  } else {
    mainlinePhase = "RED";
    mainlineRemainingSec = mainCycle - mainCurrentSecInCycle;
  }

  // 動態號誌顏色樣式計算
  const getIntensityBadge = (intensity?: string) => {
    switch (intensity) {
      case "STRICT":
        return {
          bg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
          glow: "shadow-[0_0_15px_rgba(244,63,94,0.4)]",
          dot: "bg-rose-500 animate-ping",
          colorText: "text-rose-400",
          lightBorder: "border-rose-500",
        };
      case "MODERATE":
        return {
          bg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          glow: "shadow-[0_0_15px_rgba(245,158,11,0.4)]",
          dot: "bg-amber-500 animate-pulse",
          colorText: "text-amber-400",
          lightBorder: "border-amber-500",
        };
      case "SMOOTH":
        return {
          bg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          glow: "shadow-[0_0_15px_rgba(16,185,129,0.4)]",
          dot: "bg-emerald-500",
          colorText: "text-emerald-400",
          lightBorder: "border-emerald-500",
        };
      default:
        return {
          bg: "bg-slate-700/40 text-slate-300 border-slate-600/40",
          glow: "",
          dot: "bg-slate-500",
          colorText: "text-slate-400",
          lightBorder: "border-slate-600",
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
      {/* 頂部光暈背景裝飾 */}
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
                國道 5 號北向 匝道儀控放行節奏與主線號誌監控
              </h2>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                LIVE METERS
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              擬真實體紅綠燈時制 ‧ 高公局即時放行容量率 (VPH) ‧ 三重旅行時間結構拆解
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTheoryModal(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <HelpCircle className="w-4 h-4 text-cyan-400" />
            <span>時制演算法解析</span>
          </button>
        </div>
      </div>

      {/* 交流道切換 TAB 選擇器 */}
      <div className="mt-5 flex flex-wrap items-center gap-2 relative z-10">
        <span className="text-xs text-slate-400 font-semibold flex items-center gap-1 mr-1">
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          選擇入口匝道：
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
              {ramp.isMetered && (
                <span className="text-[10px] opacity-80 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
                  {ramp.pulseIntervalSec}s
                </span>
              )}
            </button>
          );
        })}

        {/* 新增「主線」選項按鈕 */}
        <button
          onClick={() => setSelectedExchangeName("主線")}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer flex items-center gap-2 border ${
            selectedExchangeName === "主線"
              ? "bg-slate-800 text-white border-cyan-500 shadow-md shadow-cyan-950/60"
              : "bg-slate-950/60 text-slate-400 border-slate-800/80 hover:text-slate-200 hover:border-slate-700"
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${mainlineBadge.dot}`} />
          <span>主線 (30.5K)</span>
          <span className="text-[10px] opacity-80 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
            {mainlineSignal?.cycleSec || 35}s
          </span>
        </button>
      </div>

      {/* 主體區塊：依據選擇顯示「單獨主線號誌」或「匝道與三重旅行時間模型」 */}
      {isMainlineSelected ? (
        <div className="mt-6 max-w-3xl mx-auto bg-slate-950/90 border border-cyan-500/40 rounded-3xl p-6 space-y-5 shadow-2xl relative z-10">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold font-mono">
                30.5K
              </div>
              <div>
                <h3 className="text-base font-bold text-white">頭城 30.5K 主線實體號誌管制 (雪隧南口前)</h3>
                <p className="text-xs text-slate-400">當雪隧內流量逼近飽和時啟動主線紅綠燈攔截蓄壓</p>
              </div>
            </div>
            <div className={`px-3.5 py-1.5 rounded-full text-xs font-bold border flex items-center gap-2 ${mainlineBadge.bg}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${mainlineBadge.dot}`} />
              <span>{mainlineSignal?.isMainlineMeterActive ? `主線管制中 (${mainlineSignal.intensityLabel})` : "全綠燈放行 (未啟動)"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center py-2">
            <div className="sm:col-span-5 flex justify-center">
              <RealisticTrafficLight
                currentPhase={mainlinePhase}
                secondsRemaining={mainlineRemainingSec}
                title="主線 30.5K 號誌"
                subtitle={mainlineSignal?.isMainlineMeterActive ? `週期 ${mainlineSignal.cycleSec}s` : "全綠燈直通"}
                isMainline={true}
              />
            </div>

            <div className="sm:col-span-7 space-y-3.5">
              {mainlineSignal?.isMainlineMeterActive ? (
                <div className="bg-rose-950/40 border border-rose-500/30 rounded-2xl p-4 space-y-2.5 text-xs">
                  <div className="text-rose-200 font-bold flex items-center gap-1.5 text-sm">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    主線紅綠燈管制啟動中
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800">
                      <div className="text-[11px] text-slate-400">主線停等延遲</div>
                      <div className="text-base font-mono font-bold text-rose-300">
                        +{mainlineSignal.mainlineQueueDelayMin} 分鐘
                      </div>
                    </div>
                    <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800">
                      <div className="text-[11px] text-slate-400">回堵尾端里程</div>
                      <div className="text-base font-mono font-bold text-amber-300">
                        {mainlineSignal.queueTailKm}K
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-5 text-center space-y-1.5">
                  <div className="text-emerald-400 font-bold text-sm">
                    ✓ 主線號誌維持全綠燈放行
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                    目前雪山隧道南口車流順暢，無額外主線蓄壓回堵，車輛可直接駛入隧道。
                  </div>
                </div>
              )}

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <span className="text-slate-400">主線通行時間預估</span>
                <span className="text-cyan-300 font-mono font-bold text-sm">
                  約 {(mainlineSignal?.mainlineQueueDelayMin || 3) + (meteringState?.tunnelTravelTimeMin || 11)} 分鐘 (含雪隧11分)
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 leading-relaxed">
            🛡️ <span className="text-slate-200 font-medium">主線控管原則：</span>
            當雪山隧道內部偵測到降速或車頭時距過小，30.5K 主線號誌燈將進行紅燈循環攔截，確保隧道內維持安全容量，避免嚴重回堵。
          </div>
        </div>
      ) : (
        <>
          {/* 匝道實體紅綠燈卡 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-6 relative z-10">
            <div className="lg:col-span-12 bg-slate-950/80 border border-slate-800/90 rounded-2xl p-5 space-y-4 flex flex-col justify-between shadow-lg">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">
                      【{currentRamp.exchangeName}】實體匝道號誌放行
                    </span>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${currentBadge.bg}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${currentBadge.dot}`} />
                    <span>{currentRamp.intensityLabel}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-3">
                  <div className="sm:col-span-5 flex justify-center">
                    <RealisticTrafficLight
                      currentPhase={rampPhase}
                      secondsRemaining={rampRemainingSec}
                      title="入口匝道號誌"
                      subtitle={`放行週期 ${currentRamp.cycleSec}s`}
                    />
                  </div>

                  <div className="sm:col-span-7 space-y-2.5">
                    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2">
                      <div className="text-[11px] text-slate-400 flex items-center justify-between">
                        <span>高公局儀控放行速率</span>
                        <span className="font-mono font-bold text-cyan-300 text-xs">
                          {currentRamp.vph} vph
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-950 rounded-lg p-2 border border-slate-800 text-center">
                          <div className="text-[10px] text-slate-400">綠燈 (一綠一車)</div>
                          <div className="text-sm font-mono font-bold text-emerald-400">
                            {currentRamp.greenSec} 秒
                          </div>
                        </div>
                        <div className="bg-slate-950 rounded-lg p-2 border border-slate-800 text-center">
                          <div className="text-[10px] text-slate-400">紅燈 (阻斷等待)</div>
                          <div className="text-sm font-mono font-bold text-rose-400">
                            {currentRamp.redSec} 秒
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-400" />
                        <span className="text-xs text-slate-300 font-medium">
                          平面排隊停等時間
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-base font-mono font-bold text-amber-300">
                          約 {currentRamp.queueDelayMinutes} 分鐘
                        </span>
                        {currentRamp.upstreamQueueLengthMeters ? (
                          <div className="text-[10px] text-slate-400">
                            車隊約 {currentRamp.upstreamQueueLengthMeters} 公尺
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                💡 <span className="text-slate-300 font-medium">時制說明：</span>
                依據高公局一綠一車管制準則，每 {currentRamp.pulseIntervalSec} 秒釋出一輛車匯入國5主線。
              </div>
            </div>
          </div>

          {/* 下方卡片：三重旅行時間模型 (Three-Tier Corridor Delay Breakdown) */}
          <div className="mt-6 bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800/90 rounded-2xl p-5 space-y-4 relative z-10 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  【{selectedExchangeName} 出發】北上三重旅行時間精確拆解
                </h3>
              </div>
              <div className="text-xs text-slate-400">
                精準計入各瓶頸延遲，避免因「雪隧內部順暢」而誤判整體行程時間
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5 relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200">階段 1：平面匝道排隊</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    Ramp Queue
                  </span>
                </div>
                <div className="text-2xl font-black font-mono text-amber-300">
                  {currentThreeTier.rampQueueDelayMin} <span className="text-xs font-normal text-slate-400">分鐘</span>
                </div>
                <p className="text-xs text-slate-400 leading-tight">
                  {currentRamp.exchangeName} 入口儀控停等
                </p>
              </div>

              <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5 relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200">階段 2：30.5K 主線號誌</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    Mainline 30.5K
                  </span>
                </div>
                <div className="text-2xl font-black font-mono text-rose-300">
                  {currentThreeTier.mainlineQueueDelayMin} <span className="text-xs font-normal text-slate-400">分鐘</span>
                </div>
                <p className="text-xs text-slate-400 leading-tight">
                  雪隧南口主線蓄壓回堵停等
                </p>
              </div>

              <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-4 space-y-1.5 relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-bold text-slate-200">階段 3：雪隧內部通行</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    Tunnel Cruise
                  </span>
                </div>
                <div className="text-2xl font-black font-mono text-emerald-300">
                  {currentThreeTier.tunnelTravelTimeMin} <span className="text-xs font-normal text-slate-400">分鐘</span>
                </div>
                <p className="text-xs text-slate-400 leading-tight">
                  28K～15K 20微元積分實測通行
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <CornerDownRight className="w-5 h-5 text-emerald-400 shrink-0" />
                <span className="text-xs sm:text-sm text-slate-300 font-medium">
                  從【{selectedExchangeName}】至雪隧北口 (坪林) 預估實質總耗時：
                </span>
                <span className="text-xl font-black font-mono text-emerald-400 bg-emerald-950/80 px-3.5 py-1 rounded-xl border border-emerald-500/40 shadow-inner">
                  {currentThreeTier.totalTravelTimeFormatted}
                </span>
              </div>

              {currentThreeTier.shouldTakeAlternativeRoute && (
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs font-semibold animate-pulse shadow-md">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{currentThreeTier.detourAdvice}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 演算法數學解析彈窗 (Theory Modal) */}
      {showTheoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 text-slate-100 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  匝道儀控與主線號誌數學逆推模型規範
                </h3>
              </div>
              <button
                onClick={() => setShowTheoryModal(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed max-h-[70vh] overflow-y-auto pr-1">
              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800/80 space-y-1.5">
                <span className="font-bold text-emerald-300">
                  1. 匝道儀控放行週期與時相逆推 (Ramp Metering Cycle)
                </span>
                <p>
                  高公局匝道儀控採用一綠一車（Green = 2s）標準計畫。系統依據 TDX 儀控放行率 VPH 計算週期：
                  <code className="block my-1 text-cyan-300 font-mono">
                    T_cycle = (3600 / VPH) × N_lanes, T_red = T_cycle - T_green - 1s
                  </code>
                  放行間隔在 3 秒至 12 秒間動態呈現擬真紅綠燈秒數。
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800/80 space-y-1.5">
                <span className="font-bold text-cyan-300">
                  2. 頭城 30.5K 主線號誌管制 (Mainline Metering 30.5K)
                </span>
                <p>
                  當雪隧內部流量逼近容量上限（流量 q ≥ 2400 veh/h）或車速降載時，於 30.5K
                  啟動主線紅綠燈進行「主線蓄壓」，以確保隧道內部不發生水力激波（Shockwave）或容量崩潰。
                </p>
              </div>

              <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800/80 space-y-1.5">
                <span className="font-bold text-amber-300">
                  3. 三重旅行時間模型 (Three-Tier Corridor Delay)
                </span>
                <p>
                  駕駛人實質感受到的旅行時間為三層串聯相加：
                  <code className="block my-1 text-emerald-300 font-mono">
                    總耗時 = 匝道等候排隊(Tier 1) + 主線號誌等候(Tier 2) + 雪隧微元通行(Tier 3)
                  </code>
                  避免因隧道內車速正常而忽略入口長達 20 分鐘之排隊時間。
                </p>
              </div>
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setShowTheoryModal(false)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition shadow-md shadow-emerald-900/30"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

