import { resolve } from "node:path";

export function projectRoot(value?: string): string {
  return resolve(value || process.cwd());
}

export function providerValues(value?: string): string[] | undefined {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}
