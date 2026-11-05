"""Keep the Windows IME composition in sync with the chat input."""
import ctypes as c
from ctypes import wintypes as w
import sys
from tkinter import font


WM_KILLFOCUS = 0x0008
WM_SETFOCUS = 0x0007
WM_NCDESTROY = 0x0082
WM_SYSKEYDOWN = 0x0104
WM_IME_STARTCOMPOSITION = 0x010D
WM_IME_ENDCOMPOSITION = 0x010E
WM_IME_COMPOSITION = 0x010F
WM_IME_SETCONTEXT = 0x0281
GCS_COMPSTR = 0x0008
GCS_RESULTSTR = 0x0800
NI_COMPOSITIONSTR = 0x0015
CPS_COMPLETE = 0x0001
CPS_CANCEL = 0x0004


class LOGFONT(c.Structure):
    _fields_ = [
        ("height", w.LONG), ("width", w.LONG), ("escapement", w.LONG),
        ("orientation", w.LONG), ("weight", w.LONG), ("italic", w.BYTE),
        ("underline", w.BYTE), ("strikeout", w.BYTE), ("charset", w.BYTE),
        ("out_precision", w.BYTE), ("clip_precision", w.BYTE), ("quality", w.BYTE),
        ("pitch_family", w.BYTE), ("face", w.WCHAR * 32),
    ]


def bind(dll, name, result, *args):
    function = getattr(dll, name)
    function.restype = result
    function.argtypes = args
    return function


class WindowsComposition:
    def __init__(self, widget):
        self.widget = widget
        actual = font.Font(root=widget, font=widget.cget("font")).actual()
        self.logical_font = LOGFONT(
            height=-round(abs(actual["size"]) * widget.winfo_fpixels("1p")),
            weight=400, charset=1, face=actual["family"][:31],
        )
        self.finishing = False
        self.active = False
        self.preedit = ""
        self.pending = []
        self.handles = set()
        imm = c.WinDLL("imm32")
        context = w.HANDLE
        self.get_context = bind(imm, "ImmGetContext", context, w.HWND)
        self.release_context = bind(imm, "ImmReleaseContext", w.BOOL, w.HWND, context)
        self.set_font = bind(imm, "ImmSetCompositionFontW", w.BOOL, context, c.POINTER(LOGFONT))
        self.get_string = bind(imm, "ImmGetCompositionStringW", w.LONG, context, w.DWORD, c.c_void_p, w.DWORD)
        self.notify = bind(imm, "ImmNotifyIME", w.BOOL, context, w.DWORD, w.DWORD, w.DWORD)
        controls = c.WinDLL("comctl32")
        proc = c.WINFUNCTYPE(c.c_ssize_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM, c.c_size_t, c.c_size_t)
        self.next_message = bind(controls, "DefSubclassProc", c.c_ssize_t, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
        self.remove = bind(controls, "RemoveWindowSubclass", w.BOOL, w.HWND, proc, c.c_size_t)
        self.subclass = bind(controls, "SetWindowSubclass", w.BOOL, w.HWND, proc, c.c_size_t, c.c_size_t)
        self.get_focus = bind(c.WinDLL("user32"), "GetFocus", w.HWND)
        self.callback = proc(self.window_message)
        self.attach(widget.winfo_id())
        widget.bind("<FocusIn>", self.focus_in, add="+")
        widget.bind("<FocusOut>", self.focus_out, add="+")
        widget.bind("<Destroy>", self.close, add="+")
        self.poll = widget.after(30, self.flush)

    def attach(self, hwnd):
        if hwnd and hwnd not in self.handles and self.subclass(hwnd, self.callback, 1, 0):
            self.handles.add(hwnd)

    def focus_in(self, _event):
        self.active = True
        top = self.widget.winfo_toplevel()
        self.focus_handle = self.get_focus()
        handles = {top.winfo_id(), int(str(top.tk.call("wm", "frame", top._w)), 0), self.focus_handle}
        for hwnd in handles:
            self.attach(hwnd)
        self.apply_font(self.focus_handle)

    def focus_out(self, _event):
        if self.active and self.focus_handle:
            self.complete(self.focus_handle)
        self.active = False
        self.flush_pending()

    def close(self, _event):
        self.widget.after_cancel(self.poll)
        for hwnd in self.handles.copy():
            self.remove(hwnd, self.callback, 1)
        self.handles.clear()

    def apply_font(self, hwnd):
        if not hwnd:
            return
        context = self.get_context(hwnd)
        if context:
            try:
                self.set_font(context, c.byref(self.logical_font))
            finally:
                self.release_context(hwnd, context)

    def window_message(self, hwnd, message, wparam, lparam, subclass, _ref):
        if message == WM_NCDESTROY:
            self.remove(hwnd, self.callback, subclass)
            self.handles.discard(hwnd)
        if self.active and (message == WM_KILLFOCUS or (message == WM_IME_SETCONTEXT and not wparam) or
                            (message == WM_SYSKEYDOWN and wparam in (0x09, 0x12))):
            self.complete(hwnd)
        if message == WM_IME_ENDCOMPOSITION or (message == WM_IME_COMPOSITION and lparam & GCS_RESULTSTR):
            self.preedit = ""
        if self.active and not self.finishing and (message == WM_IME_STARTCOMPOSITION or
                (message == WM_IME_COMPOSITION and lparam & GCS_COMPSTR)):
            context = self.get_context(hwnd)
            if context:
                try:
                    self.preedit = self.read(context)
                finally:
                    self.release_context(hwnd, context)
        result = self.next_message(hwnd, message, wparam, lparam)
        if self.active and message in (WM_SETFOCUS, WM_IME_STARTCOMPOSITION):
            self.apply_font(hwnd)
        return result

    def complete(self, hwnd):
        if self.finishing:
            return
        context = self.get_context(hwnd)
        if not context:
            return
        self.finishing = True
        try:
            text = self.read(context) or self.preedit
            if not text:
                return
            self.preedit = ""
            if self.notify(context, NI_COMPOSITIONSTR, CPS_CANCEL, 0):
                # Tk can discard an IME result posted while its focus is changing.
                # Insert the captured preedit on the Tcl event loop, outside the Win32 callback.
                self.pending.append(text)
            else:
                self.notify(context, NI_COMPOSITIONSTR, CPS_COMPLETE, 0)
        finally:
            self.release_context(hwnd, context)
            self.finishing = False

    def read(self, context):
        length = self.get_string(context, GCS_COMPSTR, None, 0)
        if length <= 0:
            return ""
        buffer = c.create_string_buffer(length)
        copied = self.get_string(context, GCS_COMPSTR, buffer, length)
        return buffer.raw[:copied].decode("utf-16-le", errors="replace") if copied > 0 else ""

    def flush_pending(self):
        if self.pending:
            text = "".join(self.pending)
            self.pending.clear()
            self.widget.insert("insert", text)

    def flush(self):
        self.flush_pending()
        self.poll = self.widget.after(30, self.flush)


def install(widget):
    if sys.platform == "win32":
        widget.windows_composition = WindowsComposition(widget)
