/**
 * Pluggable logger interface.
 *
 * The default logger is a tiny structured JSON logger writing to stdout.
 * Plug pino / winston / your own by implementing `Logger`.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface Logger {
  level: LogLevel;
  trace(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  fatal(obj: object | string, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  /** Where to write. Defaults to process.stdout.write or console.log. */
  write?: (line: string) => void;
}

/**
 * Build a structured JSON logger writing one record per line to stdout (or
 * any sink you supply). Records always include `level`, `time`, and the
 * caller's bindings; objects are merged shallowly and the optional `msg` is
 * placed under the `msg` key for compatibility with downstream tools.
 *
 * @example
 * ```ts
 * import { createLogger, App } from "@daloyjs/core";
 *
 * const log = createLogger({ level: "info", bindings: { service: "books-api" } });
 * const app = new App({ logger: log });
 * log.info({ event: "boot" }, "server starting");
 * ```
 *
 * @param opts - Level, bindings merged into every record, and custom sink.
 * @returns A {@link Logger} instance.
 * @since 0.1.0
 */
export function createLogger(opts: ConsoleLoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const threshold = LEVELS[level];
  const bindings = opts.bindings ?? {};
  const write =
    opts.write ??
    (typeof process !== "undefined" && process.stdout?.write
      ? (line: string) => {
          process.stdout.write(line + "\n");
        }
      : (line: string) => console.log(line));

  function emit(lvl: LogLevel, obj: object | string, msg?: string) {
    if (LEVELS[lvl] < threshold) return;
    const base: Record<string, unknown> = {
      level: lvl,
      time: new Date().toISOString(),
      ...bindings,
    };
    if (typeof obj === "string") {
      base.msg = obj;
    } else {
      Object.assign(base, obj);
      if (msg !== undefined) base.msg = msg;
    }
    try {
      write(JSON.stringify(base));
    } catch {
      write(`{"level":"${lvl}","time":"${base.time}","msg":"<unserializable log>"}`);
    }
  }

  const logger: Logger = {
    level,
    trace: (o, m) => emit("trace", o, m),
    debug: (o, m) => emit("debug", o, m),
    info: (o, m) => emit("info", o, m),
    warn: (o, m) => emit("warn", o, m),
    error: (o, m) => emit("error", o, m),
    fatal: (o, m) => emit("fatal", o, m),
    child(extra) {
      return createLogger({ level, bindings: { ...bindings, ...extra }, write });
    },
  };
  return logger;
}

/**
 * A {@link Logger} that discards every record. Used internally when the App
 * is constructed with `{ logger: false }` and exported so tests can silence
 * specific subsystems without monkey-patching console.
 *
 * @since 0.1.0
 */
export const noopLogger: Logger = {
  level: "fatal",
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return noopLogger;
  },
};
