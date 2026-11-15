/**
 * Builds the animated diagrams used in the README (docs/images/*.gif).
 * Needs two command-line tools: rsvg-convert (librsvg) and ffmpeg.
 * Each diagram is a function (time in seconds) → SVG. Frames are rendered with
 * rsvg-convert and joined into a GIF with ffmpeg.   Run: bun docs/diagrams/gifs.ts [name]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "images"); // docs/images
const TMP = join(import.meta.dir, "frames");
const FPS = 10;

const C = {
  bg: "#f6f8fa", panel: "#ffffff", panel2: "#e6edf2", line: "#b4c2cf", fg: "#13202c", muted: "#4f5d6b",
  accent: "#0a7c86", accentSoft: "#d5eef0", pulse: "#c77700", pulseSoft: "#fbebcf", good: "#1b8a4b", bad: "#c23b2e",
};
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, monospace";

// ------------------------------------------------------------ helpers
type Pt = [number, number];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface TextOpts { size?: number; font?: string; fill?: string; anchor?: "start" | "middle" | "end"; weight?: number | string; opacity?: number }
const text = (x: number, y: number, s: string, o: TextOpts = {}) =>
  `<text xml:space="preserve" x="${x}" y="${y}" font-family="${o.font ?? SANS}" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.fg}" text-anchor="${o.anchor ?? "start"}" opacity="${o.opacity ?? 1}">${esc(s)}</text>`;

interface BoxOpts { fill?: string; stroke?: string; sw?: number; dash?: string; rx?: number; opacity?: number }
const box = (x: number, y: number, w: number, h: number, o: BoxOpts = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 10}" fill="${o.fill ?? C.panel}" stroke="${o.stroke ?? C.line}" stroke-width="${o.sw ?? 1.5}" ${o.dash ? `stroke-dasharray="${o.dash}"` : ""} opacity="${o.opacity ?? 1}"/>`;

const dot = (p: Pt, r: number, fill: string) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${fill}"/>`;

interface Path { d: string; at(p: number): Pt }
const seg = (x1: number, y1: number, x2: number, y2: number): Path => ({
  d: `M${x1} ${y1} L${x2} ${y2}`,
  at: (p) => [x1 + (x2 - x1) * p, y1 + (y2 - y1) * p],
});
const bez = (a: Pt, c1: Pt, c2: Pt, b: Pt): Path => ({
  d: `M${a[0]} ${a[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${b[0]} ${b[1]}`,
  at: (p) => {
    const q = 1 - p;
    return [0, 1].map((i) => q * q * q * a[i]! + 3 * q * q * p * c1[i]! + 3 * q * p * p * c2[i]! + p * p * p * b[i]!) as Pt;
  },
});
const wire = (p: Path, color = C.line, sw = 1.8) =>
  `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${sw}" marker-end="url(#arrow)"/>`;

/** A dot travelling along a path during [start, start+dur). */
const packet = (t: number, p: Path, start: number, dur: number, fill: string, r = 7) =>
  t >= start && t < start + dur ? dot(p.at(ease(prog(t, start, dur))), r, fill) : "";

const node = (x: number, y: number, w: number, h: number, title: string, sub: string, active = false) =>
  box(x, y, w, h, { stroke: active ? C.accent : C.line, sw: active ? 3 : 1.5 }) +
  text(x + w / 2, y + h / 2 - (sub ? 4 : -6), title, { size: 19, weight: 700, anchor: "middle" }) +
  (sub ? text(x + w / 2, y + h / 2 + 18, sub, { size: 13.5, font: MONO, fill: C.muted, anchor: "middle" }) : "");

const caption = (w: number, y: number, step: string, lines: string[]) =>
  text(40, y, step, { size: 14, font: MONO, fill: C.pulse, weight: 700 }) +
  lines.map((l, i) => text(40, y + 28 + i * 25, l, { size: 19 })).join("");

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><polygon points="0,0 10,5 0,10" fill="${C.muted}"/></marker></defs>
<rect width="${w}" height="${h}" fill="${C.bg}"/>${body}</svg>`;

interface Diagram { name: string; w: number; h: number; seconds: number; frame(t: number): string }

// ------------------------------------------------------------ 1. call graph
const callGraph: Diagram = {
  name: "a2a-01-call-graph", w: 1000, h: 470, seconds: 10.5,
  frame(t) {
    const P = {
      co: seg(190, 208, 300, 208), oc: seg(300, 234, 190, 234),
      oe: bez([500, 196], [610, 196], [610, 88], [720, 88]), eo: bez([720, 110], [640, 110], [640, 214], [500, 214]),
      or: seg(500, 238, 720, 238), ro: seg(720, 262, 500, 262),
    };
    const step = t < 0.6 ? 0 : t < 1.9 ? 1 : t < 4.1 ? 2 : t < 7.6 ? 3 : 4;
    const state = t < 1.5 ? "no task yet" : t < 1.8 ? "task: SUBMITTED" : t < 7.6 ? "task: WORKING" : "task: COMPLETED";
    const act = { client: step === 1 || step === 4, orch: step >= 1, echo: step === 2, rep: step === 3 };
    const caps: [string, string[]][] = [
      ["ONE REQUEST, THREE AGENTS", ["Your app is about to ask the orchestrator agent for a report."]],
      ["STEP 1 OF 4", ["Your app sends one message. The orchestrator is the only agent it knows."]],
      ["STEP 2 OF 4", ["The orchestrator asks the echo agent, which answers at once with a message."]],
      ["STEP 3 OF 4", ["It asks the reporter agent too. That work takes time, so reporter starts", "a task and streams the report back in pieces, which are passed on to you."]],
      ["STEP 4 OF 4", ["Done. Every hop used the same protocol, and to your app it looked like", "one agent."]],
    ];
    let chunks = "";
    for (let i = 0; i < 4; i++) {
      const s = 5.0 + i * 0.45;
      chunks += packet(t, P.ro, s, 0.7, C.accent, 5.5) + packet(t, P.oc, s + 0.75, 0.6, C.accent, 5.5);
    }
    return svg(this.w, this.h,
      box(275, 20, 705, 310, { fill: "none", dash: "6 6", rx: 14 }) +
      text(295, 46, "A2A agents: each one is a separate service", { size: 13.5, font: MONO, fill: C.muted }) +
      Object.values(P).map((p) => wire(p)).join("") +
      text(245, 194, "SendMessage", { size: 13, font: MONO, fill: C.muted, anchor: "middle" }) +
      text(596, 142, "SendMessage", { size: 13, font: MONO, fill: C.muted, anchor: "end" }) +
      text(610, 290, "SendStreamingMessage", { size: 13, font: MONO, fill: C.muted, anchor: "middle" }) +
      node(20, 180, 170, 80, "Your app", "A2A client", act.client) +
      node(300, 170, 200, 104, "orchestrator", "server and client", act.orch) +
      node(720, 54, 230, 78, "echo", "replies with a message", act.echo) +
      node(720, 206, 230, 84, "reporter", "runs a task, streams it", act.rep) +
      text(400, 304, state, { size: 14, font: MONO, fill: state.endsWith("COMPLETED") ? C.good : C.pulse, anchor: "middle", weight: 700 }) +
      packet(t, P.co, 0.7, 0.9, C.pulse) +
      packet(t, P.oe, 2.0, 0.9, C.pulse) + packet(t, P.eo, 3.0, 0.9, C.accent) +
      packet(t, P.or, 4.2, 0.7, C.pulse) + chunks +
      caption(this.w, 372, caps[step]![0], caps[step]![1]));
  },
};

// ------------------------------------------------------------ 2. discovery
const discovery: Diagram = {
  name: "a2a-02-discovery", w: 1000, h: 500, seconds: 10,
  frame(t) {
    const req = seg(250, 88, 750, 88), res = seg(750, 114, 250, 114);
    const lines: [string, string][] = [
      ["name", "Report Writer"],
      ["skills", "report: writes a short report on a topic"],
      ["capabilities", "streaming: yes   pushNotifications: yes"],
      ["interfaces", "JSONRPC   HTTP+JSON"],
      ["security", "none declared (a real agent lists its schemes)"],
    ];
    const cardAt = 2.3, pickAt = 6.0, sendAt = 7.0;
    const step = t < 0.5 ? 0 : t < cardAt ? 1 : t < pickAt ? 2 : t < sendAt ? 3 : 4;
    const caps: [string, string[]][] = [
      ["DISCOVERY", ["Before two agents talk, the caller reads the other agent's card."]],
      ["STEP 1 OF 4", ["The client fetches the Agent Card from a fixed, well-known address."]],
      ["STEP 2 OF 4", ["The card says who the agent is, what it can do and how to reach it."]],
      ["STEP 3 OF 4", ["The client picks an interface it can speak. Here, JSON-RPC."]],
      ["STEP 4 OF 4", ["Only now does it send the first message, to the address the card gave."]],
    ];
    let card = "";
    if (t >= cardAt) {
      card += box(180, 160, 640, 212, { stroke: C.accent, sw: 2 }) + text(204, 192, "Agent Card", { size: 18, weight: 700 }) +
        text(796, 192, "/.well-known/agent-card.json", { size: 12.5, font: MONO, fill: C.muted, anchor: "end" });
      lines.forEach(([k, v], i) => {
        if (t < cardAt + 0.3 + i * 0.55) return;
        const y = 226 + i * 29;
        if (k === "interfaces" && t >= pickAt) card += box(346, y - 18, 78, 25, { fill: C.accentSoft, stroke: C.accent, sw: 1.5, rx: 5 });
        card += text(204, y, k, { size: 14, font: MONO, fill: C.accent, weight: 700 }) + text(352, y, v, { size: 14, font: MONO });
      });
    }
    return svg(this.w, this.h,
      wire(req) + wire(res) +
      text(500, 74, t < sendAt ? "GET /.well-known/agent-card.json" : "POST /rpc   SendMessage", { size: 13.5, font: MONO, fill: C.muted, anchor: "middle" }) +
      node(40, 60, 210, 84, "Client agent", "wants a report", step === 1 || step >= 3) +
      node(750, 60, 210, 84, "Remote agent", "someone else's", step === 4) +
      packet(t, req, 0.6, 0.8, C.pulse) + packet(t, res, 1.5, 0.8, C.accent) +
      packet(t, req, sendAt + 0.2, 0.9, C.pulse) + packet(t, res, sendAt + 1.3, 0.9, C.accent) +
      card + caption(this.w, 414, caps[step]![0], caps[step]![1]));
  },
};

// ------------------------------------------------------------ 3. task states
const HW = 108, HH = 25;
const N: Record<string, { x: number; y: number; t: string; k: "" | "int" | "good" | "bad" | "mute" }> = {
  S: { x: 150, y: 184, t: "SUBMITTED", k: "" }, W: { x: 480, y: 184, t: "WORKING", k: "" },
  I: { x: 480, y: 74, t: "INPUT_REQUIRED", k: "int" }, A: { x: 480, y: 294, t: "AUTH_REQUIRED", k: "int" },
  C: { x: 850, y: 74, t: "COMPLETED", k: "good" }, F: { x: 850, y: 184, t: "FAILED", k: "bad" },
  X: { x: 850, y: 294, t: "CANCELED", k: "mute" }, R: { x: 150, y: 314, t: "REJECTED", k: "bad" },
};
const EDGES = ["SW", "SI", "SA", "SR", "WI", "IW", "WA", "AW", "WC", "WF", "WX"];
const SCEN: { name: string; seq: string; lines: string[] }[] = [
  { name: "Plain work", seq: "SWC", lines: ["The agent accepts the job, works on it and finishes."] },
  { name: "The agent needs to ask you something", seq: "SIIWC", lines: ["The task pauses twice for an answer. Each reply goes to the same task,", "which then carries on and finishes."] },
  { name: "The agent needs a credential", seq: "SAAWC", lines: ["Part-way through, the agent needs permission for something. The first", "credential is wrong, the second works, and the task finishes."] },
  { name: "You cancel it", seq: "SWX", lines: ["The client cancels a slow task. The agent stops working."] },
  { name: "It fails", seq: "SWF", lines: ["Something breaks while the agent is working."] },
  { name: "The agent says no", seq: "SR", lines: ["The agent declines the request before doing any work."] },
];
function edge(a: string, b: string): Path {
  const A = N[a]!, B = N[b]!, dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const s = Math.min(HW / Math.abs(dx || 1e-9), HH / Math.abs(dy || 1e-9));
  const off = EDGES.includes(b + a) ? 10 : 0, px = -uy * off, py = ux * off, gap = 5;
  return seg(A.x + dx * s + ux * gap + px, A.y + dy * s + uy * gap + py, B.x - dx * s - ux * gap + px, B.y - dy * s - uy * gap + py);
}
const HOLD = 0.7, MOVE = 0.6, END = 1.9;
const scenLen = (s: string) => s.length * HOLD + (s.length - 1) * MOVE + END;
const states: Diagram = {
  name: "a2a-03-task-states", w: 1000, h: 484, seconds: SCEN.reduce((n, s) => n + scenLen(s.seq), 0),
  frame(t) {
    let i = 0;
    while (t >= scenLen(SCEN[i]!.seq) && i < SCEN.length - 1) { t -= scenLen(SCEN[i]!.seq); i++; }
    const sc = SCEN[i]!, s = sc.seq;
    const k = Math.min(s.length - 1, Math.floor(t / (HOLD + MOVE)));
    const within = t - k * (HOLD + MOVE);
    const moving = k < s.length - 1 && within > HOLD;
    const mp = moving ? ease((within - HOLD) / MOVE) : 0;
    const visited = new Set(s.slice(0, k + 1).split(""));
    const used = new Set<string>();
    for (let j = 1; j <= k; j++) used.add(s[j - 1]! + s[j]!);
    const cur = s[k]!, nxt = s[k + 1];
    let token: Pt = [N[cur]!.x, N[cur]!.y - HH - 12], r = 8;
    if (moving && nxt && nxt !== cur) token = edge(cur, nxt).at(mp);
    if (moving && nxt === cur) r = 8 + 7 * Math.sin(mp * Math.PI);
    const done = k === s.length - 1;

    let body = "";
    for (const e of EDGES) body += wire(edge(e[0]!, e[1]!), used.has(e) ? C.accent : C.line, used.has(e) ? 2.6 : 1.6);
    for (const [key, n] of Object.entries(N)) {
      const isCur = key === cur && !moving;
      const tone = n.k === "good" ? C.good : n.k === "bad" ? C.bad : C.accent;
      body += box(n.x - HW, n.y - HH, HW * 2, HH * 2, {
        fill: isCur ? (n.k === "good" ? "#dcf3e5" : n.k === "bad" ? "#fbe3e0" : C.accentSoft) : visited.has(key) ? C.panel2 : C.panel,
        stroke: isCur ? tone : C.line, sw: isCur ? 3.2 : n.k && n.k !== "int" ? 2.8 : 1.6, dash: n.k === "int" ? "6 4" : undefined,
      }) + text(n.x, n.y + 5.5, n.t, { size: 15.5, font: MONO, anchor: "middle", fill: visited.has(key) ? C.fg : C.muted, weight: isCur ? 700 : 400 });
    }
    body += dot(token, r, C.pulse);
    body += text(960, 376, "dashed: waiting for the client     heavy border: final", { size: 12.5, font: MONO, fill: C.muted, anchor: "end" });
    body += caption(this.w, 408, `SCENARIO ${i + 1} OF ${SCEN.length}: ${sc.name.toUpperCase()}`, done || sc.lines.length === 1 ? sc.lines : sc.lines);
    return svg(this.w, this.h, body);
  },
};

// ------------------------------------------------------------ 4. streaming
const EVENTS: { kind: string; detail: string; state: string; chunk?: number }[] = [
  { kind: "task", detail: "SUBMITTED", state: "SUBMITTED" },
  { kind: "statusUpdate", detail: "WORKING   Researching the topic", state: "WORKING" },
  { kind: "statusUpdate", detail: "WORKING   Writing section 1 of 3", state: "WORKING" },
  { kind: "artifactUpdate", detail: "report    first piece", state: "WORKING", chunk: 0 },
  { kind: "statusUpdate", detail: "WORKING   Writing section 2 of 3", state: "WORKING" },
  { kind: "artifactUpdate", detail: "report    append", state: "WORKING", chunk: 1 },
  { kind: "statusUpdate", detail: "WORKING   Writing section 3 of 3", state: "WORKING" },
  { kind: "artifactUpdate", detail: "report    append, last piece", state: "WORKING", chunk: 2 },
  { kind: "artifactUpdate", detail: "sources   complete", state: "WORKING", chunk: 3 },
  { kind: "statusUpdate", detail: "COMPLETED Report ready", state: "COMPLETED" },
];
const CHUNKS: [string, string][] = [
  ["report, piece 1", "Background"], ["report, piece 2", "Current state"], ["report, piece 3", "Outlook"], ["sources (structured data)", "2 sources, confidence 0.42"],
];
const streaming: Diagram = {
  name: "a2a-04-streaming", w: 1000, h: 500, seconds: 10.5,
  frame(t) {
    const shown = Math.min(EVENTS.length, Math.max(0, Math.floor((t - 0.6) / 0.7) + 1));
    const state = shown ? EVENTS[shown - 1]!.state : "waiting";
    let body = box(20, 20, 580, 388) + text(42, 52, "Events arriving from the agent", { size: 17, weight: 700 }) +
      box(620, 20, 360, 388) + text(642, 52, "What the client has so far", { size: 17, weight: 700 });
    EVENTS.slice(0, shown).forEach((e, i) => {
      const y = 86 + i * 31, fresh = i === shown - 1 && t < 0.6 + shown * 0.7;
      if (fresh) body += box(32, y - 20, 556, 28, { fill: e.kind === "artifactUpdate" ? C.pulseSoft : C.accentSoft, stroke: "none", rx: 5 });
      body += text(42, y, e.kind, { size: 14, font: MONO, weight: 700, fill: e.kind === "artifactUpdate" ? C.pulse : C.accent }) +
        text(182, y, e.detail, { size: 14, font: MONO });
    });
    const have = EVENTS.slice(0, shown).filter((e) => e.chunk !== undefined).length;
    CHUNKS.slice(0, have).forEach(([label, body2], i) => {
      const y = 76 + i * 66;
      body += box(642, y, 316, 54, { rx: 6, stroke: i === 3 ? C.pulse : C.accent, sw: 1.8 }) +
        text(656, y + 21, label, { size: 12.5, font: MONO, fill: C.muted }) + text(656, y + 43, body2, { size: 16, weight: 700 });
    });
    const tone = state === "COMPLETED" ? C.good : C.pulse;
    body += box(642, 356, 316, 36, { rx: 18, fill: state === "COMPLETED" ? "#dcf3e5" : C.pulseSoft, stroke: tone, sw: 1.5 }) +
      text(800, 380, `task state: ${state}`, { size: 14, font: MONO, anchor: "middle", fill: tone, weight: 700 });
    const cap: [string, string[]] = shown === 0 ? ["STREAMING", ["The client asks for a report and keeps the connection open."]]
      : state === "COMPLETED" ? ["STREAMING", ["The last event is the final state. The client now holds the whole report."]]
      : ["STREAMING", ["Progress and pieces of the result arrive as they are produced."]];
    return svg(this.w, this.h, body + caption(this.w, 440, cap[0], cap[1]));
  },
};

// ------------------------------------------------------------ 5. A2A and MCP
const a2aMcp: Diagram = {
  name: "a2a-05-a2a-and-mcp", w: 1000, h: 500, seconds: 10,
  frame(t) {
    const toolsA: [number, string][] = [[150, "calendar"], [275, "email"], [400, "files"]];
    const toolsB: [number, string][] = [[600, "bookings"], [725, "payments"], [850, "seat map"]];
    const ab = seg(395, 118, 605, 118), ba = seg(605, 144, 395, 144);
    const down = (ax: number, tx: number) => seg(ax, 172, tx, 286), up = (ax: number, tx: number) => seg(tx, 286, ax, 172);
    const step = t < 0.4 ? 0 : t < 2.6 ? 1 : t < 4.0 ? 2 : t < 6.4 ? 3 : 4;
    const caps: [string, string[]][] = [
      ["TWO PROTOCOLS, TWO JOBS", ["A2A and MCP are often mentioned together. They do different things."]],
      ["MCP", ["MCP connects an agent to its own tools and data: things it uses."]],
      ["A2A", ["A2A connects an agent to another agent: a peer it asks for help, without", "seeing how that agent works inside."]],
      ["MCP AGAIN, ON THE OTHER SIDE", ["The airline's agent uses its own tools, privately."]],
      ["A2A", ["The answer comes back over A2A. Neither side exposed its tools to the other."]],
    ];
    const toolBox = ([x, label]: [number, string]) => box(x - 55, 286, 110, 46, { rx: 7 }) + text(x, 315, label, { size: 14, font: MONO, anchor: "middle" });
    let body =
      box(70, 30, 410, 330, { fill: "none", dash: "6 6", rx: 14 }) + text(90, 56, "Your company", { size: 13.5, font: MONO, fill: C.muted }) +
      box(520, 30, 410, 330, { fill: "none", dash: "6 6", rx: 14 }) + text(540, 56, "An airline", { size: 13.5, font: MONO, fill: C.muted });
    for (const [x] of toolsA) body += `<path d="${down(275, x).d}" fill="none" stroke="${C.line}" stroke-width="1.8"/>`;
    for (const [x] of toolsB) body += `<path d="${down(725, x).d}" fill="none" stroke="${C.line}" stroke-width="1.8"/>`;
    body += wire(ab, step === 2 ? C.accent : C.line, step === 2 ? 2.6 : 1.8) + wire(ba, step === 4 ? C.accent : C.line, step === 4 ? 2.6 : 1.8);
    body += box(466, 82, 68, 30, { fill: C.bg, stroke: "none", rx: 0 }) + text(500, 104, "A2A", { size: 20, weight: 700, fill: C.accent, anchor: "middle" });
    body += text(352, 236, "MCP", { size: 18, weight: 700, fill: C.pulse }) + text(802, 236, "MCP", { size: 18, weight: 700, fill: C.pulse });
    body += node(155, 90, 240, 82, "Travel planner", "your agent", step === 1 || step === 2 || step === 4) +
      node(605, 90, 240, 82, "Airline agent", "their agent", step === 2 || step === 3 || step === 4);
    body += toolsA.map(toolBox).join("") + toolsB.map(toolBox).join("");
    body += packet(t, down(275, 150), 0.5, 0.8, C.pulse, 6.5) + packet(t, up(275, 150), 1.4, 0.8, C.pulse, 6.5);
    body += packet(t, ab, 2.8, 1.0, C.accent);
    body += packet(t, down(725, 600), 4.1, 0.8, C.pulse, 6.5) + packet(t, up(725, 600), 5.0, 0.8, C.pulse, 6.5) +
      packet(t, down(725, 850), 4.4, 0.8, C.pulse, 6.5) + packet(t, up(725, 850), 5.3, 0.8, C.pulse, 6.5);
    body += packet(t, ba, 6.5, 1.0, C.accent);
    return svg(this.w, this.h, body + caption(this.w, 404, caps[step]![0], caps[step]![1]));
  },
};

// ------------------------------------------------------------ 6. security checks
const LANES: { y: number; dir: 1 | -1; label: string; gate: string; done: string; step: string; cap: string[] }[] = [
  { y: 96, dir: -1, label: "Agent Card", gate: "is this card genuine?", done: "card verified", step: "CHECK 1 OF 4: WHO YOU ARE CALLING",
    cap: ["Check the agent before you trust it: HTTPS, and a signed card where one", "is offered."] },
  { y: 166, dir: 1, label: "message + credentials", gate: "who is calling?", done: "caller verified", step: "CHECK 2 OF 4: WHO IS CALLING",
    cap: ["The remote side checks who is calling before the request reaches its agent."] },
  { y: 236, dir: -1, label: "result", gate: "treat as untrusted", done: "handled as data", step: "CHECK 3 OF 4: WHAT COMES BACK",
    cap: ["What comes back is data, never instructions. Check it before acting on it."] },
  { y: 306, dir: -1, label: "callback, hours later", gate: "is this callback genuine?", done: "callback verified", step: "CHECK 4 OF 4: CALLBACKS",
    cap: ["A callback can come from anyone who knows the address. Verify each one."] },
];
const security: Diagram = {
  name: "a2a-06-security-checks", w: 1000, h: 470, seconds: 11.5,
  frame(t) {
    const LANE = 2.4, GW = 236, GH = 34;
    const cur = Math.min(LANES.length - 1, Math.floor(Math.max(0, t - 0.4) / LANE));
    const allDone = t >= 0.4 + LANES.length * LANE;
    let body = "";
    LANES.forEach((l, i) => {
      const from = l.dir === 1 ? 250 : 750, to = l.dir === 1 ? 750 : 250;
      const gx = l.dir === 1 ? 618 : 382;                       // gate centre, near the receiving side
      const nearEdge = gx - l.dir * (GW / 2 + 9), farEdge = gx + l.dir * (GW / 2 + 9);
      const lt = t - 0.4 - i * LANE;                            // time within this lane
      const passed = lt >= 1.7, checking = lt >= 0.9 && lt < 1.7;
      body += wire(seg(from, l.y, to, l.y), lt >= 0 && lt < LANE ? C.accent : C.line, lt >= 0 && lt < LANE ? 2.4 : 1.8);
      body += text(l.dir === 1 ? 270 : 730, l.y - 12, l.label, { size: 13.5, font: MONO, fill: C.muted, anchor: l.dir === 1 ? "start" : "end" });
      body += box(gx - GW / 2, l.y - GH / 2, GW, GH, {
        rx: 17, fill: passed ? "#dcf3e5" : checking ? C.pulseSoft : C.panel, stroke: passed ? C.good : checking ? C.pulse : C.line, sw: passed || checking ? 2.4 : 1.6,
      }) + text(gx, l.y + 5, passed ? l.done : l.gate, { size: 13.5, font: MONO, anchor: "middle", weight: passed || checking ? 700 : 400, fill: passed ? C.good : checking ? C.pulse : C.muted });
      if (lt >= 0 && lt < 0.9) body += dot(seg(from, l.y, nearEdge, l.y).at(ease(lt / 0.9)), 7, C.pulse);
      else if (checking) body += dot([nearEdge, l.y], 7 + 2.5 * Math.sin(((lt - 0.9) / 0.8) * Math.PI * 2), C.pulse);
      else if (lt >= 1.7 && lt < 2.1) body += dot(seg(farEdge, l.y, to - l.dir * 12, l.y).at(ease((lt - 1.7) / 0.4)), 7, C.good);
    });
    body += node(40, 50, 210, 302, "Your agent", "the client", !allDone && LANES[cur]!.dir === -1 && t > 0.4) +
      node(750, 50, 210, 302, "Remote agent", "someone else's", !allDone && LANES[cur]!.dir === 1 && t > 0.4);
    const cap: [string, string[]] = t < 0.4 ? ["FOUR PLACES TO CHECK", ["Every arrow between two agents crosses a trust boundary."]]
      : allDone ? ["FOUR PLACES TO CHECK", ["Each check sits on the receiving side, before anything is acted on."]]
      : [LANES[cur]!.step, LANES[cur]!.cap];
    return svg(this.w, this.h, body + caption(this.w, 386, cap[0], cap[1]));
  },
};

// ------------------------------------------------------------ 7. inside the testbed
const LAYERS = [
  { x: 230, w: 200, title: "HTTP layer", sub: "src/server/http.ts", pills: ["sign-in check", "version check", "JSON-RPC | HTTP+JSON"], at: [1.3, 1.8, 2.3] },
  { x: 470, w: 220, title: "Task runtime", sub: "src/server/runtime.ts", pills: ["task owner check", "state machine", "history + results", "streams + callbacks"], at: [3.5, 4.0, 4.5, 6.4] },
];
const AGENT_NAMES = ["echo", "reporter", "booking", "slowpoke", "vault", "inspector", "orchestrator", "trickster", "concierge"];
const inside: Diagram = {
  name: "a2a-07-inside-the-testbed", w: 1000, h: 500, seconds: 11,
  frame(t) {
    const f = [seg(170, 190, 230, 190), seg(430, 190, 470, 190), seg(690, 190, 730, 190)];
    const r = [seg(730, 230, 690, 230), seg(470, 230, 430, 230), seg(230, 230, 170, 230)];
    const step = t < 0.5 ? 0 : t < 2.9 ? 1 : t < 5.0 ? 2 : t < 6.4 ? 3 : 4;
    const caps: [string, string[]][] = [
      ["INSIDE THE TESTBED", ["Every request passes through the same three layers."]],
      ["LAYER 1: HTTP", ["Sign-in and protocol version are checked first. Then the request is", "unwrapped from JSON-RPC or HTTP+JSON into the same call."]],
      ["LAYER 2: TASK RUNTIME", ["The runtime checks that the task belongs to the caller, then drives the", "state machine and keeps the history and results."]],
      ["LAYER 3: THE AGENT", ["An agent is one execute() function. It reports status and results, and", "the runtime does everything else."]],
      ["AND BACK", ["Events return as a stream on the open connection, or as calls to a", "callback address."]],
    ];
    const column = (x: number, w: number, title: string, sub: string, active: boolean) =>
      box(x, 60, w, 300, { stroke: active ? C.accent : C.line, sw: active ? 3 : 1.5 }) +
      text(x + w / 2, 92, title, { size: 19, weight: 700, anchor: "middle" }) + text(x + w / 2, 113, sub, { size: 12.5, font: MONO, fill: C.muted, anchor: "middle" });
    const pill = (x: number, y: number, w: number, h: number, label: string, at: number, size = 13.5) => {
      const lit = t >= at, fresh = lit && t < at + 0.5;
      return box(x, y, w, h, { rx: h / 2, fill: fresh ? C.pulseSoft : lit ? "#dcf3e5" : C.bg, stroke: fresh ? C.pulse : lit ? C.good : C.line, sw: lit ? 2.2 : 1.4 }) +
        text(x + w / 2, y + h / 2 + 4.5, label, { size, font: MONO, anchor: "middle", weight: lit ? 700 : 400, fill: fresh ? C.pulse : lit ? C.good : C.muted });
    };
    let body = box(205, 20, 775, 360, { fill: "none", dash: "6 6", rx: 14 }) +
      text(225, 46, "testbed server: one process, one port", { size: 13.5, font: MONO, fill: C.muted });
    body += [...f, ...r].map((p) => wire(p)).join("");
    body += node(20, 160, 150, 100, "Client", "src/client", step === 0 || step === 4);
    LAYERS.forEach((L, i) => {
      body += column(L.x, L.w, L.title, L.sub, step === i + 1 || (i === 1 && step === 4));
      L.pills.forEach((p, j) => { body += pill(L.x + 14, 138 + j * 46, L.w - 28, 34, p, L.at[j]!, p.length > 18 ? 12 : 13.5); });
    });
    body += column(730, 230, "Agents", "src/agents/*.ts", step === 3);
    AGENT_NAMES.forEach((a, i) => {
      const x = 744 + (i % 2) * 104, y = 138 + Math.floor(i / 2) * 42;
      body += pill(x, y, 98, 30, a, a === "reporter" ? 5.6 : Infinity, 12);
    });
    body += packet(t, f[0]!, 0.6, 0.6, C.pulse) + packet(t, f[1]!, 2.9, 0.5, C.pulse) + packet(t, f[2]!, 5.0, 0.5, C.pulse);
    for (let i = 0; i < 4; i++) {
      const s = 6.6 + i * 0.5;
      body += packet(t, r[0]!, s, 0.35, C.accent, 5.5) + packet(t, r[1]!, s + 0.4, 0.35, C.accent, 5.5) + packet(t, r[2]!, s + 0.8, 0.4, C.accent, 5.5);
    }
    return svg(this.w, this.h, body + caption(this.w, 412, caps[step]![0], caps[step]![1]));
  },
};

// ------------------------------------------------------------ render
const ALL = [callGraph, discovery, states, streaming, a2aMcp, security, inside];

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(`${cmd[0]} failed: ${await new Response(p.stderr).text()}`);
}

async function build(d: Diagram) {
  const dir = join(TMP, d.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.round(d.seconds * FPS);
  const jobs: (() => Promise<void>)[] = [];
  for (let i = 0; i < n; i++) {
    const f = join(dir, `f${String(i).padStart(4, "0")}`);
    writeFileSync(`${f}.svg`, d.frame(i / FPS));
    jobs.push(() => run(["rsvg-convert", "-w", String(d.w), "-o", `${f}.png`, `${f}.svg`]));
  }
  await Promise.all(Array.from({ length: 8 }, async () => { for (let j = jobs.shift(); j; j = jobs.shift()) await j(); }));
  const gif = join(OUT, `${d.name}.gif`);
  await run(["ffmpeg", "-y", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"),
    "-vf", "split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none", "-loop", "0", gif]);
  console.log(`${d.name}.gif  ${n} frames  ${(Bun.file(gif).size / 1024).toFixed(0)} KB`);
}

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
for (const d of ALL) if (!only || d.name.includes(only)) await build(d);
