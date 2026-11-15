import { A2AClient } from "../client/client.ts";
import { dataPart, isInterrupted, textOf, message as mkMessage, type Task } from "../protocol.ts";
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
 *
 * LESSON 14: questions travel back up the chain. A request that starts with "book" is
 * handed to the `booking` agent. When booking pauses to ask something, this agent
 * cannot answer for the user, so it pauses ITS OWN task in the same state and passes
 * the question up. The caller's answer comes back here and is sent down to booking's task.
 */

/** Our paused task → the downstream task it is waiting on. */
const relays = new Map<string, { remoteTaskId: string; remoteContextId: string; turns: number }>();
export const orchestrator: AgentDef = {
  id: "orchestrator",
  card: (base) => makeCard(base, "orchestrator", {
    name: "Orchestrator",
    description: "Delegates to the echo and reporter agents over A2A and merges the results. Hands bookings to the booking agent and passes its questions back to the caller.",
    streaming: true,
    outputModes: ["text/plain", "application/json"],
    skills: [{ id: "delegate", name: "Delegate", description: "Fans a topic out to specialist agents", tags: ["demo", "multi-agent"], examples: ["quantum computing"] },
      { id: "relay", name: "Book through a specialist", description: "Hands a booking to the booking agent and relays its questions to the caller", tags: ["demo", "multi-agent", "multi-turn"], examples: ["Book a trip"] }],
  }),
  async execute(ctx) {
    const { message, taskId, contextId, baseUrl, bus, signal } = ctx;
    const topic = textOf(message).trim() || "nothing";
    if (relays.has(taskId) || /^book\b/i.test(topic)) return relayToBooking(ctx);
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

/** Lesson 14: one turn of the relay. Each call sends one message down and mirrors what comes back. */
async function relayToBooking({ message, taskId, contextId, baseUrl, bus }: Parameters<AgentDef["execute"]>[0]) {
  const held = relays.get(taskId);
  bus.status("TASK_STATE_WORKING", held ? "Passing your answer to the booking agent…" : "Handing this to the booking agent…");
  const booking = await A2AClient.discover(`${baseUrl}/booking`);

  // First turn: a new downstream task. Later turns: the SAME downstream task, by its id.
  const down = held
    ? mkMessage("user", textOf(message), { taskId: held.remoteTaskId, contextId: held.remoteContextId })
    : mkMessage("user", textOf(message), { referenceTaskIds: [taskId] });
  const remote: Task | undefined = (await booking.sendMessage(down)).task;
  if (!remote) return bus.status("TASK_STATE_FAILED", "The booking agent answered without a task");
  const turns = (held?.turns ?? 0) + 1;
  const said = remote.status.message ? textOf(remote.status.message) : "";

  if (isInterrupted(remote.status.state)) {
    // The specialist is waiting. We wait too, in the same state, and pass its question up.
    relays.set(taskId, { remoteTaskId: remote.id, remoteContextId: remote.contextId ?? contextId, turns });
    return bus.status(remote.status.state, `[${booking.card.name} asks] ${said}`);
  }

  relays.delete(taskId);
  if (remote.status.state !== "TASK_STATE_COMPLETED") return bus.status("TASK_STATE_FAILED", `The booking agent ended in ${remote.status.state}`);
  for (const a of remote.artifacts ?? [])
    bus.artifact({ ...a, artifactId: `booking:${a.artifactId}`, metadata: { ...(a.metadata ?? {}), untrusted: true, source: booking.card.name } }, { lastChunk: true });
  bus.artifact({ artifactId: "trace", name: "Relay trace", parts: [dataPart({ orchestratorTaskId: taskId, bookingTaskId: remote.id, turns })] }, { lastChunk: true });
  bus.status("TASK_STATE_COMPLETED", said || "Booked");
}
