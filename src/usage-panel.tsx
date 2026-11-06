import { useState } from "react";
import {
  ChevronRight,
  RefreshCw,
  X,
  ArrowUpRight,
  Copy,
  Clock3,
} from "lucide-react";
import { agents, names, marks, colors, type Snapshot } from "./types";
import { windows, countdown, percent } from "./quotas";
import { external } from "./api";
// The Windows installer supplies .cmd/.ps1 shims; Bash may only resolve the
// colliding Grok agent.exe when an extension is omitted.
export const cursorCli =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "cursor-agent.cmd"
    : "cursor-agent";
type T = (en: string, ko: string) => string;
interface Meta {
  status?: string;
  message?: string;
  source?: string;
  auth_source?: string;
  updated_at?: string;
  refreshing?: boolean;
}
export function Usage({
  state,
  selected = "",
  t,
  close,
  refresh,
}: {
  state: Snapshot;
  selected?: string;
  t: T;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState(selected),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
  const refreshing =
    loading || Object.values(state.limits).some((v) => (v as Meta)?.refreshing);
  const links: Record<string, string> = {
    claude: "https://claude.ai/settings/usage",
    agent: "https://cursor.com/dashboard/usage",
    grok: "https://grok.com/dashboard",
    gemini: "https://geminicli.com/docs/resources/quota-and-pricing/",
  };
  const login: Record<string, string> = {
    claude: "claude",
    codex: "codex login",
    grok: "grok",
    agy: "agy",
    agent: `${cursorCli} login`,
    gemini: "gemini",
  };
  return (
    <section
      className="usage-popover dropdown"
      aria-label={t("Account usage", "계정 사용량")}
    >
      <header>
        <div>
          <strong>{t("Account usage", "계정 사용량")}</strong>
          <p>
            {t(
              "Used quota · Existing local sign-ins",
              "계정 한도 사용률 · 기존 로그인 기준",
            )}
          </p>
        </div>
        <span className="grow" />
        <button
          className="icon-button"
          title={t("Refresh available limits", "조회 가능한 한도 새로고침")}
          disabled={refreshing}
          onClick={() => {
            setLoading(true);
            setError("");
            void refresh()
              .catch((e) => setError(String(e)))
              .finally(() => setLoading(false));
          }}
        >
          <RefreshCw size={15} className={refreshing ? "spin" : ""} />
        </button>
        <button
          className="icon-button"
          aria-label={t("Close usage", "사용량 닫기")}
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <div className="usage-scroll scrollable">
        {agents.map((a) => {
          const ws = windows(a, state.limits[a]),
            meta = (state.limits[a] || {}) as Meta,
            u = state.usage?.[a],
            expanded = detail === a,
            stale = meta.status === "stale";
          return (
            <div
              className={`usage-agent ${expanded ? "is-expanded" : ""} ${stale ? "is-stale" : ""}`}
              key={a}
            >
              <button
                className="usage-agent-heading"
                aria-expanded={expanded}
                onClick={() => setDetail(expanded ? "" : a)}
              >
                <span className="agent-mark small" style={{ color: colors[a] }}>
                  {marks[a]}
                </span>
                <strong>{names[a]}</strong>
                <span className="grow" />
                {meta.refreshing ? (
                  <RefreshCw size={11} className="spin" />
                ) : stale ? (
                  <span className="quota-stale">
                    {t("Last known", "이전 조회값")}
                  </span>
                ) : !ws.length ? (
                  <span className="quota-empty">
                    {meta.status === "loading"
                      ? t("Checking…", "조회 중…")
                      : meta.status === "signed_out"
                        ? t("Sign in", "로그인 필요")
                        : meta.status === "unlimited"
                          ? "∞"
                          : t("Unavailable", "조회 불가")}
                  </span>
                ) : null}
                <ChevronRight size={13} className={expanded ? "rotate" : ""} />
              </button>
              <div className={expanded ? "usage-detail" : "usage-summary"}>
                {ws.map((w, i) => (
                  <div className="usage-window" key={i}>
                    <div className="usage-window-name" title={w.label}>
                      {w.label}
                    </div>
                    <div className="window-meter">
                      <i
                        className={w.used >= 85 ? "high" : ""}
                        style={{ width: `${w.used}%` }}
                      />
                    </div>
                    <strong>
                      {percent(w.used)} <span>{t("used", "사용")}</span>
                    </strong>
                    <small
                      title={
                        w.reset ? new Date(w.reset * 1000).toLocaleString() : ""
                      }
                    >
                      <Clock3 size={10} />
                      {w.reset
                        ? countdown(w.reset)
                        : t("Reset not reported", "초기화 시각 미제공")}
                    </small>
                    {expanded && (
                      <p className="window-left">
                        {percent(100 - w.used)} {t("remaining", "남음")}
                        {w.reset &&
                          ` · ${new Date(w.reset * 1000).toLocaleString()}`}
                      </p>
                    )}
                  </div>
                ))}
                {expanded && (
                  <>
                    {meta.message && (
                      <p className={stale ? "usage-warning" : "usage-help"}>
                        {meta.message}
                      </p>
                    )}
                    {a === "agent" && (
                      <p className="usage-help">
                        {t(
                          `Cursor IDE usage and CLI sign-in are separate. Use ${cursorCli} login and ${cursorCli} status; the generic agent command may belong to Grok.`,
                          `Cursor IDE 사용량과 CLI 로그인은 별개입니다. ${cursorCli} login과 ${cursorCli} status를 사용하세요. agent 명령은 Grok일 수 있습니다.`,
                        )}
                      </p>
                    )}
                    <div className="usage-source">
                      <span>
                        {meta.auth_source ||
                          meta.source ||
                          t("Local sign-in", "기존 로그인")}
                      </span>
                      {meta.updated_at && (
                        <time>
                          {t("Checked", "확인")}{" "}
                          {new Date(meta.updated_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                    </div>
                    <div className="token-totals">
                      <span>
                        {t(
                          "This project · input / output",
                          "이 프로젝트 · 입력 / 출력 토큰",
                        )}
                      </span>
                      <strong>
                        {u?.input_tokens?.toLocaleString() ?? "—"} /{" "}
                        {u?.output_tokens?.toLocaleString() ?? "—"}
                      </strong>
                    </div>
                    <div className="usage-actions">
                      <button
                        title={login[a]}
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(login[a])
                            .then(() => setCopied(a))
                        }
                      >
                        <Copy size={12} />
                        {copied === a
                          ? t("Copied", "복사됨")
                          : t("Copy sign-in command", "로그인 명령 복사")}
                      </button>
                      {links[a] && (
                        <button onClick={() => void external(links[a])}>
                          {t("Provider usage", "제공사 사용량")}
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        {t(
          "Percentages are account limits, not project tokens. Click an agent for details.",
          "%는 계정 한도 사용률입니다. 에이전트를 누르면 출처와 프로젝트 토큰을 볼 수 있습니다.",
        )}
      </footer>
      {error && <p className="danger-text">{error}</p>}
    </section>
  );
}
