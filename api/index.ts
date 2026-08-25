import { Redis } from "@upstash/redis";

const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = req.url || "";
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  try {
    // 1. 金鑰相關
    if (url.includes("keys")) {
      if (req.method === "GET") {
        const data = redis ? await redis.get("tdx_keys") : null;
        return res.status(200).json({ success: true, data });
      }
      if (req.method === "POST") {
        if (redis) await redis.set("tdx_keys", body);
        return res.status(200).json({ success: true });
      }
    }

    // 2. 模型參數相關
    if (url.includes("model")) {
      if (req.method === "GET") {
        const data = redis ? await redis.get("model_weights") : null;
        return res.status(200).json({ success: true, data });
      }
      if (req.method === "POST") {
        if (redis) await redis.set("model_weights", body);
        return res.status(200).json({ success: true });
      }
    }

    // 3. 資料集相關
    if (url.includes("dataset") || url.includes("data")) {
      if (req.method === "GET") {
        const data = redis ? await redis.get("dataset_records") : [];
        return res.status(200).json({ success: true, data: data || [] });
      }
      if (req.method === "POST") {
        if (redis) {
          let current: any = (await redis.get("dataset_records")) || [];
          if (typeof current === "string") {
            try { current = JSON.parse(current); } catch {}
          }
          const map = new Map<string, any>();
          for (const item of (Array.isArray(current) ? current : [])) {
            if (item && typeof item === "object") {
              const id = item.id || `item_${item.timestamp || Math.random()}`;
              map.set(id, item);
            }
          }
          if (Array.isArray(body)) {
            for (const item of body) {
              if (item && typeof item === "object") {
                const id = item.id || `item_${item.timestamp || Math.random()}`;
                map.set(id, item);
              }
            }
          } else if (body && typeof body === "object") {
            const id = body.id || `item_${body.timestamp || Math.random()}`;
            map.set(id, body);
          }
          const merged = Array.from(map.values())
            .sort((a: any, b: any) => (b.unixTimestampMs || b.timestamp || 0) - (a.unixTimestampMs || a.timestamp || 0))
            .slice(0, 400);
          await redis.set("dataset_records", merged);
        }
        return res.status(200).json({ success: true });
      }
    }

    // 4. 端點設定
    if (url.includes("endpoint")) {
      if (req.method === "GET") {
        const data = redis ? await redis.get("custom_endpoint") : null;
        return res.status(200).json({ success: true, data });
      }
      if (req.method === "POST") {
        if (redis) await redis.set("custom_endpoint", body);
        return res.status(200).json({ success: true });
      }
    }

    return res.status(200).json({ success: true, message: "OK" });
  } catch (err: any) {
    return res.status(200).json({ success: false, error: err.message });
  }
}
