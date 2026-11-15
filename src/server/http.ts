/**
 * HTTP layer: serves every agent under /<agentId>/ with BOTH standard bindings.
 *
 *   GET  /<id>/.well-known/agent-card.json     Agent Card (public, discovery)
 *   POST /<id>/rpc                             JSON-RPC 2.0 binding  (method names = RPC names)
 *   *    /<id>/rest/...                        HTTP+JSON binding     (/message:send, /tasks/{id}, …)
 *
 * Auth (`Authorization: Bearer …`) and the `A2A-Version` header are enforced here,
 * *outside* the protocol logic, as the spec intends.
 */
import { A2AError, Errors, PROTOCOL_VERSION, type AgentCard, type StreamResponse } from "../protocol.ts";
import { TaskRuntime, type AgentDef, type Caller, type Channel } from "./runtime.ts";

export interface Testbed {
  baseUrl: string;
  port: number;
  runtimes: Map<string, TaskRuntime>;
  stop(): void;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

export function startServer(opts: {
  port?: number;
  hostname?: string;
  makeAgents: (baseUrl: string) => AgentDef[];
  log?: boolean;
  /** Hosts that callbacks may be sent to even though they are internal (see callbacks.ts). */
  callbackAllow?: readonly string[];
}): Testbed {
  const runtimes = new Map<string, TaskRuntime>();
  let baseUrl = "";
  const log = (s: string) => opts.log && console.log(`\x1b[2m[server] ${s}\x1b[0m`);

  const server = Bun.serve({
    port: opts.port ?? 4000,
    hostname: opts.hostname ?? "127.0.0.1",
    idleTimeout: 120, // SSE streams outlive Bun's 10s default
    async fetch(req) {
      const url = new URL(req.url);
      const [, agentId, kind, ...rest] = url.pathname.split("/");
      try {
        if (url.pathname === "/") {
          return json({
            testbed: "a2a-testbed", protocolVersion: PROTOCOL_VERSION,
            agents: [...runtimes.keys()].map((id) => ({ id, card: `${baseUrl}/${id}/.well-known/agent-card.json` })),
          });
        }
        const rt = agentId ? runtimes.get(agentId) : undefined;
        if (!rt) return json({ error: `No agent '${agentId}'` }, { status: 404 });

        // 1. Discovery is always public.
        if (req.method === "GET" && url.pathname === `/${agentId}/.well-known/agent-card.json`) {
          log(`${agentId} card`);
          return json(rt.def.card(baseUrl));
        }

        // 2. Auth gate. Credentials are checked HERE, before any agent code runs.
        //    The agent only ever learns who the caller is, never the credential.
        const caller: Caller = {};
        if (rt.def.auth) {
          const h = req.headers.get("authorization") ?? "";
          const token = h.startsWith("Bearer ") ? h.slice(7) : "";
          if (!Object.hasOwn(rt.def.auth.tokens, token)) {
            log(`${agentId} 401`);
            return json({ error: "Unauthorized", hint: "send Authorization: Bearer <token>" }, { status: 401, headers: { "www-authenticate": 'Bearer realm="a2a"' } });
          }
          caller.principal = rt.def.auth.tokens[token];
          const su = rt.def.auth.stepUp;
          const offered = su ? req.headers.get(su.header) : null;
          if (su && offered !== null) {
            if (offered !== su.value) {
              log(`${agentId} 403 (step-up)`);
              return json({ error: "Forbidden", hint: `the ${su.header} credential was not accepted` }, { status: 403 });
            }
            caller.stepUp = true;
          }
        }

        // 3. Version negotiation (header or ?A2A-Version=). Absent → assume current.
        const requested = req.headers.get("a2a-version") ?? url.searchParams.get("A2A-Version");
        const versionError = requested && !requested.startsWith("1.") ? Errors.versionNotSupported(requested) : undefined;

        if (kind === "rpc" && req.method === "POST") return await handleRpc(rt, req, caller, versionError, log);
        if (kind === "rest") return await handleRest(rt, req, url, `/${rest.join("/")}`, caller, versionError, log);
        return json({ error: "Not found" }, { status: 404 });
      } catch (e) {
        log(`unhandled ${e}`);
        return json({ error: String(e) }, { status: 500 });
      }
    },
  });

  baseUrl = `http://${server.hostname}:${server.port}`;
  for (const def of opts.makeAgents(baseUrl)) runtimes.set(def.id, new TaskRuntime(def, baseUrl, { callbackAllow: opts.callbackAllow }));
  return { baseUrl, port: server.port as number, runtimes, stop: () => server.stop(true) };
}

// ===================================================================== JSON-RPC

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, e: A2AError) => ({
  jsonrpc: "2.0", id,
  error: {
    code: e.code, message: e.message,
    data: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: e.reason, domain: "a2a-protocol.org" }],
  },
});

async function handleRpc(rt: TaskRuntime, req: Request, caller: Caller, versionError: A2AError | undefined, log: (s: string) => void): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return json(rpcError(null, Errors.parse())); }
  const id = body?.id ?? null;
  if (body?.jsonrpc !== "2.0" || typeof body?.method !== "string" || (body.id !== undefined && typeof body.id !== "string" && typeof body.id !== "number"))
    return json(rpcError(id, Errors.invalidRequest()));
  const p = body.params ?? {};
  log(`${rt.def.id} rpc ${body.method}`);
  try {
    if (versionError) throw versionError;
    switch (body.method) {
      case "SendMessage": return json(rpcResult(id, await rt.send(p, caller)));
      case "SendStreamingMessage": return sse(rt.streamMessage(p, caller), (ev) => rpcResult(id, ev));
      case "SubscribeToTask": return sse(rt.subscribe(need(p, "id"), caller), (ev) => rpcResult(id, ev));
      case "GetTask": return json(rpcResult(id, rt.getTask(need(p, "id"), p.historyLength, caller)));
      case "ListTasks": return json(rpcResult(id, rt.listTasks(p, caller)));
      case "CancelTask": return json(rpcResult(id, rt.cancel(need(p, "id"), caller)));
      case "CreateTaskPushNotificationConfig": return json(rpcResult(id, rt.createPushConfig(need(p, "taskId"), p, caller)));
      case "GetTaskPushNotificationConfig": return json(rpcResult(id, rt.getPushConfig(need(p, "taskId"), need(p, "id"), caller)));
      case "ListTaskPushNotificationConfigs": return json(rpcResult(id, rt.listPushConfigs(need(p, "taskId"), caller)));
      case "DeleteTaskPushNotificationConfig": return json(rpcResult(id, rt.deletePushConfig(need(p, "taskId"), need(p, "id"), caller)));
      case "GetExtendedAgentCard": return json(rpcResult(id, extended(rt)));
      default: throw Errors.methodNotFound(body.method);
    }
  } catch (e) {
    return json(rpcError(id, asA2A(e)));
  }
}

// ===================================================================== HTTP+JSON (REST)

function problem(e: A2AError): Response {
  return new Response(
    JSON.stringify({
      type: `https://a2a-protocol.org/errors/${e.reason.toLowerCase().replaceAll("_", "-")}`,
      title: e.kind, status: e.httpStatus, detail: e.message, code: e.code, reason: e.reason,
    }),
    { status: e.httpStatus, headers: { "content-type": "application/problem+json" } },
  );
}

async function handleRest(rt: TaskRuntime, req: Request, url: URL, path: string, caller: Caller, versionError: A2AError | undefined, log: (s: string) => void): Promise<Response> {
  log(`${rt.def.id} rest ${req.method} ${path}`);
  const q = url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  try {
    if (versionError) throw versionError;
    const m = req.method;
    const body = async () => { try { return await req.json(); } catch { throw Errors.parse(); } };

    if (m === "POST" && path === "/message:send") return json(await rt.send(await body(), caller));
    if (m === "POST" && path === "/message:stream") return sse(rt.streamMessage(await body(), caller), (ev) => ev);
    if (m === "GET" && path === "/tasks") {
      return json(rt.listTasks({
        contextId: q.get("contextId") ?? undefined, status: (q.get("status") as any) ?? undefined,
        pageSize: num("pageSize"), pageToken: q.get("pageToken") ?? undefined, historyLength: num("historyLength"),
        statusTimestampAfter: q.get("statusTimestampAfter") ?? undefined,
        includeArtifacts: q.has("includeArtifacts") ? q.get("includeArtifacts") === "true" : undefined,
      }, caller));
    }
    if (m === "GET" && path === "/extendedAgentCard") return json(extended(rt));

    const t = path.match(/^\/tasks\/([^/:]+)(:cancel|:subscribe)?$/);
    if (t) {
      const id = decodeURIComponent(t[1]!);
      if (m === "GET" && !t[2]) return json(rt.getTask(id, num("historyLength"), caller));
      if (m === "POST" && t[2] === ":cancel") return json(rt.cancel(id, caller));
      if (m === "GET" && t[2] === ":subscribe") return sse(rt.subscribe(id, caller), (ev) => ev);
    }
    const pc = path.match(/^\/tasks\/([^/]+)\/pushNotificationConfigs(?:\/([^/]+))?$/);
    if (pc) {
      const taskId = decodeURIComponent(pc[1]!);
      const cfgId = pc[2] ? decodeURIComponent(pc[2]) : undefined;
      if (m === "POST" && !cfgId) return json(rt.createPushConfig(taskId, await body(), caller));
      if (m === "GET" && !cfgId) return json(rt.listPushConfigs(taskId, caller));
      if (m === "GET" && cfgId) return json(rt.getPushConfig(taskId, cfgId, caller));
      if (m === "DELETE" && cfgId) return json(rt.deletePushConfig(taskId, cfgId, caller));
    }
    throw Errors.methodNotFound(`${m} ${path}`);
  } catch (e) {
    return problem(asA2A(e));
  }
}

// ===================================================================== shared

function need(p: any, key: string): string {
  const v = p?.[key];
  if (typeof v !== "string" || !v) throw Errors.invalidParams(`\`${key}\` is required`);
  return v;
}
function extended(rt: TaskRuntime): AgentCard {
  if (!rt.def.extendedCard) throw Errors.extendedCardNotConfigured();
  return rt.def.extendedCard(rt.baseUrl);
}
function asA2A(e: unknown): A2AError {
  return e instanceof A2AError ? e : Errors.internal(e instanceof Error ? e.message : String(e));
}

/** Server-Sent Events: each event is `data: <json>\n\n`. Client disconnect just stops delivery. */
function sse(ch: Channel<StreamResponse>, wrap: (ev: StreamResponse) => unknown): Response {
  const enc = new TextEncoder();
  const it = ch[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(enc.encode(`data: ${JSON.stringify(wrap(value))}\n\n`));
    },
    cancel() { void it.return(undefined); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
