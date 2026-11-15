/**
 * TaskRuntime: the A2A *server-side state machine* for one agent.
 *
 * An agent author only writes `execute(ctx)` and talks to `ctx.bus`:
 *   bus.reply(...)                      → answer with a lone Message (no task)
 *   bus.status(state, message?)         → create/advance a Task
 *   bus.artifact(artifact, {append,…})  → attach (or stream chunks of) a result
 *
 * The runtime does everything the protocol demands around that: task storage,
 * history, SUBMITTED-on-first-event, blocking vs returnImmediately, streaming
 * fan-out, resubscription, cancellation, push-notification delivery, and the
 * "terminal tasks are immutable" rule.
 *
 * Security rules enforced here (lesson 13):
 *   - every task has an owner (the signed-in caller who started it); every
 *     operation that names a task checks the owner, and answers "not found"
 *     to anyone else so task ids can't be probed
 *   - callback addresses are checked before anything is stored (callbacks.ts)
 */
import {
  A2AError, Errors, INTERRUPTED, TERMINAL, clone, effectiveMediaType, isInterrupted, isTerminal,
  message as mkMessage, now, partKind, uid, sleep,
  type AgentCard, type Artifact, type ListTasksRequest, type ListTasksResponse, type Message, type Part,
  type SendMessageRequest, type SendMessageResponse, type StreamResponse, type Task, type TaskPushNotificationConfig,
  type TaskState,
} from "../protocol.ts";
import { checkCallbackUrl } from "./callbacks.ts";

export interface Bus {
  /** Reply with a stateless Message. Only valid before any task event. */
  reply(parts: Part[] | string, extra?: Partial<Message>): void;
  /** Move the task to `state`. `msg` becomes the status message (and is appended to history). */
  status(state: TaskState, msg?: string | Message): void;
  artifact(artifact: Artifact, opts?: { append?: boolean; lastChunk?: boolean }): void;
}

/** Who is making this request, as established by the HTTP layer. Agents never see raw credentials. */
export interface Caller {
  /** Signed-in identity; undefined on agents that don't require sign-in. */
  principal?: string;
  /** True when the HTTP layer verified an extra ("step-up") credential on this request. */
  stepUp?: boolean;
}

export interface ExecContext {
  /** The message that triggered this run. */
  message: Message;
  /** Present on follow-up turns (the task already exists). */
  task?: Task;
  taskId: string;
  contextId: string;
  /** Aborted when the client cancels the task. Pass it to sleep()/fetch(). */
  signal: AbortSignal;
  bus: Bus;
  /** The signed-in caller, if the agent requires sign-in. */
  principal?: string;
  /** Whether a step-up credential was verified for this request (never the credential itself). */
  stepUp: boolean;
  /** Base URL of this testbed, so agents can call each other. */
  baseUrl: string;
}

export interface AgentDef {
  id: string;
  card(baseUrl: string): AgentCard;
  extendedCard?(baseUrl: string): AgentCard;
  /**
   * If set, every non-card request must carry `Authorization: Bearer <token>`.
   * `tokens` maps each token to the identity it stands for. `stepUp` names a header
   * that carries a second credential, checked by the HTTP layer.
   */
  auth?: { tokens: Record<string, string>; stepUp?: { header: string; value: string } };
  /**
   * Optional: return a copy of an incoming message that is safe to keep. Used to strip
   * anything that should never sit in task history (e.g. a credential typed by mistake).
   * The agent still receives the original for this one run.
   */
  redact?(message: Message): Message;
  /** Media types accepted on input; defaults to card.defaultInputModes. Supports a wildcard of any/any. */
  acceptedInputModes?: string[];
  execute(ctx: ExecContext): Promise<void>;
}

type Listener = (ev: StreamResponse) => void;

/** A tiny async queue used to turn push-style events into `for await`. */
export class Channel<T> implements AsyncIterable<T> {
  private q: T[] = [];
  private waiter?: () => void;
  private closed = false;
  constructor(private onDispose?: () => void) {}
  push(v: T) { if (this.closed) return; this.q.push(v); this.waiter?.(); }
  close() { if (this.closed) return; this.closed = true; this.waiter?.(); this.onDispose?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    try {
      while (true) {
        if (this.q.length) { yield this.q.shift()!; continue; }
        if (this.closed) return;
        await new Promise<void>((r) => (this.waiter = r));
      }
    } finally { this.close(); }
  }
}

export class TaskRuntime {
  readonly tasks = new Map<string, Task>();
  /** taskId → the principal who started it. Kept off the wire. */
  private owners = new Map<string, string | undefined>();
  private listeners = new Map<string, Set<Listener>>();
  private pushConfigs = new Map<string, Map<string, TaskPushNotificationConfig>>();
  private running = new Map<string, AbortController>();
  /** Push deliveries made (observable in tests / lessons). */
  readonly pushLog: { taskId: string; url: string; status: number | string }[] = [];
  private callbackAllow: readonly string[];

  constructor(readonly def: AgentDef, readonly baseUrl: string, opts: { callbackAllow?: readonly string[] } = {}) {
    this.callbackAllow = opts.callbackAllow ?? [];
  }

  private get card(): AgentCard { return this.def.card(this.baseUrl); }

  /** The task, if it exists AND belongs to this caller. Otherwise "not found", never "forbidden". */
  private owned(id: string, caller: Caller): Task {
    const t = this.tasks.get(id);
    if (!t || this.owners.get(id) !== caller.principal) throw Errors.taskNotFound(id);
    return t;
  }

  // ---------------------------------------------------------------- core

  /**
   * Validate and start one execution. Throws A2AError synchronously for bad
   * requests (so transports can answer with a normal error, not a half-open stream).
   */
  private launch(req: SendMessageRequest, onEvent: Listener, caller: Caller): { taskId: string; done: Promise<void> } {
    const m = req?.message;
    if (!m || typeof m !== "object") throw Errors.invalidParams("`message` is required");
    if (!m.messageId) throw Errors.invalidParams("`message.messageId` is required");
    if (m.role !== "ROLE_USER") throw Errors.invalidParams("`message.role` must be ROLE_USER when sending to an agent");
    if (!Array.isArray(m.parts) || m.parts.length === 0) throw Errors.invalidParams("`message.parts` must be a non-empty array");
    for (const p of m.parts) {
      if (partKind(p) === "invalid") throw Errors.invalidParams("each part must have exactly one of text | raw | url | data");
    }
    const accepted = this.def.acceptedInputModes ?? this.card.defaultInputModes;
    for (const p of m.parts) {
      const mt = effectiveMediaType(p);
      const ok = accepted.some((a) => a === "*/*" || a === mt || (a.endsWith("/*") && mt.startsWith(a.slice(0, -1))));
      if (!ok) throw Errors.contentType(`Media type ${mt} not accepted. Accepted: ${accepted.join(", ")}`);
    }

    // A callback address is checked before any work starts or anything is stored.
    const pushCfg = req.configuration?.taskPushNotificationConfig;
    if (pushCfg) { this.requirePush(); checkCallbackUrl(pushCfg.url, this.callbackAllow); }

    let existing: Task | undefined;
    if (m.taskId) {
      existing = this.owned(m.taskId, caller);
      if (isTerminal(existing.status.state))
        throw Errors.unsupported(`Task ${existing.id} is ${existing.status.state}; terminal tasks can't be continued. Start a new task (reuse contextId to keep the conversation).`);
      if (!isInterrupted(existing.status.state))
        throw Errors.unsupported(`Task ${existing.id} is still ${existing.status.state}; wait for it to finish or be interrupted.`);
      if (m.contextId && m.contextId !== existing.contextId) throw Errors.invalidParams("message.contextId does not match the task's contextId");
    }

    const taskId = existing?.id ?? uid();
    const contextId = existing?.contextId ?? m.contextId ?? uid();
    const userMsg: Message = { ...clone(m), taskId, contextId };
    const kept: Message = this.def.redact ? this.def.redact(clone(userMsg)) : userMsg; // what goes into history
    const abort = new AbortController();
    this.addListener(taskId, onEvent);

    const registerPush = () => { if (pushCfg) this.storePushConfig(taskId, pushCfg); };

    if (existing) {
      existing.history = [...(existing.history ?? []), kept];
      registerPush();
    }

    // -- the Bus the executor talks to
    const ensureTask = (): Task => {
      let t = this.tasks.get(taskId);
      if (!t) {
        t = { id: taskId, contextId, status: { state: "TASK_STATE_SUBMITTED", timestamp: now() }, artifacts: [], history: [kept] };
        this.tasks.set(taskId, t);
        this.owners.set(taskId, caller.principal);
        registerPush();
        this.emit(taskId, { task: clone(t) });
      }
      return t;
    };
    let replied = false;
    const bus: Bus = {
      reply: (parts, extra) => {
        if (this.tasks.has(taskId)) throw Errors.invalidAgentResponse("Agent already created a task; it can't reply with a bare Message");
        replied = true;
        this.emit(taskId, { message: { ...mkMessage("agent", parts, extra), contextId } });
      },
      status: (state, msg) => {
        const t = ensureTask();
        if (isTerminal(t.status.state)) return; // immutable once terminal (e.g. after cancel)
        const sm = msg === undefined ? undefined : typeof msg === "string" ? mkMessage("agent", msg) : clone(msg);
        if (sm) { sm.taskId = taskId; sm.contextId = contextId; t.history = [...(t.history ?? []), sm]; }
        t.status = { state, message: sm, timestamp: now() };
        this.emit(taskId, { statusUpdate: { taskId, contextId, status: clone(t.status) } });
      },
      artifact: (artifact, opts = {}) => {
        const t = ensureTask();
        if (isTerminal(t.status.state)) return;
        const list = (t.artifacts ??= []);
        const i = list.findIndex((a) => a.artifactId === artifact.artifactId);
        if (opts.append && i >= 0) list[i]!.parts.push(...clone(artifact.parts));
        else if (i >= 0) list[i] = clone(artifact);
        else list.push(clone(artifact));
        this.emit(taskId, { artifactUpdate: { taskId, contextId, artifact: clone(artifact), append: opts.append ?? false, lastChunk: opts.lastChunk ?? false } });
      },
    };

    this.running.set(taskId, abort);
    const done = (async () => {
      await Promise.resolve(); // let the transport attach before the first event
      try {
        await this.def.execute({
          message: userMsg, task: existing ? clone(existing) : undefined, taskId, contextId,
          signal: abort.signal, bus, baseUrl: this.baseUrl, principal: caller.principal, stepUp: caller.stepUp === true,
        });
        const t = this.tasks.get(taskId);
        if (!replied && (!t || (!isTerminal(t.status.state) && !isInterrupted(t.status.state) && !abort.signal.aborted))) {
          // Executor returned without finishing. That's an agent bug; surface it honestly.
          bus.status("TASK_STATE_FAILED", "Agent finished without reaching a terminal or interrupted state");
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          bus.status("TASK_STATE_FAILED", `Agent error: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        this.running.delete(taskId);
      }
    })();
    return { taskId, done };
  }

  // ---------------------------------------------------------------- operations

  /** SendMessage */
  send(req: SendMessageRequest, caller: Caller = {}): Promise<SendMessageResponse> {
    const returnImmediately = req.configuration?.returnImmediately === true;
    const historyLength = req.configuration?.historyLength;
    let settle!: (r: SendMessageResponse) => void;
    const result = new Promise<SendMessageResponse>((r) => (settle = r));
    let taskId = "";
    const finish = () => settle({ task: this.snapshot(taskId, historyLength) });
    const listener: Listener = (ev) => {
      if (ev.message) return settle({ message: ev.message });
      if (returnImmediately && (ev.task || ev.statusUpdate || ev.artifactUpdate)) return finish();
      const st = ev.statusUpdate?.status.state;
      if (st && (TERMINAL.has(st) || INTERRUPTED.has(st))) finish();
    };
    const l = this.launch(req, listener, caller);
    taskId = l.taskId;
    l.done.then(() => { this.removeListener(taskId, listener); if (this.tasks.has(taskId)) finish(); });
    return result;
  }

  /** SendStreamingMessage. Disconnecting does NOT cancel the task. */
  streamMessage(req: SendMessageRequest, caller: Caller = {}): Channel<StreamResponse> {
    if (!this.card.capabilities.streaming) throw Errors.unsupported("This agent does not support streaming");
    let listener!: Listener;
    let taskId = "";
    const ch = new Channel<StreamResponse>(() => this.removeListener(taskId, listener));
    listener = (ev) => ch.push(ev);
    const l = this.launch(req, listener, caller);
    taskId = l.taskId;
    l.done.then(() => ch.close());
    return ch;
  }

  /** SubscribeToTask: current Task first, then live events, until terminal or the client leaves. */
  subscribe(id: string, caller: Caller = {}): Channel<StreamResponse> {
    if (!this.card.capabilities.streaming) throw Errors.unsupported("This agent does not support streaming");
    const t = this.owned(id, caller);
    if (isTerminal(t.status.state)) throw Errors.unsupported(`Task ${id} is already ${t.status.state}; nothing to subscribe to`);
    let listener!: Listener;
    const ch = new Channel<StreamResponse>(() => this.removeListener(id, listener));
    listener = (ev) => {
      ch.push(ev);
      const st = ev.statusUpdate?.status.state;
      if (st && TERMINAL.has(st)) ch.close();
    };
    ch.push({ task: this.snapshot(id)! });
    this.addListener(id, listener);
    return ch;
  }

  /** GetTask */
  getTask(id: string, historyLength?: number, caller: Caller = {}): Task {
    this.owned(id, caller);
    return this.snapshot(id, historyLength)!;
  }

  /** ListTasks: only the caller's own tasks; filter, newest-first by status timestamp, page by opaque token. */
  listTasks(req: ListTasksRequest, caller: Caller = {}): ListTasksResponse {
    const size = req.pageSize ?? 50;
    if (!Number.isInteger(size) || size < 1 || size > 100) throw Errors.invalidParams("pageSize must be 1..100");
    let all = [...this.tasks.values()].filter((t) => this.owners.get(t.id) === caller.principal);
    if (req.contextId) all = all.filter((t) => t.contextId === req.contextId);
    if (req.status && req.status !== "TASK_STATE_UNSPECIFIED") all = all.filter((t) => t.status.state === req.status);
    if (req.statusTimestampAfter) all = all.filter((t) => (t.status.timestamp ?? "") > req.statusTimestampAfter!);
    all.sort((a, b) => (b.status.timestamp ?? "").localeCompare(a.status.timestamp ?? ""));
    const offset = req.pageToken ? Number(atob(req.pageToken)) : 0;
    if (!Number.isFinite(offset) || offset < 0) throw Errors.invalidParams("invalid pageToken");
    const page = all.slice(offset, offset + size).map((t) => {
      const c = trim(clone(t), req.historyLength ?? 0);
      if (!req.includeArtifacts) delete c.artifacts;
      return c;
    });
    const next = offset + size < all.length ? btoa(String(offset + size)) : "";
    return { tasks: page, nextPageToken: next, pageSize: page.length, totalSize: all.length };
  }

  /** CancelTask */
  cancel(id: string, caller: Caller = {}): Task {
    const t = this.owned(id, caller);
    if (isTerminal(t.status.state)) throw Errors.taskNotCancelable(id, t.status.state);
    this.running.get(id)?.abort();
    t.status = { state: "TASK_STATE_CANCELED", message: mkMessage("agent", "Canceled by client", { taskId: id, contextId: t.contextId }), timestamp: now() };
    this.emit(id, { statusUpdate: { taskId: id, contextId: t.contextId!, status: clone(t.status) } });
    return this.snapshot(id)!;
  }

  // ---------------------------------------------------------------- push notification configs

  private requirePush() { if (!this.card.capabilities.pushNotifications) throw Errors.pushNotSupported(); }

  createPushConfig(taskId: string, cfg: TaskPushNotificationConfig, caller: Caller = {}): TaskPushNotificationConfig {
    this.requirePush();
    this.owned(taskId, caller);
    if (!cfg?.url) throw Errors.invalidParams("`url` is required");
    checkCallbackUrl(cfg.url, this.callbackAllow);
    return this.storePushConfig(taskId, cfg);
  }
  /** Stores a config whose url has already been checked. */
  private storePushConfig(taskId: string, cfg: TaskPushNotificationConfig): TaskPushNotificationConfig {
    const stored = { ...clone(cfg), id: cfg.id ?? uid(), taskId };
    let m = this.pushConfigs.get(taskId);
    if (!m) this.pushConfigs.set(taskId, (m = new Map()));
    m.set(stored.id!, stored);
    return stored;
  }
  getPushConfig(taskId: string, id: string, caller: Caller = {}): TaskPushNotificationConfig {
    this.requirePush();
    this.owned(taskId, caller);
    const c = this.pushConfigs.get(taskId)?.get(id);
    if (!c) throw Errors.taskNotFound(`${taskId}/pushNotificationConfigs/${id}`);
    return c;
  }
  listPushConfigs(taskId: string, caller: Caller = {}): { configs: TaskPushNotificationConfig[]; nextPageToken: string } {
    this.requirePush();
    this.owned(taskId, caller);
    return { configs: [...(this.pushConfigs.get(taskId)?.values() ?? [])], nextPageToken: "" };
  }
  /** Idempotent by spec. */
  deletePushConfig(taskId: string, id: string, caller: Caller = {}): Record<string, never> {
    this.requirePush();
    this.owned(taskId, caller);
    this.pushConfigs.get(taskId)?.delete(id);
    return {};
  }

  // ---------------------------------------------------------------- plumbing

  private snapshot(id: string, historyLength?: number): Task | undefined {
    const t = this.tasks.get(id);
    return t ? trim(clone(t), historyLength) : undefined;
  }
  private addListener(id: string, l: Listener) {
    let s = this.listeners.get(id);
    if (!s) this.listeners.set(id, (s = new Set()));
    s.add(l);
  }
  private removeListener(id: string, l: Listener) { this.listeners.get(id)?.delete(l); }

  private emit(taskId: string, ev: StreamResponse) {
    for (const l of [...(this.listeners.get(taskId) ?? [])]) l(clone(ev));
    if (!ev.message) this.deliverPush(taskId, ev);
  }

  /**
   * Push notifications: plain HTTP POST of a StreamResponse to each registered webhook.
   * Redirects are not followed, so an accepted address can't bounce the request somewhere else.
   */
  private deliverPush(taskId: string, ev: StreamResponse) {
    for (const cfg of this.pushConfigs.get(taskId)?.values() ?? []) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (cfg.token) headers["X-A2A-Notification-Token"] = cfg.token;
      if (cfg.authentication) headers["authorization"] = `${cfg.authentication.scheme} ${cfg.authentication.credentials ?? ""}`.trim();
      fetch(cfg.url, { method: "POST", headers, body: JSON.stringify(ev), redirect: "manual" })
        .then((r) => this.pushLog.push({ taskId, url: cfg.url, status: r.status }))
        .catch((e) => this.pushLog.push({ taskId, url: cfg.url, status: `error: ${e.message}` }));
    }
  }
}

function trim(t: Task, historyLength?: number): Task {
  if (historyLength === undefined) return t;
  if (historyLength <= 0) delete t.history;
  else if (t.history) t.history = t.history.slice(-historyLength);
  return t;
}

export { A2AError, sleep };
