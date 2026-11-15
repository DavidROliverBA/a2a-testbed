import { INTERNAL_NOTE } from "../agents/concierge.ts";
import { STEP_UP_HEADER, STEP_UP_VALUE, VAULT_TOKEN, VAULT_TOKEN_BOB } from "../agents/vault.ts";
import { startWebhookReceiver } from "../client/webhook.ts";
import { textOf } from "../protocol.ts";
import { connect, expectError, note, ok, red, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 13, name: "Security: the four checks", async run(base: string) {
  title(13, "Security: who is calling, whose task, where callbacks go, what comes back");
  const quiet = { wire: undefined };

  // ------------------------------------------------------------------ 1
  note("1. WHO IS CALLING. Credentials are checked by the web layer before a request reaches any agent code. The agent learns who the caller is and never sees the credential.");
  const anon = await connect(base, "vault", quiet);
  await expectError("no token", anon.sendMessage("hi"));
  await expectError("made-up token", anon.withOptions({ token: "constructor" }).sendMessage("hi"));
  const alice = anon.withOptions({ token: VAULT_TOKEN });
  const bob = anon.withOptions({ token: VAULT_TOKEN_BOB });
  ok((await alice.sendMessage("hi")).message!.parts[0]!.text!);
  ok((await bob.sendMessage("hi")).message!.parts[0]!.text!);

  // ------------------------------------------------------------------ 2
  note("2. CREDENTIALS MID-TASK. Alice asks for the secret. The task pauses in AUTH_REQUIRED. First the WRONG way: typing the credential into a message. The agent refuses, because messages are stored in the task's history.");
  let t = (await alice.sendMessage("unlock")).task!;
  ok(`${t.status.state}: "${textOf(t.status.message)}"`);
  t = (await alice.sendMessage(alice.userMessage(`token: ${STEP_UP_VALUE}`, { taskId: t.id }))).task!;
  ok(`in a message → ${t.status.state}: "${textOf(t.status.message)}"`);
  note(`The right way: the ${STEP_UP_HEADER} header. A wrong value is stopped at the door with 403 and the task is untouched. The right value lets the task finish.`);
  await expectError("wrong header value", alice.withOptions({ extraHeaders: { [STEP_UP_HEADER]: "guess" } }).sendMessage(alice.userMessage("continue", { taskId: t.id })));
  const aliceStepped = alice.withOptions({ extraHeaders: { [STEP_UP_HEADER]: STEP_UP_VALUE } });

  // ------------------------------------------------------------------ 3
  note("3. WHOSE TASK. Alice's task is still waiting. Bob is signed in and knows its id. Knowing an id must not be enough: every operation checks the owner, and answers 'not found' so Bob can't even confirm the task exists.");
  await expectError("bob reads alice's task", bob.getTask(t.id));
  await expectError("bob cancels alice's task", bob.cancelTask(t.id));
  await expectError("bob continues alice's task (with the right step-up header!)", bob.withOptions({ extraHeaders: { [STEP_UP_HEADER]: STEP_UP_VALUE } }).sendMessage(bob.userMessage("continue", { taskId: t.id })));
  ok(`bob's task list: ${(await bob.listTasks()).totalSize} task(s); alice's: ${(await alice.listTasks()).totalSize}`);
  t = (await aliceStepped.sendMessage(alice.userMessage("continue", { taskId: t.id }))).task!;
  ok(`alice, with the header → ${t.status.state}, released to ${(t.artifacts![0]!.parts[0]!.data as any).releasedTo}`);

  // ------------------------------------------------------------------ 4
  note("4. WHERE CALLBACKS GO. Both ends check. The server refuses to POST to addresses inside its own network (only 127.0.0.1 is allow-listed in this lab). The receiver refuses notifications without its token or about tasks it didn't start.");
  const rep = await connect(base, "reporter", quiet);
  const hook = startWebhookReceiver();
  await expectError("callback aimed at a cloud metadata address", rep.sendMessage("x", { taskPushNotificationConfig: { url: "http://169.254.169.254/latest/meta-data/" } }));
  await expectError("callback aimed at another local service", rep.sendMessage("x", { taskPushNotificationConfig: { url: "http://localhost:4747/vault/rpc" } }));
  hook.expectNewTask();
  const started = await rep.sendMessage(rep.userMessage("tides", { metadata: { stepMs: 30 } }), { returnImmediately: true, taskPushNotificationConfig: { url: hook.url, token: hook.token } });
  hook.track(started.task!.id);
  const forged = await fetch(hook.url, { method: "POST", body: JSON.stringify({ statusUpdate: { taskId: started.task!.id, contextId: "x", status: { state: "TASK_STATE_COMPLETED" } } }) });
  for (let i = 0; i < 60 && !hook.accepted.some((e) => e.statusUpdate?.status.state === "TASK_STATE_COMPLETED"); i++) await new Promise((r) => setTimeout(r, 50));
  ok(`forged notification → ${forged.status}; genuine ones accepted: ${hook.accepted.length}`);
  hook.stop();

  // ------------------------------------------------------------------ 5
  note("5. WHAT COMES BACK. The 'Weather Helper' agent has a harmless-looking card. Here is what it actually replies with:");
  const trick = await connect(base, "trickster", quiet);
  const raw = (await trick.sendMessage("weather in Lisbon")).message!;
  show("text part:", raw.parts[0]!.text!);
  show("data part:", raw.parts[1]!.data);
  note("The concierge agent uses that weather agent, and holds an internal note it must never show. There is no language model in this lab, so a stand-in plays one: it follows any instruction in the text it is given, which is exactly the weakness real models have. First the careless build: the reply is pasted into the model's input.");
  const con = await connect(base, "concierge", quiet);
  const artifact = (task: any, id: string) => task.artifacts.find((a: any) => a.artifactId === id)?.parts[0];
  const naive = (await con.sendMessage(con.userMessage("What's the weather in Lisbon?", { metadata: { naive: true } }))).task!;
  console.log(red(`✘ careless answer: ${artifact(naive, "answer").text}`));
  ok(`leaked the internal note: ${artifact(naive, "answer").text.includes(INTERNAL_NOTE)}`);
  note("Now the careful build. The model only ever sees the user's words. The reply is treated as data: its structured part is checked against the expected shape, and the raw content is kept, labelled as untrusted, for a person to inspect.");
  const careful = (await con.sendMessage("What's the weather in Lisbon?")).task!;
  ok(`careful answer: ${artifact(careful, "answer").text}`);
  show("handling report:", artifact(careful, "report").data);
  show("labels on the quarantined content:", careful.artifacts!.find((a) => a.artifactId === "remote-content")!.parts.map((p) => p.metadata));
  note("Takeaway: A2A carries the message; it can't vouch for what's in it. `injectionSuspected` above is only a hint for your logs. The real defence is structural: text from another agent never reaches the place your agent takes instructions from, and anything costly needs a person's approval.");
} };
if (import.meta.main) await withTestbed(lesson.run);
