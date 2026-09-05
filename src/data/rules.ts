// Loads and validates data/*.json into a typed Rules object, once.

import { RulesSchema, type Rules } from "./schemas";
import weapons from "../../data/weapons.json" with { type: "json" };
import warheads from "../../data/warheads.json" with { type: "json" };
import units from "../../data/units.json" with { type: "json" };
import structures from "../../data/structures.json" with { type: "json" };
import factions from "../../data/factions.json" with { type: "json" };
import general from "../../data/general.json" with { type: "json" };

let cached: Rules | null = null;

export function loadRules(): Rules {
  if (cached) return cached;
  const parsed = RulesSchema.safeParse({ weapons, warheads, units, structures, factions, general });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 12)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`rules data failed validation:\n${issues}`);
  }
  const rules = parsed.data;
  // Cross-reference checks: every weapon/warhead/prereq named must exist.
  const problems: string[] = [];
  for (const [w, def] of Object.entries(rules.weapons)) {
    if (!rules.warheads[def.warhead]) problems.push(`weapon ${w} references unknown warhead ${def.warhead}`);
  }
  const checkWeapons = (owner: string, ws: string[]) => {
    for (const w of ws) if (!rules.weapons[w]) problems.push(`${owner} references unknown weapon ${w}`);
  };
  const checkPrereq = (owner: string, ps: string[]) => {
    for (const p of ps) if (p !== "none" && !rules.structures[p]) problems.push(`${owner} references unknown prereq ${p}`);
  };
  for (const [u, def] of Object.entries(rules.units)) {
    checkWeapons(`unit ${u}`, def.weapons);
    checkPrereq(`unit ${u}`, def.prereq);
    if (def.deploysTo && !rules.structures[def.deploysTo]) problems.push(`unit ${u} deploysTo unknown ${def.deploysTo}`);
  }
  for (const [s, def] of Object.entries(rules.structures)) {
    checkWeapons(`structure ${s}`, def.weapons);
    checkPrereq(`structure ${s}`, def.prereq);
  }
  for (const [f, def] of Object.entries(rules.factions)) {
    for (const u of def.startingUnits) if (!rules.units[u]) problems.push(`faction ${f} starting unit ${u} unknown`);
  }
  if (problems.length) throw new Error(`rules cross-reference errors:\n${problems.join("\n")}`);
  cached = rules;
  return rules;
}
