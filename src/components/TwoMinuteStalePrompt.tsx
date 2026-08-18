import React from "react";
import {
  RefreshCw,
  Clock,
  Zap,
  ShieldCheck,
  AlertCircle,
  Activity,
  Compass,
  ArrowRight,
} from "lucide-react";
import { Direction } from "../types";

interface TwoMinuteStalePromptProps {
  direction: Direction;
  onDirectionChange: (dir: Direction) => void;
  onRefresh: () => void;
  isLoading: boolean;
  cooldown: number;
  elapsedSeconds?: number;
}

export default function TwoMinuteStalePrompt({
  direction,
  onDirectionChange,
  onRefresh,
  isLoading,
  cooldown,
  elapsedSeconds = 120,
}: TwoMinuteStalePromptProps) {
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedRemSecs = elapsedSeconds % 60;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white border-2 border-amber-400/40 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 max-w-4xl mx-auto my-3 relative overflow-hidden">
      {/* Background Decorative Accent */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

      {/* Top Tag & Direction Control */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10 border-b border-slate-700/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500 text-slate-950 rounded-2xl font-black shadow-lg shadow-amber-500/20">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30">
              API RESOURCE OPTIMIZATION
            </span>
            <h2 className="text-xl sm:text-2xl font-black mt-1 text-white tracking-tight">
              數據已超過 2 分鐘未更新
            </h2>
          </div>
        </div>

        {/* Direction Switch */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700 self-stretch sm:self-auto">
          <button
            onClick={() => onDirectionChange("S")}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              direction === "S"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-400 hover:text-white"
            }`}
          >
            南向 (往宜蘭)
          </button>
          <button
            onClick={() => onDirectionChange("N")}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              direction === "N"
                ? "bg-cyan-600 text-white shadow-xs"
                : "text-slate-400 hover:text-white"
            }`}
          >
            北向 (往台北)
          </button>
        </div>
      </div>

      {/* Detailed Description */}
      <div className="space-y-3 relative z-10">
        <div className="flex items-start gap-2.5 bg-amber-950/40 border border-amber-500/30 p-4 rounded-2xl text-amber-200 text-xs sm:text-sm leading-relaxed">
          <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-300 font-bold block mb-1">
              為避免過度消耗 API 資源，畫面已自動跳轉至更新待命狀態：
            </strong>
            距前次更新已逾 {elapsedMinutes} 分 {elapsedRemSecs > 0 ? `${elapsedRemSecs} 秒` : ""}。為確保您取得之雪山隧道車道等效流速及國5全線旅行時間為最新即時狀態，請點擊下方按鈕以立即獲取最新數據。
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono pt-1">
          <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
            <div>
              <span className="text-slate-400 text-[10px] block font-sans">API 頻寬守護</span>
              <span className="text-white font-bold">按需更新機制</span>
            </div>
          </div>
          <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <span className="text-slate-400 text-[10px] block font-sans">超時監控閾值</span>
              <span className="text-white font-bold">120 秒 (2 分鐘)</span>
            </div>
          </div>
          <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 flex items-center gap-3">
            <Activity className="h-5 w-5 text-cyan-400 shrink-0" />
            <div>
              <span className="text-slate-400 text-[10px] block font-sans">目標方向端點</span>
              <span className="text-white font-bold">{direction === "S" ? "國5南下 0K~54K" : "國5北上 54K~0K"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button: You can only press to update immediately or fetch the latest data */}
      <div className="pt-2 relative z-10">
        <button
          disabled={isLoading || cooldown > 0}
          onClick={onRefresh}
          className={`w-full sm:w-auto px-10 py-4.5 rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-3 transition shadow-xl cursor-pointer ${
            isLoading
              ? "bg-slate-700 text-slate-400 cursor-not-allowed"
              : cooldown > 0
              ? "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
              : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]"
          }`}
        >
          <RefreshCw className={`h-6 w-6 ${isLoading ? "animate-spin" : ""}`} />
          <span>
            {isLoading
              ? "正在連線 TDX 官方端點獲取最新數據..."
              : cooldown > 0
              ? `冷卻倒數中 (${cooldown} 秒後可再次更新)`
              : "🚀 立即更新 / 獲取最新即時數據"}
          </span>
        </button>
      </div>
    </div>
  );
}
