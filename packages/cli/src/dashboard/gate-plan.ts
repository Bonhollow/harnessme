export interface GatePlanRule {
  glob: string;
  status: "active" | "proposed";
}

export interface GatePlan {
  activate: string[];
  remove: string[];
  dismiss: string[];
  reasons?: Record<string, string>;
  add?: { glob: string; reason: string; approvers: string };
}

export function buildGatePlan(gates: GatePlanRule[], selected: Set<string>, dismissed: Set<string> = new Set()): GatePlan {
  return {
    activate: gates.filter((gate) => gate.status === "proposed" && selected.has(gate.glob) && !dismissed.has(gate.glob)).map((gate) => gate.glob),
    remove: gates.filter((gate) => gate.status === "active" && selected.has(gate.glob)).map((gate) => gate.glob),
    dismiss: gates.filter((gate) => gate.status === "proposed" && dismissed.has(gate.glob)).map((gate) => gate.glob),
  };
}
