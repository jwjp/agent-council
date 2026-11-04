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
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from urllib.request import Request, urlopen

from multi_ai import AGENTS, implement_recommendation, run_council

VERSION = "1.1.0"
REPO = "jwjp/agent-council"
ASSET = "AgentCouncil.exe"
CONFIG = Path(os.getenv("LOCALAPPDATA", Path.home())) / "AgentCouncil" / "settings.json"
NAMES = dict(zip(AGENTS, ("Codex", "Claude Code", "Antigravity", "Grok", "Cursor Agent")))


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
        self.active = {}
        self.busy = False
        self.updating = False
        self.runs = {}
        self.documents = {}
        try:
            self.config = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.config = {}
        self.lang = tk.StringVar(value=self.config.get("language", "English"))
        self.folder = tk.StringVar(value=self.config.get("folder", str(Path.home())))
        self.agents = {name: tk.BooleanVar(value=name in self.config.get("agents", [a for a in AGENTS if shutil.which(a)]))
                       for name in AGENTS}
        root.title(f"Agent Council {VERSION}")
        root.geometry("850x700")
        root.minsize(650, 530)
        self.body = ttk.Frame(root, padding=16)
        self.body.pack(fill="both", expand=True)
        self.build()
        self.refresh_runs()
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(200, self.poll)

    def t(self, english, korean):
        return korean if self.lang.get() == "한국어" else english

    def build(self):
        t = self.t
        header = ttk.Frame(self.body)
        header.pack(fill="x")
        ttk.Label(header, text="Agent Council", font=("Segoe UI", 20, "bold")).pack(side="left")
        language = ttk.Combobox(header, textvariable=self.lang, values=("English", "한국어"), state="readonly", width=10)
        language.pack(side="right")
        language.bind("<<ComboboxSelected>>", lambda _: self.rebuild())
        settings = ttk.LabelFrame(self.body, text=t("Settings", "설정"), padding=10)
        settings.pack(fill="x", pady=8)
        row = ttk.Frame(settings)
        row.pack(fill="x")
        ttk.Label(row, text=t("Project folder", "프로젝트 폴더")).pack(side="left", padx=(0, 8))
        entry = ttk.Entry(row, textvariable=self.folder)
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<FocusOut>", lambda _: (self.save(), self.refresh_runs()))
        ttk.Button(row, text=t("Browse", "찾아보기"), command=self.pick).pack(side="right", padx=(8, 0))
        row = ttk.Frame(settings)
        row.pack(fill="x", pady=(8, 0))
        for name in AGENTS:
            ttk.Checkbutton(row, text=NAMES[name], variable=self.agents[name], command=self.save).pack(side="left", padx=3)
        ttk.Label(settings, text=t("Checked agents are connected using their local CLI sign-in.",
                                   "선택한 에이전트를 로컬 CLI 로그인으로 연결합니다. 선택을 해제하면 앱 연결이 끊깁니다.")).pack(anchor="w")
        ttk.Label(self.body, text=t("Ask the council", "질문 입력")).pack(anchor="w")
        self.question = tk.Text(self.body, height=4, wrap="word")
        self.question.pack(fill="x")
        row = ttk.Frame(self.body)
        row.pack(fill="x", pady=8)
        self.run_button = ttk.Button(row, text=t("Run council", "회의 시작"), command=self.run)
        self.run_button.pack(side="left")
        self.implement_button = ttk.Button(row, text=t("Implement recommendation", "추천안으로 진행"), command=self.implement)
        self.implement_button.pack(side="left", padx=8)
        self.update_button = ttk.Button(row, text=t("Check for updates", "업데이트 확인"), command=self.update)
        self.update_button.pack(side="right")
        self.status = ttk.Label(self.body, text=t("Ready", "준비"))
        self.status.pack(anchor="w")
        self.bar = ttk.Progressbar(self.body, mode="indeterminate")
        self.bar.pack(fill="x", pady=4)
        self.table = ttk.Treeview(self.body, columns=("agent", "state", "elapsed"), show="headings", height=5)
        for key, label, width in (("agent", t("Agent", "에이전트"), 155),
                                  ("state", t("Status", "상태"), 450), ("elapsed", t("Elapsed", "경과"), 70)):
            self.table.heading(key, text=label)
            self.table.column(key, width=width)
        self.table.tag_configure("success", foreground="#167640")
        self.table.tag_configure("failure", foreground="#b32929")
        self.table.pack(fill="x")
        results = ttk.Frame(self.body)
        results.pack(fill="x", pady=(8, 0))
        self.run_picker = ttk.Combobox(results, state="readonly", width=33)
        self.run_picker.pack(side="left")
        self.run_picker.bind("<<ComboboxSelected>>", lambda _: self.load_run())
        self.document_picker = ttk.Combobox(results, state="readonly", width=36)
        self.document_picker.pack(side="left", padx=8)
        self.document_picker.bind("<<ComboboxSelected>>", lambda _: self.show(self.documents[self.document_picker.get()]))
        self.output = tk.Text(self.body, wrap="word", state="disabled")
        self.output.pack(fill="both", expand=True, pady=(8, 0))

    def save(self):
        CONFIG.parent.mkdir(parents=True, exist_ok=True)
        CONFIG.write_text(json.dumps({"language": self.lang.get(), "folder": self.folder.get(),
                                      "agents": [a for a in AGENTS if self.agents[a].get()]}, ensure_ascii=False), encoding="utf-8")

    def rebuild(self):
        self.save()
        if self.busy or self.updating:
            return
        prompt = self.question.get("1.0", "end-1c")
        output = self.output.get("1.0", "end-1c")
        for child in self.body.winfo_children():
            child.destroy()
        self.build()
        self.refresh_runs()
        self.question.insert("1.0", prompt)
        self.show(output)

    def pick(self):
        path = filedialog.askdirectory(initialdir=self.folder.get())
        if path:
            self.folder.set(path)
            self.save()
            self.refresh_runs()

    def refresh_runs(self, selected=None):
        if self.busy:
            return
        current = self.runs.get(self.run_picker.get())
        self.runs = {}
        if self.folder.get().strip():
            directory = Path(self.folder.get()).expanduser().resolve() / "multi_ai_runs"
            for path in sorted(directory.glob("*/final.md"), reverse=True):
                try:
                    meta = json.loads(path.with_name("meta.json").read_text(encoding="utf-8"))
                    if meta["final_ok"] and isinstance(meta["labels"], dict):
                        self.runs[f"{path.parent.name} · {meta['question'][:55]}"] = path.parent
                except (OSError, ValueError, KeyError):
                    continue
        self.run_picker.configure(values=list(self.runs))
        target = selected or current
        key = next((key for key, path in self.runs.items() if path == target), next(iter(self.runs), ""))
        self.run_picker.set(key)
        self.load_run()

    def load_run(self):
        self.documents = {}
        run = self.runs.get(self.run_picker.get())
        self.implement_button.state(["!disabled" if run and not self.busy else "disabled"])
        if run:
            meta = json.loads((run / "meta.json").read_text(encoding="utf-8"))
            authors = "\n".join(f"{label} · {NAMES.get(name, name)}" for name, label in meta["labels"].items())
            title = self.t("Recommendation", "최종 추천")
            self.documents[title] = f"{meta['question']}\n\n{authors}\n\n" + (run / "final.md").read_text(encoding="utf-8")
            for filename, prefix in (("proposals.json", self.t("Proposal", "초안")), ("reviews.json", self.t("Review", "평가"))):
                path = run / filename
                if path.exists():
                    for name, result in json.loads(path.read_text(encoding="utf-8")).items():
                        label = meta["labels"].get(name, "—") if filename == "proposals.json" else ""
                        self.documents[f"{prefix} {label} · {NAMES.get(name, name)}"] = result["text"] or result["error"]
            if (run / "implementation.md").exists():
                self.documents[self.t("Implementation · Codex", "구현 결과 · Codex")] = (run / "implementation.md").read_text(encoding="utf-8")
        self.document_picker.configure(values=list(self.documents))
        self.document_picker.set(next(iter(self.documents), ""))
        self.show(self.documents.get(self.document_picker.get(), ""))

    def show(self, value):
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.insert("1.0", value)
        self.output.configure(state="disabled")

    def run(self):
        t = self.t
        names = [name for name in AGENTS if self.agents[name].get()]
        cwd = Path(self.folder.get()).expanduser()
        question = self.question.get("1.0", "end-1c").strip()
        approval = " ".join(question.lower().rstrip(".!").split())
        if approval.replace(" ", "") in {"추천안으로진행하자", "추천안으로진행해줘", "추천안으로진행", "추천안으로시작하자", "추천안으로시작", "추천안으로시작해줘", "추천안으로진행해주세요"} or approval in {
            "implement the recommendation", "proceed with the recommendation", "start with the recommendation",
        }:
            self.implement()
            return
        if not question or not self.folder.get().strip() or not cwd.is_dir() or len(names) < 2:
            messagebox.showerror("Agent Council", t("Enter a question, select an existing folder and at least two agents.",
                                                   "질문을 입력하고 기존 폴더와 에이전트 두 개 이상을 선택하세요."))
            return
        missing = [NAMES[name] for name in names if not shutil.which(name)]
        if missing:
            messagebox.showerror("Agent Council", t("CLI not found on PATH: ", "PATH에서 CLI를 찾을 수 없습니다: ") + ", ".join(missing))
            return
        language = self.response_language()
        self.start_run(lambda emit: run_council(question, cwd.resolve(), names, names[0], language, emit))

    def response_language(self):
        return "Korean" if self.lang.get() == "한국어" else "English"

    def implement(self):
        t = self.t
        self.refresh_runs()
        run = self.runs.get(self.run_picker.get())
        if not run or not self.agents["codex"].get() or not shutil.which("codex"):
            messagebox.showerror("Agent Council", t("Select a saved recommendation and connect Codex in Settings.",
                                                   "저장된 추천안을 선택하고 설정에서 Codex를 연결하세요."))
            return
        cwd = run.parent.parent.resolve()
        followup = self.question.get("1.0", "end-1c").strip()
        language = self.response_language()
        if messagebox.askyesno("Agent Council", t(f"Let Codex implement this recommendation in {cwd}?",
                                                 f"Codex가 {cwd} 폴더에 이 추천안을 구현하도록 할까요?")):
            self.start_run(lambda emit: implement_recommendation(run, cwd, language, followup, emit))

    def start_run(self, operation):
        self.save()
        self.busy = True
        self.run_button.state(["disabled"])
        self.implement_button.state(["disabled"])
        self.run_picker.configure(state="disabled")
        self.bar.start(15)
        self.show("")
        self.question.delete("1.0", "end")

        def worker():
            try:
                result = operation(lambda *event: self.events.put(("progress", event)))
                self.events.put(("done", result))
            except Exception as exc:
                self.events.put(("done", (None, "", str(exc))))

        threading.Thread(target=worker, daemon=True).start()

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
        if self.busy or self.updating:
            messagebox.showinfo("Agent Council", self.t("Wait for the current operation to finish.", "현재 작업이 끝날 때까지 기다려 주세요."))
            return
        self.save()
        self.root.destroy()

    def poll(self):
        t = self.t
        while not self.events.empty():
            kind, value = self.events.get()
            if kind == "progress":
                phase, name, data = value
                if phase == 0:
                    continue
                if not name:
                    self.active.clear()
                    self.table.delete(*self.table.get_children())
                    labels = (t("Proposals", "초안"), t("Cross-review", "상호 평가"), t("Recommendation", "최종 추천"))
                    self.status.configure(text=f"{phase}/3  {labels[phase - 1]}" if phase < 4 else t("Implementing with Codex", "Codex가 구현 중"))
                    for agent in data:
                        self.active[agent] = time.monotonic()
                        self.table.insert("", "end", iid=agent, values=(NAMES[agent], t("Waiting for CLI response", "CLI 응답 대기 중"), "0s"))
                else:
                    elapsed = int(time.monotonic() - self.active.pop(name))
                    error = data["error"].strip().splitlines()
                    detail = t("Done", "완료") if data["ok"] else t("Failed", "실패") + (f" · {error[0][:150]}" if error else "")
                    self.table.item(name, values=(NAMES[name], detail, f"{elapsed}s"),
                                    tags=("success" if data["ok"] else "failure",))
            elif kind == "done":
                self.busy = False
                self.bar.stop()
                self.run_button.state(["!disabled"])
                path, answer, error = value
                self.run_picker.configure(state="readonly")
                self.refresh_runs(path)
                self.status.configure(text=t("Finished", "완료") if not error else t("Run failed", "실행 실패"))
                if error:
                    self.show((f"{path}\n\n" if path else "") + error)
                elif answer != "" and path and (path / "implementation.md").exists():
                    title = t("Implementation · Codex", "구현 결과 · Codex")
                    if title in self.documents:
                        self.document_picker.set(title)
                        self.show(self.documents[title])
            elif kind == "available" and value:
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
        for name, start in self.active.items():
            self.table.set(name, "elapsed", f"{int(time.monotonic() - start)}s")
        self.root.after(200, self.poll)


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
