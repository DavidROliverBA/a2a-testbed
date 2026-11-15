import { textOf } from "../protocol.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 12, name: "Agent-to-agent orchestration", async run(base: string) {
  title(12, "Agents calling agents");
  note("The point of A2A. The orchestrator is opaque to you: you send ONE message and watch ONE task. Internally it discovered echo + reporter from their cards, called one with SendMessage and the other with streaming, and mirrored the results. (Start `bun run serve` and watch the server log to see every hop.)");
  const c = await connect(base, "orchestrator");
  for await (const ev of c.streamMessage("solid-state batteries")) {
    if (ev.statusUpdate) console.log(`  status: ${ev.statusUpdate.status.state.replace("TASK_STATE_", "").padEnd(9)} ${textOf(ev.statusUpdate.status.message)}`);
    if (ev.artifactUpdate) console.log(`  artifact: ${ev.artifactUpdate.artifact.artifactId} (append=${ev.artifactUpdate.append}, last=${ev.artifactUpdate.lastChunk})`);
  }
  const done = (await c.listTasks({ includeArtifacts: true, pageSize: 1 })).tasks[0]!;
  const trace = done.artifacts!.find((a) => a.artifactId === "trace")!.parts[0]!.data as any;
  show("delegation trace:", trace);
  note("Because the orchestrator forwarded its contextId, the downstream tasks share it. Check each agent's ListTasks filtered by that contextId:");
  for (const a of ["echo", "reporter"]) {
    const r = await (await connect(base, a)).listTasks({ contextId: trace.contextId });
    ok(`${a}: ${r.totalSize} task(s) in context ${trace.contextId.slice(0, 8)}…${a === "echo" ? " (echo only ever replies with Messages, so it never creates tasks)" : ""}`);
  }
  note("Design takeaway: delegation uses the same public protocol as any client. Agents stay opaque (no shared memory/tools), which is what lets different vendors' agents interoperate.");
} };
if (import.meta.main) await withTestbed(lesson.run);
