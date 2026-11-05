"""Side-by-side, independently scrollable agent reports."""
import tkinter as tk
from tkinter import ttk

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
        self.previews = {}
        self.panes = [self.make_pane(name) for name in agents[:2]]

    def make_pane(self, name):
        frame = ttk.Frame(self, style="Card.TFrame", padding=8)
        self.add(frame, weight=1)
        head = ttk.Frame(frame, style="Surface.TFrame")
        head.pack(fill="x")
        picker = ttk.Combobox(head, values=[self.names[a] for a in self.agents], width=15, state="readonly")
        picker.set(self.names[name])
        picker.pack(anchor="w")
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
        preview = ttk.Label(frame, style="Surface.Muted.TLabel", justify="left")
        frame.bind("<Configure>", lambda event: preview.configure(wraplength=max(80, event.width - 28)))
        pane = {"name": name, "view": view, "picker": picker, "status": status,
                "preview": preview, "markdown": MarkdownView(view, self.colors)}
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
        view.yview_moveto(1.0)
        self.refresh_pane(pane)

    def render_item(self, pane, item):
        if title := self.stage_title(item.get("stage")):
            pane["view"].insert("end", title + "\n", "md_h3")
        pane["markdown"].render(item["text"])

    def show_agent(self, index, name):
        if name in self.agents:
            pane = self.panes[index]
            pane["picker"].current(self.agents.index(name))
            self.select(pane, name)

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
            self.render_item(pane, item)
            view.configure(state="disabled")
            if follow:
                view.see("end")

    def refresh(self, states, previews):
        self.states, self.previews = states, previews
        for pane in self.panes:
            self.refresh_pane(pane)

    def refresh_pane(self, pane):
        name = pane["name"]
        pane["status"].configure(text=self.states.get(name, self.t("History", "기록")))
        preview = self.previews.get(name, "")
        if preview:
            pane["preview"].configure(text=self.t("Live output · ", "실시간 출력 · ") + preview)
            if not pane["preview"].winfo_manager():
                pane["preview"].pack(fill="x", pady=(5, 0))
        else:
            pane["preview"].pack_forget()
