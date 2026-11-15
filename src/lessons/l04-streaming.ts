import { foldStream } from "../client/client.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 4, name: "Streaming (SSE)", async run(base: string) {
  title(4, "SendStreamingMessage: Server-Sent Events");
  const c = await connect(base, "reporter");
  note("Streaming needs capabilities.streaming=true. Each SSE event carries a StreamResponse with exactly one of: task | message | statusUpdate | artifactUpdate. The first event is the Task snapshot; then updates; the stream closes at a terminal (or interrupted) state.");
  const events: string[] = [];
  const gen = c.streamMessage(c.userMessage("deep sea mining", { metadata: { stepMs: 80 } }));
  const folded = await foldStream((async function* () { for await (const e of gen) { events.push(Object.keys(e)[0]!); yield e; } })());
  show("event sequence:", events.join(" → "));
  note("Artifacts stream as chunks: artifactUpdate{append:false} creates 'report', later chunks have append:true, the last has lastChunk:true. A client rebuilds the artifact by concatenating parts (foldStream does exactly that).");
  show("reassembled report:", folded.task!.artifacts!.find((a) => a.artifactId === "report")!.parts.map((p) => p.text).join(""));
  ok(`final state from folding events: ${folded.task!.status.state}`);
  note("Disconnecting from a stream does NOT cancel the task. Try it: start streaming, break after the first event, then GetTask.");
  let id = "";
  for await (const ev of c.streamMessage(c.userMessage("abandoned", { metadata: { stepMs: 80 } }))) { if (ev.task) { id = ev.task.id; break; } }
  await new Promise((r) => setTimeout(r, 900));
  ok(`task ${id.slice(0, 8)}… still finished on its own: ${(await c.getTask(id, 0)).status.state}`);
} };
if (import.meta.main) await withTestbed(lesson.run);
