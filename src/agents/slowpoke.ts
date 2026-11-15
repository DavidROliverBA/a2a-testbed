import { sleep } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 6: cancellation + resubscription. Works for N ticks and reports each one.
 * `ctx.signal` aborts when a client calls CancelTask, so the work stops for real.
 * Tune it with message metadata: {"ticks": 20, "tickMs": 500}.
 */
export const slowpoke: AgentDef = {
  id: "slowpoke",
  card: (base) => makeCard(base, "slowpoke", {
    name: "Slowpoke",
    description: "A deliberately slow task, built to be canceled, subscribed to, and polled.",
    streaming: true, pushNotifications: true,
    skills: [{ id: "tick", name: "Tick", description: "Counts slowly", tags: ["demo", "cancel"], examples: ["count to 20"] }],
  }),
  async execute({ message, bus, signal }) {
    const ticks = Number(message.metadata?.ticks ?? 20);
    const tickMs = Number(message.metadata?.tickMs ?? 500);
    bus.status("TASK_STATE_WORKING", "Starting");
    for (let i = 1; i <= ticks; i++) {
      await sleep(tickMs, signal); // throws AbortError if canceled
      bus.status("TASK_STATE_WORKING", `tick ${i}/${ticks}`);
    }
    bus.artifact({ artifactId: "result", parts: [{ text: `counted to ${ticks}` }] }, { lastChunk: true });
    bus.status("TASK_STATE_COMPLETED", "Done counting");
  },
};
