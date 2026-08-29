import { SpeedAnalysisMetrics } from "../types";

/**
 * Phase 3: Speed Calculus, Harmonic Mean, and Inequality Analysis
 * 
 * Scientific Distinctions:
 * [MATHEMATICAL THEOREM]
 * 1. Time-Mean Speed vs Space-Mean Speed via Cauchy-Schwarz:
 *    (Σ v_i)(Σ 1/v_i) >= N^2  =>  v_TMS >= v_SMS  =>  L / v_TMS <= L / v_SMS
 *    (Using arithmetic mean TMS on variable speeds creates an underestimation bias for travel time).
 * 
 * 2. Jensen's Inequality for strictly convex f(v) = 1/v (f''(v) = 2/v^3 > 0 for v > 0):
 *    E[1/v] >= 1/E[v]  =>  E[T] = L * E[1/v] >= L / E[v]
 * 
 * [NUMERICAL STABILITY & SAFEGUARDS]
 * - Division-by-zero prevention: If speed is 0 km/h (standstill jam), we apply the physical
 *   crawling floor v_crawl = 3.6 km/h (1.0 m/s minimum creeping speed during queue discharge)
 *   with documented engineering annotation.
 */
export const MIN_PHYSICAL_CRAWL_SPEED_KMH = 5.0; // 物理安全下限 5.0 km/h (避免除零與極端數值溢位)
export const FREE_FLOW_DEFAULT_SPEED_KMH = 85.0; // 自由流預設速度 85 km/h

/**
 * 檢查是否處於平日/深夜極低車流時段 (12:00 AM ～ 05:30 AM / 00:00 ～ 05:30)
 */
export function isFreeFlowGuardTimeWindow(
  timestamp?: string | Date,
  currentDate: Date = new Date()
): boolean {
  let targetDate = currentDate;
  if (timestamp) {
    if (timestamp instanceof Date) {
      targetDate = timestamp;
    } else {
      const parsed = new Date(timestamp);
      if (!isNaN(parsed.getTime())) {
        targetDate = parsed;
      } else {
        const match = String(timestamp).match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          return (h >= 0 && h < 5) || (h === 5 && m <= 30);
        }
      }
    }
  }
  const h = targetDate.getHours();
  const m = targetDate.getMinutes();
  return (h >= 0 && h < 5) || (h === 5 && m <= 30);
}

/**
 * 低流量/佔有率自由流防呆保護 (Free-flow Guard)
 * 解決深夜（00:00～05:30）VD 斷面車流 q ≈ 0 或單一慢速工程車導致調和平均數嚴重失真的問題：
 * 
 * 1. 若整列（或整線）數據全部為 0（isEntireRowZero === true），則判定為封閉管制 (Closed)，不進行自由流提速，避免誤判。
 * 2. 極端零值與負值過濾：
 *    - 若原始速度 <= 0：
 *      * occupancy > 15% 視為真實嚴重回堵，給予低速爬行；
 *      * 否則一律視為暢通無車，賦予 85 km/h。
 * 3. 低流量自由流校正：
 *    - 當車流量 q < 3 輛/分 (即 flowVehPerHour < 180) 且 佔有率 occupancy < 3% 時：
 *      * 若讀取到的車速 < 60 km/h，強制校正為自由流正常速度 (85 km/h)。
 */
export function applyFreeFlowGuard(
  rawSpeed: number,
  flowVehPerHour: number,
  occupancyPercent: number,
  isLateNightWindow: boolean = true,
  isEntireRowZero: boolean = false
): {
  speed: number;
  isGuarded: boolean;
  guardReason?: string;
} {
  // 若整列/全線數據全為 0，判定為封閉管制 (Closed)，避免將封閉誤判為自由流
  if (isEntireRowZero) {
    return {
      speed: 0,
      isGuarded: false,
      guardReason: "整列數據全為 0，判定為車道/全線封閉管制 (Closed)",
    };
  }

  // 非深夜時段保持原始數值（僅做基本的 <= 0 檢查）
  if (!isLateNightWindow) {
    if (rawSpeed <= 0 || isNaN(rawSpeed)) {
      if (occupancyPercent > 15) {
        return { speed: MIN_PHYSICAL_CRAWL_SPEED_KMH, isGuarded: false };
      }
      return { speed: FREE_FLOW_DEFAULT_SPEED_KMH, isGuarded: true, guardReason: "非深夜零值回退" };
    }
    return { speed: rawSpeed, isGuarded: false };
  }

  const flowVehPerMin = flowVehPerHour / 60.0;
  const occ = Math.max(0, occupancyPercent);

  // 1. 極端零值與負值過濾 (若原始速度 <= 0)
  if (rawSpeed <= 0 || isNaN(rawSpeed)) {
    if (occ > 15.0) {
      // 佔有率 > 15% 視為嚴重回堵給予低速
      return {
        speed: MIN_PHYSICAL_CRAWL_SPEED_KMH,
        isGuarded: true,
        guardReason: "極端零值且佔有率>15%，判定為嚴重回堵",
      };
    } else {
      // 否則一律視為暢通並賦予 85 km/h
      return {
        speed: FREE_FLOW_DEFAULT_SPEED_KMH,
        isGuarded: true,
        guardReason: `極端零值且佔有率低(${occ.toFixed(1)}%)，校正為自由流 ${FREE_FLOW_DEFAULT_SPEED_KMH} km/h`,
      };
    }
  }

  // 2. 低流量自由流校正：當車流量 q < 3 輛/分 且 佔有率 occupancy < 3% 時，若車速 < 60 km/h，強制校正為 85 km/h
  if (flowVehPerMin < 3.0 && occ < 3.0 && rawSpeed < 60.0) {
    return {
      speed: FREE_FLOW_DEFAULT_SPEED_KMH,
      isGuarded: true,
      guardReason: `深夜低流量(q=${flowVehPerMin.toFixed(1)}輛/分, occ=${occ.toFixed(1)}%)異常低速(${rawSpeed.toFixed(1)}km/h)，強制校正為自由流 ${FREE_FLOW_DEFAULT_SPEED_KMH} km/h`,
    };
  }

  return {
    speed: rawSpeed,
    isGuarded: false,
  };
}

export function computeSpeedAnalysis(
  speedsKmh: number[],
  totalDistanceKm: number
): SpeedAnalysisMetrics {
  if (!speedsKmh || speedsKmh.length === 0) {
    return {
      timeMeanSpeedKmh: 0,
      spaceMeanSpeedKmh: 0,
      cauchySchwarzDiffKmh: 0,
      jensenExpectedTimeSec: 0,
      naiveTimeSec: 0,
      jensenTimeGapSec: 0,
      totalDistanceKm,
    };
  }

  const N = speedsKmh.length;
  let sumSpeed = 0;
  let sumInverseSpeed = 0;

  speedsKmh.forEach((s) => {
    // Engineering safeguard: Ensure positive speed for convex reciprocal
    const safeSpeed = Math.max(MIN_PHYSICAL_CRAWL_SPEED_KMH, s);
    sumSpeed += safeSpeed;
    sumInverseSpeed += 1 / safeSpeed;
  });

  // Time-Mean Speed (Arithmetic Mean)
  const v_TMS = sumSpeed / N;

  // Space-Mean Speed (Harmonic Mean)
  const v_SMS = N / sumInverseSpeed;

  // Cauchy-Schwarz Theorem Difference (v_TMS >= v_SMS)
  const cauchySchwarzDiffKmh = Math.max(0, v_TMS - v_SMS);

  // Naive Travel Time (L / v_TMS) in seconds
  const naiveTimeSec = v_TMS > 0 ? (totalDistanceKm / v_TMS) * 3600 : 0;

  // Jensen Expected Travel Time (L * E[1/v]) in seconds = L / v_SMS
  const jensenExpectedTimeSec = v_SMS > 0 ? (totalDistanceKm / v_SMS) * 3600 : 0;

  // Jensen Time Gap (ExpectedTime - NaiveTime >= 0)
  const jensenTimeGapSec = Math.max(0, jensenExpectedTimeSec - naiveTimeSec);

  return {
    timeMeanSpeedKmh: parseFloat(v_TMS.toFixed(2)),
    spaceMeanSpeedKmh: parseFloat(v_SMS.toFixed(2)),
    cauchySchwarzDiffKmh: parseFloat(cauchySchwarzDiffKmh.toFixed(2)),
    naiveTimeSec: Math.round(naiveTimeSec),
    jensenExpectedTimeSec: Math.round(jensenExpectedTimeSec),
    jensenTimeGapSec: Math.round(jensenTimeGapSec),
    totalDistanceKm: parseFloat(totalDistanceKm.toFixed(2)),
  };
}

/**
 * Calculates Space-Mean Speed for a sequence of speeds.
 */
export function computeHarmonicMean(speedsKmh: number[]): number {
  if (!speedsKmh || speedsKmh.length === 0) return 0;
  let sumReciprocal = 0;
  speedsKmh.forEach((s) => {
    const safeS = Math.max(MIN_PHYSICAL_CRAWL_SPEED_KMH, s);
    sumReciprocal += 1 / safeS;
  });
  return speedsKmh.length / sumReciprocal;
}
