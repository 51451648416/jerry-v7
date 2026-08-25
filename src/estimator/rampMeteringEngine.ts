import { RawApiDetectorRecord, Direction } from "../types";
import { detectMeteringEventsFromPayload, ExtractedLiveEvent } from "../services/liveEventsEngine";

export type MeteringIntensity = "SMOOTH" | "MODERATE" | "STRICT" | "OFF";

export interface SignalTimingResult {
  exchangeName: string;
  isMetered: boolean;
  cycleSec: number; // 放行週期 (3s ~ 15s)
  greenSec: number; // 綠燈秒數
  redSec: number; // 紅燈秒數
  vph: number; // 放行率 (Vehicles Per Hour)
  queueDelayMinutes: number; // 平面入口匝道排隊停等時間 (分鐘)
  intensity: MeteringIntensity; // 強度等級
  intensityLabel: string; // "順暢放行 (綠)" | "常態調控 (黃)" | "嚴格阻斷 (紅)" | "無儀控"
  intensityColorClass: string;
  pulseIntervalSec: number; // 模擬呼吸光條脈衝間隔秒數 (3s / 6s / 12s)
  description: string;
  upstreamQueueLengthMeters?: number;
}

export interface MainlineMeteringResult {
  isMainlineMeterActive: boolean;
  locationKm: number; // 30.5
  locationName: string; // "頭城 30.5K 主線號誌"
  cycleSec: number; // 主線紅綠燈週期 (20s ~ 60s)
  greenSec: number; // 主線綠燈放行時間
  redSec: number; // 主線紅燈阻斷時間
  intensity: MeteringIntensity;
  intensityLabel: string;
  intensityColorClass: string;
  mainlineQueueDelayMin: number; // 主線號誌等候停等時間 (分鐘)
  upstreamQueueLengthKm: number; // 主線回堵長度 (公里，如 30.5K 回堵至 34K 或 38K)
  queueTailKm: number; // 回堵尾端里程 (km)
  description: string;
}

export interface ThreeTierTravelTimeResult {
  originExchangeName: string;
  rampQueueDelayMin: number; // 第一層：入口匝道排隊時間
  mainlineQueueDelayMin: number; // 第二層：頭城 30.5K 主線號誌等候時間
  tunnelTravelTimeMin: number; // 第三層：雪隧內部 20 微元動態積分通行時間
  totalTravelTimeMin: number; // 三層相加總耗時
  totalTravelTimeFormatted: string;
  detourAdvice: string; // 智慧避塞與替代道路建議
  shouldTakeAlternativeRoute: boolean; // 是否建議走替代道路 (排隊 > 15 分鐘)
  suggestedAlternativeRoute: string; // "建議改走台9線北宜公路或台2線濱海公路"
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
 * 匝道儀控紅綠燈秒數與排隊延遲反推演算法
 * 依據放行率 (VPH) 與車道佔有率計算動態放行週期 (3s ~ 15s) 與停等時間
 */
export function calculateRampSignalTiming(
  exchangeName: string,
  vph: number,
  lanes: number = 1,
  occupancyPercent: number = 0
): SignalTimingResult {
  // 若無資料或放行率極高 (>= 1200)，視為無儀控管制
  if (!vph || vph >= 1200) {
    return {
      exchangeName,
      isMetered: false,
      cycleSec: 0,
      greenSec: 0,
      redSec: 0,
      vph: Math.max(1200, vph || 1200),
      queueDelayMinutes: 0,
      intensity: "OFF",
      intensityLabel: "無儀控管制",
      intensityColorClass: "text-emerald-400 bg-emerald-950/60 border-emerald-500/30",
      pulseIntervalSec: 2.5,
      description: "全時段綠燈暢行，無匝道排隊延遲",
      upstreamQueueLengthMeters: 0,
    };
  }

  // 基礎時相計算 (Cycle = 3600 / VPH * lanes)
  let rawCycle = Math.round((3600 / vph) * lanes);
  const cycleSec = Math.max(3, Math.min(16, rawCycle));
  const greenSec = 2 * lanes; // 預設一綠一車 2 秒，雙車道 4 秒
  const yellowSec = 1;
  const redSec = Math.max(1, cycleSec - greenSec - yellowSec);

  // 利用放行率與佔有率反推平面匝道等候延遲 (D/D/1 穩態與非穩態排隊模型)
  let queueDelayMinutes = 0;
  let intensity: MeteringIntensity = "SMOOTH";
  let intensityLabel = "順暢放行 (綠)";
  let intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
  let pulseIntervalSec = 3.0; // 3 秒放行一車

  if (vph <= 300 || occupancyPercent > 35) {
    // 嚴格阻斷 / 紫爆排隊
    intensity = "STRICT";
    intensityLabel = "嚴格阻斷 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    pulseIntervalSec = Math.max(9.0, cycleSec);
    queueDelayMinutes = Math.min(45, Math.round(20 + (300 - vph) * 0.08 + occupancyPercent * 0.25));
  } else if (vph <= 650 || occupancyPercent > 20) {
    // 常態調控 / 中度儀控
    intensity = "MODERATE";
    intensityLabel = "常態調控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
    pulseIntervalSec = Math.max(5.0, cycleSec);
    queueDelayMinutes = Math.min(20, Math.round(8 + (650 - vph) * 0.03 + occupancyPercent * 0.15));
  } else {
    // 順暢放行 / 輕度儀控
    intensity = "SMOOTH";
    intensityLabel = "順暢放行 (綠)";
    intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
    pulseIntervalSec = Math.max(3.0, cycleSec);
    queueDelayMinutes = Math.max(1, Math.round(3 + (950 - vph) * 0.01));
  }

  const upstreamQueueLengthMeters = Math.round(queueDelayMinutes * 65); // 粗估每分鐘等候約 65 公尺車隊

  return {
    exchangeName,
    isMetered: true,
    cycleSec,
    greenSec,
    redSec,
    vph,
    queueDelayMinutes,
    intensity,
    intensityLabel,
    intensityColorClass,
    pulseIntervalSec,
    description: `放行間隔 ${cycleSec}秒 (紅燈 ${redSec}s / 綠燈 ${greenSec}s)`,
    upstreamQueueLengthMeters,
  };
}

/**
 * 頭城 30.5K 北向主線號誌管制 (Mainline Metering) 狀態與回堵逆推演算法
 * 結合即時事件、雪隧南口 (28K~32K) 主線 VD 佔有率與車速
 */
export function estimateTouchengMainlineMetering(
  detectors: RawApiDetectorRecord[],
  events: ExtractedLiveEvent[] | any[] = []
): MainlineMeteringResult {
  const eventCheck = detectMeteringEventsFromPayload(events);

  // 尋找 28K ~ 33K (頭城交流道與雪隧南口引道) 之 VD 車輛偵測器
  const nearbyVds = detectors.filter(
    (d) => d.direction === "N" && d.mileageKm >= 28.0 && d.mileageKm <= 34.0
  );

  let avgSpeed = 75;
  let maxOccupancy = 12;

  if (nearbyVds.length > 0) {
    const speeds: number[] = [];
    const occs: number[] = [];
    for (const vd of nearbyVds) {
      if (Array.isArray(vd.lanes)) {
        for (const l of vd.lanes) {
          if (l.speedKmh > 0) speeds.push(l.speedKmh);
          if (l.occupancyPercent > 0) occs.push(l.occupancyPercent);
        }
      }
    }
    if (speeds.length > 0) {
      avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    }
    if (occs.length > 0) {
      maxOccupancy = Math.max(...occs);
    }
  }

  // 判定主線號誌是否啟動：
  // 1. 若 TDX 事件中明確包含頭城主線號誌/管制事件
  // 2. 或頭城 30K~31K 車速顯著低落 (< 38 km/h) 且佔有率 > 25% (主線號誌紅燈蓄壓特徵)
  const isTriggeredByEvent = eventCheck.hasMainlineMeterEvent;
  const isTriggeredByVd = avgSpeed < 40 && maxOccupancy > 22;
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
      description: "主線號誌全綠燈未攔截，車流正常匯入雪山隧道",
    };
  }

  // 依嚴重程度計算主線時相與回堵長度
  let cycleSec = 35;
  let greenSec = 15;
  let redSec = 20;
  let intensity: MeteringIntensity = "MODERATE";
  let intensityLabel = "常態調控 (黃)";
  let intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
  let mainlineQueueDelayMin = 8;
  let upstreamQueueLengthKm = 2.0;

  if (avgSpeed < 25 || maxOccupancy > 35 || (eventCheck.mainlineEventDetail?.isStrict)) {
    // 嚴格阻斷
    cycleSec = 60;
    greenSec = 15;
    redSec = 45;
    intensity = "STRICT";
    intensityLabel = "嚴格阻斷 (紅)";
    intensityColorClass = "text-rose-400 bg-rose-950/60 border-rose-500/40";
    mainlineQueueDelayMin = Math.min(25, Math.round(14 + (25 - avgSpeed) * 0.5 + maxOccupancy * 0.15));
    upstreamQueueLengthKm = parseFloat((2.5 + (mainlineQueueDelayMin - 10) * 0.35).toFixed(1));
  } else if (avgSpeed < 38 || maxOccupancy > 22) {
    cycleSec = 40;
    greenSec = 18;
    redSec = 22;
    intensity = "MODERATE";
    intensityLabel = "常態調控 (黃)";
    intensityColorClass = "text-amber-400 bg-amber-950/60 border-amber-500/40";
    mainlineQueueDelayMin = Math.min(15, Math.round(6 + (38 - avgSpeed) * 0.3));
    upstreamQueueLengthKm = parseFloat((1.2 + (mainlineQueueDelayMin - 5) * 0.2).toFixed(1));
  } else {
    cycleSec = 25;
    greenSec = 15;
    redSec = 10;
    intensity = "SMOOTH";
    intensityLabel = "微幅調控 (綠)";
    intensityColorClass = "text-emerald-400 bg-emerald-950/60 border-emerald-500/30";
    mainlineQueueDelayMin = 4;
    upstreamQueueLengthKm = 0.8;
  }

  const queueTailKm = parseFloat((30.5 + upstreamQueueLengthKm).toFixed(1));
  const description = `主線紅燈 ${redSec}s / 綠燈 ${greenSec}s，回堵至 ${queueTailKm}K (長度約 ${upstreamQueueLengthKm} km)`;

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
    description,
  };
}

/**
 * 構建完整的北上走廊「三重旅行時間模型 (Three-Tier Corridor Delay)」
 * 總耗時 = 匝道等候排隊時間 + 頭城 30.5K 主線號誌等候時間 + 雪隧內部通行時間
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
      detourAdvice = "⚠️ 匝道儀控嚴重阻斷 (排隊 > 25 分鐘)，強烈建議改走【台9線北宜公路】或【台2線濱海公路】以節省停等時間！";
      suggestedAlternativeRoute = "台9線北宜公路 / 台2線濱海公路";
    } else if (rampQueueDelayMin >= 15 || totalTravelTimeMin >= 35) {
      detourAdvice = "💡 匝道儀控等候較長 (排隊 > 15 分鐘)，若不想排隊可考慮改走【台9線北宜公路】或延後 1~2 小時出發。";
      suggestedAlternativeRoute = "台9線北宜公路 / 延後出發";
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

  // 1. 各入口交流道匝道儀控反推
  const targets = [
    { name: "頭城匝道", idMatch: "30", defaultVph: 850, km: 30.0 },
    { name: "宜蘭匝道", idMatch: "38", defaultVph: 600, km: 38.0 },
    { name: "羅東匝道", idMatch: "46", defaultVph: 500, km: 46.0 },
    { name: "蘇澳匝道", idMatch: "54", defaultVph: 900, km: 54.0 },
  ];

  const eventCheck = detectMeteringEventsFromPayload(events);

  const rampSignals: SignalTimingResult[] = targets.map((target) => {
    // 比對 TDX 儀控 API
    let vph = target.defaultVph;
    if (Array.isArray(rawMeterPayload) && rawMeterPayload.length > 0) {
      const match = rawMeterPayload.find(
        (m) => m && m.DeviceID && String(m.DeviceID).includes(target.idMatch)
      );
      if (match && typeof match.VPH === "number" && match.VPH > 0) {
        vph = match.VPH;
      }
    }

    // 比對即時事件是否有該匝道專屬管制
    const rampEv = eventCheck.rampEvents.find((e) => e.exchangeName.includes(target.name.substring(0, 2)));
    if (rampEv) {
      if (rampEv.isStrict) {
        vph = Math.min(vph, 280);
      } else {
        vph = Math.min(vph, 480);
      }
    }

    // 尋找鄰近該交流道之 VD 佔有率
    const localVds = detectors.filter(
      (d) => d.direction === "N" && Math.abs(d.mileageKm - target.km) <= 2.5
    );
    let avgOcc = 12;
    if (localVds.length > 0) {
      const occList: number[] = [];
      for (const vd of localVds) {
        if (Array.isArray(vd.lanes)) {
          for (const l of vd.lanes) {
            if (typeof l.occupancyPercent === "number") occList.push(l.occupancyPercent);
          }
        }
      }
      if (occList.length > 0) {
        avgOcc = occList.reduce((a, b) => a + b, 0) / occList.length;
      }
    }

    return calculateRampSignalTiming(target.name, vph, 1, avgOcc);
  });

  // 2. 頭城 30.5K 主線號誌管制反推
  const mainlineSignal = estimateTouchengMainlineMetering(detectors, events);

  // 3. 三重旅行時間模型計算
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
