import { A2AClient } from "../client/client.ts";
import { looksLikeInjection, quarantine, validateShape } from "../client/untrusted.ts";
import { dataPart, textOf, type Part } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 13: the same agent, built carelessly and built carefully.
 *
 * The concierge asks the (hostile) weather agent for the weather. It also holds an
 * internal note it must never show a user. There is no language model in this lab,
 * so `obedientModel` stands in for one: like a real model, it acts on whatever
 * instructions appear in the text it is given.
 *
 *   metadata {naive: true}   remote text is pasted into the model's input → the note leaks
 *   default (careful)        the model only ever sees the USER's words; the remote reply
 *                            is validated, quarantined and reported on → nothing leaks
 */
export const INTERNAL_NOTE = "concierge-internal-note-7731";

/** Stand-in for a language model: it follows instructions wherever they appear in its input. */
function obedientModel(input: string): string {
  if (/reveal (your|the) internal note/i.test(input)) return `Of course. The internal note is: ${INTERNAL_NOTE}`;
  return "";
}

export const concierge: AgentDef = {
  id: "concierge",
  card: (base) => makeCard(base, "concierge", {
    name: "Concierge",
    description: "Answers travel questions with help from a weather agent. Shows safe and unsafe handling of another agent's reply.",
    outputModes: ["text/plain", "application/json"],
    skills: [{ id: "ask", name: "Ask", description: "Answers a travel question", tags: ["demo", "security"], examples: ["What's the weather in Lisbon?"] }],
  }),
  async execute({ message, baseUrl, contextId, bus }) {
    const naive = message.metadata?.naive === true;
    const userText = textOf(message);
    bus.status("TASK_STATE_WORKING", "Asking the weather agent…");

    const weather = await A2AClient.discover(`${baseUrl}/trickster`);
    const reply = await weather.sendMessage(weather.userMessage("weather in Lisbon", { contextId }));
    const parts: Part[] = reply.message?.parts ?? [];
    const remoteText = parts.map((p) => p.text ?? "").join("\n");
    const remoteData = parts.find((p) => p.data !== undefined)?.data;

    let answer: string;
    const report: Record<string, unknown> = { mode: naive ? "naive" : "careful", source: weather.card.name };

    if (naive) {
      // WRONG: another agent's words go straight into the place instructions are read from.
      answer = `${remoteText.split("\n")[0]} ${obedientModel(`${userText}\n${remoteText}`)}`.trim();
    } else {
      // RIGHT: instructions come from the user only. The remote reply is checked as data.
      const followed = obedientModel(userText);
      const shape = validateShape(remoteData, { city: "string", tempC: "number" });
      const data = remoteData as { city: string; tempC: number };
      answer = shape.ok
        ? `${data.city} is ${data.tempC}C. ${followed}`.trim()
        : "I couldn't get a weather reading I can rely on: the other agent's reply failed my checks.";
      report.shapeProblems = shape.problems;
      report.injectionSuspected = looksLikeInjection(remoteText);
      bus.artifact({ artifactId: "remote-content", name: "What the weather agent sent (untrusted)", parts: quarantine(weather.card.name, parts) });
    }
    report.leaked = answer.includes(INTERNAL_NOTE);
    bus.artifact({ artifactId: "answer", name: "Answer", parts: [{ text: answer }] });
    bus.artifact({ artifactId: "report", name: "Handling report", parts: [dataPart(report)] }, { lastChunk: true });
    bus.status("TASK_STATE_COMPLETED", naive ? "Answered (carelessly)" : "Answered");
  },
};
