import { MultiCameraInspectionNode } from "../types";
export type { MultiCameraInspectionNode };

/**
 * 雪山隧道全線關鍵監控點清單 (配置化 Array)
 * 涵蓋南向 (18K~26K) 與北向 (26K~16K) 的入口、中前段、中後段、出口關鍵里程共 8 個監控節點
 */
export const HSUEHSHAN_INSPECTION_NODES: MultiCameraInspectionNode[] = [
  // === 南向 (S) 坪林往頭城 ===
  {
    id: "s18k",
    code: "s18k",
    direction: "S",
    mileage: 18.0,
    title: "國5 南向 18K",
    locationName: "雪山隧道南向入口段 18K",
    segmentType: "ENTRANCE",
    segmentName: "南向入口段 (坪林端)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=68764cce-c1f1-4ef7-a911-b33ed35e0c6f",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=0165bb74-a3e7-42ed-bda8-609f215fc9e5",
    ],
    defaultVdStationId: "VD-N5-S-18.000",
  },
  {
    id: "s21k",
    code: "s21k",
    direction: "S",
    mileage: 21.0,
    title: "國5 南向 21K",
    locationName: "雪山隧道南向前段 21K",
    segmentType: "MID_FRONT",
    segmentName: "南向前段 (21K 隧道深處)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=be36ad29-6962-4895-97a8-4d5468c565e9",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=94c5e7cd-1a1f-41ba-9f48-5d363146bf89",
    ],
    defaultVdStationId: "VD-N5-S-21.000",
  },
  {
    id: "s24k",
    code: "s24k",
    direction: "S",
    mileage: 24.0,
    title: "國5 南向 24K",
    locationName: "雪山隧道南向中後段 24K",
    segmentType: "MID_REAR",
    segmentName: "南向中後段 (24K 爬坡交織)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=5d5e6222-34f7-4dc4-9e56-2f8faf9adb3b",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bd6e6640-de85-4a89-92e8-4560d590d826",
    ],
    defaultVdStationId: "VD-N5-S-24.000",
  },
  {
    id: "s26k",
    code: "s26k",
    direction: "S",
    mileage: 26.0,
    title: "國5 南向 26K",
    locationName: "雪山隧道南向出口段 26K",
    segmentType: "EXIT",
    segmentName: "南向出口段 (頭城端湧流)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=2149a025-840c-4d32-8a18-a347e406a34f",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=dd506814-9405-4033-a7db-d16a369c025c",
    ],
    defaultVdStationId: "VD-N5-S-26.000",
  },

  // === 北向 (N) 頭城往坪林 ===
  {
    id: "n26k",
    code: "n26k",
    direction: "N",
    mileage: 26.0,
    title: "國5 北向 26K",
    locationName: "雪山隧道北向入口段 26K",
    segmentType: "ENTRANCE",
    segmentName: "北向入口段 (頭城端入隧道)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=bba9e7d7-cd6f-427f-b82d-6bff1bd0f1ed",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a",
    ],
    defaultVdStationId: "VD-N5-N-26.000",
  },
  {
    id: "n23k",
    code: "n23k",
    direction: "N",
    mileage: 23.0,
    title: "國5 北向 23K",
    locationName: "雪山隧道北向中段 23K",
    segmentType: "MID_TUNNEL",
    segmentName: "北向中段 (23K 上坡段)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=d3df6a83-fc30-48e3-9e97-85ae75f7c33c",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=894a824e-55f8-416b-8056-7d015f4dfb1a",
    ],
    defaultVdStationId: "VD-N5-N-23.000",
  },
  {
    id: "n19k",
    code: "n19k",
    direction: "N",
    mileage: 19.0,
    title: "國5 北向 19K",
    locationName: "雪山隧道北向前段 19K",
    segmentType: "MID_FRONT",
    segmentName: "北向前段 (19K 避車彎前)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=7fe38a25-2f6c-4594-9f3c-a1b88aa960a2",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=f268f53f-0bae-4723-9c6e-091c643c5a14",
    ],
    defaultVdStationId: "VD-N5-N-19.000",
  },
  {
    id: "n16k",
    code: "n16k",
    direction: "N",
    mileage: 16.0,
    title: "國5 北向 16K",
    locationName: "雪山隧道北向出口段 16K",
    segmentType: "EXIT",
    segmentName: "北向出口段 (坪林端出隧道)",
    url: "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=7d452116-b9b7-41d8-8624-06cd1f9a706d",
    fallbackUrls: [
      "https://cctvn5.freeway.gov.tw/abs2mjpg/bmjpg?camera=f268f53f-0bae-4723-9c6e-091c643c5a14",
    ],
    defaultVdStationId: "VD-N5-N-16.000",
  },
];

/**
 * 根據攝影機 ID 取得監控點配置
 */
export function getInspectionNodeById(cameraId: string): MultiCameraInspectionNode | undefined {
  return HSUEHSHAN_INSPECTION_NODES.find((node) => node.id === cameraId);
}

/**
 * 根據方向取得監控點清單
 */
export function getInspectionNodesByDirection(direction: "N" | "S"): MultiCameraInspectionNode[] {
  return HSUEHSHAN_INSPECTION_NODES.filter((node) => node.direction === direction);
}
