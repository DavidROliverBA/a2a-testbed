/**
 * Callback (push notification) address checks.
 *
 * A caller chooses the address this server will POST to. Without a check, a caller
 * can aim the server at something only the server can reach (an admin page, a cloud
 * metadata service). That is server-side request forgery.
 *
 * Policy here:
 *   - http(s) only
 *   - a host on the allow-list is accepted as is
 *   - any other internal-looking host is refused
 *   - any other (public) host must use https
 *
 * Limits of this lab version: it checks the name as written. A public name that
 * resolves to an internal address (DNS rebinding) needs a check at connection time.
 */
import { Errors } from "../protocol.ts";

export function isInternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || h.startsWith("fe80") || h.startsWith("::ffff:"); // IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return !h.includes("."); // bare names like "intranet" only resolve inside a network
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function checkCallbackUrl(raw: string, allow: readonly string[]): void {
  let u: URL;
  try { u = new URL(raw); } catch { throw Errors.invalidParams("callback `url` is not a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw Errors.invalidParams(`callback url must be http(s), not ${u.protocol}`);
  if (u.username || u.password) throw Errors.invalidParams("callback url must not contain credentials");
  if (allow.includes(u.hostname)) return;
  if (isInternalHost(u.hostname)) throw Errors.invalidParams(`callback host ${u.hostname} is internal and not on the allow-list`);
  if (u.protocol !== "https:") throw Errors.invalidParams("callbacks to public hosts must use https");
}
