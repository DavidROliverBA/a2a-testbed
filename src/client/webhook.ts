/**
 * A callback receiver that verifies what it is sent.
 *
 * Anyone who learns a callback address can POST to it, so a receiver must not act
 * on a notification just because it arrived. This one checks, in order:
 *   1. the token it gave the agent when it registered the callback
 *   2. that the body is JSON in the expected shape
 *   3. that the task is one this client started
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { StreamResponse } from "../protocol.ts";

const digest = (s: string) => createHash("sha256").update(s).digest();
/** Compare secrets without leaking, through timing, how much of a guess was right. */
export const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export interface WebhookReceiver {
  url: string;
  token: string;
  accepted: StreamResponse[];
  rejected: { status: number; reason: string }[];
  /** Call just before starting a task: its id isn't known until the agent replies, and the first callback can arrive sooner. */
  expectNewTask(): void;
  /** Call once the task id is known. */
  track(taskId: string): void;
  stop(): void;
}

export function startWebhookReceiver(): WebhookReceiver {
  const token = crypto.randomUUID(); // a fresh secret per receiver; never reuse one across agents
  const mine = new Set<string>();
  let pending = 0;
  const accepted: StreamResponse[] = [];
  const rejected: { status: number; reason: string }[] = [];
  const refuse = (status: number, reason: string) => { rejected.push({ status, reason }); return new Response(reason, { status }); };

  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method !== "POST") return refuse(405, "POST only");
      if (!safeEqual(req.headers.get("x-a2a-notification-token") ?? "", token)) return refuse(401, "missing or wrong token");
      let ev: StreamResponse;
      try { ev = (await req.json()) as StreamResponse; } catch { return refuse(400, "body is not JSON"); }
      const id = ev?.task?.id ?? ev?.statusUpdate?.taskId ?? ev?.artifactUpdate?.taskId;
      if (typeof id !== "string") return refuse(400, "not a task notification");
      if (!mine.has(id)) {
        if (pending === 0) return refuse(404, "not a task this client started");
        mine.add(id); pending--; // the task we were told to expect
      }
      accepted.push(ev);
      return new Response("ok");
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hook`, token, accepted, rejected,
    expectNewTask: () => { pending++; },
    track: (taskId) => { if (!mine.has(taskId)) { mine.add(taskId); pending = Math.max(0, pending - 1); } },
    stop: () => server.stop(true),
  };
}
