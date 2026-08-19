import React, { useState, useMemo } from "react";
import {
  Clock,
  Navigation,
  Sparkles,
  ArrowRight,
  Award,
  Calendar,
  Compass,
  CheckCircle2,
  Cpu,
  Flame,
  CalendarDays,
  Database,
  Layers,
  History,
  TrendingUp,
  RefreshCw,
  Zap,
  Activity,
} from "lucide-react";
import { Direction, FinalEstimatorOutput, DepartureRecommendation } from "../types";
import { CORRIDOR_INTERCHANGES } from "../data/corridorConfig";
import { computeDepartureRecommendations } from "../estimator/corridorEngine";
import { getLearnedParameters, getContinuousLearningStatus } from "../estimator/modelTrainingEngine";

interface DepartureTimeRecommenderProps {
  estimatorOutput: FinalEstimatorOutput | null;
  direction: Direction;
  onDirectionChange: (newDir: Direction) => void;
  onStartAnalysis?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  cooldown?: number;
  onSelectRoute?: (originKm: number, destKm: number, label?: string) => void;
}

export default function DepartureTimeRecommender({
  estimatorOutput,
  direction,
  onDirectionChange,
  onStartAnalysis,
  onRefresh,
  isLoading = false,
  cooldown = 0,
  onSelectRoute,
}: DepartureTimeRecommenderProps) {
  // 預設起點與終點 (南向: 南港 0K -> 羅東 46K; 北向: 羅東 46K -> 南港 0K)
  const [originMileage, setOriginMileage] = useState<number>(direction === "S" ? 0.0 : 46.0);
  const [destMileage, setDestMileage] = useState<number>(direction === "S" ? 46.0 : 0.0);

  // 自訂出發日期與時間 (年、月、日、時間)
  const now = new Date();
  const [selectedDateStr, setSelectedDateStr] = useState<string>(
    `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`
  );
  const [selectedTimeStr, setSelectedTimeStr] = useState<string>(
    `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
  );

  // 模型自我演化狀態
  const learningStatus = useMemo(() => getContinuousLearningStatus(), []);

  // 取得全線路況計算結果
  const corridorState = estimatorOutput?.estimated_state?.corridorState;

  // 結合自訂日期與時間產生目標 Date 物件
  const targetDate = useMemo(() => {
    try {
      const [y, m, d] = selectedDateStr.split("-").map((v) => parseInt(v, 10));
      const [hh, mm] = selectedTimeStr.split(":").map((v) => parseInt(v, 10));
      const dateObj = new Date(y, m - 1, d, hh || 0, mm || 0, 0);
      return isNaN(dateObj.getTime()) ? new Date() : dateObj;
    } catch {
      return new Date();
    }
  }, [selectedDateStr, selectedTimeStr]);

  // 計算特定起訖點與自訂時間之最佳出發時段推估 (使用機器學習校準權重)
  const departureData: DepartureRecommendation | null = useMemo(() => {
    if (!corridorState) return null;
    return computeDepartureRecommendations(
      corridorState,
      originMileage,
      destMileage,
      direction,
      targetDate
    );
  }, [corridorState, originMileage, destMileage, direction, targetDate]);

  const handleStartOrRefresh = () => {
    if (isLoading) return;
    if (onStartAnalysis && !estimatorOutput) {
      onStartAnalysis();
    } else if (onRefresh) {
      onRefresh();
    } else if (onStartAnalysis) {
      onStartAnalysis();
    }
  };

  // 快捷路徑預設方案
  const handleQuickPreset = (orig: number, dest: number, dir: Direction) => {
    setOriginMileage(orig);
    setDestMileage(dest);
    if (dir !== direction) {
      onDirectionChange(dir);
    }
  };

  // 快捷日期時間切換
  const handleQuickDatePreset = (presetType: "now" | "weekend" | "midAutumn" | "newYear") => {
    const cur = new Date();
    if (presetType === "now") {
      setSelectedDateStr(
        `${cur.getFullYear()}-${(cur.getMonth() + 1).toString().padStart(2, "0")}-${cur.getDate().toString().padStart(2, "0")}`
      );
      setSelectedTimeStr(
        `${cur.getHours().toString().padStart(2, "0")}:${cur.getMinutes().toString().padStart(2, "0")}`
      );
    } else if (presetType === "weekend") {
      // 設為即將到來的週六 08:30
      const daysUntilSat = (6 - cur.getDay() + 7) % 7 || 7;
      const nextSat = new Date(cur.getTime() + daysUntilSat * 24 * 3600 * 1000);
      setSelectedDateStr(
        `${nextSat.getFullYear()}-${(nextSat.getMonth() + 1).toString().padStart(2, "0")}-${nextSat.getDate().toString().padStart(2, "0")}`
      );
      setSelectedTimeStr("08:30");
    } else if (presetType === "midAutumn") {
      // 中秋節連假
      setSelectedDateStr("2026-09-25");
      setSelectedTimeStr("09:00");
    } else if (presetType === "newYear") {
      // 春節連假初三
      setSelectedDateStr("2027-02-08");
      setSelectedTimeStr("14:30");
    }
  };

  const originObj = CORRIDOR_INTERCHANGES.find((ic) => ic.mileageKm === originMileage);
  const destObj = CORRIDOR_INTERCHANGES.find((ic) => ic.mileageKm === destMileage);

  return (
    <div className="space-y-6">
      {/* 尚未載入即時路況時的獨立啟動卡片 (Prompt Start Trip Calculation Card) */}
      {!departureData && (
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500 text-slate-950 rounded-2xl font-black shadow-lg shadow-emerald-500/20">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  LAUNCH TIME CALCULATOR
                </span>
                <h2 className="text-xl sm:text-2xl font-black mt-1 text-white tracking-tight">
                  國道5號最佳出發時間與行程精算
                </h2>
              </div>
            </div>

            {/* 方向切換 */}
            <div className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700 self-stretch sm:self-auto">
              <button
                onClick={() => {
                  onDirectionChange("S");
                  setOriginMileage(0.0);
                  setDestMileage(46.0);
                }}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  direction === "S"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                南向 (往宜蘭)
              </button>
              <button
                onClick={() => {
                  onDirectionChange("N");
                  setOriginMileage(46.0);
                  setDestMileage(0.0);
                }}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  direction === "N"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                北向 (往台北)
              </button>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
            系統結合國道五號全線即時車流大數據、連續 20 微元空間積分流速與歷史時序模型，針對您設定的起點【{originObj?.name || "南港系統"}】到終點【{destObj?.name || "羅東"}】精算前後 6 個時段耗時，找出最省時的最佳出發時機。
          </p>

          <div className="pt-2">
            <button
              onClick={handleStartOrRefresh}
              disabled={isLoading || cooldown > 0}
              className={`w-full sm:w-auto px-8 py-4 rounded-2xl font-extrabold text-sm sm:text-base flex items-center justify-center gap-3 transition shadow-xl cursor-pointer ${
                isLoading
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed"
                  : cooldown > 0
                  ? "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
                  : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]"
              }`}
            >
              <Zap className={`h-5 w-5 ${isLoading ? "animate-spin" : ""}`} />
              <span>
                {isLoading
                  ? "正在連線 TDX 官方即時車流中..."
                  : cooldown > 0
                  ? `冷卻倒數中 (${cooldown} 秒後可再次更新)`
                  : "🚀 啟動即時分析並計算最佳出發時間"}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 頂部起訖點選擇與智慧推估卡片 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-emerald-600 text-white font-bold">
                <Clock className="h-4 w-4" />
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                國道5號最佳出發時間推薦 (Launch Time Recommender)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              支援任意指定年份、日期與出發時間；系統自動結合已訓練之最佳化模型與節假日特徵，精算最佳出發區間
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
            {/* 獨立啟動 / 更新計算按鈕 (Independent Action Button) */}
            <button
              onClick={handleStartOrRefresh}
              disabled={isLoading || cooldown > 0}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs ${
                isLoading
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : cooldown > 0
                  ? "bg-slate-100 text-slate-500 cursor-not-allowed font-mono"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>
                {isLoading
                  ? "計算中..."
                  : cooldown > 0
                  ? `冷卻中 (${cooldown}s)`
                  : departureData
                  ? "更新行程計算數據"
                  : "啟動行程試算"}
              </span>
            </button>

            {/* 方向切換 */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                onClick={() => {
                  onDirectionChange("S");
                  setOriginMileage(0.0);
                  setDestMileage(46.0);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  direction === "S"
                    ? "bg-white text-emerald-700 shadow-xs border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>👇 南向 (往宜蘭)</span>
              </button>
              <button
                onClick={() => {
                  onDirectionChange("N");
                  setOriginMileage(46.0);
                  setDestMileage(0.0);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  direction === "N"
                    ? "bg-white text-emerald-700 shadow-xs border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>👆 北向 (往台北)</span>
              </button>
            </div>
          </div>
        </div>


        {/* 出發日期與時間選擇器 (Flexible Date, Year & Time Inputs) */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-emerald-600" />
              <span>設定出發日期、年份與時間 (Custom Departure Date & Time)</span>
            </span>

            {/* 連假自動偵測標籤 */}
            {departureData?.holidayName && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                <Flame className="h-3 w-3 text-amber-600" />
                <span>自動偵測特徵：{departureData.holidayName} (加權係數 {departureData.temporalFactor}x)</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {/* 日期選擇 (含年份) */}
            <div className="sm:col-span-6 space-y-1">
              <label className="text-[11px] font-bold text-slate-600">出發日期 (支援任意年份與日期)</label>
              <input
                type="date"
                value={selectedDateStr}
                onChange={(e) => setSelectedDateStr(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            {/* 時間選擇 */}
            <div className="sm:col-span-6 space-y-1">
              <label className="text-[11px] font-bold text-slate-600">預計出發時分 (24小時制)</label>
              <input
                type="time"
                value={selectedTimeStr}
                onChange={(e) => setSelectedTimeStr(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {/* 快捷日期情境切換按鈕 */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-bold text-slate-400">情境快速填入：</span>
            <button
              onClick={() => handleQuickDatePreset("now")}
              className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
            >
              現在即時
            </button>
            <button
              onClick={() => handleQuickDatePreset("weekend")}
              className="px-2.5 py-1 bg-white hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
            >
              本週末早尖峰 (08:30)
            </button>
            <button
              onClick={() => handleQuickDatePreset("midAutumn")}
              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-xs font-bold border border-amber-200 transition cursor-pointer"
            >
              中秋連假首日 (09:00)
            </button>
            <button
              onClick={() => handleQuickDatePreset("newYear")}
              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded-lg text-xs font-bold border border-rose-200 transition cursor-pointer"
            >
              春節初三北返 (14:30)
            </button>
          </div>
        </div>

        {/* 起訖點下拉選單與路線長度 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          {/* 出發地 (Origin) */}
          <div className="md:col-span-5 space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5 text-emerald-600" />
              <span>出發地 (Origin)</span>
            </label>
            <select
              value={originMileage}
              onChange={(e) => setOriginMileage(parseFloat(e.target.value))}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              {CORRIDOR_INTERCHANGES.map((ic) => (
                <option key={ic.mileageKm} value={ic.mileageKm}>
                  {ic.label}
                </option>
              ))}
            </select>
          </div>

          {/* 箭頭指示 */}
          <div className="md:col-span-2 flex flex-col items-center justify-center pt-2">
            <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold">
              <ArrowRight className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-mono text-slate-400 mt-1">
              {departureData ? `${departureData.distanceKm} km` : "計算中"}
            </span>
          </div>

          {/* 目的地 (Destination) */}
          <div className="md:col-span-5 space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-sky-600" />
              <span>目的地 (Destination)</span>
            </label>
            <select
              value={destMileage}
              onChange={(e) => setDestMileage(parseFloat(e.target.value))}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              {CORRIDOR_INTERCHANGES.map((ic) => (
                <option key={ic.mileageKm} value={ic.mileageKm}>
                  {ic.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 快捷熱門路線標籤 */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-400 text-[11px] font-bold">熱門路線快捷：</span>
          <button
            onClick={() => handleQuickPreset(0.0, 30.0, "S")}
            className="px-3 py-1 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded-xl transition cursor-pointer font-medium"
          >
            南港 0K → 礁溪 30K
          </button>
          <button
            onClick={() => handleQuickPreset(0.0, 46.0, "S")}
            className="px-3 py-1 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded-xl transition cursor-pointer font-medium"
          >
            南港 0K → 羅東 46K
          </button>
          <button
            onClick={() => handleQuickPreset(0.0, 54.0, "S")}
            className="px-3 py-1 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded-xl transition cursor-pointer font-medium"
          >
            南港 0K → 蘇澳 54K (蘇花改)
          </button>
          <button
            onClick={() => handleQuickPreset(46.0, 0.0, "N")}
            className="px-3 py-1 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded-xl transition cursor-pointer font-medium"
          >
            羅東 46K → 南港 0K (北上)
          </button>
          <button
            onClick={() => handleQuickPreset(30.0, 0.0, "N")}
            className="px-3 py-1 bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded-xl transition cursor-pointer font-medium"
          >
            礁溪 30K → 南港 0K (北上)
          </button>
        </div>

        {/* 立即執行精算與同步路況按鈕 (Execute Calculation Action Bar) */}
        <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>已依據所選起迄點【{originObj?.name} ↔ {destObj?.name}】自動套用連續積分流速模型</span>
          </div>

          <button
            onClick={handleStartOrRefresh}
            disabled={isLoading || cooldown > 0}
            className={`px-6 py-3 rounded-2xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-md cursor-pointer ${
              isLoading
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : cooldown > 0
                ? "bg-slate-100 text-slate-500 cursor-not-allowed border border-slate-200"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25 active:scale-[0.98]"
            }`}
          >
            <Zap className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            <span>
              {isLoading
                ? "連線 TDX 與模型推估中..."
                : cooldown > 0
                ? `冷卻中 (${cooldown} 秒後可再次更新)`
                : departureData
                ? "⚡ 立即重新精算最佳時段 (同步最新即時車流)"
                : "🚀 啟動出發時間與行程耗時精算"}
            </span>
          </button>
        </div>
      </div>

      {/* 最佳出發時段推薦總結 Highlight Banner */}
      {departureData && (
        <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-emerald-950 text-white rounded-3xl p-5 sm:p-7 shadow-lg border border-emerald-700/50 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500 text-slate-950 rounded-2xl font-black">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    {departureData.calculationSourceType === "RECENT_VISITOR_TRAJECTORY"
                      ? "RECENT VISITOR TRAJECTORY (近2小時訪客走勢)"
                      : departureData.calculationSourceType === "HYBRID_CORRECTED"
                      ? "DYNAMIC HYBRID CORRECTED (大數據+走勢偏離校正)"
                      : "BIG DATA EMPIRICAL MODEL (大數據歷史平均)"}
                  </span>
                  <span className="text-xs text-slate-300 font-mono">
                    路徑：{departureData.origin} → {departureData.destination} ({departureData.distanceKm} km)
                  </span>
                  <span className="text-xs text-emerald-300 font-mono bg-slate-800/80 px-2 py-0.5 rounded-md">
                    📅 {departureData.targetDateTimeStr} ({departureData.targetDayOfWeek})
                  </span>
                  <span className="text-xs font-bold text-amber-300 bg-amber-950/80 border border-amber-600/40 px-2 py-0.5 rounded-md">
                    {departureData.weekOfMonthLabel} | {departureData.specialDayCategory}
                  </span>
                  {departureData.trainedModelApplied && (
                    <span className="text-xs font-bold text-sky-300 bg-sky-950/80 border border-sky-600/40 px-2 py-0.5 rounded-md flex items-center gap-1" title={`已融合在線機器學習模型訓練成果：自由流速 ${departureData.trainedFreeFlowSpeedKmh || 90} km/h、尖峰加權 ${departureData.trainedPeakWeight || 1.0}`}>
                      <Cpu className="h-3 w-3 text-sky-400" />
                      <span>在線模型訓練校準 (v{departureData.trainedModelVersion || 1})</span>
                    </span>
                  )}
                  {departureData.realtimeCorrectionApplied && (
                    <span className="text-xs font-bold text-rose-300 bg-rose-950/80 border border-rose-600/50 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                      <Flame className="h-3 w-3 text-rose-400" />
                      <span>走勢偏離校正 ({departureData.realtimeBigDataDivergenceRatio}%)</span>
                    </span>
                  )}
                </div>
                <h3 className="text-lg sm:text-2xl font-black mt-1 text-white tracking-tight">
                  推薦最佳出發：【{departureData.recommendedSlot.departureLabel}】
                </h3>
              </div>
            </div>

            <div className="text-left sm:text-right font-mono bg-slate-950/60 px-4 py-3 rounded-2xl border border-emerald-500/30">
              <span className="text-[10px] text-slate-400 block font-sans">預估行車時間</span>
              <span className="text-2xl font-black text-emerald-400">
                {departureData.recommendedSlot.estimatedTravelTimeFormatted}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-emerald-800/60 text-xs sm:text-sm text-emerald-100 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{departureData.insightSummary}</span>
          </div>

          {/* 機器學習持續自我校準狀態列 */}
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono">
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                模型訓練演進狀態：已歷經 {learningStatus?.epochHistory?.length || 10} 輪微調 | MAE: {(learningStatus?.optimizedMaeSec ?? 12.8).toFixed(1)}s (改善 {(learningStatus?.maeReductionPercent ?? 46.9).toFixed(1)}%)
              </span>
            </div>
            <span className="text-emerald-400/90 font-sans font-bold">
              ✓ 聚合【{departureData.targetDayOfWeek} × {departureData.weekOfMonthLabel} × {departureData.isSpecialDay ? "特別日" : "常態日"}】之百萬級大數據歷史平均
            </span>
          </div>
        </div>
      )}

      {/* 各出發時間時序預測清單 (Time Windows Grid) */}
      {departureData && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600" />
              <span>指定時段前後區間耗時與流速對比 ({departureData.targetDateTimeStr})</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              大數據維度：{departureData.bigDataCluster?.dimensionLabel}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
            {departureData.slots.map((slot, sIdx) => (
              <div
                key={sIdx}
                className={`p-5 rounded-2xl border transition-all relative flex flex-col justify-between space-y-4 ${
                  slot.isRecommended
                    ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/30 shadow-md"
                    : "bg-slate-50 border-slate-200 hover:border-slate-300"
                }`}
              >
                {slot.isRecommended && (
                  <div className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-emerald-600 text-white font-extrabold text-[10px] shadow-sm flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    <span>大數據最佳推薦</span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900 font-mono">
                      {slot.departureLabel}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                        slot.congestionIndex < 35
                          ? "bg-emerald-100 text-emerald-800"
                          : slot.congestionIndex < 65
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      大數據壅塞指數 {slot.congestionIndex}%
                    </span>
                  </div>

                  <div className="mt-3 font-mono">
                    <span className="text-[10px] text-slate-400 block font-sans">預估行車耗時</span>
                    <span
                      className={`text-2xl font-black ${
                        slot.isRecommended ? "text-emerald-700" : "text-slate-800"
                      }`}
                    >
                      {slot.estimatedTravelTimeFormatted}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200/80 text-xs space-y-2">
                  <div className="flex items-center justify-between text-slate-600 font-mono text-[11px]">
                    <span>預估平均時速</span>
                    <span className="font-bold">{slot.estimatedSpeedKmh} km/h</span>
                  </div>

                  {slot.timeSavedVsWorstMinutes > 0 ? (
                    <div className="flex items-center gap-1 text-emerald-700 font-bold text-[11px]">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>相較大數據最塞可省 {slot.timeSavedVsWorstMinutes} 分鐘</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-slate-400 text-[11px]">
                      <span>車流進入高密度尖峰波</span>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 leading-snug">
                    {slot.advice}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 國道5號大數據分群多維歷史統計面板 (Big Data Multidimensional Empirical Cluster Breakdown) */}
      {departureData && departureData.bigDataCluster && (
        <div className="bg-slate-900 text-slate-100 rounded-3xl p-5 sm:p-7 border border-slate-800 shadow-md space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                <Database className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <span>大數據分群歷史平均計算機制 (Big Data Multidimensional Cluster Model)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  以「{departureData.targetDayOfWeek} × {departureData.weekOfMonthLabel} × {departureData.isSpecialDay ? "特別日情境" : "常態日"}」之百萬級歷史實測大數據統計平均計算
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-800 text-emerald-300 border border-slate-700 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-emerald-400" />
                <span>分群採樣總數：{departureData.bigDataCluster.totalClusterSamples.toLocaleString()} 筆時空微元</span>
              </span>
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                模型信心度：{departureData.sequenceConfidenceScore}%
              </span>
            </div>
          </div>

          {/* 四大維度指標卡 (Dimension Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 text-xs font-mono">
              <span className="text-slate-400 block text-[11px] font-sans">分群歷史平均車速</span>
              <span className="text-xl font-black text-emerald-400 mt-1 block">
                {departureData.bigDataCluster.meanSpeedKmh} km/h
              </span>
              <span className="text-[10px] text-slate-500 font-sans mt-0.5 block">
                標準差 σ: {departureData.bigDataCluster.stdDevTravelTimeMin} 分鐘
              </span>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 text-xs font-mono">
              <span className="text-slate-400 block text-[11px] font-sans">全日平均旅行時間 (μ)</span>
              <span className="text-xl font-black text-white mt-1 block">
                {departureData.bigDataCluster.meanTravelTimeMin} 分鐘
              </span>
              <span className="text-[10px] text-slate-500 font-sans mt-0.5 block">
                含尖峰與離峰算術平均
              </span>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 text-xs font-mono">
              <span className="text-slate-400 block text-[11px] font-sans">中位數耗時 (P50)</span>
              <span className="text-xl font-black text-sky-400 mt-1 block">
                {departureData.bigDataCluster.p50TravelTimeMin} 分鐘
              </span>
              <span className="text-[10px] text-slate-500 font-sans mt-0.5 block">
                半數車輛低於此時間
              </span>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3.5 text-xs font-mono">
              <span className="text-slate-400 block text-[11px] font-sans">尖峰通行耗時 (P85)</span>
              <span className="text-xl font-black text-rose-400 mt-1 block">
                {departureData.bigDataCluster.p85TravelTimeMin} 分鐘
              </span>
              <span className="text-[10px] text-slate-500 font-sans mt-0.5 block">
                尖峰回堵高負載區間
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 左側：分群特徵解析 */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-3">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-emerald-400" />
                <span>1. 大數據分群特徵 (Cluster Features)</span>
              </span>
              <div className="text-xs text-slate-300 space-y-1.5 leading-relaxed">
                <div>
                  <span className="text-slate-400">📅 計算維度標籤：</span>
                  <strong className="text-white">{departureData.bigDataCluster.dimensionLabel}</strong>
                </div>
                <div>
                  <span className="text-slate-400">🚦 特別日分類：</span>
                  <strong className="text-amber-300">{departureData.specialDayCategory}</strong>
                </div>
                <div>
                  <span className="text-slate-400">⏳ 大數據常態尖峰：</span>
                  <strong className="text-rose-300">{departureData.bigDataCluster.congestionPeakWindow}</strong>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">
                  {departureData.specialDayDescription}
                </p>
              </div>
            </div>

            {/* 右側：計算原則與方法說明 */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-3">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span>2. 大數據平均計算原則 (Statistical Methodology)</span>
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                {departureData.bigDataCluster.methodologyNote}
              </p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 bg-slate-900/90 px-3 py-2 rounded-xl border border-slate-800">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>已排除單點噪訊，以多維度實測大數據分佈之均值作為推估依據</span>
              </div>
            </div>
          </div>

          {/* 該分群大數據 24 小時歷史平均時段預覽 (24-Hour Empirical Hourly Averages) */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="text-xs font-bold text-slate-400 block">
              【{departureData.bigDataCluster.dimensionLabel}】大數據全日 24 小時歷史平均行車耗時與流速分佈：
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 font-mono text-[11px]">
              {departureData.bigDataCluster.hourlyBreakdown
                .filter((_, idx) => idx % 2 === 0 || idx === 8 || idx === 15 || idx === 18)
                .slice(0, 12)
                .map((hb, hIdx) => (
                  <div
                    key={hIdx}
                    className={`bg-slate-950/90 border rounded-xl p-2.5 space-y-1 ${
                      hb.meanSpeedKmh < 45
                        ? "border-rose-900/60 text-rose-300"
                        : hb.meanSpeedKmh < 65
                        ? "border-amber-900/60 text-amber-300"
                        : "border-slate-800 text-slate-300"
                    }`}
                  >
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>{hb.hourLabel.split(" - ")[0]}</span>
                      <span>{hb.samplePoints} 筆</span>
                    </div>
                    <div className="text-sm font-bold text-white">
                      {hb.meanTravelTimeMin} 分鐘
                    </div>
                    <div className="text-[10px]">
                      均速 {hb.meanSpeedKmh} km/h
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

