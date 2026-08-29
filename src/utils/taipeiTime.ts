/**
 * 台北標準時間 (Asia/Taipei, UTC+8) 交通時空特徵與尖峰時段解析核心工具庫
 *
 * 徹底解決伺服器容器與使用者瀏覽器跨時區 (UTC / PDT / Asia/Taipei) 導致的
 * 「週六下午被誤判為平日/離峰」或「尖峰時段方向性判定失準」問題。
 */

export const WEEKDAY_NAMES = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

export interface TaipeiTimeInfo {
  dateObj: Date;
  year: number;
  month: number; // 1 ~ 12
  day: number; // 1 ~ 31
  hour: number; // 0 ~ 23
  minute: number; // 0 ~ 59
  second: number; // 0 ~ 59
  dayOfWeekIndex: number; // 0 = Sunday, 6 = Saturday
  dayOfWeek: string; // e.g. "星期六"
  isWeekend: boolean; // 週六或週日
  isFriday: boolean;
  dateStr: string; // "YYYY-MM-DD"
  timeFormatted: string; // "YYYY/MM/DD HH:mm:ss"
  weekOfMonth: number; // 1 ~ 5
  weekOfMonthLabel: string; // e.g. "8月 第4週"
}

/**
 * 將任何時間輸入轉換為台北時間 (Asia/Taipei, UTC+8) 詳細結構
 */
export function getTaipeiTimeInfo(inputDate: Date | number | string = new Date()): TaipeiTimeInfo {
  const d = typeof inputDate === "string" || typeof inputDate === "number" ? new Date(inputDate) : inputDate;
  
  // 使用 Intl.DateTimeFormat 精準取得 Asia/Taipei 時區的年月日日時分秒
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "narrow",
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const year = parseInt(partMap.year || "2026", 10);
  const month = parseInt(partMap.month || "1", 10);
  const day = parseInt(partMap.day || "1", 10);
  let hour = parseInt(partMap.hour || "0", 10);
  if (hour === 24) hour = 0; // 一些環境 24 代表 00
  const minute = parseInt(partMap.minute || "0", 10);
  const second = parseInt(partMap.second || "0", 10);

  // 取得台北時區的星期幾 (利用 UTC 計算以避免本機時區干擾)
  // 建立台北當地的 Date 假物件用於計算 getDay()
  const localTaipeiDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const dayOfWeekIndex = localTaipeiDate.getUTCDay();
  const dayOfWeek = WEEKDAY_NAMES[dayOfWeekIndex];

  const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
  const isFriday = dayOfWeekIndex === 5;

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timeFormatted = `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;

  const weekOfMonth = Math.min(5, Math.ceil(day / 7));
  const weekOfMonthLabel = `${month}月 第${weekOfMonth}週`;

  return {
    dateObj: d,
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeekIndex,
    dayOfWeek,
    isWeekend,
    isFriday,
    dateStr,
    timeFormatted,
    weekOfMonth,
    weekOfMonthLabel,
  };
}

export interface PeakDetectionResult {
  isPeak: boolean;
  peakLevel: "OFF_PEAK" | "MODERATE_PEAK" | "HEAVY_PEAK" | "EXTREME_PEAK";
  periodName: string;
  peakReason: string;
  recommendedLaneStrategy?: "INNER_PREFERRED" | "OUTER_PREFERRED" | "BALANCED";
  busFlowIntensity: "LOW" | "NORMAL" | "HIGH" | "VERY_HIGH";
}

/**
 * 依據台北即時時空特徵與方向 (南向/北向)，精準判定雪山隧道尖峰時段
 */
export function detectTunnelPeakStatus(
  inputDate: Date | number | string = new Date(),
  direction: "N" | "S" = "N"
): PeakDetectionResult {
  const info = getTaipeiTimeInfo(inputDate);
  const { month, dayOfWeekIndex, hour, minute } = info;
  const isSummer = month === 7 || month === 8;
  const timeDecimal = hour + minute / 60;

  // 1. 週六 (Saturday, dayOfWeekIndex = 6)
  if (dayOfWeekIndex === 6) {
    if (direction === "S") {
      // 南向：出遊大潮 (06:00 ~ 16:30)
      if (timeDecimal >= 6.0 && timeDecimal <= 12.5) {
        return {
          isPeak: true,
          peakLevel: "EXTREME_PEAK",
          periodName: "週六上午南下出遊早鳥大尖峰",
          peakReason: "南港-坪林-雪隧南向龐大出遊車流，客運班次密集",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "VERY_HIGH",
        };
      } else if (timeDecimal > 12.5 && timeDecimal <= 16.5) {
        return {
          isPeak: true,
          peakLevel: "HEAVY_PEAK",
          periodName: "週六午後南下觀光第二波尖峰",
          peakReason: "午後往宜蘭飯店與景點出遊車潮持續匯入",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "HIGH",
        };
      }
    } else {
      // 北向：午後提前北返車流 (14:30 ~ 21:00)
      if (timeDecimal >= 14.5 && timeDecimal <= 21.0) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "週六午後提前北返小尖峰",
          peakReason: "部分當日往返一日遊車流提前北返台北",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      }
    }
  }

  // 2. 週日 (Sunday, dayOfWeekIndex = 0)
  if (dayOfWeekIndex === 0) {
    if (direction === "N") {
      // 北向：收假極端大尖峰 (11:30 ~ 23:00)
      if (timeDecimal >= 13.0 && timeDecimal <= 21.5) {
        return {
          isPeak: true,
          peakLevel: "EXTREME_PEAK",
          periodName: "週日午後北上收假極端大尖峰 (高乘載管制)",
          peakReason: "宜蘭各交流道龐大北返收假車潮，大客車專用道高頻匯流",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "VERY_HIGH",
        };
      } else if (timeDecimal >= 11.5 && timeDecimal <= 23.0) {
        return {
          isPeak: true,
          peakLevel: "HEAVY_PEAK",
          periodName: "週日北上收假疏運高峰期",
          peakReason: "頭城至坪林北向長時高負載運行",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "HIGH",
        };
      }
    } else {
      // 南向：早晨零星出遊 (08:00 ~ 12:00)
      if (timeDecimal >= 8.0 && timeDecimal <= 12.0) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "週日上午南下出遊小車潮",
          peakReason: "週日短程觀光出遊車流",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      }
    }
  }

  // 3. 週五 (Friday, dayOfWeekIndex = 5)
  if (dayOfWeekIndex === 5) {
    if (direction === "S") {
      // 南向：週末前夕提前往宜蘭 (15:00 ~ 22:00)
      if (timeDecimal >= 15.5 && timeDecimal <= 21.5) {
        return {
          isPeak: true,
          peakLevel: "HEAVY_PEAK",
          periodName: "週五傍晚出遊與返鄉前夕尖峰",
          peakReason: "下班車潮與週末提前往宜蘭度假車流匯聚",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "HIGH",
        };
      }
    } else {
      // 北向：平日傍晚通勤 (17:00 ~ 19:30)
      if (timeDecimal >= 17.0 && timeDecimal <= 19.5) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "週五晚間通勤車流",
          peakReason: "常態工作日下班通勤",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      }
    }
  }

  // 4. 一般平日 (週一至週四)
  if (dayOfWeekIndex >= 1 && dayOfWeekIndex <= 4) {
    if (direction === "S") {
      if (timeDecimal >= 7.5 && timeDecimal <= 9.5) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "平日早通勤時段 (南向)",
          peakReason: "雙北往宜蘭商務與通勤車流",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      } else if (timeDecimal >= 17.5 && timeDecimal <= 19.5) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "平日晚通勤時段 (南向)",
          peakReason: "下班返程車流",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      }
    } else {
      if (timeDecimal >= 7.0 && timeDecimal <= 9.5) {
        return {
          isPeak: true,
          peakLevel: "HEAVY_PEAK",
          periodName: "平日早通勤時段 (北向宜蘭往台北)",
          peakReason: "宜蘭往大台北通勤工作車潮，客運專用道啟用",
          recommendedLaneStrategy: "INNER_PREFERRED",
          busFlowIntensity: "HIGH",
        };
      } else if (timeDecimal >= 17.0 && timeDecimal <= 19.5) {
        return {
          isPeak: true,
          peakLevel: "MODERATE_PEAK",
          periodName: "平日晚通勤時段 (北向)",
          peakReason: "下班北返通勤車流",
          recommendedLaneStrategy: "BALANCED",
          busFlowIntensity: "NORMAL",
        };
      }
    }

    if (isSummer && timeDecimal >= 9.0 && timeDecimal <= 16.0) {
      return {
        isPeak: true,
        peakLevel: "MODERATE_PEAK",
        periodName: "暑假平日觀光車流",
        peakReason: "暑期旅遊家庭自駕車潮",
        recommendedLaneStrategy: "BALANCED",
        busFlowIntensity: "NORMAL",
      };
    }
  }

  // 5. 離峰與自由流
  return {
    isPeak: false,
    peakLevel: "OFF_PEAK",
    periodName: "一般離峰自由流時段",
    peakReason: "全線車流順暢，維持速限穩定行駛",
    recommendedLaneStrategy: "BALANCED",
    busFlowIntensity: "LOW",
  };
}

/**
 * 判定是否處於週末或假日尖峰時段 (兼容舊 API)
 */
export function isWeekendPeakTime(
  date: Date | number | string = new Date(),
  direction: "N" | "S" = "N"
): boolean {
  const peak = detectTunnelPeakStatus(date, direction);
  return peak.isPeak && (peak.peakLevel === "HEAVY_PEAK" || peak.peakLevel === "EXTREME_PEAK");
}
