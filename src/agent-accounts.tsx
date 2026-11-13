import { useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Folder,
  Plus,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import { api, pickFolder, RuntimeConnectionError } from "./api";
import {
  agentMark,
  agentColor,
  agentName,
  agentProvider,
  isAgentProfile,
  type AccountProvider,
  type AgentProfile,
  type Settings,
} from "./types";

type Translate = (en: string, ko: string) => string;
type Status =
  "connected" | "sign_in_required" | "cli_unavailable" | "check_failed";
type Account = Omit<AgentProfile, "name"> & {
  name: AgentProfile["name"] | AccountProvider;
  status: Status;
  account_email?: string;
  login_command?: string;
  login_shell?: "powershell" | "macos_terminal" | "posix_terminal";
};

function folderKey(path: string) {
  return /^[a-z]:[\\/]|^\\\\/i.test(path)
    ? path.replaceAll("/", "\\").toLowerCase()
    : path;
}

export function AgentAccounts({
  provider,
  value,
  update,
  t,
}: {
  provider: AccountProvider;
  value: Settings;
  update: (patch: Partial<Settings>) => void;
  t: Translate;
}) {
  const allProfiles = value.agent_profiles ?? [];
  const profiles = allProfiles.filter(
    (p) => agentProvider(p.name) === provider,
  );
  const providerName = provider === "claude" ? "Claude" : agentName(provider);
  const accountLabel = t(`${providerName} account`, `${providerName} 계정`);
  const route = `/${provider}/accounts`;
  const [mode, setMode] = useState<"existing" | "new" | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [edit, setEdit] = useState<{ id: string; label: string } | null>(null);
  const prepareRequest = useRef<string | null>(null);
  const occupied = new Set(
    allProfiles.map((profile) => folderKey(profile.config_dir)),
  );
  const detected = (accounts ?? []).filter(
    (account) =>
      account.name !== provider && !occupied.has(folderKey(account.config_dir)),
  );
  const candidates =
    selected && !occupied.has(folderKey(selected.config_dir))
      ? [
          selected,
          ...detected.filter(
            (account) =>
              folderKey(account.config_dir) !== folderKey(selected.config_dir),
          ),
        ]
      : detected;
  const defaultAccount = accounts?.find((entry) => entry.name === provider);
  const identity = (account?: Account) =>
    account?.account_email ??
    (account?.status === "connected"
      ? t("Email not reported", "이메일 정보 없음")
      : undefined);
  const statusLabel = (status?: Status) => {
    switch (status) {
      case "connected":
        return t("Signed in", "로그인됨");
      case "sign_in_required":
        return t("Sign-in required", "로그인 필요");
      case "cli_unavailable":
        return t(
          `${providerName} CLI unavailable`,
          `${providerName} CLI 설치 필요`,
        );
      case "check_failed":
        return t("Could not verify", "확인할 수 없음");
      default:
        return t("Unchecked", "확인 전");
    }
  };
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(
        err instanceof RuntimeConnectionError
          ? t(
              "Could not reconnect to the local engine. Try again or reopen Agent Council.",
              "로컬 엔진에 다시 연결하지 못했습니다. 다시 시도하거나 Agent Council을 다시 열어 주세요.",
            )
          : String(err),
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setAccounts(
      await api<Account[]>(route, undefined, "GET", {
        retryOnDisconnect: true,
      }),
    );
  }
  async function prepare() {
    const request_id = (prepareRequest.current ??= crypto.randomUUID());
    const account = await api<Account>(
      `${route}/prepare`,
      { request_id },
      "POST",
      { retryOnDisconnect: true },
    );
    prepareRequest.current = null;
    setSelected(account);
  }
  function connect(account: Account) {
    if (
      !isAgentProfile(account.name) ||
      account.status !== "connected" ||
      occupied.has(folderKey(account.config_dir))
    )
      return;
    const labels = new Set(
      allProfiles.map((profile) =>
        (profile.display_name ?? profile.name).toLowerCase(),
      ),
    );
    const numbered = provider === "claude";
    const base = numbered ? agentName(provider) : account.display_name ?? accountLabel;
    let index = numbered ? profiles.length + 2 : 1;
    let label = numbered ? `${base} ${index}` : base;
    while (labels.has(label.toLowerCase())) {
      index++;
      const suffix = ` ${index}`;
      label = [...base].slice(0, 40 - suffix.length).join("") + suffix;
    }
    update({
      agent_profiles: [
        ...allProfiles,
        {
          name: account.name,
          config_dir: account.config_dir,
          display_name: label,
        },
      ],
    });
    setAccounts((old) => [
      ...(old ?? []).filter((entry) => entry.name !== account.name),
      account,
    ]);
    setMode(null);
    setSelected(null);
  }
  async function check(folder: string) {
    const result = await api<Account>(
      `${route}/check`,
      {
        config_dir: folder,
      },
      "POST",
      { retryOnDisconnect: true },
    );
    if (occupied.has(folderKey(result.config_dir))) {
      setError(
        t("This folder is already connected.", "이미 연결한 계정 폴더입니다."),
      );
      return;
    }
    const previous = accounts?.find(
      (entry) => folderKey(entry.config_dir) === folderKey(result.config_dir),
    );
    setSelected(
      previous
        ? {
            ...result,
            name: previous.name,
            display_name: previous.display_name,
          }
        : result,
    );
  }
  return (
    <details
      className="claude-accounts"
      onToggle={(event) => {
        if (event.currentTarget.open && !accounts && !busy) void run(refresh);
      }}
    >
      <summary>
        <span
          className="claude-account-mark"
          style={{ color: agentColor(provider) }}
          aria-hidden="true"
        >
          {agentMark(provider)}
        </span>
        <strong>{t(`${providerName} accounts`, accountLabel)}</strong>
        <span className="optional">{profiles.length + 1}</span>
        <ChevronDown size={15} />
      </summary>
      <div className="claude-account-body" aria-busy={busy}>
        <div className="claude-account-list">
          <div className="claude-account-row">
            <div>
              <strong>
                {t(`Default ${providerName}`, `기본 ${providerName}`)}
              </strong>
              <span>
                {identity(defaultAccount) ??
                  t("System sign-in", "시스템 로그인")}
              </span>
            </div>
            <small
              className="claude-account-status"
              data-status={defaultAccount?.status}
            >
              {statusLabel(defaultAccount?.status)}
            </small>
          </div>
          {profiles.map((profile) => {
            const label = profile.display_name ?? profile.name;
            const account = accounts?.find(
              (entry) =>
                folderKey(entry.config_dir) === folderKey(profile.config_dir),
            );
            const status = account?.status;
            return (
              <details className="claude-account-row" key={profile.name}>
                <summary>
                  <span className="claude-account-name">
                    <strong>{label}</strong>
                    {identity(account) && <small>{identity(account)}</small>}
                  </span>
                  <small className="claude-account-status" data-status={status}>
                    {statusLabel(status)}
                  </small>
                  <ChevronDown size={13} />
                </summary>
                <div className="claude-account-detail">
                  <small title={profile.config_dir}>{profile.config_dir}</small>
                  {edit?.id === profile.name ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const display_name = edit.label.trim();
                        if (!display_name) return;
                        if (
                          allProfiles.some(
                            (entry) =>
                              entry.name !== profile.name &&
                              (
                                entry.display_name ?? entry.name
                              ).toLowerCase() === display_name.toLowerCase(),
                          )
                        ) {
                          setError(
                            t(
                              "That name is already in use.",
                              "이미 사용 중인 이름입니다.",
                            ),
                          );
                          return;
                        }
                        update({
                          agent_profiles: allProfiles.map((entry) =>
                            entry.name === profile.name
                              ? { ...entry, display_name }
                              : entry,
                          ),
                        });
                        setEdit(null);
                        setError("");
                      }}
                    >
                      <input
                        aria-label={t("Display name", "표시 이름")}
                        autoFocus
                        maxLength={40}
                        value={edit.label}
                        onChange={(event) =>
                          setEdit({
                            id: profile.name,
                            label: event.target.value,
                          })
                        }
                      />
                      <button type="submit" disabled={!edit.label.trim()}>
                        {t("Done", "완료")}
                      </button>
                    </form>
                  ) : (
                    <div className="claude-account-actions">
                      <button
                        type="button"
                        onClick={() => setEdit({ id: profile.name, label })}
                      >
                        {t("Rename", "이름 변경")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            agent_profiles: allProfiles.filter(
                              (entry) => entry.name !== profile.name,
                            ),
                            coder:
                              value.coder === profile.name ? null : value.coder,
                            reviewers: value.reviewers.filter(
                              (reviewer) => reviewer !== profile.name,
                            ),
                          })
                        }
                      >
                        <X size={13} /> {t("Disconnect", "연결 해제")}
                      </button>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
        <div className="claude-account-actions">
          <button
            type="button"
            aria-expanded={mode === "existing"}
            disabled={busy}
            onClick={() => {
              setMode(mode === "existing" ? null : "existing");
              setSelected(null);
              setError("");
            }}
          >
            <Plus size={14} /> {t("Connect existing account", "기존 계정 연결")}
          </button>
          <button
            type="button"
            aria-expanded={mode === "new"}
            disabled={busy}
            onClick={() => {
              setMode(mode === "new" ? null : "new");
              setSelected(null);
              setCopied(false);
              setError("");
            }}
          >
            <Terminal size={14} />{" "}
            {t("Sign in to a new account", "새 계정 로그인")}
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t(
              `Refresh ${providerName} accounts`,
              `${providerName} 계정 다시 확인`,
            )}
            onClick={() =>
              void run(async () => {
                await refresh();
                if (selected) await check(selected.config_dir);
              })
            }
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {busy && (
          <small role="status">
            {t("Checking accounts…", "계정을 확인하는 중…")}
          </small>
        )}
        {mode === "existing" && (
          <div className="claude-account-connect">
            {candidates.length > 0 ? (
              candidates.map((account) => (
                <div className="claude-account-row" key={account.name}>
                  <div>
                    <strong title={account.config_dir}>
                      {account.display_name ?? accountLabel}
                    </strong>
                    <small>
                      {identity(account) ?? statusLabel(account.status)}
                    </small>
                  </div>
                  {account.status === "connected" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => connect(account)}
                    >
                      {t("Connect", "연결")}
                    </button>
                  ) : account.login_command &&
                    account.status === "sign_in_required" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelected(account);
                        setCopied(false);
                        setMode("new");
                      }}
                    >
                      {t("Continue sign-in", "로그인 계속")}
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p>
                {t(
                  "No additional accounts found in the usual locations.",
                  "기본 위치에서 추가 계정을 찾지 못했습니다.",
                )}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const folder = await pickFolder();
                  if (folder) await check(folder);
                })
              }
            >
              <Folder size={14} />{" "}
              {t("Choose a different folder", "다른 폴더 선택")}
            </button>
          </div>
        )}
        {mode === "new" && (
          <div className="claude-account-connect">
            {selected ? (
              <>
                <p>
                  {selected.login_shell === "powershell"
                    ? t(
                        "Run this command in a new PowerShell window, then return here after signing in.",
                        "새 PowerShell 창에서 이 명령을 실행하고 로그인을 마친 뒤 돌아오세요.",
                      )
                    : selected.login_shell === "macos_terminal"
                      ? t(
                          "Run this command in macOS Terminal (zsh), then return here after signing in.",
                          "macOS 터미널(zsh)에서 이 명령을 실행하고 로그인을 마친 뒤 돌아오세요.",
                        )
                      : t(
                          "Run this command in a new terminal, then return here after signing in.",
                          "새 터미널에서 이 명령을 실행하고 로그인을 마친 뒤 돌아오세요.",
                        )}
                </p>
                <details>
                  <summary>
                    {t("Show login command", "로그인 명령 보기")}
                  </summary>
                  <pre>{selected.login_command}</pre>
                </details>
                <div className="claude-account-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(
                          selected.login_command ?? "",
                        );
                        setCopied(true);
                      })
                    }
                  >
                    <Copy size={13} />{" "}
                    {copied
                      ? t("Copied", "복사됨")
                      : t("Copy login command", "로그인 명령 복사")}
                  </button>
                  {selected.status === "connected" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => connect(selected)}
                    >
                      {t("Connect", "연결")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => check(selected.config_dir))}
                    >
                      {t("Check sign-in", "로그인 확인")}
                    </button>
                  )}
                  <small
                    className="claude-account-status"
                    data-status={selected.status}
                  >
                    {statusLabel(selected.status)}
                  </small>
                  {identity(selected) && (
                    <small className="claude-account-identity">
                      {identity(selected)}
                    </small>
                  )}
                </div>
              </>
            ) : (
              <>
                <p>
                  {t(
                    "Prepare a separate folder so this sign-in can join your team independently.",
                    "이 계정이 팀에 별도로 참여할 수 있도록 전용 폴더를 준비합니다.",
                  )}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(prepare)}
                >
                  {t("Prepare login", "로그인 준비")}
                </button>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="danger-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
