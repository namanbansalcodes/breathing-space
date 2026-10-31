import type { Density, Rule } from "./types.js";

export const PRESETS: Record<Density, ReadonlySet<Rule>> = {
  compact: new Set<Rule>(["R2", "R5"]),
  normal: new Set<Rule>(["R1", "R2", "R3", "R4", "R5"]),
  airy: new Set<Rule>(["R1", "R2", "R3", "R4", "R5", "R7"]),
};
