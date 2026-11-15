import { startWebhookReceiver } from "../client/webhook.ts";
import { isTerminal, textOf, type Task } from "../protocol.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const lesson = { n: 14, name: "Patterns: questions back up the chain, callback with a poll", async run(base: string) {
  title(14, "Two patterns: questions travel back up, and a callback with a poll to fall back on");

  note("PATTERN 1. You talk only to the orchestrator. It hands a booking to the booking agent, which needs a city and dates. The orchestrator can't answer that for you, so it pauses ITS OWN task in INPUT_REQUIRED and passes the question up. Watch the state: it is the orchestrator's task that is waiting, with the specialist's question in it.");
  const o = await connect(base, "orchestrator");
  let t: Task = (await o.sendMessage("Book a trip")).task!;
  ok(`orchestrator task ${t.id.slice(0, 8)}: ${t.status.state} "${textOf(t.status.message)}"`);

  note("Answer the orchestrator, using ITS task id. It sends your answer down to the booking agent's task, which you never see. Two questions, so two round trips.");
  for (const answer of ["Lisbon", "2026-12-01 to 2026-12-05"]) {
    t = (await o.sendMessage(o.userMessage(answer, { taskId: t.id, contextId: t.contextId }))).task!;
    ok(`you said "${answer}" → ${t.status.state}${t.status.message ? ` "${textOf(t.status.message)}"` : ""}`);
  }
  show("confirmation (made by booking, passed on and labelled):", t.artifacts!.find((a) => a.artifactId === "booking:confirmation"));
  show("trace:", t.artifacts!.find((a) => a.artifactId === "trace")!.parts[0]!.data);
  note("Two tasks existed: yours on the orchestrator and a hidden one on the booking agent. Each paused and resumed in step. The spec describes this chain for AUTH_REQUIRED (section 7.6); the same shape works for INPUT_REQUIRED.");

  note("PATTERN 2. A callback tells you something changed. It is a nudge, not the record: deliveries can be lost or repeated. So when one arrives, ask the agent for the task with GetTask and act on THAT answer.");
  const hook = startWebhookReceiver();
  const r = await connect(base, "reporter");
  hook.expectNewTask();
  const first = (await r.sendMessage(r.userMessage("tidal power", { metadata: { stepMs: 60 } }), {
    returnImmediately: true, taskPushNotificationConfig: { url: hook.url, token: hook.token },
  })).task!;
  hook.track(first.id);
  ok(`task ${first.id.slice(0, 8)} started (${first.status.state}); we hang up and wait to be called`);
  for (let i = 0; i < 80 && !hook.accepted.some((e) => e.statusUpdate && isTerminal(e.statusUpdate.status.state)); i++) await pause(50);
  ok(`callback received (${hook.accepted.length} deliveries); now confirming with GetTask`);
  const confirmed = await r.getTask(first.id);
  ok(`GetTask says ${confirmed.status.state}, ${confirmed.artifacts?.length ?? 0} artifact(s). This is the answer we act on.`);

  note("Now the callback goes missing. We switch our receiver off right after starting a second task, so every delivery fails. A client that only waits for callbacks would wait for ever. Ours also checks on the task with a timer.");
  hook.expectNewTask();
  const second = (await r.sendMessage(r.userMessage("wave power", { metadata: { stepMs: 60 } }), {
    returnImmediately: true, taskPushNotificationConfig: { url: hook.url, token: hook.token },
  })).task!;
  hook.stop();
  const before = hook.accepted.length;
  let polled = second, polls = 0;
  while (!isTerminal(polled.status.state) && polls < 40) { await pause(150); polled = await r.getTask(second.id, 0); polls++; }
  ok(`no callback arrived (${hook.accepted.length - before} deliveries), but ${polls} poll(s) found the task ${polled.status.state} with ${polled.artifacts?.length ?? 0} artifact(s)`);
  note("Use both: the callback for speed, the poll so that a lost callback costs you a delay and not the result. Space the polls out in real use; this lab polls quickly so the lesson is short.");
} };
if (import.meta.main) await withTestbed(lesson.run);
