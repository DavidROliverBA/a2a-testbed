import type { AgentDef } from "../server/runtime.ts";
import { booking } from "./booking.ts";
import { concierge } from "./concierge.ts";
import { echo } from "./echo.ts";
import { inspector } from "./inspector.ts";
import { orchestrator } from "./orchestrator.ts";
import { reporter } from "./reporter.ts";
import { slowpoke } from "./slowpoke.ts";
import { trickster } from "./trickster.ts";
import { vault } from "./vault.ts";

export const allAgents = (): AgentDef[] => [echo, reporter, booking, slowpoke, vault, inspector, orchestrator, trickster, concierge];
