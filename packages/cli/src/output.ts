import { AsyncLocalStorage } from "node:async_hooks";

export interface OutputSink {
  info(message: string): void;
  warn(message: string): void;
  progress(current: number, total: number, message: string, complete: boolean): void;
  panel?(title: string, lines: string[]): void;
}

const outputSinks = new AsyncLocalStorage<OutputSink>();

/** Runs a command implementation with presentation delegated to the caller. */
export async function withOutputSink<T>(sink: OutputSink, operation: () => Promise<T>): Promise<T> {
  return outputSinks.run(sink, operation);
}

export function info(message: string): void {
  const sink = outputSinks.getStore();
  if (sink) return sink.info(message);
  process.stdout.write(`${message}\n`);
}

export function terminalUiEnabled(): boolean {
  return Boolean(process.stderr.isTTY && process.stdout.isTTY) && !process.env.CI && process.env.NO_COLOR === undefined;
}

export function panel(title: string, lines: string[]): void {
  const sink = outputSinks.getStore();
  if (sink?.panel) return sink.panel(title, lines);
  if (sink) return sink.info(`${title}: ${lines.join(" · ")}`);
  if (!terminalUiEnabled()) return;
  const width = Math.max(title.length + 4, ...lines.map((line) => line.length + 2), 34);
  const border = `┌${"─".repeat(width)}┐`;
  process.stderr.write(`\n${border}\n│ ${title.padEnd(width - 2)} │\n├${"─".repeat(width)}┤\n`);
  for (const line of lines) process.stderr.write(`│ ${line.slice(0, width - 2).padEnd(width - 2)} │\n`);
  process.stderr.write(`└${"─".repeat(width)}┘\n`);
}

export function warn(message: string): void {
  const sink = outputSinks.getStore();
  if (sink) return sink.warn(message);
  process.stderr.write(`warning: ${message}\n`);
}

export function enabled(message: string): void {
  const sink = outputSinks.getStore();
  if (sink) return sink.info(`✓ ${message}`);
  process.stdout.write(`✓ ${message}\n`);
}

export function disabled(message: string): void {
  const sink = outputSinks.getStore();
  if (sink) return sink.warn(`✗ ${message}`);
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
  const sink = outputSinks.getStore();
  const interactive = terminalUiEnabled();
  const width = 20;
  const render = (message: string, complete = false): void => {
    if (sink) return sink.progress(current, total, message, complete);
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
