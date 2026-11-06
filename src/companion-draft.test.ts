import { expect, it } from "vitest";
import { CompanionDraft, DRAFT_KEY } from "./companion-draft";
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  };
}
it("recovers only the current device's temporary unsent draft", () => {
  const storage = memory(),
    draft = new CompanionDraft("one", storage);
  draft.edit("한글 초안");
  expect(new CompanionDraft("one", storage).text).toBe("한글 초안");
  expect(new CompanionDraft("other", storage).text).toBe("");
  expect(storage.getItem(DRAFT_KEY)).toBeNull();
});
it("preserves input across old save acknowledgements and snapshots", () => {
  const draft = new CompanionDraft("one", memory());
  draft.edit("A");
  const before = draft.revision;
  draft.edit("B");
  draft.saved(before);
  expect(draft.dirty).toBe(true);
  draft.saved(draft.revision);
  draft.snapshot("A", undefined, before);
  expect(draft.text).toBe("B");
});
it("reuses the request ID after an ambiguous send/reload and confirms from the host", () => {
  const storage = memory(),
    draft = new CompanionDraft("one", storage);
  draft.edit("Build this");
  draft.prepare("request-one");
  const restored = new CompanionDraft("one", storage);
  expect(restored.prepare("do-not-use")).toEqual({
    request: "Build this",
    request_id: "request-one",
  });
  restored.snapshot("", "phone:one:request-one", restored.revision);
  expect(restored.text).toBe("");
  expect(restored.pending).toBeNull();
  expect(storage.getItem(DRAFT_KEY)).toBeNull();
});
it("does not erase text edited while a request is being accepted", () => {
  const draft = new CompanionDraft("one", memory());
  draft.edit("sent");
  draft.prepare("one");
  draft.edit("next");
  draft.saved(draft.revision);
  draft.accepted("one");
  expect(draft.text).toBe("next");
  expect(draft.dirty).toBe(true);
});
it("rejects expired/corrupt recovery and tolerates blocked tab storage", () => {
  const storage = memory(),
    draft = new CompanionDraft("one", storage);
  draft.edit("private");
  expect(
    new CompanionDraft("one", storage, Date.now() + 25 * 3600 * 1000).text,
  ).toBe("");
  storage.setItem(DRAFT_KEY, "invalid json");
  expect(new CompanionDraft("one", storage).text).toBe("");
  const blocked = {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    },
  } as unknown as Storage;
  const volatile = new CompanionDraft("one", blocked);
  volatile.edit("still here");
  expect(volatile.text).toBe("still here");
  expect(volatile.backedUp).toBe(false);
});
