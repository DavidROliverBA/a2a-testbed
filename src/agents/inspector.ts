import { dataPart, effectiveMediaType, partKind, textOf, type Part } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 9 (+ REJECTED): Parts and Artifacts. Accepts ANY media type and reports what
 * each Part looked like. Returns three artifacts, one per content type:
 *   inspection (data)   a structured JSON report
 *   hello.txt  (raw)    bytes → base64 in JSON
 *   link       (url)    a reference instead of an inline payload
 * Say "forbidden" to see TASK_STATE_REJECTED (agent declines before doing any work).
 */
export const inspector: AgentDef = {
  id: "inspector",
  acceptedInputModes: ["*/*"],
  card: (base) => makeCard(base, "inspector", {
    name: "Part Inspector",
    description: "Send it text, JSON, or files; it describes every Part and returns text/data/raw/url artifacts.",
    inputModes: ["*/*"], outputModes: ["application/json", "text/plain"],
    skills: [{ id: "inspect", name: "Inspect parts", description: "Describes the parts of your message", tags: ["demo", "parts"] }],
  }),
  async execute({ message, bus }) {
    if (textOf(message).toLowerCase().includes("forbidden"))
      return bus.status("TASK_STATE_REJECTED", "I won't process that request.");
    bus.status("TASK_STATE_WORKING");
    const describe = (p: Part) => ({
      kind: partKind(p), mediaType: effectiveMediaType(p), filename: p.filename ?? null,
      size: p.text?.length ?? (p.raw ? atob(p.raw).length : undefined) ?? (p.url ? p.url.length : undefined),
      preview: p.text ?? (p.raw && effectiveMediaType(p).startsWith("text/") ? atob(p.raw) : p.data ?? p.url ?? null),
    });
    bus.artifact({ artifactId: "inspection", name: "Inspection", parts: [dataPart({ parts: message.parts.map(describe) })] });
    bus.artifact({
      artifactId: "hello", name: "hello.txt",
      parts: [{ raw: btoa("Hello from a raw part!\n"), filename: "hello.txt", mediaType: "text/plain" }],
    });
    bus.artifact({
      artifactId: "link", name: "Spec link",
      parts: [{ url: "https://a2a-protocol.org/latest/specification/", mediaType: "text/html", filename: "specification.html" }],
    });
    bus.status("TASK_STATE_COMPLETED", `Inspected ${message.parts.length} part(s)`);
  },
};
