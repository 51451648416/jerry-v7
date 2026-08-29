// 訪客進入人數與全站流量計數服務 (Visitor & Traffic Statistics Engine)
import { getTaipeiTimeInfo } from "../utils/taipeiTime";

export interface VisitorStatsData {
  totalEntered: number;
  todayEntered: number;
  lastDateStr: string;
  onlineEstimate: number;
  lastUpdated: string;
}

const STORAGE_KEY = "hsuehshan_traffic_visitor_stats";
const SESSION_KEY = "hsuehshan_traffic_session_logged";
const DEFAULT_BASELINE_ENTERED = 18342;
const DEFAULT_TODAY_ENTERED = 368;

type StatsListener = (stats: VisitorStatsData) => void;
const listeners: Set<StatsListener> = new Set();

const getTodayDateString = (): string => {
  return getTaipeiTimeInfo(new Date()).dateStr;
};

const notifyListeners = (stats: VisitorStatsData) => {
  listeners.forEach((fn) => {
    try {
      fn(stats);
    } catch (e) {
      console.error("Error in visitor stats listener", e);
    }
  });
};

/**
 * 取得當前全站累積進入人數與訪客統計資料
 */
export const getVisitorStats = (): VisitorStatsData => {
  const todayStr = getTodayDateString();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.totalEntered === "number") {
        // 若日期跨日，重設今日進入人數
        let todayCount = parsed.todayEntered ?? DEFAULT_TODAY_ENTERED;
        if (parsed.lastDateStr !== todayStr) {
          todayCount = Math.max(12, Math.floor(Math.random() * 20) + 15);
        }

        // 即時在線人數自然微幅動態估算
        const hour = getTaipeiTimeInfo(new Date()).hour;
        const isPeak = (hour >= 7 && hour <= 10) || (hour >= 15 && hour <= 21);
        const baseOnline = isPeak ? 68 : 29;
        const jitter = Math.floor(Math.sin(Date.now() / 30000) * 12) + (Date.now() % 7);
        const online = Math.max(15, baseOnline + jitter);

        return {
          totalEntered: parsed.totalEntered,
          todayEntered: todayCount,
          lastDateStr: todayStr,
          onlineEstimate: online,
          lastUpdated: new Date().toISOString(),
        };
      }
    }
  } catch (e) {
    console.warn("Failed to load visitor stats from localStorage", e);
  }

  // 預設基準值
  const initial: VisitorStatsData = {
    totalEntered: DEFAULT_BASELINE_ENTERED,
    todayEntered: DEFAULT_TODAY_ENTERED,
    lastDateStr: todayStr,
    onlineEstimate: 42,
    lastUpdated: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch {}

  return initial;
};

/**
 * 儲存訪客統計資料至本機儲存並通知所有元件
 */
const saveVisitorStats = (stats: VisitorStatsData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("Failed to save visitor stats", e);
  }
  notifyListeners(stats);
};

/**
 * 每次訪客新開啟 Session 進入時自動遞增計數
 */
export const recordVisitorSession = (): VisitorStatsData => {
  const current = getVisitorStats();
  try {
    const hasLogged = sessionStorage.getItem(SESSION_KEY);
    if (!hasLogged) {
      sessionStorage.setItem(SESSION_KEY, "1");
      const updated: VisitorStatsData = {
        ...current,
        totalEntered: current.totalEntered + 1,
        todayEntered: current.todayEntered + 1,
        lastUpdated: new Date().toISOString(),
      };
      saveVisitorStats(updated);
      return updated;
    }
  } catch (e) {
    console.warn("Session storage error", e);
  }
  return current;
};

/**
 * 後台管理功能：手動增加累積進入人數 (可直接 +50, +100, +500, +1000 或任意指定增量)
 */
export const increaseVisitorCount = (incrementAmount: number): VisitorStatsData => {
  const current = getVisitorStats();
  const safeInc = Math.max(0, Math.floor(incrementAmount));
  const updated: VisitorStatsData = {
    ...current,
    totalEntered: current.totalEntered + safeInc,
    todayEntered: current.todayEntered + safeInc,
    lastUpdated: new Date().toISOString(),
  };
  saveVisitorStats(updated);
  return updated;
};

/**
 * 後台管理功能：直接設定自訂累積進入人數
 */
export const setCustomVisitorCount = (
  newTotalEntered: number,
  newTodayEntered?: number
): VisitorStatsData => {
  const current = getVisitorStats();
  const safeTotal = Math.max(0, Math.floor(newTotalEntered));
  const safeToday =
    newTodayEntered !== undefined
      ? Math.max(0, Math.floor(newTodayEntered))
      : current.todayEntered;

  const updated: VisitorStatsData = {
    ...current,
    totalEntered: safeTotal,
    todayEntered: safeToday,
    lastUpdated: new Date().toISOString(),
  };
  saveVisitorStats(updated);
  return updated;
};

/**
 * 後台管理功能：重設進入人數為初始基準
 */
export const resetVisitorCount = (): VisitorStatsData => {
  const todayStr = getTodayDateString();
  const reset: VisitorStatsData = {
    totalEntered: DEFAULT_BASELINE_ENTERED,
    todayEntered: DEFAULT_TODAY_ENTERED,
    lastDateStr: todayStr,
    onlineEstimate: 42,
    lastUpdated: new Date().toISOString(),
  };
  saveVisitorStats(reset);
  return reset;
};

/**
 * 訂閱進入人數變更事件（即時響應 Header、Footer 與後台管理介面）
 */
export const subscribeVisitorStats = (listener: StatsListener): (() => void) => {
  listeners.add(listener);
  listener(getVisitorStats());
  return () => {
    listeners.delete(listener);
  };
};
