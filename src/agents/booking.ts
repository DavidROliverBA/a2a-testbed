import { dataPart, textOf } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 5: multi-turn via TASK_STATE_INPUT_REQUIRED.
 * The agent needs a city and dates. Each time it lacks something it parks the task
 * in INPUT_REQUIRED; the client answers with a message carrying the SAME taskId
 * (and contextId). Slots live in the agent's memory, keyed by taskId.
 */
const slots = new Map<string, { city?: string; dates?: string }>();

export const booking: AgentDef = {
  id: "booking",
  card: (base) => makeCard(base, "booking", {
    name: "Booking Agent",
    description: "Books a (fake) trip. Asks follow-up questions until it has a city and dates.",
    streaming: true,
    outputModes: ["application/json"],
    skills: [{ id: "book", name: "Book trip", description: "Collects city + dates over several turns", tags: ["demo", "multi-turn"], examples: ["Book a trip to Paris"] }],
  }),
  async execute({ message, taskId, bus }) {
    const s = slots.get(taskId) ?? {};
    slots.set(taskId, s);
    const text = textOf(message).trim();
    const to = text.match(/\bto ([A-Z][\w-]+)/)?.[1];

    if (!s.city) s.city = to ?? (text && !/^book/i.test(text) ? text : undefined);
    else if (!s.dates) s.dates = text;

    if (!s.city) return bus.status("TASK_STATE_INPUT_REQUIRED", "Which city would you like to visit?");
    if (!s.dates) return bus.status("TASK_STATE_INPUT_REQUIRED", `Great, ${s.city}. What dates? (e.g. 2026-12-01 to 2026-12-05)`);

    bus.status("TASK_STATE_WORKING", "Booking…");
    bus.artifact({ artifactId: "confirmation", name: "Booking confirmation", parts: [dataPart({ ref: `BK-${taskId.slice(0, 6).toUpperCase()}`, ...s })] });
    bus.status("TASK_STATE_COMPLETED", `Booked ${s.city} for ${s.dates}`);
    slots.delete(taskId);
  },
};
