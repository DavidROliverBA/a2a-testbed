import { STEP_UP_HEADER, STEP_UP_VALUE, VAULT_TOKEN } from "../agents/vault.ts";
import { textOf } from "../protocol.ts";
import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 8, name: "Auth, extended card, AUTH_REQUIRED", async run(base: string) {
  title(8, "Sign-in: bearer auth, extended card, AUTH_REQUIRED");
  const anon = await connect(base, "vault");
  show("securitySchemes:", anon.card.securitySchemes);
  show("securityRequirements:", anon.card.securityRequirements);
  show("public skills:", anon.card.skills.map((s) => s.id));
  note("A2A doesn't invent auth; it declares standard schemes (OpenAPI-style) in the card and leaves enforcement to HTTP. The card is public; calls need credentials. Without a token the server answers 401 BEFORE any A2A logic runs:");
  try { await anon.sendMessage("hi"); } catch (e: any) { ok(`unauthenticated → ${e.message.slice(0, 60)}`); }
  const authed = anon.withOptions({ token: VAULT_TOKEN });
  const r = await authed.sendMessage("hi");
  ok(r.message!.parts[0]!.text!);
  note("capabilities.extendedAgentCard=true means GetExtendedAgentCard (authenticated) returns a richer card, e.g. skills you're only allowed to know about once logged in.");
  const ext = await authed.getExtendedAgentCard();
  show("extended skills:", ext.skills.map((s) => s.id));
  note("Different thing: TASK_STATE_AUTH_REQUIRED is an in-task state. The agent needs ANOTHER credential mid-work (e.g. consent for a downstream service). Like INPUT_REQUIRED, the task waits and you continue it.");
  let t = (await authed.sendMessage("unlock")).task!;
  ok(`${t.status.state}: "${textOf(t.status.message)}"`);
  note(`The credential goes in an HTTP header (${STEP_UP_HEADER}), never in the message. The web layer checks it and tells the agent only "verified". Then any follow-up message on the task lets it carry on:`);
  const stepped = authed.withOptions({ extraHeaders: { [STEP_UP_HEADER]: STEP_UP_VALUE } });
  t = (await stepped.sendMessage(stepped.userMessage("continue", { taskId: t.id }))).task!;
  ok(`${t.status.state}; secret = ${JSON.stringify(t.artifacts![0]!.parts[0]!.data)}`);
  note("Lesson 13 goes further: what happens if you type the credential into a message, send a wrong one, or try to read someone else's task.");
} };
if (import.meta.main) await withTestbed(lesson.run);
