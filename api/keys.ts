import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function getFallbackEnvKeys(): any[] {
  const keys: any[] = [];
  if (process.env.TDX_API_KEYS) {
    try {
      const parsed = JSON.parse(process.env.TDX_API_KEYS);
      if (Array.isArray(parsed)) {
        parsed.forEach((k: any, i: number) => {
          if (k && k.clientId && k.clientSecret) {
            keys.push({
              id: k.id || `key-env-json-${i + 1}`,
              clientId: String(k.clientId).trim(),
              clientSecret: String(k.clientSecret).trim(),
              label: k.label || `TDX 雲端金鑰組 #${i + 1}`,
              isEnabled: k.isEnabled !== false,
            });
          }
        });
      }
    } catch {}
  }

  for (let i = 1; i <= 10; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const clientId = (process.env[`TDX_CLIENT_ID${suffix}`] || "").trim();
    const clientSecret = (process.env[`TDX_CLIENT_SECRET${suffix}`] || "").trim();
    if (clientId && clientSecret && !keys.some((k) => k.clientId === clientId)) {
      keys.push({
        id: `key-env-${i}`,
        clientId,
        clientSecret,
        label: i === 1 ? "第 1 順位主要金鑰" : `金鑰組 #${i} (備援順位 ${i - 1})`,
        isEnabled: true,
      });
    }
  }

  if (keys.length === 0) {
    keys.push(
      {
        id: "key-default-1",
        clientId: "jerry0903-d82c8d89-56b2-4628",
        clientSecret: "5fdae95b-b2d6-4b80-a153-2238d6e74db5",
        label: "第 1 順位主要金鑰 (自訂)",
        isEnabled: true,
      },
      {
        id: "key-default-2",
        clientId: "jerry0903-04044e4d-e59f-4e8d",
        clientSecret: "d14df9b8-d005-4ce7-b7f5-5ac5fbb6d531",
        label: "金鑰組 #2 (備援順位 1)",
        isEnabled: true,
      },
      {
        id: "key-default-3",
        clientId: "jerry09032-2cdccf91-accf-4ea4",
        clientSecret: "be155ae3-84ba-4e41-92c4-7037799d0e6a",
        label: "金鑰組 #4 (備援順位 3)",
        isEnabled: true,
      }
    );
  }

  return keys;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      let data: any = null;
      if (redis) {
        data = (await redis.get("tdx_keys")) || (await redis.get("hsuehshan:config:keys"));
      }
      if (!data || (Array.isArray(data) && data.length === 0)) {
        data = getFallbackEnvKeys();
        if (redis && data.length > 0) {
          try {
            await redis.set("tdx_keys", data);
            await redis.set("hsuehshan:config:keys", data);
          } catch {}
        }
      }
      return res.status(200).json({ success: true, data });
    } catch (e: any) {
      return res.status(200).json({ success: true, data: getFallbackEnvKeys() });
    }
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (redis) {
        await redis.set("tdx_keys", body);
        await redis.set("hsuehshan:config:keys", body);
      }
      return res.status(200).json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
