# Companion v1 contract

The companion is a separate, opt-in loopback listener (default port 43128). Publish only that listener through Tailscale Serve HTTPS; never publish the local runtime listener, Vite or `runtime.json`. No Tailscale settings are changed automatically. External origins must be HTTPS; HTTP is accepted only for loopback browser testing. A disabled gateway serves no UI/API. Native mobile builds and background push are not part of this milestone.

## Local management — existing runtime bearer required

Project binding constrains gateway data access, event routing and the working directory/team for submitted jobs. It is **not an OS sandbox** for work-enabled devices: an agent launched with the user's full execution permissions can access outside that directory. The host approval UI states this consequence. Keep the chosen execution policy intact; do not describe full-access agent tools as filesystem-isolated.

| Method/path under `/v1` | Request / result |
| --- | --- |
| GET `/companion` | Configuration, gateway readiness/error, pending claims and sanitized devices |
| PUT `/companion` | `{enabled,origin,port}`; changing origin revokes devices; disabling invalidates outstanding invitations |
| POST `/companion/invitations` | `{allow_work}`; capture current project/team/reference scope, return `{id,url,expires}` with a five-minute single-use challenge in the URL fragment |
| POST `/companion/invitations/{id}/approve` | Approve the named phone claim; completion on the phone issues its own credential |
| DELETE `/companion/invitations/{id}` | Cancel/reject the invitation |
| DELETE `/companion/devices/{id}` | Revoke the device and its draft; ongoing accepted work continues |

## Companion listener — no local admin routes

Snapshots contain the latest complete working note per agent and bounded phase/tool/error history; the full retained event history stays on the host. The browser applies note/phase/tool events directly and refreshes snapshots for messages, usage and job transitions, preserving newer streamed notes if an older snapshot response arrives late.

Static `/companion/` and `/assets/*` contain only browser application assets. API responses are not cacheable. Mutations require the exact configured Origin; requests with a different supplied Origin are rejected, including reads. No permissive CORS is installed.

Current source also serves the public `/companion/manifest.webmanifest` (`application/manifest+json`) and three PNGs: `/companion/app-icon-192.png`, `/companion/app-icon-512.png`, `/companion/apple-touch-icon.png`. These exact static routes contain no account/project data. CSP permits same-origin manifests and retains same-origin-only scripts/styles; there is no service worker. The manifest ID/start/scope are `/companion/`, without any pairing fragment. This adds no REST operation or authentication change.

| Method/path under `/companion/v1` | Request / result |
| --- | --- |
| POST `/pair` | `{code,name}`; claim an unexpired unused invitation, receive an HttpOnly pending cookie; PC approval still required |
| POST `/pair/complete` | Pending cookie; `{status:"pending"}` until approved, then set a 30-day HttpOnly, SameSite=Strict device cookie (Secure for HTTPS) and return sanitized session |
| GET `/session` | Device cookie; bound project, team, access and expiry, protocol `companion-v1` |
| GET `/state` | Bound-project messages/job/usage/activity and this device's draft; no local runtime descriptor/provider credentials |
| PUT `/draft` | `{text}`; private device draft; leaves desktop and other-device drafts intact |
| POST `/jobs` | `{request,request_id}`; work grant required; server namespaces idempotency keys per device and executes the approved project/team without changing desktop selection |
| POST `/jobs/{id}/cancel` | Work grant; only jobs submitted by this device |
| GET `/events?after=N` | Persisted SSE replay/live events filtered to the approved project; revocation/disable ends access |
| POST `/files/read` | `{target}`; same bounded read-only preview within approved project/reference roots |
| POST `/usage/refresh` | Schedule sanitized provider quota refresh, rate limited to once per 30 seconds per device |
| POST `/logout` | Revoke own credential and clear cookies |

Device records store only credential digests, scope and metadata. Pair challenges and pending approvals are memory-only, bounded and expire after five minutes/restart; completed claims cannot be replayed. Cookies are never returned as JSON, placed in query strings or saved in localStorage. QR fragments are removed from browser history immediately. Public pairing is rate limited and requires a high-entropy challenge in addition to explicit PC approval. Work access cannot raise the approved permission policy or the host's currently selected global policy. Observers cannot submit/cancel jobs.

Errors return `{error}`: 400 invalid input, 401 missing/expired/revoked credential or invitation, 403 origin/scope violation, 409 existing project work, 413 request body over 128 KiB, 429 bounded rate limit, 503 disabled/unready gateway. Accepted jobs outlive browser disconnection; host restart marks unfinished jobs interrupted, as in the local contract. Browser foreground/reconnect resynchronizes snapshots and durable event IDs; no background push delivery is promised.

Verification must cover approval, rejection, expiry/replay, observers, per-device drafts/idempotency, project/file/event isolation, denial of local admin routes, revocation (including open SSE), restart persistence and reconnect. Local loopback browser tests are not evidence of an actual phone/Tailscale route working.

Workflow progress uses the same additive `workflow` events as the local runtime: `stage` and `data.participants` announce a round, and per-agent `phase` outcomes determine actual completion counts. Compact snapshots retain workflow milestones and phase outcomes as well as complete latest notes. Phone clients apply these events directly without a full snapshot request per note/tool update. A `question` stage displays the current lead's question in the council tab; it does not run extra review rounds while awaiting a user reply.
