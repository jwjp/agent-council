"""Render Markdown as selectable Tk text with local table widgets."""
import tkinter as tk
from urllib.parse import urlsplit
import webbrowser

import mistune
from mistune.plugins.formatting import strikethrough
from mistune.plugins.table import table
from mistune.plugins.task_lists import task_lists

from ui_theme import FONT

parse = mistune.create_markdown(renderer="ast", plugins=[table, strikethrough, task_lists])


class MarkdownView:
    def __init__(self, view, colors):
        self.view, self.colors = view, colors
        self.tables = []
        self.link_index = 0
        self.wheel_delta = 0
        for name, options in {
            "md_paragraph": {"spacing1": 2, "spacing3": 7},
            "md_h1": {"font": (FONT, 15, "bold"), "spacing1": 10, "spacing3": 6},
            "md_h2": {"font": (FONT, 13, "bold"), "spacing1": 9, "spacing3": 5},
            "md_h3": {"font": (FONT, 11, "bold"), "spacing1": 7, "spacing3": 4},
            "md_strong": {"font": (FONT, 10, "bold")},
            "md_emphasis": {"font": (FONT, 10, "italic")},
            "md_bolditalic": {"font": (FONT, 10, "bold italic")},
            "md_strikethrough": {"overstrike": True},
            "md_quote": {"background": colors["subtle"], "foreground": colors["muted"],
                         "lmargin1": 14, "lmargin2": 14, "rmargin": 12},
            "md_code": {"font": ("Consolas", 9), "background": colors["subtle"],
                        "lmargin1": 10, "lmargin2": 10, "rmargin": 10},
            "md_inline": {"font": ("Consolas", 9), "background": colors["subtle"]},
            "md_link": {"foreground": colors["accent"], "underline": True},
            "md_rule": {"foreground": colors["line"], "spacing1": 4, "spacing3": 4},
        }.items():
            view.tag_configure(name, **options)
        view.bind("<Configure>", self.resize_tables, add="+")

    def render(self, source):
        self.blocks(parse(source))

    def put(self, value, tags=()):
        self.view.insert("end", value, tags)

    def blocks(self, nodes, tags=(), depth=0):
        for node in nodes:
            kind = node["type"]
            children = node.get("children", [])
            attrs = node.get("attrs", {})
            if kind in ("paragraph", "block_text", "heading"):
                style = f"md_h{min(3, attrs['level'])}" if kind == "heading" else "md_paragraph"
                paragraph = tags + ((style,) if kind != "block_text" else ())
                self.inline(children, paragraph)
                self.put("\n", paragraph)
            elif kind == "list":
                marker = attrs.get("start", 1)
                indent = f"md_list{depth}"
                self.view.tag_configure(indent, lmargin1=depth * 18 + 8, lmargin2=depth * 18 + 25, spacing3=2)
                for item in children:
                    if item["type"] == "task_list_item":
                        prefix = "☑" if item.get("attrs", {}).get("checked") else "☐"
                    else:
                        prefix = f"{marker}." if attrs.get("ordered") else "•"
                    marker += 1
                    item_tags = tags + (indent,)
                    self.put(prefix + "  ", item_tags)
                    for part in item.get("children", []):
                        if part["type"] == "list":
                            self.blocks([part], tags, depth + 1)
                        else:
                            self.blocks([part], item_tags, depth + 1)
            elif kind == "block_quote":
                self.blocks(children, tags + ("md_quote",), depth)
            elif kind == "block_code":
                self.put(node.get("raw", "").rstrip("\n") + "\n", tags + ("md_code",))
                self.put("\n")
            elif kind == "table":
                self.add_table(children)
            elif kind == "thematic_break":
                self.put("────────────\n", tags + ("md_rule",))
            elif kind != "blank_line":
                if node.get("raw"):
                    self.put(node["raw"].rstrip("\n") + "\n", tags)
                else:
                    self.blocks(children, tags, depth)

    def inline(self, nodes, tags):
        for node in nodes:
            kind = node["type"]
            children = node.get("children", [])
            if kind in ("strong", "emphasis", "strikethrough"):
                extra = ("md_" + kind,)
                if (kind == "strong" and "md_emphasis" in tags) or (kind == "emphasis" and "md_strong" in tags):
                    extra += ("md_bolditalic",)
                self.inline(children, tags + extra)
            elif kind == "codespan":
                self.put(node.get("raw", ""), tags + ("md_inline",))
            elif kind in ("softbreak", "linebreak"):
                self.put("\n", tags)
            elif kind == "link":
                url = node.get("attrs", {}).get("url", "")
                try:
                    parts = urlsplit(url)
                    safe = parts.scheme in {"https", "http"} and bool(parts.hostname)
                except ValueError:
                    safe = False
                if not safe:
                    self.inline(children, tags)
                    continue
                key = f"md_url_{self.link_index}"
                self.link_index += 1
                self.view.tag_bind(key, "<Button-1>", lambda _event, target=url: webbrowser.open(target))
                self.view.tag_bind(key, "<Enter>", lambda _: self.view.configure(cursor="hand2"))
                self.view.tag_bind(key, "<Leave>", lambda _: self.view.configure(cursor="xterm"))
                self.inline(children, tags + ("md_link", key))
            elif children:
                self.inline(children, tags)
            else:
                self.put(node.get("raw", ""), tags)

    def add_table(self, nodes):
        rows = []
        for node in nodes:
            if node["type"] == "table_head":
                rows.append(node["children"])
            elif node["type"] == "table_body":
                rows.extend(row["children"] for row in node["children"])
        if not rows or not rows[0]:
            return
        frame = tk.Frame(self.view, background=self.colors["line"], padx=1, pady=1, borderwidth=0)
        self.bind_table_scroll(frame)
        cells = []
        for index, row in enumerate(rows):
            for column, cell in enumerate(row):
                label = tk.Label(frame, text=self.plain(cell.get("children", [])), justify="left", anchor="nw",
                                 font=(FONT, 9, "bold" if index == 0 else "normal"),
                                 foreground=self.colors["text"],
                                 background=self.colors["subtle" if index == 0 else "surface"], padx=8, pady=5)
                label.grid(row=index, column=column, sticky="nsew", padx=(0, 1), pady=(0, 1))
                self.bind_table_scroll(label)
                cells.append(label)
        self.view.window_create("end", window=frame, padx=1, pady=5)
        self.put("\n")
        self.tables.append((len(rows[0]), cells))
        self.resize_tables()

    @staticmethod
    def plain(nodes):
        return "".join(node.get("raw", "") or MarkdownView.plain(node.get("children", [])) for node in nodes)

    def resize_tables(self, _event=None):
        available = max(120, self.view.winfo_width() - 42)
        for columns, cells in self.tables:
            width = max(10, min(240, available // columns - 18))
            for cell in cells:
                cell.configure(wraplength=width)

    def bind_table_scroll(self, widget):
        widget.bind("<MouseWheel>", self.scroll_table)
        widget.bind("<Button-4>", self.scroll_table)
        widget.bind("<Button-5>", self.scroll_table)

    def scroll_table(self, event):
        if event.num in (4, 5):
            steps = 1 if event.num == 4 else -1
        else:
            self.wheel_delta += event.delta
            steps = int(self.wheel_delta / 120)
            self.wheel_delta -= steps * 120
        if steps:
            self.view.yview_scroll(-steps * 3, "units")
        return "break"
