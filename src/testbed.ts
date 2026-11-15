import { allAgents } from "./agents/index.ts";
import { startServer, type Testbed } from "./server/http.ts";

export function startTestbed(opts: { port?: number; log?: boolean } = {}): Testbed {
  // Callbacks may only go to hosts named here. The lab's own receivers listen on 127.0.0.1.
  const callbackAllow = (process.env.A2A_CALLBACK_ALLOW ?? "127.0.0.1").split(",").map((h) => h.trim()).filter(Boolean);
  return startServer({ port: opts.port ?? 4747, log: opts.log, makeAgents: () => allAgents(), callbackAllow });
}

if (import.meta.main) {
  const tb = startTestbed({ port: Number(process.env.A2A_PORT ?? 4747), log: true });
  console.log(`\nA2A testbed listening on ${tb.baseUrl}\n`);
  for (const id of tb.runtimes.keys()) console.log(`  ${id.padEnd(13)} ${tb.baseUrl}/${id}/.well-known/agent-card.json`);
  console.log(`\nTry:  curl ${tb.baseUrl}/echo/.well-known/agent-card.json | jq\n      bun run lesson 1\n`);
}
