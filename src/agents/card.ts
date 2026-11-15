import type { AgentCard, AgentSkill } from "../protocol.ts";

/** Build an Agent Card advertising both bindings. The first interface is the preferred one. */
export function makeCard(baseUrl: string, id: string, c: {
  name: string; description: string; skills: AgentSkill[];
  streaming?: boolean; pushNotifications?: boolean; extendedAgentCard?: boolean;
  auth?: boolean; stepUpHeader?: string; inputModes?: string[]; outputModes?: string[];
}): AgentCard {
  return {
    name: c.name,
    description: c.description,
    supportedInterfaces: [
      { url: `${baseUrl}/${id}/rpc`, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: `${baseUrl}/${id}/rest`, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
    ],
    provider: { organization: "a2a-testbed", url: "https://a2a-protocol.org" },
    version: "1.0.0",
    capabilities: {
      streaming: c.streaming ?? false,
      pushNotifications: c.pushNotifications ?? false,
      ...(c.extendedAgentCard ? { extendedAgentCard: true } : {}),
    },
    ...(c.auth
      ? {
          securitySchemes: {
            bearerAuth: { httpAuthSecurityScheme: { scheme: "Bearer", description: "Token is printed in the vault agent's description" } },
            // Declared but not required up front: only asked for when a task reaches AUTH_REQUIRED.
            ...(c.stepUpHeader ? { stepUp: { apiKeySecurityScheme: { location: "header", name: c.stepUpHeader, description: "Second credential for sensitive skills" } } } : {}),
          },
          securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
        }
      : {}),
    defaultInputModes: c.inputModes ?? ["text/plain"],
    defaultOutputModes: c.outputModes ?? ["text/plain"],
    skills: c.skills,
  };
}

export const STEP_MS = Number(process.env.A2A_STEP_MS ?? 400);
