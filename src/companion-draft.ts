// Temporary per-tab recovery of input/request IDs, never transport authentication material.
export const DRAFT_KEY = "council-companion-draft-v1";
export const DRAFT_LIMIT = 64000;
const TTL = 24 * 60 * 60 * 1000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface Pending {
  request: string;
  request_id: string;
  revision: number;
}
interface Backup {
  id: string;
  text: string;
  revision: number;
  pending: Pending | null;
  updated: number;
}
export function draftFits(text: string) {
  return new TextEncoder().encode(text).length <= DRAFT_LIMIT;
}
export function tabStorage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}
export class CompanionDraft {
  text = "";
  revision = 0;
  dirty = false;
  pending: Pending | null = null;
  recovered = false;
  backedUp = false;
  constructor(
    readonly id: string,
    private storage: DraftStorage | null,
    now = Date.now(),
  ) {
    try {
      const raw = storage?.getItem(DRAFT_KEY);
      if (!raw) return;
      const value = JSON.parse(raw) as Backup;
      if (
        value.id !== id ||
        typeof value.text !== "string" ||
        !draftFits(value.text) ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        !Number.isFinite(value.updated) ||
        now - value.updated > TTL ||
        value.updated > now + 60000
      )
        throw Error("Invalid draft backup");
      const pending = value.pending;
      if (
        pending &&
        (typeof pending.request !== "string" ||
          !draftFits(pending.request) ||
          typeof pending.request_id !== "string" ||
          !/^[\w-]{1,64}$/.test(pending.request_id) ||
          !Number.isSafeInteger(pending.revision) ||
          pending.revision < 0 ||
          pending.revision > value.revision)
      )
        throw Error("Invalid pending request");
      this.text = value.text;
      this.revision = value.revision;
      this.pending = pending ?? null;
      this.dirty = true;
      this.recovered = true;
      this.backedUp = true;
    } catch {
      this.remove();
    }
  }
  edit(text: string) {
    this.text = text;
    this.revision++;
    this.dirty = true;
    this.recovered = false;
    this.backup();
  }
  prepare(requestId: string) {
    if (!this.pending || this.pending.revision !== this.revision)
      this.pending = {
        request: this.text,
        request_id: requestId,
        revision: this.revision,
      };
    this.backup();
    return {
      request: this.pending.request,
      request_id: this.pending.request_id,
    };
  }
  accepted(requestId: string) {
    if (this.pending?.request_id !== requestId) return;
    if (this.pending.revision === this.revision) {
      this.text = "";
      this.revision++;
      this.dirty = false;
    } else this.dirty = true; // Starting work clears the host draft; resave newer input.
    this.pending = null;
    this.backup();
  }
  saved(revision: number) {
    if (revision === this.revision) {
      this.dirty = false;
      this.recovered = false;
      this.backup();
    }
  }
  snapshot(
    text: string,
    jobRequestId: string | undefined,
    requestedRevision: number,
  ) {
    if (
      this.pending &&
      jobRequestId === `phone:${this.id}:${this.pending.request_id}`
    )
      this.accepted(this.pending.request_id);
    if (
      !this.dirty &&
      !this.pending &&
      requestedRevision === this.revision &&
      this.text !== text
    ) {
      this.text = text;
      this.revision++;
    }
  }
  discard() {
    this.remove();
    this.text = "";
    this.pending = null;
    this.dirty = false;
    this.revision++;
  }
  private remove() {
    try {
      this.storage?.removeItem(DRAFT_KEY);
    } catch {}
    this.backedUp = false;
  }
  private backup() {
    if ((!this.dirty && !this.pending) || !draftFits(this.text)) {
      this.remove();
      return;
    }
    try {
      if (!this.storage) {
        this.backedUp = false;
        return;
      }
      this.storage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          id: this.id,
          text: this.text,
          revision: this.revision,
          pending: this.pending,
          updated: Date.now(),
        } satisfies Backup),
      );
      this.backedUp = true;
    } catch {
      this.backedUp = false;
    }
  }
}
