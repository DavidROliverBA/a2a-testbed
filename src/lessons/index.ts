import { withTestbed, bold } from "./lib.ts";
import { lesson as l1 } from "./l01-discovery.ts";
import { lesson as l2 } from "./l02-message.ts";
import { lesson as l3 } from "./l03-task.ts";
import { lesson as l4 } from "./l04-streaming.ts";
import { lesson as l5 } from "./l05-multiturn.ts";
import { lesson as l6 } from "./l06-cancel.ts";
import { lesson as l7 } from "./l07-push.ts";
import { lesson as l8 } from "./l08-auth.ts";
import { lesson as l9 } from "./l09-bindings.ts";
import { lesson as l10 } from "./l10-errors.ts";
import { lesson as l11 } from "./l11-parts.ts";
import { lesson as l12 } from "./l12-orchestration.ts";
import { lesson as l13 } from "./l13-security.ts";
import { lesson as l14 } from "./l14-patterns.ts";

const lessons = [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10, l11, l12, l13, l14];
const arg = process.argv[2];

if (!arg) {
  console.log(bold("\nA2A testbed lessons\n"));
  for (const l of lessons) console.log(`  bun run lesson ${String(l.n).padEnd(3)} ${l.name}`);
  console.log("\n  bun run lesson all    run everything\n  A2A_WIRE=0 hides the raw HTTP traffic\n");
} else {
  const picked = arg === "all" ? lessons : lessons.filter((l) => String(l.n) === arg);
  if (!picked.length) { console.error(`No lesson '${arg}'`); process.exit(1); }
  await withTestbed(async (base) => { for (const l of picked) await l.run(base); });
}
