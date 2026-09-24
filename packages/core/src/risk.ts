export type RiskCategory = "security" | "persistence" | "public-contract" | "billing" | "deployment" | "shared-core" | "other";

export function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|(?:\.|_)(?:test|spec)\.[^.]+$|(?:^|\/)(?:test_[^/]*|spec_[^/]*|conftest)\.[^.]+$/iu.test(path);
}

export function classifyRisk(path: string): RiskCategory {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const parts = normalized.split("/");
  const file = parts.at(-1) ?? "";
  if (/(?:auth|security|permission|credential|session|token)/u.test(normalized)) return "security";
  if (/(?:^|[\/_.-])db(?:[\/_.-]|$)|(?:database|migration|repository|store|persistence|schema)/u.test(normalized)) return "persistence";
  if (/(?:billing|payment|invoice|price|money)/u.test(normalized)) return "billing";
  if (normalized.startsWith(".github/workflows/")
    || parts.some((part) => /^(?:deploy(?:ment|ments)?|terraform|kubernetes|k8s|docker)$/u.test(part))
    || /^(?:dockerfile|docker-compose(?:\.[^.]+)?|(?:release|deploy)\.(?:ya?ml|sh|js|ts|mjs|cjs))$/u.test(file)) return "deployment";
  // An `api` ancestor often contains private implementation. Classify the
  // exposed seam, rather than every file under that directory, as public.
  if (/(?:api|contract|protocol|public|handler|controller|routes?|dto)/u.test(file)
    || parts.slice(0, -1).some((part) => /(?:^|_)(?:contracts?|protocols?|handlers?|controllers?|routes?|dto)$/u.test(part))) return "public-contract";
  if (parts.some((part) => /^(?:core|domain|shared|common|infra)$/u.test(part))) return "shared-core";
  return "other";
}
