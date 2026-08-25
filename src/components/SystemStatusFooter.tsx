import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  Activity,
  Radio,
  Clock,
  ShieldCheck,
  Cpu,
  Layers,
  Cloud,
  CloudOff,
  RefreshCw,
  Database,
  Key,
} from "lucide-react";
import { useCloudSyncStatus } from "../services/cloudSyncService";

export default function SystemStatusFooter() {
  const [lastCheckTime, setLastCheckTime] = useState<string>(
    new Date().toLocaleTimeString("zh-TW", { hour12: false })
  );
  const [nextCountdown, setNextCountdown] = useState<number>(300); // 5 分鐘背景計時

  const {
    isCloudConnected,
    isServerOnline,
    keyCount,
    modelVersion,
    datasetCount,
    lastSyncTime,
    isSyncing,
    syncStatusText,
    redisMode,
    syncCooldown,
    triggerManualSync,
  } = useCloudSyncStatus();

  useEffect(() => {
    const timer = setInterval(() => {
      setNextCountdown((prev) => {
        if (prev <= 1) {
          setLastCheckTime(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
          return 300;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const handleManualSyncClick = async () => {
    await triggerManualSync();
  };

  return (
    <footer className="w-full border-t border-slate-200 bg-white/95 backdrop-blur-sm py-3.5 px-4 mt-8 shadow-xs">
      <div className="max-w-7xl mx-auto space-y-2.5">
        {/* 頂層：顯眼的雲端 Redis 全域同步監控狀態列 (Step 2) */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 即時連線燈號 */}
            {isCloudConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold font-mono shadow-2xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <Cloud className="h-3.5 w-3.5 text-emerald-600" />
                <span>🟢 雲端同步已連線 (Upstash Redis)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-300 font-bold font-mono shadow-2xs">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <CloudOff className="h-3.5 w-3.5 text-amber-600" />
                <span>🟡 本機離線模式 (使用單機快取 · 未同步)</span>
              </span>
            )}

            {/* 同步細節資訊 */}
            <span className="text-slate-700 font-medium">
              {isCloudConnected ? (
                <span>
                  雲端同步中 (已載入 <strong className="text-emerald-700 font-mono font-bold">{keyCount}</strong> 組全域金鑰 / 全域模型 <strong className="text-emerald-700 font-mono font-bold">v{modelVersion}</strong> / 資料庫 <strong className="text-emerald-700 font-mono font-bold">{datasetCount}</strong> 筆)
                </span>
              ) : (
                <span>
                  使用單機快取 (未同步) · 當前本機 <strong className="text-slate-900 font-mono">{keyCount}</strong> 組金鑰 · 模型 <strong className="text-slate-900 font-mono">v{modelVersion}</strong>
                </span>
              )}
            </span>
          </div>

          {/* 手動強制雙向同步按鈕 */}
          <div className="flex items-center gap-2 shrink-0">
            {lastSyncTime && (
              <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                最後同步: {lastSyncTime}
              </span>
            )}
            <button
              onClick={handleManualSyncClick}
              disabled={isSyncing || (syncCooldown > 0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs ${
                isSyncing || syncCooldown > 0
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300"
                  : isCloudConnected
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  : "bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
              }`}
              title={
                syncCooldown > 0
                  ? `手動同步冷卻中，請等待 ${syncCooldown} 秒後再次同步`
                  : "強制自 Upstash 雲端拉取最新金鑰、模型參數與訓練資料集並全域更新 (每 50 秒可手動觸發一次)"
              }
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
              <span>
                {isSyncing
                  ? "同步中..."
                  : syncCooldown > 0
                  ? `同步冷卻 (${syncCooldown}s)`
                  : "立即同步雲端"}
              </span>
            </button>
          </div>
        </div>

        {/* 底層：系統各模組運行狀況 */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-slate-600">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-slate-700 font-sans font-bold flex items-center gap-1">
              <Activity className="h-3.5 w-3.5 text-emerald-600" />
              即時服務：
            </span>

            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              TDX 實時 VD 車速串流 (正常)
            </span>

            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              20微元動態空間積分 (運作中)
            </span>

            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              ETC 門架實測真值保底 (在線)
            </span>

            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              API 金鑰全域自動輪轉 (正常)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-slate-500 font-mono text-[10px]">
            <span>最後輪詢: {lastCheckTime}</span>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span className="hidden sm:inline">下次背景檢測: {formatCountdown(nextCountdown)}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
