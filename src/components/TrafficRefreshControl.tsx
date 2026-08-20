import React, { useState, useEffect, useRef } from "react";
import { RefreshCw, ShieldCheck, Zap } from "lucide-react";

export const STORAGE_KEY_TIMESTAMPS = "traffic_fetch_history_v1";
export const STORAGE_KEY_LOCK_UNTIL = "traffic_cooldown_lock_until";

export const BASE_COOLDOWN_SEC = 90;
export const PENALTY_COOLDOWN_SEC = 150;
export const SLIDING_WINDOW_MS = 3 * 60 * 1000; // 3 分鐘 (180 秒)
export const MAX_REQUESTS_IN_WINDOW = 2; // 3 分鐘內第 3 次起觸發 150 秒懲罰冷卻

export const getNextCooldownDuration = (): number => {
  try {
    const now = Date.now();
    const rawHistory = localStorage.getItem(STORAGE_KEY_TIMESTAMPS);
    let history: number[] = rawHistory ? JSON.parse(rawHistory) : [];

    // 過濾出 3 分鐘內的紀錄
    history = history.filter((ts) => now - ts < SLIDING_WINDOW_MS);

    // 第 3 次起延長至 150 秒
    const duration =
      history.length >= MAX_REQUESTS_IN_WINDOW ? PENALTY_COOLDOWN_SEC : BASE_COOLDOWN_SEC;

    history.push(now);
    localStorage.setItem(STORAGE_KEY_TIMESTAMPS, JSON.stringify(history));
    return duration;
  } catch {
    return BASE_COOLDOWN_SEC;
  }
};

export const getRemainingCooldownSec = (): number => {
  try {
    const now = Date.now();
    const lockUntil = parseInt(localStorage.getItem(STORAGE_KEY_LOCK_UNTIL) || "0", 10);
    if (lockUntil > now) {
      return Math.ceil((lockUntil - now) / 1000);
    }
    return 0;
  } catch {
    return 0;
  }
};

interface TrafficRefreshControlProps {
  onFetchData: () => Promise<void>;
  isLoading?: boolean;
  cooldown?: number;
  buttonText?: string;
  className?: string;
  variant?: "primary" | "compact";
}

export const TrafficRefreshControl: React.FC<TrafficRefreshControlProps> = ({
  onFetchData,
  isLoading = false,
  cooldown: externalCooldown,
  buttonText = "按我分析哪一邊車道比較快",
  className = "",
  variant = "primary",
}) => {
  const [internalCooldown, setInternalCooldown] = useState<number>(() => getRemainingCooldownSec());
  const [randomDelaySec, setRandomDelaySec] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const activeCooldown = externalCooldown !== undefined ? externalCooldown : internalCooldown;

  // 本地備援倒數計時器
  useEffect(() => {
    if (activeCooldown <= 0) return;

    const interval = setInterval(() => {
      setInternalCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeCooldown]);

  const handleManualClick = async () => {
    if (activeCooldown > 0 || isLoading || isProcessing) return;

    // 隨機選取 1 到 4 秒 (1, 2, 3, 4)
    const randomSec = Math.floor(Math.random() * 4) + 1;
    setRandomDelaySec(randomSec);
    setIsProcessing(true);

    try {
      // 隨機等待 1~4 秒並在按鈕上顯示該秒數
      await new Promise((resolve) => setTimeout(resolve, randomSec * 1000));
      await onFetchData();
    } catch (error) {
      console.error("更新失敗:", error);
    } finally {
      setIsProcessing(false);
      setRandomDelaySec(null);
    }
  };

  const isBusy = isLoading || isProcessing;

  if (variant === "compact") {
    return (
      <button
        onClick={handleManualClick}
        disabled={activeCooldown > 0 || isBusy}
        className={`px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1.5 border cursor-pointer ${
          activeCooldown > 0 || isBusy
            ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed font-mono"
            : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 active:scale-95"
        } ${className}`}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? "animate-spin text-slate-400" : ""}`} />
        <span>
          {isBusy
            ? randomDelaySec !== null
              ? `同步中 (${randomDelaySec}s)...`
              : "計算中..."
            : activeCooldown > 0
            ? `冷卻 (${activeCooldown}s)`
            : "即時更新"}
        </span>
      </button>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 w-full ${className}`}>
      <button
        onClick={handleManualClick}
        disabled={activeCooldown > 0 || isBusy}
        className={`w-full py-3.5 px-6 rounded-2xl font-black text-sm sm:text-base flex items-center justify-center gap-2.5 transition shadow-md cursor-pointer ${
          activeCooldown > 0 || isBusy
            ? "bg-slate-100 text-slate-500 border border-slate-200 cursor-not-allowed font-mono text-xs sm:text-sm"
            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25 active:scale-[0.98]"
        }`}
      >
        {isBusy ? (
          <>
            <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="font-sans">
              {randomDelaySec !== null
                ? `正在分析哪一邊車道比較快... (隨機等待 ${randomDelaySec} 秒)`
                : "正在分析哪一邊車道比較快..."}
            </span>
          </>
        ) : activeCooldown > 0 ? (
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>冷卻保護中 ({activeCooldown} 秒後可再次更新)</span>
          </div>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span>{buttonText}</span>
          </>
        )}
      </button>

      {activeCooldown > BASE_COOLDOWN_SEC && (
        <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-3 py-1 rounded-xl border border-amber-200 font-mono text-center">
          <span>※ 偵測到頻繁查詢，為維持高精準度推估，已啟動節流保護機制 (150秒)</span>
        </div>
      )}
    </div>
  );
};

export default TrafficRefreshControl;
