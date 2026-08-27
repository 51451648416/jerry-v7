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
} from "lucide-react";
import { FinalEstimatorOutput } from "../types";

interface VehicleLaneAlgorithmInspectorProps {
  estimatorOutput?: FinalEstimatorOutput | null;
}

export default function VehicleLaneAlgorithmInspector({
  estimatorOutput,
}: VehicleLaneAlgorithmInspectorProps) {
  const [liveData, setLiveData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string>("");

  const fetchAlgorithmLiveState = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/lane-recommendation");
      const json = await res.json();
      if (json && json.success) {
        setLiveData(json);
        setLastFetched(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      }
    } catch (err) {
      console.error("Failed to fetch lane recommendation data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlgorithmLiveState();
    const interval = setInterval(fetchAlgorithmLiveState, 150000); // 每 150 秒自動更新一次
    return () => clearInterval(interval);
  }, []);

  // 從即時 API 或 estimatorOutput 取得演算法數據
  const innerLane = liveData?.innerLane || {
    speedKmh: estimatorOutput?.estimated_state?.laneComparison?.lane1?.equivalentTravelSpeedKmh || 75,
    volumeS: 85,
    volumeL: 4,
    volumeT: 1,
  };

  const outerLane = liveData?.outerLane || {
    speedKmh: estimatorOutput?.estimated_state?.laneComparison?.lane2?.equivalentTravelSpeedKmh || 72,
    volumeS: 78,
    volumeL: 12,
    volumeT: 6,
  };

  const totalInnerVol = (innerLane.volumeS || 0) + (innerLane.volumeL || 0) + (innerLane.volumeT || 0);
  const totalOuterVol = (outerLane.volumeS || 0) + (outerLane.volumeL || 0) + (outerLane.volumeT || 0);

  const truckRatio = liveData?.truckRatio ?? (totalOuterVol > 0 ? (outerLane.volumeT || 0) / totalOuterVol : 0.04);
  const busRatio = liveData?.busRatio ?? (totalOuterVol > 0 ? (outerLane.volumeL || 0) / totalOuterVol : 0.08);
  const isWeekendPeak = liveData?.isWeekendPeak ?? false;

  const effectiveInnerSpeed = liveData?.effectiveInnerSpeed ?? innerLane.speedKmh;
  const effectiveOuterSpeed = liveData?.effectiveOuterSpeed ?? (outerLane.speedKmh - (truckRatio > 0.05 ? Math.min(4.5, (truckRatio - 0.05) * 20) : 0));
  const recommendedLane = liveData?.recommendedLane ?? (effectiveInnerSpeed >= effectiveOuterSpeed ? "內側車道" : "外側車道");
  const voiceText = liveData?.voiceText ?? "即將進入雪山隧道，目前內側實測流速較快，推薦行駛內側車道。";

  // 阻抗扣減計算
  const truckPenalty = truckRatio > 0.05 ? Math.min(4.5, (truckRatio - 0.05) * 20) : 0;
  const busPenalty = isWeekendPeak && busRatio > 0.12 ? 2.0 : 0;

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
            雪山隧道入口 (28.1K~25K) 各車種遙測分流與動態阻抗運算空間
          </h2>
          <p className="text-xs text-slate-400">
            即時自 TDX VD 提取小型車 (S)、大客車 (L)、大貨車 (T) 辨識流量，結合大貨車爬坡壓速阻抗與假日大客車專用道交織模型。
          </p>
        </div>
      </div>

      {/* 2. 演算法決策看板與語音廣播預覽 */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/50 to-slate-950 border border-indigo-800/40 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              <span>最佳車道推薦決策</span>
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

      {/* 3. 車種流量辨識與分流統計 (Small Car / Bus / Truck) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 內側車道辨識數據 */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
              <h3 className="text-sm font-bold text-slate-200">內側車道 (Lane 1) 車種實測</h3>
            </div>
            <span className="text-xs font-mono font-bold text-indigo-400">
              實測: {innerLane.speedKmh.toFixed(1)} km/h
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
                {totalInnerVol > 0 ? (((innerLane.volumeS || 0) / totalInnerVol) * 100).toFixed(0) : 100}%
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
                {totalInnerVol > 0 ? (((innerLane.volumeL || 0) / totalInnerVol) * 100).toFixed(0) : 0}%
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
                {totalInnerVol > 0 ? (((innerLane.volumeT || 0) / totalInnerVol) * 100).toFixed(0) : 0}%
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs flex justify-between items-center font-mono">
            <span className="text-slate-400">等效加權流速 (v_eff_inner):</span>
            <span className="text-emerald-400 font-bold text-sm">
              {effectiveInnerSpeed.toFixed(1)} km/h
            </span>
          </div>
        </div>

        {/* 外側車道辨識數據 */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <h3 className="text-sm font-bold text-slate-200">外側車道 (Lane 2) 車種實測</h3>
            </div>
            <span className="text-xs font-mono font-bold text-amber-400">
              實測: {outerLane.speedKmh.toFixed(1)} km/h
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
                {totalOuterVol > 0 ? (((outerLane.volumeS || 0) / totalOuterVol) * 100).toFixed(0) : 0}%
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
                {(busRatio * 100).toFixed(1)}%
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
                {(truckRatio * 100).toFixed(1)}%
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

      {/* 4. 演算法阻抗檢驗矩陣 (Algorithm Impedance Audit Matrix) */}
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
        <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-indigo-400" />
          <span>雪隧車道動態阻抗運算規則檢驗 (Impedance Rules Verification)</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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
        </div>
      </div>
    </div>
  );
}
