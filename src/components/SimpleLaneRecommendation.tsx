import React, { useState } from "react";
import {
  Compass,
  Zap,
  ExternalLink,
  Info,
  ShieldAlert,
  Radio,
  Layers,
  Star,
  Gauge,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Scale,
  Activity,
  Award,
} from "lucide-react";
import { FinalEstimatorOutput, Direction } from "../types";
import SpeedometerGauge from "./SpeedometerGauge";
import ApiDirectTelemetryTable from "./ApiDirectTelemetryTable";
import MathTheoryInspector from "./MathTheoryInspector";
import ModelComparisonCard from "./ModelComparisonCard";
import RawVsModelDiagnostic from "./RawVsModelDiagnostic";
import GroundTruthBenchmark from "./GroundTruthBenchmark";
import VehicleLaneAlgorithmInspector from "./VehicleLaneAlgorithmInspector";

interface SimpleLaneRecommendationProps {
  estimatorOutput: FinalEstimatorOutput;
  direction: Direction;
  onOpenAdvanced: () => void;
}

export default function SimpleLaneRecommendation({
  estimatorOutput,
  direction,
  onOpenAdvanced,
}: SimpleLaneRecommendationProps) {
  const [showAdvancedApiOptions, setShowAdvancedApiOptions] = useState(false);
  const [greySubTab, setGreySubTab] = useState<"theory" | "vehicle_algo" | "models" | "raw_vs_model" | "telemetry" | "benchmark">("vehicle_algo");
  const estState = estimatorOutput.estimated_state;
  const lane1 = estState.laneComparison.lane1;
  const lane2 = estState.laneComparison.lane2;
  const diffSec = estState.laneComparison.differenceSec;
  const fasterLaneId = estState.laneComparison.fasterLaneId;
  const consistency = estState.consistencyCheck;
  const doubleVerification = estState.doubleVerification;
  const isExtremeSituation = estState.isExtremeSituation;

  // 取得在線訓練之動態車道切換門檻與信心度
  const trainedMarginSec = Math.round(estState.laneComparison.trainedSwitchMarginSec ?? 18);
  const confidenceScore = estState.laneComparison.trainedLaneSelectionConfidence ?? 96.8;

  // 格式化數字（僅於呈現層進行四捨五入）
  const formattedLane1TravelSec = Math.round(lane1.travelTimeSec);
  const formattedLane2TravelSec = Math.round(lane2.travelTimeSec);
  const lane1EqSpeed = lane1.equivalentTravelSpeedKmh;
  const lane2EqSpeed = lane2.equivalentTravelSpeedKmh;

  const speedDiff = Math.abs(lane1EqSpeed - lane2EqSpeed);
  const diffSecVal = Math.abs(diffSec ?? (formattedLane1TravelSec - formattedLane2TravelSec));
  const isBothEqual = fasterLaneId === null || diffSecVal < 10;
  const isLane1Recommended = !isBothEqual && fasterLaneId === 1;
  const isLane2Recommended = !isBothEqual && fasterLaneId === 2;

  // 車道指示燈號顏色 (依車速判斷：80+ 綠色 ⬇, 60-80 琥珀色 ⬇, <60 紅色 ⬇)
  const lane1ArrowColor: "emerald" | "amber" | "rose" =
    lane1EqSpeed >= 80 ? "emerald" : lane1EqSpeed >= 60 ? "amber" : "rose";
  const lane2ArrowColor: "emerald" | "amber" | "rose" =
    lane2EqSpeed >= 80 ? "emerald" : lane2EqSpeed >= 60 ? "amber" : "rose";

  return (
    <div className="space-y-4">
      {/* 0. Mathematical Consistency Check Alert (If Failed) */}
      {!consistency.passed && (
        <div className="bg-rose-50 border-2 border-rose-400 p-4 rounded-2xl text-rose-900 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-bold text-sm text-rose-800">
                DATA_CONSISTENCY_ERROR (數學一致性檢驗未通過)
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-rose-700 font-mono">
                {consistency.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 1. Main Recommendation Card (Clean White Theme) */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-bold">
            <Compass className="h-3.5 w-3.5 text-emerald-600" />
            <span>
              {estState.directionLabel} (13.0 km)
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
            {estState.laneComparison?.activeDiagnosisTag && (
              <span className={`px-2 py-0.5 font-bold rounded-md border flex items-center gap-1 ${
                estState.laneComparison.activeDiagnosisTag.includes("封閉")
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : estState.laneComparison.activeDiagnosisTag.includes("烏龜") || estState.laneComparison.activeDiagnosisTag.includes("壓制")
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200/60"
              }`}>
                <span>{estState.laneComparison.activeDiagnosisTag}</span>
              </span>
            )}
            {estState.isLateNightHours && (
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded-md border border-indigo-200 flex items-center gap-1">
                <span>🌙 02~04 原API直通</span>
              </span>
            )}
            <span className="px-2 py-0.5 bg-slate-100 rounded-md">
              VD站：{estState.actualVdStationCount}處
            </span>
            <span className="px-2 py-0.5 bg-sky-50 text-sky-800 rounded-md">
              20微元
            </span>
            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded-md border border-emerald-200/60 flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              <span>車道切換模型校準</span>
            </span>
          </div>
        </div>

        {/* 結論直觀標題 */}
        <div className="space-y-1">
          <h2 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
            {estState.isLateNightHours
              ? "🌙 深夜時段 (02:00 - 04:00) 直接放原 API 資料（全線順暢）"
              : isBothEqual
              ? "雙車道流速均勻（兩邊都可以）"
              : isLane1Recommended
              ? "👈 內側車道 (左) 速度較快"
              : "外側車道 (右) 👉 速度較快"}
          </h2>
          <p className="text-xs text-slate-500">
            {estState.isLateNightHours
              ? "依規範深夜 02:00 - 04:00 不進行延遲補償或模型修正，直接忠實呈現 TDX 車輛偵測器原始觀測資料。全線暢通自由流，兩側車道皆可安全順行。"
              : isBothEqual
              ? `雙車道時間差僅 ${Math.abs(Math.round(diffSecVal))} 秒（小於 10 秒），時間相近，兩邊都可以選擇。`
              : isLane1Recommended
              ? `內側車道領先 +${speedDiff.toFixed(1)} km/h，預估省時 ${Math.abs(Math.round(diffSec))} 秒 (超逾 10 秒建議門檻)。`
              : `外側車道領先 +${speedDiff.toFixed(1)} km/h，預估省時 ${Math.abs(Math.round(diffSec))} 秒 (超逾 10 秒建議門檻)。`}
          </p>
        </div>

        {/* 車道切換學習模型微型資訊條 */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 bg-slate-50/70 p-2.5 rounded-2xl">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-slate-700 font-bold">
              切換門檻 ΔT: {trainedMarginSec}s
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">決策信心: {confidenceScore}%</span>
          </div>
          <div className="text-[10px] text-slate-400 font-sans">
            內外側雙車道連續積分
          </div>
        </div>
      </div>

      {/* 2. Lane Speedometer Cards (時速表儀表板 + 車道顏色與燈號指示) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Lane 1 / 內側車道 */}
        <div
          className={`p-4 rounded-3xl border transition relative flex flex-col justify-between space-y-3 shadow-xs ${
            isLane1Recommended || isBothEqual
              ? "bg-emerald-50/40 border-emerald-400 ring-2 ring-emerald-400/20"
              : "bg-white border-slate-200"
          }`}
        >
          {(isLane1Recommended || isBothEqual) && (
            <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-bl-xl flex items-center gap-1 shadow-xs z-10">
              <Star className="h-3 w-3 fill-current" />
              <span>{isBothEqual ? "兩邊皆可" : "★ 推薦行駛"}</span>
            </div>
          )}

          {/* 車輛時速表儀表 (Speedometer Gauge) */}
          <SpeedometerGauge
            speedKmh={lane1EqSpeed}
            laneName="👈 內側 (左)"
            laneColor="#4f46e5"
            isRecommended={isLane1Recommended || isBothEqual}
            laneArrowColor={lane1ArrowColor}
            isClosed={lane1.isClosed || lane1EqSpeed === 0}
          />

          {/* 行駛時間與細部指標 */}
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 block font-medium">預估通過耗時</span>
              <div className="text-lg font-black font-mono text-emerald-700 mt-0.5">
                {lane1.isClosed || lane1EqSpeed === 0 ? (
                  <span className="text-rose-600 font-bold text-sm">⛔ 車道封閉管制</span>
                ) : (
                  lane1.travelTimeFormatted
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 block font-mono">均速</span>
              <span className="text-xs font-bold font-mono text-slate-800">
                {lane1.isClosed || lane1EqSpeed === 0 ? (
                  <span className="text-rose-600">⛔ 0.0 km/h</span>
                ) : (
                  `${lane1EqSpeed.toFixed(1)} km/h`
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Lane 2 / 外側車道 */}
        <div
          className={`p-4 rounded-3xl border transition relative flex flex-col justify-between space-y-3 shadow-xs ${
            isLane2Recommended || isBothEqual
              ? "bg-emerald-50/40 border-emerald-400 ring-2 ring-emerald-400/20"
              : "bg-white border-slate-200"
          }`}
        >
          {(isLane2Recommended || isBothEqual) && (
            <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-bl-xl flex items-center gap-1 shadow-xs z-10">
              <Star className="h-3 w-3 fill-current" />
              <span>{isBothEqual ? "兩邊皆可" : "★ 推薦行駛"}</span>
            </div>
          )}

          {/* 車輛時速表儀表 (Speedometer Gauge) */}
          <SpeedometerGauge
            speedKmh={lane2EqSpeed}
            laneName="外側 (右) 👉"
            laneColor="#d97706"
            isRecommended={isLane2Recommended || isBothEqual}
            laneArrowColor={lane2ArrowColor}
            isClosed={lane2.isClosed || lane2EqSpeed === 0}
          />

          {/* 行駛時間與細部指標 */}
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 block font-medium">預估通過耗時</span>
              <div className="text-lg font-black font-mono text-emerald-700 mt-0.5">
                {lane2.isClosed || lane2EqSpeed === 0 ? (
                  <span className="text-rose-600 font-bold text-sm">⛔ 車道封閉管制</span>
                ) : (
                  lane2.travelTimeFormatted
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 block font-mono">均速</span>
              <span className="text-xs font-bold font-mono text-slate-800">
                {lane2.isClosed || lane2EqSpeed === 0 ? (
                  <span className="text-rose-600">⛔ 0.0 km/h</span>
                ) : (
                  `${lane2EqSpeed.toFixed(1)} km/h`
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 底部灰色進階區塊：完整整合數理模型、不等式檢驗與 API 原始數據 */}
      <div className="bg-slate-100 border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
        <button
          onClick={() => setShowAdvancedApiOptions(!showAdvancedApiOptions)}
          className="w-full px-4.5 py-3 flex items-center justify-between text-xs font-bold text-slate-700 hover:text-slate-950 transition cursor-pointer bg-slate-100 hover:bg-slate-200/80"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-600" />
            <span>數理模型與原理檢驗 ‧ TDX 遙測數據庫</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
            <span>{showAdvancedApiOptions ? "收合數理模型" : "展開數理模型"}</span>
            {showAdvancedApiOptions ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </div>
        </button>

        {showAdvancedApiOptions && (
          <div className="p-4 border-t border-slate-200 bg-white space-y-4">
            {/* 次級導覽按鈕組 */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                onClick={() => setGreySubTab("vehicle_algo")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  greySubTab === "vehicle_algo"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Cpu className="h-3.5 w-3.5 text-sky-300" />
                <span>車種辨識與車道演算法</span>
              </button>

              <button
                onClick={() => setGreySubTab("theory")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  greySubTab === "theory"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <BookOpen className="h-3 w-3" />
                <span>數學定理與不等式</span>
              </button>

              <button
                onClick={() => setGreySubTab("models")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  greySubTab === "models"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Activity className="h-3 w-3" />
                <span>20微元空間積分</span>
              </button>

              <button
                onClick={() => setGreySubTab("raw_vs_model")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  greySubTab === "raw_vs_model"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Scale className="h-3 w-3" />
                <span>RAW vs MODEL 對照</span>
              </button>

              <button
                onClick={() => setGreySubTab("telemetry")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  greySubTab === "telemetry"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>TDX API 遙測表</span>
              </button>

              <button
                onClick={() => setGreySubTab("benchmark")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                  greySubTab === "benchmark"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Award className="h-3 w-3" />
                <span>Ground Truth 評測</span>
              </button>
            </div>

            {/* 子分頁內容 */}
            <div className="pt-2">
              {greySubTab === "vehicle_algo" && (
                <VehicleLaneAlgorithmInspector estimatorOutput={estimatorOutput} direction={direction} />
              )}

              {greySubTab === "theory" && estState && (
                <MathTheoryInspector estState={estState} />
              )}

              {greySubTab === "models" && estimatorOutput && (
                <ModelComparisonCard estimatorOutput={estimatorOutput} />
              )}

              {greySubTab === "raw_vs_model" && estimatorOutput && (
                <RawVsModelDiagnostic estimatorOutput={estimatorOutput} />
              )}

              {greySubTab === "telemetry" && (
                <ApiDirectTelemetryTable
                  doubleVerification={doubleVerification}
                  isExtremeSituation={isExtremeSituation}
                  defaultExpanded={true}
                />
              )}

              {greySubTab === "benchmark" && (
                <GroundTruthBenchmark />
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={onOpenAdvanced}
                className="text-xs text-slate-600 hover:text-emerald-700 flex items-center gap-1.5 transition py-1.5 px-3 rounded-xl hover:bg-slate-100 cursor-pointer font-bold"
              >
                <span>開啟全螢幕進階工程診斷與模型訓練控制台</span>
                <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



