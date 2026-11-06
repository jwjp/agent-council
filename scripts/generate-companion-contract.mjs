import { writeFileSync } from "node:fs";
const string = { type: "string" },
  json = (schema) => ({ "application/json": { schema } });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const body = (schema) => ({ required: true, content: json(schema) });
const responses = {
  200: { description: "Success" },
  400: { description: "Invalid input" },
  401: {
    description: "Pairing or device credential missing, expired or revoked",
  },
  403: {
    description: "Wrong origin, view-only grant or outside approved scope",
  },
  409: { description: "Project already has active work" },
  413: { description: "Request body exceeds 128 KiB" },
  429: { description: "Rate or device/invitation limit" },
  503: { description: "Gateway disabled or unavailable" },
};
const mutating = {
  parameters: [
    {
      name: "Origin",
      in: "header",
      required: true,
      schema: string,
      description:
        "Must exactly match the host-configured origin; browser sets this automatically.",
    },
  ],
};
const paths = {
  "/pair": {
    post: {
      ...mutating,
      operationId: "claimInvitation",
      security: [],
      description:
        "Claim an unused five-minute invitation. Sets HttpOnly CouncilPair cookie; still requires local host approval. Never send the challenge in query parameters.",
      requestBody: body(
        object({
          code: { ...string, minLength: 64, maxLength: 64 },
          name: { ...string, minLength: 1, maxLength: 60 },
        }),
      ),
      responses,
    },
  },
  "/pair/complete": {
    post: {
      ...mutating,
      operationId: "completePairing",
      security: [{ pendingCookie: [] }, { deviceCookie: [] }],
      description:
        "Returns status=pending until approved. Then sets a 30-day HttpOnly SameSite=Strict device cookie (Secure over HTTPS), clears the pending cookie and returns sanitized grant metadata. Reusable credentials are never returned as JSON.",
      responses,
    },
  },
  "/session": {
    get: {
      operationId: "companionSession",
      description:
        "Sanitized device/project/team/access/expiry and protocol=companion-v1.",
      responses,
    },
  },
  "/state": {
    get: {
      operationId: "companionState",
      description:
        "Snapshot of the approved project, private device draft, sanitized account quotas, can_cancel for own jobs and current permission ceiling. Does not change host selection.",
      responses,
    },
  },
  "/draft": {
    put: {
      ...mutating,
      operationId: "saveCompanionDraft",
      requestBody: body(
        object({
          text: { ...string, description: "At most 64,000 UTF-8 bytes" },
        }),
      ),
      responses,
    },
  },
  "/jobs": {
    post: {
      ...mutating,
      operationId: "startCompanionJob",
      description:
        "Work grant required. Project/team are supplied by the host. request_id is namespaced per device; retry the same key to recover a lost acknowledgment.",
      requestBody: body(
        object({
          request: { ...string, minLength: 1 },
          request_id: { ...string, minLength: 1, maxLength: 64 },
        }),
      ),
      responses,
    },
  },
  "/jobs/{id}/cancel": {
    post: {
      ...mutating,
      operationId: "cancelCompanionJob",
      parameters: [
        ...mutating.parameters,
        { name: "id", in: "path", required: true, schema: string },
      ],
      description:
        "Work grant required; cancel only requests submitted by this device.",
      responses,
    },
  },
  "/events": {
    get: {
      operationId: "companionEvents",
      parameters: [
        {
          name: "after",
          in: "query",
          schema: { type: "integer", minimum: 0, default: 0 },
        },
      ],
      description:
        "SSE replay/live events for approved project and sanitized global quota updates only. Global IDs may have gaps. Revocation, expiry or gateway disable ends access.",
      responses: {
        ...responses,
        200: {
          description: "Event stream",
          content: { "text/event-stream": { schema: string } },
        },
      },
    },
  },
  "/files/read": {
    post: {
      ...mutating,
      operationId: "readCompanionFile",
      description:
        "Read-only canonical project/reference scope. Text preview limited to 512 KiB / 3,000 lines; binary files rejected.",
      requestBody: body(object({ target: string })),
      responses,
    },
  },
  "/usage/refresh": {
    post: {
      ...mutating,
      operationId: "refreshCompanionUsage",
      description:
        "Schedule available local quota readers; maximum once per 30 seconds per device.",
      responses,
    },
  },
  "/logout": {
    post: {
      ...mutating,
      operationId: "disconnectCompanion",
      description:
        "Revoke this device, erase its draft, clear its cookie. Accepted jobs continue.",
      responses,
    },
  },
};
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Agent Council companion gateway",
    version: "1.0.0",
    description:
      "Opt-in loopback gateway behind private Tailscale Serve HTTPS. Separate from local runtime administrator API. See COMPANION_API.md.",
  },
  servers: [
    {
      url: "https://{host}/companion/v1",
      variables: { host: { default: "your-pc.your-tailnet.ts.net" } },
    },
  ],
  security: [{ deviceCookie: [] }],
  paths,
  components: {
    securitySchemes: {
      deviceCookie: { type: "apiKey", in: "cookie", name: "CouncilDevice" },
      pendingCookie: { type: "apiKey", in: "cookie", name: "CouncilPair" },
    },
  },
};
writeFileSync(
  "docs/companion-openapi.json",
  JSON.stringify(spec, null, 2) + "\n",
);
