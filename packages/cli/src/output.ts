export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function terminalUiEnabled(): boolean {
  return Boolean(process.stderr.isTTY && process.stdout.isTTY) && !process.env.CI && process.env.NO_COLOR === undefined;
}

export function panel(title: string, lines: string[]): void {
  if (!terminalUiEnabled()) return;
  const width = Math.max(title.length + 4, ...lines.map((line) => line.length + 2), 34);
  const border = `┌${"─".repeat(width)}┐`;
  process.stderr.write(`\n${border}\n│ ${title.padEnd(width - 2)} │\n├${"─".repeat(width)}┤\n`);
  for (const line of lines) process.stderr.write(`│ ${line.slice(0, width - 2).padEnd(width - 2)} │\n`);
  process.stderr.write(`└${"─".repeat(width)}┘\n`);
}

export function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

export function enabled(message: string): void {
  process.stdout.write(`✓ ${message}\n`);
}

export function disabled(message: string): void {
  process.stdout.write(`✗ ${message}\n`);
}

export function fail(message: string): never {
  throw new Error(message);
}

export interface Progress {
  step(message: string): void;
  done(message?: string): void;
}

export function createProgress(total: number): Progress {
  let current = 0;
  const interactive = terminalUiEnabled();
  const width = 20;
  const render = (message: string, complete = false): void => {
    const filled = complete ? width : Math.max(1, Math.round((current / total) * width));
    const bar = `${"=".repeat(filled)}${".".repeat(width - filled)}`;
    const line = `[${bar}] ${complete ? total : current}/${total} ${message}`;
    if (interactive) process.stderr.write(`\r\x1b[2K${line}${complete ? "\n" : ""}`);
    else process.stderr.write(`progress: ${line}\n`);
  };
  return {
    step(message) {
      current = Math.min(total, current + 1);
      render(message);
    },
    done(message = "Complete") {
      current = total;
      render(message, true);
    },
  };
}
