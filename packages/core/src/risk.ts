export type RiskCategory = "security" | "persistence" | "public-contract" | "billing" | "deployment" | "shared-core" | "other";

export function classifyRisk(path: string): RiskCategory {
  if (/(?:auth|security|permission|credential|session|token)/iu.test(path)) return "security";
  if (/(?:database|db|migration|repository|store|persistence|schema)/iu.test(path)) return "persistence";
  if (/(?:billing|payment|invoice|price|money)/iu.test(path)) return "billing";
  if (/(?:deploy|release|workflow|docker|terraform|infra)/iu.test(path)) return "deployment";
  if (/(?:api|contract|protocol|public|handler|controller)/iu.test(path)) return "public-contract";
  if (/(?:core|domain|shared|common)/iu.test(path)) return "shared-core";
  return "other";
}
