import { connect, note, ok, show, title, withTestbed } from "./lib.ts";
import { sleep } from "../protocol.ts";

export const lesson = { n: 6, name: "Cancel & resubscribe", async run(base: string) {
  title(6, "CancelTask and SubscribeToTask");
  const c = await connect(base, "slowpoke");
  note("Start a slow task with returnImmediately, then attach a SECOND client stream with SubscribeToTask. Multiple observers on one task are allowed; the first event is the current Task snapshot.");
  const { task } = await c.sendMessage(c.userMessage("count", { metadata: { ticks: 50, tickMs: 100 } }), { returnImmediately: true });
  const seen: string[] = [];
  const sub = (async () => {
    for await (const ev of c.subscribeToTask(task!.id)) {
      seen.push(ev.task ? `task(${ev.task.status.state})` : `status(${ev.statusUpdate!.status.state.replace("TASK_STATE_", "")})`);
    }
  })();
  await sleep(450);
  note("Now cancel. The server aborts the agent's AbortSignal (real work stops) and moves the task to CANCELED.");
  const canceled = await c.cancelTask(task!.id);
  ok(`CancelTask returned ${canceled.status.state}`);
  await sub; // stream ends when the task becomes terminal
  show("subscriber saw:", seen.join(", "));
  note("Edge cases: canceling a terminal task → TaskNotCancelableError; subscribing to a terminal task → UnsupportedOperationError.");
  try { await c.cancelTask(task!.id); } catch (e: any) { ok(`cancel again: ${e.kind} (${e.code})`); }
  try { for await (const _ of c.subscribeToTask(task!.id)); } catch (e: any) { ok(`subscribe: ${e.kind} (${e.code})`); }
} };
if (import.meta.main) await withTestbed(lesson.run);
