"""Agent Council desktop application."""
import hashlib
import base64
from datetime import datetime
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from urllib.request import Request, urlopen
import webbrowser

from multi_ai import AGENTS, CODING_AGENTS, antigravity_rate_limits, codex_rate_limits
from project_chat import ProjectChat
from ui_theme import FONT, PALETTES, blend, install

VERSION = "1.5.0"
REPO = "jwjp/agent-council"
ASSET = "AgentCouncil.exe"
CONFIG = Path(os.getenv("LOCALAPPDATA", Path.home())) / "AgentCouncil" / "settings.json"
NAMES = dict(zip(AGENTS, ("Codex", "Claude Code", "Antigravity", "Grok", "Cursor Agent", "Gemini CLI")))
USAGE_LINKS = {
    "claude": "https://claude.ai/settings/usage",
    "grok": "https://grok.com/dashboard",
    "agent": "https://cursor.com/dashboard/usage",
    "gemini": "https://geminicli.com/docs/resources/quota-and-pricing/",
}


def check_update():
    url = f"https://api.github.com/repos/{REPO}/releases/latest"
    with urlopen(Request(url, headers={"Accept": "application/vnd.github+json"}), timeout=20) as response:
        release = json.load(response)
    version = tuple(map(int, release["tag_name"].removeprefix("v").split(".")))
    if version <= tuple(map(int, VERSION.split("."))):
        return None
    asset = next(item for item in release["assets"] if item["name"] == ASSET)
    if not (asset.get("digest") or "").startswith("sha256:"):
        raise ValueError("Release asset has no SHA-256 digest.")
    return release["tag_name"], asset


def download_update(asset):
    if not getattr(sys, "frozen", False):
        raise ValueError("Run the packaged app to install updates.")
    folder = Path(sys.executable).parent
    digest = hashlib.sha256()
    partial = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, prefix=".agent-council-", suffix=".pending", delete=False) as file:
            partial = Path(file.name)
            with urlopen(asset["browser_download_url"], timeout=30) as response:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    file.write(chunk)
        if "sha256:" + digest.hexdigest() != asset["digest"]:
            raise ValueError("Update checksum mismatch.")
        return partial
    except Exception:
        if partial is not None:
            partial.unlink(missing_ok=True)
        raise


def restart_with_update(staged, executable, pid, failure_title):
    """Wait outside the running app, replace its executable, and start it again."""
    script = r"""
$ErrorActionPreference = 'Stop'
$target = $env:AGENT_COUNCIL_TARGET
$staged = $env:AGENT_COUNCIL_STAGED
$backup = $staged + '.backup'
$replaced = $false
try {
    $old = Get-Process -Id ([int]$env:AGENT_COUNCIL_PID) -ErrorAction SilentlyContinue
    if ($old -and !$old.WaitForExit(20000)) { throw 'The running app did not close.' }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            [IO.File]::Replace($staged, $target, $backup)
            $replaced = $true
            break
        } catch [IO.IOException] {
            if ($attempt -eq 39) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
    $env:PYINSTALLER_RESET_ENVIRONMENT = '1'
    Start-Process -FilePath $target -WorkingDirectory ([IO.Path]::GetDirectoryName($target))
} catch {
    $reason = $_.Exception.Message
    if ($replaced -and [IO.File]::Exists($backup)) {
        try { [IO.File]::Replace($backup, $target, $null) }
        catch { $reason += [Environment]::NewLine + $_.Exception.Message }
    }
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($reason, $env:AGENT_COUNCIL_UPDATE_ERROR)
    exit 1
} finally {
    [IO.File]::Delete($staged)
    if ($replaced -and !$reason) { [IO.File]::Delete($backup) }
}
"""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    env = dict(os.environ, AGENT_COUNCIL_TARGET=str(executable), AGENT_COUNCIL_STAGED=str(staged),
               AGENT_COUNCIL_PID=str(pid), AGENT_COUNCIL_UPDATE_ERROR=failure_title)
    return subprocess.Popen(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        env=env, creationflags=subprocess.CREATE_NO_WINDOW,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


class App:
    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.updating = False
        self.usage_dialog = None
        self.popup = None
        self.usage_fetching = set()
        self.account_limits = {}
        self.limit_errors = {}
        try:
            config = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {}
        self.lang = config.get("language", "English")
        self.appearance = config.get("appearance", "light")
        if self.appearance not in PALETTES:
            self.appearance = "light"
        self.colors = install(root, self.appearance)
        folder = Path(config.get("folder") or Path.home()).expanduser()
        self.folder = (folder if folder.is_dir() else Path.home()).resolve()
        self.coder = config.get("coder", "claude")
        if self.coder not in CODING_AGENTS:
            self.coder = None
        self.reviewers = [name for name in AGENTS if name in config.get("reviewers", []) and name != self.coder]
        self.references = [Path(path) for path in config.get("references", [])]
        self.full = bool(config.get("full_access") and self.coder and self.folder == folder.resolve())
        root.title(f"Agent Council {VERSION}")
        root.geometry("900x720")
        root.minsize(640, 500)
        self.body = ttk.Frame(root, padding=(18, 12))
        self.body.pack(fill="both", expand=True)
        self.header = ttk.Frame(self.body)
        self.header.pack(fill="x")
        ttk.Label(self.header, text="Agent Council", font=(FONT, 16, "bold")).pack(side="left")
        ttk.Label(self.header, text=VERSION, style="Muted.TLabel").pack(side="left", padx=(7, 0))
        self.settings_button = ttk.Button(self.header, command=self.settings)
        self.settings_button.pack(side="left", padx=(10, 0))
        self.update_button = ttk.Button(self.header, command=self.update)
        self.update_button.pack(side="right", padx=8)
        self.usage_button = ttk.Button(self.header, command=self.show_usage)
        self.usage_button.pack(side="right")
        self.folder_label = ttk.Label(self.body, style="Muted.TLabel")
        self.folder_label.pack(anchor="w", pady=(7, 8))
        ttk.Separator(self.body).pack(fill="x")
        self.chat = None
        self.build_chat(config.get("draft", ""))
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(200, self.poll)

    def t(self, english, korean):
        return korean if self.lang == "한국어" else english

    def build_chat(self, draft=""):
        self.settings_button.configure(text=self.t("Settings", "설정"))
        self.update_button.configure(text=self.t("Check for updates", "업데이트 확인"))
        self.usage_button.configure(text=self.t("Usage", "사용량"))
        refs = self.t(f"{len(self.references)} reference folders", f"참고 폴더 {len(self.references)}개")
        self.folder_label.configure(text=f"{self.t('Project', '프로젝트')} · {self.folder}   |   {refs}")
        language = "Korean" if self.lang == "한국어" else "English"
        self.chat = ProjectChat(self.body, self.folder, self.coder, self.reviewers, self.references,
                                language, CONFIG.parent, NAMES, self.full, self.show_usage, self.record_limits, self.colors)
        self.chat.input.insert("1.0", draft)
        self.root.update_idletasks()
        self.root.minsize(640, max(500, self.body.winfo_reqheight()))

    def save(self):
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({
            "language": self.lang, "folder": str(self.folder), "coder": self.coder,
            "appearance": self.appearance,
            "reviewers": self.reviewers, "full_access": self.full, "references": list(map(str, self.references)),
            "draft": self.chat.input.get("1.0", "end-1c"),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def dim_background(self):
        style = ttk.Style(self.root)
        saved = []
        shade = self.colors["shade"]

        def muted(color):
            return blend(color, shade)

        def dim(widget):
            kind = widget.winfo_class()
            options = {}
            if isinstance(widget, tk.Text):
                options = {key: muted(widget.cget(key)) for key in ("background", "foreground")}
                for tag in ("author", "user", "request", "code"):
                    if tag in widget.tag_names():
                        tag_colors = {key: widget.tag_cget(tag, key) for key in ("background", "foreground")}
                        tag_colors = {key: value for key, value in tag_colors.items() if value}
                        saved.append((widget, tag, tag_colors))
                        widget.tag_configure(tag, **{key: muted(value) for key, value in tag_colors.items()})
            elif kind in {"TFrame", "TLabel", "TButton", "TLabelframe", "Treeview"}:
                base = widget.cget("style") or kind
                backdrop = f"Backdrop.{base}"
                style.configure(backdrop,
                                background=muted(style.lookup(base, "background") or self.colors["window"]),
                                foreground=muted(style.lookup(base, "foreground") or self.colors["text"]),
                                fieldbackground=muted(self.colors["surface"]))
                if kind == "Treeview":
                    style.configure(backdrop, rowheight=style.lookup(base, "rowheight") or 22)
                    style.configure(f"{backdrop}.Heading", foreground=muted(self.colors["muted"]),
                                    background=muted(self.colors["subtle"]))
                if kind == "TLabelframe":
                    style.configure(f"{backdrop}.Label", background=muted(self.colors["window"]),
                                    foreground=muted(self.colors["muted"]))
                options = {"style": backdrop}
            if options:
                saved.append((widget, None, {key: widget.cget(key) for key in options}))
                widget.configure(**options)
            for child in widget.winfo_children():
                dim(child)

        dim(self.body)
        return saved

    def open_panel(self, title):
        if self.popup and self.popup.winfo_exists():
            self.popup.destroy()
        panel = self.popup = ttk.Frame(self.root, padding=14, relief="solid", borderwidth=1)
        backdrop = self.dim_background()

        def restore(event):
            if event.widget != panel:
                return
            for widget, tag, options in backdrop:
                if widget.winfo_exists():
                    if tag:
                        widget.tag_configure(tag, **options)
                    else:
                        widget.configure(**options)

        panel.bind("<Destroy>", restore, add="+")
        panel.bind("<Escape>", lambda _: panel.destroy())
        header = ttk.Frame(panel)
        header.pack(fill="x", pady=(0, 10))
        ttk.Label(header, text=title, font=(FONT, 12, "bold")).pack(side="left")
        ttk.Button(header, text=self.t("Close", "닫기"), command=panel.destroy).pack(side="right", padx=(12, 0))
        panel.place(relx=0.5, rely=0.5, anchor="center")
        panel.lift()
        panel.grab_set()
        panel.focus_set()
        return panel

    def settings(self):
        t = self.t
        if self.chat.busy or self.updating:
            messagebox.showinfo("Agent Council", t("Wait for the current turn to finish.", "현재 작업이 끝날 때까지 기다려 주세요."), parent=self.root)
            return
        dialog = self.open_panel(t("Settings", "설정"))
        panel = ttk.Frame(dialog)
        panel.pack(fill="both", expand=True)
        folder = tk.StringVar(value=str(self.folder))
        language = tk.StringVar(value=self.lang)
        appearances = {t("Light", "밝게"): "light", t("Dark", "어둡게"): "dark"}
        appearance = tk.StringVar(value=next(label for label, mode in appearances.items() if mode == self.appearance))
        no_coder = t("None (review only)", "없음 (검수 전용)")
        coder = tk.StringVar(value=NAMES.get(self.coder, no_coder))
        full = tk.BooleanVar(value=self.full)
        references = list(self.references)
        reviewers = {name: tk.BooleanVar(value=name in self.reviewers) for name in AGENTS}
        ttk.Label(panel, text=t("Project folder", "프로젝트 폴더")).grid(row=0, column=0, sticky="w")
        ttk.Entry(panel, textvariable=folder, width=38).grid(row=1, column=0, sticky="ew", pady=(3, 12))

        def browse():
            path = filedialog.askdirectory(parent=dialog, initialdir=folder.get())
            if path:
                folder.set(path)

        ttk.Button(panel, text=t("Browse", "찾아보기"), command=browse).grid(row=1, column=1, padx=(8, 0), sticky="n")
        roles = ttk.Frame(panel)
        roles.grid(row=2, columnspan=2, sticky="ew")
        ttk.Label(roles, text=t("Coding agent (optional)", "코딩 담당 AI (선택 사항)")).grid(row=0, column=0, sticky="w")
        picker = ttk.Combobox(roles, textvariable=coder, state="readonly", values=[no_coder, *[NAMES[n] for n in CODING_AGENTS]])
        picker.grid(row=1, column=0, sticky="w", padx=(0, 16), pady=3)
        ttk.Label(roles, text=t("Language", "언어")).grid(row=0, column=1, sticky="w")
        ttk.Combobox(roles, textvariable=language, state="readonly", values=("English", "한국어"), width=12).grid(row=1, column=1, sticky="w", pady=3)
        ttk.Label(roles, text=t("Appearance", "화면 모드")).grid(row=0, column=2, sticky="w", padx=(12, 0))
        ttk.Combobox(roles, textvariable=appearance, state="readonly", values=list(appearances), width=9).grid(
            row=1, column=2, sticky="w", padx=(12, 0), pady=3)
        ttk.Label(panel, text=t("Review agents (optional)", "검수 AI (선택 사항)")).grid(row=3, column=0, sticky="w", pady=(12, 3))
        choices = ttk.Frame(panel)
        choices.grid(row=4, columnspan=2, sticky="w")
        checks = {}
        for i, name in enumerate(AGENTS):
            check = ttk.Checkbutton(choices, text=NAMES[name], variable=reviewers[name])
            check.grid(row=i // 3, column=i % 3, sticky="w", padx=(0, 10))
            checks[name] = check
        full_check = ttk.Checkbutton(panel, text=t("Full execution access for the coding agent", "코딩 담당 AI에 전체 실행 권한 부여"),
                                     variable=full)
        full_check.grid(row=5, columnspan=2, sticky="w", pady=(10, 0))

        def sync_reviewers(*_):
            for name, check in checks.items():
                is_coder = NAMES[name] == coder.get()
                if is_coder:
                    reviewers[name].set(False)
                check.state(["disabled" if is_coder else "!disabled"])
            full_check.state(["disabled" if coder.get() == no_coder else "!disabled"])
            if coder.get() == no_coder:
                full.set(False)

        picker.bind("<<ComboboxSelected>>", sync_reviewers)
        sync_reviewers()

        ttk.Label(panel, text=t("Reference folders", "참고 폴더")).grid(row=6, columnspan=2, sticky="w", pady=(12, 3))
        folder_list = tk.Listbox(panel, height=3, selectmode="extended", font=(FONT, 9),
                                 background=self.colors["surface"], foreground=self.colors["text"],
                                 selectbackground=self.colors["selection"], selectforeground=self.colors["text"],
                                 highlightbackground=self.colors["line"], highlightcolor=self.colors["accent"],
                                 highlightthickness=1, borderwidth=0)
        folder_list.grid(row=7, column=0, sticky="ew")
        for reference in references:
            folder_list.insert("end", str(reference))
        reference_buttons = ttk.Frame(panel)
        reference_buttons.grid(row=7, column=1, padx=(8, 0), sticky="n")

        def add_reference():
            path = filedialog.askdirectory(parent=dialog, initialdir=folder.get())
            if path:
                reference = Path(path).resolve()
                if reference not in references:
                    references.append(reference)
                    folder_list.insert("end", str(reference))

        def remove_reference():
            for index in reversed(folder_list.curselection()):
                references.pop(index)
                folder_list.delete(index)

        ttk.Button(reference_buttons, text=t("Add", "추가"), command=add_reference).pack(fill="x")
        ttk.Button(reference_buttons, text=t("Remove", "제거"), command=remove_reference).pack(fill="x", pady=(4, 0))

        def apply():
            path = Path(folder.get().strip()).expanduser()
            if not folder.get().strip() or not path.is_dir():
                messagebox.showerror("Agent Council", t("Choose an existing folder.", "기존 폴더를 선택하세요."), parent=dialog)
                return
            path = path.resolve()
            selected_coder = next((name for name in CODING_AGENTS if NAMES[name] == coder.get()), None)
            selected_reviewers = [name for name in AGENTS if reviewers[name].get() and name != selected_coder]
            allow_full = bool(selected_coder and full.get())
            if allow_full and (not self.full or selected_coder != self.coder or path != self.folder):
                if not messagebox.askyesno(
                    "Agent Council",
                    t("Allow the coding agent to bypass CLI permission checks using your account's permissions?",
                      "코딩 담당 AI가 현재 계정 권한으로 CLI 권한 확인을 건너뛰도록 허용할까요?"),
                    parent=dialog,
                ):
                    return
            draft = self.chat.input.get("1.0", "end-1c") if path == self.folder else ""
            if self.usage_dialog and self.usage_dialog.winfo_exists():
                self.usage_dialog.destroy()
            dialog.destroy()
            self.chat.close()
            self.folder, self.coder, self.reviewers, self.lang = path, selected_coder, selected_reviewers, language.get()
            self.references = [reference for reference in references if reference != path]
            self.full = allow_full
            self.appearance = appearances[appearance.get()]
            self.colors = install(self.root, self.appearance)
            self.build_chat(draft)
            self.save()
            self.chat.input.focus_set()

        ttk.Button(panel, text=t("Save settings", "설정 저장"), command=apply, style="Primary.TButton").grid(
            row=8, columnspan=2, sticky="e", pady=(14, 0))

    def show_usage(self):
        t = self.t
        if self.usage_dialog and self.usage_dialog.winfo_exists():
            self.usage_dialog.lift()
            return
        dialog = self.usage_dialog = self.open_panel(t("Usage", "사용량"))
        ttk.Label(dialog, text=t("Project tokens and account limits", "프로젝트 토큰 및 계정 한도"),
                  font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.usage_table = table = ttk.Treeview(dialog, columns=("agent", "input", "output", "limits"),
                                                show="headings", height=len(AGENTS), selectmode="browse")
        for column, label, width, anchor in (
            ("agent", t("Agent", "에이전트"), 117, "w"),
            ("input", t("Input tokens", "입력 토큰"), 85, "e"),
            ("output", t("Output tokens", "출력 토큰"), 85, "e"),
            ("limits", t("Account limit remaining", "계정 한도 잔여량"), 215, "w"),
        ):
            table.heading(column, text=label, anchor=anchor)
            table.column(column, width=width, anchor=anchor)
        for name in AGENTS:
            table.insert("", "end", iid=name)
        table.pack(fill="x", pady=(5, 3))
        table.selection_set("codex")
        table.bind("<<TreeviewSelect>>", lambda _: self.render_limit_detail())
        ttk.Label(dialog, text=t("Select an agent for details. — means unavailable.",
                                  "에이전트를 선택하면 상세 정보를 볼 수 있습니다. —는 조회할 수 없는 값입니다."),
                  wraplength=500).pack(anchor="w")
        ttk.Separator(dialog).pack(fill="x", pady=8)
        self.limit_title = ttk.Label(dialog, font=("Segoe UI", 10, "bold"))
        self.limit_title.pack(anchor="w")
        section = ttk.Frame(dialog)
        section.pack(fill="x", pady=(4, 0))
        self.limit_table = ttk.Treeview(section, columns=("window", "used", "remaining", "reset"), show="headings", height=2)
        for column, label, width, anchor in (
            ("window", t("Window", "한도"), 235, "w"),
            ("used", t("Used", "사용"), 65, "e"),
            ("remaining", t("Left", "남음"), 65, "e"),
            ("reset", t("Resets", "초기화"), 120, "e"),
        ):
            self.limit_table.heading(column, text=label, anchor=anchor)
            self.limit_table.column(column, width=width, anchor=anchor)
        scroll = ttk.Scrollbar(section, command=self.limit_table.yview)
        scroll.pack(side="right", fill="y")
        self.limit_table.configure(yscrollcommand=scroll.set)
        self.limit_table.pack(fill="x")
        self.limit_label = ttk.Label(dialog, wraplength=500, justify="left")
        self.limit_label.pack(fill="x", pady=5)
        actions = ttk.Frame(dialog)
        actions.pack(fill="x")
        self.provider_button = ttk.Button(actions, command=self.open_usage_link)
        self.provider_button.pack(side="left")
        self.limit_button = ttk.Button(actions, text=t("Refresh available limits", "조회 가능한 한도 새로고침"),
                                       command=self.refresh_limits)
        self.limit_button.pack(side="right")
        self.refresh_limits()
        self.render_usage()

    def refresh_limits(self):
        for name, lookup in (("codex", codex_rate_limits), ("agy", antigravity_rate_limits)):
            if name not in self.usage_fetching:
                self.usage_fetching.add(name)
                self.limit_errors.pop(name, None)
                self.background(f"limits:{name}", lambda lookup=lookup, folder=self.folder: lookup(folder))
        self.render_usage()

    def record_limits(self, name, result):
        self.account_limits[name] = result
        self.render_usage()

    def limit_windows(self, name):
        t = self.t
        result = self.account_limits.get(name)
        windows = []
        if name == "codex" and result:
            limits = result.get("rateLimits") or {}
            for key in ("primary", "secondary"):
                window = limits.get(key) or {}
                minutes = window.get("windowDurationMins")
                if minutes == 10080:
                    label = t("Weekly", "주간")
                elif minutes and minutes % 60 == 0:
                    label = t(f"{minutes // 60} hours", f"{minutes // 60}시간")
                else:
                    label = t(f"{minutes} min", f"{minutes}분") if minutes else t("Usage limit", "사용 한도")
                windows.append((label, window.get("usedPercent"), window.get("resetsAt")))
        elif name == "claude" and result:
            reported = result.get("unifiedWindows") or {result.get("rateLimitType"): result}
            labels = {"five_hour": t("5 hours", "5시간"), "seven_day": t("Weekly", "주간")}
            for key, window in reported.items():
                utilization = window.get("utilization")
                reset = window.get("resetsAt")
                if key and isinstance(utilization, (int, float)) and (not reset or reset > datetime.now().timestamp()):
                    windows.append((labels.get(key, key), 100 * utilization, reset))
        elif name == "agy" and result:
            for group in result:
                for bucket in group.get("buckets", []):
                    remaining = bucket.get("remaining_fraction")
                    if not isinstance(remaining, (int, float)):
                        continue
                    window = t("Weekly", "주간") if bucket.get("window") == "weekly" else bucket.get("name", "")
                    windows.append((f"{group['name']} · {window}", 100 * (1 - remaining), bucket.get("reset_time")))
        return [(label, min(100, max(0, used)), reset) for label, used, reset in windows if isinstance(used, (int, float))]

    def render_usage(self):
        if not self.usage_dialog or not self.usage_dialog.winfo_exists():
            return
        t = self.t
        for name in AGENTS:
            windows = self.limit_windows(name)
            if name in self.usage_fetching:
                summary = t("Checking…", "확인 중…")
            elif windows:
                summary = "  /  ".join(f"{100 - used:.0f}%" for _, used, _ in windows)
            elif name == "claude":
                summary = t("Awaiting CLI report", "CLI 보고 대기")
            elif name in USAGE_LINKS:
                summary = t("Check provider", "제공자에서 확인")
            else:
                summary = "—"
            self.usage_table.item(name, values=(NAMES[name], *self.chat.token_values(name), summary))
        self.limit_button.state(["disabled" if self.usage_fetching else "!disabled"])
        self.render_limit_detail()

    def render_limit_detail(self):
        selection = self.usage_table.selection()
        if not selection:
            return
        name = selection[0]
        t = self.t
        self.limit_title.configure(text=NAMES[name])
        self.limit_table.delete(*self.limit_table.get_children())
        for label, used, reset in self.limit_windows(name):
            try:
                reset = (datetime.fromisoformat(reset.replace("Z", "+00:00")).astimezone()
                         if isinstance(reset, str) else datetime.fromtimestamp(reset))
                reset_text = reset.strftime("%m-%d %H:%M")
            except (TypeError, ValueError, OSError, OverflowError):
                reset_text = "—"
            self.limit_table.insert("", "end", values=(label, f"{used:.0f}%", f"{100 - used:.0f}%", reset_text))
        hints = {
            "claude": t("Shows the last limit report from a Claude Code turn in this app. For current limits, see Claude settings.",
                        "이 앱에서 Claude Code가 마지막으로 보고한 한도입니다. 현재 한도는 Claude 설정에서 확인하세요."),
            "agy": t("Model groups share limits. To check in the CLI, use /usage.",
                     "모델 그룹별로 한도를 공유합니다. CLI에서도 /usage로 확인할 수 있습니다."),
            "grok": t("Open Usage in the Grok dashboard for your account limits.",
                      "Grok 대시보드의 사용량 메뉴에서 계정 한도를 확인하세요."),
            "agent": t("Open the Cursor usage dashboard for your account limits.",
                       "Cursor 사용량 대시보드에서 계정 한도를 확인하세요."),
            "gemini": t("Use /stats in Gemini CLI to view model usage and supported quotas.",
                        "Gemini CLI에서 /stats로 모델 사용량과 제공되는 한도를 확인하세요."),
        }
        status = hints.get(name, "")
        if name in self.usage_fetching:
            status = t("Reading account limits…", "계정 한도 확인 중…")
        elif name in self.limit_errors:
            status = t("Could not read limits: ", "한도 조회 실패: ") + self.limit_errors[name]
        elif name == "codex":
            limits = (self.account_limits.get(name) or {}).get("rateLimits") or {}
            balance = (limits.get("credits") or {}).get("balance")
            status = t(f"Credits · {balance}", f"크레딧 · {balance}") if balance is not None else status
        self.limit_label.configure(text=status)
        self.provider_button.configure(text=t("How to check", "확인 방법") if name == "gemini" else t("Open provider usage", "제공자 사용량 열기"))
        self.provider_button.state(["!disabled" if name in USAGE_LINKS else "disabled"])

    def open_usage_link(self):
        selection = self.usage_table.selection()
        if selection and selection[0] in USAGE_LINKS:
            webbrowser.open(USAGE_LINKS[selection[0]])

    def update(self):
        if self.chat.busy:
            messagebox.showinfo("Agent Council", self.t("Wait for the current turn to finish.", "현재 작업이 끝날 때까지 기다려 주세요."), parent=self.root)
            return
        self.updating = True
        self.chat.pause(True)
        self.update_button.configure(text=self.t("Checking…", "확인 중…"))
        self.update_button.state(["disabled"])
        self.background("available", check_update)

    def finish_update(self):
        self.updating = False
        self.chat.pause(False)
        self.update_button.configure(text=self.t("Check for updates", "업데이트 확인"))
        self.update_button.state(["!disabled"])

    def background(self, kind, operation):
        def worker():
            try:
                self.events.put((kind, operation()))
            except Exception as exc:
                self.events.put((kind.replace("limits:", "limits_error:") if kind.startswith("limits:") else "update_error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()

    def close(self):
        if self.chat.busy or self.updating:
            messagebox.showinfo("Agent Council", self.t("Wait for the current operation to finish.", "현재 작업이 끝날 때까지 기다려 주세요."))
            return
        self.save()
        self.root.destroy()

    def poll(self):
        t = self.t
        if self.usage_dialog and self.usage_dialog.winfo_exists():
            for name in AGENTS:
                for column, count in zip(("input", "output"), self.chat.token_values(name)):
                    self.usage_table.set(name, column, count)
        while not self.events.empty():
            kind, value = self.events.get()
            if kind.startswith(("limits:", "limits_error:")):
                event, name = kind.split(":", 1)
                self.usage_fetching.discard(name)
                if event == "limits":
                    self.account_limits[name] = value
                else:
                    self.limit_errors[name] = value
                self.render_usage()
            elif kind == "available" and value:
                version, asset = value
                if messagebox.askyesno("Agent Council", t(f"Install {version} and restart Agent Council?",
                                                         f"{version}을 설치하고 Agent Council을 다시 시작할까요?"), parent=self.root):
                    self.update_button.configure(text=t("Downloading…", "다운로드 중…"))
                    self.background("downloaded", lambda: download_update(asset))
                    continue
                self.finish_update()
            elif kind == "downloaded":
                try:
                    self.save()
                    restart_with_update(value, Path(sys.executable), os.getpid(),
                                        t("Agent Council update failed", "Agent Council 업데이트 실패"))
                except Exception as exc:
                    value.unlink(missing_ok=True)
                    self.finish_update()
                    messagebox.showerror("Agent Council", str(exc), parent=self.root)
                else:
                    self.root.destroy()
                    return
            else:
                self.finish_update()
                if kind == "update_error":
                    messagebox.showerror("Agent Council", value, parent=self.root)
                else:
                    messagebox.showinfo("Agent Council", t("You are up to date.", "최신 버전입니다."), parent=self.root)
        self.root.after(200, self.poll)


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
