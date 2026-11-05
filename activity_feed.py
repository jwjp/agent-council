"""Paced, bounded notes from the agent events visible to the app."""
import re
import time


class ActivityFeed:
    MIN_INTERVAL = 3.0
    QUIET_FOR = 0.8
    MAX_WAIT = 4.0
    LIMIT = 36

    def __init__(self, saved=None):
        self.events = saved if isinstance(saved, dict) else {}
        self.pending = {}
        self.published = {}
        self.last_tool = {}
        self.started = time.monotonic()

    @staticmethod
    def excerpt(text):
        parts = re.split(r"(?<=[.!?。！？])\s+|\n+", text.strip())
        lines = [" ".join(part.lstrip("#>*- ").split()) for part in parts]
        lines = [part for part in lines if len(part) >= 8]
        if not lines:
            return ""
        # Prefer a complete sentence while an unfinished fragment is still arriving.
        note = lines[-1]
        if len(lines) > 1 and not note.endswith((".", "!", "?", "。", "！", "？")) and len(note) < 55:
            note = lines[-2]
        if len(note) > 260:
            note = note[:257].rsplit(" ", 1)[0] + "…"
        return note

    def record(self, name, kind, text, now):
        rows = self.events.setdefault(name, [])
        rows.append({"at": max(0, int(now - self.started)), "kind": kind, "text": text})
        del rows[:-self.LIMIT]

    def phase(self, name, text, now):
        self.publish(name, now, force=True)
        self.record(name, "phase", text, now)
        self.last_tool.pop(name, None)

    def tool(self, name, text, now):
        previous = self.last_tool.get(name)
        if previous and previous[0] == text and now - previous[1] < 4:
            return
        self.last_tool[name] = (text, now)
        self.record(name, "tool", text, now)

    def offer(self, name, text, now):
        note = self.excerpt(text)
        if not note:
            return
        if note == self.latest(name, "note"):
            self.pending.pop(name, None)
            return
        previous = self.pending.get(name)
        if previous and previous[0] == note:
            return
        self.pending[name] = (note, previous[1] if previous else now, now)

    def publish(self, name, now, *, force=False):
        if name not in self.pending:
            return False
        note, started, updated = self.pending[name]
        if not force and (now - self.published.get(name, float("-inf")) < self.MIN_INTERVAL or
                          (now - updated < self.QUIET_FOR and now - started < self.MAX_WAIT)):
            return False
        del self.pending[name]
        previous = self.latest(name, "note")
        if previous == note:
            return False
        self.record(name, "note", note, now)
        self.published[name] = now
        return True

    def tick(self, now):
        for name in list(self.pending):
            self.publish(name, now)

    def latest(self, name, kind):
        return next((row["text"] for row in reversed(self.events.get(name, [])) if row["kind"] == kind), "")
