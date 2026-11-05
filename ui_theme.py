"""Shared desktop colors and control styles."""
from tkinter import ttk


PALETTES = {
    "light": {
        "window": "#f4f6f9", "surface": "#ffffff", "subtle": "#edf1f6", "line": "#dce3ed",
        "text": "#172333", "muted": "#53647b", "accent": "#2a56b4", "hover": "#224898",
        "selection": "#dfeafe", "user": "#eaf1ff", "success": "#19694c", "error": "#a52b46",
        "shade": "#788698",
    },
    "dark": {
        "window": "#121722", "surface": "#191f2b", "subtle": "#232c3b", "line": "#343e50",
        "text": "#e8eef7", "muted": "#acbbcf", "accent": "#88aaff", "hover": "#a2bbff",
        "selection": "#2a4069", "user": "#233656", "success": "#79d6af", "error": "#ff9eae",
        "shade": "#080a10",
    },
}
FONT = "Segoe UI"
TEXT_SIZE = 9


def install(root, mode):
    colors = PALETTES[mode]
    root.configure(background=colors["window"])
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(".", font=(FONT, TEXT_SIZE), background=colors["window"], foreground=colors["text"],
                    bordercolor=colors["line"], lightcolor=colors["line"], darkcolor=colors["line"],
                    fieldbackground=colors["surface"], focuscolor=colors["accent"])
    style.configure("Surface.TFrame", background=colors["surface"])
    style.configure("Surface.TLabel", background=colors["surface"])
    style.configure("Muted.TLabel", foreground=colors["muted"])
    style.configure("Surface.Muted.TLabel", background=colors["surface"], foreground=colors["muted"])
    style.configure("Note.TFrame", background=colors["subtle"])
    style.configure("Note.TLabel", background=colors["subtle"], foreground=colors["muted"])
    style.configure("Card.TFrame", background=colors["surface"], borderwidth=1, relief="solid")
    style.configure("TButton", background=colors["subtle"], padding=(10, 5), borderwidth=1)
    style.map("TButton", background=[("active", colors["selection"])],
              foreground=[("disabled", colors["muted"])])
    ink = "#ffffff" if mode == "light" else "#121722"
    style.configure("Primary.TButton", background=colors["accent"], foreground=ink,
                    bordercolor=colors["accent"], lightcolor=colors["accent"], darkcolor=colors["accent"])
    style.map("Primary.TButton", background=[("disabled", colors["subtle"]), ("active", colors["hover"])],
              foreground=[("disabled", colors["muted"]), ("!disabled", ink)])
    style.configure("Treeview", background=colors["surface"], foreground=colors["text"],
                    fieldbackground=colors["surface"], rowheight=22, borderwidth=1)
    style.map("Treeview", background=[("selected", colors["selection"])],
              foreground=[("selected", colors["text"])])
    style.configure("Treeview.Heading", background=colors["subtle"], foreground=colors["muted"],
                    font=(FONT, TEXT_SIZE, "bold"), padding=(5, 3), relief="flat", borderwidth=0)
    style.map("Treeview.Heading", background=[("active", colors["selection"])])
    style.configure("TCombobox", padding=3, arrowcolor=colors["muted"])
    style.map("TCombobox", fieldbackground=[("readonly", colors["surface"])],
              selectbackground=[("readonly", colors["selection"])], selectforeground=[("readonly", colors["text"])])
    style.configure("TEntry", padding=4, insertcolor=colors["text"])
    style.configure("TCheckbutton", indicatorcolor=colors["surface"])
    style.map("TCheckbutton", indicatorcolor=[("selected", colors["accent"])],
              background=[("active", colors["subtle"])])
    style.configure("TScrollbar", background=colors["subtle"], troughcolor=colors["surface"],
                    arrowcolor=colors["muted"])
    style.configure("TSeparator", background=colors["line"])
    style.configure("Horizontal.TProgressbar", background=colors["accent"], troughcolor=colors["subtle"],
                    lightcolor=colors["accent"], darkcolor=colors["accent"], borderwidth=0, thickness=3)
    root.option_add("*TCombobox*Listbox.background", colors["surface"])
    root.option_add("*TCombobox*Listbox.foreground", colors["text"])
    root.option_add("*TCombobox*Listbox.selectBackground", colors["selection"])
    root.option_add("*TCombobox*Listbox.selectForeground", colors["text"])
    return colors


def blend(color, shade, opacity=0.32):
    def rgb(value):
        return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))

    return "#" + "".join(f"{round(a + (b - a) * opacity):02x}" for a, b in zip(rgb(color), rgb(shade)))
