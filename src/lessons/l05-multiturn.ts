import { textOf } from "../protocol.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 5, name: "Multi-turn: INPUT_REQUIRED", async run(base: string) {
  title(5, "Multi-turn conversations with INPUT_REQUIRED");
  const c = await connect(base, "booking");
  note("An agent that needs more info doesn't fail; it parks the task in TASK_STATE_INPUT_REQUIRED and the blocking call returns. This is an 'interrupted' state: the task is alive, waiting for YOU.");
  let r = await c.sendMessage("Book me a trip");
  let t = r.task!;
  ok(`${t.status.state}: "${textOf(t.status.message)}"`);
  note("To answer, send a new message with the SAME taskId (and contextId). Without taskId you'd start a brand-new task.");
  for (const answer of ["Lisbon", "2026-12-01 to 2026-12-05"]) {
    r = await c.sendMessage(c.userMessage(answer, { taskId: t.id, contextId: t.contextId }));
    t = r.task!;
    ok(`${t.status.state}${t.status.message ? `: "${textOf(t.status.message)}"` : ""}`);
  }
  show("confirmation artifact:", t.artifacts![0]!.parts[0]!.data);
  show("history roles:", t.history!.map((m) => m.role.replace("ROLE_", "")).join(" → "));
  note("Terminal means final. Sending to a COMPLETED task is rejected (you must start a new task, reusing contextId if you want conversational continuity):");
  try { await c.sendMessage(c.userMessage("one more thing", { taskId: t.id })); } catch (e: any) { ok(`${e.kind}: ${e.message}`); }
} };
if (import.meta.main) await withTestbed(lesson.run);
