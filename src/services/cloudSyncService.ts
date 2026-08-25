import { useState, useEffect, useCallback } from "react";
import { syncApiConfigFromServer } from "./apiConfig";
import { syncTdxKeysFromServer, getStoredTdxKeyPairs } from "./tdxKeyRotator";
import { syncLearnedParametersFromServer, getLearnedParameters } from "../estimator/modelTrainingEngine";
import { syncDatasetFromServer, getStoredDataset } from "./datasetRepository";

export interface CloudSyncState {
  isCloudConnected: boolean; // true: Upstash Redis 連線成功
  isServerOnline: boolean; // 後端 API 正常運行
  keyCount: number; // 已載入之全域金鑰組數
  modelVersion: number | string; // 全域模型版本
  datasetCount: number; // 全域資料集筆數
  lastSyncTime: string; // 最後同步時間
  isSyncing: boolean; // 同步中狀態
  syncStatusText: string; // 狀態文字
  redisMode: "upstash_redis_cloud" | "local_memory_fallback" | "offline";
}

let globalSyncState: CloudSyncState = {
  isCloudConnected: false,
  isServerOnline: false,
  keyCount: 0,
  modelVersion: 2,
  datasetCount: 0,
  lastSyncTime: "",
  isSyncing: false,
  syncStatusText: "尚未進行雲端同步",
  redisMode: "offline",
};

const listeners = new Set<(state: CloudSyncState) => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener({ ...globalSyncState });
  }
}

/**
 * 執行即時雙向全域雲端同步 (Bidirectional Cloud Synchronization)
 */
export async function performBidirectionalCloudSync(): Promise<CloudSyncState> {
  globalSyncState.isSyncing = true;
  notifyListeners();

  try {
    // 1. 檢測伺服器與 Redis 健康狀態
    let healthData: any = null;
    try {
      const healthRes = await fetch("/api/health");
      if (healthRes.ok) {
        healthData = await healthRes.json();
      }
    } catch {}

    const isServerOnline = Boolean(healthData && healthData.status === "ok");
    const isCloudConnected = Boolean(healthData && healthData.redisConnected);
    const redisMode = isCloudConnected
      ? "upstash_redis_cloud"
      : isServerOnline
      ? "local_memory_fallback"
      : "offline";

    // 2. 並行拉取金鑰、模型權重、資料集與 API 配置
    const [keysResult, modelResult, datasetResult] = await Promise.allSettled([
      syncTdxKeysFromServer(),
      syncLearnedParametersFromServer(),
      syncDatasetFromServer(),
      syncApiConfigFromServer(),
    ]);

    // 3. 取得本地最新數值
    const localKeys = getStoredTdxKeyPairs();
    const validKeyCount = localKeys.filter((k) => k.isEnabled && k.clientId && k.clientSecret).length;
    const currentModel = getLearnedParameters();
    const currentDataset = getStoredDataset();

    const nowFormatted = new Date().toLocaleTimeString("zh-TW", { hour12: false });

    let statusText = "";
    if (isCloudConnected) {
      statusText = `雲端同步中 (已載入 ${validKeyCount} 組全域金鑰 / 全域模型 v${currentModel.version || 2})`;
    } else if (isServerOnline) {
      statusText = `單機快取模式 (${validKeyCount} 組金鑰 / 模型 v${currentModel.version || 2})`;
    } else {
      statusText = `使用單機快取 (未同步)`;
    }

    globalSyncState = {
      isCloudConnected,
      isServerOnline,
      keyCount: validKeyCount,
      modelVersion: currentModel.version || 2,
      datasetCount: currentDataset.length,
      lastSyncTime: nowFormatted,
      isSyncing: false,
      syncStatusText: statusText,
      redisMode,
    };

    // 發送全域自訂廣播事件通知 React 各頁面與元件更新
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hsuehshan:cloud_synced", { detail: globalSyncState }));
    }

    notifyListeners();
    return { ...globalSyncState };
  } catch (err) {
    console.warn("全域雲端同步失敗:", err);
    globalSyncState.isSyncing = false;
    notifyListeners();
    return { ...globalSyncState };
  }
}

/**
 * React Hook: 取得雲端同步狀態並支援手動同步
 */
export function useCloudSyncStatus() {
  const [state, setState] = useState<CloudSyncState>(() => ({ ...globalSyncState }));

  useEffect(() => {
    const handleUpdate = (newState: CloudSyncState) => {
      setState(newState);
    };
    listeners.add(handleUpdate);

    // Initial check
    if (!globalSyncState.lastSyncTime) {
      performBidirectionalCloudSync();
    }

    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  const triggerManualSync = useCallback(async () => {
    return await performBidirectionalCloudSync();
  }, []);

  return {
    ...state,
    triggerManualSync,
  };
}
