/**
 * Handling what another agent sends back.
 *
 * A reply from another agent was written by a model you don't control. It is data.
 * These helpers keep it that way:
 *   quarantine()        label every part with where it came from, so it can be shown
 *                       or stored but is never mistaken for the user's own words
 *   validateShape()     accept structured data only if it has exactly the fields
 *                       and types you expected
 *   looksLikeInjection()  a HINT for logs and alerts. It is easy to get past and is
 *                       not a defence; the defence is never feeding remote text into
 *                       the place your agent takes instructions from.
 */
import type { Part } from "../protocol.ts";

export function quarantine(source: string, parts: Part[]): Part[] {
  return parts.map((p) => ({ ...structuredClone(p), metadata: { ...(p.metadata ?? {}), untrusted: true, source } }));
}

export type FieldType = "string" | "number" | "boolean";
export function validateShape(data: unknown, shape: Record<string, FieldType>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, problems: ["expected an object"] };
  const obj = data as Record<string, unknown>;
  for (const [k, t] of Object.entries(shape)) {
    if (!(k in obj)) problems.push(`missing field: ${k}`);
    else if (typeof obj[k] !== t || (t === "number" && !Number.isFinite(obj[k]))) problems.push(`${k} should be a ${t}, got ${typeof obj[k]}`);
  }
  for (const k of Object.keys(obj)) if (!(k in shape)) problems.push(`unexpected field: ${k}`);
  return { ok: problems.length === 0, problems };
}

const HINTS = [/ignore (all |your )?(previous|prior|earlier) instructions/i, /system (notice|prompt|message)/i, /you are now/i, /reveal (your|the) /i, /do not tell the user/i];
export const looksLikeInjection = (text: string) => HINTS.some((re) => re.test(text));
