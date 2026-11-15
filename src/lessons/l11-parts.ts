import { connect, note, ok, show, title, withTestbed } from "./lib.ts";

export const lesson = { n: 11, name: "Parts & Artifacts", async run(base: string) {
  title(11, "Parts: text, data, raw, url — and Artifacts");
  const c = await connect(base, "inspector", { wire: undefined });
  note("A Part is ONE of: text (string) | data (any JSON) | raw (bytes, base64 in JSON) | url (a pointer). mediaType and filename describe it. An Artifact is a named, ordered bundle of Parts: the *output* of a task, as distinct from chat Messages.");
  const msg = c.userMessage("describe these", {});
  msg.parts.push(
    { data: { order: 42, items: ["a", "b"] }, mediaType: "application/json" },
    { raw: btoa("name,qty\nwidget,3\n"), mediaType: "text/csv", filename: "orders.csv" },
    { url: "https://example.com/photo.jpg", mediaType: "image/jpeg", filename: "photo.jpg" },
  );
  const { task } = await c.sendMessage(msg);
  show("inspection artifact:", task!.artifacts!.find((a) => a.artifactId === "inspection")!.parts[0]!.data);
  const hello = task!.artifacts!.find((a) => a.artifactId === "hello")!.parts[0]!;
  ok(`raw part came back as base64 "${hello.raw}" → decoded: ${JSON.stringify(atob(hello.raw!))} (${hello.mediaType}, ${hello.filename})`);
  const link = task!.artifacts!.find((a) => a.artifactId === "link")!.parts[0]!;
  ok(`url part: ${link.url}`);
  note("Prefer url for big files; raw for small ones. Agents declare what they take/give via defaultInputModes/defaultOutputModes on the card (this one accepts */*; echo accepts only text/plain).");
  note("Other terminal states: an agent can decline up front with TASK_STATE_REJECTED, and crash into TASK_STATE_FAILED.");
  const rej = await c.sendMessage("this is forbidden");
  ok(`${rej.task!.status.state}`);
  const rep = await connect(base, "reporter", { wire: undefined });
  const f = await rep.sendMessage(rep.userMessage("explode now", { metadata: { stepMs: 10 } }));
  ok(`${f.task!.status.state}`);
} };
if (import.meta.main) await withTestbed(lesson.run);
