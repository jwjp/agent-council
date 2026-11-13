import { writeFileSync } from "node:fs";
const json = (schema) => ({ "application/json": { schema } }),
  object = (properties) => ({ type: "object", properties }),
  string = { type: "string" };
const error = {
  description: "Invalid request",
  content: json(object({ error: string })),
};
const responses = {
  200: { description: "Success" },
  400: error,
  401: { ...error, description: "Missing or invalid bearer token" },
};
const profileName = {
  ...string,
  pattern: "^(claude|codex)-[a-z0-9][a-z0-9_-]{0,31}$",
};
const agent = {
  anyOf: [
    { enum: ["claude", "codex", "grok", "agy", "agent", "gemini"] },
    profileName,
  ],
};
const settings = object({
  folder: { ...string, description: "Existing project directory" },
  coder: {
    anyOf: [...agent.anyOf, { type: "null" }],
  },
  reviewers: {
    type: "array",
    uniqueItems: true,
    items: agent,
  },
  agent_profiles: {
    type: "array",
    description:
      "Additional Claude Code and Codex sign-ins. Configuration paths are local to the desktop and omitted from phone snapshots.",
    items: {
      ...object({
        name: profileName,
        config_dir: string,
        display_name: { ...string, minLength: 1, maxLength: 40 },
      }),
      required: ["name", "config_dir"],
    },
  },
  references: { type: "array", items: string },
  language: { enum: ["English", "한국어"] },
  appearance: { enum: ["light", "dark", "system"] },
  permissions: { enum: ["restricted", "coder", "all"] },
  draft: string,
});
const body = (schema) => ({ required: true, content: json(schema) });
const agentAccount = {
  ...object({
    name: { anyOf: [{ enum: ["claude", "codex"] }, profileName] },
    config_dir: string,
    display_name: string,
    status: {
      enum: [
        "connected",
        "sign_in_required",
        "cli_unavailable",
        "check_failed",
      ],
    },
    login_command: string,
    login_shell: { enum: ["powershell", "macos_terminal", "posix_terminal"] },
    account_email: {
      ...string,
      description:
        "Claude.ai sign-in email, when reported. Desktop account endpoints only.",
    },
  }),
  required: ["name", "config_dir", "status"],
};
const agentAccountResponse = {
  ...responses,
  200: {
    description: "Local agent account status",
    content: json(agentAccount),
  },
};
const accountProvider = [
  {
    name: "provider",
    in: "path",
    required: true,
    schema: { enum: ["claude", "codex"] },
  },
];
const paths = {
  "/health": { get: { operationId: "health", responses } },
  "/state": {
    get: {
      operationId: "snapshot",
      description:
        "Settings, current project messages, latest job, bounded activity snapshot, usage, durable cursor and running_jobs count. A council message can include report_summary as a prefix of its full Markdown text. Activity retains each agent's latest complete note and up to 40 events of each milestone/tool/error kind; full durable history remains available through SSE replay.",
      responses,
    },
  },
  "/settings": {
    put: {
      operationId: "saveSettings",
      requestBody: body(settings),
      responses,
    },
  },
  "/{provider}/accounts": {
    parameters: accountProvider,
    get: {
      operationId: "discoverAgentAccounts",
      responses: {
        ...responses,
        200: {
          description: "Default, registered and discovered local accounts",
          content: json({ type: "array", items: agentAccount }),
        },
      },
    },
  },
  "/{provider}/accounts/check": {
    parameters: accountProvider,
    post: {
      operationId: "checkAgentAccount",
      requestBody: body({
        ...object({ config_dir: string }),
        required: ["config_dir"],
      }),
      responses: agentAccountResponse,
    },
  },
  "/{provider}/accounts/prepare": {
    parameters: accountProvider,
    post: {
      operationId: "prepareAgentAccount",
      requestBody: {
        content: json(
          object({
            request_id: {
              ...string,
              format: "uuid",
              description:
                "Reuse to recover the same account folder after a lost response.",
            },
          }),
        ),
      },
      responses: agentAccountResponse,
    },
  },
  "/draft": {
    put: {
      operationId: "saveDraft",
      requestBody: body({
        ...object({ folder: string, text: { ...string, maxLength: 64000 } }),
        required: ["folder", "text"],
      }),
      responses,
    },
  },
  "/files/read": {
    post: {
      operationId: "previewProjectFile",
      description:
        "Read-only text preview inside the selected project or reference folders. Supports file:/// paths and :line / #Lline suffixes. Canonical path checks reject traversal and symlinks outside configured folders. Binary files are rejected. Large previews explicitly report truncation at 512 KiB / 3000 lines; start_line preserves correct numbering for excerpts.",
      requestBody: body({
        ...object({ target: string }),
        required: ["target"],
      }),
      responses: {
        ...responses,
        200: {
          description:
            "Resolved path, filename, UTF-8 text, optional highlighted line and truncated flag",
          content: json(
            object({
              path: string,
              name: string,
              text: string,
              line: { type: ["integer", "null"] },
              truncated: { type: "boolean" },
              start_line: { type: "integer", minimum: 1 },
            }),
          ),
        },
      },
    },
  },
  "/jobs": {
    post: {
      operationId: "startJob",
      description:
        "Accepted jobs survive network disconnects. Reusing request_id returns the same job. Only one running job per project.",
      requestBody: body({
        ...object({
          request: { ...string, minLength: 1, maxLength: 64000 },
          request_id: { ...string, minLength: 1, maxLength: 128 },
        }),
        required: ["request", "request_id"],
      }),
      responses: {
        ...responses,
        409: {
          description: "A different job is already running for this project",
        },
      },
    },
  },
  "/jobs/{id}/changes": {
    get: {
      operationId: "jobChanges",
      description:
        "Read the bounded Git working-tree or supported project text-file comparison saved when a job ends. Returns null for jobs without a saved comparison.",
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { ...string, format: "uuid" },
        },
      ],
      responses: {
        ...responses,
        200: {
          description: "Saved comparison or null",
          content: json({
            anyOf: [
              { type: "null" },
              {
                ...object({
                  available: { type: "boolean" },
                  source: { enum: ["git", "folder"] },
                  skipped: { type: "integer", minimum: 0 },
                  files: {
                    type: "array",
                    items: {
                      ...object({
                        path: string,
                        kind: { enum: ["added", "modified", "deleted"] },
                        patch: { type: ["string", "null"] },
                        truncated: { type: "boolean" },
                      }),
                      required: ["path", "kind", "patch", "truncated"],
                    },
                  },
                }),
                required: ["available", "skipped", "files"],
              },
            ],
          }),
        },
      },
    },
  },
  "/jobs/{id}/cancel": {
    post: {
      operationId: "cancelJob",
      parameters: [{ in: "path", name: "id", required: true, schema: string }],
      description:
        "Cancel the job and descendant CLI processes. Observe done for cancellation completion.",
      responses,
    },
  },
  "/events": {
    get: {
      operationId: "subscribe",
      parameters: [
        {
          in: "query",
          name: "after",
          schema: { type: "integer", minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: {
          description:
            "SSE replay followed by live persisted events. Each JSON data object has id,job,folder,agent,kind,text,stage,time,data. A workflow event starts a real stage with data.participants; phase Done/Failed events count per-stage completion. A question stage awaits the next user turn. Reconnect with after=last processed id. Heartbeats contain no data.",
          content: { "text/event-stream": { schema: string } },
        },
        401: responses[401],
      },
    },
  },
  "/usage/refresh": {
    post: {
      operationId: "refreshUsage",
      description:
        "Schedule available local quota readers. Unsupported quotas remain unavailable.",
      responses,
    },
  },
  "/update": {
    get: {
      operationId: "checkUpdate",
      description:
        "Checks GitHub latest release for portable installs. Windows packages return channel=windows-package, the current version and a Microsoft Store URI without a GitHub request. Returns available, version, url and asset.",
      responses,
    },
  },
  "/maintenance": {
    post: {
      operationId: "prepareUpdate",
      description:
        "Atomically block new jobs only when no work is running. Release with enabled=false if update preparation fails.",
      requestBody: body({
        ...object({ enabled: { type: "boolean" } }),
        required: ["enabled"],
      }),
      responses,
    },
  },
};
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Agent Council Rust runtime",
    version: "1.0.0",
    description:
      "Loopback-only authenticated runtime. See runtime-api.md for lifecycle and migration guarantees.",
  },
  servers: [
    {
      url: "http://127.0.0.1:{port}/v1",
      variables: {
        port: {
          default: "43127",
          description:
            "Actual ephemeral port is in the local runtime descriptor.",
        },
      },
    },
  ],
  security: [{ runtimeToken: [] }],
  paths,
  components: {
    securitySchemes: {
      runtimeToken: {
        type: "http",
        scheme: "bearer",
        description:
          "Random per-user runtime credential. Do not publish the local descriptor.",
      },
    },
    schemas: { Settings: settings },
  },
};
const companionInput = object({
  enabled: { type: "boolean" },
  origin: string,
  port: { type: "integer", minimum: 1024, maximum: 65535 },
});
paths["/companion"] = {
  get: {
    operationId: "companionStatus",
    description:
      "Local administrator only: sanitized device/pairing metadata and gateway readiness.",
    responses,
  },
  put: {
    operationId: "configureCompanion",
    description:
      "Opt in to a separate loopback gateway. Origin changes revoke devices. Does not configure Tailscale.",
    requestBody: body({
      ...companionInput,
      required: ["enabled", "origin", "port"],
      additionalProperties: false,
    }),
    responses,
  },
};
paths["/companion/invitations"] = {
  post: {
    operationId: "createCompanionInvitation",
    description:
      "Capture current project/team. Returns a five-minute, single-use pairing URL fragment; no reusable device credential.",
    requestBody: body({
      ...object({ allow_work: { type: "boolean" } }),
      required: ["allow_work"],
      additionalProperties: false,
    }),
    responses: {
      ...responses,
      503: { description: "Gateway disabled or not ready" },
    },
  },
};
for (const [suffix, method, id, description] of [
  [
    "invitations/{id}/approve",
    "post",
    "approveCompanionClaim",
    "Approve a claimed phone invitation. The phone must complete pairing to receive its cookie.",
  ],
  [
    "invitations/{id}",
    "delete",
    "rejectCompanionClaim",
    "Reject/cancel a pending invitation.",
  ],
  [
    "devices/{id}",
    "delete",
    "revokeCompanionDevice",
    "Revoke device access and erase its draft; accepted work continues.",
  ],
])
  paths[`/companion/${suffix}`] = {
    [method]: {
      operationId: id,
      description,
      parameters: [{ name: "id", in: "path", required: true, schema: string }],
      responses,
    },
  };
writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
