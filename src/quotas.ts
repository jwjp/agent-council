export interface WindowUsage {
  label: string;
  used: number;
  reset: number | null;
}
export function summaryWindow(ws: WindowUsage[]) {
  return ws.reduce<WindowUsage | undefined>(
    (best, w) => (!best || w.used > best.used ? w : best),
    undefined,
  );
}
export function percent(used: number) {
  if (used > 0 && used < 0.1) return "<0.1%";
  if (used < 100 && used > 99.9) return ">99.9%";
  return `${Number(used.toFixed(1))}%`;
}
export function quotaLabel(label: string) {
  return label === "5 hours"
    ? "5h"
    : label === "Weekly"
      ? "wk"
      : label === "Monthly" || label === "Plan"
        ? "mo"
        : label.includes("Gemini")
          ? "Gemini"
          : label.includes("Claude")
            ? "Claude/GPT"
            : label;
}
type V = Record<string, any>;
export function windows(agent: string, data: unknown): WindowUsage[] {
  const value = data as V;
  if (!value) return [];
  if (Array.isArray(value.windows))
    return value.windows.filter(
      (w: WindowUsage) => typeof w.used === "number" && Number.isFinite(w.used),
    );
  const list: WindowUsage[] = [];
  const add = (label: string, used: unknown, reset: unknown) => {
    if (typeof used !== "number" || !Number.isFinite(used)) return;
    let time =
      typeof reset === "number"
        ? reset
        : typeof reset === "string"
          ? Date.parse(reset) / 1000
          : null;
    list.push({
      label,
      used: Math.max(0, Math.min(100, used)),
      reset: time && Number.isFinite(time) ? time : null,
    });
  };
  if (agent === "codex") {
    for (const key of ["primary", "secondary"]) {
      const w = value.rateLimits?.[key];
      if (w)
        add(
          w.windowDurationMins === 10080
            ? "Weekly"
            : w.windowDurationMins
              ? `${w.windowDurationMins / 60}h`
              : "Usage",
          w.usedPercent,
          w.resetsAt,
        );
    }
  }
  if (agent === "claude") {
    for (const [key, w] of Object.entries(
      value.unifiedWindows || { [value.rateLimitType]: value },
    ) as [string, V][]) {
      if (
        typeof w?.utilization === "number" &&
        (!w.resetsAt || w.resetsAt > Date.now() / 1000)
      )
        add(key.replaceAll("_", " "), 100 * w.utilization, w.resetsAt);
    }
  }
  if (agent === "agy" && Array.isArray(data)) {
    for (const group of data) {
      for (const bucket of group.buckets || []) {
        add(
          group.display_name || group.name || "Models",
          typeof bucket.remaining_fraction === "number"
            ? 100 * (1 - bucket.remaining_fraction)
            : undefined,
          bucket.reset_time,
        );
      }
    }
  }
  return list;
}
export function countdown(reset: number | null, now = Date.now() / 1000) {
  if (!reset) return "";
  const minutes = Math.max(0, Math.ceil((reset - now) / 60));
  if (!minutes) return "now";
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}
export function tokens(count: number) {
  return count >= 1000000
    ? `${(count / 1000000).toFixed(1)}m`
    : count >= 1000
      ? `${(count / 1000).toFixed(1)}k`
      : count.toLocaleString();
}
