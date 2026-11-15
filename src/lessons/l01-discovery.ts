import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 1, name: "Discovery: the Agent Card", async run(base: string) {
  title(1, "Discovery: the Agent Card");
  note("Every A2A agent publishes a JSON 'business card' at /.well-known/agent-card.json. Clients fetch it BEFORE talking to the agent. It says who the agent is, what it can do (skills), which transports it speaks (supportedInterfaces), what it supports (capabilities), and how to authenticate.");
  const c = await connect(base, "reporter");
  show("name:", c.card.name);
  show("capabilities:", c.card.capabilities);
  show("supportedInterfaces:", c.card.supportedInterfaces);
  show("skills:", c.card.skills.map((s) => s.id));
  note("supportedInterfaces[0] is the agent's preferred binding. This testbed serves the same agent over JSON-RPC AND HTTP+JSON at different URLs: the client picks one it understands.");
  ok(`client chose ${c.binding} → ${c.iface.url}`);
  note("Compare agents: `echo` has no streaming, `reporter` does; `vault` declares a bearer securityScheme. Capabilities gate operations: asking echo to stream gets UnsupportedOperationError (lesson 10).");
  const echo = await connect(base, "echo");
  show("echo capabilities:", echo.card.capabilities);
} };
if (import.meta.main) await withTestbed(lesson.run);
