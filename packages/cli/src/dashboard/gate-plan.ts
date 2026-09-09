export interface GatePlanRule {
  glob: string;
  status: "active" | "proposed";
}

export interface GatePlan {
  activate: string[];
  remove: string[];
  add?: { glob: string; reason: string; approvers: string };
}

export function buildGatePlan(gates: GatePlanRule[], selected: Set<string>): GatePlan {
  return {
    activate: gates.filter((gate) => gate.status === "proposed" && selected.has(gate.glob)).map((gate) => gate.glob),
    remove: gates.filter((gate) => gate.status === "active" && selected.has(gate.glob)).map((gate) => gate.glob),
  };
}
