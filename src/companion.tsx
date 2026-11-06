import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Smartphone,
  ShieldCheck,
  ArrowUp,
  Square,
  Wifi,
  WifiOff,
  ChevronDown,
  FileText,
  RefreshCw,
  X,
  Unplug,
  Globe,
} from "lucide-react";
import { MarkdownContent } from "./markdown";
import { compactActivity, snapshotActivity } from "./companion-state";
import { WorkflowProgress } from "./workflow-view";
import { workflowProgress } from "./workflow";
import { names, marks, type Snapshot, type Activity } from "./types";
import {
  windows as quotaWindows,
  percent,
  quotaLabel,
  countdown,
} from "./quotas";
import "./companion.css";

interface Session {
  id: string;
  name: string;
  folder: string;
  coder: string | null;
  reviewers: string[];
  allow_work: boolean;
  protocol: string;
}
interface PhoneState extends Snapshot {
  device: Session;
  can_cancel: boolean;
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function call<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  keepalive = false,
): Promise<T> {
  const response = await fetch(`/companion/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
    signal: keepalive ? undefined : AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, value.error || "Request failed");
  return value as T;
}
function frames(text: string) {
  const parts = text.replace(/\r\n/g, "\n").split("\n\n");
  return { frames: parts.slice(0, -1), rest: parts.at(-1) || "" };
}
// Read the short-lived challenge once, then remove it before any other navigation.
const initialCode =
  new URLSearchParams(location.hash.slice(1)).get("pair") || "";
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);

function CompanionApp() {
  const [ko, setKo] = useState(
      () => localStorage.getItem("council-phone-language") === "ko",
    ),
    [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<PhoneState | null>(null),
    [phase, setPhase] = useState<"loading" | "pair" | "pending" | "ready">(
      "loading",
    );
  const [code, setCode] = useState(initialCode),
    [name, setName] = useState("My phone"),
    [error, setError] = useState("");
  const [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [online, setOnline] = useState(false),
    [tick, setTick] = useState(0);
  const [view, setView] = useState("council"),
    [details, setDetails] = useState(false),
    [usage, setUsage] = useState(false);
  const [preview, setPreview] = useState<{
    name: string;
    text: string;
    path: string;
    line: number | null;
    start_line: number;
    truncated: boolean;
  } | null>(null);
  const dirty = useRef(false),
    currentText = useRef(""),
    cursor = useRef(0),
    currentJob = useRef<string | undefined>(undefined),
    composer = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true),
    pending = useRef<{ request_id: string; request: string } | null>(null),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftWrite = useRef<Promise<void>>(Promise.resolve());
  const t = useCallback((en: string, kor: string) => (ko ? kor : en), [ko]);
  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      setSession(null);
      setSnapshot(null);
      setPhase("pair");
    }
    setError(String(e instanceof Error ? e.message : e));
  }, []);
  const refresh = useCallback(async () => {
    const state = await call<PhoneState>("/state");
    setSnapshot((previous) => ({
      ...state,
      activity: snapshotActivity(
        state.activity,
        previous && previous.job?.id === state.job?.id ? previous.activity : [],
        state.cursor,
      ),
    }));
    setSession(state.device);
    currentJob.current = state.job?.id;
    cursor.current = Math.max(cursor.current, state.cursor);
    if (!dirty.current) {
      setText(state.draft);
      currentText.current = state.draft;
    }
    setOnline(true);
    setError("");
    return state;
  }, []);
  useEffect(() => {
    let alive = true;
    if (initialCode) {
      setPhase("pair");
      return;
    }
    void call<Session>("/session")
      .then((s) => {
        if (alive) {
          if (s.protocol !== "companion-v1")
            throw Error("Update this companion to connect.");
          setSession(s);
          setPhase("ready");
        }
      })
      .catch(async (e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          try {
            const pending = await call<{ status?: string } & Session>(
              "/pair/complete",
              {},
            );
            if (alive) {
              if (pending.status === "pending") setPhase("pending");
              else {
                setSession(pending);
                setPhase("ready");
              }
            }
            return;
          } catch {}
        }
        if (alive) {
          setPhase("pair");
          if (!(e instanceof ApiError && e.status === 401)) handleError(e);
        }
      });
    return () => {
      alive = false;
    };
  }, [handleError]);
  useEffect(() => {
    if (phase !== "pending") return;
    let alive = true;
    const poll = () =>
      void call<Session & { status?: string }>("/pair/complete", {})
        .then((s) => {
          if (alive && s.status !== "pending") {
            setSession(s);
            setPhase("ready");
            setCode("");
            setError("");
          }
        })
        .catch((e) => {
          if (alive) {
            setPhase("pair");
            handleError(e);
          }
        });
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, handleError]);
  useEffect(() => {
    if (phase !== "ready") return;
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          await refresh();
          const response = await fetch(
            `/companion/v1/events?after=${cursor.current}`,
            { credentials: "same-origin", signal: controller.signal },
          );
          if (!response.ok)
            throw new ApiError(
              response.status,
              "Connection lost. Reconnect or pair again.",
            );
          if (!response.body)
            throw Error("This browser cannot stream progress.");
          setOnline(true);
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          try {
            while (!controller.signal.aborted) {
              const r = await reader.read();
              if (r.done) break;
              buffer += decoder.decode(r.value, { stream: true });
              const p = frames(buffer);
              buffer = p.rest;
              for (const frame of p.frames) {
                const data = frame
                  .split("\n")
                  .filter((l) => l.startsWith("data:"))
                  .map((l) => l.slice(5).trimStart())
                  .join("\n");
                if (!data) continue;
                const event = JSON.parse(data) as Activity;
                if (event.id > cursor.current) {
                  cursor.current = event.id;
                  if (
                    ["note", "phase", "tool", "workflow"].includes(event.kind)
                  ) {
                    setSnapshot((previous) =>
                      previous && previous.job?.id === event.job
                        ? {
                            ...previous,
                            activity: compactActivity([
                              ...previous.activity,
                              event,
                            ]),
                          }
                        : previous,
                    );
                  }
                  if (
                    ((event.job && event.job !== currentJob.current) ||
                      !["note", "phase", "tool", "workflow"].includes(
                        event.kind,
                      )) &&
                    !refreshTimer
                  )
                    refreshTimer = setTimeout(() => {
                      refreshTimer = undefined;
                      void refresh().catch(handleError);
                    }, 500);
                }
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          setOnline(false);
          handleError(e);
          if (e instanceof ApiError && e.status === 401) return;
        }
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 2000);
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      }
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(refreshTimer);
    };
  }, [phase, tick, refresh, handleError]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
      else if (phase === "ready" && dirty.current)
        void call("/draft", { text: currentText.current }, "PUT", true).catch(
          () => {},
        );
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [phase]);
  useEffect(() => {
    if (follow.current)
      bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [snapshot?.messages.length, view]);
  const save = (value: string) => {
    setText(value);
    currentText.current = value;
    dirty.current = true;
    clearTimeout(draftTimer.current || undefined);
    draftTimer.current = setTimeout(
      () =>
        void persist(value)
          .then(() => {
            if (currentText.current === value) dirty.current = false;
          })
          .catch(handleError),
      400,
    );
  };
  const persist = (value: string): Promise<void> => {
    const write = draftWrite.current
      .catch(() => {})
      .then(() => call<void>("/draft", { text: value }, "PUT"));
    draftWrite.current = write;
    return write;
  };
  const send = async () => {
    if (!text.trim() || sending || snapshot?.job?.status === "running") return;
    setSending(true);
    setError("");
    clearTimeout(draftTimer.current || undefined);
    try {
      const submitted = text;
      await draftWrite.current.catch(() => {});
      if (!pending.current || pending.current.request !== text)
        pending.current = { request: text, request_id: crypto.randomUUID() };
      await call("/jobs", pending.current);
      pending.current = null;
      if (currentText.current === submitted) {
        dirty.current = false;
        currentText.current = "";
        setText("");
      } else {
        dirty.current = true;
        await persist(currentText.current);
      }
      setView("council");
      follow.current = true;
      await refresh();
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };
  const openFile = async (target: string) => {
    try {
      setPreview(await call("/files/read", { target }));
    } catch (e) {
      handleError(e);
    }
  };
  useEffect(() => {
    if (!preview && !usage) return;
    const previous = document.activeElement as HTMLElement | null;
    const sheets = document.querySelectorAll<HTMLElement>(".phone-sheet"),
      sheet = sheets[sheets.length - 1];
    const nodes = () => [
      ...sheet.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href],input,textarea",
      ),
    ];
    nodes()[0]?.focus();
    composer.current?.blur();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (preview) setPreview(null);
        else setUsage(false);
      }
      if (e.key === "Tab") {
        const all = nodes(),
          first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [!!preview, usage]);
  const markdown = (content: string) => (
    <MarkdownContent
      text={content}
      onFile={(target) => void openFile(target)}
      onWeb={(href) => window.open(href, "_blank", "noopener,noreferrer")}
    />
  );
  const running = snapshot?.job?.status === "running";
  const participants = [session?.coder, ...(session?.reviewers || [])].filter(
    (a): a is string => !!a,
  );
  const progress = snapshot?.job
    ? workflowProgress(snapshot.job, snapshot.activity, snapshot.settings)
    : null;
  const awaitingReply = progress?.stage === "question";
  const lastUser =
    snapshot?.messages.map((m) => m.role).lastIndexOf("You") ?? -1;
  const messages =
    snapshot?.messages.filter((m, index) =>
      view === "council"
        ? m.role === "You" ||
          m.role === "council" ||
          m.role === "system" ||
          (awaitingReply &&
            progress.members.includes(m.role) &&
            index > lastUser)
        : m.role === "You" || m.role === view,
    ) || [];
  const latestByAgent = (agent: string) =>
    snapshot?.activity
      .filter(
        (a) =>
          a.agent === agent &&
          ["phase", "note", "tool", "done", "error"].includes(a.kind),
      )
      .at(-1);
  const statusText = (agent: string) => {
    const a = latestByAgent(agent);
    if (!a) return t("Ready", "준비됨");
    if (a.kind === "error") return t("Needs attention", "확인 필요");
    if (!running) return t("Finished", "완료");
    return a.kind === "phase"
      ? a.text
      : t("Working through it", "작업에 집중하는 중");
  };
  return (
    <div className="companion-app">
      <header className="phone-header">
        <div className="phone-brand">
          <span>≋</span>
          <div>
            <strong>Agent Council</strong>
            <small>{t("COMPANION", "컴패니언")}</small>
          </div>
        </div>
        <button
          className="phone-icon-button"
          aria-label="Change language"
          onClick={() => {
            setKo(!ko);
            localStorage.setItem("council-phone-language", !ko ? "ko" : "en");
          }}
        >
          <Globe size={18} />
          <small>{ko ? "KO" : "EN"}</small>
        </button>
      </header>
      {phase !== "ready" ? (
        <main className="pair-screen">
          <div className="pair-symbol">
            {phase === "pending" ? (
              <ShieldCheck size={32} />
            ) : (
              <Smartphone size={32} />
            )}
          </div>
          <p className="eyebrow">
            {t("YOUR HOST, YOUR WORKSPACE", "내 PC, 내 작업 공간")}
          </p>
          <h1>
            {phase === "pending"
              ? t("One last check on your PC", "PC에서 연결을 승인해 주세요")
              : t("Bring your workspace along", "어디서든 작업을 이어가세요")}
          </h1>
          <p className="pair-description">
            {phase === "pending"
              ? t(
                  "Your device name is waiting on the host. Approve it there to connect.",
                  "기기 이름이 PC에 표시됩니다. PC에서 확인 후 승인하면 연결됩니다.",
                )
              : t(
                  "Scan a pairing QR from the desktop app's Connect a phone menu. Your project and agent sign-ins stay on the host.",
                  "PC 앱의 휴대폰 연결 메뉴에서 QR을 스캔하세요. 프로젝트와 AI 로그인 정보는 PC에 보관됩니다.",
                )}
          </p>
          {error && (
            <p className="phone-alert" role="alert">
              {error}
            </p>
          )}
          {phase === "loading" ? (
            <p>{t("Checking connection…", "연결을 확인하는 중…")}</p>
          ) : (
            phase === "pair" && (
              <form
                className="pair-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError("");
                  void call("/pair", { code, name })
                    .then(() => setPhase("pending"))
                    .catch(handleError);
                }}
              >
                <label>
                  {t("Device name", "기기 이름")}
                  <input
                    aria-label="Device name"
                    autoComplete="off"
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {!code ? (
                  <p>
                    {t(
                      "Open a fresh pairing QR on the host to begin.",
                      "PC에서 새 연결 QR을 열어 주세요.",
                    )}
                  </p>
                ) : (
                  <button className="phone-primary" type="submit">
                    <LinkIcon />
                    {t("Request connection", "연결 요청")}
                  </button>
                )}
              </form>
            )
          )}
          {phase === "pending" && (
            <div className="pending-card">
              <span className="breathing-dot" />
              <span>
                {t("Waiting for host approval", "PC 승인을 기다리는 중")}
              </span>
            </div>
          )}
        </main>
      ) : (
        <>
          <section className="workspace-strip">
            <div>
              <span className="eyebrow">
                {t("CONNECTED WORKSPACE", "연결된 작업 공간")}
              </span>
              <strong>{session?.folder.split(/[\\/]/).at(-1)}</strong>
            </div>
            <span className={online ? "connection on" : "connection"}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}{" "}
              {online
                ? t("Connected", "연결됨")
                : t("Reconnecting", "재연결 중")}
            </span>
          </section>
          <nav className="phone-tabs" aria-label="Agent results">
            <button
              className={view === "council" ? "active" : ""}
              onClick={() => setView("council")}
            >
              <FileText size={15} />
              {t("Council", "최종 보고")}
            </button>
            {participants.map((a) => (
              <button
                key={a}
                className={view === a ? "active" : ""}
                aria-label={names[a]}
                onClick={() => setView(a)}
              >
                <span>{marks[a]}</span>
                {names[a]}
              </button>
            ))}
          </nav>
          {error && (
            <p className="phone-alert" role="alert">
              {error}
            </p>
          )}
          <main
            className="phone-conversation"
            onScroll={(e) => {
              const n = e.currentTarget;
              follow.current =
                n.scrollHeight - n.scrollTop - n.clientHeight < 100;
            }}
          >
            {messages.length === 0 ? (
              <div className="phone-empty">
                <span>✧</span>
                <h2>
                  {t(
                    "A little perspective goes a long way",
                    "여러 시선이 더 나은 결과로",
                  )}
                </h2>
                <p>
                  {t(
                    "Ask your team to inspect an idea, build something, or review their latest work.",
                    "팀에게 분석을 요청하거나, 작업을 맡기고 검수 결과를 확인하세요.",
                  )}
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <article
                  key={i}
                  className={`phone-message ${m.role === "You" ? "from-you" : ""}`}
                >
                  <div className="message-byline">
                    <span>{marks[m.role] || "·"}</span>
                    <strong>
                      {m.role === "You"
                        ? t("You", "나")
                        : names[m.role] || m.role}
                    </strong>
                    {m.stage && <small>{m.stage}</small>}
                  </div>
                  {markdown(m.text)}
                </article>
              ))
            )}
            {running && view === "council" && (
              <div className="phone-working">
                <span className="breathing-dot" />
                <div>
                  <strong>
                    {t("Your team is on it", "팀이 함께 살펴보고 있어요")}
                  </strong>
                  <p>
                    {t(
                      "Open an agent tab for its findings. Your host keeps working if you leave.",
                      "에이전트 탭에서 의견을 확인하세요. 화면을 닫아도 PC의 작업은 계속됩니다.",
                    )}
                  </p>
                </div>
              </div>
            )}
            {view !== "council" &&
              running &&
              (() => {
                const note = snapshot?.activity
                  .filter((a) => a.agent === view && a.kind === "note")
                  .at(-1);
                return note ? (
                  <article className="phone-message working-note">
                    <div className="message-byline">
                      {t("Working notes", "작업 메모")}
                    </div>
                    {markdown(note.text)}
                  </article>
                ) : null;
              })()}
            <div ref={bottom} />
          </main>
          {snapshot && (
            <WorkflowProgress
              job={snapshot.job}
              events={snapshot.activity}
              settings={snapshot.settings}
              t={t}
            />
          )}
          <section className="phone-activity">
            <button
              className="activity-toggle"
              onClick={() => setDetails(!details)}
            >
              <span className={running ? "breathing-dot" : "idle-dot"} />
              {running
                ? t("Team at work", "팀 작업 중")
                : t("Activity", "진행 기록")}
              <ChevronDown size={15} />
            </button>
            <div className="agent-status-row">
              {participants.map((a) => (
                <button key={a} onClick={() => setView(a)}>
                  <span>{marks[a]}</span>
                  <strong>{names[a]}</strong>
                  <small>{statusText(a)}</small>
                </button>
              ))}
            </div>
            {details && (
              <ol className="activity-list">
                {snapshot?.activity
                  .filter((a) =>
                    ["phase", "tool", "error", "done"].includes(a.kind),
                  )
                  .slice(-30)
                  .map((a) => (
                    <li key={a.id}>
                      <small>
                        {new Date(a.time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                      <strong>{names[a.agent] || "Host"}</strong>
                      <span>{a.text}</span>
                    </li>
                  ))}
              </ol>
            )}
          </section>
          {session?.allow_work ? (
            <form
              className="phone-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                ref={composer}
                aria-label="Message to your team"
                placeholder={t(
                  "Continue the conversation…",
                  "대화를 이어가세요…",
                )}
                value={text}
                rows={2}
                onChange={(e) => save(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <span>
                  <ShieldCheck size={12} />
                  {t("Host permissions", "PC의 실행 권한 적용")}
                </span>
                {running ? (
                  <button
                    type="button"
                    className="phone-send"
                    aria-label="Cancel my request"
                    disabled={!snapshot?.can_cancel}
                    onClick={() =>
                      void call(`/jobs/${snapshot!.job!.id}/cancel`, {})
                        .then(refresh)
                        .catch(handleError)
                    }
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    className="phone-send"
                    aria-label="Send message"
                    disabled={!text.trim() || sending || !online}
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className="observer-notice">
              <ShieldCheck size={14} />
              {t("View-only connection", "보기 전용 연결입니다")}
            </p>
          )}
          <footer className="phone-footer">
            <button onClick={() => setUsage(true)}>
              <span aria-hidden="true">◷</span>
              {t("Usage", "사용량")}
            </button>
            <small>{session?.name}</small>
            <button
              aria-label="Disconnect this device"
              onClick={() =>
                void call("/logout", {})
                  .then(() => {
                    setSession(null);
                    setSnapshot(null);
                    setPhase("pair");
                    setCode("");
                  })
                  .catch(handleError)
              }
            >
              <Unplug size={14} />
              {t("Disconnect", "연결 해제")}
            </button>
          </footer>
        </>
      )}
      {usage && (
        <div className="phone-backdrop" onClick={() => setUsage(false)}>
          <section
            className="phone-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Account usage"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{t("Account usage", "계정 사용량")}</h2>
              <button
                className="phone-icon-button"
                aria-label="Close usage"
                onClick={() => setUsage(false)}
              >
                <X size={18} />
              </button>
            </header>
            {participants.map((a) => {
              const data = snapshot?.limits[a] as
                  | {
                      status?: string;
                      message?: string;
                      source?: string;
                      updated_at?: string;
                    }
                  | undefined,
                wins = quotaWindows(a, data),
                tokens = snapshot?.usage?.[a];
              return (
                <div className="phone-quota" key={a}>
                  <strong>
                    {marks[a]} {names[a]}
                  </strong>
                  <span>
                    {data?.status === "stale"
                      ? t("Last known reading", "마지막 확인값")
                      : data?.source || ""}
                  </span>
                  {wins.length === 0 ? (
                    <p className="quota-note">
                      {data?.message ||
                        t(
                          "No account quota reported. This is not zero usage.",
                          "확인된 계정 사용량이 없습니다. 사용량 0을 의미하지 않습니다.",
                        )}
                    </p>
                  ) : (
                    wins.map((win) => (
                      <div className="phone-quota-window" key={win.label}>
                        <div>
                          <span>{quotaLabel(win.label)}</span>
                          <strong>{percent(win.used)}</strong>
                          <small>{win.reset ? countdown(win.reset) : ""}</small>
                        </div>
                        <meter min={0} max={100} value={win.used} />
                      </div>
                    ))
                  )}
                  <small className="quota-note">
                    {t(
                      "Project tokens · input / output",
                      "프로젝트 토큰 · 입력 / 출력",
                    )}{" "}
                    {tokens?.input_tokens?.toLocaleString() ?? "—"} /{" "}
                    {tokens?.output_tokens?.toLocaleString() ?? "—"}
                  </small>
                </div>
              );
            })}
            <button
              className="phone-secondary"
              onClick={() =>
                void call("/usage/refresh", {}).then(refresh).catch(handleError)
              }
            >
              <RefreshCw size={14} />
              {t("Refresh usage", "사용량 새로 고침")}
            </button>
            <a
              className="phone-license"
              href="/companion/third-party-notices.txt"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("QR generator license", "QR 생성기 라이선스")}
            </a>
          </section>
        </div>
      )}
      {preview && (
        <div className="phone-backdrop" onClick={() => setPreview(null)}>
          <section
            className="phone-sheet file-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="File preview"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>
                {preview.name}
                {preview.line ? `:${preview.line}` : ""}
              </h2>
              <button
                className="phone-icon-button"
                aria-label="Close file"
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </header>
            <small>{preview.path}</small>
            {preview.truncated && (
              <p className="quota-note">
                {t(
                  "Bounded preview · selected line window",
                  "선택한 줄 주변의 제한된 미리보기",
                )}
              </p>
            )}
            <pre>
              {preview.text.split("\n").map((line, index) => (
                <span
                  className={
                    preview.start_line + index === preview.line
                      ? "file-target"
                      : ""
                  }
                  key={index}
                  ref={(el) => {
                    if (el && preview.start_line + index === preview.line)
                      el.scrollIntoView({ block: "center" });
                  }}
                >
                  <i>{preview.start_line + index}</i>
                  {line || " "}
                  {"\n"}
                </span>
              ))}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
function LinkIcon() {
  return <Smartphone size={17} />;
}
createRoot(document.getElementById("root")!).render(<CompanionApp />);
