/**
 * TDX API Key Rotation & Failover System (精要輪流金鑰管理器)
 *
 * 核心機制：
 * 1. 支援多組 TDX Client ID 與 Client Secret (可由環境變數、配置陣列或動態擴充設定)。
 * 2. 輪流調度機制 (Round-Robin with Automatic Failover)：
 *    - 平時使用當前有效的金鑰組 (Active Key)。
 *    - 當第一組金鑰失效、達到請求頻率上限 (429/401/403/逾期) 或連線失敗時，自動輪轉切換至第二組金鑰。
 *    - 若後續組別失效，則依序推進並自動「輪轉循環 (Loop Back)」回第一組，確保服務永不中斷。
 * 3. 獨立封裝，絕不干涉或變更任何交通流物理估計、微元動態積分與既有數學運算公式。
 */

export interface TdxKeyPair {
  id: string;
  clientId: string;
  clientSecret: string;
  label: string;
  failCount: number;
  lastUsedTimestamp?: number;
  lastError?: string;
  isHealthy: boolean;
}

export interface CustomTdxKeyInput {
  id: string;
  clientId: string;
  clientSecret: string;
  label?: string;
  isEnabled?: boolean;
}

export interface CachedTokenEntry {
  accessToken: string;
  expiresAt: number;
  keyId: string;
}

export interface TdxKeyManagerStatus {
  totalKeys: number;
  activeKeyIndex: number;
  activeKeyLabel: string;
  activeClientIdMasked: string;
  rotationCount: number;
  lastRotationTimestamp?: string;
  lastRotationReason?: string;
  keysStatus: {
    index: number;
    id: string;
    label: string;
    clientIdMasked: string;
    isHealthy: boolean;
    failCount: number;
    lastError?: string;
  }[];
}

export const STORAGE_KEY_TDX_API_KEYS = "TDX_API_KEYS";

/**
 * 取得本機儲存之自訂多組 TDX API 金鑰清單
 */
export function getStoredTdxKeyPairs(): CustomTdxKeyInput[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TDX_API_KEYS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          id: item.id || `key-custom-${idx + 1}-${Date.now()}`,
          clientId: String(item.clientId || "").trim(),
          clientSecret: String(item.clientSecret || "").trim(),
          label: item.label || `金鑰組 #${idx + 1}`,
          isEnabled: item.isEnabled !== false,
        }));
      }
    }

    // 舊版單一金鑰相容性自動遷移 (Migration)
    const legacyId = localStorage.getItem("TDX_CLIENT_ID");
    const legacySecret = localStorage.getItem("TDX_CLIENT_SECRET");
    if (legacyId && legacySecret && legacyId.trim() && legacySecret.trim()) {
      const migrated: CustomTdxKeyInput[] = [
        {
          id: `key-migrated-${Date.now()}`,
          clientId: legacyId.trim(),
          clientSecret: legacySecret.trim(),
          label: "第 1 順位主要金鑰 (自訂)",
          isEnabled: true,
        },
      ];
      localStorage.setItem(STORAGE_KEY_TDX_API_KEYS, JSON.stringify(migrated));
      return migrated;
    }
  } catch (e) {
    console.warn("讀取 TDX_API_KEYS 失敗:", e);
  }
  return [];
}

/**
 * 儲存自訂多組 TDX API 金鑰清單至 LocalStorage，並通知系統即時重新載入
 */
export function saveStoredTdxKeyPairs(pairs: CustomTdxKeyInput[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const cleaned: CustomTdxKeyInput[] = pairs.map((p, idx) => ({
      id: p.id || `key-${idx + 1}-${Date.now()}`,
      clientId: (p.clientId || "").trim(),
      clientSecret: (p.clientSecret || "").trim(),
      label: (p.label || `金鑰組 #${idx + 1}`).trim(),
      isEnabled: p.isEnabled !== false,
    }));

    localStorage.setItem(STORAGE_KEY_TDX_API_KEYS, JSON.stringify(cleaned));

    // 同步更新 Legacy 單組金鑰（以第 1 組啟用的有效金鑰作為預設）
    const firstEnabled = cleaned.find((p) => p.isEnabled && p.clientId && p.clientSecret);
    if (firstEnabled) {
      localStorage.setItem("TDX_CLIENT_ID", firstEnabled.clientId);
      localStorage.setItem("TDX_CLIENT_SECRET", firstEnabled.clientSecret);
    } else if (cleaned.length === 0) {
      localStorage.removeItem("TDX_CLIENT_ID");
      localStorage.removeItem("TDX_CLIENT_SECRET");
    }

    // 重新載入前端金鑰輪轉池
    globalTdxKeyManager.reloadKeys();

    // 嘗試向後端同步 (Vercel Serverless /api/keys 與 Express /api/keys)
    if (typeof fetch !== "undefined") {
      fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned),
      }).catch(() => {});

      // 相容性後端路徑同步
      fetch("/api/config/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned),
      }).catch(() => {});
    }
  } catch (e) {
    console.error("儲存 TDX_API_KEYS 失敗:", e);
  }
}

/**
 * 從後端伺服器同步全域 TDX 金鑰 (跨後端/跨裝置同步，對應 Vercel /api/keys)
 */
export async function syncTdxKeysFromServer(): Promise<CustomTdxKeyInput[] | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch("/api/keys");
    if (res.ok) {
      const result = await res.json();
      const rawData = result && typeof result === "object" && "data" in result ? result.data : result;
      const keysArray = Array.isArray(rawData) ? rawData : rawData?.keys;
      if (Array.isArray(keysArray) && keysArray.length > 0) {
        localStorage.setItem(STORAGE_KEY_TDX_API_KEYS, JSON.stringify(keysArray));
        const firstEnabled = keysArray.find((p: any) => p.isEnabled && p.clientId && p.clientSecret);
        if (firstEnabled) {
          localStorage.setItem("TDX_CLIENT_ID", firstEnabled.clientId);
          localStorage.setItem("TDX_CLIENT_SECRET", firstEnabled.clientSecret);
        }
        globalTdxKeyManager.reloadKeys();
        return keysArray;
      }
    }
  } catch (e) {
    // Backend offline or not set
  }
  return null;
}

/**
 * 具備 18 秒逾時與輕量重試之安全 Fetch 封裝
 */
async function fetchWithTimeoutAndRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 18000,
  maxRetries: number = 2,
  retryIntervalMs: number = 1500
): Promise<Response> {
  let lastErr: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const status = response.status;
      const isServerError = status === 500 || status === 502 || status === 503 || status === 504;

      // 若遇伺服器暫時錯誤 (50x)，且尚有重試次數，則在同金鑰等待 1.5 秒後進行輕量重試
      if (isServerError && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        continue;
      }

      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastErr = err;
      const isTimeout = err.name === "AbortError" || err.message?.includes("aborted") || err.message?.includes("timeout");

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        continue;
      }
    }
  }

  throw lastErr || new Error("連線逾時 (Timeout)");
}

/**
 * 測試單一組 TDX Client ID 與 Secret 是否能成功獲取 Access Token
 */
export async function testSingleTdxKey(
  clientId: string,
  clientSecret: string
): Promise<{ success: boolean; message: string; latencyMs: number; expiresIn?: number }> {
  const cleanId = (clientId || "").trim();
  const cleanSecret = (clientSecret || "").trim();
  if (!cleanId || !cleanSecret) {
    return {
      success: false,
      message: "請輸入有效的 Client ID 與 Client Secret",
      latencyMs: 0,
    };
  }

  const startTime = Date.now();
  const authUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
  const bodyParams = new URLSearchParams();
  bodyParams.append("grant_type", "client_credentials");
  bodyParams.append("client_id", cleanId);
  bodyParams.append("client_secret", cleanSecret);

  try {
    const res = await fetchWithTimeoutAndRetry(
      authUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: bodyParams.toString(),
      },
      18000,
      1,
      1500
    );
    const latencyMs = Date.now() - startTime;
    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      let errDetail = "";
      if (contentType.includes("json")) {
        try {
          const errJson = await res.json();
          errDetail = errJson.error_description || errJson.error || errJson.message || JSON.stringify(errJson);
        } catch {
          errDetail = `HTTP ${res.status} ${res.statusText}`;
        }
      } else {
        const raw = await res.text().catch(() => "");
        errDetail = raw.substring(0, 120);
      }
      return {
        success: false,
        message: `認證失敗 (HTTP ${res.status}): ${errDetail || "帳號或密鑰無效"}`,
        latencyMs,
      };
    }

    const data = await res.json();
    if (!data.access_token) {
      return {
        success: false,
        message: "認證成功但未回傳有效的 access_token",
        latencyMs,
      };
    }

    const hours = Math.round(((data.expires_in || 86400) / 3600) * 10) / 10;
    return {
      success: true,
      message: `認證成功！已取得 Access Token (有效時效: ${hours} 小時)`,
      latencyMs,
      expiresIn: data.expires_in,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err.name === "AbortError" || err.message?.includes("aborted") || err.message?.includes("timeout");
    return {
      success: false,
      message: isTimeout ? "連線逾時 (18秒內未回應)" : `連線失敗或逾時: ${err.message || "網路異常"}`,
      latencyMs,
    };
  }
}

export class TdxKeyRotationSystem {
  private keyPairs: TdxKeyPair[] = [];
  private activeIndex: number = 0;
  private tokenCache: Map<string, CachedTokenEntry> = new Map();
  private responseCache: Map<string, { data: any; timestamp: number }> = new Map();
  private rotationCount: number = 0;
  private lastRotationTimestamp?: string;
  private lastRotationReason?: string;

  constructor() {
    this.initializeKeys();
  }

  /**
   * 初始化金鑰池 (按使用者自訂順序依序排列)
   * 優先順序：
   * 1. 瀏覽器 LocalStorage 多組自訂金鑰陣列 (TDX_API_KEYS)
   * 2. 環境變數 (TDX_CLIENT_ID / TDX_CLIENT_ID_2 / TDX_CLIENT_ID_3 ...)
   * 3. 內建備援輪轉金鑰
   */
  public initializeKeys() {
    const defaultKeys: { id: string; clientId: string; clientSecret: string; label: string }[] = [];

    // 1. 優先級 1：讀取瀏覽器 LocalStorage 多組自訂金鑰 (依序排列：第 1 組 -> 第 2 組 -> 第 3 組...)
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const storedList = getStoredTdxKeyPairs();
        storedList.forEach((k, idx) => {
          if (k.isEnabled !== false && k.clientId && k.clientSecret) {
            defaultKeys.push({
              id: k.id || `key-local-${idx + 1}`,
              clientId: k.clientId,
              clientSecret: k.clientSecret,
              label: k.label || `自訂金鑰組 #${idx + 1}`,
            });
          }
        });
      } catch (e) {
        console.warn("無法讀取 LocalStorage 金鑰設定:", e);
      }
    }

    // 2. 優先級 2：環境變數 (支援 Vite import.meta.env 與 Node process.env)
    const getEnvVal = (key: string): string => {
      let val = "";
      if (typeof import.meta !== "undefined" && (import.meta as any).env) {
        val = (import.meta as any).env[`VITE_${key}`] || (import.meta as any).env[key] || "";
      }
      if (!val && typeof process !== "undefined" && process.env) {
        val = process.env[key] || process.env[`VITE_${key}`] || "";
      }
      return String(val || "").trim();
    };

    for (let i = 1; i <= 10; i++) {
      const suffix = i === 1 ? "" : `_${i}`;
      const envId = getEnvVal(`TDX_CLIENT_ID${suffix}`);
      const envSecret = getEnvVal(`TDX_CLIENT_SECRET${suffix}`);
      if (envId && envSecret && !defaultKeys.some((k) => k.clientId === envId)) {
        defaultKeys.push({
          id: `key-env-${i}`,
          clientId: envId,
          clientSecret: envSecret,
          label: i === 1 ? "TDX 主要環境變數金鑰" : `TDX 備用環境變數金鑰 (${i})`,
        });
      }
    }

    // 3. 內建備援公用輪轉金鑰 (使用已通過官方授權認證之有效金鑰)
    const builtInDefaults = [
      {
        id: "key-builtin-primary",
        clientId: "lovefiy0903-f8d75808-3306-4327",
        clientSecret: "3b2a8558-8fb3-43ec-ada7-14f59e3476b4",
        label: "TDX 系統主要金鑰",
      },
    ];

    for (const b of builtInDefaults) {
      if (!defaultKeys.some((k) => k.clientId === b.clientId)) {
        defaultKeys.push(b);
      }
    }

    this.keyPairs = defaultKeys.map((k) => ({
      id: k.id,
      clientId: k.clientId,
      clientSecret: k.clientSecret,
      label: k.label,
      failCount: 0,
      isHealthy: true,
    }));
  }

  /**
   * 伺服器動態設定自訂金鑰清單
   */
  public setCustomKeys(customKeys: CustomTdxKeyInput[]) {
    this.tokenCache.clear();
    this.activeIndex = 0;
    const defaultKeys: { id: string; clientId: string; clientSecret: string; label: string }[] = [];

    customKeys.forEach((k, idx) => {
      if (k.isEnabled !== false && k.clientId && k.clientSecret) {
        defaultKeys.push({
          id: k.id || `key-custom-${idx + 1}`,
          clientId: k.clientId.trim(),
          clientSecret: k.clientSecret.trim(),
          label: k.label || `自訂金鑰組 #${idx + 1}`,
        });
      }
    });

    const builtInDefaults = [
      {
        id: "key-builtin-primary",
        clientId: "lovefiy0903-f8d75808-3306-4327",
        clientSecret: "3b2a8558-8fb3-43ec-ada7-14f59e3476b4",
        label: "TDX 系統主要金鑰",
      },
    ];
    for (const b of builtInDefaults) {
      if (!defaultKeys.some((k) => k.clientId === b.clientId)) {
        defaultKeys.push(b);
      }
    }

    this.keyPairs = defaultKeys.map((k) => ({
      id: k.id,
      clientId: k.clientId,
      clientSecret: k.clientSecret,
      label: k.label,
      failCount: 0,
      isHealthy: true,
    }));
  }

  /**
   * 重新載入金鑰池並清空快取 (當使用者在介面更新 LocalStorage 時調用)
   */
  public reloadKeys() {
    this.tokenCache.clear();
    this.activeIndex = 0;
    this.initializeKeys();
  }

  /**
   * 取得當前輪值中的金鑰
   */
  public getActiveKeyPair(): TdxKeyPair {
    if (this.keyPairs.length === 0) {
      this.initializeKeys();
    }
    return this.keyPairs[this.activeIndex % this.keyPairs.length];
  }

  /**
   * 取得所有金鑰列表清單
   */
  public getAllKeyPairs(): TdxKeyPair[] {
    return [...this.keyPairs];
  }

  /**
   * 將金鑰遮罩化 (保證 API Key 安全性)
   */
  private maskString(str: string): string {
    if (!str || str.length <= 8) return "********";
    return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
  }

  /**
   * 切換並輪轉至下一組金鑰 (Round-Robin Failover Loop)
   * 依序：第1組 -> 第2組 -> 第3組 -> ... -> 輪回到第1組
   */
  public rotateToNextKey(reason: string = "連線或授權異常自動輪替"): TdxKeyPair {
    const prevIndex = this.activeIndex;
    const currentKey = this.keyPairs[prevIndex];
    currentKey.failCount += 1;
    currentKey.lastError = reason;

    // 若單一金鑰連續失敗 >= 3 次，暫時標記為異常
    if (currentKey.failCount >= 3) {
      currentKey.isHealthy = false;
    }

    // 核心循環輪轉公式：(currentIndex + 1) % keyPairs.length
    this.activeIndex = (this.activeIndex + 1) % this.keyPairs.length;
    this.rotationCount += 1;
    this.lastRotationTimestamp = new Date().toISOString();
    this.lastRotationReason = reason;

    const nextKey = this.keyPairs[this.activeIndex];

    console.warn(
      `[TDX 金鑰輪流系統] 金鑰組切換 #${this.rotationCount}：從「${currentKey.label}」(${this.maskString(
        currentKey.clientId
      )}) 輪轉切換至「${nextKey.label}」(${this.maskString(nextKey.clientId)})。原因：${reason}`
    );

    return nextKey;
  }

  /**
   * 請求指定金鑰組的 TDX Access Token (具備 18s 逾時與輕量重試)
   */
  private async requestTokenForPair(pair: TdxKeyPair): Promise<string> {
    const cached = this.tokenCache.get(pair.id);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.accessToken;
    }

    const authUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
    const requestBody = `grant_type=client_credentials&client_id=${encodeURIComponent(
      pair.clientId
    )}&client_secret=${encodeURIComponent(pair.clientSecret)}`;

    const response = await fetchWithTimeoutAndRetry(
      authUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: requestBody,
      },
      18000,
      2,
      1500
    );

    const status = response.status;
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.toLowerCase().includes("json");

    if (!response.ok) {
      let errText = "";
      if (isJson) {
        try {
          const errObj = await response.json();
          errText = errObj.error_description || errObj.error || errObj.message || JSON.stringify(errObj);
        } catch {
          errText = response.statusText;
        }
      } else {
        const raw = await response.text().catch(() => "");
        errText = raw.length > 200 ? raw.substring(0, 200) + "..." : raw;
      }
      const err = new Error(`TDX 認證伺服器回應失敗 (${status}): ${errText}`);
      (err as any).isAuthError = status === 400 || status === 401 || status === 403 || status === 429;
      (err as any).isServerError = status === 500 || status === 502 || status === 503 || status === 504;
      throw err;
    }

    if (!isJson) {
      const raw = await response.text().catch(() => "");
      throw new Error(`TDX 認證伺服器回傳非 JSON 資料 (Content-Type: ${contentType})：${raw.substring(0, 100)}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error("TDX 未回傳有效的 access_token");
    }

    const expiresInSec = data.expires_in || 86400;
    this.tokenCache.set(pair.id, {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresInSec * 1000,
      keyId: pair.id,
    });

    pair.isHealthy = true;
    pair.failCount = 0;
    pair.lastUsedTimestamp = Date.now();

    return data.access_token;
  }

  /**
   * 取得有效的 Access Token (具備多組金鑰自動輪轉與重試保障)
   */
  public async getValidAccessToken(): Promise<{ token: string; keyPair: TdxKeyPair }> {
    const totalKeys = this.keyPairs.length;
    if (totalKeys === 0) {
      this.initializeKeys();
    }
    const maxAttempts = Math.max(1, this.keyPairs.length);
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentPair = this.getActiveKeyPair();
      try {
        const token = await this.requestTokenForPair(currentPair);
        return { token, keyPair: currentPair };
      } catch (err: any) {
        lastError = err;
        const msg = err.message || "";
        console.warn(`[TDX 金鑰輪流系統] 金鑰組「${currentPair.label}」獲取 Token 失敗：`, msg);
        // 標記失敗計數並切換至下一組金鑰繼續嘗試
        this.rotateToNextKey(`Token 請求異常 (${msg})`);
      }
    }

    throw new Error(
      `所有 TDX 金鑰組皆無法成功獲取 Token (共嘗試 ${maxAttempts} 組)。最後錯誤：${lastError?.message || "認證失敗"}`
    );
  }

  /**
   * 執行帶有金鑰自動輪轉與失效切換保護的 TDX API 請求 (Failover Round-Robin Execution)
   */
  public async executeWithFailover<T>(
    endpointUrl: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
    } = {}
  ): Promise<{ data: T; usedKeyPair: TdxKeyPair; attempts: number; isFromCache?: boolean }> {
    const totalKeys = this.keyPairs.length;
    if (totalKeys === 0) {
      this.initializeKeys();
    }
    const maxAttempts = Math.max(1, this.keyPairs.length);
    let lastError: any = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let activePair: TdxKeyPair | null = null;
      try {
        const { token, keyPair } = await this.getValidAccessToken();
        activePair = keyPair;

        const reqHeaders = {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(options.headers || {}),
        };

        const response = await fetchWithTimeoutAndRetry(
          endpointUrl,
          {
            method: options.method || "GET",
            headers: reqHeaders,
            body: options.body,
          },
          10000,
          1,
          1000
        );

        const status = response.status;
        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.toLowerCase().includes("json");

        // 步驟二：智能區分金鑰失效與伺服器延遲/端點錯誤
        // 1. 收到 HTTP 401（認證錯誤）、403（金鑰無效）或 429（超過呼叫配額）時，切換至下一組備用金鑰
        if (status === 401 || status === 403 || status === 429) {
          const errText = await response.text().catch(() => "");
          const cleanErr = errText.length > 200 ? errText.substring(0, 200) + "..." : errText;
          console.warn(
            `[TDX 金鑰輪流系統] 金鑰「${keyPair.label}」遭遇授權或限流 HTTP ${status}，自動切換至下一組金鑰...`
          );
          this.tokenCache.delete(keyPair.id);
          this.rotateToNextKey(`遭遇 HTTP ${status}: ${cleanErr}`);
          continue;
        }

        // 2. 若遇 404 (Resource Not Found) 或 400 (Bad Request)，代表是 URL 路徑或過濾參數不存在
        if (status === 404) {
          throw new Error(`TDX 數據端點找不到資源 (HTTP 404)。請確認端點路徑。`);
        }
        if (status === 400) {
          const rawErr = await response.text().catch(() => "");
          throw new Error(`TDX 數據端點參數請求錯誤 (HTTP 400): ${rawErr.slice(0, 120)}`);
        }

        // 3. 若遇到 500、502、503、504，伺服器不穩
        if (status === 500 || status === 502 || status === 503 || status === 504) {
          throw new Error(`TDX 官方伺服器暫時不穩 (HTTP ${status})，伺服器回應過慢或維護中`);
        }

        if (!response.ok) {
          let errText = "";
          if (isJson) {
            try {
              const errObj = await response.json();
              errText = errObj.error_description || errObj.error || errObj.message || JSON.stringify(errObj);
            } catch {
              errText = `HTTP ${status} ${response.statusText}`;
            }
          } else {
            const raw = await response.text().catch(() => "");
            errText = raw.includes("<!DOCTYPE") || raw.includes("<html")
              ? `伺服器回應 HTML 頁面 (可能是 404 或代理路徑不存在)`
              : raw.substring(0, 150);
          }
          throw new Error(`TDX 數據端點回應錯誤 (${status}): ${errText}`);
        }

        let parsedData: T;
        if (!isJson) {
          const rawText = await response.text().catch(() => "");
          if (rawText.includes("<!DOCTYPE") || rawText.includes("<html")) {
            throw new Error(`TDX 端點回傳 HTML 頁面而非 JSON 格式 (狀態碼: HTTP ${status})。請確認 API 網址。`);
          }
          try {
            parsedData = JSON.parse(rawText) as T;
          } catch {
            throw new Error(`TDX 回傳格式不符 (Content-Type: ${contentType})，無法解析 JSON。`);
          }
        } else {
          parsedData = (await response.json()) as T;
        }

        keyPair.lastUsedTimestamp = Date.now();
        keyPair.isHealthy = true;
        keyPair.failCount = 0;

        // 寫入記憶體即時快取 (5 分鐘寬裕容錯備援)
        this.responseCache.set(endpointUrl, { data: parsedData, timestamp: Date.now() });

        return {
          data: parsedData,
          usedKeyPair: keyPair,
          attempts: attempt + 1,
        };
      } catch (err: any) {
        lastError = err;
        const msg = err.message || "";
        const targetPair = activePair || this.getActiveKeyPair();

        // 若是 404 或 400，直接拋出不需輪轉
        if (msg.includes("404") || msg.includes("400") || msg.includes("HTML 頁面")) {
          throw err;
        }

        console.warn(`[TDX 金鑰輪流系統] 透過「${targetPair.label}」請求數據失敗：`, msg);
        this.rotateToNextKey(`API 請求異常: ${msg}`);
      }
    }

    // 若所有即時請求輪轉皆耗盡，嘗試讀取最近 10 分鐘內之記憶體成功快取進行無縫容錯
    const cachedEntry = this.responseCache.get(endpointUrl);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < 600000) {
      console.warn("[TDX 金鑰輪流系統] 啟動記憶體快取容錯保護，平滑輸出最近有效遙測資料");
      return {
        data: cachedEntry.data as T,
        usedKeyPair: this.getActiveKeyPair(),
        attempts: maxAttempts,
        isFromCache: true,
      };
    }

    throw new Error(
      `所有 TDX 金鑰輪替嘗試皆失敗 (共測試 ${maxAttempts} 組金鑰)。最後異常：${lastError?.message || "連線逾時"}`
    );
  }

  /**
   * 取得當前輪流系統診斷與健康狀態 (遮罩敏感密鑰)
   */
  public getStatus(): TdxKeyManagerStatus {
    const activeKey = this.getActiveKeyPair();
    return {
      totalKeys: this.keyPairs.length,
      activeKeyIndex: this.activeIndex,
      activeKeyLabel: activeKey.label,
      activeClientIdMasked: this.maskString(activeKey.clientId),
      rotationCount: this.rotationCount,
      lastRotationTimestamp: this.lastRotationTimestamp,
      lastRotationReason: this.lastRotationReason,
      keysStatus: this.keyPairs.map((k, idx) => ({
        index: idx,
        id: k.id,
        label: k.label,
        clientIdMasked: this.maskString(k.clientId),
        isHealthy: k.isHealthy,
        failCount: k.failCount,
        lastError: k.lastError,
      })),
    };
  }
}

// 導出全域單例模式管理器 (Singleton Instance)
export const globalTdxKeyManager = new TdxKeyRotationSystem();
