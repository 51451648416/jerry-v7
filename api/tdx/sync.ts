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

// 取得環境變數與 Redis 中的多組金鑰輪替池與備援金鑰
async function getTdxKeyPool(redis: Redis | null): Promise<TdxKeyConfig[]> {
  const pool: TdxKeyConfig[] = [];

  // 1. 優先自 Redis 讀取全域金鑰 (tdx_keys 或 hsuehshan:config:keys)
  if (redis) {
    try {
      const customData: any = (await redis.get("tdx_keys")) || (await redis.get("hsuehshan:config:keys"));
      const keysArray = Array.isArray(customData) ? customData : customData?.keys;
      if (Array.isArray(keysArray)) {
        keysArray.forEach((k: any, idx: number) => {
          if (k.isEnabled !== false && k.clientId && k.clientSecret) {
            pool.push({
              id: k.id || `custom-${idx + 1}`,
              clientId: String(k.clientId).trim(),
              clientSecret: String(k.clientSecret).trim(),
              label: k.label || `自訂金鑰組 #${idx + 1}`,
            });
          }
        });
      }
    } catch {}
  }

  // 2. 讀取環境變數中的多組金鑰
  if (process.env.TDX_API_KEYS) {
    try {
      const parsed = JSON.parse(process.env.TDX_API_KEYS);
      if (Array.isArray(parsed)) {
        parsed.forEach((k: any, idx: number) => {
          if (k && k.clientId && k.clientSecret && !pool.some((p) => p.clientId === k.clientId)) {
            pool.push({
              id: k.id || `env-json-${idx + 1}`,
              clientId: String(k.clientId).trim(),
              clientSecret: String(k.clientSecret).trim(),
              label: k.label || `環境變數金鑰 #${idx + 1}`,
            });
          }
        });
      }
    } catch {}
  }

  for (let i = 1; i <= 5; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const cid = (process.env[`TDX_CLIENT_ID${suffix}`] || "").trim();
    const csec = (process.env[`TDX_CLIENT_SECRET${suffix}`] || "").trim();
    if (cid && csec && !pool.some((p) => p.clientId === cid)) {
      pool.push({
        id: `set-${i}`,
        clientId: cid,
        clientSecret: csec,
        label: i === 1 ? "金鑰組 #1 (主要)" : `金鑰組 #${i} (輪替)`,
      });
    }
  }

  // 3. 備援預設有效金鑰池 (已驗證之官方認證金鑰組)
  const builtInBackup: TdxKeyConfig[] = [
    {
      id: "builtin-1",
      clientId: "jerry0903-d82c8d89-56b2-4628",
      clientSecret: "5fdae95b-b2d6-4b80-a153-2238d6e74db5",
      label: "系統主要金鑰 #1",
    },
    {
      id: "builtin-2",
      clientId: "jerry0903-04044e4d-e59f-4e8d",
      clientSecret: "d14df9b8-d005-4ce7-b7f5-5ac5fbb6d531",
      label: "系統備援金鑰 #2",
    },
    {
      id: "builtin-3",
      clientId: "jerry09032-2cdccf91-accf-4ea4",
      clientSecret: "be155ae3-84ba-4e41-92c4-7037799d0e6a",
      label: "系統備援金鑰 #3",
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

// 輔助函式：遍歷 TDX VD 資料中各 LinkFlows/Lanes 之 Vehicles，統計各車種流量與即時車速
export function parseVehicleBreakdown(vdData: any) {
  const rawList: any[] = Array.isArray(vdData?.VDLives)
    ? vdData.VDLives
    : Array.isArray(vdData)
    ? vdData
    : Array.isArray(vdData?.data)
    ? vdData.data
    : [];

  let totalSmall = 0;
  let totalLarge = 0;
  let totalTruck = 0;

  let northSmall = 0;
  let northLarge = 0;
  let northTruck = 0;

  let southSmall = 0;
  let southLarge = 0;
  let southTruck = 0;

  let smallSpeedSum = 0;
  let smallSpeedCount = 0;
  let largeSpeedSum = 0;
  let largeSpeedCount = 0;

  for (const item of rawList) {
    if (!item) continue;
    const vdid = String(item.VDID || item.detectorId || "");
    const isNorth =
      /-N-|-NB-|-N(?=[-_]|$)|北向|北上|\bNB\b/i.test(vdid) ||
      String(item.Direction || "").toUpperCase() === "N";
    const isSouth =
      /-S-|-SB-|-S(?=[-_]|$)|南向|南下|\bSB\b/i.test(vdid) ||
      String(item.Direction || "").toUpperCase() === "S";

    // 完整遍歷所有 LinkFlows 底下的 Lanes
    const linkFlows = Array.isArray(item.LinkFlows) ? item.LinkFlows : [];
    const lanesList: any[] = [];

    if (linkFlows.length > 0) {
      for (const lf of linkFlows) {
        if (Array.isArray(lf?.Lanes)) {
          lanesList.push(...lf.Lanes);
        }
      }
    } else if (Array.isArray(item.Lanes)) {
      lanesList.push(...item.Lanes);
    } else if (Array.isArray(item.lanes)) {
      lanesList.push(...item.lanes);
    }

    for (const lane of lanesList) {
      if (!lane) continue;
      if (Array.isArray(lane.Vehicles) && lane.Vehicles.length > 0) {
        for (const v of lane.Vehicles) {
          const vol = typeof v.Volume === "number" ? v.Volume : 0;
          const spd = typeof v.Speed === "number" && v.Speed > 0 ? v.Speed : 0;
          const vType = String(v.VehicleType || "").trim().toUpperCase();

          if (vType === "S" || vType === "SMALL" || vType === "1" || vType === "CAR") {
            totalSmall += vol;
            if (isNorth) northSmall += vol;
            if (isSouth) southSmall += vol;
            if (vol > 0 && spd > 0) {
              smallSpeedSum += vol * spd;
              smallSpeedCount += vol;
            }
          } else if (vType === "L" || vType === "LARGE" || vType === "2" || vType === "BUS") {
            totalLarge += vol;
            if (isNorth) northLarge += vol;
            if (isSouth) southLarge += vol;
            if (vol > 0 && spd > 0) {
              largeSpeedSum += vol * spd;
              largeSpeedCount += vol;
            }
          } else if (vType === "T" || vType === "TRUCK" || vType === "3" || vType === "TRAILER" || vType === "TT") {
            totalTruck += vol;
            if (isNorth) northTruck += vol;
            if (isSouth) southTruck += vol;
          } else {
            // 未特別指定車種者預設歸為小型車
            totalSmall += vol;
            if (isNorth) northSmall += vol;
            if (isSouth) southSmall += vol;
            if (vol > 0 && spd > 0) {
              smallSpeedSum += vol * spd;
              smallSpeedCount += vol;
            }
          }
        }
      } else if (typeof lane.Volume === "number" && lane.Volume > 0) {
        totalSmall += lane.Volume;
        if (isNorth) northSmall += lane.Volume;
        if (isSouth) southSmall += lane.Volume;
      }
    }
  }

  const smallSpeedKmh = smallSpeedCount > 0 ? Math.round(smallSpeedSum / smallSpeedCount) : 75;
  const largeSpeedKmh = largeSpeedCount > 0 ? Math.round(largeSpeedSum / largeSpeedCount) : 72;

  return {
    small: totalSmall,
    large: totalLarge,
    truck: totalTruck,
    total: totalSmall + totalLarge,
    smallSpeedKmh,
    largeSpeedKmh,
    north: {
      small: northSmall,
      large: northLarge,
      truck: northTruck,
      total: northSmall + northLarge,
    },
    south: {
      small: southSmall,
      large: southLarge,
      truck: southTruck,
      total: southSmall + southLarge,
    },
  };
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
  const keyPool = await getTdxKeyPool(redis);

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

    // 解析車種流量 (S/L/T) 與即時平均車速
    const vehicleBreakdown = parseVehicleBreakdown(vdData);

    const now = Date.now();
    const payload = {
      syncedAt: now,
      timestamp: new Date(now).toISOString(),
      vdData,
      liveEvents: liveEventsData,
      rampMetering: rampMeterData,
      vehicleBreakdown,
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
      vehicleBreakdown,
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
