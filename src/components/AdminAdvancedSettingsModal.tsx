import React, { useState, useEffect } from "react";
import {
  Settings,
  ShieldCheck,
  Lock,
  Unlock,
  Database,
  Cpu,
  Key,
  Trash2,
  RotateCcw,
  Play,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  Sliders,
  Sparkles,
  Server,
  Layers,
  Activity,
  Globe,
  Radio,
  Link2,
  ArrowRightLeft,
  Terminal,
  Loader2,
  ExternalLink,
  HelpCircle,
  Users,
  Plus,
  TrendingUp,
  UserCheck,
  BarChart3,
  ArrowUpRight,
  Hash,
  Clock,
  Square,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  isAdminAuthenticated,
  logoutAdmin,
  ADMIN_PASSWORD,
} from "../services/adminAuth";
import {
  getStoredDataset,
  resetDataset,
  clearAllDataset,
  exportDatasetToCsv,
  deleteDatasetRecord,
} from "../services/datasetRepository";
import {
  getLearnedParameters,
  trainModelOnDataset,
  resetParametersToBaseline,
} from "../estimator/modelTrainingEngine";
import {
  LearnedModelParameters,
  CapturedDatasetRecord,
  Direction,
} from "../types";
import {
  globalAutoTrainingCollector,
  AutoCollectionState,
  AutoCollectionConfig,
} from "../services/autoTrainingCollector";
import {
  getApiConfig,
  saveApiConfig,
  resetApiConfig,
  testApiEndpointConnection,
  ApiEndpointConfig,
  DEFAULT_API_CONFIG,
  getResolvedApiUrl,
} from "../services/apiConfig";
import { globalTdxKeyManager } from "../services/tdxKeyRotator";
import {
  getVisitorStats,
  increaseVisitorCount,
  setCustomVisitorCount,
  resetVisitorCount,
  VisitorStatsData,
} from "../services/visitorStats";

interface AdminAdvancedSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
  onRequireAuthPrompt?: (title: string, desc: string, callback: () => void) => void;
}

export default function AdminAdvancedSettingsModal({
  isOpen,
  onClose,
  onDataChanged,
  onRequireAuthPrompt,
}: AdminAdvancedSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"database" | "model" | "tdx" | "visitors" | "security">("database");
  const [isAuth, setIsAuth] = useState(isAdminAuthenticated());
  const [dataset, setDataset] = useState<CapturedDatasetRecord[]>([]);
  const [learnedParams, setLearnedParams] = useState<LearnedModelParameters>(getLearnedParameters());
  const [visitorStats, setVisitorStats] = useState<VisitorStatsData>(getVisitorStats());
  const [customIncrement, setCustomIncrement] = useState<string>("100");
  const [customTotal, setCustomTotal] = useState<string>("");
  const [tdxClientId, setTdxClientId] = useState(
    localStorage.getItem("TDX_CLIENT_ID") || ""
  );
  const [tdxClientSecret, setTdxClientSecret] = useState(
    localStorage.getItem("TDX_CLIENT_SECRET") || ""
  );
  const [apiConfig, setApiConfig] = useState<ApiEndpointConfig>(getApiConfig());
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [testApiResult, setTestApiResult] = useState<{
    success: boolean;
    status: number;
    message: string;
    dataPreview?: string;
    latencyMs: number;
  } | null>(null);

  const [statusNotice, setStatusNotice] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [isTraining, setIsTraining] = useState(false);

  // 定時自動取樣與連續在線訓練狀態 (限後台)
  const [autoCollectorState, setAutoCollectorState] = useState<AutoCollectionState>(
    globalAutoTrainingCollector.getState()
  );
  const [autoIntervalSec, setAutoIntervalSec] = useState<number>(
    autoCollectorState.config.intervalSec || 60
  );
  const [autoDurationMin, setAutoDurationMin] = useState<number>(
    autoCollectorState.config.durationMinutes || 120
  );
  const [autoTargetDir, setAutoTargetDir] = useState<"BOTH" | "S" | "N">(
    autoCollectorState.config.targetDirection || "BOTH"
  );
  const [autoTrainAfterCapture, setAutoTrainAfterCapture] = useState<boolean>(
    autoCollectorState.config.autoTrainAfterCapture !== false
  );

  const reloadData = () => {
    setIsAuth(isAdminAuthenticated());
    setDataset(getStoredDataset());
    setLearnedParams(getLearnedParameters());
    setVisitorStats(getVisitorStats());
    setTdxClientId(localStorage.getItem("TDX_CLIENT_ID") || "");
    setTdxClientSecret(localStorage.getItem("TDX_CLIENT_SECRET") || "");
    setApiConfig(getApiConfig());
    setTestApiResult(null);
    setAutoCollectorState(globalAutoTrainingCollector.getState());
  };

  useEffect(() => {
    // 訂閱定時取樣引擎狀態
    const unsubscribe = globalAutoTrainingCollector.subscribe((newState) => {
      setAutoCollectorState(newState);
    });

    const handleDatasetUpdated = () => {
      setDataset(getStoredDataset());
      setLearnedParams(getLearnedParameters());
      onDataChanged?.();
    };

    window.addEventListener("hsuehshan-dataset-updated", handleDatasetUpdated);

    return () => {
      unsubscribe();
      window.removeEventListener("hsuehshan-dataset-updated", handleDatasetUpdated);
    };
  }, [onDataChanged]);

  useEffect(() => {
    if (isOpen) {
      reloadData();
      setStatusNotice(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showNotice = (msg: string, type: "success" | "error" = "success") => {
    setStatusNotice({ msg, type });
    setTimeout(() => setStatusNotice(null), 4000);
  };

  // 守護函式：確保只有後台才能執行任何變更動作
  const executeGuardedAction = (
    actionName: string,
    actionDesc: string,
    actionFn: () => void
  ) => {
    if (isAdminAuthenticated()) {
      actionFn();
    } else if (onRequireAuthPrompt) {
      onRequireAuthPrompt(actionName, actionDesc, () => {
        setIsAuth(true);
        actionFn();
      });
    } else {
      showNotice("權限不足：此變更動作只有後台才能執行 (請先登入後台)。", "error");
    }
  };

  // 1. 資料庫變更動作 (Database Actions)
  const handleResetDataset = () => {
    executeGuardedAction(
      "重設資料庫為種子預設",
      "此動作將還原資料集庫為預設的國道5號與雪隧實測歷史資料。",
      () => {
        const resetData = resetDataset();
        setDataset(resetData);
        showNotice("✓ 資料庫已成功重設為初始種子歷史基準！");
        onDataChanged?.();
      }
    );
  };

  const handleClearAllDataset = () => {
    executeGuardedAction(
      "徹底清空資料庫",
      "此動作將刪除目前本機儲存的所有偵測紀錄，清空後將無法復原。",
      () => {
        const cleared = clearAllDataset();
        setDataset(cleared);
        showNotice("✓ 已徹底清空資料庫所有紀錄！");
        onDataChanged?.();
      }
    );
  };

  const handleDeleteRecord = (id: string) => {
    executeGuardedAction(
      "刪除單筆資料紀錄",
      `確定要從資料庫中刪除紀錄 ${id} 嗎？`,
      () => {
        const updated = deleteDatasetRecord(id);
        setDataset(updated);
        showNotice(`✓ 已成功刪除紀錄 ${id}`);
        onDataChanged?.();
      }
    );
  };

  // 2. 機器學習模型訓練與自動定時取樣 (Model Training & Auto Sampling Actions)
  const handleStartAutoCollector = () => {
    const validInterval = Math.max(10, Number(autoIntervalSec) || 60);
    const validDuration = Math.max(0, Number(autoDurationMin) || 0);

    executeGuardedAction(
      "啟動定時自動取樣與在線訓練 (限後台)",
      `此動作將在後台自動每 ${validInterval} 秒向 TDX 抓取一次真實路況並寫入資料庫，持續 ${
        validDuration > 0 ? `${validDuration} 分鐘` : "不限時間（直到電腦關閉或手動停止）"
      }。`,
      () => {
        globalAutoTrainingCollector.start({
          intervalSec: validInterval,
          durationMinutes: validDuration,
          targetDirection: autoTargetDir,
          autoTrainAfterCapture: autoTrainAfterCapture,
        });
        showNotice(
          `✓ 已成功啟動定時自動取樣：每 ${validInterval} 秒寫入一筆，電腦不關將持續在線採集與訓練！`
        );
      }
    );
  };

  const handleStopAutoCollector = () => {
    executeGuardedAction(
      "停止定時自動取樣 (限後台)",
      "此動作將終止背景定時寫入與在線微調任務。",
      () => {
        globalAutoTrainingCollector.stop();
        showNotice("✓ 已停止定時自動取樣與連續在線訓練任務。");
      }
    );
  };

  const handleSingleCaptureNow = async () => {
    executeGuardedAction(
      "立即單次取樣寫入 1 筆 (限後台)",
      "此動作將立即抓取一筆即時 TDX 數據、執行空間微元積分並寫入資料庫。",
      async () => {
        showNotice("正在連線 TDX 執行即時單次取樣...");
        const res = await globalAutoTrainingCollector.executeSingleSamplingStep();
        if (res.success) {
          showNotice(`✓ 成功手動取樣並寫入 1 筆紀錄 (ID: ${res.recordId})！`);
          setDataset(getStoredDataset());
          setLearnedParams(getLearnedParameters());
          onDataChanged?.();
        } else {
          showNotice(`✕ 取樣失敗：${res.message}`, "error");
        }
      }
    );
  };

  const handleRunTraining = async () => {
    executeGuardedAction(
      "執行機器學習 10 Epochs 訓練",
      "此動作將使用資料庫樣本執行多目標梯度下降，校準車道切換門檻與時空波速。",
      async () => {
        setIsTraining(true);
        setStatusNotice(null);
        await new Promise((r) => setTimeout(r, 400));
        const { optimizedParams } = trainModelOnDataset(dataset, 10);
        setLearnedParams(optimizedParams);
        setIsTraining(false);
        showNotice(
          `✓ 模型訓練完成！車道切換門檻已動態收斂至 ${optimizedParams.laneSwitchMarginSec.toFixed(1)} 秒。`
        );
        onDataChanged?.();
      }
    );
  };

  const handleResetModelBaseline = () => {
    executeGuardedAction(
      "重設模型為物理基準",
      "此動作將清除已訓練的動態權重，還原為初始流體力學物理常數。",
      () => {
        const resetP = resetParametersToBaseline();
        setLearnedParams(resetP);
        showNotice("✓ 機器學習權重與車道切換參數已還原至物理基準！");
        onDataChanged?.();
      }
    );
  };

  // 3. API 路由與端點對齊設定 (API Alignment & Renaming)
  const handleSaveApiConfig = () => {
    executeGuardedAction(
      "儲存 API 路由與端點對齊設定",
      "此動作將更新系統呼叫的 API 端點路徑、Base URL 及鑑權 Headers，使其與外部網站完全對齊。",
      () => {
        saveApiConfig(apiConfig);
        showNotice("✓ API 路由與端點命名已成功儲存並生效！");
        onDataChanged?.();
      }
    );
  };

  const handleResetApiConfig = () => {
    executeGuardedAction(
      "還原為預設 API 端點",
      "此動作將清除自訂端點命名，還原為系統標準 TDX 端點路徑。",
      () => {
        const def = resetApiConfig();
        setApiConfig(def);
        setTestApiResult(null);
        showNotice("✓ API 端點已還原為標準預設值。");
        onDataChanged?.();
      }
    );
  };

  const handleTestApiConnection = async () => {
    setIsTestingApi(true);
    setTestApiResult(null);

    const targetUrl = getResolvedApiUrl("freewayVd");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiConfig.customAuthHeaderName && apiConfig.customAuthHeaderValue) {
      headers[apiConfig.customAuthHeaderName] = apiConfig.customAuthHeaderValue;
    }
    if (apiConfig.customApiKeyHeaderName && apiConfig.customApiKeyHeaderValue) {
      headers[apiConfig.customApiKeyHeaderName] = apiConfig.customApiKeyHeaderValue;
    }

    try {
      const res = await testApiEndpointConnection(targetUrl, headers);
      setTestApiResult(res);
      if (res.success) {
        showNotice(`✓ API 連線測試成功 (HTTP ${res.status})！延遲 ${res.latencyMs}ms`);
      } else {
        showNotice(`API 連線測試失敗：${res.message}`, "error");
      }
    } catch (err: any) {
      setTestApiResult({
        success: false,
        status: 0,
        message: err.message || "連線測試異常",
        latencyMs: 0,
      });
      showNotice("連線測試異常", "error");
    } finally {
      setIsTestingApi(false);
    }
  };

  // 4. TDX 金鑰儲存與變更 (TDX Key Settings)
  const handleSaveTdx = () => {
    executeGuardedAction(
      "儲存 TDX 官方金鑰憑證",
      "此動作將寫入自訂的 TDX Client ID 與 Client Secret。",
      () => {
        try {
          localStorage.setItem("TDX_CLIENT_ID", tdxClientId.trim());
          localStorage.setItem("TDX_CLIENT_SECRET", tdxClientSecret.trim());
          globalTdxKeyManager.reloadKeys();
          showNotice("✓ TDX 金鑰已成功儲存並同步更新連線池！");
          onDataChanged?.();
        } catch {
          showNotice("儲存金鑰失敗", "error");
        }
      }
    );
  };

  const handleClearTdx = () => {
    executeGuardedAction(
      "清除 TDX 金鑰憑證",
      "此動作將清除自訂的 TDX 金鑰，系統將回退至伺服器全自動輪轉池。",
      () => {
        localStorage.removeItem("TDX_CLIENT_ID");
        localStorage.removeItem("TDX_CLIENT_SECRET");
        globalTdxKeyManager.reloadKeys();
        setTdxClientId("");
        setTdxClientSecret("");
        showNotice("✓ 自訂 TDX 金鑰已清除，回退至系統輪轉池。");
        onDataChanged?.();
      }
    );
  };

  // 5. 進入人數與訪客流量調整函式 (Visitor Statistics Actions)
  const handleQuickIncrease = (amount: number) => {
    executeGuardedAction(
      `增加進入人數 +${amount} 人`,
      `此動作將直接於後台增加 +${amount.toLocaleString()} 人至全站累積進入人數與今日進入人數。`,
      () => {
        const updated = increaseVisitorCount(amount);
        setVisitorStats(updated);
        showNotice(`✓ 成功增加 +${amount.toLocaleString()} 人！目前全站累積進入人數：${updated.totalEntered.toLocaleString()} 人`);
        onDataChanged?.();
      }
    );
  };

  const handleApplyCustomIncrement = () => {
    const inc = parseInt(customIncrement, 10);
    if (isNaN(inc) || inc <= 0) {
      showNotice("請輸入大於 0 的有效整數增量人數", "error");
      return;
    }
    executeGuardedAction(
      `增加自訂進入人數 +${inc.toLocaleString()} 人`,
      `此動作將直接增加 +${inc.toLocaleString()} 人至全站累積進入人數。`,
      () => {
        const updated = increaseVisitorCount(inc);
        setVisitorStats(updated);
        showNotice(`✓ 成功增加 +${inc.toLocaleString()} 人！目前全站累積進入人數：${updated.totalEntered.toLocaleString()} 人`);
        setCustomIncrement("");
        onDataChanged?.();
      }
    );
  };

  const handleApplyCustomTotal = () => {
    const total = parseInt(customTotal, 10);
    if (isNaN(total) || total < 0) {
      showNotice("請輸入有效的累積總進入人數", "error");
      return;
    }
    executeGuardedAction(
      `直接設定累積總進入人數為 ${total.toLocaleString()} 人`,
      `此動作將直接覆寫全站累積進入人數為 ${total.toLocaleString()} 人。`,
      () => {
        const updated = setCustomVisitorCount(total);
        setVisitorStats(updated);
        showNotice(`✓ 累積進入人數已更新為 ${updated.totalEntered.toLocaleString()} 人！`);
        setCustomTotal("");
        onDataChanged?.();
      }
    );
  };

  const handleResetVisitorBaseline = () => {
    executeGuardedAction(
      "重設進入人數為初始歷史基準",
      "此動作將還原全站累積進入人數與今日進入人數為初始種子基準。",
      () => {
        const reset = resetVisitorCount();
        setVisitorStats(reset);
        showNotice("✓ 進入人數已還原至初始歷史基準！");
        onDataChanged?.();
      }
    );
  };

  // 6. 後台登出
  const handleLogout = () => {
    logoutAdmin();
    setIsAuth(false);
    showNotice("已登出後台，目前處於前台唯讀模式。");
    onDataChanged?.();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: "spring", duration: 0.35 }}
          className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl z-10 text-slate-100 flex flex-col overflow-hidden"
        >
          {/* Top Bar */}
          <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Settings className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-black text-white">後台管理與進階設定中心</h2>
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 border ${
                      isAuth
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    }`}
                  >
                    {isAuth ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    <span>{isAuth ? "後台權限已解鎖" : "前台唯讀防護中"}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  所有可以更改、重設、微調訓練與刪除動作，均嚴格限定只有後台才能執行
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="關閉"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Status Alert Banner */}
          {statusNotice && (
            <div
              className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 border-b ${
                statusNotice.type === "success"
                  ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/80"
                  : "bg-rose-950/80 text-rose-300 border-rose-800/80"
              }`}
            >
              {statusNotice.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              )}
              <span>{statusNotice.msg}</span>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex items-center gap-1.5 p-3 bg-slate-950 border-b border-slate-800 overflow-x-auto text-xs font-bold">
            <button
              onClick={() => setActiveTab("database")}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                activeTab === "database"
                  ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <Database className="h-4 w-4" />
              <span>資料庫管理 (资料库)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-900/40 text-current font-mono">
                {dataset.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("model")}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                activeTab === "model"
                  ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <Cpu className="h-4 w-4" />
              <span>機器學習與車道模型 (進階設定)</span>
            </button>

            <button
              onClick={() => setActiveTab("tdx")}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                activeTab === "tdx"
                  ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <ArrowRightLeft className="h-4 w-4" />
              <span>API 路由對齊與金鑰</span>
            </button>

            <button
              onClick={() => setActiveTab("visitors")}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                activeTab === "visitors"
                  ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <Users className="h-4 w-4" />
              <span>進入人數與流量管理</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                {visitorStats.totalEntered.toLocaleString()} 人
              </span>
            </button>

            <button
              onClick={() => setActiveTab("security")}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                activeTab === "security"
                  ? "bg-amber-500 text-slate-950 font-black shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/60"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>後台安全與權限鎖定</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
            {/* TAB 1: 資料庫維護與管理 */}
            {activeTab === "database" && (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-950/80 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>資料集庫維護面板 (Dataset Operations)</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        累計 {dataset.length} 筆
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      提供資料清空、重設、匯出與單筆刪除管理；所有寫入與刪除動作僅限後台操作。
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportDatasetToCsv(dataset)}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      <span>匯出 CSV</span>
                    </button>

                    <button
                      onClick={handleResetDataset}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      title="還原為國5歷史種子資料"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>重設為種子庫</span>
                    </button>

                    <button
                      onClick={handleClearAllDataset}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      title="徹底清除全部資料集"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>徹底清空</span>
                    </button>
                  </div>
                </div>

                {/* 資料集表格預覽與單筆刪除 */}
                <div className="bg-slate-950/90 rounded-2xl border border-slate-800 overflow-hidden">
                  <div className="p-3 border-b border-slate-800 bg-slate-900/60 text-xs font-bold text-slate-300 flex justify-between items-center">
                    <span>資料庫紀錄清單 (點擊右側垃圾桶可刪除單筆紀錄)</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      格式：0K~54K 全線與雪隧實測
                    </span>
                  </div>

                  {dataset.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      目前資料庫為空。請點擊「重設為種子庫」或於前台點擊「更新路況」自動收錄。
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-900 text-slate-400 text-[11px] sticky top-0 font-sans border-b border-slate-800">
                          <tr>
                            <th className="py-2.5 px-3">時間 / ID</th>
                            <th className="py-2.5 px-3">方向</th>
                            <th className="py-2.5 px-3">等效速度</th>
                            <th className="py-2.5 px-3">推薦車道</th>
                            <th className="py-2.5 px-3">全線耗時</th>
                            <th className="py-2.5 px-3 text-right">後台刪除</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 text-slate-300">
                          {dataset.slice(0, 50).map((r) => (
                            <tr key={r.id} className="hover:bg-slate-900/60 transition">
                              <td className="py-2 px-3">
                                <div className="font-bold text-white font-sans">{r.timeFormatted}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{r.id}</div>
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded text-[10px] ${r.direction === "S" ? "bg-sky-950 text-sky-300" : "bg-emerald-950 text-emerald-300"}`}>
                                  {r.direction === "S" ? "南向往宜蘭" : "北向往台北"}
                                </span>
                              </td>
                              <td className="py-2 px-3 font-bold text-amber-300">
                                {r.tunnelEqSpeedKmh.toFixed(1)} km/h
                              </td>
                              <td className="py-2 px-3 font-sans text-xs">
                                {r.recommendedLane}
                              </td>
                              <td className="py-2 px-3">
                                {r.corridor0to54TravelTimeMin ?? r.corridor0to50TravelTimeMin} 分
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  onClick={() => handleDeleteRecord(r.id)}
                                  className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 text-rose-400 hover:text-white transition cursor-pointer"
                                  title={`刪除紀錄 ${r.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: 機器學習與模型微調 (進階設定) */}
            {activeTab === "model" && (
              <div className="space-y-6">
                {/* 核心區塊 1: 自動連續取樣與在線訓練控制台 (限後台) */}
                <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/40 p-5 rounded-3xl border-2 border-emerald-500/30 space-y-5 shadow-xl">
                  {/* 頂部狀態列 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                          AUTO DATASET SAMPLER & ONLINE ML
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 ${
                          autoCollectorState.isRunning
                            ? "bg-emerald-500 text-slate-950 animate-pulse"
                            : "bg-slate-800 text-slate-400"
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${autoCollectorState.isRunning ? "bg-slate-950" : "bg-slate-500"}`} />
                          {autoCollectorState.isRunning ? "🟢 自動取樣訓練中 (電腦不關)" : "⏸ 自動取樣未啟動"}
                        </span>
                      </div>
                      <h3 className="text-base font-black text-white mt-1 flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-emerald-400" />
                        <span>定時自動寫入資料庫與連續在線訓練 (限後台)</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        自訂採集頻率與持續時間，後台自動定時向 TDX 抓取真實路況並寫入資料庫，同時連續微調機器學習參數。
                      </p>
                    </div>

                    {/* 即時運行統計摘要 */}
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                      {autoCollectorState.isRunning ? (
                        <>
                          <div className="bg-slate-900/90 border border-emerald-500/40 px-3 py-2 rounded-xl">
                            <span className="text-[10px] text-slate-400 block font-sans">下次寫入倒數</span>
                            <span className="text-emerald-400 font-bold text-sm">
                              ⏳ {autoCollectorState.nextCountdownSec} 秒
                            </span>
                          </div>
                          <div className="bg-slate-900/90 border border-slate-700 px-3 py-2 rounded-xl">
                            <span className="text-[10px] text-slate-400 block font-sans">已持續時間</span>
                            <span className="text-white font-bold text-sm">
                              {Math.floor(autoCollectorState.elapsedSec / 60)} 分 {autoCollectorState.elapsedSec % 60} 秒
                            </span>
                          </div>
                          <div className="bg-slate-900/90 border border-slate-700 px-3 py-2 rounded-xl">
                            <span className="text-[10px] text-slate-400 block font-sans">本次寫入</span>
                            <span className="text-amber-300 font-bold text-sm">
                              +{autoCollectorState.totalCapturedInSession} 筆
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl text-slate-400 text-xs">
                          資料庫現有：<strong className="text-white font-bold">{dataset.length}</strong> / 500 筆
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 參數設定網格 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* 1. 多久寫入一筆 (取樣頻率) */}
                    <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-300 flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-amber-400" />
                          <span>1. 多久寫入一筆 (取樣頻率)：</span>
                        </label>
                        <span className="text-emerald-400 font-mono font-bold">{autoIntervalSec} 秒 / 筆</span>
                      </div>

                      {/* 快捷按鈕 */}
                      <div className="flex flex-wrap gap-1.5">
                        {[15, 30, 60, 120, 300, 600].map((sec) => (
                          <button
                            key={sec}
                            disabled={autoCollectorState.isRunning}
                            onClick={() => setAutoIntervalSec(sec)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                              autoIntervalSec === sec
                                ? "bg-emerald-500 text-slate-950 font-bold"
                                : "bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800"
                            } ${autoCollectorState.isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            {sec < 60 ? `${sec}秒` : `${sec / 60}分`}
                          </button>
                        ))}
                      </div>

                      {/* 自訂秒數輸入 */}
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-slate-400 text-[11px]">自訂秒數：</span>
                        <input
                          type="number"
                          min="10"
                          max="3600"
                          disabled={autoCollectorState.isRunning}
                          value={autoIntervalSec}
                          onChange={(e) => setAutoIntervalSec(Math.max(10, Number(e.target.value)))}
                          className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-mono text-xs w-28 focus:border-emerald-500 focus:outline-hidden disabled:opacity-50"
                        />
                        <span className="text-[11px] text-slate-500">秒 (最低 10 秒)</span>
                      </div>
                    </div>

                    {/* 2. 持續多久 (總運行時長) */}
                    <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-300 flex items-center gap-1.5">
                          <Activity className="h-4 w-4 text-cyan-400" />
                          <span>2. 持續多久 (運行時長)：</span>
                        </label>
                        <span className="text-cyan-400 font-mono font-bold">
                          {autoDurationMin > 0 ? `${autoDurationMin} 分鐘` : "♾️ 不限時間 (持續運行)"}
                        </span>
                      </div>

                      {/* 快捷按鈕 */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { min: 30, label: "30分" },
                          { min: 60, label: "1小時" },
                          { min: 120, label: "2小時" },
                          { min: 240, label: "4小時" },
                          { min: 480, label: "8小時" },
                          { min: 1440, label: "24小時" },
                          { min: 0, label: "♾️ 不限時間" },
                        ].map((item) => (
                          <button
                            key={item.min}
                            disabled={autoCollectorState.isRunning}
                            onClick={() => setAutoDurationMin(item.min)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                              autoDurationMin === item.min
                                ? "bg-cyan-500 text-slate-950 font-bold"
                                : "bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800"
                            } ${autoCollectorState.isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      {/* 自訂分鐘輸入 */}
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-slate-400 text-[11px]">自訂分鐘：</span>
                        <input
                          type="number"
                          min="0"
                          max="10080"
                          disabled={autoCollectorState.isRunning}
                          value={autoDurationMin}
                          onChange={(e) => setAutoDurationMin(Math.max(0, Number(e.target.value)))}
                          className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-mono text-xs w-28 focus:border-cyan-500 focus:outline-hidden disabled:opacity-50"
                        />
                        <span className="text-[11px] text-slate-500">分鐘 (設為 0 代表不限時間)</span>
                      </div>
                    </div>
                  </div>

                  {/* 方向與在線微調選項 */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 text-xs">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-bold">採集方向：</span>
                        <select
                          disabled={autoCollectorState.isRunning}
                          value={autoTargetDir}
                          onChange={(e) => setAutoTargetDir(e.target.value as any)}
                          className="bg-slate-900 text-white border border-slate-700 rounded-xl px-3 py-1.5 font-bold focus:border-emerald-500 focus:outline-hidden disabled:opacity-50"
                        >
                          <option value="BOTH">雙向輪流 (南下/北上交替採集，推薦)</option>
                          <option value="S">僅南下 0K → 54K (往宜蘭)</option>
                          <option value="N">僅北上 54K → 0K (往台北)</option>
                        </select>
                      </div>

                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={autoCollectorState.isRunning}
                          checked={autoTrainAfterCapture}
                          onChange={(e) => setAutoTrainAfterCapture(e.target.checked)}
                          className="rounded-sm border-slate-700 text-emerald-500 focus:ring-emerald-400"
                        />
                        <span>每次寫入後自動執行 5 Epochs 梯度下降在線微調</span>
                      </label>
                    </div>

                    {/* 主執行控制按鈕 */}
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      {!autoCollectorState.isRunning ? (
                        <button
                          onClick={handleStartAutoCollector}
                          className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
                        >
                          <Play className="h-4 w-4 fill-current" />
                          <span>▶ 啟動定時自動取樣 (限後台)</span>
                        </button>
                      ) : (
                        <button
                          onClick={handleStopAutoCollector}
                          className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-rose-600/30 cursor-pointer"
                        >
                          <Square className="h-4 w-4 fill-current" />
                          <span>⏹ 停止定時自動取樣</span>
                        </button>
                      )}

                      <button
                        onClick={handleSingleCaptureNow}
                        disabled={autoCollectorState.isCapturingNow}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                        title="立即手動抓取一筆並寫入資料庫"
                      >
                        <Zap className={`h-4 w-4 text-amber-400 ${autoCollectorState.isCapturingNow ? "animate-spin" : ""}`} />
                        <span>單次手動寫入 1 筆</span>
                      </button>
                    </div>
                  </div>

                  {/* 即時採集與訓練日誌終端視窗 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-bold flex items-center gap-1.5 text-slate-300">
                        <Terminal className="h-4 w-4 text-emerald-400" />
                        <span>即時取樣與訓練終端日誌 (Live Stream)</span>
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        最新 50 筆取樣與梯度優化軌跡
                      </span>
                    </div>

                    <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 font-mono text-[11px] h-40 overflow-y-auto space-y-1.5">
                      {autoCollectorState.logs.length === 0 ? (
                        <div className="text-slate-600 text-center py-6">
                          尚無採集日誌，點擊「啟動定時自動取樣」或「單次手動寫入」即可開始寫入資料庫。
                        </div>
                      ) : (
                        autoCollectorState.logs.map((log) => (
                          <div
                            key={log.id}
                            className={`flex items-start gap-2 leading-relaxed ${
                              log.type === "success"
                                ? "text-emerald-400"
                                : log.type === "error"
                                ? "text-rose-400"
                                : log.type === "warning"
                                ? "text-amber-300"
                                : "text-slate-400"
                            }`}
                          >
                            <span className="text-slate-600 select-none shrink-0 font-sans">
                              [{log.timeFormatted}]
                            </span>
                            <span className="break-all">{log.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* 區塊 2: 手動 10 Epochs 微調與機器學習參數 */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-emerald-400" />
                        <span>車道切換與流態機器學習調校</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        使用資料庫梯度下降在線優化車道切換收益門檻 (ΔT_switch) 與跨車道剪力耦合。
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRunTraining}
                        disabled={isTraining}
                        className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition cursor-pointer ${
                          isTraining
                            ? "bg-slate-800 text-slate-400 cursor-not-allowed"
                            : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black"
                        }`}
                      >
                        {isTraining ? (
                          <>
                            <RotateCcw className="h-4 w-4 animate-spin" />
                            <span>訓練中...</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 fill-current" />
                            <span>手動執行 10 Epochs 微調 (限後台)</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={handleResetModelBaseline}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                        title="重設模型為物理基準"
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span>重設基準</span>
                      </button>
                    </div>
                  </div>

                  {/* 參數詳細卡片 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                    <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2">
                      <span className="text-slate-400 block font-sans font-bold text-[11px] text-emerald-400">
                        1. 動態車道切換收益門檻 (ΔT_switch)
                      </span>
                      <div className="text-2xl font-black text-white">
                        {learnedParams.laneSwitchMarginSec.toFixed(1)}{" "}
                        <span className="text-xs font-normal text-slate-400">秒</span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-sans">
                        當雙車道時間差達到此門檻時，才觸發較快車道導引，防止隨機震盪。
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2">
                      <span className="text-slate-400 block font-sans font-bold text-[11px] text-emerald-400">
                        2. 內側車道偏置因子 (β_L1)
                      </span>
                      <div className="text-2xl font-black text-white">
                        {learnedParams.lane1SpeedBiasFactor.toFixed(3)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-sans">
                        量化內側車道無大車干擾下的常態速度優勢加權。
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2">
                      <span className="text-slate-400 block font-sans font-bold text-[11px] text-sky-400">
                        3. 雙車道紊流剪力耦合 (c_friction)
                      </span>
                      <div className="text-2xl font-black text-white">
                        {learnedParams.laneCouplingFriction.toFixed(3)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-sans">
                        相鄰車道流速差對本車道造成的拖曳降速阻力係數。
                      </p>
                    </div>

                    <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2">
                      <span className="text-slate-400 block font-sans font-bold text-[11px] text-sky-400">
                        4. 車道選擇靈敏度指數 (β_choice)
                      </span>
                      <div className="text-2xl font-black text-white">
                        {learnedParams.laneChoiceSensitivity.toFixed(3)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-sans">
                        Softmax 分流決策邊際分配強度。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: API 路由對齊、重新命名與 TDX 金鑰 */}
            {activeTab === "tdx" && (
              <div className="space-y-6 max-w-2xl">
                {/* 區塊 1: API 路由名稱與端點對齊 (對齊另一個網站) */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <ArrowRightLeft className="h-4 w-4 text-amber-400" />
                        <span>API 路由名稱與端點對齊 (對齊另一個網站)</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        若您在另一側網站有特定的 API 路由名稱、Base URL 或鑑權金鑰，可在下方自訂以達到 100% 結構對齊。
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleResetApiConfig}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                        title="還原預設 API 端點"
                      >
                        還原預設
                      </button>
                    </div>
                  </div>

                  {/* 快速範本選擇 */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400">快速對齊範本：</label>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        onClick={() =>
                          setApiConfig((prev) => ({
                            ...prev,
                            apiAliasName: "標準 TDX 本地代理 (預設)",
                            baseUrl: "",
                            freewayVdPath: "/api/tdx/freeway-vd",
                            freewayLiveEventsPath: "/api/tdx/freeway-live-events",
                          }))
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-mono cursor-pointer"
                      >
                        預設 /api/tdx/...
                      </button>
                      <button
                        onClick={() =>
                          setApiConfig((prev) => ({
                            ...prev,
                            apiAliasName: "V1 標準架構 (/api/v1/...)",
                            baseUrl: "",
                            freewayVdPath: "/api/v1/freeway-vd",
                            freewayLiveEventsPath: "/api/v1/freeway-live-events",
                          }))
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-mono cursor-pointer"
                      >
                        /api/v1/freeway-vd
                      </button>
                      <button
                        onClick={() =>
                          setApiConfig((prev) => ({
                            ...prev,
                            apiAliasName: "Traffic 精簡架構 (/api/traffic/...)",
                            baseUrl: "",
                            freewayVdPath: "/api/traffic/vd",
                            freewayLiveEventsPath: "/api/traffic/live-events",
                          }))
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-mono cursor-pointer"
                      >
                        /api/traffic/vd
                      </button>
                    </div>
                  </div>

                  {/* 表單欄位 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 font-mono text-xs">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        API 識別名稱 / 專案標籤 (Alias Name)
                      </label>
                      <input
                        type="text"
                        value={apiConfig.apiAliasName}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, apiAliasName: e.target.value }))
                        }
                        placeholder="例如：國5即時路況主服務、另一網站中繼站"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white font-sans"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-slate-300 font-bold mb-1 font-sans flex items-center justify-between">
                        <span>API Base URL / 外部主機伺服器網址</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          留空代表本站同源代理 (預設)
                        </span>
                      </label>
                      <input
                        type="text"
                        value={apiConfig.baseUrl}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                        }
                        placeholder="例如：https://my-traffic-backend.com 或留空"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        車流 VD 即時數據 API 端點路徑
                      </label>
                      <input
                        type="text"
                        value={apiConfig.freewayVdPath}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, freewayVdPath: e.target.value }))
                        }
                        placeholder="/api/tdx/freeway-vd"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        即時事件通報 API 端點路徑
                      </label>
                      <input
                        type="text"
                        value={apiConfig.freewayLiveEventsPath}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, freewayLiveEventsPath: e.target.value }))
                        }
                        placeholder="/api/tdx/freeway-live-events"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        鑑權 Header 名稱 (如 Authorization)
                      </label>
                      <input
                        type="text"
                        value={apiConfig.customAuthHeaderName}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, customAuthHeaderName: e.target.value }))
                        }
                        placeholder="Authorization"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        鑑權 Header 內容 (如 Bearer token)
                      </label>
                      <input
                        type="password"
                        value={apiConfig.customAuthHeaderValue}
                        onChange={(e) =>
                          setApiConfig((prev) => ({ ...prev, customAuthHeaderValue: e.target.value }))
                        }
                        placeholder="Bearer your-token-here (選填)"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>
                  </div>

                  {/* 組合後的呼叫預覽 */}
                  <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300">
                    <span className="text-slate-500 font-sans font-bold block mb-1">
                      解析後的完整 API 呼叫路徑：
                    </span>
                    <div className="text-amber-400 font-bold break-all">
                      GET {getResolvedApiUrl("freewayVd")}
                    </div>
                  </div>

                  {/* 測試連線與儲存按鈕 */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      onClick={handleSaveApiConfig}
                      className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>儲存 API 路由與命名對齊</span>
                    </button>

                    <button
                      onClick={handleTestApiConnection}
                      disabled={isTestingApi}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isTestingApi ? (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                      ) : (
                        <Terminal className="h-4 w-4 text-sky-400" />
                      )}
                      <span>{isTestingApi ? "測試連線中..." : "即時連線測試 (Ping / Test)"}</span>
                    </button>
                  </div>

                  {/* 測試連線結果即時展示 */}
                  {testApiResult && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs font-mono transition ${
                        testApiResult.success
                          ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-300"
                          : "bg-rose-950/40 border-rose-800/80 text-rose-300"
                      }`}
                    >
                      <div className="flex items-center justify-between font-sans font-bold mb-1">
                        <span className="flex items-center gap-1.5">
                          {testApiResult.success ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-rose-400" />
                          )}
                          <span>連線測試結果 (HTTP {testApiResult.status})</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          延遲: {testApiResult.latencyMs}ms
                        </span>
                      </div>
                      <p className="font-sans text-[11px] mt-0.5">{testApiResult.message}</p>
                      {testApiResult.dataPreview && (
                        <div className="mt-2 p-2 bg-slate-950/80 rounded-lg text-[10px] text-slate-400 overflow-x-auto">
                          {testApiResult.dataPreview}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 區塊 2: 交通部 TDX 官方金鑰設定 */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-4">
                  <div className="space-y-1 pb-3 border-b border-slate-800/80">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Key className="h-4 w-4 text-amber-400" />
                      <span>交通部 TDX 官方金鑰輪轉池設定 (限後台修改)</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      可輸入您直接向交通部 TDX 申請的 Client ID 與 Secret；若未輸入，系統將全自動採用伺服器後端多通道金鑰輪轉池。
                    </p>
                  </div>

                  <div className="space-y-3 font-mono text-xs">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        TDX Client ID
                      </label>
                      <input
                        type="text"
                        value={tdxClientId}
                        onChange={(e) => setTdxClientId(e.target.value)}
                        placeholder="例如：your_client_id-xxxxxxxx-xxxx"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-300 font-bold mb-1 font-sans">
                        TDX Client Secret
                      </label>
                      <input
                        type="password"
                        value={tdxClientSecret}
                        onChange={(e) => setTdxClientSecret(e.target.value)}
                        placeholder="例如：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleSaveTdx}
                      className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>儲存 TDX 憑證 (限後台)</span>
                    </button>

                    <button
                      onClick={handleClearTdx}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition cursor-pointer"
                    >
                      清除金鑰 (使用系統池)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: 進入人數與訪客流量管理 (Visitor Statistics Management) */}
            {activeTab === "visitors" && (
              <div className="space-y-6">
                {/* 說明橫幅 */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-400" />
                      <span>全站累積進入人數與流量統計 (後台管理)</span>
                    </h3>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                      即時連動全站 UI
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    此功能允許後台管理員直接增加或校正全站「累積進入人數」與「今日進入人數」。所有調整均會即時同步至頁首（Header）及頁尾（Footer）狀態列。
                  </p>
                </div>

                {/* 數據即時看板 (Metrics Cards) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-emerald-400" />
                        <span>全站累積進入人數</span>
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono">
                        TOTAL
                      </span>
                    </div>
                    <div className="text-2xl font-black text-white font-mono tracking-tight">
                      {visitorStats.totalEntered.toLocaleString()}
                      <span className="text-xs text-slate-500 font-normal ml-1 font-sans">人次</span>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                      <span className="flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
                        <span>今日進入人數</span>
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 font-mono">
                        TODAY
                      </span>
                    </div>
                    <div className="text-2xl font-black text-cyan-400 font-mono tracking-tight">
                      {visitorStats.todayEntered.toLocaleString()}
                      <span className="text-xs text-slate-500 font-normal ml-1 font-sans">人次</span>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
                      <span className="flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-amber-400" />
                        <span>即時在線估計</span>
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono">
                        LIVE
                      </span>
                    </div>
                    <div className="text-2xl font-black text-amber-400 font-mono tracking-tight flex items-center gap-2">
                      <span>~{visitorStats.onlineEstimate}</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs text-slate-500 font-normal font-sans">人</span>
                    </div>
                  </div>
                </div>

                {/* 區塊 1: 快捷增加進入人數 (Quick Boost Buttons) */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Plus className="h-4 w-4 text-emerald-400" />
                        <span>快捷增加進入人數 (點擊立即生效)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        點選下方按鈕，直接將指定人數疊加至累積進入與今日進入人數
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                    {[
                      { label: "+10 人", amount: 10 },
                      { label: "+50 人", amount: 50 },
                      { label: "+100 人", amount: 100 },
                      { label: "+500 人", amount: 500 },
                      { label: "+1,000 人", amount: 1000 },
                      { label: "+5,000 人", amount: 5000 },
                      { label: "+10,000 人", amount: 10000 },
                      { label: "+50,000 人", amount: 50000 },
                    ].map((btn) => (
                      <button
                        key={btn.amount}
                        onClick={() => handleQuickIncrease(btn.amount)}
                        className="px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-emerald-600 hover:text-white border border-slate-800 hover:border-emerald-500 text-emerald-400 font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs group"
                      >
                        <Plus className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
                        <span className="font-mono">{btn.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 區塊 2: 自訂任意增量 (Custom Increment) */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                  <div className="pb-2 border-b border-slate-800/80">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Hash className="h-4 w-4 text-cyan-400" />
                      <span>自訂指定增量 (Custom Amount)</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      輸入您想要增加的任意特定人數（如 250、888、3500）
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                    <input
                      type="number"
                      min="1"
                      value={customIncrement}
                      onChange={(e) => setCustomIncrement(e.target.value)}
                      placeholder="輸入欲增加之人數 (例如: 200)"
                      className="w-full sm:flex-1 px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-cyan-400 text-white font-mono text-xs"
                    />
                    <button
                      onClick={handleApplyCustomIncrement}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-sm"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>增加此指定人數</span>
                    </button>
                  </div>
                </div>

                {/* 區塊 3: 直接校正/覆寫累積總數 (Direct Total Calibration) */}
                <div className="bg-slate-950/80 p-5 rounded-2xl border border-slate-800 space-y-3">
                  <div className="pb-2 border-b border-slate-800/80">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-amber-400" />
                      <span>直接覆寫全站累積總人數 (Direct Calibration)</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      若欲直接將總計數設定為特定目標值（例如：50,000 人）可在此直接覆寫
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                    <input
                      type="number"
                      min="0"
                      value={customTotal}
                      onChange={(e) => setCustomTotal(e.target.value)}
                      placeholder={`當前累積：${visitorStats.totalEntered}，輸入新總數 (例如: 50000)`}
                      className="w-full sm:flex-1 px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-amber-400 text-white font-mono text-xs"
                    />
                    <button
                      onClick={handleApplyCustomTotal}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>覆寫累積總人數</span>
                    </button>
                  </div>
                </div>

                {/* 區塊 4: 還原初始種子基準 */}
                <div className="p-4 bg-slate-950 border border-slate-800/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-300 block">重設進入人數計數</span>
                    <span className="text-[11px] text-slate-500">
                      將累積進入人數與今日人數重設還原至系統初始基準（~18,342 人）
                    </span>
                  </div>
                  <button
                    onClick={handleResetVisitorBaseline}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>還原為初始基準</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 5: 後台安全與權限控制 */}
            {activeTab === "security" && (
              <div className="space-y-4 max-w-xl">
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span>後台授權狀態</span>
                    </span>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                      {isAuth ? "已授權管理員" : "前台唯讀"}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    本系統設定了嚴格的後台權限防護：所有修改資料庫、重設模型與金鑰設定均需透過後台密碼驗證解鎖。未經驗證之前，前台僅提供唯讀監控功能。
                  </p>

                  <div className="pt-2">
                    {isAuth ? (
                      <button
                        onClick={handleLogout}
                        className="px-4 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-bold flex items-center gap-2 transition cursor-pointer"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        <span>立即鎖定並登出後台</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          onRequireAuthPrompt?.(
                            "解鎖後台管理員權限",
                            "請輸入後台密碼以解鎖進階設定與資料庫管理權限。",
                            () => {
                              setIsAuth(true);
                              showNotice("✓ 後台已成功解鎖！");
                            }
                          );
                        }}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-2 transition cursor-pointer"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        <span>輸入密碼解鎖後台</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>國道5號雪山隧道後台管理防護系統</span>
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition cursor-pointer"
            >
              關閉面板
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
