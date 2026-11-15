import { startWebhookReceiver } from "../client/webhook.ts";
import { connect, expectError, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 7, name: "Push notifications (webhooks)", async run(base: string) {
  title(7, "Push notifications: the server calls YOU");
  note("For tasks that run minutes or hours, holding a stream open is impractical. Instead the client registers a webhook; the server POSTs each StreamResponse to it. Here the 'client' runs a small HTTP receiver (src/client/webhook.ts) that checks every notification before accepting it.");
  const hook = startWebhookReceiver();
  const c = await connect(base, "reporter");

  note("Way 1: attach the config inside SendMessage (configuration.taskPushNotificationConfig). We use returnImmediately and never poll. The token is a secret we invent; the server sends it back with every notification so we can tell real ones from fakes.");
  hook.expectNewTask();
  const { task } = await c.sendMessage(c.userMessage("space elevators", { metadata: { stepMs: 80 } }), {
    returnImmediately: true,
    taskPushNotificationConfig: { url: hook.url, token: hook.token },
  });
  hook.track(task!.id);
  for (let i = 0; i < 60 && !hook.accepted.some((e) => e.statusUpdate?.status.state === "TASK_STATE_COMPLETED"); i++) await new Promise((r) => setTimeout(r, 100));
  show("accepted deliveries:", hook.accepted.map((e) => Object.keys(e)[0] + (e.statusUpdate ? `(${e.statusUpdate.status.state.replace("TASK_STATE_", "")})` : "")).join(", "));

  note("Anyone who learns the address can POST to it. Two forgeries: one with no token, one with the right token but a task we never started. Both are refused.");
  const forged = { statusUpdate: { taskId: task!.id, contextId: "x", status: { state: "TASK_STATE_COMPLETED" } } };
  const r1 = await fetch(hook.url, { method: "POST", body: JSON.stringify(forged) });
  const r2 = await fetch(hook.url, { method: "POST", headers: { "x-a2a-notification-token": hook.token }, body: JSON.stringify({ statusUpdate: { ...forged.statusUpdate, taskId: "someone-elses-task" } }) });
  ok(`no token → ${r1.status}; unknown task → ${r2.status}`);
  show("rejected:", hook.rejected);

  note("Way 2: manage configs with the dedicated RPCs: Create / Get / List / Delete (delete is idempotent).");
  const cfg = await c.createPushConfig(task!.id, { url: hook.url, token: hook.token });
  show("created:", { ...cfg, token: "(hidden)" });
  show("list count:", (await c.listPushConfigs(task!.id)).configs.length);
  await c.deletePushConfig(task!.id, cfg.id!);
  await c.deletePushConfig(task!.id, cfg.id!);
  ok("deleted twice without error");

  note("The server is careful too. A caller chooses where the server will POST, so the server refuses addresses inside its own network unless they are on its allow-list (this lab allows only 127.0.0.1, where the receiver above runs).");
  await expectError("cloud metadata address", c.createPushConfig(task!.id, { url: "http://169.254.169.254/latest/meta-data/" }));
  await expectError("another service on this machine", c.createPushConfig(task!.id, { url: "http://localhost:4747/vault/rpc" }));
  await expectError("public host without https", c.createPushConfig(task!.id, { url: "http://example.com/hook" }));

  note("Agents that don't advertise capabilities.pushNotifications reject these calls:");
  const echo = await connect(base, "echo");
  await expectError("push on echo", echo.createPushConfig("x", { url: hook.url }));
  hook.stop();
} };
if (import.meta.main) await withTestbed(lesson.run);
