import { useState } from "react";
import {
  ChevronRight,
  RefreshCw,
  X,
  ArrowUpRight,
  Copy,
  Clock3,
} from "lucide-react";
import {
  agentChoices,
  agentName,
  agentMark,
  agentColor,
  agentProvider,
  type Snapshot,
} from "./types";
import { windows, countdown, percent, summaryWindow } from "./quotas";
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
              "Highest reported usage per account",
              "계정별로 가장 많이 사용한 한도를 표시합니다.",
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
        <div className="usage-columns" aria-hidden="true">
          <span>{t("Account", "계정")}</span>
          <span>{t("Used", "사용률")}</span>
          <span>{t("Resets in", "초기화")}</span>
        </div>
        {agentChoices(state.settings).map((a) => {
          const ws = windows(a, state.limits[a]),
            summary = summaryWindow(ws),
            meta = (state.limits[a] || {}) as Meta,
            u = state.usage?.[a],
            expanded = detail === a,
            stale = meta.status === "stale";
          const status =
            meta.refreshing || meta.status === "loading"
              ? t("Checking…", "조회 중…")
              : meta.status === "signed_out"
                ? t("Sign in", "로그인 필요")
                : meta.status === "unlimited"
                  ? t("Unlimited", "무제한")
                  : meta.status === "cli_only"
                    ? t("Awaiting CLI", "CLI 보고 대기")
                    : t("Unavailable", "조회 불가");
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
                <span className="usage-account">
                  <span
                    className="agent-mark small"
                    style={{ color: agentColor(a) }}
                  >
                    {agentMark(a)}
                  </span>
                  <strong title={agentName(a, state.agent_labels)}>
                    {agentName(a, state.agent_labels)}
                  </strong>
                </span>
                {summary ? (
                  <>
                    <span className="usage-reading" title={summary.label}>
                      <span className="window-meter" aria-hidden="true">
                        <i
                          className={summary.used >= 85 ? "high" : ""}
                          style={{ width: `${summary.used}%` }}
                        />
                      </span>
                      <strong>{percent(summary.used)}</strong>
                    </span>
                    <span className={stale ? "quota-stale" : "usage-reset"}>
                      {stale
                        ? t("Last known", "이전 조회값")
                        : countdown(summary.reset) || "—"}
                    </span>
                  </>
                ) : (
                  <span className="quota-empty">{status}</span>
                )}
                <ChevronRight size={13} className={expanded ? "rotate" : ""} />
              </button>
              {expanded && (
                <div className="usage-detail">
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
                          w.reset
                            ? new Date(w.reset * 1000).toLocaleString()
                            : ""
                        }
                      >
                        <Clock3 size={10} />
                        {w.reset
                          ? countdown(w.reset)
                          : t("Reset not reported", "초기화 시각 미제공")}
                      </small>
                      <p className="window-left">
                        {percent(100 - w.used)} {t("remaining", "남음")}
                        {w.reset &&
                          ` · ${new Date(w.reset * 1000).toLocaleString()}`}
                      </p>
                    </div>
                  ))}
                  <>
                    {meta.status === "cli_only" ? (
                      <p className="usage-help">
                        {t(
                          "This login does not expose local OAuth credentials for a direct lookup. Limits will appear if Claude Code reports them during a run with this account.",
                          "이 로그인은 직접 조회에 필요한 로컬 OAuth 정보를 제공하지 않습니다. 이 계정으로 실행할 때 Claude Code가 한도를 보고하면 표시합니다.",
                        )}
                      </p>
                    ) : (
                      meta.message && (
                        <p className={stale ? "usage-warning" : "usage-help"}>
                          {meta.message}
                        </p>
                      )
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
                          (agentProvider(a) === "claude" && a !== "claude"
                            ? "Claude Code CLI"
                            : t("Local sign-in", "기존 로그인"))}
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
                    {login[a] && (
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
                    )}
                  </>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <footer>
        {t(
          "Select an account for all limits and project tokens.",
          "계정을 선택하면 전체 한도와 프로젝트 토큰을 볼 수 있습니다.",
        )}
      </footer>
      {error && <p className="danger-text">{error}</p>}
    </section>
  );
}
