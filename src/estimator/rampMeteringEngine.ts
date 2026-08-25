import { RawApiDetectorRecord, Direction } from "../types";
import { detectMeteringEventsFromPayload, ExtractedLiveEvent } from "../services/liveEventsEngine";
import { MAINLINE_CAPACITY_VDS, ON_RAMP_MEASURED_VDS } from "../data/detectorConfig";

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

  // 2. 主線狀態決定管制基準等級
  // 若 V_main < 45 km/h 或主線佔有率 > 25% -> 觸發【高強度儀控模式 (STRICT)】
  // 若 V_main >= 60 km/h 且主線順暢 -> 觸發【寬鬆/無儀控放行模式 (SMOOTH/OFF)】
  let isStrictMainline = mainlineVMain < 45 || mainlineOcc > 25;
  let isSmoothMainline = mainlineVMain >= 60 && mainlineOcc < 18;

  // 3. 匝道實測 VD -> 動態計算實體放行秒數與排隊時間
  // T_cycle = 3600 / max(q_ramp, 100)
  let tCycle = Math.round(3600 / Math.max(qRamp, 100));
  
  // 根據主線狀態微調週期
  if (isStrictMainline) {
    tCycle = Math.max(tCycle, 12); // 高強度儀控拉長週期
  } else if (isSmoothMainline && qRamp > 900) {
    tCycle = Math.min(tCycle, 5); // 順暢時縮短週期
  }

  const cycleSec = Math.max(3, Math.min(18, tCycle));
  const greenSec = 2; // 綠燈時間固定 G = 2 秒
  const redSec = Math.max(1, cycleSec - greenSec);

  // 排隊時間推估：D_queue (分) = (隊列回堵估算輛數 × T_cycle) / 60
  // 估算排隊車輛數透過 occRamp 與 qRamp 逆推
  let estimatedQueueVehicles = Math.round((occRamp / 100) * 45 + (1800 - qRamp) / 120);
  if (isStrictMainline) estimatedQueueVehicles += 15;
  estimatedQueueVehicles = Math.max(2, estimatedQueueVehicles);

  let queueDelayMinutes = parseFloat((((estimatedQueueVehicles * cycleSec) / 60)).toFixed(1));
  queueDelayMinutes = Math.min(45, Math.max(1, queueDelayMinutes));

  let intensity: MeteringIntensity = "SMOOTH";
  let intensityLabel = "順暢放行 (綠)";
  let intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
  let pulseIntervalSec = cycleSec;

  if (isStrictMainline || occRamp > 30 || qRamp <= 350) {
    intensity = "STRICT";
    intensityLabel = "嚴格阻斷 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    queueDelayMinutes = Math.max(queueDelayMinutes, 12);
  } else if (occRamp > 18 || qRamp <= 700) {
    intensity = "MODERATE";
    intensityLabel = "常態調控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  } else {
    intensity = "SMOOTH";
    intensityLabel = "順暢放行 (綠)";
    intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
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
 * 結合主線容量判定 VD 與即時事件通報
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

  // 利用主線容量判定 VD (MAINLINE_CAPACITY_VDS 或 28K~34K 範圍)
  const mainlineVds = detectors.filter(
    (d) =>
      d.direction === "N" &&
      (d.mileageKm >= 28.0 && d.mileageKm <= 34.0) ||
      MAINLINE_CAPACITY_VDS.some((mv) => mv.detectorId === d.detectorId)
  );

  let vMain = 75.0;
  let kMainOccupancy = 12.0;

  if (mainlineVds.length > 0) {
    const speeds: number[] = [];
    const occs: number[] = [];
    for (const vd of mainlineVds) {
      if (Array.isArray(vd.lanes)) {
        for (const l of vd.lanes) {
          if (typeof l.speedKmh === "number" && l.speedKmh > 0) speeds.push(l.speedKmh);
          if (typeof l.occupancyPercent === "number" && l.occupancyPercent >= 0) occs.push(l.occupancyPercent);
        }
      }
    }
    if (speeds.length > 0) {
      vMain = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    }
    if (occs.length > 0) {
      kMainOccupancy = Math.max(...occs);
    }
  }

  // 規則判定：若 V_main < 45 km/h 或主線佔有率 > 25% -> 觸發高強度主線號誌管制
  const isTriggeredByEvent = eventCheck.hasMainlineMeterEvent;
  const isTriggeredByVd = vMain < 48 || kMainOccupancy > 22;
  const isMainlineMeterActive = isTriggeredByEvent || isTriggeredByVd;

  if (!isMainlineMeterActive) {
    return {
      isMainlineMeterActive: false,
      locationKm: 30.5,
      locationName: "頭城 30.5K 主線號誌",
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      intensity: "OFF",
      intensityLabel: "未啟動管制",
      intensityColorClass: "text-slate-400 bg-slate-800/60 border-slate-700/40",
      mainlineQueueDelayMin: 0,
      upstreamQueueLengthKm: 0,
      queueTailKm: 30.5,
      vMain: parseFloat(vMain.toFixed(1)),
      kMainOccupancy: parseFloat(kMainOccupancy.toFixed(1)),
      description: "主線流速順暢 (>= 50 km/h)，號誌全綠燈未攔截",
    };
  }

  let cycleSec = 35;
  let greenSec = 15;
  let redSec = 20;
  let intensity: MeteringIntensity = "MODERATE";
  let intensityLabel = "常態調控 (黃)";
  let intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  let mainlineQueueDelayMin = 6;
  let upstreamQueueLengthKm = 1.5;

  if (vMain < 30 || kMainOccupancy > 32 || (eventCheck.mainlineEventDetail?.isStrict)) {
    cycleSec = 60;
    greenSec = 15;
    redSec = 45;
    intensity = "STRICT";
    intensityLabel = "嚴格阻斷 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    mainlineQueueDelayMin = 18;
    upstreamQueueLengthKm = 3.2;
  } else if (vMain < 48 || kMainOccupancy > 22) {
    cycleSec = 40;
    greenSec = 18;
    redSec = 22;
    intensity = "MODERATE";
    intensityLabel = "常態調控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
    mainlineQueueDelayMin = 8;
    upstreamQueueLengthKm = 1.8;
  } else {
    cycleSec = 25;
    greenSec = 15;
    redSec = 10;
    intensity = "SMOOTH";
    intensityLabel = "微幅調控 (綠)";
    intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
    mainlineQueueDelayMin = 3;
    upstreamQueueLengthKm = 0.6;
  }

  const queueTailKm = parseFloat((30.5 + upstreamQueueLengthKm).toFixed(1));
  const description = `主線流速 ${Math.round(vMain)} km/h (佔有率 ${Math.round(kMainOccupancy)}%) ‧ 紅燈 ${redSec}s / 綠燈 ${greenSec}s`;

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
    vMain: parseFloat(vMain.toFixed(1)),
    kMainOccupancy: parseFloat(kMainOccupancy.toFixed(1)),
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
