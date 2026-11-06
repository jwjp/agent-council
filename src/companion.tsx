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
  Share,
  PlusSquare,
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
import { CompanionDraft, draftFits, tabStorage } from "./companion-draft";

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
import {
  ApiError,
  call,
  pair,
  events,
  openWeb,
  forget,
  nativeCompanion,
} from "./companion-transport";
// Read the short-lived challenge once, then remove it before any other navigation.
const initialCode =
  new URLSearchParams(location.hash.slice(1)).get("pair") || "";
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);

function CompanionApp() {
  const [ko, setKo] = useState(() => {
      try {
        return localStorage.getItem("council-phone-language") === "ko";
      } catch {
        return false;
      }
    }),
    [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<PhoneState | null>(null),
    [phase, setPhase] = useState<"loading" | "pair" | "pending" | "ready">(
      "loading",
    );
  const [code, setCode] = useState(initialCode),
    [name, setName] = useState("My phone"),
    [error, setError] = useState("");
  const [pairing, setPairing] = useState(false);
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
  const draft = useRef<CompanionDraft | null>(null),
    refreshIssued = useRef(0),
    refreshApplied = useRef(0),
    cursor = useRef(0),
    currentJob = useRef<string | undefined>(undefined),
    composer = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftWrite = useRef<Promise<void>>(Promise.resolve());
  const [installHelp, setInstallHelp] = useState(false);
  const [foreground, setForeground] = useState(
    document.visibilityState !== "hidden",
  );
  const [network, setNetwork] = useState(navigator.onLine);
  const [draftStatus, setDraftStatus] = useState("saved");
  const queuedDraft = useRef<{
    model: CompanionDraft;
    revision: number;
    promise: Promise<void>;
  } | null>(null);
  const refreshAbort = useRef<AbortController | null>(null);
  const standalone = () =>
    matchMedia("(display-mode: standalone)").matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const [installed, setInstalled] = useState(standalone);
  const t = useCallback((en: string, kor: string) => (ko ? kor : en), [ko]);
  const showDraft = useCallback((saving = false) => {
    const model = draft.current;
    if (!model) return;
    setText(model.text);
    setDraftStatus(
      !draftFits(model.text)
        ? "long"
        : saving
          ? "saving"
          : model.dirty
            ? model.recovered
              ? "restored"
              : model.backedUp
                ? "local"
                : "memory"
            : "saved",
    );
  }, []);
  const acceptSession = useCallback(
    (s: Session) => {
      if (s.protocol !== "companion-v1")
        throw Error("Update this companion to connect.");
      if (draft.current?.id !== s.id) {
        draft.current?.discard();
        draft.current = new CompanionDraft(
          s.id,
          nativeCompanion ? null : tabStorage(),
        );
        cursor.current = 0;
        currentJob.current = undefined;
        refreshApplied.current = 0;
        showDraft();
      }
      setSession(s);
      setPhase("ready");
      setError("");
    },
    [showDraft],
  );
  const clearSession = useCallback(() => {
    draft.current?.discard();
    draft.current = null;
    clearTimeout(draftTimer.current || undefined);
    setText("");
    setSession(null);
    setSnapshot(null);
    setOnline(false);
    setPreview(null);
    setUsage(false);
    setPhase("pair");
  }, []);
  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) clearSession();
      setError(String(e instanceof Error ? e.message : e));
    },
    [clearSession],
  );
  const persist = useCallback(
    (value: string, revision = draft.current?.revision): Promise<void> => {
      const model = draft.current;
      if (!model || revision === undefined || !draftFits(value))
        return Promise.resolve();
      const queued = queuedDraft.current;
      if (queued?.model === model && queued.revision === revision)
        return queued.promise;
      showDraft(true);
      const write = draftWrite.current
        .catch(() => {})
        .then(async () => {
          if (draft.current !== model) return;
          await call<void>("/draft", { text: value }, "PUT");
          if (draft.current === model) {
            model.saved(revision);
            showDraft();
          }
        });
      draftWrite.current = write;
      queuedDraft.current = { model, revision, promise: write };
      void write
        .finally(() => {
          if (queuedDraft.current?.promise === write)
            queuedDraft.current = null;
        })
        .catch(() => {});
      return write;
    },
    [showDraft],
  );
  const refresh = useCallback(async () => {
    const model = draft.current;
    if (!model) return null;
    const revision = model.revision,
      sequence = ++refreshIssued.current;
    let state: PhoneState;
    try {
      state = await call<PhoneState>(
        "/state",
        undefined,
        "GET",
        false,
        refreshAbort.current?.signal,
      );
    } catch (e) {
      if (draft.current !== model) return null;
      throw e;
    }
    if (draft.current !== model) return null;
    if (sequence < refreshApplied.current) return state;
    if (state.device.id !== model.id)
      throw new ApiError(
        401,
        "The paired device changed. Reconnect to continue.",
      );
    refreshApplied.current = sequence;
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
    model.snapshot(state.draft, state.job?.request_id, revision);
    showDraft();
    setOnline(true);
    setError("");
    if (model.dirty && draftFits(model.text))
      void persist(model.text).catch((e) => {
        if (draft.current === model) {
          showDraft();
          handleError(e);
        }
      });
    return state;
  }, [handleError, persist, showDraft]);
  useEffect(() => {
    let alive = true;
    if (initialCode) {
      setPhase("pair");
      return;
    }
    void call<Session>("/session")
      .then((s) => {
        if (alive) {
          acceptSession(s);
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
                acceptSession(pending);
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
  }, [handleError, acceptSession]);
  useEffect(() => {
    if (phase !== "pending") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await call<Session & { status?: string }>(
          "/pair/complete",
          {},
        );
        if (!alive) return;
        if (s.status !== "pending") {
          acceptSession(s);
          setCode("");
          return;
        }
        setError("");
      } catch (e) {
        if (!alive) return;
        handleError(e);
        if (e instanceof ApiError && [401, 403].includes(e.status)) {
          setPhase("pair");
          return;
        }
      }
      if (alive) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase, handleError, acceptSession]);
  useEffect(() => {
    if (phase !== "ready" || !foreground || !network) return;
    const model = draft.current;
    const controller = new AbortController();
    refreshAbort.current = controller;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          if (!(await refresh()) || controller.signal.aborted) return;
          await events(cursor.current, controller.signal, (event) => {
            if (event.id > cursor.current) {
              cursor.current = event.id;
              if (["note", "phase", "tool", "workflow"].includes(event.kind)) {
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
          });
        } catch (e) {
          if (controller.signal.aborted || draft.current !== model) return;
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
      if (refreshAbort.current === controller) refreshAbort.current = null;
      clearTimeout(refreshTimer);
    };
  }, [phase, tick, refresh, handleError, foreground, network]);
  useEffect(() => {
    const resume = () => {
      const visible = document.visibilityState !== "hidden";
      setForeground(visible);
      setNetwork(navigator.onLine);
      if (visible) {
        setOnline(false);
        setTick((n) => n + 1);
      } else if (draft.current?.dirty)
        void persist(draft.current.text).catch(() => {});
    };
    const offline = () => {
      setNetwork(false);
      setOnline(false);
    };
    const hide = () => {
      setForeground(false);
      setOnline(false);
      if (draft.current?.dirty)
        void persist(draft.current.text).catch(() => {});
    };
    const mode = matchMedia("(display-mode: standalone)");
    const installChanged = () => setInstalled(standalone());
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", hide);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    mode.addEventListener("change", installChanged);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      mode.removeEventListener("change", installChanged);
    };
  }, [persist]);
  useEffect(() => {
    document.documentElement.lang = ko ? "ko" : "en";
  }, [ko]);
  useEffect(() => {
    if (follow.current)
      bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [snapshot?.messages.length, view]);
  const save = (value: string) => {
    const model = draft.current;
    if (!model) return;
    model.edit(value);
    showDraft();
    const revision = model.revision;
    clearTimeout(draftTimer.current || undefined);
    draftTimer.current = setTimeout(
      () =>
        void persist(value, revision).catch((e) => {
          if (draft.current === model) {
            showDraft();
            handleError(e);
          }
        }),
      400,
    );
  };
  const send = async () => {
    const model = draft.current;
    if (
      !model ||
      !model.text.trim() ||
      !draftFits(model.text) ||
      sending ||
      !online ||
      snapshot?.job?.status === "running"
    )
      return;
    setSending(true);
    setError("");
    clearTimeout(draftTimer.current || undefined);
    const request = model.prepare(crypto.randomUUID());
    try {
      await draftWrite.current.catch(() => {});
      if (draft.current !== model) return;
      await call("/jobs", request);
      if (draft.current !== model) return;
      model.accepted(request.request_id);
      showDraft();
      if (model.dirty) await persist(model.text);
      setView("council");
      follow.current = true;
      await refresh();
    } catch (e) {
      if (draft.current === model) {
        showDraft();
        handleError(e);
      }
    } finally {
      setSending(false);
    }
  };
  const openFile = useCallback(
    async (target: string) => {
      const model = draft.current;
      try {
        const value = await call<typeof preview>("/files/read", { target });
        if (draft.current === model) setPreview(value);
      } catch (e) {
        if (draft.current === model) handleError(e);
      }
    },
    [handleError],
  );
  const openLink = useCallback(
    (href: string) => void openWeb(href).catch(handleError),
    [handleError],
  );
  useEffect(() => {
    if (!preview && !usage && !installHelp) return;
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
        else if (usage) setUsage(false);
        else setInstallHelp(false);
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
  }, [!!preview, usage, installHelp]);
  const markdown = (content: string) => (
    <MarkdownContent text={content} onFile={openFile} onWeb={openLink} />
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
        <div className="phone-header-actions">
          {!nativeCompanion && !installed && (
            <button
              className="phone-icon-button"
              aria-label="Add to Home Screen"
              title={t("Add to Home Screen", "홈 화면에 추가")}
              onClick={() => setInstallHelp(true)}
            >
              <PlusSquare size={18} />
            </button>
          )}
          <button
            className="phone-icon-button"
            aria-label="Change language"
            onClick={() => {
              setKo(!ko);
              try {
                localStorage.setItem(
                  "council-phone-language",
                  !ko ? "ko" : "en",
                );
              } catch {}
            }}
          >
            <Globe size={18} />
            <small>{ko ? "KO" : "EN"}</small>
          </button>
        </div>
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
              : nativeCompanion
                ? t(
                    "Paste the pairing link from Connect a phone on your PC, then approve this device there. Keep Tailscale connected on both devices.",
                    "PC의 휴대폰 연결 메뉴에서 링크를 복사해 붙여 넣고, PC에서 이 기기를 승인하세요. 두 기기의 Tailscale 연결을 유지하세요.",
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
                  if (pairing) return;
                  setPairing(true);
                  setError("");
                  void pair(code, name)
                    .then(() => {
                      setCode("");
                      setPhase("pending");
                    })
                    .catch(handleError)
                    .finally(() => setPairing(false));
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
                {!(initialCode && code === initialCode) && (
                  <label>
                    {t("Pairing link from your PC", "PC의 연결 링크")}
                    <input
                      aria-label="Pairing link"
                      type="url"
                      maxLength={4096}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://your-pc.tailnet.ts.net/companion/#pair=…"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                )}
                {!code ? (
                  <p>
                    {t(
                      "Open a fresh pairing QR on the host to begin.",
                      "PC에서 새 연결 QR을 열어 주세요.",
                    )}
                  </p>
                ) : (
                  <button
                    className="phone-primary"
                    type="submit"
                    disabled={pairing}
                  >
                    <LinkIcon />
                    {pairing
                      ? t("Requesting…", "연결 요청 중…")
                      : t("Request connection", "연결 요청")}
                  </button>
                )}
              </form>
            )
          )}
          {phase === "pair" && (
            <div className="pair-recovery">
              <button
                className="phone-secondary"
                onClick={() =>
                  void call<Session>("/session")
                    .then((s) => {
                      acceptSession(s);
                    })
                    .catch(handleError)
                }
              >
                <RefreshCw size={14} />
                {t("Retry saved connection", "저장된 연결 재시도")}
              </button>
              {nativeCompanion && (
                <button
                  className="phone-secondary"
                  onClick={() =>
                    void forget()
                      .then(() => {
                        setCode("");
                        setError("");
                      })
                      .catch(handleError)
                  }
                >
                  {t("Forget saved connection", "저장된 연결 지우기")}
                </button>
              )}
            </div>
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
          {!online && (
            <div className="phone-reconnect" role="status">
              <WifiOff size={15} />
              <span>
                {t(
                  "Waiting for your PC. Your input stays here.",
                  "PC 연결을 기다리는 중입니다. 입력한 내용은 유지됩니다.",
                )}
              </span>
              <button
                onClick={() => {
                  setNetwork(navigator.onLine);
                  setTick((n) => n + 1);
                }}
              >
                {t("Reconnect", "재연결")}
              </button>
            </div>
          )}
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
                    disabled={
                      !text.trim() || sending || !online || !draftFits(text)
                    }
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
              <small
                className="phone-draft-status"
                role="status"
                aria-label="Draft status"
              >
                {draftStatus === "long"
                  ? t(
                      "This message is too long to save or send. Shorten it to continue.",
                      "입력 내용이 너무 깁니다. 저장·전송하려면 줄여 주세요.",
                    )
                  : draftStatus === "saving"
                    ? t("Saving to your PC…", "PC에 저장하는 중…")
                    : draftStatus === "restored"
                      ? t(
                          "Recovered from this tab · syncing when connected",
                          "현재 탭에서 입력 복구 · 연결되면 동기화",
                        )
                      : draftStatus === "local"
                        ? t(
                            "Kept in this tab · waiting to sync",
                            "현재 탭에 임시 보관 · 동기화 대기",
                          )
                        : draftStatus === "memory"
                          ? t(
                              "Not synced yet · keep this screen open",
                              "아직 동기화되지 않았습니다 · 이 화면을 유지하세요",
                            )
                          : t(
                              "Draft saved on your PC",
                              "입력 내용이 PC에 저장되었습니다",
                            )}
              </small>
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
                    clearSession();
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
      {installHelp && (
        <div className="phone-backdrop" onClick={() => setInstallHelp(false)}>
          <section
            className="phone-sheet install-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Install companion"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>
                {t(
                  "Your workspace, one tap away",
                  "한 번의 터치로 작업 공간 열기",
                )}
              </h2>
              <button
                className="phone-icon-button"
                aria-label="Close install guide"
                onClick={() => setInstallHelp(false)}
              >
                <X size={18} />
              </button>
            </header>
            <ol className="install-steps">
              <li>
                <Share size={20} />
                <div>
                  <strong>
                    {t("Open Safari’s Share menu", "Safari의 공유 메뉴 열기")}
                  </strong>
                  <p>
                    {t(
                      "Use Share or More, then choose Add to Home Screen.",
                      "공유 또는 더 보기에서 ‘홈 화면에 추가’를 선택하세요.",
                    )}
                  </p>
                </div>
              </li>
              <li>
                <PlusSquare size={20} />
                <div>
                  <strong>
                    {t(
                      "Add Council to your Home Screen",
                      "홈 화면에 Council 추가",
                    )}
                  </strong>
                  <p>
                    {t(
                      "Keep Open as Web App enabled if shown, then tap Add.",
                      "‘웹 앱으로 열기’가 표시되면 켜 둔 채 ‘추가’를 누르세요.",
                    )}
                  </p>
                </div>
              </li>
              <li>
                <ShieldCheck size={20} />
                <div>
                  <strong>
                    {t("Open the new icon", "추가된 아이콘으로 열기")}
                  </strong>
                  <p>
                    {t(
                      "If pairing is requested, paste a fresh link from this PC and approve it there. Tailscale must stay connected.",
                      "연결을 요청하면 이 PC의 새 연결 링크를 붙여 넣고 PC에서 승인하세요. Tailscale 연결을 유지해야 합니다.",
                    )}
                  </p>
                </div>
              </li>
            </ol>
            <p className="quota-note">
              {t(
                "Your PC runs the work and needs to stay awake. This app reconnects when reopened; it does not send background notifications.",
                "작업은 PC에서 실행되므로 PC가 켜져 있어야 합니다. 앱을 다시 열면 재접속하며, 백그라운드 알림은 제공하지 않습니다.",
              )}
            </p>
          </section>
        </div>
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
            {!nativeCompanion && (
              <a
                className="phone-license"
                href="/companion/third-party-notices.txt"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("QR generator license", "QR 생성기 라이선스")}
              </a>
            )}
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
