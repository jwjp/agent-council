# Runtime protocol v1

The desktop shell and the background runtime use the same Rust executable. `AgentCouncil.exe --serve` starts the headless runtime. Closing a window does not stop accepted work. A single runtime owns subprocesses and SQLite state; multiple UI connections do not start duplicate jobs.

The workspace also builds a GUI-independent `CouncilHost` executable using the same host library. Runtime compatibility revision **3** identifies this source milestone; `/v1` routes and payloads remain unchanged. The Vite bootstrap and both executables use this revision. Build commands, native data paths and remaining macOS gaps are documented in [PORTABLE_HOST.md](PORTABLE_HOST.md).

The runtime binds an ephemeral **127.0.0.1** port, writes its address and a random bearer credential under the user's AgentCouncil data directory, and requires that credential on every API request. The desktop bootstrap command reads these locally. Nothing is exposed to a LAN or tailnet automatically. Mobile packaging, device pairing, token revocation, and Tailscale configuration are future work, not enabled features of v3.

All requests and events are JSON. Routes begin `/v1`. HTTP errors return `{ "error": "message" }`. Unknown or missing credentials return 401. Mutation requests are size limited. Configuration rejects unknown agents and nonexistent project/reference folders. Only one job per project runs at a time (409 for duplicates). Accepted jobs receive an ID before execution; network disconnects do not cancel them.

| Method/path | Purpose |
|---|---|
| GET /v1/state | Settings, detected CLIs, current project's messages, job, token totals, account limits, durable event cursor |
| PUT /v1/settings | Save coder (nullable), reviewers, folder, references, language, appearance and permissions |
| PUT /v1/draft | Save `{folder,text}` independently of agent work |
| POST /v1/files/read | Read `{target}` from the selected project or references; supports local file links and line suffixes, returns `{path,name,text,line,start_line,truncated}` |
| POST /v1/jobs | Start `{request,request_id}`; repeat request_id returns the same accepted job |
| POST /v1/jobs/{id}/cancel | Cancel a running job including its CLI process trees |
| GET /v1/events?after=N | SSE event replay followed by live events; persisted monotonic IDs permit reconnect |
| POST /v1/usage/refresh | Read available local account limits; unavailable providers remain explicit |
| GET /v1/update | Check GitHub's latest published release without installing |
| POST /v1/maintenance | `{enabled:true}` atomically rejects new jobs only if all current work has finished; updater releases the gate on preparation errors |

Events: `{id,job,agent,kind,text,time,folder}`. Kinds include `phase`, `note`, `tool`, `message`, `usage`, `limits`, `done`, `error`. Reports additionally have `stage`. Streamed notes are bounded and paced; final reports are retained separately. Events are stored before broadcast. Consumers deduplicate by ID. Jobs left running after an engine restart become `interrupted`; no claim of transparent CLI process resumption is made. Work can be continued with a new message using the saved transcript.

The optional lead executes changes requested by the user. Optional reviewers inspect and offer opinions. Confirmed findings on implemented changes trigger one bounded correction pass, followed by read-only rechecks. Participants compare findings in a conference. The final report distinguishes actual changes from recommendations and attributes opinions. Standard/coder-only/all-agent permissions preserve the v2 policy. With all-agent bypass the review-only role is a prompt instruction, not enforced filesystem isolation.

`limits[agent]` contains sanitized `{status,windows,source,updated_at,message}` with optional `auth_source` and `refreshing`. Windows contain `{label,used,reset}` where `used` is a percentage from 0–100 and `reset` is epoch seconds or null. Status distinguishes `ok`, `loading`, `signed_out`, `unavailable`, `error`, `stale` and `unlimited`. Failed refreshes preserve prior valid windows as `stale`, retaining their successful `updated_at` and recording an `attempted_at`. Partial CLI events merge windows instead of removing other known periods. Missing data is not zero usage. Project token totals in `usage` are independent of account limits. Account probes reuse local sign-ins without returning credentials. Global limit events have an empty job ID and apply across project selections. File previews canonicalize paths against the selected project and reference roots; binary files are rejected and rendering is capped at 512 KiB / 3,000 lines.

The local Vite development server exposes a same-origin-only `GET /__council/runtime` bridge on 127.0.0.1:1420. It starts or connects to the same Rust engine, never a mock backend. Runtime descriptors include a compatibility revision; an incompatible engine is replaced only when no work is running.

Existing settings and chat JSON files are read and imported once; original files remain available. All new runtime state is stored in SQLite. Windows CLI children run under the signed-in user's account, not LocalSystem.
