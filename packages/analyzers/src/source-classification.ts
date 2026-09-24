import { basename } from "node:path";

/** Package marker files with no executable Python statements need no semantic owner. */
export function isPythonPackageMarker(path: string, content: string): boolean {
  if (basename(path) !== "__init__.py") return false;
  const body = content.trim();
  return !body || /^(?:"""[\s\S]*"""|'''[\s\S]*''')$/u.test(body);
}
