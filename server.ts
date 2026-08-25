import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Redis } from "@upstash/redis";
import { globalTdxKeyManager } from "./src/services/tdxKeyRotator";

// Lazy Upstash Redis Client with Safe Fallback
let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
      return redisClient;
    } catch (e) {
      console.warn("Upstash Redis 初始化失敗，將自動切換為本機記憶體備援模式:", e);
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON request bodies
  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", async (req, res) => {
    const redis = getRedis();
    let redisConnected = false;
    if (redis) {
      try {
        await redis.ping();
        redisConnected = true;
      } catch {
        redisConnected = false;
      }
    }
    res.json({
      status: "ok",
      redisConnected,
      mode: redisConnected ? "upstash_redis_cloud" : "local_memory_fallback",
      timestamp: new Date().toISOString(),
    });
  });

  // Global in-memory storage for Model Weights
  let globalLearnedWeights: any = null;

  // Global shared training state
  let globalSharedModelWeights: any = null;
  let globalSharedDatasetRecords: any[] = [];
  let globalSavedTdxKeys: any = null;
  let globalSavedApiConfig: any = null;

  // Standard Vercel Serverless Equivalent Endpoints (/api/keys, /api/model, /api/dataset)
  app.get("/api/keys", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSavedTdxKeys;
      if (redis) {
        data = (await redis.get("tdx_keys")) || (await redis.get("hsuehshan:config:keys")) || data;
      }
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/keys", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      globalSavedTdxKeys = body;
      const keysArray = Array.isArray(body) ? body : body?.keys;
      if (Array.isArray(keysArray)) {
        globalTdxKeyManager.setCustomKeys(keysArray);
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("tdx_keys", body);
        await redis.set("hsuehshan:config:keys", body);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/model", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSharedModelWeights || globalLearnedWeights;
      if (redis) {
        data = (await redis.get("model_weights")) || (await redis.get("hsuehshan:shared:model")) || data;
      }
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/model", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      globalSharedModelWeights = body;
      globalLearnedWeights = body;
      const redis = getRedis();
      if (redis) {
        await redis.set("model_weights", body);
        await redis.set("hsuehshan:shared:model", body);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/dataset", async (req, res) => {
    try {
      const redis = getRedis();
      let data = globalSharedDatasetRecords;
      if (redis) {
        data = (await redis.get("dataset_records")) || (await redis.get("hsuehshan:shared:dataset")) || data || [];
      }
      return res.json({ success: true, data: data || [] });
    } catch (e: any) {
      return res.json({ success: false, error: e.message });
    }
  });

  app.post("/api/dataset", async (req, res) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const redis = getRedis();
      if (Array.isArray(body)) {
        globalSharedDatasetRecords = body.slice(-400);
      } else if (body) {
        globalSharedDatasetRecords.push(body);
        if (globalSharedDatasetRecords.length > 400) {
          globalSharedDatasetRecords = globalSharedDatasetRecords.slice(-400);
        }
      }
      if (redis) {
        let current: any[] = (await redis.get("dataset_records")) || (await redis.get("hsuehshan:shared:dataset")) || [];
        if (Array.isArray(body)) {
          current = body;
        } else if (body) {
          current.push(body);
          if (current.length > 400) current = current.slice(-400);
        }
        await redis.set("dataset_records", current);
        await redis.set("hsuehshan:shared:dataset", current);
      }
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // 模型權重共用 API (支援 Upstash Redis 與 In-Memory 雙重同步)
  app.get("/api/shared/model", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:model");
        if (cached) {
          globalSharedModelWeights = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型失敗，切換至本機快取:", err);
    }
    return res.json(globalSharedModelWeights || { success: false, message: "No model trained yet" });
  });

  app.post("/api/shared/model", async (req, res) => {
    try {
      globalSharedModelWeights = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:model", req.body);
      }
      return res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 訓練資料集共用 API (支援 Upstash Redis 與 In-Memory 雙重同步)
  app.get("/api/shared/dataset", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:shared:dataset");
        if (Array.isArray(cached)) {
          globalSharedDatasetRecords = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 資料集失敗，切換至本機快取:", err);
    }
    return res.json(globalSharedDatasetRecords);
  });

  app.post("/api/shared/dataset", async (req, res) => {
    try {
      if (Array.isArray(req.body)) {
        globalSharedDatasetRecords = req.body.slice(0, 1000);
      } else if (req.body && typeof req.body === "object") {
        globalSharedDatasetRecords.unshift(req.body);
        if (globalSharedDatasetRecords.length > 1000) {
          globalSharedDatasetRecords = globalSharedDatasetRecords.slice(0, 1000);
        }
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:shared:dataset", globalSharedDatasetRecords);
      }
      return res.json({ success: true, total: globalSharedDatasetRecords.length });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Compatibility Endpoint for /api/config/keys
  app.get("/api/config/keys", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:keys");
        if (cached) {
          globalSavedTdxKeys = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 金鑰失敗，切換至本機快取:", err);
    }
    if (!globalSavedTdxKeys) return res.json([]);
    return res.json(globalSavedTdxKeys);
  });

  app.post("/api/config/keys", async (req, res) => {
    try {
      globalSavedTdxKeys = req.body;
      const keysArray = Array.isArray(req.body) ? req.body : req.body?.keys;
      if (Array.isArray(keysArray)) {
        globalTdxKeyManager.setCustomKeys(keysArray);
      }
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:keys", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/config/endpoint", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:config:endpoint");
        if (cached) {
          globalSavedApiConfig = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis API 設定失敗，切換至本機快取:", err);
    }
    if (!globalSavedApiConfig) return res.status(404).json({ error: "No api config found" });
    return res.json(globalSavedApiConfig);
  });

  app.post("/api/config/endpoint", async (req, res) => {
    try {
      globalSavedApiConfig = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:config:endpoint", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/model/weights", async (req, res) => {
    try {
      const redis = getRedis();
      if (redis) {
        const cached = await redis.get("hsuehshan:model:weights");
        if (cached) {
          globalLearnedWeights = cached;
          return res.json(cached);
        }
      }
    } catch (err) {
      console.warn("讀取 Redis 模型權重失敗，切換至本機快取:", err);
    }
    if (!globalLearnedWeights) {
      return res.status(404).json({ error: "No global weights found" });
    }
    return res.json(globalLearnedWeights);
  });

  app.post("/api/model/weights", async (req, res) => {
    try {
      globalLearnedWeights = req.body;
      const redis = getRedis();
      if (redis) {
        await redis.set("hsuehshan:model:weights", req.body);
      }
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // TDX Key Rotation System Status
  app.get("/api/tdx/keys/status", (req, res) => {
    try {
      const status = globalTdxKeyManager.getStatus();
      return res.json(status);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Sync custom keys to server TDX Key Rotation Manager
  app.post("/api/tdx/keys/sync", (req, res) => {
    try {
      const { keys } = req.body;
      if (Array.isArray(keys)) {
        globalTdxKeyManager.setCustomKeys(keys);
        return res.json({ success: true, count: keys.length, status: globalTdxKeyManager.getStatus() });
      }
      return res.status(400).json({ error: "Invalid keys array payload" });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Unified endpoint for Freeway VD data with Automatic Key Rotation & Failover
  const handleFreewayVd = async (req: express.Request, res: express.Response) => {
    try {
      const tdxUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/Freeway?$filter=startswith(VDID,%20%27VD-N5%27)&$format=JSON";

      const result = await globalTdxKeyManager.executeWithFailover<any>(tdxUrl);
      return res.json(result.data);
    } catch (err: any) {
      console.error("TDX Freeway-VD fetch error:", err);
      return res.status(502).json({
        error: err.message || "無法連線至交通部 TDX 伺服器，所有金鑰輪轉嘗試皆未成功，請稍後重試",
      });
    }
  };

  app.get("/api/tdx/freeway-vd", handleFreewayVd);
  app.get("/api/v1/freeway-vd", handleFreewayVd);
  app.get("/api/traffic/vd", handleFreewayVd);
  app.get("/api/n5/vd", handleFreewayVd);

  // Unified endpoint for Freeway Live Events data with Automatic Key Rotation & Failover
  const handleFreewayLiveEvents = async (req: express.Request, res: express.Response) => {
    try {
      // TDX API: 國道即時路況事件端點
      const tdxEventsUrl =
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/LiveEvent/Freeway?$filter=contains(Location/FreeExpressHighway/Road,%20%27國道5號%27)&$format=JSON";

      try {
        const result = await globalTdxKeyManager.executeWithFailover<any>(tdxEventsUrl);
        return res.json(result.data);
      } catch (innerErr: any) {
        // 若端點無事件或過濾結果為空/返回 404，依規範安全回傳空事件結構，不中斷系統
        console.info("TDX 即時事件端點返回無活躍事件或路徑通知，回傳空事件結構");
        return res.json({
          UpdateTime: new Date().toISOString(),
          UpdateInterval: 300,
          LiveEvents: [],
        });
      }
    } catch (err: any) {
      console.error("TDX Freeway Live Events fetch error:", err);
      return res.json({
        UpdateTime: new Date().toISOString(),
        UpdateInterval: 300,
        LiveEvents: [],
      });
    }
  };

  app.get("/api/tdx/freeway-live-events", handleFreewayLiveEvents);
  app.get("/api/v1/freeway-live-events", handleFreewayLiveEvents);
  app.get("/api/traffic/live-events", handleFreewayLiveEvents);
  app.get("/api/n5/events", handleFreewayLiveEvents);

  // TDX Auth Token Proxy (compatibility with rotation fallback)
  app.post("/api/tdx/token", async (req, res) => {
    try {
      const { clientId, clientSecret } = req.body;
      if (clientId && clientSecret) {
        // If specific credentials passed, use direct token request
        const authUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
        const requestBody = `grant_type=client_credentials&client_id=${encodeURIComponent(
          clientId
        )}&client_secret=${encodeURIComponent(clientSecret)}`;

        const response = await fetch(authUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: requestBody,
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).json({ error: `TDX 認證伺服器回應錯誤: ${errText}` });
        }

        const data = await response.json();
        return res.json({ access_token: data.access_token });
      }

      // Default: Use rotation manager
      const { token } = await globalTdxKeyManager.getValidAccessToken();
      return res.json({ access_token: token });
    } catch (err: any) {
      console.error("Error in /api/tdx/token proxy:", err);
      return res.status(500).json({ error: err.message || "TDX 連線認證失敗" });
    }
  });

  // TDX Data Proxy
  app.get("/api/tdx/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      const authHeader = req.headers.authorization;

      if (!targetUrl) {
        return res.status(400).json({ error: "Missing 'url' query parameter" });
      }
      if (!authHeader) {
        return res.status(400).json({ error: "Missing 'Authorization' header" });
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `TDX fetch failed: ${errText}` });
      }

      const data = await response.json();
      return res.json(data);
    } catch (err: any) {
      console.error("Error in /api/tdx/proxy:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
