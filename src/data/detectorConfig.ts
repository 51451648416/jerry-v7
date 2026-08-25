import { Direction, RawApiDetectorRecord } from "../types";

export interface DetectorStationConfig {
  detectorId: string;
  mileageKm: number;
  direction: Direction;
  locationName: string;
  tunnelSection: string;
}

/**
 * 任務一：建立「主線 VD」與「匝道 VD」雙軌感測器對照表 (Dual-Track Sensor Mapping Table)
 */

// 1. 【主線號誌影響區判定 VD】：專注於頭城 30.5K 主線號誌前後 2~3 公里 (28.5K ~ 33.5K)，不看雪隧內部
export const MAINLINE_CAPACITY_VDS: DetectorStationConfig[] = [
  { detectorId: "VD-N5-N-30.500-M", mileageKm: 30.5, direction: "N", locationName: "頭城 30.5K 主線號誌斷面 (管制點 VD)", tunnelSection: "號誌管制斷面" },
  { detectorId: "VD-N5-N-30.000-M", mileageKm: 30.0, direction: "N", locationName: "頭城主線 30.0K (號誌下游 500m)", tunnelSection: "號誌下游引道" },
  { detectorId: "VD-N5-N-28.134-M", mileageKm: 28.134, direction: "N", locationName: "雪隧南口 28.1K (號誌下游 2.3km)", tunnelSection: "隧道南口匯流前" },
  { detectorId: "VD-N5-N-32.000-M", mileageKm: 32.0, direction: "N", locationName: "頭城主線上游 32.0K (號誌上游 1.5km)", tunnelSection: "號誌上游引道" },
  { detectorId: "VD-N5-N-33.500-M", mileageKm: 33.5, direction: "N", locationName: "頭城主線上游 33.5K (號誌上游 3.0km)", tunnelSection: "號誌上游需求端" },
];

// 2. 【頭城 30.5K 主線號誌 VD 與上游對照組 VD】：綁定上游需求 VD 與號誌斷面 VD
export const TOUCHENG_MAINLINE_UPSTREAM_VD_ID = "VD-N5-N-32.000-M";
export const TOUCHENG_MAINLINE_METER_VD_ID = "VD-N5-N-30.500-M";

export const TOUCHENG_MAINLINE_SIGNAL_VD: DetectorStationConfig = {
  detectorId: TOUCHENG_MAINLINE_METER_VD_ID,
  mileageKm: 30.5,
  direction: "N",
  locationName: "頭城 30.5K 主線號誌管制斷面偵測器 (Q_meter, V_meter)",
  tunnelSection: "主線號誌管制點",
};

export const TOUCHENG_MAINLINE_UPSTREAM_VD: DetectorStationConfig = {
  detectorId: TOUCHENG_MAINLINE_UPSTREAM_VD_ID,
  mileageKm: 32.0,
  direction: "N",
  locationName: "頭城主線上游需求偵測器 (Q_upstream, V_upstream)",
  tunnelSection: "主線上游引道",
};

// 3. 【各入口匝道實測 VD】：蘇澳、羅東、宜蘭、頭城各交流道之入口匝道偵測器 (Passage 通過 & Queue 隊列)
export interface RampDetectorMapping {
  exchangeName: string;
  mileageKm: number;
  passageDetectorId: string;
  queueDetectorId: string;
  locationDescription: string;
}

export const ON_RAMP_MEASURED_VDS: RampDetectorMapping[] = [
  {
    exchangeName: "頭城匝道",
    mileageKm: 30.0,
    passageDetectorId: "VD-N5-N-30.000-E",
    queueDetectorId: "VD-N5-N-30.000-I",
    locationDescription: "國道 5 號頭城交流道北向入口匝道 (通過與隊列 VD)",
  },
  {
    exchangeName: "宜蘭匝道",
    mileageKm: 38.0,
    passageDetectorId: "VD-N5-N-38.000-E",
    queueDetectorId: "VD-N5-N-38.000-I",
    locationDescription: "國道 5 號宜蘭交流道北向入口匝道 (通過與隊列 VD)",
  },
  {
    exchangeName: "羅東匝道",
    mileageKm: 46.0,
    passageDetectorId: "VD-N5-N-46.000-E",
    queueDetectorId: "VD-N5-N-46.000-I",
    locationDescription: "國道 5 號羅東交流道北向入口匝道 (通過與隊列 VD)",
  },
  {
    exchangeName: "蘇澳匝道",
    mileageKm: 54.0,
    passageDetectorId: "VD-N5-N-54.000-E",
    queueDetectorId: "VD-N5-N-54.000-I",
    locationDescription: "國道 5 號蘇澳交流道北向入口匝道 (通過與隊列 VD)",
  },
];

// 原有雪山隧道南向/北向探測器設定 (保留相容性)
export const HSUEHSHAN_DETECTORS_SOUTH: DetectorStationConfig[] = [
  { detectorId: "VD-N5-S-15.203", mileageKm: 15.203, direction: "S", locationName: "國5南向 15.2K (雪山隧道南向起點 15K+203)", tunnelSection: "隧道起點區" },
  { detectorId: "VD-N5-S-18.000", mileageKm: 18.000, direction: "S", locationName: "國5南向 18.0K (雪山隧道前段)", tunnelSection: "隧道前段 A" },
  { detectorId: "VD-N5-S-19.100", mileageKm: 19.100, direction: "S", locationName: "國5南向 19.1K", tunnelSection: "隧道前段 B" },
  { detectorId: "VD-N5-S-20.200", mileageKm: 20.200, direction: "S", locationName: "國5南向 20.2K", tunnelSection: "隧道中前段 A" },
  { detectorId: "VD-N5-S-21.400", mileageKm: 21.400, direction: "S", locationName: "國5南向 21.4K", tunnelSection: "隧道中前段 B" },
  { detectorId: "VD-N5-S-22.500", mileageKm: 22.500, direction: "S", locationName: "國5南向 22.5K (避車彎段)", tunnelSection: "隧道核心中段" },
  { detectorId: "VD-N5-S-23.800", mileageKm: 23.800, direction: "S", locationName: "國5南向 23.8K", tunnelSection: "隧道中後段 A" },
  { detectorId: "VD-N5-S-25.000", mileageKm: 25.000, direction: "S", locationName: "國5南向 25.0K", tunnelSection: "隧道中後段 B" },
  { detectorId: "VD-N5-S-25.300", mileageKm: 25.300, direction: "S", locationName: "國5南向 25.3K (坡度轉換點)", tunnelSection: "隧道後段 A" },
  { detectorId: "VD-N5-S-26.200", mileageKm: 26.200, direction: "S", locationName: "國5南向 26.2K", tunnelSection: "隧道後段 B" },
  { detectorId: "VD-N5-S-28.128", mileageKm: 28.128, direction: "S", locationName: "國5南向 28.1K (雪山隧道南向終點 28K+128/頭城端)", tunnelSection: "隧道終點區" },
];

export const HSUEHSHAN_DETECTORS_NORTH: DetectorStationConfig[] = [
  { detectorId: "VD-N5-N-28.134", mileageKm: 28.134, direction: "N", locationName: "國5北向 28.1K (雪山隧道北向起點 28K+134/頭城端)", tunnelSection: "隧道起點區" },
  { detectorId: "VD-N5-N-26.200", mileageKm: 26.200, direction: "N", locationName: "國5北向 26.2K", tunnelSection: "隧道前段 A" },
  { detectorId: "VD-N5-N-25.300", mileageKm: 25.300, direction: "N", locationName: "國5北向 25.3K", tunnelSection: "隧道前段 B" },
  { detectorId: "VD-N5-N-25.000", mileageKm: 25.000, direction: "N", locationName: "國5北向 25.0K", tunnelSection: "隧道中前段" },
  { detectorId: "VD-N5-N-23.800", mileageKm: 23.800, direction: "N", locationName: "國5北向 23.8K", tunnelSection: "隧道核心中段" },
  { detectorId: "VD-N5-N-22.500", mileageKm: 22.500, direction: "N", locationName: "國5北向 22.5K (避車彎段)", tunnelSection: "隧道核心中段" },
  { detectorId: "VD-N5-N-21.400", mileageKm: 21.400, direction: "N", locationName: "國5北向 21.4K", tunnelSection: "隧道中後段" },
  { detectorId: "VD-N5-N-20.200", mileageKm: 20.200, direction: "N", locationName: "國5北向 20.2K", tunnelSection: "隧道後段 A" },
  { detectorId: "VD-N5-N-19.100", mileageKm: 19.100, direction: "N", locationName: "國5北向 19.1K", tunnelSection: "隧道後段 B" },
  { detectorId: "VD-N5-N-18.000", mileageKm: 18.000, direction: "N", locationName: "國5北向 18.0K (雪隧出口前段)", tunnelSection: "隧道出口前段" },
  { detectorId: "VD-N5-N-15.179", mileageKm: 15.179, direction: "N", locationName: "國5北向 15.2K (雪山隧道北向終點 15K+179/坪林端)", tunnelSection: "隧道終點區" },
];

export const HSUEHSHAN_BOUNDS = {
  S: { minKm: 15.203, maxKm: 28.128, lengthKm: 12.925 },
  N: { minKm: 15.179, maxKm: 28.134, lengthKm: 12.955 },
};
