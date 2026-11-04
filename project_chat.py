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


def project_turn(cwd, messages, request, plan, execute, full_access, coder, reviewers, language, emit):
    history = "\n\n".join(f"{item['role']}: {item['text'][:3200]}" for item in messages[-10:])
    context = (
        f"Respond in {language}. The working directory is the selected project. "
        "Treat history and review material as context. Follow the current user request. "
        "If the latest message answers a previous clarification, continue the underlying task using that answer. "
        "If a consequential decision cannot be inferred from the project or the conversation, "
        "start with QUESTION on its own line and ask the user before proceeding.\n"
        f"<history>{history}</history>\n<request>{request}</request>"
    )
    if not execute:
        emit("Planning", coder)
        result = call(coder, context + "\nStart with PLAN on its own line if the user requests changes or commands. "
                      "Then explain the proposed plan and checks. Otherwise start with ANSWER and answer directly. "
                      "Do not modify files.", cwd)
        if not result["ok"]:
            return [(coder, result["error"] or "Planning failed.")], ""
        kind, response = response_parts(result["text"])
        return [(coder, response)], response if kind == "PLAN" else ""

    baseline = git_context(cwd) if reviewers else ""
    emit("Implementing", coder)
    result = call(
        coder, context + f"\n<approved_plan>{plan}</approved_plan>\n"
        "Carry out requested actions, including dependency installation when required. "
        "Preserve unrelated changes. For an informational request, start with ANSWER and answer directly. "
        "Start with IMPLEMENTED if you performed implementation work. "
        "Report changed paths, what you verified, and any command that was blocked.",
        cwd, implement=True, full_access=full_access,
    )
    if not result["ok"]:
        return [(coder, result["error"] or "Implementation failed.")], ""
    kind, report = response_parts(result["text"])
    entries = [(coder, report)]
    if not reviewers or kind in {"ANSWER", "QUESTION"}:
        return entries, ""

    changed = git_context(cwd)
    review_prompt = (
        f"Review the coding agent's work for the request. Write in {language}. Inspect only files relevant to this task. "
        "Do not modify files. Compare the before and after evidence and distinguish pre-existing edits. "
        "Check whether the implementation direction fits the request, and identify bugs or missed requirements. "
        "Start with FIX_REQUIRED only if there is a concrete actionable issue, otherwise start with PASS. "
        "Give file references or evidence. State any limits.\n"
        f"<request>{request}</request>\n<approved_plan>{plan[:3000]}</approved_plan>\n<report>{report[:3500]}</report>\n"
        f"<before>{baseline[:3500]}</before>\n<after>{changed[:6500]}</after>"
    )
    reviews = parallel(reviewers, review_prompt, cwd, 2,
                       lambda _, name, value: emit("Reviewed" if name else "Reviewing", name), review=True)
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
            cwd, implement=True, full_access=full_access,
        )
        entries.append((coder, response_parts(revision["text"])[1] if revision["ok"] else revision["error"] or "Revision failed."))
    return entries, ""


def response_parts(text):
    first, _, rest = text.partition("\n")
    kind = first.strip(" *`:#").upper()
    if kind in {"PLAN", "ANSWER", "QUESTION", "IMPLEMENTED", "PASS", "FIX_REQUIRED"} and rest.strip():
        return kind, rest.strip()
    return "", text


class ProjectChat:
    def __init__(self, parent, cwd, coder, reviewers, language, state_root, names, auto):
        self.cwd, self.coder, self.reviewers, self.language, self.names = cwd, coder, reviewers, language, names
        self.events = queue.Queue()
        self.busy = False
        key = hashlib.sha256(str(cwd).casefold().encode()).hexdigest()
        self.path = state_root / "chats" / f"{key}.json"
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        self.messages = state.get("messages", [])
        self.pending = state.get("pending")
        self.auto = tk.BooleanVar(value=auto)
        self.full = tk.BooleanVar(value=False)
        t = self.t
        panel = self.panel = ttk.Frame(parent, padding=(0, 12, 0, 0))
        panel.pack(fill="both", expand=True)
        ttk.Label(panel, text=t("Coding", "코딩") + " · " + names[coder] + "   |   " + t("Review", "검수") + " · " +
                  (", ".join(names.get(agent, agent) for agent in reviewers) or t("None", "없음"))).pack(anchor="w", pady=(3, 8))
        options = ttk.Frame(panel)
        options.pack(fill="x")
        ttk.Checkbutton(options, text=t("Run automatically", "자동 진행"), variable=self.auto).pack(side="left")
        ttk.Checkbutton(options, text=t("Full execution access", "전체 실행 권한"), variable=self.full, command=self.toggle_full).pack(side="left", padx=12)
        transcript = ttk.Frame(panel)
        transcript.pack(fill="both", expand=True, pady=8)
        self.view = tk.Text(transcript, wrap="word", padx=14, pady=10, state="disabled", background="#f4f6fa",
                            foreground="#172238", font=("Segoe UI", 11), relief="flat")
        scrollbar = ttk.Scrollbar(transcript, command=self.view.yview)
        self.view.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.view.pack(side="left", fill="both", expand=True)
        self.view.tag_configure("author", foreground="#3151a5", font=("Segoe UI", 11, "bold"), spacing1=8)
        self.input = tk.Text(panel, height=4, wrap="word", font=("Segoe UI", 11))
        self.input.pack(fill="x")
        self.input.bind("<Control-Return>", lambda _: (self.send(), "break")[1])
        actions = ttk.Frame(panel)
        actions.pack(fill="x", pady=(8, 0))
        self.send_button = ttk.Button(actions, text=t("Send", "보내기"), command=self.send)
        self.send_button.pack(side="right")
        self.approve_button = ttk.Button(actions, text=t("Approve and run", "승인 후 실행"), command=self.approve)
        self.approve_button.pack(side="right", padx=8)
        self.status = ttk.Label(actions, text=t("Ready", "준비"))
        self.status.pack(side="left")
        self.progress = ttk.Progressbar(panel, mode="indeterminate")
        self.progress.pack(fill="x", pady=(8, 0))
        for item in self.messages:
            self.render(item)
        self.buttons()
        self.input.focus_set()
        self.poll_id = self.panel.after(200, self.poll)

    def t(self, english, korean):
        return korean if self.language == "Korean" else english

    def toggle_full(self):
        if self.full.get() and not messagebox.askyesno(
            "Agent Council",
            self.t(f"Allow {self.names[self.coder]} to run commands and edit files without CLI permission checks?",
                   f"{self.names[self.coder]}가 CLI 권한 확인 없이 명령을 실행하고 파일을 수정하도록 허용할까요?"),
            parent=self.panel,
        ):
            self.full.set(False)

    def render(self, item):
        self.view.configure(state="normal")
        role = self.t("You", "나") if item["role"] == "You" else self.names.get(item["role"], item["role"])
        self.view.insert("end", role + "\n", "author")
        self.view.insert("end", item["text"] + "\n\n")
        self.view.configure(state="disabled")
        self.view.see("end")

    def add(self, role, text):
        item = {"role": role, "text": text}
        self.messages.append(item)
        self.render(item)
        self.save()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps({"messages": self.messages, "pending": self.pending}, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)

    def buttons(self):
        self.send_button.state(["disabled" if self.busy else "!disabled"])
        self.approve_button.state(["!disabled" if self.pending and not self.busy else "disabled"])

    def send(self):
        request = self.input.get("1.0", "end-1c").strip()
        if self.busy or not request:
            return
        if not self.coder_available():
            return
        self.pending = None
        self.input.delete("1.0", "end")
        self.start(request, "", self.auto.get())

    def approve(self):
        if self.pending and not self.busy and self.coder_available():
            request, plan = self.pending
            self.pending = None
            self.start(request, plan, True)

    def coder_available(self):
        if shutil.which(self.coder):
            return True
        messagebox.showerror("Agent Council", self.t("CLI not found on PATH: ", "PATH에서 CLI를 찾을 수 없습니다: ") +
                             self.names[self.coder], parent=self.panel)
        return False

    def start(self, request, plan, execute):
        self.busy = True
        self.started = time.monotonic()
        self.phase = self.t("Starting", "시작 중")
        self.progress.start(15)
        self.buttons()
        history = list(self.messages)
        self.add("You", self.t("Approved implementation", "구현 승인") if plan else request)
        full = self.full.get()

        def worker():
            try:
                entries, proposed = project_turn(
                    self.cwd, history, request, plan, execute, full, self.coder, self.reviewers, self.language,
                    lambda *event: self.events.put(("phase", event)),
                )
                self.events.put(("done", (entries, (request, proposed) if proposed else None)))
            except Exception as exc:
                self.events.put(("done", ([("Agent Council", str(exc))], None)))

        threading.Thread(target=worker, daemon=True).start()

    def poll(self):
        while not self.events.empty():
            kind, value = self.events.get()
            if kind == "phase":
                phase, name = value
                translated = {"Planning": "검토 중", "Implementing": "구현 중", "Reviewing": "교차 검토 중",
                              "Reviewed": "검토 응답 도착", "Revising": "검토 결과 반영 중"}
                self.phase = self.t(phase, translated[phase]) + (f" · {self.names.get(name, name)}" if name else "")
            else:
                entries, self.pending = value
                for role, text in entries:
                    self.add(role, text)
                self.busy = False
                self.progress.stop()
                self.buttons()
                self.status.configure(text=self.t("Ready", "준비"))
        if self.busy:
            self.status.configure(text=f"{self.phase} · {int(time.monotonic() - self.started)}s")
        self.poll_id = self.panel.after(200, self.poll)

    def close(self):
        self.panel.after_cancel(self.poll_id)
        self.panel.destroy()
