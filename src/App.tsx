import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Compass,
  Video,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  MapPin,
  Database,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Header, { ActiveTabType } from "./components/Header";
import SimpleLaneRecommendation from "./components/SimpleLaneRecommendation";
import AdvancedAnalysisModal from "./components/AdvancedAnalysisModal";
import RampMeterPulseMeter from "./components/RampMeterPulseMeter";
import CctvWall from "./components/CctvWall";
import SystemStatusFooter from "./components/SystemStatusFooter";
import TunnelGisMap from "./components/TunnelGisMap";
import TunnelEntranceCover from "./components/TunnelEntranceCover";
import TunnelCrossSectionView from "./components/TunnelCrossSectionView";
import CorridorMonitor from "./components/CorridorMonitor";
import DepartureTimeRecommender from "./components/DepartureTimeRecommender";
import DatasetRepositoryView from "./components/DatasetRepositoryView";
import TheoryAndPrinciplesView from "./components/TheoryAndPrinciplesView";
import BackendAuthModal from "./components/BackendAuthModal";
import AdminAdvancedSettingsModal from "./components/AdminAdvancedSettingsModal";
import GlobalSearchModal, { SearchResultItem } from "./components/GlobalSearchModal";
import TwoMinuteStalePrompt from "./components/TwoMinuteStalePrompt";
import { getResolvedApiUrl, getResolvedApiHeaders, syncApiConfigFromServer } from "./services/apiConfig";
import { fetchDirectFreewayVd, fetchEtcTravelTimeData, fetchFreewayIncidents, fetchRampMeteringData } from "./services/tdxDirectClient";
import { evaluateFreeway5MeteringSystem } from "./estimator/rampMeteringEngine";
import { syncTdxKeysFromServer } from "./services/tdxKeyRotator";
import { syncDatasetFromServer, captureDetectionToDataset, subscribeDatasetChanges, getStoredDataset } from "./services/datasetRepository";
import { syncLearnedParametersFromServer, getLearnedParameters, subscribeModelChanges } from "./estimator/modelTrainingEngine";
import { performBidirectionalCloudSync } from "./services/cloudSyncService";
import TrafficRefreshControl, {
  getRemainingCooldownSec,
  getNextCooldownDuration,
  STORAGE_KEY_LOCK_UNTIL,
  STORAGE_KEY_TIMESTAMPS,
  BASE_COOLDOWN_SEC,
} from "./components/TrafficRefreshControl";
import { Direction, FinalEstimatorOutput, VehicleTransitMode } from "./types";
import { runVdTrafficEstimator } from "./estimator/trafficEngine";
import { isAdminAuthenticated, subscribeAdminAuth } from "./services/adminAuth";
import { recordVisitorSession } from "./services/visitorStats";
import { recordVisitorTrafficTrajectory } from "./services/recentVisitorTrajectoryRepository";
import { postPredictionToReconcile, triggerLazyReconciliation } from "./services/autoTrainingCollector";

const STALE_DATA_TIMEOUT_SECONDS = 132; // 2.2 分鐘 (132 秒) 未更新即判為過期，需跳轉回更新畫面
const FORTY_MINUTES_TIMEOUT_SECONDS = 40 * 60; // 40 分鐘 (2400 秒) 判斷：超過 40 分鐘未更新或閒置則完全退回首頁
const STORAGE_LAST_FETCH_TIME_KEY = "hsuehshan_traffic_last_fetch_timestamp";
const STORAGE_LAST_OUTPUT_KEY = "hsuehshan_traffic_cached_output";
const STORAGE_HAS_STARTED_KEY = "hsuehshan_traffic_started_state";
const STORAGE_VEHICLE_MODE_KEY = "hsuehshan_traffic_vehicle_mode";

const computeRemainingCooldown = (): number => {
  return getRemainingCooldownSec();
};

const computeElapsedSeconds = (): number => {
  try {
    const lastFetchStr = localStorage.getItem(STORAGE_LAST_FETCH_TIME_KEY);
    if (!lastFetchStr) return 0;
    const lastFetchTime = parseInt(lastFetchStr, 10);
    if (isNaN(lastFetchTime)) return 0;
    return Math.floor((Date.now() - lastFetchTime) / 1000);
  } catch {
    return 0;
  }
};

export default function App() {
  // Top 5 Tabs: 'lane' | 'corridor' | 'departure' | 'theory' | 'cctv'
  const [activeTab, setActiveTab] = useState<ActiveTabType>("lane");

  // Direction: Southbound (S) or Northbound (N)
  const [direction, setDirection] = useState<Direction>("S");

  // 乘車方式 (Vehicle / Transit Mode): 'car' (小客車), 'bus' (大客車/客運), 'taxi' (計程車/多元)
  const [selectedVehicleMode, setSelectedVehicleMode] = useState<VehicleTransitMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VEHICLE_MODE_KEY);
      if (saved === "car" || saved === "bus" || saved === "taxi") return saved;
    } catch {}
    return "car";
  });

  // 目前選取路線資訊
  const [selectedRoute, setSelectedRoute] = useState<{
    originKm: number;
    destKm: number;
    label: string;
  } | null>(null);

  // Analysis State: Variables start at 0 on first entry, and change to 100 on begin analysis
  const [hasStartedAnalysis, setHasStartedAnalysis] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);

  // Estimator Output State
  const [estimatorOutput, setEstimatorOutput] = useState<FinalEstimatorOutput | null>(null);

  // Status & Error States (No simulation fallback when TDX is down!)
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [tdxError, setTdxError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "emerald" | "rose" | "amber" } | null>(null);

  // Advanced Analysis Modal State
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Global Keyword Search Modal State
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Persistent 80s Cooldown State & 2-Minute Staleness Tracking
  const [cooldown, setCooldown] = useState<number>(() => computeRemainingCooldown());
  const [elapsedSinceLastFetch, setElapsedSinceLastFetch] = useState<number>(() => computeElapsedSeconds());
  
  // 判斷是否已超過 2 分鐘 (120 秒) 未更新即時數據 (僅在已獲取過資料且超過 2 分鐘時提示)
  const hasFetchedHistory = Boolean(localStorage.getItem(STORAGE_LAST_FETCH_TIME_KEY));
  const isStaleOverTwoMinutes =
    hasFetchedHistory &&
    (hasStartedAnalysis || estimatorOutput !== null) &&
    elapsedSinceLastFetch >= STALE_DATA_TIMEOUT_SECONDS &&
    elapsedSinceLastFetch < FORTY_MINUTES_TIMEOUT_SECONDS;

  // Restore analysis state & cached output from localStorage on initial mount and sync from server (Cloud-First Hydration)
  useEffect(() => {
    recordVisitorSession();

    // 實作「雲端優先水合 (Cloud-First Hydration)」機制：啟動時立即強制全量雙向水合
    performBidirectionalCloudSync().catch(() => {});

    // 跨後端/跨裝置全域設定、金鑰、資料集與模型權重每 50 秒自動輪詢 Polling
    const syncAllFromCloud = () => {
      performBidirectionalCloudSync().catch(() => {});
    };

    const pollInterval = setInterval(syncAllFromCloud, 50000); // 每 50 秒自動同步一次

    // 監聽全域模型與資料集變更，確保當雲端資料到達時立即觸發 React 重新渲染
    const unsubModel = subscribeModelChanges(() => {
      // 模型權重已水合至記憶體快取
    });
    const unsubDataset = subscribeDatasetChanges(() => {
      // 資料集已水合至記憶體快取
    });

    try {
      const elapsed = computeElapsedSeconds();
      const hasLastFetch = Boolean(localStorage.getItem(STORAGE_LAST_FETCH_TIME_KEY));
      // 若距前次獲取數據已超過 40 分鐘，清空快取
      if (hasLastFetch && elapsed >= FORTY_MINUTES_TIMEOUT_SECONDS) {
        localStorage.removeItem(STORAGE_HAS_STARTED_KEY);
        localStorage.removeItem(STORAGE_LAST_OUTPUT_KEY);
        setHasStartedAnalysis(false);
        setAnalysisProgress(0);
        setEstimatorOutput(null);
        return;
      }

      const cachedStarted = localStorage.getItem(STORAGE_HAS_STARTED_KEY);
      const cachedOutput = localStorage.getItem(STORAGE_LAST_OUTPUT_KEY);
      if (cachedStarted === "true") {
        setHasStartedAnalysis(true);
        setAnalysisProgress(100);
      }
      if (cachedOutput && !estimatorOutput) {
        const parsed = JSON.parse(cachedOutput);
        setEstimatorOutput(parsed);
      }
    } catch (err) {
      console.warn("Could not parse cached traffic state", err);
    }

    return () => {
      clearInterval(pollInterval);
      unsubModel();
      unsubDataset();
    };
  }, []);

  // Hardware clock synchronized loop (cooldown & timer tracking)
  useEffect(() => {
    const updateTick = () => {
      const remaining = computeRemainingCooldown();
      setCooldown(remaining);
      const elapsed = computeElapsedSeconds();
      setElapsedSinceLastFetch(elapsed);

      // 若快取超過 40 分鐘，自動重置分析快取（絕不強制切換使用者的頁面分頁）
      const hasLastFetch = Boolean(localStorage.getItem(STORAGE_LAST_FETCH_TIME_KEY));
      if (hasLastFetch && elapsed >= FORTY_MINUTES_TIMEOUT_SECONDS) {
        if (hasStartedAnalysis || estimatorOutput !== null) {
          setHasStartedAnalysis(false);
          setAnalysisProgress(0);
          setEstimatorOutput(null);
          try {
            localStorage.removeItem(STORAGE_HAS_STARTED_KEY);
            localStorage.removeItem(STORAGE_LAST_OUTPUT_KEY);
          } catch {}
        }
      }
    };

    updateTick();
    const interval = setInterval(updateTick, 1000);
    return () => clearInterval(interval);
  }, [hasStartedAnalysis, estimatorOutput]);

  // 全域快捷鍵 ⌘K / Ctrl+K 開啟搜尋
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelectSearchResult = (result: SearchResultItem) => {
    if (result.direction && result.direction !== direction) {
      handleDirectionChange(result.direction);
    }
    if (result.tabTarget) {
      setActiveTab(result.tabTarget);
    }
    showToast(`已跳轉至「${result.title}」`, "emerald");
  };

  // Backend Admin Authentication & Advanced Settings Modals
  const [isAdminAuth, setIsAdminAuth] = useState<boolean>(isAdminAuthenticated());
  const [isAdminSettingsOpen, setIsAdminSettingsOpen] = useState<boolean>(false);
  const [authPromptState, setAuthPromptState] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    callback: () => void;
  }>({
    isOpen: false,
    title: "",
    description: "",
    callback: () => {},
  });

  // Subscribe to Admin Auth status
  useEffect(() => {
    const unsub = subscribeAdminAuth((auth) => {
      setIsAdminAuth(auth);
    });
    return unsub;
  }, []);

  const handleRequireAuthPrompt = (
    title: string,
    description: string,
    callback: () => void
  ) => {
    if (isAdminAuthenticated()) {
      callback();
    } else {
      setAuthPromptState({
        isOpen: true,
        title,
        description,
        callback,
      });
    }
  };

  const handleOpenAdminSettings = () => {
    if (isAdminAuthenticated()) {
      setIsAdminSettingsOpen(true);
    } else {
      handleRequireAuthPrompt(
        "解鎖後台管理系統",
        "後台管理控制台包含資料庫維護、模型在線微調與 TDX 金鑰配置。請輸入後台管理密碼以進行解鎖。",
        () => {
          setIsAdminSettingsOpen(true);
        }
      );
    }
  };

  const showToast = (message: string, type: "emerald" | "rose" | "amber" = "emerald") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // Fetch Live TDX VD Data and Run Traffic State Estimation
  // Strictly enforces hardware-persisted dynamic cooldown rate limiting per device
  const fetchTdxAndEstimate = async (targetDir: Direction = direction) => {
    const currentRemainingCooldown = computeRemainingCooldown();
    if (currentRemainingCooldown > 0) {
      setCooldown(currentRemainingCooldown);
      showToast(`本機設備冷卻限制中：請等待 ${currentRemainingCooldown} 秒後方可再次更新分析`, "amber");
      return;
    }

    if (isLoading) return;

    setIsLoading(true);
    setTdxError(null);
    setHasStartedAnalysis(true);
    setAnalysisProgress(100);

    // Calculate dynamic cooldown (90s base, 150s if 3+ requests within 3 minutes)
    const cooldownSec = getNextCooldownDuration();
    const fetchTimestampMs = Date.now();
    const lockUntil = fetchTimestampMs + cooldownSec * 1000;

    // Persist timestamp immediately to prevent page reload bypass
    try {
      localStorage.setItem(STORAGE_LAST_FETCH_TIME_KEY, fetchTimestampMs.toString());
      localStorage.setItem(STORAGE_KEY_LOCK_UNTIL, lockUntil.toString());
      localStorage.setItem(STORAGE_HAS_STARTED_KEY, "true");
    } catch {}
    setCooldown(cooldownSec);
    setElapsedSinceLastFetch(0);

    try {
      const targetApiUrl = getResolvedApiUrl("freewayVd");
      let rawPayload: any;

      if (targetApiUrl.includes("transportdata.tw") || !targetApiUrl.startsWith("http")) {
        // 使用前端 TDX 官方直連模組 (自動金鑰輪轉、Token 快取與容錯重試)
        rawPayload = await fetchDirectFreewayVd(
          targetApiUrl.startsWith("http") ? targetApiUrl : undefined
        );
      } else {
        // 自訂外部 API 端點呼叫
        const targetHeaders = getResolvedApiHeaders();
        const response = await fetch(targetApiUrl, {
          method: "GET",
          headers: targetHeaders,
        });

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.toLowerCase().includes("json");

        if (!response.ok) {
          let errDetail = "";
          if (isJson) {
            try {
              const errJson = await response.json();
              errDetail = errJson.error_description || errJson.error || errJson.message || JSON.stringify(errJson);
            } catch {
              errDetail = `HTTP ${response.status} ${response.statusText}`;
            }
          } else {
            const raw = await response.text().catch(() => "");
            errDetail = raw.includes("<!DOCTYPE") || raw.includes("<html")
              ? "端點回傳 404 HTML 頁面 (找不到 API 路由)"
              : raw.slice(0, 150);
          }
          throw new Error(`API 連線異常 (HTTP ${response.status})：${errDetail}`);
        }

        if (!isJson) {
          throw new Error(`API 端點回傳非 JSON 格式 (${contentType})`);
        }

        rawPayload = await response.json();
      }

      // Execute traffic state estimation without modifying any math
      const output = runVdTrafficEstimator(rawPayload, targetDir, 18);

      if (output.raw_api.records.length === 0) {
        throw new Error("官方 TDX 伺服器目前未回傳雪山隧道車輛偵測器數據");
      }

      // 同步獲取 ETC 門架旅行時間 (真值)，啟動空間解耦反向傳播
      let etcTravelTimeSec: number | undefined = undefined;
      try {
        const [etcRaw, incidentRaw, rampMeterRaw] = await Promise.allSettled([
          fetchEtcTravelTimeData(),
          fetchFreewayIncidents(),
          fetchRampMeteringData(),
        ]);

        if (etcRaw.status === "fulfilled" && etcRaw.value) {
          const list = Array.isArray(etcRaw.value) ? etcRaw.value : etcRaw.value.TravelTimes || etcRaw.value.LiveTravelTimes || [];
          for (const item of list) {
            const val = item.TravelTime ?? item.SectionTravelTime ?? item.ActualTravelTime;
            if (typeof val === "number" && val > 0) {
              etcTravelTimeSec = val;
              break;
            }
          }
        }

        const incidents = incidentRaw.status === "fulfilled" && Array.isArray(incidentRaw.value) ? incidentRaw.value : [];
        const meters = rampMeterRaw.status === "fulfilled" && Array.isArray(rampMeterRaw.value) ? rampMeterRaw.value : [];

        if (output?.estimated_state) {
          const enrichedMetering = evaluateFreeway5MeteringSystem(
            output.raw_api.records || [],
            incidents,
            output.estimated_state.travelTimeSec,
            meters
          );
          output.estimated_state.comprehensiveMeteringState = enrichedMetering;
        }
      } catch (etcErr) {
        console.warn("ETC / Metering / Incidents Sync Notice:", etcErr);
      }

      // Automatically incorporate detection data into dataset on each analysis with ETC ground truth
      const { totalCount } = captureDetectionToDataset(output, targetDir, etcTravelTimeSec);

      // 非同步觸發 Redis 雲端延遲結算機制 (Time-Aligned Lazy Reconciliation)
      if (output?.estimated_state?.travelTimeSec) {
        postPredictionToReconcile(output.estimated_state.travelTimeSec, getLearnedParameters()).catch(() => {});
      }
      if (etcTravelTimeSec && etcTravelTimeSec > 0) {
        triggerLazyReconciliation(etcTravelTimeSec).catch(() => {});
      }

      // Record visitor trajectory snapshot for 3-hour trend rolling window
      recordVisitorTrafficTrajectory(output);

      setEstimatorOutput(output);
      try {
        localStorage.setItem(STORAGE_LAST_OUTPUT_KEY, JSON.stringify(output));
      } catch {}
      setTdxError(null);
      showToast(`已成功同步 TDX 官方數據並自動收錄至資料集 (目前累計 ${totalCount} 筆)`, "emerald");
    } catch (err: any) {
      console.error("TDX Fetch Failed:", err);
      const errMsg =
        typeof err === "string"
          ? err
          : err?.message
          ? err.message
          : typeof err === "object"
          ? (err.error_description || err.error || JSON.stringify(err))
          : "官方 TDX 伺服器連線失敗或回應超時，暫無法取得即時路況";
      setTdxError(errMsg);
      showToast(errMsg, "rose");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Direction Change
  const handleDirectionChange = (newDir: Direction) => {
    if (newDir === direction || isLoading) return;
    setDirection(newDir);

    // If we already have estimator output, re-filter for the new direction immediately
    if (estimatorOutput) {
      const payloadToUse = estimatorOutput.raw_api.rawPayload || estimatorOutput.raw_api.records;
      const recomputed = runVdTrafficEstimator(payloadToUse, newDir, 18);
      captureDetectionToDataset(recomputed, newDir);
      setEstimatorOutput(recomputed);
    } else if (hasStartedAnalysis && cooldown === 0) {
      fetchTdxAndEstimate(newDir);
    }
  };

  // 切換乘車方式
  const handleSelectVehicleMode = (mode: VehicleTransitMode) => {
    setSelectedVehicleMode(mode);
    try {
      localStorage.setItem(STORAGE_VEHICLE_MODE_KEY, mode);
    } catch {}
    const modeMap: Record<VehicleTransitMode, string> = {
      car: "🚗 自駕小客車",
      bus: "🚌 國道大客車／公路客運",
      taxi: "🚕 計程車／多元運具",
    };
    showToast(`已切換乘車方式為【${modeMap[mode]}】`, "emerald");
  };

  // 選取特定路線
  const handleSelectRoute = (originKm: number, destKm: number, label?: string) => {
    const isSouth = destKm >= originKm;
    const newDir: Direction = isSouth ? "S" : "N";
    if (newDir !== direction) {
      handleDirectionChange(newDir);
    }
    const routeLabel = label || `${originKm.toFixed(1)}K ↔ ${destKm.toFixed(1)}K`;
    setSelectedRoute({ originKm, destKm, label: routeLabel });
    showToast(`已選擇路線【${routeLabel}】`, "emerald");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-emerald-500/20">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-md ${
              toast.type === "emerald"
                ? "bg-emerald-900 text-white border-emerald-700"
                : toast.type === "rose"
                ? "bg-rose-900 text-white border-rose-700"
                : "bg-amber-900 text-white border-amber-700"
            }`}
          >
            {toast.type === "emerald" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0" />
            )}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header & Mobile Nav */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isLiveTdx={!tdxError}
        isAdminAuth={isAdminAuth}
        onOpenAdminSettings={handleOpenAdminSettings}
        direction={direction}
        onDirectionChange={handleDirectionChange}
        onRefresh={() => fetchTdxAndEstimate(direction)}
        isLoading={isLoading}
        cooldown={cooldown}
        onOpenSearch={() => setIsSearchOpen(true)}
        isStaleOverTwoMinutes={isStaleOverTwoMinutes}
        selectedVehicleMode={selectedVehicleMode}
        onSelectVehicleMode={handleSelectVehicleMode}
        onSelectRoute={handleSelectRoute}
      />

      {/* Main Container (Clean White Theme Layout with Mobile Bottom Nav Padding) */}
      <main className="max-w-[1600px] w-full mx-auto px-3 sm:px-4 py-3 sm:py-5 pb-24 md:pb-8 space-y-4 sm:space-y-5 flex-1">
        {/* Error Message when TDX connection fails */}
        {tdxError && (
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3.5 text-rose-800">
            <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-bold text-sm text-rose-900">
                交通部 TDX 官方伺服器連線異常
              </div>
              <p className="text-rose-700 leading-relaxed">{tdxError}</p>
              <p className="text-rose-600 text-[11px] pt-1">
                系統已依規範停止模擬假資料，待冷卻倒數完成後可點擊「更新路況」再次嘗試連線。
              </p>
            </div>
          </div>
        )}

        {/* TAB 1: 雪隧與車道指引 (GIS 地圖 + 車道推薦 + 剖面圖) */}
        {activeTab === "lane" && (
          <div className="space-y-4">
            {/* 頂部核心主按鈕列：按我分析哪一邊車道比較快 (Always at the top) */}
            <div className="bg-white border border-slate-200 p-4 sm:p-5 rounded-3xl shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* 方向選擇切換 */}
              <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 text-xs font-bold shrink-0 self-start sm:self-auto">
                <button
                  onClick={() => handleDirectionChange("S")}
                  className={`px-3.5 py-2 rounded-xl transition cursor-pointer ${
                    direction === "S"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  南向往宜蘭 (S)
                </button>
                <button
                  onClick={() => handleDirectionChange("N")}
                  className={`px-3.5 py-2 rounded-xl transition cursor-pointer ${
                    direction === "N"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  北向往台北 (N)
                </button>
              </div>

              {/* 核心主按鈕：TrafficRefreshControl 最佳化頻寬保護（隨機抖動 Jitter + 階梯式動態退避 Dynamic Backoff） */}
              <div className="w-full sm:flex-1 sm:max-w-md">
                <TrafficRefreshControl
                  onFetchData={() => fetchTdxAndEstimate(direction)}
                  isLoading={isLoading}
                  cooldown={cooldown}
                  buttonText="按我分析哪一邊車道比較快"
                />
              </div>
            </div>

            {/* 若超過 2 分鐘未更新即時數據，跳轉至更新待命畫面 */}
            {isStaleOverTwoMinutes ? (
              <TwoMinuteStalePrompt
                direction={direction}
                onDirectionChange={handleDirectionChange}
                onRefresh={() => fetchTdxAndEstimate(direction)}
                isLoading={isLoading}
                cooldown={cooldown}
                elapsedSeconds={elapsedSinceLastFetch}
              />
            ) : !hasStartedAnalysis && !estimatorOutput ? (
              <TunnelEntranceCover
                direction={direction}
                estimatorOutput={estimatorOutput}
                onStartAnalysis={() => fetchTdxAndEstimate(direction)}
                isLoading={isLoading}
                selectedVehicleMode={selectedVehicleMode}
                onSelectVehicleMode={handleSelectVehicleMode}
              />
            ) : (
              <div className="space-y-4">
                {/* 隧道大尺寸標準橫斷面（剖面圖）＋ 頂部直接流速結論 */}
                <TunnelCrossSectionView
                  direction={direction}
                  estimatorOutput={estimatorOutput}
                  onDirectionChange={(newDir) => handleDirectionChange(newDir)}
                  onRefresh={() => fetchTdxAndEstimate(direction)}
                  isLoading={isLoading}
                />

                {/* GIS Map & Lane Guidance Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left: GIS Tunnel Map */}
                  <div className="lg:col-span-7 xl:col-span-8 space-y-4">
                    <TunnelGisMap
                      estimatorOutput={estimatorOutput}
                      currentDirection={direction}
                      onDirectionChange={(newDir) => handleDirectionChange(newDir)}
                    />
                  </div>

                  {/* Right: Smart Lane Recommendation */}
                  <div className="lg:col-span-5 xl:col-span-4 space-y-4">
                    {estimatorOutput && (
                      <SimpleLaneRecommendation
                        estimatorOutput={estimatorOutput}
                        direction={direction}
                        onOpenAdvanced={() => setIsAdvancedOpen(true)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: 國5全線 0K~54K 走廊即時監控 */}
        {activeTab === "corridor" && (
          <div className="space-y-5">
            {isStaleOverTwoMinutes && (
              <TwoMinuteStalePrompt
                direction={direction}
                onDirectionChange={handleDirectionChange}
                onRefresh={() => fetchTdxAndEstimate(direction)}
                isLoading={isLoading}
                cooldown={cooldown}
                elapsedSeconds={elapsedSinceLastFetch}
              />
            )}
            <CorridorMonitor
              estimatorOutput={estimatorOutput}
              direction={direction}
              onDirectionChange={handleDirectionChange}
              onStartAnalysis={() => fetchTdxAndEstimate(direction)}
              onRefresh={() => fetchTdxAndEstimate(direction)}
              isLoading={isLoading}
              cooldown={cooldown}
              onSelectRouteForDeparture={(originKm, destKm, label) => {
                handleSelectRoute(originKm, destKm, label);
              }}
            />
          </div>
        )}

        {/* TAB 3: 最佳出發時間推薦 (Launch Time Calculator) */}
        {activeTab === "departure" && (
          <div className="space-y-5">
            {isStaleOverTwoMinutes && (
              <TwoMinuteStalePrompt
                direction={direction}
                onDirectionChange={handleDirectionChange}
                onRefresh={() => fetchTdxAndEstimate(direction)}
                isLoading={isLoading}
                cooldown={cooldown}
                elapsedSeconds={elapsedSinceLastFetch}
              />
            )}
            <DepartureTimeRecommender
              estimatorOutput={estimatorOutput}
              direction={direction}
              onDirectionChange={handleDirectionChange}
              onStartAnalysis={() => fetchTdxAndEstimate(direction)}
              onRefresh={() => fetchTdxAndEstimate(direction)}
              isLoading={isLoading}
              cooldown={cooldown}
              onSelectRoute={(originKm, destKm, label) => {
                handleSelectRoute(originKm, destKm, label);
              }}
            />
          </div>
        )}

        {/* TAB: 國5北向 匝道儀控與號誌管制 */}
        {(activeTab === "metering" || activeTab === "theory") && (
          <div className="space-y-5">
            {isStaleOverTwoMinutes && (
              <TwoMinuteStalePrompt
                direction={direction}
                onDirectionChange={handleDirectionChange}
                onRefresh={() => fetchTdxAndEstimate(direction)}
                isLoading={isLoading}
                cooldown={cooldown}
                elapsedSeconds={elapsedSinceLastFetch}
              />
            )}
            <RampMeterPulseMeter
              estimatorOutput={estimatorOutput}
              direction={direction}
            />
          </div>
        )}


        {/* 備用 / 資料庫管理 (已整併至後台管理系統) */}
        {activeTab === "dataset" && (
          <DatasetRepositoryView
            onRefresh={() => fetchTdxAndEstimate(direction)}
            onRequireAuthPrompt={handleRequireAuthPrompt}
          />
        )}

        {/* TAB 5: Surveillance Camera Wall (即時監視器) */}
        {activeTab === "cctv" && <CctvWall currentDirection={direction} />}
      </main>

      {/* 頁面最底部精巧的系統運作狀態指示 */}
      <SystemStatusFooter />

      {/* Advanced Engineering / Theory Modal */}
      {estimatorOutput && (
        <AdvancedAnalysisModal
          isOpen={isAdvancedOpen}
          onClose={() => setIsAdvancedOpen(false)}
          estimatorOutput={estimatorOutput}
          direction={direction}
          onRequireAuthPrompt={handleRequireAuthPrompt}
        />
      )}

      {/* 後台管理與進階設定視窗 (Admin Advanced Settings Modal) */}
      <AdminAdvancedSettingsModal
        isOpen={isAdminSettingsOpen}
        onClose={() => setIsAdminSettingsOpen(false)}
        onRequireAuthPrompt={handleRequireAuthPrompt}
      />

      {/* 後台密碼授權視窗 (Backend Auth Modal) */}
      <BackendAuthModal
        isOpen={authPromptState.isOpen}
        onClose={() => setAuthPromptState((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={() => {
          setAuthPromptState((prev) => ({ ...prev, isOpen: false }));
          showToast("✓ 後台授權成功！權限已解鎖。", "emerald");
          authPromptState.callback();
        }}
        actionTitle={authPromptState.title}
        actionDescription={authPromptState.description}
      />

      {/* 全站關鍵字搜尋視窗 (Global Keyword Search Modal) */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectResult={handleSelectSearchResult}
        currentDirection={direction}
      />
    </div>
  );
}

