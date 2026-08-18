import React from "react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export default function Logo({ className = "", size = "md", showText = true }: LogoProps) {
  const iconSize = size === "sm" ? 28 : size === "lg" ? 44 : 34;

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* 國道5號雪山隧道 專屬品牌 Logo 向量標誌 */}
      <div
        style={{ width: iconSize, height: iconSize }}
        className="relative shrink-0 rounded-2xl bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-1.5 shadow-md shadow-emerald-900/20 border border-emerald-500/30 flex items-center justify-center group overflow-hidden"
      >
        {/* 背景光暈效果 */}
        <div className="absolute inset-0 bg-emerald-500/10 rounded-2xl group-hover:bg-emerald-500/20 transition-all duration-300" />

        <svg
          viewBox="0 0 100 100"
          className="w-full h-full transform transition-transform group-hover:scale-105 duration-300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* 隧道圓形拱門外輪廓 */}
          <path
            d="M 16 85 L 16 50 C 16 28 32 15 50 15 C 68 15 84 28 84 50 L 84 85"
            stroke="#10b981"
            strokeWidth="7"
            strokeLinecap="round"
            className="drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]"
          />

          {/* 隧道內層拱形光環 */}
          <path
            d="M 27 85 L 27 52 C 27 36 38 27 50 27 C 62 27 73 36 73 52 L 73 85"
            stroke="#34d399"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray="4 4"
            opacity="0.6"
          />

          {/* 國道透視道路底板 */}
          <polygon
            points="32,85 45,58 55,58 68,85"
            fill="url(#roadGrad)"
            opacity="0.9"
          />

          {/* 道路中央車道分隔線（透視虛線） */}
          <line
            x1="50"
            y1="85"
            x2="50"
            y2="60"
            stroke="#ffffff"
            strokeWidth="3"
            strokeDasharray="5 4"
            strokeLinecap="round"
          />

          {/* 頂部 國道5號 徽飾 (梅花意象 / 數字 5) */}
          <circle cx="50" cy="22" r="9" fill="#047857" stroke="#6ee7b7" strokeWidth="2" />
          <text
            x="50"
            y="26"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="11"
            fontWeight="900"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            5
          </text>

          {/* 車流動態光束 */}
          <circle cx="41" cy="74" r="2" fill="#38bdf8" />
          <circle cx="59" cy="74" r="2" fill="#fbbf24" />

          {/* 漸層定義 */}
          <defs>
            <linearGradient id="roadGrad" x1="50" y1="58" x2="50" y2="85" gradientUnits="userSpaceOnUse">
              <stop stopColor="#064e3b" />
              <stop offset="1" stopColor="#022c22" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 truncate">
              餅乾・國5雪隧即時路況
            </span>
          </div>
          <span className="text-[10px] text-emerald-700 font-bold tracking-wider font-mono uppercase hidden sm:block">
            HSUEHSHAN TUNNEL TRAFFIC NAVIGATOR
          </span>
        </div>
      )}
    </div>
  );
}
