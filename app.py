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

VERSION = "2.0.0"
REPO = "jwjp/agent-council"
ASSET = "AgentCouncil.exe"
CONFIG = Path(os.getenv("LOCALAPPDATA", Path.home())) / "AgentCouncil" / "settings.json"
NAMES = dict(zip(AGENTS, ("Codex", "Claude Code", "Antigravity", "Grok", "Cursor Agent", "Gemini CLI")))
AGENT_BADGES = dict(zip(AGENTS, ("CX", "CL", "AG", "GK", "CU", "GM")))
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
        self.permissions = config.get("permissions", "coder" if config.get("full_access") else "restricted")
        if self.permissions not in {"restricted", "coder", "all"} or self.folder != folder.resolve():
            self.permissions = "restricted"
        root.title(f"Agent Council {VERSION}")
        root.geometry("1060x760")
        root.minsize(640, 500)
        self.body = ttk.Frame(root, padding=(16, 8))
        self.body.pack(fill="both", expand=True)
        self.header = ttk.Frame(self.body)
        self.header.pack(fill="x")
        self.menu_button = ttk.Button(self.header, text="☰", width=3, style="Icon.TButton", command=self.open_menu)
        self.menu_button.pack(side="left", padx=(0, 5))
        ttk.Label(self.header, text="Agent Council", font=(FONT, 13, "bold")).pack(side="left")
        ttk.Label(self.header, text=VERSION, style="Muted.TLabel", font=(FONT, 8)).pack(side="left", padx=(7, 12))
        self.folder_label = ttk.Button(self.header, style="Breadcrumb.TButton",
                                       command=lambda: self.settings(workspace_tab=True), width=1)
        self.folder_label.pack(side="left", fill="x", expand=True)
        self.app_status = ttk.Label(self.header, style="Muted.TLabel", font=(FONT, 8))
        self.app_status.pack(side="right")
        self.app_menu = tk.Menu(root, tearoff=False)
        ttk.Separator(self.body).pack(fill="x", pady=(7, 0))
        self.create_usage_bar()
        self.chat = None
        self.build_chat(config.get("draft", ""))
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(200, self.poll)
        root.after(500, self.refresh_limits)
        root.bind("<Control-comma>", lambda _: self.settings())

    def t(self, english, korean):
        return korean if self.lang == "한국어" else english

    def rebuild_menu(self):
        menu = self.app_menu
        menu.configure(background=self.colors["surface"], foreground=self.colors["text"],
                       activebackground=self.colors["selection"], activeforeground=self.colors["text"],
                       borderwidth=0, font=(FONT, 9))
        menu.delete(0, "end")
        menu.add_command(label=self.t("Settings", "설정"), accelerator="Ctrl+,",
                         command=lambda: self.root.after_idle(self.settings))
        menu.add_command(label=self.t("Usage", "사용량"), accelerator="/usage",
                         command=lambda: self.root.after_idle(self.show_usage))
        menu.add_separator()
        menu.add_command(label=self.t("Check for updates", "업데이트 확인"),
                         command=lambda: self.root.after_idle(self.update), state="disabled" if self.updating else "normal")
        self.update_menu_index = menu.index("end")
        menu.add_command(label=self.t("About Agent Council", "Agent Council 정보"),
                         command=lambda: messagebox.showinfo("Agent Council", f"Agent Council {VERSION}", parent=self.root))
        menu.add_separator()
        menu.add_command(label=self.t("Quit", "종료"), command=lambda: self.root.after_idle(self.close))

    def open_menu(self):
        try:
            self.app_menu.tk_popup(self.menu_button.winfo_rootx(),
                                   self.menu_button.winfo_rooty() + self.menu_button.winfo_height() + 3)
        finally:
            self.app_menu.grab_release()

    def create_usage_bar(self):
        bar = self.usage_bar = ttk.Frame(self.body, padding=(0, 3))
        bar.pack(side="bottom", fill="x", pady=(3, 0))
        self.usage_button = ttk.Button(bar, style="Status.TButton", command=self.show_usage)
        self.usage_button.grid(row=0, column=0, padx=(0, 3))
        self.usage_badges = {}
        self.usage_bars = {}
        for column, name in enumerate(AGENTS, 1):
            cell = ttk.Frame(bar)
            cell.grid(row=0, column=column, sticky="nsew", padx=3)
            button = ttk.Button(cell, width=1, style="Status.TButton", command=lambda name=name: self.show_usage(name))
            meter = tk.Canvas(cell, width=20, height=4, highlightthickness=0, borderwidth=0,
                              background=self.colors["window"])
            meter.create_line(2, 2, 18, 2, width=3, capstyle="round", fill=self.colors["line"], tags="track")
            meter.create_line(2, 2, 2, 2, width=3, capstyle="round", fill=self.colors["accent"], tags="used")
            meter.pack(side="left", padx=(0, 2))
            button.pack(side="left", fill="x", expand=True)
            bar.columnconfigure(column, weight=1, uniform="usage")
            self.usage_badges[name] = button
            self.usage_bars[name] = meter
        self.usage_refresh = ttk.Button(bar, text="↻", width=3, style="Status.TButton", command=self.refresh_limits)
        self.usage_refresh.grid(row=0, column=len(AGENTS) + 1, padx=(3, 0))
        bar.bind("<Configure>", lambda _: self.refresh_usage_bar())

    @staticmethod
    def reset_in(value):
        try:
            reset = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() if isinstance(value, str) else value
            seconds = max(0, int(reset - datetime.now().timestamp()))
        except (AttributeError, TypeError, ValueError, OverflowError):
            return ""
        if seconds >= 86400:
            return f"{seconds // 86400}d {seconds % 86400 // 3600}h"
        if seconds >= 3600:
            return f"{seconds // 3600}h {seconds % 3600 // 60}m"
        return f"{max(1, seconds // 60)}m"

    def refresh_usage_bar(self):
        short = self.usage_bar.winfo_width() < 770
        labels = ("Codex", "Claude", "AGY", "Grok", "Cursor", "Gemini")
        for name, title in zip(AGENTS, labels):
            self.usage_bars[name].configure(background=self.colors["window"])
            self.usage_bars[name].itemconfigure("track", fill=self.colors["line"])
            windows = self.limit_windows(name)
            reset = ""
            if windows:
                _, used, resets = max(windows, key=lambda item: item[1])
                amount = f"{used:.0f}%"
                meter = self.usage_bars[name]
                meter.coords("used", 2, 2, 2 + 16 * min(100, max(0, used)) / 100, 2)
                meter.itemconfigure("used", fill=self.colors["error"] if used >= 85 else self.colors["accent"])
                if not self.usage_bars[name].winfo_manager():
                    self.usage_bars[name].pack(side="left", before=self.usage_badges[name], padx=(0, 2))
                if not short:
                    reset = self.reset_in(resets)
            else:
                self.usage_bars[name].pack_forget()
                totals = self.chat.usage.get(name, {}) if getattr(self, "chat", None) else {}
                count = sum(totals.get(key, 0) for key in ("input_tokens", "output_tokens"))
                amount = (f"{count / 1000:.1f}k" if count >= 1000 else str(count)) + "t" if totals else "—"
            text = f"{AGENT_BADGES[name] if short else title}  {amount}" + (f" · {reset}" if reset else "")
            if self.usage_badges[name].cget("text") != text:
                self.usage_badges[name].configure(text=text)
        label = self.t("Usage", "사용량")
        if self.usage_button.cget("text") != label:
            self.usage_button.configure(text=label)
        self.usage_refresh.state(["disabled" if self.usage_fetching else "!disabled"])

    def build_chat(self, draft=""):
        self.rebuild_menu()
        refs = f"  +{len(self.references)}" if self.references else ""
        self.folder_label.configure(text=f"▱  {self.folder.name or str(self.folder)}{refs}  ⌄")
        scopes = {"restricted": self.t("Standard", "기본 권한"),
                  "coder": self.t("Coder · full access", "코더 · 전체 액세스"),
                  "all": self.t("All agents · full access", "모든 AI · 전체 액세스")}
        self.app_status.configure(text=scopes[self.permissions])
        language = "Korean" if self.lang == "한국어" else "English"
        self.chat = ProjectChat(self.body, self.folder, self.coder, self.reviewers, self.references,
                                language, CONFIG.parent, NAMES, self.permissions, self.show_usage, self.record_limits, self.colors)
        self.chat.input.insert("1.0", draft)
        self.root.update_idletasks()
        self.root.minsize(640, max(500, self.body.winfo_reqheight()))
        self.refresh_usage_bar()

    def save(self):
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({
            "language": self.lang, "folder": str(self.folder), "coder": self.coder,
            "appearance": self.appearance,
            "reviewers": self.reviewers, "permissions": self.permissions, "references": list(map(str, self.references)),
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
                for tag in ("author", "user", "request", "md_quote", "md_code", "md_inline", "md_link", "md_rule"):
                    if tag in widget.tag_names():
                        tag_colors = {key: widget.tag_cget(tag, key) for key in ("background", "foreground")}
                        tag_colors = {key: value for key, value in tag_colors.items() if value}
                        saved.append((widget, tag, tag_colors))
                        widget.tag_configure(tag, **{key: muted(value) for key, value in tag_colors.items()})
            elif isinstance(widget, (tk.Frame, tk.Label, tk.Canvas)):
                keys = ("background", "foreground") if isinstance(widget, tk.Label) else ("background",)
                options = {key: muted(widget.cget(key)) for key in keys}
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

    def open_panel(self, title, *, footer=False):
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
        viewport = ttk.Frame(panel)
        viewport.pack(fill="both", expand=True)
        canvas = tk.Canvas(viewport, background=self.colors["window"], highlightthickness=0, borderwidth=0)
        canvas.pack(side="left", fill="both", expand=True)
        scroll = ttk.Scrollbar(viewport, command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        content = panel.content = ttk.Frame(canvas)
        window = canvas.create_window(0, 0, anchor="nw", window=content)
        wheel_tag = f"PanelWheel{panel}"

        def wheel(event):
            if content.winfo_reqheight() > canvas.winfo_height():
                canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")
                return "break"

        panel.bind_class(wheel_tag, "<MouseWheel>", wheel)

        def fit(_event=None):
            if _event is not None and _event.widget not in {self.root, content}:
                return
            if not panel.winfo_exists():
                return
            available = max(180, self.root.winfo_height() - 32)
            fixed = 30
            for child in panel.pack_slaves():
                if child != viewport:
                    padding = child.pack_info().get("pady", 0)
                    padding = sum(map(int, padding)) if isinstance(padding, tuple) else 2 * int(padding)
                    fixed += child.winfo_reqheight() + padding
            height = min(content.winfo_reqheight(), max(90, available - fixed))
            overflow = content.winfo_reqheight() > height
            if overflow:
                scroll.pack(side="right", fill="y")
            else:
                scroll.pack_forget()
            width = min(content.winfo_reqwidth(), self.root.winfo_width() - 62 - (scroll.winfo_reqwidth() if overflow else 0))
            canvas.configure(width=width, height=height, scrollregion=(0, 0, width, content.winfo_reqheight()))
            canvas.itemconfigure(window, width=width)
            if footer:
                y = self.usage_bar.winfo_rooty() - self.root.winfo_rooty() - 5
                panel.place(relx=0, rely=0, x=16, y=max(fixed + height + 16, y), anchor="sw")
            else:
                panel.place(relx=0.5, rely=0.5, anchor="center")

            def bind_wheel(widget):
                if widget.winfo_class() not in {"Text", "Treeview", "Listbox", "TCombobox"}:
                    tags = widget.bindtags()
                    if wheel_tag not in tags:
                        widget.bindtags((tags[0], wheel_tag, *tags[1:]))
                for child in widget.winfo_children():
                    bind_wheel(child)
            bind_wheel(content)

        content.bind("<Configure>", fit)
        resize_binding = self.root.bind("<Configure>", fit, add="+")

        def cleanup(event):
            if event.widget == panel:
                self.root.unbind("<Configure>", resize_binding)
                panel.unbind_class(wheel_tag, "<MouseWheel>")

        panel.bind("<Destroy>", cleanup, add="+")
        panel.place(relx=0.5, rely=0.5, anchor="center")
        panel.after_idle(fit)
        panel.lift()
        panel.grab_set()
        panel.focus_set()
        return panel

    def settings(self, workspace_tab=False):
        t = self.t
        if self.chat.busy or self.updating:
            messagebox.showinfo("Agent Council", t("Wait for the current turn to finish.", "현재 작업이 끝날 때까지 기다려 주세요."), parent=self.root)
            return
        dialog = self.open_panel(t("Settings", "설정"))
        notebook = ttk.Notebook(dialog.content)
        notebook.pack(fill="both", expand=True)
        agents_page = ttk.Frame(notebook, padding=12)
        workspace = ttk.Frame(notebook, padding=12)
        notebook.add(agents_page, text=t("Agents", "에이전트"))
        notebook.add(workspace, text=t("Workspace", "워크스페이스"))
        if workspace_tab:
            notebook.select(workspace)

        folder = tk.StringVar(value=str(self.folder))
        language = tk.StringVar(value=self.lang)
        appearances = {t("Light", "밝게"): "light", t("Dark", "어둡게"): "dark"}
        appearance = tk.StringVar(value=next(label for label, mode in appearances.items() if mode == self.appearance))
        coder = tk.StringVar(value=self.coder or "")
        references = list(self.references)
        reviewers = {name: tk.BooleanVar(value=name in self.reviewers) for name in AGENTS}
        scopes = {
            t("Standard permissions", "기본 권한"): "restricted",
            t("Full access · coding agent only", "전체 액세스 · 코더만"): "coder",
            t("Full access · all agents", "전체 액세스 · 모든 에이전트"): "all",
        }
        access = tk.StringVar(value=next(label for label, scope in scopes.items() if scope == self.permissions))
        installed = {name: bool(shutil.which(name)) for name in AGENTS}

        ttk.Label(agents_page, text=t("Default coding agent", "기본 코딩 에이전트"), font=(FONT, 11, "bold")).pack(anchor="w")
        ttk.Label(agents_page, text=t("Handles the request and makes changes when asked.",
                                      "요청을 수행하고, 변경이 필요한 경우 직접 수정합니다."),
                  style="Muted.TLabel").pack(anchor="w", pady=(2, 7))
        choices = ttk.Frame(agents_page)
        choices.pack(fill="x")
        for index, name in enumerate(CODING_AGENTS + ("",)):
            label = f"{AGENT_BADGES[name]}  {NAMES[name]}" if name else t("Review only", "검수 전용")
            row, column = divmod(index, 3)
            choices.columnconfigure(column, weight=1, uniform="agent")
            ttk.Radiobutton(choices, text=label, variable=coder, value=name,
                            style="AgentChip.TRadiobutton").grid(row=row, column=column, sticky="ew", padx=(0, 4), pady=(0, 4))

        review_header = ttk.Frame(agents_page)
        review_header.pack(fill="x", pady=(12, 6))
        ttk.Label(review_header, text=t("Selected reviewers", "선택한 검수 에이전트"),
                  font=(FONT, 11, "bold")).pack(side="left")
        count_label = ttk.Label(review_header, style="Muted.TLabel")
        count_label.pack(side="right")
        cards = ttk.Frame(agents_page)
        cards.pack(fill="x")
        controls = {}

        def sync_reviewers(*_):
            for name, (card, check, status) in controls.items():
                is_coder = name == coder.get()
                if is_coder:
                    reviewers[name].set(False)
                check.state(["disabled" if is_coder else "!disabled"])
                selected = reviewers[name].get()
                card.configure(style="Selected.Card.TFrame" if selected else "Card.TFrame")
                check.configure(style="Selected.Agent.TCheckbutton" if selected else "Agent.TCheckbutton")
                status.configure(style="Selected.TLabel" if selected else "Surface.Muted.TLabel",
                                 text=t("Default agent", "기본 에이전트") if is_coder else
                                 t("CLI detected", "CLI 감지됨") if installed[name] else t("CLI not found", "CLI 미감지"))
            count = sum(var.get() for var in reviewers.values())
            count_label.configure(text=t(f"{count} selected", f"{count}개 선택"))

        for index, name in enumerate(AGENTS):
            row, column = divmod(index, 3)
            cards.columnconfigure(column, weight=1, uniform="review")
            card = ttk.Frame(cards, style="Card.TFrame", padding=(7, 3))
            card.grid(row=row, column=column, sticky="nsew", padx=(0, 4), pady=(0, 4))
            check = ttk.Checkbutton(card, text=f"{AGENT_BADGES[name]}  {NAMES[name]}", variable=reviewers[name],
                                    command=sync_reviewers, style="Agent.TCheckbutton")
            check.pack(anchor="w")
            status = ttk.Label(card, style="Surface.Muted.TLabel")
            status.pack(anchor="w")
            controls[name] = card, check, status

        coder.trace_add("write", sync_reviewers)
        sync_reviewers()
        ttk.Separator(agents_page).pack(fill="x", pady=(9, 8))
        permission_row = ttk.Frame(agents_page)
        permission_row.pack(fill="x")
        ttk.Label(permission_row, text=t("Permissions", "권한"), font=(FONT, 10, "bold")).pack(side="left")
        ttk.Combobox(permission_row, textvariable=access, state="readonly", values=list(scopes), width=29).pack(side="right")
        ttk.Label(agents_page, text=t("Full access skips CLI approvals for the selected scope.",
                                      "전체 액세스는 선택한 범위에서 CLI 승인 확인을 건너뜁니다."),
                  style="Muted.TLabel").pack(anchor="w", pady=(5, 0))

        workspace.columnconfigure(0, weight=1)
        ttk.Label(workspace, text=t("Project folder", "프로젝트 폴더"), font=(FONT, 10, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Entry(workspace, textvariable=folder, width=38).grid(row=1, column=0, sticky="ew", pady=(4, 12))

        def browse():
            path = filedialog.askdirectory(parent=dialog, initialdir=folder.get())
            if path:
                folder.set(path)

        ttk.Button(workspace, text=t("Browse", "찾아보기"), command=browse).grid(row=1, column=1, padx=(8, 0), sticky="n")
        display = ttk.Frame(workspace)
        display.grid(row=2, columnspan=2, sticky="w", pady=(0, 12))
        ttk.Label(display, text=t("Language", "언어")).grid(row=0, column=0, sticky="w")
        ttk.Label(display, text=t("Appearance", "화면 모드")).grid(row=0, column=1, sticky="w")
        ttk.Combobox(display, textvariable=language, state="readonly", values=("English", "한국어"), width=13).grid(
            row=1, column=0, sticky="w", padx=(0, 10), pady=4)
        ttk.Combobox(display, textvariable=appearance, state="readonly", values=list(appearances), width=10).grid(
            row=1, column=1, sticky="w", pady=4)
        ttk.Label(workspace, text=t("Reference folders", "참고 폴더"), font=(FONT, 10, "bold")).grid(row=3, column=0, sticky="w")
        folder_list = tk.Listbox(workspace, height=4, selectmode="extended", font=(FONT, 9),
                                 background=self.colors["surface"], foreground=self.colors["text"],
                                 selectbackground=self.colors["selection"], selectforeground=self.colors["text"],
                                 highlightbackground=self.colors["line"], highlightcolor=self.colors["accent"],
                                 highlightthickness=1, borderwidth=0)
        folder_list.grid(row=4, column=0, sticky="ew", pady=(4, 0))
        for reference in references:
            folder_list.insert("end", str(reference))
        reference_buttons = ttk.Frame(workspace)
        reference_buttons.grid(row=4, column=1, padx=(8, 0), sticky="n")

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
                notebook.select(workspace)
                messagebox.showerror("Agent Council", t("Choose an existing folder.", "기존 폴더를 선택하세요."), parent=dialog)
                return
            path = path.resolve()
            selected_coder = coder.get() or None
            selected_reviewers = [name for name in AGENTS if reviewers[name].get() and name != selected_coder]
            scope = scopes[access.get()]
            if scope == "coder" and not selected_coder:
                scope = "restricted"
            changed = scope != self.permissions or path != self.folder or selected_coder != self.coder
            changed = changed or (scope == "all" and selected_reviewers != self.reviewers)
            if scope != "restricted" and changed:
                message = (t("All selected agents can bypass CLI permission checks, including during review and conference. Continue?",
                             "선택한 모든 에이전트가 검수·회의 중에도 CLI 권한 확인을 건너뛸 수 있습니다. 적용할까요?")
                           if scope == "all" else
                           t("Allow the coding agent to bypass CLI permission checks?",
                             "코딩 담당 AI가 CLI 권한 확인을 건너뛰도록 허용할까요?"))
                if not messagebox.askyesno("Agent Council", message, parent=dialog):
                    return
            draft = self.chat.input.get("1.0", "end-1c") if path == self.folder else ""
            dialog.destroy()
            self.chat.close()
            self.folder, self.coder, self.reviewers, self.lang = path, selected_coder, selected_reviewers, language.get()
            self.references = [reference for reference in references if reference != path]
            self.permissions = scope
            self.appearance = appearances[appearance.get()]
            self.colors = install(self.root, self.appearance)
            self.build_chat(draft)
            self.save()
            self.chat.input.focus_set()

        ttk.Button(dialog, text=t("Save settings", "설정 저장"), command=apply, style="Primary.TButton").pack(
            anchor="e", pady=(12, 0))

    def show_usage(self, agent=None):
        t = self.t
        chosen = agent or "codex"
        if self.usage_dialog and self.usage_dialog.winfo_exists():
            self.usage_table.selection_set(chosen)
            self.render_limit_detail()
            self.usage_notebook.select(self.usage_details if agent else self.usage_summary)
            self.usage_dialog.lift()
            return
        dialog = self.usage_dialog = self.open_panel(t("Usage", "사용량"), footer=True)
        self.usage_notebook = notebook = ttk.Notebook(dialog.content)
        notebook.pack(fill="both", expand=True)
        self.usage_summary = summary_page = ttk.Frame(notebook, padding=(8, 8))
        self.usage_details = detail = ttk.Frame(notebook, padding=(8, 8))
        notebook.add(summary_page, text=t("Summary", "요약"))
        notebook.add(detail, text=t("Details", "상세"))
        self.summary_rows = {}

        def show_provider(name):
            self.usage_table.selection_set(name)
            self.render_limit_detail()
            notebook.select(detail)

        ttk.Label(summary_page, text=t("Account usage", "계정 사용량"), font=(FONT, 10, "bold")).pack(anchor="w", pady=(0, 6))
        for name in AGENTS:
            card = ttk.Frame(summary_page, style="Card.TFrame", padding=(9, 5))
            card.pack(fill="x", pady=(0, 4))
            tk.Label(card, text=AGENT_BADGES[name], font=(FONT, 9, "bold"), padx=5, pady=4,
                     background=self.colors["selection"], foreground=self.colors["accent"]).pack(side="left", padx=(0, 9))
            caption = ttk.Frame(card, style="Surface.TFrame")
            caption.pack(side="left", fill="x", expand=True)
            ttk.Label(caption, text=NAMES[name], style="Surface.TLabel", font=(FONT, 9, "bold")).pack(anchor="w")
            metric = ttk.Label(caption, style="Surface.Muted.TLabel", wraplength=260)
            metric.pack(anchor="w")
            ttk.Button(card, text="›", width=2, command=lambda name=name: show_provider(name),
                       style="Status.TButton").pack(side="right")
            self.summary_rows[name] = metric
        ttk.Label(summary_page, text=t("Percentages show used quota. Token totals end in t.",
                                       "%는 한도 사용률, t는 프로젝트 토큰 누계입니다."),
                  style="Muted.TLabel", wraplength=300).pack(anchor="w", pady=(4, 0))
        ttk.Label(detail, text=t("Project tokens and account limits", "프로젝트 토큰 및 계정 한도"),
                  font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.usage_table = table = ttk.Treeview(detail, columns=("agent", "input", "output", "limits"),
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
        table.selection_set(chosen)
        table.bind("<<TreeviewSelect>>", lambda _: self.render_limit_detail())
        ttk.Label(detail, text=t("Select an agent for details. — means unavailable.",
                                  "에이전트를 선택하면 상세 정보를 볼 수 있습니다. —는 조회할 수 없는 값입니다."),
                  wraplength=500).pack(anchor="w")
        ttk.Separator(detail).pack(fill="x", pady=8)
        self.limit_title = ttk.Label(detail, font=("Segoe UI", 10, "bold"))
        self.limit_title.pack(anchor="w")
        section = ttk.Frame(detail)
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
        self.limit_label = ttk.Label(detail, wraplength=500, justify="left")
        self.limit_label.pack(fill="x", pady=5)
        actions = ttk.Frame(detail)
        actions.pack(fill="x")
        self.provider_button = ttk.Button(actions, command=self.open_usage_link)
        self.provider_button.pack(side="left")
        self.limit_button = ttk.Button(actions, text=t("Refresh available limits", "조회 가능한 한도 새로고침"),
                                       command=self.refresh_limits)
        self.limit_button.pack(side="right")
        notebook.select(detail if agent else summary_page)

        def size_selected_page(_event=None):
            page = self.root.nametowidget(notebook.select())
            notebook.configure(width=page.winfo_reqwidth(), height=page.winfo_reqheight())

        notebook.bind("<<NotebookTabChanged>>", size_selected_page, add="+")
        summary_page.bind("<Configure>", size_selected_page, add="+")
        detail.bind("<Configure>", size_selected_page, add="+")
        notebook.after_idle(size_selected_page)
        self.render_usage()

    def refresh_limits(self):
        for name, lookup in (("codex", codex_rate_limits), ("agy", antigravity_rate_limits)):
            if name not in self.usage_fetching and shutil.which(name):
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
        self.refresh_usage_bar()
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
            windows = self.limit_windows(name)
            if windows:
                label, used, reset = max(windows, key=lambda item: item[1])
                countdown = self.reset_in(reset)
                compact = f"{used:.0f}% " + t("used", "사용") + f" · {label}"
                if countdown:
                    compact += " · " + t(f"resets in {countdown}", f"{countdown} 후 초기화")
            else:
                totals = self.chat.usage.get(name, {})
                count = sum(totals.get(key, 0) for key in ("input_tokens", "output_tokens"))
                compact = f"{count:,}t · " + t("project total", "프로젝트 누계") if totals else summary
            self.summary_rows[name].configure(text=compact)
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
        self.app_status.configure(text=self.t("Checking for updates…", "업데이트 확인 중…"))
        self.app_menu.entryconfigure(self.update_menu_index, state="disabled")
        self.background("available", check_update)

    def finish_update(self):
        self.updating = False
        self.chat.pause(False)
        self.app_status.configure(text=self.t("Ready", "준비"))
        self.app_menu.entryconfigure(self.update_menu_index, state="normal")

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
        self.refresh_usage_bar()
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
                    self.app_status.configure(text=t("Downloading update…", "업데이트 다운로드 중…"))
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
