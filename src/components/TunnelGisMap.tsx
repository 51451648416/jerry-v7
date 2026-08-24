import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  Video,
  ExternalLink,
  Play,
  RefreshCw,
  Maximize2,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Info,
} from "lucide-react";
import { FinalEstimatorOutput, Direction, CctvCamera } from "../types";
import { CCTV_CAMERAS } from "../data/cctvData";
import { ExtractedLiveEvent } from "../services/liveEventsEngine";
import Logo from "./Logo";

interface TunnelGisMapProps {
  estimatorOutput: FinalEstimatorOutput | null;
  currentDirection: Direction;
  liveEvents?: ExtractedLiveEvent[];
  onSelectCamera?: (camera: CctvCamera) => void;
  onDirectionChange?: (dir: Direction) => void;
}

export default function TunnelGisMap({
  estimatorOutput,
  currentDirection,
  liveEvents = [],
  onSelectCamera,
  onDirectionChange,
}: TunnelGisMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 縮放倍率 (預設 1.0 = 100% 一次完整顯示全線 13km，只放大縮小，不拖曳)
  const [zoomMultiplier, setZoomMultiplier] = useState<number>(1.0);
  const [showEscapes, setShowEscapes] = useState<boolean>(true);
  const [showCctv, setShowCctv] = useState<boolean>(true);

  // 選取的攝影機預覽 Popup (含 30s 倒數重播與 1 分鐘省電封面更新)
  const [selectedCam, setSelectedCam] = useState<CctvCamera | null>(null);
  const [isPlayingVideo, setIsPlayingVideo] = useState<boolean>(false);
  const [videoTimer, setVideoTimer] = useState<number>(30);
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<number>(Date.now());

  // 隧道核心常數
  const START_K = 15.2; // 坪林 (北口)
  const END_K = 28.1; // 頭城 (南口)
  const TOTAL_METERS = (END_K - START_K) * 1000; // 12,900 公尺
  const STEP_METERS = 50;
  const TUBE_DIST = 18.0;

  // 參考點與通道
  const routePointsRef = useRef<
    { x: number; y: number; k: number; meters: number }[]
  >([]);
  const escapePassagesRef = useRef<
    { id: number; k: number; p1: { x: number; y: number }; p2: { x: number; y: number } }[]
  >([]);
  const cctvPositionsRef = useRef<
    { camera: CctvCamera; x: number; y: number; k: number }[]
  >([]);

  // 推薦車道
  const fasterLaneId = estimatorOutput?.estimated_state?.laneComparison?.fasterLaneId ?? 1;

  // 車速統計
  const speedStats = (() => {
    if (!estimatorOutput?.estimated_state?.segments) return null;
    const segs = estimatorOutput.estimated_state.segments;
    let minSpd = 999;
    let maxSpd = 0;
    segs.forEach((s) => {
      if (s.estimatedSegmentSpeedKmh < minSpd) minSpd = s.estimatedSegmentSpeedKmh;
      if (s.estimatedSegmentSpeedKmh > maxSpd) maxSpd = s.estimatedSegmentSpeedKmh;
    });
    const laneComp = estimatorOutput.estimated_state.laneComparison;
    const diffSecVal = Math.abs(laneComp.differenceSec);
    const isBoth = diffSecVal < 10 || fasterLaneId === null;
    const avgSpd =
      fasterLaneId === 1
        ? laneComp.lane1.equivalentTravelSpeedKmh
        : fasterLaneId === 2
        ? laneComp.lane2.equivalentTravelSpeedKmh
        : (laneComp.lane1.equivalentTravelSpeedKmh + laneComp.lane2.equivalentTravelSpeedKmh) / 2;
    return {
      min: minSpd === 999 ? 0 : Math.round(minSpd),
      max: Math.round(maxSpd),
      avg: Math.round(avgSpd),
      fasterLane: isBoth ? "兩邊皆可" : fasterLaneId === 1 ? "內側車道" : "外側車道",
    };
  })();

  // 建立真實雪山隧道幾何座標線型
  const generateHsuehshanRoute = useCallback(() => {
    const pts: { x: number; y: number; k: number; meters: number }[] = [];
    let currX = 0;
    let currY = 0;

    for (let m = 0; m <= TOTAL_METERS; m += STEP_METERS) {
      const k = START_K + m / 1000;
      let headingDeg = 138;
      if (k >= 17.5 && k < 20.5) headingDeg = 135;
      if (k >= 20.5 && k < 24.0) headingDeg = 140;
      if (k >= 24.0 && k < 27.5) headingDeg = 136;
      if (k >= 27.5) headingDeg = 125;

      const rad = headingDeg * (Math.PI / 180);
      const dx = Math.sin(rad) * STEP_METERS;
      const dy = -Math.cos(rad) * STEP_METERS;

      pts.push({ x: currX, y: currY, k, meters: m });
      currX += dx;
      currY += dy;
    }
    routePointsRef.current = pts;

    // 計算 36 處逃生橫坑
    const escapes: { id: number; k: number; p1: { x: number; y: number }; p2: { x: number; y: number } }[] = [];
    const escapeStep = TOTAL_METERS / 35;
    for (let e = 0; e < 36; e++) {
      const mTarget = e * escapeStep;
      const p = pts.find((pt) => pt.meters >= mTarget) || pts[pts.length - 1];
      const idx = pts.indexOf(p);
      const norm = getNormalVector(pts, idx);
      escapes.push({
        id: e + 1,
        k: p.k,
        p1: { x: p.x + norm.x * -TUBE_DIST, y: p.y + norm.y * -TUBE_DIST },
        p2: { x: p.x + norm.x * TUBE_DIST, y: p.y + norm.y * TUBE_DIST },
      });
    }
    escapePassagesRef.current = escapes;

    // 計算 CCTV 鏡頭座標
    const cctvList = CCTV_CAMERAS.filter(
      (c) => c.mileage >= START_K - 0.2 && c.mileage <= END_K + 0.2
    );
    const camPosList: { camera: CctvCamera; x: number; y: number; k: number }[] = [];
    cctvList.forEach((cam) => {
      const mTarget = Math.max(0, Math.min(TOTAL_METERS, (cam.mileage - START_K) * 1000));
      const p = pts.find((pt) => pt.meters >= mTarget) || pts[pts.length - 1];
      const idx = pts.indexOf(p);
      const norm = getNormalVector(pts, idx);
      const tubeOffset = cam.direction === "S" ? -TUBE_DIST - 12 : TUBE_DIST + 12;
      camPosList.push({
        camera: cam,
        x: p.x + norm.x * tubeOffset,
        y: p.y + norm.y * tubeOffset,
        k: cam.mileage,
      });
    });
    cctvPositionsRef.current = camPosList;
  }, []);

  const getNormalVector = (
    pts: { x: number; y: number; k: number; meters: number }[],
    i: number
  ) => {
    const p0 = pts[Math.max(0, i - 1)];
    const p2 = pts[Math.min(pts.length - 1, i + 1)];
    const dx = p2.x - p0.x;
    const dy = p2.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };

  const getSpeedColor = (speedKmh: number) => {
    if (speedKmh >= 80) return "#10b981"; // 綠色 80+
    if (speedKmh >= 60) return "#f59e0b"; // 黃橘 60-80
    return "#ef4444"; // 紅色 <60
  };

  // 繪製偏置路徑
  const drawOffsetPath = (
    ctx: CanvasRenderingContext2D,
    pts: { x: number; y: number; k: number; meters: number }[],
    offsetMeters: number,
    lineWidth: number,
    strokeStyle: string,
    isDashed = false,
    dashArray = [4, 6]
  ) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const norm = getNormalVector(pts, i);
      const x = p.x + norm.x * offsetMeters;
      const y = p.y + norm.y * offsetMeters;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    if (isDashed) {
      ctx.setLineDash(dashArray);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
  };

  // 初始化與定時器
  useEffect(() => {
    generateHsuehshanRoute();
  }, [generateHsuehshanRoute]);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlayingVideo) {
      interval = setInterval(() => {
        setVideoTimer((prev) => {
          if (prev <= 1) {
            setIsPlayingVideo(false);
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setVideoTimer(30);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlayingVideo]);

  useEffect(() => {
    const snapshotInterval = setInterval(() => {
      setSnapshotTimestamp(Date.now());
    }, 60000);
    return () => clearInterval(snapshotInterval);
  }, []);

  // 主繪製邏輯：將全線 13km 完美自動適配繪製為單張高解析度圖片全貌
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 依據容器寬高設定物理像素
    const containerW = canvas.parentElement?.clientWidth || 800;
    const containerH = canvas.parentElement?.clientHeight || 480;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = containerW * dpr;
    canvas.height = containerH * dpr;
    ctx.scale(dpr, dpr);

    // 清空背景：優雅的白灰科技底圖
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, containerW, containerH);

    let pts = routePointsRef.current;
    if (pts.length === 0) {
      generateHsuehshanRoute();
      pts = routePointsRef.current;
    }
    if (pts.length === 0) return;

    // 計算 13km 隧道整體幾何包圍盒 (Bounding Box)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const routeW = maxX - minX || 1;
    const routeH = maxY - minY || 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // 計算適配縮放比率，預留四周 padding 讓全景完全容納於畫面中
    const padX = containerW < 640 ? 40 : 80;
    const padY = containerW < 640 ? 60 : 70;
    const baseFitScale = Math.min(
      (containerW - padX * 2) / routeW,
      (containerH - padY * 2) / routeH
    );
    const effectiveScale = baseFitScale * zoomMultiplier;

    ctx.save();
    // 居中投影變換 (Centered Auto-Fit Projection)
    ctx.translate(containerW / 2, containerH / 2);
    ctx.scale(effectiveScale, effectiveScale);
    ctx.translate(-centerX, -centerY);

    // 1. 背景科技網格 (每 500m)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1 / effectiveScale;
    ctx.beginPath();
    for (let i = -10000; i <= 30000; i += 400) {
      ctx.moveTo(i, -10000);
      ctx.lineTo(i, 30000);
      ctx.moveTo(-10000, i);
      ctx.lineTo(30000, i);
    }
    ctx.stroke();

    // 2. 逃生橫坑 (36 處人行/車行聯絡道)
    if (showEscapes) {
      escapePassagesRef.current.forEach((esc) => {
        ctx.beginPath();
        ctx.moveTo(esc.p1.x, esc.p1.y);
        ctx.lineTo(esc.p2.x, esc.p2.y);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(14, 165, 233, 0.4)";
        ctx.stroke();
      });
    }

    // 3. 雙孔隧道實體路基 (南下左管 & 北上右管)
    drawOffsetPath(ctx, pts, -TUBE_DIST, 16, "#cbd5e1");
    drawOffsetPath(ctx, pts, TUBE_DIST, 16, "#cbd5e1");

    drawOffsetPath(ctx, pts, -TUBE_DIST, 12, "#1e293b"); // 南下柏油
    drawOffsetPath(ctx, pts, TUBE_DIST, 12, "#1e293b"); // 北上柏油

    // 4. 20 微元車流即時速度熱力線段 (內側 Lane 1 + 外側 Lane 2)
    if (estimatorOutput?.estimated_state?.segments) {
      const segs = estimatorOutput.estimated_state.segments;
      const laneComp = estimatorOutput.estimated_state.laneComparison;
      const l1Ratio = laneComp && laneComp.lane1 && laneComp.lane1.equivalentTravelSpeedKmh > 0
        ? laneComp.lane1.equivalentTravelSpeedKmh / Math.max(1, estimatorOutput.estimated_state.equivalentTravelSpeedKmh)
        : 1;
      const l2Ratio = laneComp && laneComp.lane2 && laneComp.lane2.equivalentTravelSpeedKmh > 0
        ? laneComp.lane2.equivalentTravelSpeedKmh / Math.max(1, estimatorOutput.estimated_state.equivalentTravelSpeedKmh)
        : 1;

      segs.forEach((seg) => {
        const segStartM = (seg.startMileageKm - START_K) * 1000;
        const segEndM = (seg.endMileageKm - START_K) * 1000;
        const minM = Math.min(segStartM, segEndM);
        const maxM = Math.max(segStartM, segEndM);
        const baseSpeed = seg.estimatedSegmentSpeedKmh;

        const lane1Speed = Math.max(20, Math.min(100, baseSpeed * l1Ratio));
        const lane2Speed = Math.max(20, Math.min(100, baseSpeed * l2Ratio));

        const colorL1 = getSpeedColor(lane1Speed);
        const colorL2 = getSpeedColor(lane2Speed);

        const relevantPts = pts.filter((p) => p.meters >= minM && p.meters <= maxM);
        if (relevantPts.length < 2) return;

        // 南下 (S) 車道繪製於左管 (-TUBE_DIST)
        if (currentDirection === "S") {
          // 內側車道 Lane 1 (靠中壁)
          drawOffsetPath(ctx, relevantPts, -TUBE_DIST + 3, 3.5, colorL1);
          // 外側車道 Lane 2 (靠外壁)
          drawOffsetPath(ctx, relevantPts, -TUBE_DIST - 3, 3.5, colorL2);
          // 反向北上管 (右管) 給予概略路況
          drawOffsetPath(ctx, relevantPts, TUBE_DIST, 5, colorL1);
        } else {
          // 北上 (N) 車道繪製於右管 (TUBE_DIST)
          // 內側車道 Lane 1 (靠中壁)
          drawOffsetPath(ctx, relevantPts, TUBE_DIST - 3, 3.5, colorL1);
          // 外側車道 Lane 2 (靠外壁)
          drawOffsetPath(ctx, relevantPts, TUBE_DIST + 3, 3.5, colorL2);
          // 反向南下管 (左管) 給予概略路況
          drawOffsetPath(ctx, relevantPts, -TUBE_DIST, 5, colorL1);
        }
      });
    }

    // 5. 豎井節點 (一號豎井 18.5K / 二號豎井 23.0K)
    const shaftMarkers = [
      { k: 18.5, name: "一號豎井" },
      { k: 23.0, name: "二號豎井" },
    ];
    shaftMarkers.forEach((shaft) => {
      const mTarget = (shaft.k - START_K) * 1000;
      const p = pts.find((pt) => pt.meters >= mTarget) || pts[0];
      if (p) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#6366f1";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "bold 11px sans-serif";
        ctx.fillStyle = "#4338ca";
        ctx.textAlign = "center";
        ctx.fillText(`${shaft.name} (${shaft.k}K)`, p.x, p.y - 14);
        ctx.restore();
      }
    });

    // 6. 隧道起點 (北口 15.2K 坪林) 與 終點 (南口 28.1K 頭城)
    const pStart = pts[0];
    const pEnd = pts[pts.length - 1];

    if (pStart) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pStart.x, pStart.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#059669";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#065f46";
      ctx.textAlign = "center";
      ctx.fillText("北口·坪林端 (15.2K)", pStart.x, pStart.y - 18);
      ctx.restore();
    }

    if (pEnd) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pEnd.x, pEnd.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#0891b2";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#155e75";
      ctx.textAlign = "center";
      ctx.fillText("南口·頭城端 (28.1K)", pEnd.x, pEnd.y + 24);
      ctx.restore();
    }

    // 7. CCTV 攝影機節點 (可點選預覽實時路況)
    if (showCctv) {
      cctvPositionsRef.current.forEach((item) => {
        const isSelected = selectedCam?.id === item.camera.id;
        ctx.save();
        ctx.beginPath();
        ctx.arc(item.x, item.y, isSelected ? 8 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#e11d48" : "#0284c7";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();

        if (zoomMultiplier > 1.2 || isSelected) {
          ctx.font = "9px monospace";
          ctx.fillStyle = "#0369a1";
          ctx.textAlign = "center";
          ctx.fillText(`${item.k.toFixed(1)}K`, item.x, item.y - 8);
        }
        ctx.restore();
      });
    }

    ctx.restore();
  }, [
    generateHsuehshanRoute,
    zoomMultiplier,
    showEscapes,
    showCctv,
    estimatorOutput,
    currentDirection,
    selectedCam,
  ]);

  useEffect(() => {
    renderCanvas();
    const handleResize = () => renderCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [renderCanvas]);

  // 點擊檢測 CCTV 攝影機
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const containerW = rect.width;
    const containerH = rect.height;

    let pts = routePointsRef.current;
    if (pts.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const routeW = maxX - minX || 1;
    const routeH = maxY - minY || 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const padX = containerW < 640 ? 40 : 80;
    const padY = containerW < 640 ? 60 : 70;
    const baseFitScale = Math.min(
      (containerW - padX * 2) / routeW,
      (containerH - padY * 2) / routeH
    );
    const effectiveScale = baseFitScale * zoomMultiplier;

    // 反向變換為世界座標
    const worldX = (clickX - containerW / 2) / effectiveScale + centerX;
    const worldY = (clickY - containerH / 2) / effectiveScale + centerY;

    // 尋找最近的 CCTV
    let clickedCam: CctvCamera | null = null;
    let minDist = 35; // 點擊容許半徑

    cctvPositionsRef.current.forEach((item) => {
      const dist = Math.hypot(item.x - worldX, item.y - worldY);
      if (dist < minDist) {
        minDist = dist;
        clickedCam = item.camera;
      }
    });

    if (clickedCam) {
      setSelectedCam(clickedCam);
      onSelectCamera?.(clickedCam);
    }
  };

  return (
    <div className="relative w-full h-[400px] sm:h-[480px] md:h-[540px] rounded-3xl overflow-hidden border border-slate-200 bg-white shadow-xl flex select-none">
      {/* 核心全景畫布：一次完整顯示 13km，無拖曳位移問題 */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-full block cursor-pointer"
        title="雪山隧道 13km 全線實況圖（點擊攝影機圖示可查看即時影像）"
      />

      {/* 頂部控制列：Logo + 狀態徽章 + 放大/縮小/重設全景控制 */}
      <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
        {/* 左側：專屬 Logo 與全景標題 */}
        <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-200 shadow-md text-slate-800">
          <Logo size="sm" showText={false} />
          <div className="flex flex-col">
            <span className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5">
              <span>雪隧 13km 全線實況圖</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                {currentDirection === "S" ? "南下 (坪林➔頭城)" : "北上 (頭城➔坪林)"}
              </span>
            </span>
            <span className="text-[9px] text-slate-500 hidden sm:block">
              一次全景預覽 · 雙管 20 微元流速實況
            </span>
          </div>
        </div>

        {/* 右側：精簡放大/縮小/重設全景工具列 (支援高倍率連續放大檢視) */}
        <div className="flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1 rounded-2xl border border-slate-200 shadow-md">
          <button
            onClick={() => setZoomMultiplier((prev) => Math.min(6.0, parseFloat((prev + 0.5).toFixed(2))))}
            className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-xl transition cursor-pointer flex items-center justify-center"
            title="放大視圖 (可持續放大至 600%)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setZoomMultiplier((prev) => Math.max(0.6, parseFloat((prev - 0.5).toFixed(2))))}
            className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-xl transition cursor-pointer flex items-center justify-center"
            title="縮小視圖"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-mono text-slate-600 px-1 font-extrabold select-none">
            {Math.round(zoomMultiplier * 100)}%
          </span>
          <div className="h-4 w-[1px] bg-slate-200 mx-0.5" />
          <button
            onClick={() => setZoomMultiplier(1.0)}
            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-extrabold rounded-xl border border-emerald-200 transition cursor-pointer flex items-center gap-1"
            title="重設 100% 全景適配"
          >
            <RotateCcw className="h-3 w-3" />
            <span>全線 13K</span>
          </button>
        </div>
      </div>

      {/* 左下角：車速摘要標籤 (Speed Summary Pill) */}
      {speedStats && (
        <div className="absolute bottom-3 left-3 z-10 bg-white/95 backdrop-blur-md px-3 py-2 rounded-2xl border border-slate-200 shadow-md text-xs font-mono hidden xs:flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-600 font-sans">平均車速：</span>
            <strong className="text-slate-900 font-black">{speedStats.avg} km/h</strong>
          </div>
          <div className="h-3 w-[1px] bg-slate-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-sans">建議首選：</span>
            <strong className="text-emerald-700 font-black font-sans">{speedStats.fasterLane}</strong>
          </div>
        </div>
      )}

      {/* 右下角：車速圖例說明 (Speed Legend) */}
      <div className="absolute bottom-3 right-3 z-10 bg-white/95 backdrop-blur-md p-2.5 sm:p-3 rounded-2xl border border-slate-200 shadow-md text-[10px] space-y-1 text-slate-600 hidden sm:block">
        <div className="font-bold text-slate-800 border-b border-slate-200 pb-1 flex items-center justify-between gap-2">
          <span>路況速限圖例</span>
          <span className="text-[9px] text-slate-400 font-normal">全段 13km</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          <span>時速 ≥ 80 km/h (順暢)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
          <span>時速 60-79 km/h (車多)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
          <span>時速 &lt; 60 km/h (壅塞)</span>
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
          <span>📹 點擊 CCTV 實時影像</span>
        </div>
      </div>

      {/* 點擊 CCTV 彈出影像浮動視窗 */}
      {selectedCam && (
        <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-auto sm:left-12 md:left-24 z-20 bg-slate-900 text-white p-3 sm:p-3.5 rounded-2xl shadow-2xl border border-slate-700 max-w-sm w-auto space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-400 truncate">
              <Video className="h-4 w-4 shrink-0" />
              <span>{selectedCam.locationName}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                {selectedCam.mileage.toFixed(1)}K
              </span>
            </span>
            <button
              onClick={() => setSelectedCam(null)}
              className="text-slate-400 hover:text-white text-sm font-bold px-1.5 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
            {isPlayingVideo ? (
              <img
                src={`${selectedCam.url}?t=${snapshotTimestamp}`}
                alt={selectedCam.locationName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="relative w-full h-full">
                <img
                  src={`${selectedCam.url}?t=${snapshotTimestamp}`}
                  alt={selectedCam.locationName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1.5">
                  <button
                    onClick={() => setIsPlayingVideo(true)}
                    className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-lg transition cursor-pointer"
                    title="播放即時動態影像 (30秒自動停止)"
                  >
                    <Play className="h-5 w-5 fill-white ml-0.5" />
                  </button>
                  <span className="text-[10px] text-slate-200">點擊播放實況 (30s)</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
            <span>更新於 {new Date(snapshotTimestamp).toLocaleTimeString("zh-TW", { hour12: false })}</span>
            {isPlayingVideo && (
              <span className="text-emerald-400 font-bold">動態串流中 ({videoTimer}s)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
