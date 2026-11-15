/**
 * A2AClient: discover an agent from its Agent Card, then speak either standard
 * binding (JSON-RPC or HTTP+JSON) behind one method set. Every HTTP exchange is
 * reported to `opts.wire` so lessons can show exactly what crossed the network.
 */
import {
  A2AError, errorFromCode, message as mkMessage,
  type AgentCard, type AgentInterface, type ListTasksRequest, type ListTasksResponse, type Message,
  type SendMessageConfiguration, type SendMessageResponse, type StreamResponse, type Task, type TaskPushNotificationConfig,
} from "../protocol.ts";

export type Binding = "JSONRPC" | "HTTP+JSON";

export interface WireEvent { dir: "request" | "response" | "event"; text: string }
export interface ClientOptions {
  /** Bearer token for agents whose card declares httpAuth. */
  token?: string;
  /** Force a binding; default = the card's first supported interface. */
  binding?: Binding;
  /** Value for the A2A-Version header. Default "1.0"; pass null to omit. */
  version?: string | null;
  wire?: (e: WireEvent) => void;
  extraHeaders?: Record<string, string>;
}

export class A2AClient {
  private rpcId = 0;
  private constructor(readonly card: AgentCard, readonly iface: AgentInterface, readonly opts: ClientOptions) {}

  /** Fetch `<agentUrl>/.well-known/agent-card.json` and pick an interface we can speak. */
  static async discover(agentUrl: string, opts: ClientOptions = {}): Promise<A2AClient> {
    const cardUrl = `${agentUrl.replace(/\/$/, "")}/.well-known/agent-card.json`;
    opts.wire?.({ dir: "request", text: `GET ${cardUrl}` });
    const res = await fetch(cardUrl);
    const text = await res.text();
    opts.wire?.({ dir: "response", text: `${res.status}\n${text}` });
    if (!res.ok) throw new Error(`Agent Card fetch failed: ${res.status}`);
    const card = JSON.parse(text) as AgentCard;
    return A2AClient.fromCard(card, opts);
  }

  static fromCard(card: AgentCard, opts: ClientOptions = {}): A2AClient {
    const speakable = card.supportedInterfaces.filter((i) => i.protocolBinding === "JSONRPC" || i.protocolBinding === "HTTP+JSON");
    const iface = opts.binding ? speakable.find((i) => i.protocolBinding === opts.binding) : speakable[0];
    if (!iface) throw new Error(`No supported interface${opts.binding ? ` for ${opts.binding}` : ""} in card '${card.name}'`);
    return new A2AClient(card, iface, opts);
  }

  withOptions(extra: Partial<ClientOptions>): A2AClient {
    return A2AClient.fromCard(this.card, { ...this.opts, ...extra });
  }

  get binding(): Binding { return this.iface.protocolBinding as Binding; }

  // ---------------------------------------------------------------- operations

  /** Convenience: build a user Message from text (optionally continuing a task/context). */
  userMessage(text: string, extra: Partial<Message> = {}): Message { return mkMessage("user", text, extra); }

  sendMessage(msg: Message | string, configuration?: SendMessageConfiguration, metadata?: Record<string, unknown>): Promise<SendMessageResponse> {
    const message = typeof msg === "string" ? this.userMessage(msg) : msg;
    const params = { message, ...(configuration ? { configuration } : {}), ...(metadata ? { metadata } : {}) };
    return this.call("SendMessage", params, { rest: ["POST", "/message:send", params] });
  }

  streamMessage(msg: Message | string, configuration?: SendMessageConfiguration, metadata?: Record<string, unknown>): AsyncGenerator<StreamResponse> {
    const message = typeof msg === "string" ? this.userMessage(msg) : msg;
    const params = { message, ...(configuration ? { configuration } : {}), ...(metadata ? { metadata } : {}) };
    return this.stream("SendStreamingMessage", params, { rest: ["POST", "/message:stream", params] });
  }

  getTask(id: string, historyLength?: number): Promise<Task> {
    const qs = historyLength === undefined ? "" : `?historyLength=${historyLength}`;
    return this.call("GetTask", { id, ...(historyLength === undefined ? {} : { historyLength }) }, { rest: ["GET", `/tasks/${enc(id)}${qs}`] });
  }

  listTasks(req: ListTasksRequest = {}): Promise<ListTasksResponse> {
    const qs = new URLSearchParams(Object.entries(req).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return this.call("ListTasks", req, { rest: ["GET", `/tasks${qs ? `?${qs}` : ""}`] });
  }

  cancelTask(id: string): Promise<Task> {
    return this.call("CancelTask", { id }, { rest: ["POST", `/tasks/${enc(id)}:cancel`, {}] });
  }

  subscribeToTask(id: string): AsyncGenerator<StreamResponse> {
    return this.stream("SubscribeToTask", { id }, { rest: ["GET", `/tasks/${enc(id)}:subscribe`] });
  }

  createPushConfig(taskId: string, cfg: TaskPushNotificationConfig): Promise<TaskPushNotificationConfig> {
    return this.call("CreateTaskPushNotificationConfig", { ...cfg, taskId }, { rest: ["POST", `/tasks/${enc(taskId)}/pushNotificationConfigs`, cfg] });
  }
  getPushConfig(taskId: string, id: string): Promise<TaskPushNotificationConfig> {
    return this.call("GetTaskPushNotificationConfig", { taskId, id }, { rest: ["GET", `/tasks/${enc(taskId)}/pushNotificationConfigs/${enc(id)}`] });
  }
  listPushConfigs(taskId: string): Promise<{ configs: TaskPushNotificationConfig[]; nextPageToken: string }> {
    return this.call("ListTaskPushNotificationConfigs", { taskId }, { rest: ["GET", `/tasks/${enc(taskId)}/pushNotificationConfigs`] });
  }
  deletePushConfig(taskId: string, id: string): Promise<Record<string, never>> {
    return this.call("DeleteTaskPushNotificationConfig", { taskId, id }, { rest: ["DELETE", `/tasks/${enc(taskId)}/pushNotificationConfigs/${enc(id)}`] });
  }

  getExtendedAgentCard(): Promise<AgentCard> {
    return this.call("GetExtendedAgentCard", {}, { rest: ["GET", "/extendedAgentCard"] });
  }

  /** Escape hatch for protocol-error experiments: send an arbitrary JSON-RPC request. */
  rawRpc(body: unknown | string): Promise<any> {
    return this.http("POST", this.iface.url, typeof body === "string" ? body : JSON.stringify(body)).then((r) => r.text().then((t) => { this.opts.wire?.({ dir: "response", text: `${r.status}\n${t}` }); return JSON.parse(t); }));
  }

  // ---------------------------------------------------------------- transport

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", ...(this.opts.extraHeaders ?? {}), ...extra };
    const v = this.opts.version === undefined ? "1.0" : this.opts.version;
    if (v !== null) h["A2A-Version"] = v;
    if (this.opts.token) h["authorization"] = `Bearer ${this.opts.token}`;
    return h;
  }

  private async http(method: string, url: string, body?: string, accept?: string): Promise<Response> {
    const headers = this.headers(accept ? { accept } : {});
    this.opts.wire?.({ dir: "request", text: `${method} ${url}${body ? `\n${body}` : ""}` });
    return fetch(url, { method, headers, body });
  }

  private restUrl(path: string) { return `${this.iface.url.replace(/\/$/, "")}${path}`; }

  private async call<T>(method: string, params: unknown, alt: { rest: [string, string, unknown?] }): Promise<T> {
    if (this.binding === "JSONRPC") {
      const res = await this.http("POST", this.iface.url, JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method, params }));
      const text = await res.text();
      this.opts.wire?.({ dir: "response", text: `${res.status}\n${text}` });
      let env: any;
      try { env = JSON.parse(text); } catch { throw httpError(res.status, text); }
      if (env?.jsonrpc !== "2.0") throw httpError(res.status, text); // e.g. a 401 from the auth gate
      if (env.error) throw errorFromCode(env.error.code, env.error.message);
      return env.result as T;
    }
    const [m, path, body] = alt.rest;
    const res = await this.http(m, this.restUrl(path), body === undefined ? undefined : JSON.stringify(body));
    const text = await res.text();
    this.opts.wire?.({ dir: "response", text: `${res.status} ${res.headers.get("content-type")}\n${text}` });
    if (!res.ok) throw restError(res.status, text);
    return JSON.parse(text) as T;
  }

  private async *stream(method: string, params: unknown, alt: { rest: [string, string, unknown?] }): AsyncGenerator<StreamResponse> {
    let res: Response;
    if (this.binding === "JSONRPC") {
      res = await this.http("POST", this.iface.url, JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method, params }), "text/event-stream");
    } else {
      const [m, path, body] = alt.rest;
      res = await this.http(m, this.restUrl(path), body === undefined ? undefined : JSON.stringify(body), "text/event-stream");
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) {
      // The server answered with a normal error instead of opening a stream.
      const text = await res.text();
      this.opts.wire?.({ dir: "response", text: `${res.status} ${ctype}\n${text}` });
      if (this.binding === "JSONRPC") {
        let env: any; try { env = JSON.parse(text); } catch { throw httpError(res.status, text); }
        if (env?.error?.code !== undefined) throw errorFromCode(env.error.code, env.error.message);
        throw httpError(res.status, text);
      }
      throw restError(res.status, text);
    }
    this.opts.wire?.({ dir: "response", text: `${res.status} text/event-stream (events follow)` });
    for await (const data of sseData(res)) {
      this.opts.wire?.({ dir: "event", text: data });
      const parsed = JSON.parse(data);
      if (this.binding === "JSONRPC") {
        if (parsed.error) throw errorFromCode(parsed.error.code, parsed.error.message);
        yield parsed.result as StreamResponse;
      } else yield parsed as StreamResponse;
    }
  }
}

const enc = encodeURIComponent;

function restError(status: number, text: string): A2AError {
  try {
    const p = JSON.parse(text);
    if (typeof p.code === "number") return errorFromCode(p.code, p.detail ?? p.title);
  } catch { /* fallthrough */ }
  return httpError(status, text);
}

/** Failures below the A2A layer (auth gate, proxies): plain HTTP status, no A2A code. */
function httpError(status: number, text: string): A2AError {
  return new A2AError(-32603, "HttpError", `HTTP ${status}: ${text.slice(0, 200)}`, "HTTP_ERROR", status);
}

/** Minimal SSE parser: yields the joined `data:` payload of each event. */
export async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (data) yield data;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

/** Resolve a stream into the final Task by replaying events (what a real client does). */
export async function foldStream(events: AsyncIterable<StreamResponse>): Promise<{ task?: Task; message?: Message; events: StreamResponse[] }> {
  let task: Task | undefined; let message: Message | undefined; const all: StreamResponse[] = [];
  for await (const ev of events) {
    all.push(ev);
    if (ev.message) message = ev.message;
    if (ev.task) task = structuredClone(ev.task);
    if (ev.statusUpdate && task) { task.status = ev.statusUpdate.status; }
    if (ev.artifactUpdate && task) {
      const { artifact, append } = ev.artifactUpdate;
      const list = (task.artifacts ??= []);
      const i = list.findIndex((a) => a.artifactId === artifact.artifactId);
      if (i < 0) list.push(structuredClone(artifact));
      else if (append) list[i]!.parts.push(...artifact.parts);
      else list[i] = structuredClone(artifact);
    }
  }
  return { task, message, events: all };
}
