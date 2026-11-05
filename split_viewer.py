"""Side-by-side, independently scrollable agent reports."""
import tkinter as tk
from tkinter import font, ttk

from markdown_view import MarkdownView
from ui_theme import FONT


class SplitViewer(ttk.Panedwindow):
    def __init__(self, parent, agents, messages, names, colors, translate, stage_title):
        super().__init__(parent, orient="horizontal")
        self.names, self.colors, self.t = names, colors, translate
        self.stage_title = stage_title
        self.messages = messages
        self.agents = agents
        self.states = {}
        self.activity = {}
        self.note_font = font.Font(root=self, family=FONT, size=9)
        self.panes = [self.make_pane(name) for name in agents[:2]]

    def make_pane(self, name):
        frame = ttk.Frame(self, style="Card.TFrame", padding=8)
        self.add(frame, weight=1)
        head = ttk.Frame(frame, style="Surface.TFrame")
        head.pack(fill="x")
        controls = ttk.Frame(head, style="Surface.TFrame")
        controls.pack(fill="x")
        picker = ttk.Combobox(controls, values=[self.names[a] for a in self.agents], width=15, state="readonly")
        picker.set(self.names[name])
        picker.pack(side="left", fill="x", expand=True)
        toggle = ttk.Button(controls, text=self.t("Activity", "활동 기록"))
        toggle.pack(side="right", padx=(6, 0))
        status = ttk.Label(head, style="Surface.Muted.TLabel", font=(FONT, 9))
        status.pack(fill="x", pady=(5, 3))
        ttk.Separator(frame).pack(fill="x")
        body = ttk.Frame(frame, style="Surface.TFrame")
        body.pack(fill="both", expand=True)
        view = tk.Text(body, width=1, height=1, wrap="word", padx=8, pady=6, state="disabled",
                       background=self.colors["surface"], foreground=self.colors["text"],
                       selectbackground=self.colors["selection"], selectforeground=self.colors["text"],
                       font=(FONT, 10), relief="flat", borderwidth=0, highlightthickness=0)
        scroll = ttk.Scrollbar(body, command=view.yview)
        view.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        view.pack(side="left", fill="both", expand=True)
        log = tk.Text(body, width=1, height=1, wrap="word", padx=10, pady=7, state="disabled",
                      background=self.colors["surface"], foreground=self.colors["text"],
                      selectbackground=self.colors["selection"], selectforeground=self.colors["text"],
                      font=(FONT, 9), relief="flat", borderwidth=0, highlightthickness=0)
        log.tag_configure("clock", foreground=self.colors["muted"], font=(FONT, 9, "bold"), spacing1=6)
        log.tag_configure("phase", foreground=self.colors["accent"], font=(FONT, 9, "bold"))
        log.tag_configure("note", spacing3=3)
        footer = ttk.Frame(frame, style="Note.TFrame", padding=(6, 4))
        footer.pack(fill="x", pady=(5, 0))
        ttk.Label(footer, text=self.t("Note", "작업 메모"), style="Note.TLabel",
                  font=(FONT, 9, "bold")).pack(side="left", padx=(0, 6))
        note = ttk.Label(footer, style="Note.TLabel", width=1)
        note.pack(side="left", fill="x", expand=True)
        pane = {"name": name, "view": view, "picker": picker, "status": status,
                "note": note, "log": log, "toggle": toggle, "scroll": scroll, "show_log": False,
                "log_key": None, "markdown": MarkdownView(view, self.colors)}
        toggle.configure(command=lambda: self.set_log(pane, not pane["show_log"]))
        picker.bind("<<ComboboxSelected>>", lambda _: self.select(pane, self.agents[picker.current()]))
        self.select(pane, name)
        return pane

    def matches(self, pane, role):
        return role in {pane["name"], self.names[pane["name"]], "Agent Council"}

    def select(self, pane, name):
        pane["name"] = name
        view = pane["view"]
        view.configure(state="normal")
        for child in view.winfo_children():
            child.destroy()
        for tag in view.tag_names():
            if tag.startswith("md_url_"):
                view.tag_delete(tag)
        pane["markdown"].tables.clear()
        view.delete("1.0", "end")
        start = next((i + 1 for i in range(len(self.messages) - 1, -1, -1)
                      if self.messages[i]["role"] == "You"), 0)
        matching = [item for item in self.messages[start:] if self.matches(pane, item["role"])]
        pane["placeholder"] = not matching
        if not matching:
            view.insert("end", self.t("Reports will appear here.", "답변과 검수 결과가 여기에 표시됩니다."), "md_quote")
        for index, item in enumerate(matching):
            if index:
                view.insert("end", "\n────────────\n\n", "md_rule")
            self.render_item(pane, item)
        view.configure(state="disabled")
        view.yview_moveto(0)
        if name == "council" and pane["show_log"]:
            self.set_log(pane, False)
        self.refresh_pane(pane)

    def render_item(self, pane, item):
        if title := self.stage_title(item.get("stage")):
            pane["view"].insert("end", title + "\n", "md_h3")
        pane["markdown"].render(item["text"])

    def show_agent(self, index, name, *, show_log=None):
        if name in self.agents:
            pane = self.panes[index]
            pane["picker"].current(self.agents.index(name))
            self.select(pane, name)
            if show_log is not None:
                self.set_log(pane, show_log)

    def append(self, item):
        if item["role"] == "You":
            for index, pane in enumerate(self.panes):
                name = pane["name"]
                self.show_agent(index, self.agents[index] if name == "council" else name)
            return
        for pane in self.panes:
            if not self.matches(pane, item["role"]):
                continue
            view = pane["view"]
            follow = view.yview()[1] >= 0.99
            view.configure(state="normal")
            if pane["placeholder"]:
                view.delete("1.0", "end")
                pane["placeholder"] = False
            if view.index("end-1c") != "1.0":
                view.insert("end", "\n────────────\n\n", "md_rule")
            start = view.index("end-1c")
            self.render_item(pane, item)
            view.configure(state="disabled")
            if follow:
                view.yview(start)

    def refresh(self, states, activity):
        self.states, self.activity = states, activity
        for pane in self.panes:
            self.refresh_pane(pane)

    def refresh_pane(self, pane):
        name = pane["name"]
        pane["status"].configure(text=self.states.get(name, self.t("History", "기록")))
        pane["toggle"].state(["disabled" if name == "council" else "!disabled"])
        events = self.activity.get(name, [])
        latest = next((row["text"] for row in reversed(events) if row["kind"] == "note"), "")
        empty = (self.t("Summary of the agents' findings", "에이전트 의견을 모은 보고서") if name == "council" else
                 self.t("No notes yet", "아직 남겨진 메모가 없어요"))
        note = latest or empty
        width = pane["note"].winfo_width() - 3
        if width > 10 and self.note_font.measure(note) > width:
            end = max(1, int(len(note) * width / self.note_font.measure(note)))
            while end > 1 and self.note_font.measure(note[:end] + "…") > width:
                end -= 1
            note = note[:end].rstrip() + "…"
        pane["note"].configure(text=note)
        if pane["show_log"]:
            self.render_log(pane, events)

    def set_log(self, pane, enabled):
        pane["show_log"] = enabled
        hidden, visible = (pane["view"], pane["log"]) if enabled else (pane["log"], pane["view"])
        hidden.pack_forget()
        visible.pack(side="left", fill="both", expand=True)
        pane["scroll"].configure(command=visible.yview)
        visible.configure(yscrollcommand=pane["scroll"].set)
        pane["toggle"].configure(text=self.t("Report", "답변 보기") if enabled else self.t("Activity", "활동 기록"))
        self.refresh_pane(pane)

    def render_log(self, pane, events):
        key = (pane["name"], tuple((row["at"], row["kind"], row["text"]) for row in events))
        if key == pane["log_key"]:
            return
        log = pane["log"]
        same_agent = pane["log_key"] and pane["log_key"][0] == key[0]
        follow = not same_agent or log.yview()[1] >= 0.99
        first = log.index("@0,0") if same_agent else "1.0"
        pane["log_key"] = key
        log.configure(state="normal")
        log.delete("1.0", "end")
        if not events:
            log.insert("end", self.t("Activity will be recorded here.", "작업 단계와 메모가 여기에 남습니다."))
        for row in events:
            minutes, seconds = divmod(row["at"], 60)
            log.insert("end", f"{minutes:02d}:{seconds:02d}  ", "clock")
            log.insert("end", row["text"] + "\n", "phase" if row["kind"] == "phase" else "note")
        log.configure(state="disabled")
        if follow:
            log.see("end")
        else:
            log.yview(first)
