import { A2AClient } from "../client/client.ts";
import { dataPart, textOf, message as mkMessage } from "../protocol.ts";
import type { AgentDef } from "../server/runtime.ts";
import { makeCard } from "./card.ts";

/**
 * LESSON 11: agent-to-agent, the actual point of A2A. This agent is a SERVER to you
 * and a CLIENT to other agents:
 *   1. discovers `echo` and `reporter` from their Agent Cards,
 *   2. calls echo with SendMessage (stateless Message back),
 *   3. calls reporter with a *streaming* request, mirroring its artifact chunks,
 *   4. reports a trace of who did what.
 * It propagates its contextId and references its own task via referenceTaskIds, so the
 * whole fan-out is correlatable. From the caller's view it's one opaque agent.
 */
export const orchestrator: AgentDef = {
  id: "orchestrator",
  card: (base) => makeCard(base, "orchestrator", {
    name: "Orchestrator",
    description: "Delegates to the echo and reporter agents over A2A and merges the results.",
    streaming: true,
    outputModes: ["text/plain", "application/json"],
    skills: [{ id: "delegate", name: "Delegate", description: "Fans a topic out to specialist agents", tags: ["demo", "multi-agent"], examples: ["quantum computing"] }],
  }),
  async execute({ message, taskId, contextId, baseUrl, bus, signal }) {
    const topic = textOf(message).trim() || "nothing";
    const trace: Record<string, unknown>[] = [];
    bus.status("TASK_STATE_WORKING", "Discovering downstream agents…");

    const echoC = await A2AClient.discover(`${baseUrl}/echo`);
    const repC = await A2AClient.discover(`${baseUrl}/reporter`);
    trace.push({ discovered: [echoC.card.name, repC.card.name] });

    // -- call 1: stateless request/response
    bus.status("TASK_STATE_WORKING", "Asking echo…");
    const e = await echoC.sendMessage(mkMessage("user", `topic: ${topic}`, { contextId }));
    trace.push({ agent: "echo", kind: e.message ? "message" : "task", reply: e.message?.parts[0]?.text });

    // -- call 2: streaming long-running task; mirror what it sends us
    bus.status("TASK_STATE_WORKING", "Asking reporter (streaming)…");
    let remoteTaskId = "", remoteState = "";
    const meta = { stepMs: 60 };
    for await (const ev of repC.streamMessage(mkMessage("user", topic, { contextId, referenceTaskIds: [taskId], metadata: meta }))) {
      if (signal.aborted) break;
      if (ev.task) remoteTaskId = ev.task.id;
      if (ev.statusUpdate) {
        remoteState = ev.statusUpdate.status.state;
        const t = ev.statusUpdate.status.message && textOf(ev.statusUpdate.status.message);
        if (t) bus.status("TASK_STATE_WORKING", `[reporter] ${t}`);
      }
      if (ev.artifactUpdate) {
        const { artifact, append, lastChunk } = ev.artifactUpdate;
        // Passed on, but labelled: this content came from another agent, not from us.
        bus.artifact({ ...artifact, artifactId: `reporter:${artifact.artifactId}`, metadata: { ...(artifact.metadata ?? {}), untrusted: true, source: repC.card.name } }, { append, lastChunk });
      }
    }
    trace.push({ agent: "reporter", remoteTaskId, finalState: remoteState, sameContext: true });

    bus.artifact({ artifactId: "trace", name: "Delegation trace", parts: [dataPart({ orchestratorTaskId: taskId, contextId, trace })] }, { lastChunk: true });
    bus.status("TASK_STATE_COMPLETED", "All delegates finished");
  },
};
