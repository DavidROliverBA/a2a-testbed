import { dataPart, textOf, textPart } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 2: the simplest agent. It answers with a bare Message and never creates a
 * Task, which is legal: "a Task is only needed when work takes time or needs state".
 * It accepts text/plain only (try sending an image to see ContentTypeNotSupportedError).
 */
export const echo: AgentDef = {
  id: "echo",
  card: (base) => makeCard(base, "echo", {
    name: "Echo Agent",
    description: "Replies instantly with a Message (no Task). The hello-world of A2A.",
    skills: [{ id: "echo", name: "Echo", description: "Repeats what you say", tags: ["demo", "stateless"], examples: ["hello"] }],
  }),
  async execute({ message, contextId, bus }) {
    bus.reply([
      textPart(`Echo: ${textOf(message)}`),
      dataPart({ receivedParts: message.parts.length, contextId, metadata: message.metadata ?? null }),
    ]);
  },
};
