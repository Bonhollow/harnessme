/** Extract explicitly protected method names from maintainer instruction bullets. */
export function protectedMethodsFromDirectives(markdown: string): string[] {
  const rules = [...markdown.matchAll(/(?:^|\n)-\s*(?:Do not|Never)\s+(?:touch|edit|modify)[^\n]*\b(?:methods?|functions?)\b[^\n]*:\s*([\s\S]*?)(?=\n-\s|\n#{2,6}\s|\n\n|$)/giu)];
  return [...new Set(rules.flatMap((rule) => [...rule[1]!.matchAll(/`([A-Za-z_$][\w$.]*\(\))`/gu)].map((match) => match[1]!)))];
}

function snakeCase(value: string): string {
  return value.replace(/([a-z\d])([A-Z])/gu, "$1_$2").toLowerCase();
}

/** Match a directive's Python definition in a specific source file. */
export function protectedMethodsDefinedInPython(path: string, source: string, methods: string[]): string[] {
  if (!path.endsWith(".py")) return [];
  const stem = path.split("/").at(-1)!.slice(0, -3).toLowerCase();
  return methods.filter((method) => {
    const symbol = method.slice(0, -2);
    const qualifier = symbol.includes(".") ? symbol.slice(0, symbol.lastIndexOf(".")) : "";
    if (qualifier && stem !== snakeCase(qualifier)) return false;
    const name = symbol.slice(symbol.lastIndexOf(".") + 1);
    return /^[A-Za-z_]\w*$/u.test(name)
      && new RegExp(`^\\s*(?:async\\s+)?def\\s+${name}\\s*\\(`, "mu").test(source);
  });
}
