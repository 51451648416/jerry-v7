export interface SignalTimingResult {
  exchangeName: string;
  isMetered: boolean;
  cycleSec: number;
  greenSec: number;
  redSec: number;
  vph: number;
  queueDelayMinutes: number; // 平面排隊回堵時間
  description: string;
}

/**
 * 匝道儀控紅綠燈秒數與排隊延遲反推引擎
 * 採用一綠一車或一綠兩車標準時制計畫
 */
export function calculateRampSignalTiming(exchangeName: string, vph: number, lanes: number = 1): SignalTimingResult {
  // 若無資料或放行率極高，視為無儀控管制
  if (!vph || vph >= 1200) {
    return { exchangeName, isMetered: false, cycleSec: 0, greenSec: 0, redSec: 0, vph, queueDelayMinutes: 0, description: "無儀控 (綠燈暢行)" };
  }

  // 基礎時相計算 (Cycle = 3600 / VPH * lanes)
  const cycleSec = Math.max(4, Math.round((3600 / vph) * lanes));
  const greenSec = 2 * lanes; // 預設一綠一車2秒，雙車道4秒
  const yellowSec = 1;
  const redSec = Math.max(1, cycleSec - greenSec - yellowSec);

  // 利用放行率反推平面匝道等候延遲 (D/D/1 穩態排隊等候模型簡化版)
  let queueDelayMinutes = 0;
  if (vph <= 250) queueDelayMinutes = 25; // 嚴格緊縮儀控 (紫爆排隊)
  else if (vph <= 450) queueDelayMinutes = 15; // 中度儀控
  else if (vph <= 750) queueDelayMinutes = 5; // 輕度儀控

  return {
    exchangeName,
    isMetered: true,
    cycleSec,
    greenSec,
    redSec,
    vph,
    queueDelayMinutes,
    description: `紅燈 ${redSec}秒 / 綠燈 ${greenSec}秒`
  };
}

/**
 * 解析 TDX 匝道儀控 API 原始資料，對應至北上主要交流道 (蘇澳、羅東、宜蘭、頭城)
 */
export function parseTdxRampMetering(rawPayload: any[]): SignalTimingResult[] {
  if (!rawPayload || !Array.isArray(rawPayload)) return [];
  const results: SignalTimingResult[] = [];
  
  // 針對北上四大交流道進行映射與放行率提取
  const targets = [
    { name: "頭城匝道", idMatch: "N5-N-30" },
    { name: "宜蘭匝道", idMatch: "N5-N-38" },
    { name: "羅東匝道", idMatch: "N5-N-46" },
    { name: "蘇澳匝道", idMatch: "N5-N-54" }
  ];

  targets.forEach(target => {
    // 尋找符合該交流道的儀控資料
    const meterData = rawPayload.find(m => m.DeviceID && m.DeviceID.includes(target.idMatch));
    // 若無資料，預設給予寬鬆放行率 (1200 VPH)
    const vph = meterData && meterData.Status === 2 && meterData.VPH ? meterData.VPH : 1200; 
    results.push(calculateRampSignalTiming(target.name, vph));
  });

  return results;
}
