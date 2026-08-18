/** 相对时间文案（中文）：1 分钟内"刚刚"，1 小时内"X 分钟前"，24 小时内"X 小时前"，7 天内"X 天前"，其余显示日期。 */
export const relativeTime = (timestamp: number, now: number): string => {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return Math.floor(diff / minute) + " 分钟前";
  if (diff < day) return Math.floor(diff / hour) + " 小时前";
  if (diff < 7 * day) return Math.floor(diff / day) + " 天前";
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const sameYear = date.getFullYear() === nowDate.getFullYear();
  const pad = (value: number) => String(value).padStart(2, "0");
  return sameYear ? (date.getMonth() + 1) + "月" + date.getDate() + "日" : date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日";
};
