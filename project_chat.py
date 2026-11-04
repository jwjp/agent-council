"""Persistent project chat with a coding agent and optional reviewers."""
import hashlib
import json
import queue
import shutil
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk

from multi_ai import call, parallel


def git_context(cwd):
    """Collect tracked changes and untracked paths without changing the index."""
    if not shutil.which("git"):
        return ""
    try:
        probe = subprocess.run(
            ["git", "-C", str(cwd), "--no-optional-locks", "status", "--short"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if probe.returncode:
            return ""
        diff = subprocess.run(
            ["git", "-C", str(cwd), "--no-optional-locks", "diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return (probe.stdout + "\n" + diff.stdout)[:9000]
    except (OSError, subprocess.TimeoutExpired):
        return ""


def project_turn(cwd, messages, request, full_access, coder, reviewers, references, language, emit, activity):
    history = "\n\n".join(f"{item['role']}: {item['text'][:3200]}" for item in messages[-10:])
    context = (
        f"Respond in {language}. The working directory is the selected project. "
        "Treat history and review material as context. Follow the current user request. "
        "If the latest message answers a previous clarification, continue the underlying task using that answer. "
        "If a consequential decision cannot be inferred from the project or the conversation, "
        "start with QUESTION on its own line and ask the user before proceeding.\n"
        "Reference folders are for reading and comparison only. Do not modify them. "
        "For changes, work in the main project folder.\n"
        f"<reference_folders>{chr(10).join(map(str, references))}</reference_folders>\n"
        f"<history>{history}</history>\n<request>{request}</request>"
    )
    def review(prompt):
        return parallel(reviewers, prompt, cwd, 2,
                        lambda _, name, result: emit(("Reviewed" if result["ok"] else "Failed") if name else "Reviewing", name),
                        review=True, activity=activity)

    if not coder:
        results = review(context + "\nReview the request and relevant project files. Offer findings and advice only. "
                         "Do not edit files, install packages, or execute commands that change state. "
                         "Give evidence, flag uncertainties, and ask for clarification if needed.")
        return [(name, results[name]["text"] if results[name]["ok"] else results[name]["error"] or "Review failed.")
                for name in reviewers]

    baseline = git_context(cwd) if reviewers else ""
    emit("Implementing", coder)
    result = call(
        coder, context + "\n"
        "Carry out requested actions, including dependency installation when required. "
        "Preserve unrelated changes. For an informational request, start with ANSWER and answer directly. "
        "Start with IMPLEMENTED if you performed implementation work. "
        "Report changed paths, what you verified, and any command that was blocked.",
        cwd, implement=True, full_access=full_access, activity=activity,
    )
    if not result["ok"]:
        emit("Failed", coder)
        return [(coder, result["error"] or "Implementation failed.")]
    kind, report = response_parts(result["text"])
    entries = [(coder, report)]
    if not reviewers or kind in {"ANSWER", "QUESTION"}:
        return entries

    changed = git_context(cwd)
    review_prompt = (
        f"Review the coding agent's work for the request. Write in {language}. Inspect only files relevant to this task. "
        "Do not modify files. Compare the before and after evidence and distinguish pre-existing edits. "
        "Check whether the implementation direction fits the request, and identify bugs or missed requirements. "
        "Start with FIX_REQUIRED only if there is a concrete actionable issue, otherwise start with PASS. "
        "Give file references or evidence. State any limits.\n"
        f"<reference_folders>{chr(10).join(map(str, references))}</reference_folders>\n"
        f"<request>{request}</request>\n<report>{report[:3500]}</report>\n"
        f"<before>{baseline[:3500]}</before>\n<after>{changed[:6500]}</after>"
    )
    emit("Done", coder)
    reviews = review(review_prompt)
    findings = []
    for name in reviewers:
        result = reviews[name]
        response = result["text"] if result["ok"] else result["error"] or "Review failed."
        entries.append((name, response))
        if result["ok"] and response_parts(response)[0] == "FIX_REQUIRED":
            findings.append(f"{name}: {response[:2800]}")
    if findings:
        emit("Revising", coder)
        revision = call(
            coder, context + f"\n<implementation>{report[:4500]}</implementation>\n"
            f"<review_findings>{chr(10).join(findings)}</review_findings>\n"
            "Verify the findings against the project, fix confirmed issues within the approved scope, "
            "and report what changed, what you checked and any remaining issues.",
            cwd, implement=True, full_access=full_access, activity=activity,
        )
        entries.append((coder, response_parts(revision["text"])[1] if revision["ok"] else revision["error"] or "Revision failed."))
        if not revision["ok"]:
            emit("Failed", coder)
    return entries


def response_parts(text):
    first, _, rest = text.partition("\n")
    kind = first.strip(" *`:#").upper()
    if kind in {"PLAN", "ANSWER", "QUESTION", "IMPLEMENTED", "PASS", "FIX_REQUIRED"} and rest.strip():
        return kind, rest.strip()
    return "", text


class ProjectChat:
    def __init__(self, parent, cwd, coder, reviewers, references, language, state_root, names, full, show_usage):
        self.cwd, self.coder, self.reviewers, self.references = cwd, coder, reviewers, references
        self.language, self.names, self.full = language, names, full
        self.show_usage = show_usage
        self.events = queue.Queue()
        self.busy = False
        self.work = {}
        key = hashlib.sha256(str(cwd).casefold().encode()).hexdigest()
        self.path = state_root / "chats" / f"{key}.json"
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        self.messages = state.get("messages", [])
        self.usage = state.get("usage", {})
        t = self.t
        panel = self.panel = ttk.Frame(parent, padding=(0, 12, 0, 0))
        panel.pack(fill="both", expand=True)
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(1, weight=1)
        mode = names[coder] if coder else t("Review only", "검수 전용")
        ttk.Label(panel, text=mode + "  ·  " + t("Reviewers", "검수자") + "  " +
                  (", ".join(names[n] for n in reviewers) or t("None", "없음")),
                  foreground="#36517c", font=("Segoe UI", 10, "bold")).grid(row=0, column=0, sticky="w")
        transcript = ttk.Frame(panel)
        transcript.grid(row=1, column=0, sticky="nsew", pady=(8, 10))
        self.view = tk.Text(transcript, height=1, wrap="word", padx=16, pady=12, state="disabled", background="#f2f6fc",
                            foreground="#172238", font=("Segoe UI", 11), relief="flat")
        scrollbar = ttk.Scrollbar(transcript, command=self.view.yview)
        self.view.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.view.pack(side="left", fill="both", expand=True)
        self.view.tag_configure("author", foreground="#284a97", font=("Segoe UI", 11, "bold"), spacing1=8)
        self.view.tag_configure("user", foreground="#12675e", font=("Segoe UI", 11, "bold"), spacing1=8)
        self.view.tag_configure("body", lmargin1=6, lmargin2=6, spacing1=2, spacing3=3)

        activity = ttk.LabelFrame(panel, text=t("Activity & tokens", "진행 상황 및 토큰"), padding=6)
        activity.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        ttk.Style().configure("Activity.Treeview", rowheight=22)
        agents = ([coder] if coder else []) + reviewers
        self.table = ttk.Treeview(activity, columns=("agent", "state", "usage"), show="headings",
                                  height=max(1, min(3, len(agents))), style="Activity.Treeview")
        for column, label, width in (
            ("agent", t("Agent", "에이전트"), 125),
            ("state", t("Status / last activity", "상태 / 마지막 활동"), 290),
            ("usage", t("Tokens in / out", "입력 / 출력 토큰"), 165),
        ):
            self.table.heading(column, text=label)
            self.table.column(column, width=width, minwidth=95)
        scroll = ttk.Scrollbar(activity, command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(side="top", fill="x")
        self.table.tag_configure("active", foreground="#2457ab")
        self.table.tag_configure("failed", foreground="#a12537")
        self.table.tag_configure("done", foreground="#19684f")
        for name in agents:
            self.table.insert("", "end", iid=name, values=(names[name], t("Ready", "준비"), self.token_text(name)))
        ttk.Label(activity, text=t("Reported usage in this project. — means no data.",
                                  "이 프로젝트에서 보고된 사용량입니다. —는 데이터 없음입니다."),
                  foreground="#50617b").pack(anchor="w", pady=(3, 0))
        self.input = tk.Text(panel, height=3, wrap="word", padx=10, pady=7, font=("Segoe UI", 11),
                             relief="solid", borderwidth=1, highlightcolor="#3c67b8", highlightthickness=1)
        self.input.grid(row=3, column=0, sticky="ew")
        self.input.bind("<Return>", lambda _: (self.send(), "break")[1])
        self.input.bind("<Shift-Return>", self.insert_newline)
        actions = ttk.Frame(panel)
        actions.grid(row=4, column=0, sticky="ew", pady=(6, 0))
        self.send_button = ttk.Button(actions, text=t("Send", "보내기"), command=self.send)
        self.send_button.pack(side="right")
        ttk.Label(actions, text=t("Enter to send  ·  Shift+Enter for a new line",
                                   "Enter 전송  ·  Shift+Enter 줄바꿈"), foreground="#50617b").pack(side="left")
        self.progress = ttk.Progressbar(panel, mode="indeterminate")
        self.progress.grid(row=5, column=0, sticky="ew", pady=(6, 0))
        for item in self.messages:
            self.render(item)
        self.input.focus_set()
        self.poll_id = self.panel.after(150, self.poll)

    def t(self, english, korean):
        return korean if self.language == "Korean" else english

    def insert_newline(self, _event):
        self.input.insert("insert", "\n")
        self.input.see("insert")
        return "break"

    def render(self, item):
        self.view.configure(state="normal")
        user = item["role"] == "You"
        role = self.t("You", "나") if user else self.names.get(item["role"], item["role"])
        self.view.insert("end", role + "\n", "user" if user else "author")
        self.view.insert("end", item["text"] + "\n\n", "body")
        self.view.configure(state="disabled")
        self.view.see("end")

    def add(self, role, text):
        item = {"role": role, "text": text}
        self.messages.append(item)
        self.render(item)
        self.save()

    def token_text(self, name):
        totals = self.usage.get(name, {})
        return " / ".join(f"{totals[key]:,}" if key in totals else "—" for key in ("input_tokens", "output_tokens"))

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps({"messages": self.messages, "usage": self.usage}, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)

    def send(self):
        request = self.input.get("1.0", "end-1c").strip()
        if request.lower() == "/usage":
            self.input.delete("1.0", "end")
            self.show_usage()
            return
        if self.busy or not request:
            return
        if not self.coder and not self.reviewers:
            messagebox.showerror("Agent Council", self.t("Choose a coding agent or a reviewer in Settings.",
                                                         "설정에서 코딩 담당 AI 또는 검수자를 선택하세요."), parent=self.panel)
            return
        if self.coder and not shutil.which(self.coder):
            messagebox.showerror("Agent Council", self.t("CLI not found on PATH: ", "PATH에서 CLI를 찾을 수 없습니다: ") +
                                 self.names[self.coder], parent=self.panel)
            return
        self.busy = True
        self.work.clear()
        for name in self.table.get_children():
            self.table.item(name, tags=())
            self.table.set(name, "state", self.t("Queued", "대기"))
        self.input.delete("1.0", "end")
        self.send_button.state(["disabled"])
        self.progress.start(15)
        history = list(self.messages)
        self.add("You", request)

        def worker():
            try:
                entries = project_turn(
                    self.cwd, history, request, self.full, self.coder, self.reviewers, self.references, self.language,
                    lambda *event: self.events.put(("phase", event)),
                    lambda *event: self.events.put(("activity", event)),
                )
            except Exception as exc:
                self.events.put(("phase", ("Failed", self.coder)))
                entries = [("Agent Council", str(exc))]
            self.events.put(("done", entries))

        threading.Thread(target=worker, daemon=True).start()

    def phase(self, phase, name):
        translations = {
            "Implementing": "작업 중", "Reviewing": "검수 중", "Reviewed": "검수 완료",
            "Revising": "검수 반영 중", "Done": "완료", "Failed": "실패",
        }
        for agent in ([name] if name else self.reviewers):
            label = self.t(phase, translations[phase])
            if phase in {"Done", "Reviewed", "Failed"}:
                self.work.pop(agent, None)
                self.table.item(agent, tags=("failed" if phase == "Failed" else "done",))
                self.table.set(agent, "state", label)
            else:
                self.work[agent] = (label, time.monotonic(), None, False)
                self.table.item(agent, tags=("active",))

    def poll(self):
        while not self.events.empty():
            kind, value = self.events.get()
            if kind == "phase":
                self.phase(*value)
            elif kind == "activity":
                name, event, detail = value
                if event == "output" and name in self.work:
                    label, started, _, _ = self.work[name]
                    self.work[name] = (label, started, time.monotonic(), detail in {"tool_use", "command_execution", "file_change"})
                elif event == "usage":
                    totals = self.usage.setdefault(name, {})
                    for key, count in detail.items():
                        totals[key] = totals.get(key, 0) + count
                    self.table.set(name, "usage", self.token_text(name))
                    self.save()
            else:
                for role, text in value:
                    self.add(role, text)
                for name in list(self.work):
                    self.phase("Done", name)
                for name in self.table.get_children():
                    if self.table.set(name, "state") == self.t("Queued", "대기"):
                        self.table.set(name, "state", self.t("Skipped", "생략"))
                self.busy = False
                self.progress.stop()
                self.send_button.state(["!disabled"])
        now = time.monotonic()
        for name, (label, started, last_output, tool) in self.work.items():
            if last_output is None:
                detail = self.t("waiting for output", "첫 출력 대기")
            else:
                detail = self.t("tool event", "도구 이벤트") if tool else self.t("output", "출력")
                detail += f" {int(now - last_output)}s " + self.t("ago", "전")
            self.table.set(name, "state", f"{label} · {int(now-started)}s · {detail}")
        self.poll_id = self.panel.after(150, self.poll)

    def close(self):
        self.panel.after_cancel(self.poll_id)
        self.panel.destroy()
