import { RawApiDetectorRecord, Direction } from "../types";
import { detectMeteringEventsFromPayload, ExtractedLiveEvent } from "../services/liveEventsEngine";
import { MAINLINE_CAPACITY_VDS, ON_RAMP_MEASURED_VDS, TOUCHENG_MAINLINE_UPSTREAM_VD_ID, TOUCHENG_MAINLINE_METER_VD_ID } from "../data/detectorConfig";

export type MeteringIntensity = "SMOOTH" | "MODERATE" | "STRICT" | "OFF";

export interface SignalTimingResult {
  exchangeName: string;
  isMetered: boolean;
  cycleSec: number; // 放行週期 (秒)
  greenSec: number; // 綠燈秒數 (固定 2 秒)
  redSec: number; // 紅燈秒數
  vph: number; // 通過流量 q_ramp (veh/h)
  queueDelayMinutes: number; // 平面入口匝道排隊停等時間 D_queue (分鐘)
  intensity: MeteringIntensity;
  intensityLabel: string;
  intensityColorClass: string;
  pulseIntervalSec: number;
  description: string;
  upstreamQueueLengthMeters: number;
  rampOccupancy: number; // Occ_ramp (%)
}

export interface MainlineMeteringResult {
  isMainlineMeterActive: boolean;
  locationKm: number; // 30.5
  locationName: string; // "頭城 30.5K 主線號誌"
  cycleSec: number;
  greenSec: number;
  redSec: number;
  intensity: MeteringIntensity;
  intensityLabel: string;
  intensityColorClass: string;
  mainlineQueueDelayMin: number;
  upstreamQueueLengthKm: number;
  queueTailKm: number;
  vMain: number; // 主線平均流速 V_main
  kMainOccupancy: number; // 主線佔有率 K_main (%)
  description: string;
}

export interface ThreeTierTravelTimeResult {
  originExchangeName: string;
  rampQueueDelayMin: number;
  mainlineQueueDelayMin: number;
  tunnelTravelTimeMin: number;
  totalTravelTimeMin: number;
  totalTravelTimeFormatted: string;
  detourAdvice: string;
  shouldTakeAlternativeRoute: boolean;
  suggestedAlternativeRoute: string;
}

export interface ComprehensiveMeteringState {
  rampSignals: SignalTimingResult[];
  mainlineSignal: MainlineMeteringResult;
  threeTierTimes: Record<string, ThreeTierTravelTimeResult>;
  selectedExchange: string;
  tunnelTravelTimeMin: number;
  hasActiveMetering: boolean;
  lastUpdated: string;
}

/**
 * 任務二：雙軌聯立號誌演算法 (Dual-Track Simultaneous Signal Algorithm)
 * 結合「主線容量判定 VD」與「各入口匝道實測 VD (Passage & Queue)」進行動態時制與排隊推估
 */
export function calculateRampSignalTimingWithDualTrack(
  exchangeName: string,
  detectors: RawApiDetectorRecord[],
  defaultVph: number = 600,
  mainlineVMain: number = 70,
  mainlineOcc: number = 15
): SignalTimingResult {
  // 1. 尋找對應的匝道實測 VD 配置並取得流量/佔有率
  const rampConfig = ON_RAMP_MEASURED_VDS.find((r) => r.exchangeName === exchangeName);
  
  let qRamp = defaultVph;
  let occRamp = 12.0;

  if (rampConfig && detectors.length > 0) {
    const matchedVd = detectors.find(
      (d) =>
        d.detectorId === rampConfig.passageDetectorId ||
        d.detectorId === rampConfig.queueDetectorId ||
        Math.abs(d.mileageKm - rampConfig.mileageKm) <= 1.5
    );

    if (matchedVd && Array.isArray(matchedVd.lanes) && matchedVd.lanes.length > 0) {
      let totalVolume = 0;
      let totalOcc = 0;
      let count = 0;
      for (const l of matchedVd.lanes) {
        if (typeof l.flowVehPerHour === "number" && l.flowVehPerHour > 0) {
          totalVolume += l.flowVehPerHour;
        }
        if (typeof l.occupancyPercent === "number" && l.occupancyPercent >= 0) {
          totalOcc += l.occupancyPercent;
          count++;
        }
      }
      if (totalVolume > 100) {
        qRamp = Math.min(1800, Math.max(120, totalVolume));
      }
      if (count > 0) {
        occRamp = totalOcc / count;
      }
    }
  }

  // 檢查是否為深夜暫停時段 (23:00 至隔日 06:00 國 5 不實施匝道儀控與主線號誌管制)
  const currentHour = new Date().getHours();
  const isNightSuspension = currentHour >= 23 || currentHour < 6;

  if (isNightSuspension) {
    return {
      exchangeName,
      isMetered: false,
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      vph: qRamp,
      queueDelayMinutes: 0,
      intensity: "OFF",
      intensityLabel: "深夜免管制 (23:00-06:00 暫停)",
      intensityColorClass: "text-slate-400 bg-slate-800/60 border-slate-700/40",
      pulseIntervalSec: 0,
      description: "深夜 23:00 至隔日 06:00 交通離峰，暫停實施匝道儀控",
      upstreamQueueLengthMeters: 0,
      rampOccupancy: parseFloat(occRamp.toFixed(1)),
    };
  }

  // 2. 主線狀態決定管制基準開關 (以頭城 30.5K 號誌/隧道口前主線段為基準)
  // 統一開關規則：只要隧道口前主線段車速低於 60 km/h (mainlineVMain < 60.0)，即啟動匝道儀控與排隊反推計算；
  // 若車速 >= 60.0 km/h，則未達管制門檻，維持全線常態開放暢行 (未啟動儀控，排隊時間為 0)。
  const isMainlineBelow60 = mainlineVMain < 60.0;

  if (!isMainlineBelow60) {
    return {
      exchangeName,
      isMetered: false,
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      vph: qRamp,
      queueDelayMinutes: 0,
      intensity: "OFF",
      intensityLabel: "🟢 暢行常開 (未啟動儀控)",
      intensityColorClass: "text-emerald-400 bg-emerald-950/60 border-emerald-500/30",
      pulseIntervalSec: 0,
      description: `隧道口前主線車速 ${Math.round(mainlineVMain)} km/h (≥ 60 km/h)，未達管制門檻，匝道常態開放通行`,
      upstreamQueueLengthMeters: 0,
      rampOccupancy: parseFloat(occRamp.toFixed(1)),
    };
  }

  // 3. 隧道口前主線車速 < 60 km/h 啟動儀控與排隊反推：
  // 匝道實測 VD -> 動態計算實體放行秒數與排隊時間
  // T_cycle = 3600 / max(q_ramp, 100)
  let tCycle = Math.round(3600 / Math.max(qRamp, 100));
  
  // 根據主線壅塞程度調控週期 (車速 < 40 km/h 時拉長週期)
  const isStrictMainline = mainlineVMain < 40.0 || mainlineOcc > 22;
  if (isStrictMainline) {
    tCycle = Math.max(tCycle, 12); // 嚴格儀控拉長週期
  }

  const cycleSec = Math.max(3, Math.min(18, tCycle));
  const greenSec = 2; // 綠燈時間固定 G = 2 秒
  const redSec = Math.max(1, cycleSec - greenSec);

  // 排隊時間反推：D_queue (分) = (隊列回堵估算輛數 × T_cycle) / 60
  // 估算排隊車輛數透過 occRamp 與 qRamp 逆推
  let estimatedQueueVehicles = Math.round((occRamp / 100) * 45 + (1800 - qRamp) / 120);
  if (isStrictMainline) estimatedQueueVehicles += 15;
  estimatedQueueVehicles = Math.max(2, estimatedQueueVehicles);

  let queueDelayMinutes = parseFloat((((estimatedQueueVehicles * cycleSec) / 60)).toFixed(1));
  queueDelayMinutes = Math.min(45, Math.max(1, queueDelayMinutes));

  let intensity: MeteringIntensity = "MODERATE";
  let intensityLabel = "常態調控 (黃)";
  let intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  let pulseIntervalSec = cycleSec;

  if (isStrictMainline || occRamp > 30 || qRamp <= 350) {
    intensity = "STRICT";
    intensityLabel = "嚴格阻斷 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    queueDelayMinutes = Math.max(queueDelayMinutes, 12);
  } else {
    intensity = "MODERATE";
    intensityLabel = "常態調控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  }

  const upstreamQueueLengthMeters = Math.round(queueDelayMinutes * 55);

  return {
    exchangeName,
    isMetered: true,
    cycleSec,
    greenSec,
    redSec,
    vph: qRamp,
    queueDelayMinutes,
    intensity,
    intensityLabel,
    intensityColorClass,
    pulseIntervalSec,
    description: `實測流量 ${Math.round(qRamp)} vph ‧ 放行週期 ${cycleSec}s (綠燈 ${greenSec}s / 紅燈 ${redSec}s)`,
    upstreamQueueLengthMeters,
    rampOccupancy: parseFloat(occRamp.toFixed(1)),
  };
}

/**
 * 頭城 30.5K 北向主線號誌管制 (Mainline Metering) 狀態與回堵逆推演算法
 * 結合主線雙 VD 差分判別演算法 (上游需求 VD vs 號誌斷面 VD)
 */
export function estimateTouchengMainlineMetering(
  detectors: RawApiDetectorRecord[],
  events: ExtractedLiveEvent[] | any[] = []
): MainlineMeteringResult {
  const currentHour = new Date().getHours();
  const isNightSuspension = currentHour >= 23 || currentHour < 6;

  if (isNightSuspension) {
    return {
      isMainlineMeterActive: false,
      locationKm: 30.5,
      locationName: "頭城 30.5K 主線號誌",
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      intensity: "OFF",
      intensityLabel: "深夜免管制 (23:00-06:00 暫停)",
      intensityColorClass: "text-slate-400 bg-slate-800/60 border-slate-700/40",
      mainlineQueueDelayMin: 0,
      upstreamQueueLengthKm: 0,
      queueTailKm: 30.5,
      vMain: 85.0,
      kMainOccupancy: 8.0,
      description: "深夜 23:00 至隔日 06:00 交通離峰，主線號誌暫停管制 (全綠燈暢行)",
    };
  }

  const eventCheck = detectMeteringEventsFromPayload(events);

  // 1. 尋找上游需求 VD 與號誌斷面 VD
  const upstreamVd = detectors.find(
    (d) => d.detectorId === TOUCHENG_MAINLINE_UPSTREAM_VD_ID || Math.abs(d.mileageKm - 32.0) <= 0.8
  );
  const meterVd = detectors.find(
    (d) => d.detectorId === TOUCHENG_MAINLINE_METER_VD_ID || Math.abs(d.mileageKm - 30.5) <= 0.3
  );

  let qUpstream = 1800;
  let vUpstream = 80.0;
  let qMeter = 1600;
  let vMeter = 75.0;
  let occupancy30_5K = 12.0;

  if (upstreamVd && Array.isArray(upstreamVd.lanes)) {
    let volSum = 0;
    let speedSum = 0;
    let count = 0;
    for (const l of upstreamVd.lanes) {
      if (typeof l.flowVehPerHour === "number" && l.flowVehPerHour > 0) volSum += l.flowVehPerHour;
      if (typeof l.speedKmh === "number" && l.speedKmh > 0) {
        speedSum += l.speedKmh;
        count++;
      }
    }
    if (volSum > 100) qUpstream = volSum;
    if (count > 0) vUpstream = speedSum / count;
  }

  if (meterVd && Array.isArray(meterVd.lanes)) {
    let volSum = 0;
    let speedSum = 0;
    let occSum = 0;
    let count = 0;
    for (const l of meterVd.lanes) {
      if (typeof l.flowVehPerHour === "number" && l.flowVehPerHour > 0) volSum += l.flowVehPerHour;
      if (typeof l.speedKmh === "number" && l.speedKmh > 0) {
        speedSum += l.speedKmh;
        count++;
      }
      if (typeof l.occupancyPercent === "number" && l.occupancyPercent >= 0) {
        occSum += l.occupancyPercent;
        count++;
      }
    }
    if (volSum > 100) qMeter = volSum;
    if (count > 0) {
      vMeter = speedSum / count;
      occupancy30_5K = occSum / Math.max(1, meterVd.lanes.length);
    }
  }

  // 2. 計算 30.5K 主線號誌前後 2~3 公里之流量截斷差 Delta_Q 與車速差
  const deltaQ = qUpstream - qMeter;
  const speedDrop = vUpstream - vMeter;

  // 3. 統一開關規則：只要隧道口前面那一段 (即 30.5K/主線斷面) 車速低於 60 km/h，即啟動主線號誌管制與排隊反推計算；
  // 若車速 >= 60.0 km/h，則判定主線順暢未達管制門檻，全線常態開放通行 (排隊時間為 0)。
  const isTriggeredBySpeed = vMeter < 60.0;
  const isTriggeredByEvent = eventCheck.hasMainlineMeterEvent;
  const isMainlineMeterActive = isTriggeredBySpeed || isTriggeredByEvent;

  if (!isMainlineMeterActive) {
    return {
      isMainlineMeterActive: false,
      locationKm: 30.5,
      locationName: "頭城 30.5K 主線號誌",
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      intensity: "OFF",
      intensityLabel: "🟢 主線開放通行 (未啟動管制)",
      intensityColorClass: "text-emerald-400 bg-emerald-950/60 border-emerald-500/30",
      mainlineQueueDelayMin: 0,
      upstreamQueueLengthKm: 0,
      queueTailKm: 30.5,
      vMain: parseFloat(vMeter.toFixed(1)),
      kMainOccupancy: parseFloat(occupancy30_5K.toFixed(1)),
      description: `隧道口前主線車速 ${Math.round(vMeter)} km/h (≥ 60 km/h)，未達管制門檻，全線常態開放通行 | 上游 ${Math.round(qUpstream)} / 斷面 ${Math.round(qMeter)} vph`,
    };
  }

  // 主線管制啟動中 (車速低於 60 km/h 啟動反推與動態週期)
  let tCycle = Math.round(3600 / Math.max(qMeter, 150));
  const cycleSec = Math.max(10, Math.min(60, tCycle));
  const greenSec = 2; // 固定綠燈 2 秒
  const redSec = Math.max(1, cycleSec - greenSec);

  let intensity: MeteringIntensity = "MODERATE";
  let intensityLabel = "🔴 主線常態儀控 (黃)";
  let intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  let mainlineQueueDelayMin = 7;
  let upstreamQueueLengthKm = 1.5;

  if (vMeter < 40.0 || occupancy30_5K > 22 || (eventCheck.mainlineEventDetail?.isStrict)) {
    intensity = "STRICT";
    intensityLabel = "🔴 主線嚴格儀控 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    mainlineQueueDelayMin = 16;
    upstreamQueueLengthKm = 2.8;
  } else {
    intensity = "MODERATE";
    intensityLabel = "🔴 主線常態儀控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
    mainlineQueueDelayMin = 7;
    upstreamQueueLengthKm = 1.5;
  }

  const queueTailKm = parseFloat((30.5 + upstreamQueueLengthKm).toFixed(1));
  const description = `號誌前後 2~3km (32K上游 vs 30.5K斷面) | 上游 ${Math.round(qUpstream)} / 斷面 ${Math.round(qMeter)} vph (ΔQ: ${Math.round(deltaQ)}) | 斷面車速: ${Math.round(vMeter)} km/h`;

  return {
    isMainlineMeterActive: true,
    locationKm: 30.5,
    locationName: "頭城 30.5K 主線號誌",
    cycleSec,
    greenSec,
    redSec,
    intensity,
    intensityLabel,
    intensityColorClass,
    mainlineQueueDelayMin,
    upstreamQueueLengthKm,
    queueTailKm,
    vMain: parseFloat(vMeter.toFixed(1)),
    kMainOccupancy: parseFloat(occupancy30_5K.toFixed(1)),
    description,
  };
}

/**
 * 三重旅行時間模型計算
 */
export function computeThreeTierCorridorTravelTimes(
  rampSignals: SignalTimingResult[],
  mainlineSignal: MainlineMeteringResult,
  tunnelTravelTimeMin: number = 11
): Record<string, ThreeTierTravelTimeResult> {
  const results: Record<string, ThreeTierTravelTimeResult> = {};

  for (const ramp of rampSignals) {
    const rampQueueDelayMin = ramp.isMetered ? ramp.queueDelayMinutes : 0;
    const mainlineQueueDelayMin = mainlineSignal.isMainlineMeterActive ? mainlineSignal.mainlineQueueDelayMin : 0;
    const totalTravelTimeMin = rampQueueDelayMin + mainlineQueueDelayMin + tunnelTravelTimeMin;

    const totalMinutesFormatted = `${Math.floor(totalTravelTimeMin)} 分鐘`;
    const shouldTakeAlternativeRoute = rampQueueDelayMin >= 15 || totalTravelTimeMin >= 35;
    let detourAdvice = "目前排隊時間在合理範圍，建議維持行駛國道 5 號。";
    let suggestedAlternativeRoute = "國道 5 號主線";

    if (rampQueueDelayMin >= 25 || totalTravelTimeMin >= 45) {
      detourAdvice = "⚠️ 匝道儀控嚴重阻斷 (排隊 > 25 分鐘)，建議改走【台9線北宜公路】或【台2線濱海公路】！";
      suggestedAlternativeRoute = "台9線北宜公路 / 台2線濱海公路";
    } else if (rampQueueDelayMin >= 15 || totalTravelTimeMin >= 35) {
      detourAdvice = "💡 匝道儀控等候較長，若不想排隊可考慮改走【台9線北宜公路】。";
      suggestedAlternativeRoute = "台9線北宜公路";
    }

    results[ramp.exchangeName] = {
      originExchangeName: ramp.exchangeName,
      rampQueueDelayMin,
      mainlineQueueDelayMin,
      tunnelTravelTimeMin,
      totalTravelTimeMin,
      totalTravelTimeFormatted: totalMinutesFormatted,
      detourAdvice,
      shouldTakeAlternativeRoute,
      suggestedAlternativeRoute,
    };
  }

  return results;
}

/**
 * 國道 5 號北向全線號誌調控綜合分析主入口
 */
export function evaluateFreeway5MeteringSystem(
  detectors: RawApiDetectorRecord[],
  events: ExtractedLiveEvent[] | any[] = [],
  tunnelTravelTimeSec: number = 660,
  rawMeterPayload: any[] = []
): ComprehensiveMeteringState {
  const tunnelMin = Math.max(9, Math.round(tunnelTravelTimeSec / 60));

  // 先計算主線狀態以提供匝道演算法參考
  const mainlineSignal = estimateTouchengMainlineMetering(detectors, events);

  // 依據各交流道名稱進行雙軌動態計算
  const targets = [
    { name: "頭城匝道", defaultVph: 850 },
    { name: "宜蘭匝道", defaultVph: 600 },
    { name: "羅東匝道", defaultVph: 500 },
    { name: "蘇澳匝道", defaultVph: 900 },
  ];

  const rampSignals: SignalTimingResult[] = targets.map((target) => {
    let vph = target.defaultVph;
    if (Array.isArray(rawMeterPayload) && rawMeterPayload.length > 0) {
      const match = rawMeterPayload.find(
        (m) => m && m.DeviceID && String(m.DeviceID).includes(target.name.substring(0, 2))
      );
      if (match && typeof match.VPH === "number" && match.VPH > 0) {
        vph = match.VPH;
      }
    }
    return calculateRampSignalTimingWithDualTrack(
      target.name,
      detectors,
      vph,
      mainlineSignal.vMain,
      mainlineSignal.kMainOccupancy
    );
  });

  const threeTierTimes = computeThreeTierCorridorTravelTimes(rampSignals, mainlineSignal, tunnelMin);
  const hasActiveMetering = rampSignals.some((r) => r.isMetered) || mainlineSignal.isMainlineMeterActive;

  return {
    rampSignals,
    mainlineSignal,
    threeTierTimes,
    selectedExchange: "頭城匝道",
    tunnelTravelTimeMin: tunnelMin,
    hasActiveMetering,
    lastUpdated: new Date().toLocaleTimeString("zh-TW", { hour12: false }),
  };
}
