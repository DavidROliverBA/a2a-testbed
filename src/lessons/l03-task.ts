import { textOf } from "../protocol.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 3, name: "Tasks: lifecycle, GetTask, ListTasks", async run(base: string) {
  title(3, "Tasks: lifecycle, polling, listing");
  const c = await connect(base, "reporter");
  note("Default SendMessage BLOCKS until the task is terminal or interrupted, then returns the whole Task (history + artifacts). stepMs in message metadata just speeds the demo up.");
  const msg = c.userMessage("fusion power", { metadata: { stepMs: 80 } });
  const res = await c.sendMessage(msg);
  const t = res.task!;
  show("state:", t.status.state);
  show("artifacts:", t.artifacts!.map((a) => `${a.artifactId} (${a.parts.length} part${a.parts.length > 1 ? "s" : ""})`));
  show("report text:", t.artifacts!.find((a) => a.artifactId === "report")!.parts.map((p) => p.text).join(""));
  show("history:", t.history!.map((m) => `${m.role}: ${textOf(m)}`));
  note("Now the other mode: returnImmediately=true. You get the Task straight away (SUBMITTED/WORKING) and must poll GetTask (or stream, or use push: lessons 4 and 7).");
  const fast = await c.sendMessage(c.userMessage("tidal power", { metadata: { stepMs: 150 } }), { returnImmediately: true });
  ok(`immediate state: ${fast.task!.status.state}`);
  for (let i = 0; i < 40; i++) {
    const cur = await c.getTask(fast.task!.id, 0); // historyLength 0 = omit history
    process.stdout.write(`  poll ${i + 1}: ${cur.status.state}\n`);
    if (cur.status.state === "TASK_STATE_COMPLETED") break;
    await new Promise((r) => setTimeout(r, 300));
  }
  note("ListTasks filters by contextId/status and pages with an opaque token. Artifacts are omitted unless includeArtifacts=true.");
  const list = await c.listTasks({ status: "TASK_STATE_COMPLETED", pageSize: 1 });
  show("totalSize:", list.totalSize);
  show("nextPageToken:", list.nextPageToken || "(none)");
} };
if (import.meta.main) await withTestbed(lesson.run);
