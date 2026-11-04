"""Agent Council desktop application."""
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import sys
import tempfile
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from urllib.request import Request, urlopen

from multi_ai import AGENTS, CODING_AGENTS
from project_chat import ProjectChat

VERSION = "1.3.0"
REPO = "jwjp/agent-council"
ASSET = "AgentCouncil.exe"
CONFIG = Path(os.getenv("LOCALAPPDATA", Path.home())) / "AgentCouncil" / "settings.json"
NAMES = dict(zip(AGENTS, ("Codex", "Claude Code", "Antigravity", "Grok", "Cursor Agent", "Gemini CLI")))


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
    target = Path(sys.executable).with_name("AgentCouncil.update.exe")
    digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as file:
        partial = Path(file.name)
        try:
            with urlopen(asset["browser_download_url"], timeout=30) as response:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    file.write(chunk)
            if "sha256:" + digest.hexdigest() != asset["digest"]:
                raise ValueError("Update checksum mismatch.")
            file.close()
            partial.replace(target)
        finally:
            file.close()
            partial.unlink(missing_ok=True)


class App:
    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.updating = False
        try:
            config = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {}
        self.lang = config.get("language", "English")
        folder = Path(config.get("folder") or Path.home()).expanduser()
        self.folder = (folder if folder.is_dir() else Path.home()).resolve()
        self.coder = config.get("coder", "claude")
        if self.coder not in CODING_AGENTS:
            self.coder = CODING_AGENTS[0]
        self.reviewers = [name for name in AGENTS if name in config.get("reviewers", []) and name != self.coder]
        root.title(f"Agent Council {VERSION}")
        root.geometry("900x720")
        root.minsize(640, 500)
        self.body = ttk.Frame(root, padding=16)
        self.body.pack(fill="both", expand=True)
        self.header = ttk.Frame(self.body)
        self.header.pack(fill="x")
        ttk.Label(self.header, text="Agent Council", font=("Segoe UI", 20, "bold")).pack(side="left")
        self.settings_button = ttk.Button(self.header, command=self.settings)
        self.settings_button.pack(side="right")
        self.update_button = ttk.Button(self.header, command=self.update)
        self.update_button.pack(side="right", padx=8)
        self.folder_label = ttk.Label(self.body)
        self.folder_label.pack(anchor="w", pady=(4, 0))
        self.chat = None
        self.build_chat(config.get("auto", True))
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(200, self.poll)

    def t(self, english, korean):
        return korean if self.lang == "한국어" else english

    def build_chat(self, auto, draft=""):
        self.settings_button.configure(text=self.t("Settings", "설정"))
        self.update_button.configure(text=self.t("Check for updates", "업데이트 확인"))
        self.folder_label.configure(text=self.t("Project", "프로젝트") + " · " + str(self.folder))
        language = "Korean" if self.lang == "한국어" else "English"
        self.chat = ProjectChat(self.body, self.folder, self.coder, self.reviewers, language, CONFIG.parent, NAMES, auto)
        self.chat.input.insert("1.0", draft)

    def save(self):
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({
            "language": self.lang, "folder": str(self.folder), "coder": self.coder,
            "reviewers": self.reviewers, "auto": self.chat.auto.get(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def settings(self):
        t = self.t
        if self.chat.busy:
            messagebox.showinfo("Agent Council", t("Wait for the current turn to finish.", "현재 작업이 끝날 때까지 기다려 주세요."), parent=self.root)
            return
        dialog = tk.Toplevel(self.root)
        dialog.title(t("Settings", "설정"))
        dialog.transient(self.root)
        dialog.grab_set()
        panel = ttk.Frame(dialog, padding=16)
        panel.pack(fill="both", expand=True)
        folder = tk.StringVar(value=str(self.folder))
        language = tk.StringVar(value=self.lang)
        coder = tk.StringVar(value=NAMES[self.coder])
        reviewers = {name: tk.BooleanVar(value=name in self.reviewers) for name in AGENTS}
        ttk.Label(panel, text=t("Project folder", "프로젝트 폴더")).grid(row=0, column=0, sticky="w")
        ttk.Entry(panel, textvariable=folder, width=52).grid(row=1, column=0, sticky="ew", pady=(3, 12))

        def browse():
            path = filedialog.askdirectory(parent=dialog, initialdir=folder.get())
            if path:
                folder.set(path)

        ttk.Button(panel, text=t("Browse", "찾아보기"), command=browse).grid(row=1, column=1, padx=(8, 0), sticky="n")
        roles = ttk.Frame(panel)
        roles.grid(row=2, columnspan=2, sticky="ew")
        ttk.Label(roles, text=t("Coding agent", "코딩 담당 AI")).grid(row=0, column=0, sticky="w")
        picker = ttk.Combobox(roles, textvariable=coder, state="readonly", values=[NAMES[n] for n in CODING_AGENTS])
        picker.grid(row=1, column=0, sticky="w", padx=(0, 16), pady=3)
        ttk.Label(roles, text=t("Language", "언어")).grid(row=0, column=1, sticky="w")
        ttk.Combobox(roles, textvariable=language, state="readonly", values=("English", "한국어"), width=12).grid(row=1, column=1, sticky="w", pady=3)
        ttk.Label(panel, text=t("Review agents (optional)", "검수 AI (선택 사항)")).grid(row=3, column=0, sticky="w", pady=(12, 3))
        choices = ttk.Frame(panel)
        choices.grid(row=4, columnspan=2, sticky="w")
        checks = {}
        for i, name in enumerate(AGENTS):
            check = ttk.Checkbutton(choices, text=NAMES[name], variable=reviewers[name])
            check.grid(row=i // 3, column=i % 3, sticky="w", padx=(0, 10))
            checks[name] = check

        def sync_reviewers(*_):
            for name, check in checks.items():
                is_coder = NAMES[name] == coder.get()
                if is_coder:
                    reviewers[name].set(False)
                check.state(["disabled" if is_coder else "!disabled"])

        picker.bind("<<ComboboxSelected>>", sync_reviewers)
        sync_reviewers()

        def apply():
            path = Path(folder.get().strip()).expanduser()
            if not folder.get().strip() or not path.is_dir():
                messagebox.showerror("Agent Council", t("Choose an existing folder.", "기존 폴더를 선택하세요."), parent=dialog)
                return
            path = path.resolve()
            selected_coder = next(name for name in CODING_AGENTS if NAMES[name] == coder.get())
            selected_reviewers = [name for name in AGENTS if reviewers[name].get() and name != selected_coder]
            auto = self.chat.auto.get()
            draft = self.chat.input.get("1.0", "end-1c") if path == self.folder else ""
            self.chat.close()
            self.folder, self.coder, self.reviewers, self.lang = path, selected_coder, selected_reviewers, language.get()
            self.build_chat(auto, draft)
            self.save()
            dialog.destroy()
            self.chat.input.focus_set()

        ttk.Button(panel, text=t("Save settings", "설정 저장"), command=apply).grid(row=5, columnspan=2, sticky="e", pady=(16, 0))

    def update(self):
        self.updating = True
        self.update_button.state(["disabled"])
        self.background("available", check_update)

    def background(self, kind, operation):
        def worker():
            try:
                self.events.put((kind, operation()))
            except Exception as exc:
                self.events.put(("update_error", str(exc)))
        threading.Thread(target=worker, daemon=True).start()

    def close(self):
        if self.chat.busy or self.updating:
            messagebox.showinfo("Agent Council", self.t("Wait for the current operation to finish.", "현재 작업이 끝날 때까지 기다려 주세요."))
            return
        self.save()
        self.root.destroy()

    def poll(self):
        t = self.t
        while not self.events.empty():
            kind, value = self.events.get()
            if kind == "available" and value:
                version, asset = value
                if messagebox.askyesno("Agent Council", t(f"Download {version}?", f"{version} 업데이트를 다운로드할까요?")):
                    self.background("downloaded", lambda: download_update(asset))
                    continue
                self.updating = False
                self.update_button.state(["!disabled"])
            else:
                self.updating = False
                self.update_button.state(["!disabled"])
                messages = {"available": t("You are up to date.", "최신 버전입니다."),
                            "downloaded": t("Update staged. Close the app and reopen it using Launch Agent Council.cmd.",
                                            "다운로드가 완료됐습니다. 앱을 닫고 Launch Agent Council.cmd로 다시 실행하면 적용됩니다."),
                            "update_error": value}
                messagebox.showinfo("Agent Council", messages[kind])
        self.root.after(200, self.poll)


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
