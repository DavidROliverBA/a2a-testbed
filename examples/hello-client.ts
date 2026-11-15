// Talk to any A2A agent: discover it, then send a message. Run: bun hello-client.ts
const agent = "http://localhost:4747";

// 1. Read the Agent Card and find an interface we can speak.
const card = await (await fetch(`${agent}/.well-known/agent-card.json`)).json();
const rpc = card.supportedInterfaces.find((i: { protocolBinding: string }) => i.protocolBinding === "JSONRPC");
console.log(`Found "${card.name}" with skills: ${card.skills.map((s: { id: string }) => s.id).join(", ")}`);

// 2. Send a message.
const res = await fetch(rpc.url, {
  method: "POST",
  headers: { "content-type": "application/json", "A2A-Version": "1.0" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "SendMessage",
    params: {
      message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text: "Is anyone there?" }] },
    },
  }),
});
const { result } = await res.json();

// 3. The answer is either a quick message or a task to follow.
if (result.message) console.log("Agent replied:", result.message.parts[0].text);
else console.log("Agent started task", result.task.id, "in state", result.task.status.state);
