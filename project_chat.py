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
from ui_theme import FONT, TEXT_SIZE


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
    def __init__(self, parent, cwd, coder, reviewers, references, language, state_root, names, full, show_usage, on_limits, colors):
        self.cwd, self.coder, self.reviewers, self.references = cwd, coder, reviewers, references
        self.language, self.names, self.full = language, names, full
        self.show_usage = show_usage
        self.on_limits = on_limits
        self.colors = colors
        self.events = queue.Queue()
        self.busy = False
        self.paused = False
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
        self.panel = ttk.Frame(parent, padding=(0, 10, 0, 0))
        self.panel.pack(fill="both", expand=True)
        panel = ttk.Frame(self.panel)
        panel.pack(fill="both", expand=True)
        self.panel.bind("<Configure>", lambda event: panel.pack_configure(padx=max(0, (event.width - 900) // 2)))
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(1, weight=1)
        panel.rowconfigure(4, minsize=8)
        mode = names[coder] if coder else t("Review only", "검수 전용")
        ttk.Label(panel, text=mode + "  ·  " + t("Reviewers", "검수자") + "  " +
                  (", ".join(names[n] for n in reviewers) or t("None", "없음")),
                  style="Muted.TLabel", font=(FONT, TEXT_SIZE, "bold")).grid(row=0, column=0, sticky="w", padx=2)
        transcript = ttk.Frame(panel, style="Card.TFrame", padding=1)
        transcript.grid(row=1, column=0, sticky="nsew", pady=(8, 10))
        self.view = tk.Text(transcript, height=1, wrap="word", padx=18, pady=12, state="disabled", background=colors["surface"],
                            foreground=colors["text"], selectbackground=colors["selection"], selectforeground=colors["text"],
                            font=(FONT, 10), relief="flat", borderwidth=0, highlightthickness=0)
        scrollbar = ttk.Scrollbar(transcript, command=self.view.yview)
        self.view.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.view.pack(side="left", fill="both", expand=True)
        self.view.tag_configure("author", foreground=colors["muted"], font=(FONT, 9, "bold"), spacing1=10, spacing3=3)
        self.view.tag_configure("user", foreground=colors["accent"], font=(FONT, 9, "bold"), spacing1=10, spacing3=3, lmargin1=12)
        self.view.tag_configure("body", spacing1=2, spacing3=4)
        self.view.tag_configure("request", background=colors["user"], lmargin1=12, lmargin2=12, rmargin=18, spacing1=5, spacing3=5)
        self.view.tag_configure("heading", font=(FONT, 10, "bold"), spacing1=5, spacing3=3)
        self.view.tag_configure("code", font=("Consolas", TEXT_SIZE), background=colors["subtle"], lmargin1=10, lmargin2=10)
        self.empty = None
        if not self.messages:
            self.empty = ttk.Frame(transcript, style="Surface.TFrame")
            ttk.Label(self.empty, text=t("What are we working on?", "어떤 작업을 시작할까요?"),
                      style="Surface.TLabel", font=(FONT, 16, "bold")).pack(pady=(0, 6))
            ttk.Label(self.empty, text=t("Ask a question, request a change, or review this project.",
                                       "질문하거나, 변경을 요청하거나, 프로젝트를 검수해 보세요."),
                      style="Surface.Muted.TLabel").pack()
            self.empty.place(relx=0.5, rely=0.46, anchor="center")

        activity = ttk.Frame(panel, style="Card.TFrame", padding=(10, 6))
        activity.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        ttk.Label(activity, text=t("Agent activity", "에이전트 진행 상황"), style="Surface.TLabel",
                  font=(FONT, TEXT_SIZE, "bold")).pack(anchor="w", pady=(0, 5))
        table_area = ttk.Frame(activity, style="Surface.TFrame")
        table_area.pack(fill="x")
        ttk.Style().configure("Activity.Treeview", rowheight=22)
        agents = ([coder] if coder else []) + reviewers
        self.table = ttk.Treeview(table_area, columns=("agent", "state", "usage"), show="headings",
                                  height=max(1, min(3, len(agents))), style="Activity.Treeview")
        for column, label, width in (
            ("agent", t("Agent", "에이전트"), 125),
            ("state", t("Status / last activity", "상태 / 마지막 활동"), 290),
            ("usage", t("Tokens in / out", "입력 / 출력 토큰"), 165),
        ):
            anchor = "e" if column == "usage" else "w"
            self.table.heading(column, text=label, anchor=anchor)
            self.table.column(column, width=width, minwidth=95, anchor=anchor)
        scroll = ttk.Scrollbar(table_area, command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(side="top", fill="x")
        self.table.tag_configure("active", foreground=colors["accent"])
        self.table.tag_configure("failed", foreground=colors["error"])
        self.table.tag_configure("done", foreground=colors["success"])
        for name in agents:
            self.table.insert("", "end", iid=name, values=(names[name], t("Ready", "준비"), self.token_text(name)))
        ttk.Label(activity, text=t("Reported usage in this project. — means no data.",
                                  "이 프로젝트에서 보고된 사용량입니다. —는 데이터 없음입니다."),
                  style="Surface.Muted.TLabel").pack(anchor="w", pady=(3, 0))
        composer = ttk.Frame(panel, style="Card.TFrame", padding=(9, 7))
        composer.grid(row=3, column=0, sticky="ew")
        self.input = tk.Text(composer, height=3, wrap="word", padx=6, pady=4, font=(FONT, TEXT_SIZE),
                             relief="flat", borderwidth=0, highlightthickness=0, background=colors["surface"],
                             foreground=colors["text"], insertbackground=colors["text"],
                             selectbackground=colors["selection"], selectforeground=colors["text"])
        self.input.pack(fill="x")
        self.input.bind("<Return>", lambda _: (self.send(), "break")[1])
        self.input.bind("<Shift-Return>", self.insert_newline)
        actions = ttk.Frame(composer, style="Surface.TFrame")
        actions.pack(fill="x", pady=(4, 0))
        self.send_button = ttk.Button(actions, text=t("Send  ↑", "보내기  ↑"), command=self.send, style="Primary.TButton")
        self.send_button.pack(side="right")
        ttk.Label(actions, text=t("Enter to send  ·  Shift+Enter for a new line",
                                   "Enter 전송  ·  Shift+Enter 줄바꿈"), style="Surface.Muted.TLabel").pack(side="left", padx=6)
        self.progress = ttk.Progressbar(panel, mode="indeterminate")
        self.progress.grid(row=4, column=0, sticky="ew", pady=(5, 0))
        self.progress.grid_remove()
        for item in self.messages:
            self.render(item)
        if self.messages:
            self.view.after_idle(lambda: self.view.yview_moveto(1.0))
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
        if user:
            self.view.insert("end", item["text"] + "\n", "request")
        else:
            in_code = False
            for line in item["text"].split("\n"):
                if line.lstrip().startswith("```"):
                    in_code = not in_code
                elif in_code:
                    self.view.insert("end", line + "\n", "code")
                elif line.startswith(("# ", "## ", "### ", "#### ")):
                    self.view.insert("end", line.lstrip("#").lstrip() + "\n", "heading")
                else:
                    self.view.insert("end", line + "\n", "body")
        self.view.configure(state="disabled")
        if self.view.winfo_ismapped():
            self.view.see("end")

    def add(self, role, text):
        if self.empty:
            self.empty.destroy()
            self.empty = None
        item = {"role": role, "text": text}
        self.messages.append(item)
        self.render(item)
        self.save()

    def token_text(self, name):
        return " / ".join(self.token_values(name))

    def token_values(self, name):
        totals = self.usage.get(name, {})
        return tuple(f"{totals[key]:,}" if key in totals else "—" for key in ("input_tokens", "output_tokens"))

    def pause(self, paused):
        self.paused = paused
        self.send_button.state(["disabled" if paused or self.busy else "!disabled"])

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
        if self.busy or self.paused or not request:
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
        self.progress.grid()
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
                elif event == "limits":
                    self.on_limits(name, detail)
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
                self.progress.grid_remove()
                self.pause(self.paused)
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
