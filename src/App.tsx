import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  Folder,
  FolderPlus,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings2,
  Shield,
  Square,
  SquareTerminal,
  Sun,
  X,
  Activity as ActivityIcon,
  Wifi,
  WifiOff,
  Download,
  CheckCheck,
  AlertCircle,
} from "lucide-react";
import { MarkdownContent } from "./markdown";
import { CompanionSettings } from "./companion-settings";
import { WorkflowProgress } from "./workflow-view";
import { compactActivity, snapshotActivity } from "./companion-state";
import { workflowProgress } from "./workflow";
import {
  api,
  connect,
  desktop,
  external,
  persistDraft,
  pickFolder,
  subscribe,
} from "./api";
import {
  agents,
  colors,
  marks,
  names,
  type Activity,
  type Message,
  type Settings,
  type Snapshot,
} from "./types";
import {
  windows,
  countdown,
  summaryWindow,
  percent,
  quotaLabel,
} from "./quotas";
import { FilePreviewProvider, useFileLink } from "./file-preview";
import { Usage, cursorCli } from "./usage-panel";

type Translate = (en: string, ko: string) => string;
function AgentMark({
  agent,
  small = false,
}: {
  agent: string;
  small?: boolean;
}) {
  return (
    <span
      className={"agent-mark " + (small ? "small" : "")}
      style={{ "--agent": colors[agent] || "#80899a" } as CSSProperties}
    >
      {marks[agent] || "·"}
    </span>
  );
}
const Markdown = memo(function Markdown({ text }: { text: string }) {
  const openFile = useFileLink();
  return (
    <MarkdownContent
      text={text}
      onFile={openFile}
      onWeb={(href) => void external(href).catch(console.error)}
    />
  );
});
function AgentProblem({
  message,
  agent,
  t,
}: {
  message: string;
  agent: string;
  t: Translate;
}) {
  const auth =
    /authentication required|not authenticated|sign.?in|login.*first|unauthorized/i.test(
      message,
    );
  return (
    <div className="agent-problem">
      <div>
        <AlertCircle size={17} />
        <strong>
          {auth
            ? t("CLI sign-in needed", "CLI 로그인이 필요합니다")
            : t("This agent needs attention", "에이전트 상태를 확인해 주세요")}
        </strong>
      </div>
      {auth && agent === "agent" && (
        <p>
          {t(
            `Cursor IDE usage and CLI sign-in are separate. Run ${cursorCli} login, then ${cursorCli} status, and retry. The generic agent command may belong to Grok.`,
            `Cursor IDE 사용량과 CLI 로그인은 별개입니다. ${cursorCli} login으로 로그인하고 ${cursorCli} status로 확인한 뒤 다시 요청하세요. agent 명령은 Grok일 수 있습니다.`,
          )}
        </p>
      )}
      <p className="agent-problem-detail">{message}</p>
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab" && ref.current) {
        const nodes = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,[tabindex="0"]',
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
const phaseLabel = (phase: string, t: Translate) =>
  ({
    Working: t("Working through it", "작업에 집중하는 중"),
    Reviewing: t("Taking a closer look", "꼼꼼히 검수하는 중"),
    Refining: t("Applying verified feedback", "확인된 의견을 반영하는 중"),
    Verifying: t("Checking the improvements", "수정 결과를 다시 확인하는 중"),
    Discussing: t("Comparing perspectives", "의견을 맞춰보는 중"),
    Reporting: t("Connecting the dots", "보고서를 다듬는 중"),
    Done: t("Done", "완료"),
    Failed: t("Needs attention", "확인 필요"),
  })[phase] || t("Ready", "준비");
function latestPhase(events: Activity[], agent: string) {
  return events.filter((e) => e.agent === agent && e.kind === "phase").at(-1);
}

export default function App() {
  const [state, setState] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<
      "settings" | "team" | "update" | "companion" | null
    >(null),
    [usage, setUsage] = useState(false),
    [menu, setMenu] = useState(false),
    [chooser, setChooser] = useState<"lead" | "permission" | null>(null),
    [usageAgent, setUsageAgent] = useState(""),
    [side, setSide] = useState(true),
    [split, setSplit] = useState(
      () => localStorage.getItem("split") !== "false",
    );
  const [left, setLeft] = useState(""),
    [right, setRight] = useState("council"),
    [activity, setActivity] = useState<Activity[]>([]),
    [now, setNow] = useState(Date.now()),
    [sending, setSending] = useState(false),
    [ratio, setRatio] = useState(50);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    currentFolder = useRef(""),
    currentJob = useRef(""),
    draftValue = useRef(""),
    pendingRequest = useRef<{ text: string; id: string } | null>(null),
    composition = useRef(false),
    input = useRef<HTMLTextAreaElement>(null);
  const t: Translate = useCallback(
    (en, ko) => (state?.settings.language === "한국어" ? ko : en),
    [state?.settings.language],
  );
  const refresh = useCallback(async () => {
    const next = await api<Snapshot>("/state");
    setState(next);
    currentFolder.current = next.settings.folder;
    currentJob.current = next.job?.id || "";
    setActivity((old) =>
      snapshotActivity(
        next.activity || [],
        old.filter((e) => e.job === next.job?.id),
        next.cursor,
      ),
    );
    return next;
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    void (async () => {
      try {
        await connect();
        const initial = await refresh();
        if (!alive) return;
        setDraft(initial.draft);
        draftValue.current = initial.draft;
        await subscribe(
          initial.cursor,
          abort.signal,
          (event) => {
            if (
              event.job &&
              event.folder.toLowerCase() !== currentFolder.current.toLowerCase()
            )
              return;
            if (event.job)
              setActivity((old) => {
                const base = old.filter((e) => e.job === event.job);
                return base.some((e) => e.id === event.id)
                  ? base
                  : compactActivity([...base, event]);
              });
            if (
              ["message", "done", "usage", "limits"].includes(event.kind) ||
              (event.job && event.job !== currentJob.current)
            ) {
              if (!refreshTimer.current)
                refreshTimer.current = setTimeout(() => {
                  refreshTimer.current = null;
                  void refresh().catch((e) => setError(String(e)));
                }, 150);
            }
            if (event.kind === "message" && event.agent === "council")
              setRight("council");
          },
          setConnected,
        );
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
      abort.abort();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(
      () => setNow(Date.now()),
      state?.job?.status === "running" ? 1000 : 60000,
    );
    return () => clearInterval(id);
  }, [state?.job?.status]);
  useEffect(() => {
    if (!state) return;
    const selected = state.settings.appearance;
    const match = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        selected === "system" ? (match.matches ? "dark" : "light") : selected);
    apply();
    match.addEventListener("change", apply);
    return () => match.removeEventListener("change", apply);
  }, [state?.settings.appearance]);
  useEffect(() => {
    document.documentElement.lang =
      state?.settings.language === "한국어" ? "ko" : "en";
  }, [state?.settings.language]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setModal("settings");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    localStorage.setItem("split", String(split));
  }, [split]);
  const changeDraft = (text: string) => {
    setDraft(text);
    draftValue.current = text;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const folder = currentFolder.current;
    draftTimer.current = setTimeout(
      () =>
        void api("/draft", { folder, text }, "PUT").catch((e) =>
          setError(String(e)),
        ),
      400,
    );
  };
  useEffect(() => {
    const flush = () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = null;
      void persistDraft(currentFolder.current, draftValue.current).catch((e) =>
        setError(String(e)),
      );
    };
    const hidden = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const busy = state?.job?.status === "running";
  const send = async () => {
    if (composition.current || sending || busy || !draft.trim() || !state)
      return;
    if (draft.trim() === "/usage") {
      setUsage(true);
      changeDraft("");
      return;
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setSending(true);
    setError("");
    try {
      const text = draft.trim();
      if (pendingRequest.current?.text !== text)
        pendingRequest.current = { text, id: crypto.randomUUID() };
      await api("/jobs", {
        request: text,
        request_id: pendingRequest.current.id,
      });
      pendingRequest.current = null;
      changeDraft("");
      await refresh();
      input.current?.focus();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };
  const saveSettings = async (settings: Settings) => {
    const previousFolder = currentFolder.current;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (currentFolder.current)
      await api(
        "/draft",
        { folder: currentFolder.current, text: draftValue.current },
        "PUT",
      );
    const next = await api<Snapshot>("/settings", settings, "PUT");
    setState(next);
    setActivity(next.activity || []);
    currentFolder.current = next.settings.folder;
    currentJob.current = next.job?.id || "";
    if (previousFolder.toLowerCase() !== next.settings.folder.toLowerCase()) {
      // Preserve text entered while a project change was in flight.
      await persistDraft(previousFolder, draftValue.current);
      setDraft(next.draft);
      draftValue.current = next.draft;
    }
    setModal(null);
  };
  const participants = state
    ? [
        ...new Set([
          ...(state.settings.coder ? [state.settings.coder] : []),
          ...state.settings.reviewers,
        ]),
      ]
    : [];
  const options = [
    ...new Set([
      ...participants,
      ...(state?.messages || [])
        .map((m) => m.role)
        .filter((r) => agents.includes(r as (typeof agents)[number])),
      ...(state?.settings.reviewers.length ? ["council"] : []),
    ]),
  ];
  const selectedLeft = options.includes(left)
    ? left
    : state?.settings.coder ||
      options.find((a) => a !== "council") ||
      "council";
  const selectedRight = options.includes(right)
    ? right
    : options.find((a) => a !== selectedLeft) || selectedLeft;
  const activeActivity = activity.filter((e) => e.job === state?.job?.id);
  const needsInput =
    state?.job &&
    workflowProgress(state.job, activeActivity, state.settings).stage ===
      "question";
  const closeModal = useCallback(() => setModal(null), []);
  async function folderShortcut() {
    try {
      const folder = await pickFolder();
      if (folder && state) await saveSettings({ ...state.settings, folder });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <FilePreviewProvider ko={state?.settings.language === "한국어"}>
      <div className="app-shell">
        <div
          className="titlebar"
          data-tauri-drag-region
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget)
              void getCurrentWindow().toggleMaximize();
          }}
        >
          <div className="brand">
            <span className="brand-icon">≋</span>
            <span>Agent Council</span>
            <span className="version">{state?.version || "—"}</span>
          </div>
          <div className="app-menu">
            <button
              className={"icon-button " + (menu ? "selected" : "")}
              title={t("App menu", "앱 메뉴")}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={19} />
            </button>
            {menu && (
              <>
                <div className="dismiss" onClick={() => setMenu(false)} />
                <div className="menu dropdown">
                  <button
                    onClick={() => {
                      setMenu(false);
                      setModal("settings");
                    }}
                  >
                    <Settings2 size={15} />
                    {t("Settings", "설정")}
                    <kbd>Ctrl ,</kbd>
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setUsage(true);
                    }}
                  >
                    <ActivityIcon size={15} />
                    {t("Usage", "사용량")}
                  </button>
                  <div className="divider" />
                  <button
                    onClick={() => {
                      setMenu(false);
                      setModal("companion");
                    }}
                  >
                    <Wifi size={15} />
                    {t("Connect a phone", "휴대폰 연결")}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      setModal("update");
                    }}
                  >
                    <Download size={15} />
                    {t("Check for updates", "업데이트 확인")}
                  </button>
                  <button
                    onClick={() =>
                      void external("https://github.com/jwjp/agent-council")
                    }
                  >
                    <ArrowUpRight size={15} />
                    GitHub
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="drag-space" data-tauri-drag-region />
          {desktop && (
            <div className="window-controls">
              <button
                aria-label="Minimize"
                onClick={() => void getCurrentWindow().minimize()}
              >
                <Minus size={15} />
              </button>
              <button
                aria-label="Maximize"
                onClick={() => void getCurrentWindow().toggleMaximize()}
              >
                <Square size={12} />
              </button>
              <button
                className="window-close"
                aria-label="Close window"
                title={t(
                  "Close window · tasks keep running",
                  "창 닫기 · 작업은 계속 실행됩니다",
                )}
                onClick={() => {
                  if (draftTimer.current) {
                    clearTimeout(draftTimer.current);
                    void api(
                      "/draft",
                      {
                        folder: currentFolder.current,
                        text: draftValue.current,
                      },
                      "PUT",
                    ).finally(() => void getCurrentWindow().close());
                  } else void getCurrentWindow().close();
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
        </div>
        <div className="app-body">
          <aside className={side ? "sidebar" : "sidebar collapsed"}>
            <div className="sidebar-head">
              <button
                className="icon-button"
                title={t("Toggle sidebar", "사이드바 접기")}
                onClick={() => setSide(!side)}
              >
                <PanelLeft size={17} />
              </button>
              {side && <span>{t("WORKSPACE", "워크스페이스")}</span>}
            </div>
            <button
              className="nav-item active"
              onClick={() => input.current?.focus()}
            >
              <MessageSquare size={17} />
              {side && t("Council", "대화")}
            </button>
            <button className="nav-item" onClick={() => setModal("team")}>
              <SquareTerminal size={17} />
              {side && t("Agents", "에이전트")}
            </button>
            {side && (
              <>
                <div className="sidebar-section">
                  {t("PROJECT", "프로젝트")}
                  <button
                    className="icon-button"
                    title={t("Choose project", "프로젝트 선택")}
                    onClick={() => void folderShortcut()}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <button
                  className="project-item"
                  onClick={() => void folderShortcut()}
                >
                  <Folder size={16} />
                  <span>
                    {state?.settings.folder.split(/[\\/]/).at(-1) ||
                      t("Choose a folder", "폴더를 선택하세요")}
                  </span>
                </button>
                <div className="project-sub">
                  {t(
                    "One conversation, shared context.",
                    "대화의 맥락을 이어갑니다.",
                  )}
                </div>
                <div className="sidebar-section">
                  {t("YOUR TEAM", "참여 에이전트")}
                </div>
                <div className="team-list">
                  {participants.map((a) => (
                    <div key={a}>
                      <AgentMark agent={a} small />
                      <span>{names[a]}</span>
                      <span className="team-role">
                        {a === state?.settings.coder
                          ? t("Lead", "담당")
                          : t("Review", "검토")}
                      </span>
                    </div>
                  ))}
                  {!participants.length && (
                    <button
                      className="text-button"
                      onClick={() => setModal("team")}
                    >
                      {t("Select your agents", "에이전트 선택")}
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </>
            )}
            <div className="sidebar-bottom">
              <button className="nav-item" onClick={() => setModal("settings")}>
                <Settings2 size={17} />
                {side && t("Settings", "설정")}
              </button>
              {side && (
                <div className="runtime-state">
                  <span
                    className={"status-dot " + (connected ? "online" : "")}
                  />
                  {t(
                    connected ? "Engine connected" : "Connecting to engine",
                    connected ? "엔진 연결됨" : "엔진 연결 중",
                  )}
                </div>
              )}
            </div>
          </aside>
          <main className="workspace">
            <header className="workspace-header">
              <button
                className="breadcrumb"
                title={state?.settings.folder}
                onClick={() => void folderShortcut()}
              >
                <Folder size={15} />
                <span>
                  {state?.settings.folder.split(/[\\/]/).at(-1) || "Workspace"}
                </span>
                <ChevronDown size={13} />
              </button>
              {!!state?.settings.references.length && (
                <span className="reference-count">
                  +{state.settings.references.length}{" "}
                  {t("references", "참고 폴더")}
                </span>
              )}
              <div className="grow" />
              {!!state?.messages.length && (
                <button
                  className={"view-button " + (split ? "selected" : "")}
                  onClick={() => setSplit(!split)}
                >
                  {split ? <MessageSquare size={15} /> : <Columns2 size={15} />}
                  <span>
                    {split
                      ? t("Conversation", "대화 보기")
                      : t("Split view", "분할 보기")}
                  </span>
                </button>
              )}
            </header>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button className="icon-button" onClick={() => setError("")}>
                  <X size={14} />
                </button>
                {!state && (
                  <button onClick={() => location.reload()}>
                    {t("Retry", "다시 연결")}
                  </button>
                )}
              </div>
            )}
            {!state ? (
              <div className="empty">
                <span className="brand-icon large">≋</span>
                <h1>
                  {t(
                    "Getting your workspace ready",
                    "작업 공간을 준비하고 있어요",
                  )}
                </h1>
                <p>
                  {t(
                    "Connecting to the Rust execution engine…",
                    "Rust 실행 엔진에 연결하는 중…",
                  )}
                </p>
              </div>
            ) : (
              <>
                {!state.messages.length ? (
                  <div className="empty">
                    <div className="hero-symbol">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="eyebrow">AGENT COUNCIL</div>
                    <h1>
                      {t(
                        "Good ideas. Better together.",
                        "함께 생각하고, 더 나은 코드로.",
                      )}
                    </h1>
                    <p>
                      {t(
                        "One agent builds. Fresh perspectives make it better.",
                        "코딩부터 검수까지, 하나의 대화에서 이어가세요.",
                      )}
                    </p>
                    <div className="suggestions">
                      {[
                        [
                          t("Explore this project", "프로젝트 분석"),
                          t(
                            "Analyze this project and explain its structure, current behavior, and useful improvements.",
                            "이 프로젝트의 구조와 현재 동작을 분석하고 개선할 부분을 알려줘.",
                          ),
                        ],
                        [
                          t("Review recent changes", "변경 사항 검수"),
                          t(
                            "Review recent changes for mistakes and missing tests. Do not modify files.",
                            "최근 변경 사항에 실수나 빠진 테스트가 있는지 검수해줘. 파일은 수정하지 마.",
                          ),
                        ],
                      ].map(([label, prompt]) => (
                        <button
                          key={label}
                          onClick={() => {
                            changeDraft(prompt);
                            input.current?.focus();
                          }}
                        >
                          {label}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {state.job && (
                      <div className="current-request">
                        <span className="request-label">
                          {t("YOU", "요청")}
                        </span>
                        <div title={state.job.request}>{state.job.request}</div>
                        <span className={"job-badge " + state.job.status}>
                          {busy ? (
                            <span className="pulse-dot" />
                          ) : needsInput ? (
                            <MessageSquare size={12} />
                          ) : (
                            <CheckCheck size={12} />
                          )}{" "}
                          {needsInput
                            ? t("Your input", "답변 필요")
                            : t(
                                (
                                  {
                                    running: "In progress",
                                    done: "Complete",
                                    failed: "Needs attention",
                                    cancelled: "Cancelled",
                                    interrupted: "Interrupted",
                                  } as Record<string, string>
                                )[state.job.status] || state.job.status,
                                (
                                  {
                                    running: "진행 중",
                                    done: "완료",
                                    failed: "확인 필요",
                                    cancelled: "취소됨",
                                    interrupted: "중단됨",
                                  } as Record<string, string>
                                )[state.job.status] || state.job.status,
                              )}
                        </span>
                      </div>
                    )}
                    <WorkflowProgress
                      job={state.job}
                      events={activeActivity}
                      settings={state.settings}
                      t={t}
                    />
                    {split ? (
                      <div
                        className="split-workspace"
                        style={{
                          gridTemplateColumns: `minmax(0, ${ratio}fr) 8px minmax(0, ${100 - ratio}fr)`,
                        }}
                      >
                        <AgentPane
                          agent={selectedLeft}
                          options={options}
                          choose={setLeft}
                          state={state}
                          events={activeActivity}
                          t={t}
                          now={now}
                        />
                        <div
                          className="split-handle"
                          role="separator"
                          aria-label="Resize panes"
                          onPointerDown={(e) => {
                            const rect =
                              e.currentTarget.parentElement!.getBoundingClientRect();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            const target = e.currentTarget;
                            const move = (event: PointerEvent) =>
                              setRatio(
                                Math.max(
                                  25,
                                  Math.min(
                                    75,
                                    (100 * (event.clientX - rect.left)) /
                                      rect.width,
                                  ),
                                ),
                              );
                            const stop = () => {
                              target.removeEventListener("pointermove", move);
                              target.removeEventListener("pointerup", stop);
                            };
                            target.addEventListener("pointermove", move);
                            target.addEventListener("pointerup", stop);
                          }}
                        />
                        <AgentPane
                          agent={selectedRight}
                          options={options}
                          choose={setRight}
                          state={state}
                          events={activeActivity}
                          t={t}
                          now={now}
                        />
                      </div>
                    ) : (
                      <Conversation messages={state.messages} t={t} />
                    )}
                  </>
                )}
                <div className="composer-area">
                  {!!state.messages.length && (
                    <div className="agent-status-strip">
                      {participants.map((a) => {
                        const p = latestPhase(activeActivity, a);
                        const active =
                          busy && p && !["Done", "Failed"].includes(p.text);
                        return (
                          <button
                            key={a}
                            onClick={() => {
                              setSplit(true);
                              setLeft(a);
                            }}
                          >
                            <AgentMark agent={a} small />
                            <span>{names[a]}</span>
                            <span
                              className={
                                "agent-state " +
                                (active
                                  ? "working"
                                  : p?.text === "Failed"
                                    ? "failed"
                                    : "")
                              }
                            >
                              {active && <span className="pulse-dot" />}
                              {phaseLabel(p?.text || "", t)}
                              {active && (
                                <small>
                                  {Math.max(
                                    0,
                                    Math.floor(
                                      (now - Date.parse(p.time)) / 1000,
                                    ),
                                  )}
                                  s
                                </small>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className={"composer " + (busy ? "busy" : "")}>
                    <textarea
                      ref={input}
                      value={draft}
                      placeholder={t(
                        "Ask, build, or get a fresh perspective…",
                        "질문하거나, 만들거나, 새로운 의견을 구해보세요…",
                      )}
                      onChange={(e) => changeDraft(e.target.value)}
                      onCompositionStart={() => {
                        composition.current = true;
                      }}
                      onCompositionEnd={(e) => {
                        composition.current = false;
                        changeDraft(e.currentTarget.value);
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          !composition.current &&
                          e.keyCode !== 229
                        ) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={3}
                    />
                    <div className="composer-tools">
                      {chooser && (
                        <>
                          <div
                            className="dismiss"
                            onClick={() => setChooser(null)}
                          />
                          <div className="quick-chooser dropdown" role="menu">
                            <header>
                              {chooser === "lead"
                                ? t("Lead agent", "담당 AI")
                                : t("Execution permissions", "실행 권한")}
                            </header>
                            {chooser === "lead"
                              ? [...agents, null].map((a) => (
                                  <button
                                    key={a || "none"}
                                    onClick={() => {
                                      setChooser(null);
                                      void saveSettings({
                                        ...state.settings,
                                        coder: a,
                                        reviewers:
                                          state.settings.reviewers.filter(
                                            (r) => r !== a,
                                          ),
                                      }).catch((e) => setError(String(e)));
                                    }}
                                  >
                                    {a && <AgentMark agent={a} small />}
                                    <span>
                                      {a
                                        ? names[a]
                                        : t("Review only", "검토만 진행")}
                                    </span>
                                    {state.settings.coder === a && (
                                      <Check size={13} />
                                    )}
                                  </button>
                                ))
                              : (["restricted", "coder", "all"] as const).map(
                                  (scope) => (
                                    <button
                                      key={scope}
                                      onClick={() => {
                                        setChooser(null);
                                        void saveSettings({
                                          ...state.settings,
                                          permissions: scope,
                                        }).catch((e) => setError(String(e)));
                                      }}
                                    >
                                      <Shield size={14} />
                                      <span>
                                        {scope === "all"
                                          ? t(
                                              "Full access · all agents",
                                              "전체 권한 · 모든 AI",
                                            )
                                          : scope === "coder"
                                            ? t(
                                                "Full access · lead agent",
                                                "전체 권한 · 담당 AI",
                                              )
                                            : t(
                                                "Standard permissions",
                                                "기본 권한",
                                              )}
                                      </span>
                                      {state.settings.permissions === scope && (
                                        <Check size={13} />
                                      )}
                                    </button>
                                  ),
                                )}
                            <div className="divider" />
                            <button
                              onClick={() => {
                                setChooser(null);
                                setModal("team");
                              }}
                            >
                              <Settings2 size={13} />
                              {t("Manage review team", "검토 AI 구성")}
                            </button>
                          </div>
                        </>
                      )}
                      <button
                        className="composer-agent"
                        aria-label={t("Choose lead agent", "담당 AI 선택")}
                        onClick={() =>
                          setChooser(chooser === "lead" ? null : "lead")
                        }
                      >
                        <AgentMark
                          agent={state.settings.coder || "council"}
                          small
                        />
                        {state.settings.coder
                          ? names[state.settings.coder]
                          : t("Review only", "검토만 진행")}
                        <ChevronDown size={12} />
                      </button>
                      <button
                        className={
                          "permission-label " +
                          (state.settings.permissions !== "restricted"
                            ? "full"
                            : "")
                        }
                        aria-label={t("Execution permissions", "실행 권한")}
                        onClick={() =>
                          setChooser(
                            chooser === "permission" ? null : "permission",
                          )
                        }
                      >
                        <Shield size={12} />
                        {t(
                          state.settings.permissions === "all"
                            ? "Full access · all"
                            : state.settings.permissions === "coder"
                              ? "Full access · coder"
                              : "Standard",
                          state.settings.permissions === "all"
                            ? "전체 권한 · 모든 AI"
                            : state.settings.permissions === "coder"
                              ? "전체 권한 · 코더"
                              : "기본 권한",
                        )}
                      </button>
                      <div className="grow" />
                      <span className="key-hint">Shift ↵</span>
                      {busy ? (
                        <button
                          className="send-button stop"
                          title={t("Stop task", "작업 중지")}
                          onClick={() =>
                            void api(`/jobs/${state.job!.id}/cancel`, {}).catch(
                              (e) => setError(String(e)),
                            )
                          }
                        >
                          <Square size={14} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label={t("Send", "보내기")}
                          disabled={!draft.trim() || sending || !connected}
                          onClick={() => void send()}
                        >
                          <ArrowUp size={19} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="composer-caption">
                    <span>
                      {busy
                        ? t(
                            "Work continues even when you close this window.",
                            "창을 닫아도 작업은 계속됩니다.",
                          )
                        : t(
                            "Enter to send · Shift + Enter for a new line",
                            "Enter 전송 · Shift + Enter 줄바꿈",
                          )}
                    </span>
                    <span>
                      {t("Local engine · Rust", "로컬 실행 엔진 · Rust")}
                    </span>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
        <footer className="statusbar">
          <button
            className="usage-toggle"
            onClick={() => {
              setUsageAgent("");
              setUsage(!usage);
            }}
          >
            <ActivityIcon size={12} />
            {t("Usage", "사용량")}
            <ChevronDown size={11} />
          </button>
          <div className="quota-strip">
            {agents.map((a) => {
              const quota = windows(a, state?.limits[a]);
              const w = summaryWindow(quota);
              const meta = state?.limits[a] as
                { status?: string; message?: string } | undefined;
              return (
                <button
                  key={a}
                  className={meta?.status === "stale" ? "quota-is-stale" : ""}
                  aria-label={names[a] + t(" usage", " 사용량")}
                  title={
                    names[a] +
                    ": " +
                    (meta?.status === "stale"
                      ? t("Last known · ", "이전 조회값 · ")
                      : "") +
                    (w
                      ? quota
                          .map(
                            (q) =>
                              `${q.label} · ${percent(q.used)} used · ${countdown(q.reset)}`,
                          )
                          .join("\n")
                      : meta?.message || "Checking usage…")
                  }
                  onClick={() => {
                    setUsageAgent(a);
                    setUsage(true);
                  }}
                >
                  <AgentMark agent={a} small />
                  <span className="quota-name">
                    {names[a]
                      .replace(" Code", "")
                      .replace(" Agent", "")
                      .replace(" CLI", "")}
                  </span>
                  {w ? (
                    <>
                      <span
                        className={
                          "tiny-meter " + (w.used >= 85 ? "danger" : "")
                        }
                      >
                        <i style={{ width: `${w.used}%` }} />
                      </span>
                      <span className="quota-period">
                        {quotaLabel(w.label)}
                      </span>
                      <span>{percent(w.used)}</span>
                      <small>{countdown(w.reset)}</small>
                    </>
                  ) : (
                    <span>
                      {meta?.status === "loading"
                        ? "…"
                        : meta?.status === "signed_out"
                          ? t("Sign in", "로그인")
                          : meta?.status === "unlimited"
                            ? "∞"
                            : "—"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="grow" />
          <span className="connection-indicator">
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span>
              {t(
                connected ? "Local" : "Reconnecting",
                connected ? "로컬" : "재연결 중",
              )}
            </span>
          </span>
        </footer>
        {usage && state && (
          <>
            <div className="dismiss" onClick={() => setUsage(false)} />
            <Usage
              state={state}
              selected={usageAgent}
              t={t}
              close={() => setUsage(false)}
              refresh={async () => {
                await api("/usage/refresh", {});
                await refresh();
              }}
            />
          </>
        )}
        {(modal === "settings" || modal === "team") && state && (
          <SettingsModal
            key={modal}
            onlyAgents={modal === "team"}
            initial={state.settings}
            version={state.version}
            detected={state.agents}
            save={saveSettings}
            close={closeModal}
            t={t}
          />
        )}
        {modal === "update" && (
          <UpdateModal
            close={closeModal}
            t={t}
            currentVersion={state?.version || "—"}
          />
        )}
        {modal === "companion" && (
          <Modal title={t("Connect a phone", "휴대폰 연결")} close={closeModal}>
            <CompanionSettings t={t} />
          </Modal>
        )}
      </div>
    </FilePreviewProvider>
  );
}

function Conversation({ messages, t }: { messages: Message[]; t: Translate }) {
  const ref = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);
  return (
    <div
      className="conversation scrollable"
      ref={ref}
      onScroll={() => {
        if (ref.current)
          follow.current =
            ref.current.scrollHeight -
              ref.current.scrollTop -
              ref.current.clientHeight <
            70;
      }}
    >
      <div className="conversation-inner">
        {messages.map((m, i) =>
          m.role === "You" ? (
            <div className="user-message" key={i}>
              <div>{m.text}</div>
            </div>
          ) : (
            <article className="assistant-message" key={i}>
              <div className="message-author">
                <AgentMark agent={m.role} small />
                <strong>
                  {m.role === "council"
                    ? t("Council report", "최종 보고서")
                    : names[m.role] || m.role}
                </strong>
                {m.stage && <span>{stageLabel(m.stage, t)}</span>}
                <button
                  className="icon-button copy-button"
                  title={t("Copy", "복사")}
                  onClick={() => void navigator.clipboard.writeText(m.text)}
                >
                  <Copy size={13} />
                </button>
              </div>
              {m.stage === "error" ? (
                <AgentProblem message={m.text} agent={m.role} t={t} />
              ) : (
                <Markdown text={m.text} />
              )}
            </article>
          ),
        )}
      </div>
    </div>
  );
}
function stageLabel(stage: string, t: Translate) {
  return (
    (
      {
        work: t("Work", "작업 결과"),
        review: t("Independent review", "개별 검수"),
        refinement: t("Refinement", "검토 의견 반영"),
        verification: t("Verification", "수정 결과 재검토"),
        discussion: t("Conference", "회의 의견"),
        report: t("Final report", "최종 보고서"),
        error: t("Issue", "문제"),
      } as Record<string, string>
    )[stage] || stage
  );
}
function AgentPane({
  agent,
  options,
  choose,
  state,
  events,
  t,
  now,
}: {
  agent: string;
  options: string[];
  choose: (agent: string) => void;
  state: Snapshot;
  events: Activity[];
  t: Translate;
  now: number;
}) {
  const [log, setLog] = useState(false),
    [expanded, setExpanded] = useState(false),
    [unread, setUnread] = useState(false);
  const closeNote = useCallback(() => setExpanded(false), []);
  const ref = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const start = state.messages.map((m) => m.role).lastIndexOf("You");
  const progress = state.job
    ? workflowProgress(state.job, events, state.settings)
    : null;
  const messages = state.messages
    .slice(start + 1)
    .filter(
      (m) =>
        m.role === agent ||
        m.role === (names[agent] || agent) ||
        (agent === "council" &&
          progress?.stage === "question" &&
          progress.members.includes(m.role)),
    );
  const last = latestPhase(events, agent);
  const notes = events.filter(
    (e) =>
      e.agent === agent && ["note", "tool", "phase", "error"].includes(e.kind),
  );
  const rawNote = notes.filter((e) => e.kind === "note").at(-1);
  const archived =
    rawNote && state.job?.status !== "running"
      ? state.messages
          .slice()
          .reverse()
          .find(
            (m) =>
              m.stage === rawNote.stage &&
              (m.role === agent ||
                (rawNote.stage === "report" && m.role === "council")),
          )
      : undefined;
  // v3.0 stored only the tail of notes; recover finished text from its report.
  const note =
    rawNote?.data == null && rawNote
      ? {
          ...rawNote,
          text: archived?.text || rawNote.text,
          data: { truncated: !archived },
        }
      : rawNote;
  const scrollKey = log ? notes.at(-1)?.id : messages.length;
  useLayoutEffect(() => {
    if (follow.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
      setUnread(false);
    } else if (!log) setUnread(true);
  }, [scrollKey, log, agent]);
  const active =
    state.job?.status === "running" &&
    last &&
    !["Done", "Failed"].includes(last.text);
  return (
    <section className="agent-pane">
      <header className="pane-header">
        <AgentMark agent={agent} />
        <select
          aria-label={t("Select agent", "에이전트 선택")}
          value={agent}
          onChange={(e) => {
            choose(e.target.value);
            follow.current = true;
          }}
        >
          {options.map((a) => (
            <option key={a} value={a}>
              {a === "council"
                ? t("Council report", "최종 보고서")
                : names[a] || a}
            </option>
          ))}
        </select>
        <button
          className={"icon-button " + (log ? "selected" : "")}
          title={t("Activity history", "활동 기록")}
          onClick={() => setLog(!log)}
        >
          <ActivityIcon size={16} />
        </button>
      </header>
      <div className="pane-phase">
        {active ? (
          <span className="pulse-dot" />
        ) : (
          <span className="status-dot" />
        )}
        <span>
          {agent === "council"
            ? progress?.running
              ? stageLabel(progress.stage, t)
              : t("The shared conclusion", "의견을 모은 최종 결론")
            : phaseLabel(last?.text || "", t)}
        </span>
        {active && (
          <small>
            {Math.max(0, Math.floor((now - Date.parse(last.time)) / 1000))}s
          </small>
        )}
        <span className="grow" />
        <span className="pane-mode">
          {log ? t("ACTIVITY", "활동 기록") : t("RESULTS", "결과")}
        </span>
      </div>
      <div
        className="pane-content scrollable"
        ref={ref}
        onScroll={() => {
          if (ref.current)
            follow.current =
              ref.current.scrollHeight -
                ref.current.scrollTop -
                ref.current.clientHeight <
              70;
        }}
      >
        {log ? (
          <div className="activity-log">
            {notes.length ? (
              notes.map((e) => (
                <div className={"log-entry " + e.kind} key={e.id}>
                  <span className="log-dot" />
                  <time>
                    {new Date(e.time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <div>
                    {e.kind === "phase" ? phaseLabel(e.text, t) : e.text}
                  </div>
                </div>
              ))
            ) : (
              <div className="pane-empty">
                <ActivityIcon size={22} />
                <p>
                  {t(
                    "Activity will appear here.",
                    "활동 기록이 여기에 쌓입니다.",
                  )}
                </p>
              </div>
            )}
          </div>
        ) : messages.length ? (
          messages.map((m, i) => (
            <article key={i} className="pane-report">
              <div className="report-stage">{stageLabel(m.stage, t)}</div>
              {m.stage === "error" ? (
                <AgentProblem message={m.text} agent={agent} t={t} />
              ) : (
                <Markdown text={m.text} />
              )}
            </article>
          ))
        ) : (
          <div className="pane-empty">
            <AgentMark agent={agent} />
            <h3>
              {active
                ? t("Giving it some thought…", "생각을 정리하고 있어요…")
                : t(
                    "A fresh perspective awaits",
                    "새로운 의견을 기다리고 있어요",
                  )}
            </h3>
            <p>
              {agent === "council"
                ? t(
                    "Individual reviews and discussion come together here.",
                    "개별 검수와 회의를 마치면 최종 보고서가 여기에 표시됩니다.",
                  )
                : t(
                    "The result stays here when this agent finishes.",
                    "에이전트의 작업 결과와 검수 의견이 여기에 남습니다.",
                  )}
            </p>
          </div>
        )}
      </div>
      {unread && !log && (
        <button
          className="new-results"
          onClick={() => {
            follow.current = true;
            ref.current?.scrollTo({
              top: ref.current.scrollHeight,
              behavior: "smooth",
            });
            setUnread(false);
          }}
        >
          {t("New results ↓", "새 의견 보기 ↓")}
        </button>
      )}
      {note && (
        <div className="work-note">
          <button onClick={() => setExpanded(!expanded)}>
            <span>
              <span className={active ? "pulse-dot" : "status-dot"} />
              {t("Working notes", "작업 노트")}
            </span>
            <time>
              {new Date(note.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <span className="note-open">
              {t("Read full note", "전체 보기")} <ArrowUpRight size={12} />
            </span>
          </button>
          <div className="note-excerpt">
            <Markdown text={note.text} />
          </div>
        </div>
      )}
      {expanded && note && (
        <Modal
          title={t("Working notes", "작업 노트")}
          subtitle={`${names[agent] || agent} · ${stageLabel(note.stage, t)} · ${new Date(note.time).toLocaleTimeString()}`}
          close={closeNote}
          wide
        >
          <div className="note-full scrollable">
            <Markdown text={note.text} />
            {(note.data as { truncated?: boolean } | null)?.truncated && (
              <p className="preview-limit">
                {t(
                  "This preview is limited to 64,000 characters. The final report is saved separately.",
                  "이 미리보기는 64,000자까지 보관됩니다. 최종 결과는 별도로 저장됩니다.",
                )}
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
function SettingsModal({
  initial,
  version,
  onlyAgents = false,
  detected,
  save,
  close,
  t,
}: {
  initial: Settings;
  version: string;
  onlyAgents?: boolean;
  detected: Snapshot["agents"];
  save: (s: Settings) => Promise<void>;
  close: () => void;
  t: Translate;
}) {
  const [value, setValue] = useState(initial),
    [tab, setTab] = useState(onlyAgents ? "agents" : "workspace"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const update = (v: Partial<Settings>) =>
    setValue((old) => ({ ...old, ...v }));
  async function browse(reference = false) {
    try {
      const folder = await pickFolder();
      if (folder)
        update(
          reference
            ? { references: [...new Set([...value.references, folder])] }
            : { folder },
        );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Modal
      title={
        onlyAgents ? t("Agent team", "에이전트 구성") : t("Settings", "설정")
      }
      subtitle={t(
        "Your workspace, your team, your way.",
        "작업 공간과 함께할 에이전트를 설정하세요.",
      )}
      close={close}
      wide
    >
      <div className={"settings-layout " + (onlyAgents ? "team-layout" : "")}>
        {!onlyAgents && (
          <nav>
            {[
              ["workspace", Folder, t("Workspace", "워크스페이스")],
              ["appearance", Sun, t("Appearance", "화면 설정")],
            ].map(([id, Icon, label]) => {
              const I = Icon as typeof Folder;
              return (
                <button
                  key={id as string}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id as string)}
                >
                  <I size={16} />
                  {label as string}
                </button>
              );
            })}
            <div className="settings-nav-bottom">
              v{version}
              <br />
              Tauri · React · Rust
            </div>
          </nav>
        )}
        <div className="settings-content scrollable">
          {tab === "agents" && (
            <>
              <section>
                <h3>
                  {t("Lead agent", "담당 AI")}
                  <span className="optional">{t("Optional", "선택 사항")}</span>
                </h3>
                <p>
                  {t(
                    "Carries out your request and makes changes when asked.",
                    "요청을 수행하고 필요한 코드를 직접 수정합니다.",
                  )}
                </p>
                <div className="agent-choices">
                  {[...agents, null].map((a) => (
                    <button
                      className={
                        "agent-choice " + (value.coder === a ? "chosen" : "")
                      }
                      key={a || "none"}
                      onClick={() =>
                        update({
                          coder: a,
                          reviewers: value.reviewers.filter((r) => r !== a),
                        })
                      }
                    >
                      {a ? (
                        <AgentMark agent={a} small />
                      ) : (
                        <MessageSquare size={16} />
                      )}
                      <span>
                        {a ? names[a] : t("Review only", "검수 전용")}
                      </span>
                      {value.coder === a && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3>
                  {t("Review team", "검토 AI")}
                  <span className="optional">
                    {value.reviewers.length} {t("selected", "명 선택")}
                  </span>
                </h3>
                <p>
                  {t(
                    "Independent opinions, followed by a shared discussion.",
                    "각자의 의견을 제시하고, 함께 검토해 최종 결과를 정리합니다.",
                  )}
                </p>
                <div className="review-choices">
                  {agents.map((a) => {
                    const selected = value.reviewers.includes(a),
                      coder = value.coder === a,
                      installed = detected.find((d) => d.id === a)?.installed;
                    return (
                      <button
                        key={a}
                        disabled={coder}
                        className={
                          "review-choice " + (selected ? "chosen" : "")
                        }
                        onClick={() =>
                          update({
                            reviewers: selected
                              ? value.reviewers.filter((r) => r !== a)
                              : [...value.reviewers, a],
                          })
                        }
                      >
                        <AgentMark agent={a} />
                        <div>
                          <strong>{names[a]}</strong>
                          <small>
                            {coder
                              ? t("Coding agent", "코딩 담당")
                              : installed
                                ? t("CLI detected", "CLI 감지됨")
                                : t("CLI not found", "CLI 설치 필요")}
                          </small>
                        </div>
                        <span
                          className={"check-box " + (selected ? "checked" : "")}
                        >
                          {selected && <Check size={11} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="permissions-section">
                <div>
                  <h3>
                    <Shield size={16} />
                    {t("Execution permissions", "실행 권한")}
                  </h3>
                  <p>
                    {t(
                      "Choose which agents may skip CLI approval checks.",
                      "CLI의 실행 승인 확인을 건너뛸 범위를 선택합니다.",
                    )}
                  </p>
                </div>
                <select
                  value={value.permissions}
                  onChange={(e) =>
                    update({
                      permissions: e.target.value as Settings["permissions"],
                    })
                  }
                >
                  <option value="restricted">
                    {t("Standard permissions", "기본 권한")}
                  </option>
                  <option value="coder">
                    {t("Full access · coder", "전체 권한 · 코더")}
                  </option>
                  <option value="all">
                    {t("Full access · all agents", "전체 권한 · 모든 AI")}
                  </option>
                </select>
                {value.permissions === "all" && (
                  <div className="permission-note">
                    {t(
                      "Reviewers are instructed to give opinions. Full access also permits their tools to modify files.",
                      "검수자는 의견만 제시하도록 지시받지만, 전체 권한에서는 도구의 파일 수정도 허용됩니다.",
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "workspace" && (
            <>
              <section>
                <h3>{t("Project folder", "프로젝트 폴더")}</h3>
                <p>
                  {t(
                    "Agents run commands and make changes in this folder.",
                    "에이전트가 명령을 실행하고 파일을 수정할 폴더입니다.",
                  )}
                </p>
                <div className="folder-field">
                  <Folder size={16} />
                  <input
                    value={value.folder}
                    onChange={(e) => update({ folder: e.target.value })}
                  />
                  <button onClick={() => void browse()}>
                    {t("Browse", "찾아보기")}
                  </button>
                </div>
              </section>
              <section>
                <h3>
                  {t("Reference folders", "참고 폴더")}
                  <span className="optional">{value.references.length}</span>
                </h3>
                <p>
                  {t(
                    "Additional context for reading and comparison.",
                    "읽기와 비교에 참고할 추가 폴더입니다.",
                  )}
                </p>
                <div className="references">
                  {value.references.map((folder) => (
                    <div key={folder}>
                      <Folder size={14} />
                      <span title={folder}>{folder}</span>
                      <button
                        className="icon-button"
                        onClick={() =>
                          update({
                            references: value.references.filter(
                              (r) => r !== folder,
                            ),
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => void browse(true)}
                >
                  <FolderPlus size={15} />
                  {t("Add reference folder", "참고 폴더 추가")}
                </button>
              </section>
              <section>
                <h3>{t("Background execution", "백그라운드 실행")}</h3>
                <p>
                  {t(
                    "Closing the app window keeps accepted work running. Reopen the app to reconnect. If the engine stops unexpectedly, unfinished work is marked interrupted.",
                    "창을 닫아도 접수된 작업은 계속됩니다. 앱을 다시 열면 연결됩니다. 엔진이 비정상 종료되면 미완료 작업은 중단됨으로 표시됩니다.",
                  )}
                </p>
              </section>
            </>
          )}
          {tab === "appearance" && (
            <>
              <section>
                <h3>{t("Appearance", "화면 모드")}</h3>
                <p>
                  {t(
                    "A comfortable space for your next idea.",
                    "작업하기 편안한 화면을 선택하세요.",
                  )}
                </p>
                <div className="theme-choices">
                  {(["light", "dark", "system"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={value.appearance === mode ? "chosen" : ""}
                      onClick={() => update({ appearance: mode })}
                    >
                      <div className={"theme-preview " + mode}>
                        <i />
                        <div>
                          <b />
                          <b />
                          <b />
                        </div>
                      </div>
                      <span>
                        {t(
                          { light: "Light", dark: "Dark", system: "System" }[
                            mode
                          ],
                          { light: "밝게", dark: "어둡게", system: "시스템" }[
                            mode
                          ],
                        )}
                        {value.appearance === mode && <Check size={13} />}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="setting-row">
                <div>
                  <h3>{t("Language", "언어")}</h3>
                  <p>
                    {t(
                      "Interface and agent responses.",
                      "화면과 에이전트 답변에 적용됩니다.",
                    )}
                  </p>
                </div>
                <select
                  value={value.language}
                  onChange={(e) => update({ language: e.target.value })}
                >
                  <option>English</option>
                  <option>한국어</option>
                </select>
              </section>
            </>
          )}
        </div>
      </div>
      <footer className="modal-footer">
        {error ? (
          <span className="danger-text" role="alert">
            {error}
          </span>
        ) : (
          <span>
            {t(
              "Changes apply to future tasks.",
              "설정은 다음 작업부터 적용됩니다.",
            )}
          </span>
        )}
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void save(value)
              .catch((e) => setError(String(e)))
              .finally(() => setSaving(false));
          }}
        >
          {saving
            ? t("Saving…", "저장 중…")
            : t("Save changes", "변경 사항 저장")}
        </button>
      </footer>
    </Modal>
  );
}
function UpdateModal({
  close,
  t,
  currentVersion,
}: {
  close: () => void;
  t: Translate;
  currentVersion: string;
}) {
  const [result, setResult] = useState<{
      available: boolean;
      version: string;
      url: string;
    } | null>(null),
    [error, setError] = useState(""),
    [installing, setInstalling] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<{ available: boolean; version: string; url: string }>("/update")
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Modal title={t("Software update", "프로그램 업데이트")} close={close}>
      <div className="update-content">
        <span className="brand-icon large">≋</span>
        <h3>
          {error
            ? t("Could not check for updates", "업데이트를 확인할 수 없습니다")
            : !result
              ? t("Checking for updates…", "업데이트를 확인하고 있어요…")
              : result.available
                ? t("A new version is ready", "새 버전이 준비되었습니다")
                : t("You’re up to date", "최신 버전입니다")}
        </h3>
        <p>
          {error ||
            `Agent Council ${result?.available ? result.version : currentVersion}`}
        </p>
        {result?.available && (
          <>
            <button
              className="primary-button"
              disabled={installing}
              onClick={() => {
                setInstalling(true);
                void invoke("install_update").catch((e) => {
                  setError(String(e));
                  setInstalling(false);
                });
              }}
            >
              <Download size={15} />
              {installing
                ? t("Downloading…", "다운로드 중…")
                : t("Download & restart", "다운로드 후 다시 시작")}
            </button>
            <button
              className="text-button"
              onClick={() => void external(result.url)}
            >
              {t("Release notes", "변경 사항")}
              <ArrowUpRight size={12} />
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
