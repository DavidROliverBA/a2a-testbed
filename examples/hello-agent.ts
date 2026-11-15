// A complete A2A v1.0 agent with no dependencies. Run: bun hello-agent.ts
const BASE = "http://localhost:4747";

const card = {
  name: "Hello Agent",
  description: "Greets whoever writes to it.",
  version: "1.0.0",
  supportedInterfaces: [{ url: `${BASE}/rpc`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [{ id: "greet", name: "Greet", description: "Says hello back", tags: ["demo"] }],
};

Bun.serve({
  port: 4747,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    // 1. Discovery: the Agent Card lives at a well-known address.
    if (pathname === "/.well-known/agent-card.json") return Response.json(card);

    // 2. The one operation this agent supports: SendMessage.
    if (pathname === "/rpc" && req.method === "POST") {
      const { id, method, params } = await req.json();
      if (method !== "SendMessage")
        return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });

      const said = params.message.parts.map((p: { text?: string }) => p.text ?? "").join(" ");
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          message: {
            messageId: crypto.randomUUID(),
            contextId: params.message.contextId ?? crypto.randomUUID(),
            role: "ROLE_AGENT",
            parts: [{ text: `Hello! You said: ${said}` }],
          },
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Hello Agent is listening on ${BASE}`);
