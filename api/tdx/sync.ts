import { Redis } from "@upstash/redis";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

// 定義 3 組金鑰設定介面
interface TdxKeyConfig {
  id: string;
  clientId: string;
  clientSecret: string;
  label: string;
}

// 記憶體 Token 快取 (當 Redis 不可用時備援)
const memoryTokenCache = new Map<string, { token: string; expiresAt: number }>();

// 取得環境變數中的 3 組金鑰輪替池與備援金鑰
function getTdxKeyPool(): TdxKeyConfig[] {
  const pool: TdxKeyConfig[] = [];

  // Set 1
  const id1 = process.env.TDX_CLIENT_ID || process.env.TDX_CLIENT_ID_1 || "";
  const sec1 = process.env.TDX_CLIENT_SECRET || process.env.TDX_CLIENT_SECRET_1 || "";
  if (id1 && sec1) {
    pool.push({ id: "set-1", clientId: id1.trim(), clientSecret: sec1.trim(), label: "金鑰組 #1 (主要)" });
  }

  // Set 2
  const id2 = process.env.TDX_CLIENT_ID_2 || "";
  const sec2 = process.env.TDX_CLIENT_SECRET_2 || "";
  if (id2 && sec2) {
    pool.push({ id: "set-2", clientId: id2.trim(), clientSecret: sec2.trim(), label: "金鑰組 #2 (輪替)" });
  }

  // Set 3
  const id3 = process.env.TDX_CLIENT_ID_3 || "";
  const sec3 = process.env.TDX_CLIENT_SECRET_3 || "";
  if (id3 && sec3) {
    pool.push({ id: "set-3", clientId: id3.trim(), clientSecret: sec3.trim(), label: "金鑰組 #3 (輪替)" });
  }

  // 備援預設金鑰池 (若環境變數未填滿 3 組)
  const builtInBackup: TdxKeyConfig[] = [
    {
      id: "builtin-1",
      clientId: "lovefiy0903-f8d75808-3306-4327",
      clientSecret: "3b2a8558-8fb3-43ec-ada7-14f59e3476b4",
      label: "系統內建金鑰 #1",
    },
    {
      id: "builtin-2",
      clientId: "jerry0903-d82c8d89-56b2-4628",
      clientSecret: "5fdae95b-b2d6-4b80-a153-2238d6e74db5",
      label: "系統內建金鑰 #2",
    },
  ];

  for (const b of builtInBackup) {
    if (!pool.some((k) => k.clientId === b.clientId)) {
      pool.push(b);
    }
  }

  return pool;
}

// 取得 Redis 客戶端
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      return new Redis({ url, token });
    } catch (e) {
      console.warn("[TDX Sync] Upstash Redis 連線失敗:", e);
    }
  }
  return null;
}

// 取得或快取單一金鑰之 TDX Access Token
async function getOrFetchToken(
  key: TdxKeyConfig,
  redis: Redis | null
): Promise<string> {
  const now = Date.now();
  const cacheKey = `hsuehshan:tdx:token:${key.id}`;

  // 1. 檢查 Redis 快取
  if (redis) {
    try {
      const cachedToken = await redis.get<string>(cacheKey);
      if (cachedToken && typeof cachedToken === "string") {
        return cachedToken;
      }
    } catch {}
  }

  // 2. 檢查記憶體快取
  const mem = memoryTokenCache.get(key.id);
  if (mem && mem.expiresAt > now + 60000) {
    return mem.token;
  }

  // 3. 向 TDX 官方認證伺服器換發 Token
  const authUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
  const bodyParams = new URLSearchParams();
  bodyParams.append("grant_type", "client_credentials");
  bodyParams.append("client_id", key.clientId);
  bodyParams.append("client_secret", key.clientSecret);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`TDX Token Auth HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }

    const data = await res.json();
    const token = data.access_token;
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 86400;

    if (!token) {
      throw new Error("TDX 認證回應未包含 access_token");
    }

    // 快取 Token (提前 120 秒過期)
    const ttlSec = Math.max(60, expiresIn - 120);
    memoryTokenCache.set(key.id, { token, expiresAt: now + ttlSec * 1000 });

    if (redis) {
      try {
        await redis.set(cacheKey, token, { ex: ttlSec });
      } catch {}
    }

    return token;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 帶金鑰輪替執行 TDX GET 請求
async function fetchTdxDataWithFailover<T>(
  url: string,
  keyPool: TdxKeyConfig[],
  redis: Redis | null,
  startIndex = 0
): Promise<{ data: T; keyUsed: string }> {
  let lastError: any = null;

  for (let i = 0; i < keyPool.length; i++) {
    const keyIndex = (startIndex + i) % keyPool.length;
    const key = keyPool[keyIndex];

    try {
      const token = await getOrFetchToken(key, redis);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as T;
        return { data, keyUsed: `${key.label} (${key.clientId.slice(0, 8)}...)` };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[TDX Sync] 金鑰 ${key.label} 請求失敗，自動輪替至下一組:`, err.message);
    }
  }

  throw lastError || new Error("所有 TDX 輪替金鑰皆無法成功獲取資料");
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const startTime = Date.now();
  const redis = getRedis();
  const keyPool = getTdxKeyPool();

  try {
    // 1. 取得當前 Round-Robin 輪替指標
    let currentKeyIndex = 0;
    if (redis) {
      try {
        const storedIndex = await redis.get<number>("hsuehshan:tdx:key_index");
        if (typeof storedIndex === "number") {
          currentKeyIndex = storedIndex % keyPool.length;
        }
      } catch {}
    }

    // 2. 抓取國道 5 號之 VD 車速、流量
    const vdUrl =
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";
    const liveEventsUrl =
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/LiveEvent/Freeway?$filter=contains(Location/FreeExpressHighway/Road,%20%27國道5號%27)&$format=JSON";
    const rampMeterUrl =
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/RampMetering/Freeway?$format=JSON&$filter=FreewayID%20eq%20%27國道5號%27";

    const [vdRes, liveEventsRes, rampMeterRes] = await Promise.allSettled([
      fetchTdxDataWithFailover<any>(vdUrl, keyPool, redis, currentKeyIndex),
      fetchTdxDataWithFailover<any>(liveEventsUrl, keyPool, redis, currentKeyIndex),
      fetchTdxDataWithFailover<any>(rampMeterUrl, keyPool, redis, currentKeyIndex),
    ]);

    if (vdRes.status !== "fulfilled") {
      throw new Error(`VD 車流資料獲取失敗: ${vdRes.reason?.message || "Unknown error"}`);
    }

    const vdData = vdRes.value.data;
    const keyUsed = vdRes.value.keyUsed;
    const liveEventsData = liveEventsRes.status === "fulfilled" ? liveEventsRes.value.data : { LiveEvents: [] };
    const rampMeterData = rampMeterRes.status === "fulfilled" ? rampMeterRes.value.data : [];

    const now = Date.now();
    const payload = {
      syncedAt: now,
      timestamp: new Date(now).toISOString(),
      vdData,
      liveEvents: liveEventsData,
      rampMetering: rampMeterData,
      keyUsed,
      executionMs: Date.now() - startTime,
      status: "OK",
    };

    // 3. 寫入 Redis Key hsuehshan:tdx:traffic_realtime (TTL: 90 秒，涵蓋 60 秒排程並提供 30 秒容錯)
    if (redis) {
      try {
        await redis.set("hsuehshan:tdx:traffic_realtime", JSON.stringify(payload), { ex: 90 });
        // 更新下一組金鑰輪替索引
        const nextIndex = (currentKeyIndex + 1) % keyPool.length;
        await redis.set("hsuehshan:tdx:key_index", nextIndex, { ex: 86400 });
      } catch (rErr) {
        console.error("[TDX Sync] 寫入 Redis 失敗:", rErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: "TDX 國道 5 號交通數據已成功同步至 Redis 快取池",
      key: "hsuehshan:tdx:traffic_realtime",
      ttl: 90,
      syncedAt: new Date(now).toISOString(),
      keyUsed,
      recordsCount: Array.isArray(vdData) ? vdData.length : (vdData?.VDLives?.length || 0),
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error("[TDX Sync] 同步發生錯誤:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message || "TDX 數據同步失敗",
      durationMs: Date.now() - startTime,
    });
  }
}
