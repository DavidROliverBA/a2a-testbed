import { dataPart, sleep, textOf, textPart } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { STEP_MS, makeCard } from "./card.ts";

/**
 * LESSONS 3, 4, 7: a long-running Task agent.
 *   SUBMITTED → WORKING → (artifact chunks, append/lastChunk) → COMPLETED
 * Streams a report in 3 chunks, then a second (structured) artifact. Say "explode"
 * in the topic to see TASK_STATE_FAILED.
 */
export const reporter: AgentDef = {
  id: "reporter",
  card: (base) => makeCard(base, "reporter", {
    name: "Report Writer",
    description: "Researches a topic over several seconds and streams a report as artifact chunks.",
    streaming: true, pushNotifications: true,
    outputModes: ["text/plain", "application/json"],
    skills: [{ id: "report", name: "Write report", description: "Produces a 3-section report", tags: ["demo", "long-running", "streaming"], examples: ["quantum computing", "explode"] }],
  }),
  async execute({ message, bus, signal }) {
    const topic = textOf(message).trim() || "nothing";
    const delay = Number(message.metadata?.stepMs ?? STEP_MS);
    bus.status("TASK_STATE_WORKING", `Researching "${topic}"…`);
    await sleep(delay, signal);
    if (topic.includes("explode")) throw new Error("Simulated failure while researching");

    const sections = ["Background", "Current state", "Outlook"];
    for (const [i, name] of sections.entries()) {
      bus.status("TASK_STATE_WORKING", `Writing section ${i + 1}/3: ${name}`);
      await sleep(delay, signal);
      // First chunk creates the artifact; later chunks have append=true; the last has lastChunk=true.
      bus.artifact(
        { artifactId: "report", name: `Report on ${topic}`, parts: [textPart(`## ${name}\nNotes about ${topic} (${name.toLowerCase()}).\n\n`)] },
        { append: i > 0, lastChunk: i === sections.length - 1 },
      );
    }
    bus.artifact(
      { artifactId: "sources", name: "Sources", parts: [dataPart({ topic, sources: ["https://a2a-protocol.org", "https://example.com/paper"], confidence: 0.42 })] },
      { lastChunk: true },
    );
    bus.status("TASK_STATE_COMPLETED", "Report ready");
  },
};
