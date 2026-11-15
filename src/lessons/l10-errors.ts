import { connect, expectError, note, title, withTestbed } from "./lib.ts";

export const lesson = { n: 10, name: "Errors & versioning", async run(base: string) {
  title(10, "Errors, protocol edge cases, version negotiation");
  const c = await connect(base, "echo", { binding: "JSONRPC", wire: undefined });
  const rep = await connect(base, "reporter", { wire: undefined });
  note("A2A defines its own error codes on top of JSON-RPC's standard ones (-32001…-32009). Each carries a google.rpc.ErrorInfo with a machine-readable reason.");
  await expectError("GetTask on unknown id", rep.getTask("does-not-exist"));
  await expectError("CancelTask on unknown id", rep.cancelTask("does-not-exist"));
  await expectError("streaming on an agent without capability", c.streamMessage("hi"));
  await expectError("push config on agent without capability", c.createPushConfig("x", { url: "http://x" }));
  await expectError("extended card not configured", c.getExtendedAgentCard());
  await expectError("unsupported media type (image/png to a text-only agent)", c.sendMessage({ ...c.userMessage("x"), parts: [{ raw: btoa("png"), mediaType: "image/png", filename: "a.png" }] }));
  await expectError("message with two content fields in one Part", c.sendMessage({ ...c.userMessage("x"), parts: [{ text: "a", data: 1 }] }));
  await expectError("missing messageId", c.sendMessage({ role: "ROLE_USER", parts: [{ text: "x" }] } as any));
  note("Plain JSON-RPC failures (sent by hand with rawRpc):");
  console.log("  bad JSON       →", JSON.stringify((await c.rawRpc("{nope")).error));
  console.log("  bad envelope   →", JSON.stringify((await c.rawRpc({ id: 1, method: "SendMessage" })).error));
  console.log("  unknown method →", JSON.stringify((await c.rawRpc({ jsonrpc: "2.0", id: 1, method: "Nope" })).error));
  note("Versioning: clients send the A2A-Version header. A server that doesn't speak that major version answers VersionNotSupportedError (-32009). (Lenient here: a missing header is accepted as 1.0.)");
  await expectError("asking for A2A 0.3", c.withOptions({ version: "0.3" }).sendMessage("hi"));
} };
if (import.meta.main) await withTestbed(lesson.run);
