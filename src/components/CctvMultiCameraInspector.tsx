import React, { useState, useEffect } from "react";
import {
  Camera,
  Activity,
  ShieldCheck,
  Zap,
  Clock,
  RefreshCw,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Layers,
  ArrowRight,
  ListOrdered,
  Gauge,
  Sparkles,
  Server,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { FullLineInspectionState, CameraAiInspectionRecord, Direction } from "../types";

interface CctvMultiCameraInspectorProps {
  currentDirection: Direction;
  onSelectCamera?: (cameraId: string) => void;
}

export default function CctvMultiCameraInspector({
  currentDirection,
  onSelectCamera,
}: CctvMultiCameraInspectorProps) {
  const [inspectionState, setInspectionState] = useState<FullLineInspectionState | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [activeDirectionFilter, setActiveDirectionFilter] = useState<Direction | "ALL">(currentDirection);
  const [expandedCamId, setExpandedCamId] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");

  // 抓取全線 8 支鏡頭最新快取狀態 (Read-Through Cache)
  const fetchInspectionState = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setLoading(true);
    try {
      const res = await fetch("/api/cctv/inspection/all");
      const data = await res.json();
      if (data && data.success) {
        setInspectionState(data);
        setLastRefreshedAt(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      }
    } catch (err) {
      console.error("Failed to fetch CCTV inspection state:", err);
    } finally {
      if (showLoadingSpinner) setLoading(false);
    }
  };

  // 手動觸發全線或單一鏡頭巡檢 (自動推入 4.5s 循環隊列)
  const triggerInspection = async (cameraId?: string) => {
    if (triggering) return;
    setTriggering(true);
    try {
      const res = await fetch("/api/cctv/inspection/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraId }),
      });
      const data = await res.json();
      if (data && data.success) {
        setInspectionState(data);
        setLastRefreshedAt(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
      }
    } catch (err) {
      console.error("Failed to trigger CCTV inspection:", err);
    } finally {
      setTriggering(false);
    }
  };

  // 初始化與每 10 秒輕量輪詢快取與隊列狀態
  useEffect(() => {
    fetchInspectionState(true);
    const interval = setInterval(() => {
      fetchInspectionState(false);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // 本機秒數平滑倒數計時器 (每秒更新 TTL)
  useEffect(() => {
    const timer = setInterval(() => {
      setInspectionState((prev) => {
        if (!prev) return prev;
        const updatedNodes = prev.nodes.map((node) => {
          const nextTtl = Math.max(0, node.cacheTtlRemainingSec - 1);
          return {
            ...node,
            cacheTtlRemainingSec: nextTtl,
            isStale: nextTtl <= 0,
          };
        });
        return {
          ...prev,
          nodes: updatedNodes,
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 依照方向過濾鏡頭
  const filteredNodes = (inspectionState?.nodes || []).filter((node) => {
    if (activeDirectionFilter === "ALL") return true;
    return node.direction === activeDirectionFilter;
  });

  // 分組統計
  const totalNodesCount = inspectionState?.nodes.length || 0;
  const abnormalNodesCount = (inspectionState?.nodes || []).filter((n) => n.hasAbnormalGap).length;
  const queueLength = inspectionState?.queueStatus.queueLength || 0;
  const isQueueProcessing = inspectionState?.queueStatus.isProcessing || false;
  const currentProcessingId = inspectionState?.queueStatus.currentProcessingCameraId;

  return (
    <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-md space-y-6">
      {/* 頂部標題與核心狀態列 */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
              <Camera className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  雪山隧道全線多鏡頭 AI 循環巡檢矩陣
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-3 h-3" />
                  15 RPM 速率防護
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                全線 8 處關鍵里程節點（入口/中段/出口）・Vercel Cron 伺服器背景定時巡檢・獨立 360 秒 Redis 快取
              </p>
            </div>
          </div>
        </div>

        {/* 控制按鈕與方向切換 */}
        <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap justify-between lg:justify-end">
          <div className="inline-flex p-1 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveDirectionFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeDirectionFilter === "ALL"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              全線 (8)
            </button>
            <button
              onClick={() => setActiveDirectionFilter("S")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeDirectionFilter === "S"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              南向 坪林➜頭城 (4)
            </button>
            <button
              onClick={() => setActiveDirectionFilter("N")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeDirectionFilter === "N"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              北向 頭城➜坪林 (4)
            </button>
          </div>

          <button
            onClick={() => triggerInspection()}
            disabled={triggering || isQueueProcessing}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              triggering || isQueueProcessing
                ? "bg-slate-800/80 text-slate-400 border-slate-700 cursor-not-allowed"
                : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30 active:scale-95"
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${triggering || isQueueProcessing ? "animate-spin" : ""}`} />
            <span>{isQueueProcessing ? "隊列巡檢中..." : "全線排程巡檢"}</span>
          </button>
        </div>
      </div>

      {/* 智慧限流與配額守護指標 (Rate Limiting Dashboard) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
              API 速率保護
            </span>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
              安全
            </span>
          </div>
          <div className="text-base sm:text-lg font-bold text-white">
            4.5 秒 / 鏡頭
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            等效 ~13.3 RPM &lt; 15 RPM 上限
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1">
              <ListOrdered className="w-3.5 h-3.5 text-amber-400" />
              巡檢隊列狀態
            </span>
            {isQueueProcessing ? (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            ) : (
              <span className="text-[10px] text-slate-400">待命中</span>
            )}
          </div>
          <div className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>{queueLength} 支待巡檢</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            {currentProcessingId ? `正在辨識: ${currentProcessingId}` : "隊列目前為淨空"}
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              Redis 快取過期
            </span>
            <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.2 rounded border border-cyan-500/20">
              300 秒 TTL
            </span>
          </div>
          <div className="text-base sm:text-lg font-bold text-white">
            5 分鐘保護
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            避免前端連點並發請求
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              AI Studio 配額
            </span>
            <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20">
              Free Tier
            </span>
          </div>
          <div className="text-base sm:text-lg font-bold text-white">
            {inspectionState?.rateLimitGuard.rpdBudgetRemaining || 1500} / 1500
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            每日呼叫預算守護 (RPD)
          </div>
        </div>
      </div>

      {/* 8 個監控節點卡片矩陣 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
          <span>全線監控節點狀態（點擊單張卡片可查看詳細 AI 空間幾何觀察）</span>
          <span>共 {filteredNodes.length} 處節點</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredNodes.map((node) => {
            const isProcessingThis = currentProcessingId === node.cameraId;
            const isExpanded = expandedCamId === node.cameraId;
            const ttlPercent = Math.min(100, Math.max(0, (node.cacheTtlRemainingSec / 300) * 100));

            return (
              <motion.div
                key={node.cameraId}
                layout
                className={`relative bg-slate-950/70 border rounded-xl p-4 transition-all ${
                  isProcessingThis
                    ? "border-amber-500/50 bg-amber-950/20 shadow-amber-500/5 shadow-lg"
                    : node.hasAbnormalGap
                    ? "border-amber-500/40 bg-amber-950/10"
                    : "border-slate-800 hover:border-slate-700"
                }`}
              >
                {/* 節點頭部 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`p-2 rounded-lg text-xs font-bold shrink-0 mt-0.5 ${
                        node.direction === "S"
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      }`}
                    >
                      {node.direction === "S" ? "南向" : "北向"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {node.cameraTitle}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {node.mileageKm}K
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {node.segmentName}
                      </p>
                    </div>
                  </div>

                  {/* 狀態徽章 */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isProcessingThis ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        AI 辨識中
                      </span>
                    ) : node.hasAbnormalGap ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        偵測車道異常淨空
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        車流均勻正常
                      </span>
                    )}
                  </div>
                </div>

                {/* 空間幾何判斷簡述 */}
                <div className="mt-3 bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5 text-xs text-slate-300 leading-relaxed">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span className="flex items-center gap-1 text-slate-300 font-medium">
                      <Eye className="w-3.5 h-3.5 text-indigo-400" />
                      Gemini 視覺空間幾何觀察
                    </span>
                    <span className="text-[10px] text-slate-400">
                      信心度 {(node.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-slate-200">
                    {node.observationText}
                  </p>
                  {node.hasAbnormalGap && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center gap-2 text-amber-300 text-[11px] font-semibold">
                      <span>阻抗車道:</span>
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/30">
                        第 {node.gapLane === 1 ? "1 (內側)" : "2 (外側)"} 車道前方淨空
                      </span>
                    </div>
                  )}
                </div>

                {/* 底部快取進度條與單鏡頭巡檢按鈕 */}
                <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-cyan-400" />
                        快取倒數
                      </span>
                      <span className={node.isStale ? "text-amber-400" : "text-slate-300"}>
                        {node.cacheTtlRemainingSec} 秒 {node.isStale ? "(已排入隊列)" : ""}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-1000 ${
                          node.isStale
                            ? "bg-amber-500"
                            : ttlPercent > 30
                            ? "bg-indigo-500"
                            : "bg-amber-400"
                        }`}
                        style={{ width: `${ttlPercent}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => triggerInspection(node.cameraId)}
                    disabled={isProcessingThis || node.cacheTtlRemainingSec > 240}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border shrink-0 transition-all ${
                      isProcessingThis || node.cacheTtlRemainingSec > 240
                        ? "bg-slate-800/50 text-slate-400 border-slate-800 cursor-not-allowed"
                        : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30 active:scale-95"
                    }`}
                  >
                    單獨排程
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 底部說明文字 */}
      <div className="text-[11px] text-slate-400 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-300">智慧限流保護運作機制：</span>
          系統嚴格實施「循環隊列巡檢」，每辨識一支鏡頭後強制休止 4.5 秒，確保全線辨識請求永遠低於 Google AI Studio 免費額度之 15 RPM 上限；辨識結果具備獨立 300 秒 Redis 長效快取，前端頻繁觸發或連點將優先回傳快取數據，徹底保護免費雲端配額。
        </div>
      </div>
    </div>
  );
}
