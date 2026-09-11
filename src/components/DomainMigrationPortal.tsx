import React from "react";
import { ArrowRight, Compass, ShieldCheck, Sparkles, Video, Gauge } from "lucide-react";

interface DomainMigrationPortalProps {
  targetUrl?: string;
}

export default function DomainMigrationPortal({
  targetUrl = "https://f1no51528.ai.studio",
}: DomainMigrationPortalProps) {
  return (
    <div
      id="domain-migration-portal"
      className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-white relative overflow-hidden"
    >
      {/* Background ambient lighting */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-emerald-500/10 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[350px] bg-teal-500/10 blur-[120px] pointer-events-none rounded-full" />

      {/* Top Simple Brand Bar */}
      <header className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-inner">
            <Compass className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="font-black text-base sm:text-lg tracking-wide text-white">
              餅乾・國道5號即時路況系統
            </div>
            <div className="text-[11px] text-emerald-400 font-medium tracking-wider uppercase">
              Hsuehshan Tunnel Realtime Analytics
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-[11px] text-emerald-300 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>官方新節點認證</span>
        </div>
      </header>

      {/* Center Hero Card with ONLY the Big Button */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <div className="w-full max-w-2xl bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl text-center flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold mb-4">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>全新網域專屬服務站正式上線</span>
          </div>

          {/* Heading */}
          <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight mb-4">
            國道5號・雪山隧道
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              即時車流分析與車道推薦系統
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-lg mb-8">
            本服務已全面升級並遷往新版雲端節點，提供更即時的雪隧內外側車道推薦、0K~54K 全線車速監控、高畫質 CCTV 與匝道儀控管制秒數。
          </p>

          {/* The ONLY Choice: The Giant Prominent Action Button */}
          <a
            id="btn-enter-new-domain"
            href={targetUrl}
            className="w-full sm:w-auto px-8 sm:px-12 py-5 sm:py-6 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:via-teal-400 hover:to-emerald-500 text-slate-950 font-black text-lg sm:text-2xl rounded-2xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3.5 cursor-pointer border border-emerald-300/40 group"
          >
            <span>進入新版網頁</span>
            <ArrowRight className="w-6 h-6 sm:w-7 sm:h-7 text-slate-950 group-hover:translate-x-1.5 transition-transform" />
          </a>

          {/* Target URL Reference */}
          <div className="mt-4 text-xs text-slate-400 font-mono">
            目標網址：
            <span className="text-emerald-400 underline underline-offset-2">
              {targetUrl}
            </span>
          </div>

          {/* Semantic SEO Keyword Highlights for Search Engines & Accessibility */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 w-full text-left text-xs text-slate-400 space-y-2">
            <div className="font-bold text-slate-300 text-[11px] uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
              <span>核心即時監控涵蓋範圍</span>
            </div>
            <p className="leading-relaxed text-[11px] text-slate-400">
              • <strong>雪山隧道車道推薦</strong>：雙向 20 微元空間積分流速推估，即時比對內側與外側車道行駛速度。
            </p>
            <p className="leading-relaxed text-[11px] text-slate-400">
              • <strong>0K~54K 走廊監控</strong>：包含南港系統、石碇、坪林、頭城、宜蘭、羅東與蘇澳全線即時車速與旅程時間。
            </p>
            <p className="leading-relaxed text-[11px] text-slate-400">
              • <strong>匝道儀控與紅綠燈管制</strong>：各交流道儀控放行秒數預估與頭城 30.5K 主線紅綠燈管制狀態。
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 text-center text-xs text-slate-500">
        <p>© 餅乾 - 國道5號即時車流分析系統 | 交通部 TDX 數據即時串流</p>
      </footer>
    </div>
  );
}
