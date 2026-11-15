/**
 * A2A protocol v1.0 types, hand-written from a2a.proto (the normative source,
 * copied next to this repo's package.json). JSON field names are camelCase and
 * enums are their full proto names (ProtoJSON), e.g. "TASK_STATE_WORKING".
 *
 * NOTE: v1.0 has NO `kind` discriminator (v0.3 had one). A Part is recognised by
 * which one of text/raw/url/data is present. StreamResponse/SendMessageResponse
 * are "one of" wrappers: {task} | {message} | {statusUpdate} | {artifactUpdate}.
 */

export const PROTOCOL_VERSION = "1.0";

export type TaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED";

/** Terminal: the task is finished, immutable, can't be restarted. */
export const TERMINAL: ReadonlySet<TaskState> = new Set([
  "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED",
]);
/** Interrupted: the agent is waiting for the client; send another message with the same taskId. */
export const INTERRUPTED: ReadonlySet<TaskState> = new Set([
  "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED",
]);
export const isTerminal = (s: TaskState) => TERMINAL.has(s);
export const isInterrupted = (s: TaskState) => INTERRUPTED.has(s);

export type Role = "ROLE_UNSPECIFIED" | "ROLE_USER" | "ROLE_AGENT";

/** Exactly one of text | raw | url | data must be set. `raw` is base64 in JSON. */
export interface Part {
  text?: string;
  raw?: string;
  url?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  filename?: string;
  mediaType?: string;
}

export interface Message {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string; // ISO 8601
}

export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  /** true: append `artifact.parts` to the artifact already known under this artifactId */
  append?: boolean;
  /** true: this is the final chunk of the artifact */
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StreamResponse {
  task?: Task;
  message?: Message;
  statusUpdate?: TaskStatusUpdateEvent;
  artifactUpdate?: TaskArtifactUpdateEvent;
}
export interface SendMessageResponse { task?: Task; message?: Message }

export interface AuthenticationInfo { scheme: string; credentials?: string }
export interface TaskPushNotificationConfig {
  tenant?: string;
  id?: string;
  taskId?: string;
  url: string;
  token?: string;
  authentication?: AuthenticationInfo;
}

export interface SendMessageConfiguration {
  acceptedOutputModes?: string[];
  taskPushNotificationConfig?: TaskPushNotificationConfig;
  historyLength?: number;
  /** false (default): block until terminal/interrupted. true: return as soon as the task exists. */
  returnImmediately?: boolean;
}
export interface SendMessageRequest {
  tenant?: string;
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}
export interface GetTaskRequest { tenant?: string; id: string; historyLength?: number }
export interface ListTasksRequest {
  tenant?: string; contextId?: string; status?: TaskState; pageSize?: number; pageToken?: string;
  historyLength?: number; statusTimestampAfter?: string; includeArtifacts?: boolean;
}
export interface ListTasksResponse { tasks: Task[]; nextPageToken: string; pageSize: number; totalSize: number }

export interface AgentInterface {
  url: string;
  protocolBinding: "JSONRPC" | "GRPC" | "HTTP+JSON" | (string & {});
  protocolVersion: string;
  tenant?: string;
}
export interface AgentSkill {
  id: string; name: string; description: string; tags: string[];
  examples?: string[]; inputModes?: string[]; outputModes?: string[];
}
export interface AgentCard {
  name: string;
  description: string;
  supportedInterfaces: AgentInterface[]; // first entry is preferred
  provider?: { url: string; organization: string };
  version: string;
  documentationUrl?: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    extendedAgentCard?: boolean;
    extensions?: { uri: string; description?: string; required?: boolean; params?: unknown }[];
  };
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: { schemes: Record<string, { list: string[] }> }[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  signatures?: unknown[];
  iconUrl?: string;
}

// ---------------------------------------------------------------- errors

/** A2A error → JSON-RPC code, HTTP status (REST binding), and google.rpc.ErrorInfo reason. */
export class A2AError extends Error {
  constructor(
    public readonly code: number,
    public readonly kind: string,
    message: string,
    public readonly reason: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = kind;
  }
}

export const Errors = {
  parse: (d = "Invalid JSON payload") => new A2AError(-32700, "JSONParseError", d, "JSON_PARSE_ERROR", 400),
  invalidRequest: (d = "Request is not a valid JSON-RPC 2.0 request") => new A2AError(-32600, "InvalidRequestError", d, "INVALID_REQUEST", 400),
  methodNotFound: (m: string) => new A2AError(-32601, "MethodNotFoundError", `Method not found: ${m}`, "METHOD_NOT_FOUND", 404),
  invalidParams: (d: string) => new A2AError(-32602, "InvalidParamsError", d, "INVALID_PARAMS", 400),
  internal: (d = "Internal error") => new A2AError(-32603, "InternalError", d, "INTERNAL_ERROR", 500),
  taskNotFound: (id: string) => new A2AError(-32001, "TaskNotFoundError", `Task not found: ${id}`, "TASK_NOT_FOUND", 404),
  taskNotCancelable: (id: string, state: string) => new A2AError(-32002, "TaskNotCancelableError", `Task ${id} is ${state} and cannot be canceled`, "TASK_NOT_CANCELABLE", 409),
  pushNotSupported: () => new A2AError(-32003, "PushNotificationNotSupportedError", "This agent does not support push notifications", "PUSH_NOTIFICATION_NOT_SUPPORTED", 400),
  unsupported: (d: string) => new A2AError(-32004, "UnsupportedOperationError", d, "UNSUPPORTED_OPERATION", 400),
  contentType: (d: string) => new A2AError(-32005, "ContentTypeNotSupportedError", d, "CONTENT_TYPE_NOT_SUPPORTED", 415),
  invalidAgentResponse: (d: string) => new A2AError(-32006, "InvalidAgentResponseError", d, "INVALID_AGENT_RESPONSE", 502),
  extendedCardNotConfigured: () => new A2AError(-32007, "ExtendedAgentCardNotConfiguredError", "This agent has no extended agent card", "EXTENDED_AGENT_CARD_NOT_CONFIGURED", 400),
  extensionRequired: (uri: string) => new A2AError(-32008, "ExtensionSupportRequiredError", `Required extension not supported: ${uri}`, "EXTENSION_SUPPORT_REQUIRED", 400),
  versionNotSupported: (v: string) => new A2AError(-32009, "VersionNotSupportedError", `Unsupported A2A version: ${v} (this server speaks ${PROTOCOL_VERSION})`, "VERSION_NOT_SUPPORTED", 400),
};

/** gRPC status names, used in the HTTP+JSON error body (spec 5.4 and 11.6). */
const GRPC_STATUS: Record<string, string> = {
  TASK_NOT_FOUND: "NOT_FOUND", TASK_NOT_CANCELABLE: "FAILED_PRECONDITION",
  PUSH_NOTIFICATION_NOT_SUPPORTED: "UNIMPLEMENTED", UNSUPPORTED_OPERATION: "UNIMPLEMENTED",
  CONTENT_TYPE_NOT_SUPPORTED: "INVALID_ARGUMENT", INVALID_AGENT_RESPONSE: "INTERNAL",
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: "FAILED_PRECONDITION", EXTENSION_SUPPORT_REQUIRED: "FAILED_PRECONDITION",
  VERSION_NOT_SUPPORTED: "UNIMPLEMENTED",
  JSON_PARSE_ERROR: "INVALID_ARGUMENT", INVALID_REQUEST: "INVALID_ARGUMENT", INVALID_PARAMS: "INVALID_ARGUMENT",
  METHOD_NOT_FOUND: "NOT_FOUND", INTERNAL_ERROR: "INTERNAL",
};
export const grpcStatusOf = (e: A2AError): string => GRPC_STATUS[e.reason] ?? "UNKNOWN";

/** Reconstruct an error on the client side from an ErrorInfo reason (HTTP+JSON binding). */
export function errorFromReason(reason: string, message: string): A2AError | undefined {
  const known = Object.values(Errors).map((f) => (f as (...a: string[]) => A2AError)("x", "x"));
  const hit = known.find((e) => e.reason === reason);
  return hit && new A2AError(hit.code, hit.kind, message, hit.reason, hit.httpStatus);
}

/** Reconstruct an error on the client side from a JSON-RPC code. */
export function errorFromCode(code: number, message: string): A2AError {
  const known = Object.values(Errors).map((f) => (f as (...a: string[]) => A2AError)("x", "x"));
  const hit = known.find((e) => e.code === code);
  return new A2AError(code, hit?.kind ?? "UnknownError", message, hit?.reason ?? "UNKNOWN", hit?.httpStatus ?? 500);
}

// ---------------------------------------------------------------- helpers

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function textPart(text: string, extra: Partial<Part> = {}): Part { return { text, ...extra }; }
export function dataPart(data: unknown, extra: Partial<Part> = {}): Part { return { data, mediaType: "application/json", ...extra }; }

export function message(role: "user" | "agent", parts: Part[] | string, extra: Partial<Message> = {}): Message {
  return {
    messageId: uid(),
    role: role === "user" ? "ROLE_USER" : "ROLE_AGENT",
    parts: typeof parts === "string" ? [{ text: parts }] : parts,
    ...extra,
  };
}

export const textOf = (m?: Message): string =>
  (m?.parts ?? []).map((p) => p.text).filter((t): t is string => typeof t === "string").join("\n");

/** Which content field a Part uses. */
export function partKind(p: Part): "text" | "raw" | "url" | "data" | "invalid" {
  const set = (["text", "raw", "url", "data"] as const).filter((k) => p[k] !== undefined);
  return set.length === 1 ? set[0]! : "invalid";
}
export const effectiveMediaType = (p: Part): string =>
  p.mediaType ?? ({ text: "text/plain", data: "application/json", raw: "application/octet-stream", url: "application/octet-stream", invalid: "" }[partKind(p)]);

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
  });

/** Wire-safe deep clone. */
export const clone = <T>(v: T): T => structuredClone(v);
