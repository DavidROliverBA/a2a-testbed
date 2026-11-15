import { dataPart, textOf } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

export const VAULT_TOKEN = "testbed-token";        // signs in as alice
export const VAULT_TOKEN_BOB = "bob-token";        // signs in as bob (lesson 13: task ownership)
export const STEP_UP_HEADER = "X-Step-Up-Token";
export const STEP_UP_VALUE = "open-sesame";

/**
 * LESSONS 8 and 13: security.
 *  - The card is public, but every other endpoint needs `Authorization: Bearer <token>`.
 *  - The card declares that via securitySchemes + securityRequirements.
 *  - GetExtendedAgentCard (authenticated) reveals an extra skill the public card hides.
 *  - Two tokens map to two identities, so tasks have owners (alice can't see bob's).
 *  - TASK_STATE_AUTH_REQUIRED: say "unlock" and the task pauses for a second credential.
 *    That credential travels in the X-Step-Up-Token HEADER and is checked by the HTTP
 *    layer. This agent only receives `stepUp: true/false`. A credential typed into a
 *    message is refused, because messages are stored in task history.
 */
const pubSkill = { id: "greet", name: "Greet", description: "Greets the authenticated caller", tags: ["auth"], examples: ["hi"] };
const secretSkill = { id: "unlock", name: "Unlock secret", description: "Releases the secret after a second credential", tags: ["auth", "secret"], examples: ["unlock"] };

const looksLikeCredential = (text: string) => /^(token|password|secret|key)\s*[:=]/i.test(text) || text.includes(STEP_UP_VALUE);

export const vault: AgentDef = {
  id: "vault",
  auth: {
    tokens: { [VAULT_TOKEN]: "alice@testbed", [VAULT_TOKEN_BOB]: "bob@testbed" },
    stepUp: { header: STEP_UP_HEADER, value: STEP_UP_VALUE },
  },
  card: (base) => makeCard(base, "vault", {
    name: "Vault Agent",
    description: `Requires a bearer token (testbed tokens: ${VAULT_TOKEN} for alice, ${VAULT_TOKEN_BOB} for bob). Has a richer extended card.`,
    auth: true, stepUpHeader: STEP_UP_HEADER, extendedAgentCard: true, skills: [pubSkill],
  }),
  extendedCard: (base) => makeCard(base, "vault", {
    name: "Vault Agent (extended)",
    description: "Authenticated view of the card, including skills not shown publicly.",
    auth: true, stepUpHeader: STEP_UP_HEADER, extendedAgentCard: true, skills: [pubSkill, secretSkill],
  }),
  // A credential typed into a message is refused below AND kept out of the stored history.
  redact: (m) => (looksLikeCredential(textOf(m).trim()) ? { ...m, parts: [{ text: "[credential removed]" }] } : m),
  async execute({ message, task, bus, principal, stepUp }) {
    const text = textOf(message).trim();
    const waiting = task?.status.state === "TASK_STATE_AUTH_REQUIRED";

    if (looksLikeCredential(text)) {
      const why = `Don't put credentials in a message: messages are kept in the task's history. Send it in the ${STEP_UP_HEADER} header instead.`;
      return waiting ? bus.status("TASK_STATE_AUTH_REQUIRED", why) : bus.reply(why);
    }
    if (waiting || text === "unlock") {
      if (!stepUp) return bus.status("TASK_STATE_AUTH_REQUIRED", `A second credential is needed. Send your next message on this task with the ${STEP_UP_HEADER} header.`);
      bus.status("TASK_STATE_WORKING", "Second credential verified by the gateway");
      bus.artifact({ artifactId: "secret", parts: [dataPart({ secret: "the cake is a lie", releasedTo: principal })] }, { lastChunk: true });
      return bus.status("TASK_STATE_COMPLETED", "Unlocked");
    }
    bus.reply(`Hello ${principal}, you are authenticated.`);
  },
};
