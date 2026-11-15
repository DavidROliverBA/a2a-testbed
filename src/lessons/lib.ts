import { startTestbed } from "../testbed.ts";
import { A2AClient, type ClientOptions, type WireEvent } from "../client/client.ts";
import type { Testbed } from "../server/http.ts";

const tty = process.stdout.isTTY;
const c = (n: number, s: string) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
export const dim = (s: string) => c(2, s);
export const bold = (s: string) => c(1, s);
export const cyan = (s: string) => c(36, s);
export const green = (s: string) => c(32, s);
export const yellow = (s: string) => c(33, s);
export const red = (s: string) => c(31, s);

export const title = (n: number, t: string) => console.log(`\n${bold(cyan(`━━ Lesson ${n}: ${t} ━━`))}`);
/** Narration: the "why" behind what's about to happen. */
export const note = (s: string) => console.log(`\n${yellow("▸")} ${s}`);
export const show = (label: string, v: unknown) => console.log(`${green(label)} ${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
export const ok = (s: string) => console.log(green(`✔ ${s}`));

const SHOW_WIRE = process.env.A2A_WIRE !== "0";
function printWire(e: WireEvent) {
  if (!SHOW_WIRE) return;
  const tag = { request: "→ ", response: "← ", event: "  ⇢ " }[e.dir];
  let text = e.text;
  // pretty-print JSON bodies for readability
  text = text.split("\n").map((line) => { try { const j = JSON.parse(line); return JSON.stringify(j, null, 2); } catch { return line; } }).join("\n");
  console.log(dim(text.split("\n").map((l, i) => (i === 0 ? tag + l : "   " + l)).join("\n")));
}

export const BASE = () => `http://127.0.0.1:${process.env.A2A_PORT ?? 4747}`;

/** Use a running `bun run serve` if there is one; otherwise boot the testbed in-process. */
export async function withTestbed(fn: (base: string) => Promise<void>): Promise<void> {
  let tb: Testbed | undefined;
  const base = BASE();
  let running = false;
  try { running = ((await (await fetch(`${base}/`)).json()) as any).testbed === "a2a-testbed"; } catch { /* nothing listening */ }
  if (!running) tb = startTestbed({ port: Number(process.env.A2A_PORT ?? 4747), log: process.env.A2A_LOG === "1" }); // A2A_LOG=1 also prints the server's view of each call
  try { await fn(tb?.baseUrl ?? base); } finally { tb?.stop(); }
}

export const connect = (base: string, agent: string, opts: ClientOptions = {}) =>
  A2AClient.discover(`${base}/${agent}`, { wire: printWire, ...opts });

/** Run something expected to fail and show the A2A error it produced. */
export async function expectError<T>(label: string, p: Promise<T> | AsyncGenerator<unknown>) {
  try {
    if (Symbol.asyncIterator in p) { for await (const _ of p as AsyncGenerator<unknown>) { /* drain */ } }
    else await p;
    console.log(red(`✘ ${label}: expected an error but call succeeded`));
  } catch (e: any) {
    console.log(`${green("✔ expected error")} ${label}: ${bold(e.kind ?? e.name)} (code ${e.code}) — ${e.message}`);
  }
}

export type Lesson = { n: number; name: string; run: (base: string) => Promise<void> };
