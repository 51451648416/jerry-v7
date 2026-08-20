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
  elapsedSeconds = 132,
}: TwoMinuteStalePromptProps) {
  const elapsedMinutes = (elapsedSeconds / 60).toFixed(1);
  const elapsedRemSecs = elapsedSeconds % 60;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white border-2 border-amber-400/50 rounded-3xl p-5 sm:p-8 shadow-2xl space-y-5 max-w-4xl mx-auto my-3 relative overflow-hidden">
      {/* Background Decorative Accent */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

      {/* 1. 最上方醒目更新按鈕 (一眼即見的最優先操作) */}
      <div className="relative z-10">
        <button
          disabled={isLoading || cooldown > 0}
          onClick={onRefresh}
          className={`w-full py-4 sm:py-5 px-6 rounded-2xl font-black text-base sm:text-xl flex items-center justify-center gap-3 transition-all shadow-2xl cursor-pointer ${
            isLoading
              ? "bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600"
              : cooldown > 0
              ? "bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700"
              : "bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-slate-950 shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.99] ring-4 ring-emerald-400/30"
          }`}
        >
          <RefreshCw className={`h-6 w-6 sm:h-7 sm:w-7 ${isLoading ? "animate-spin" : ""}`} />
          <span className="tracking-wide">
            {isLoading
              ? "正在連線 TDX 官方端點獲取最新即時數據..."
              : cooldown > 0
              ? `數據冷卻中 (${cooldown} 秒後可再次更新)`
              : "🚀 立即更新 / 獲取最新即時路況數據"}
          </span>
        </button>
      </div>

      {/* 2. 標題與方向切換 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10 border-t border-b border-slate-700/70 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-2xl font-black">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30">
                API 資源最佳化
              </span>
              <span className="text-xs text-slate-400 font-mono">
                逾 {elapsedMinutes} 分鐘
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold mt-0.5 text-white tracking-tight">
              數據已超過 2.2 分鐘未更新，請點擊上方按鈕更新
            </h2>
          </div>
        </div>

        {/* 方向切換 */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700 self-stretch sm:self-auto shrink-0">
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

      {/* 3. 狀態提示與守護指標 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono relative z-10">
        <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
          <div>
            <span className="text-slate-400 text-[10px] block font-sans">API 頻寬守護</span>
            <span className="text-white font-bold">按需手動更新機制</span>
          </div>
        </div>
        <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
          <Clock className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <span className="text-slate-400 text-[10px] block font-sans">超時待命門檻</span>
            <span className="text-white font-bold">132 秒 (2.2 分鐘)</span>
          </div>
        </div>
        <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
          <Activity className="h-5 w-5 text-cyan-400 shrink-0" />
          <div>
            <span className="text-slate-400 text-[10px] block font-sans">目前監測方向</span>
            <span className="text-white font-bold">{direction === "S" ? "國5南下 0K~54K" : "國5北上 54K~0K"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
