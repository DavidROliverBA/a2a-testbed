import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 9, name: "Bindings: JSON-RPC vs HTTP+JSON", async run(base: string) {
  title(9, "One protocol, interchangeable bindings");
  note("A2A is defined once (a2a.proto) and mapped onto transports. Same operations, same data; only the envelope differs. Watch the wire: JSON-RPC POSTs everything to one URL with a method name; REST uses resource URLs (POST /message:send, GET /tasks/{id}, POST /tasks/{id}:cancel).");
  for (const binding of ["JSONRPC", "HTTP+JSON"] as const) {
    console.log(`\n--- ${binding} ---`);
    const c = await connect(base, "reporter", { binding });
    const { task } = await c.sendMessage(c.userMessage("binding test", { metadata: { stepMs: 20 } }));
    ok(`${binding}: ${task!.status.state}, artifacts: ${task!.artifacts!.map((a) => a.artifactId).join(",")}`);
    await c.getTask(task!.id, 0);
  }
  note("Errors differ in shape but carry the same meaning. JSON-RPC: {error:{code:-32001,…}}. REST: HTTP 404 + {error:{code:404,status:NOT_FOUND,details:[ErrorInfo]}}.");
  const rest = await connect(base, "reporter", { binding: "HTTP+JSON" });
  try { await rest.getTask("nope"); } catch (e: any) { ok(`REST → ${e.kind} (${e.code})`); }
  const rpc = await connect(base, "reporter", { binding: "JSONRPC" });
  try { await rpc.getTask("nope"); } catch (e: any) { ok(`JSON-RPC → ${e.kind} (${e.code})`); }
  note("(gRPC is the third official binding; it's not implemented in this testbed. Its service definition is in a2a.proto.)");
  show("also try by hand:", `curl -s -X POST ${base}/echo/rest/message:send -H 'content-type: application/json' -H 'A2A-Version: 1.0' -d '{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"hi"}]}}'`);
} };
if (import.meta.main) await withTestbed(lesson.run);
