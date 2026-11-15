import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 2, name: "SendMessage → Message (stateless)", async run(base: string) {
  title(2, "SendMessage → a bare Message");
  note("Look at the wire output: SendMessage is a JSON-RPC call whose params hold a Message. A Message has a role (ROLE_USER/ROLE_AGENT), a messageId you generate, and an array of Parts. There is NO 'kind' field in v1.0; a Part is just {text}, {raw}, {url} or {data}.");
  const c = await connect(base, "echo");
  const res = await c.sendMessage(c.userMessage("hello A2A", { metadata: { trace: "lesson-2" } }));
  note("The response is a one-of: either {message} or {task}. Echo answers instantly, so it replies with a Message and no Task is ever created. Messages are for conversation; Tasks are for work with a lifecycle.");
  show("response keys:", Object.keys(res));
  ok(`agent said: ${res.message?.parts[0]?.text}`);
  note("The server stamped a contextId on the reply. contextId groups related messages/tasks into one conversation. Reuse it to continue talking, as below:");
  const again = await c.sendMessage(c.userMessage("second message, same context", { contextId: res.message!.contextId }));
  ok(`same contextId: ${again.message!.contextId === res.message!.contextId}`);
} };
if (import.meta.main) await withTestbed(lesson.run);
