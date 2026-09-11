import React, { useState } from "react";
import { ExternalLink, Sparkles, X, ArrowRight, Globe } from "lucide-react";

interface DomainMigrationBannerProps {
  targetUrl?: string;
}

export default function DomainMigrationBanner({
  targetUrl = "https://f1no51528.ai.studio",
}: DomainMigrationBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  // 若當前已經在目標網域，則不顯示跳轉橫幅
  if (typeof window !== "undefined" && window.location.hostname === "f1no51528.ai.studio") {
    return null;
  }

  if (isDismissed) {
    return null;
  }

  const handleGoToNewSite = () => {
    window.location.href = targetUrl;
  };

  return (
    <div
      id="domain-migration-banner"
      className="bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-800 text-white shadow-md border-b border-emerald-600/40 relative z-30 transition-all"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
        {/* 左側說明文案 */}
        <div className="flex items-center gap-2.5 min-w-0 text-center sm:text-left w-full sm:w-auto">
          <div className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/20">
            <Sparkles className="w-4 h-4 text-emerald-200 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="font-bold flex items-center gap-1.5 justify-center sm:justify-start flex-wrap">
              <span>新版專屬網域服務站已上線</span>
              <span className="bg-emerald-400 text-slate-900 text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                NEW
              </span>
            </div>
            <p className="text-emerald-100 text-[11px] sm:text-xs truncate">
              點擊進入全新伺服器節點，獲取更即時、順暢的雪隧車道與全線路況體驗
            </p>
          </div>
        </div>

        {/* 右側：跳轉按鈕與關閉按鈕 */}
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-center sm:justify-end">
          <a
            id="btn-goto-new-domain"
            href={targetUrl}
            onClick={(e) => {
              e.preventDefault();
              handleGoToNewSite();
            }}
            className="w-full sm:w-auto px-4 py-2 bg-white text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900 active:scale-95 font-bold text-xs sm:text-sm rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-white/60 group"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600 group-hover:rotate-12 transition-transform" />
            <span>點此進入新版網頁</span>
            <ArrowRight className="w-3.5 h-3.5 text-emerald-700 group-hover:translate-x-0.5 transition-transform" />
          </a>

          <button
            id="btn-dismiss-migration-banner"
            onClick={() => setIsDismissed(true)}
            title="暫時關閉此橫幅"
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
            aria-label="關閉通知"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
