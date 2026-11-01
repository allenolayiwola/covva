import "server-only";

/**
 * Structured JSON logging (one line per event) so Vercel log drains / Datadog /
 * Axiom can index fields. Never log tokens, secrets or full personal data.
 */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), service: "web", ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") emit("debug", msg, fields);
  },
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/** Mask an email/phone for logs: a***@x.com, +23324***567. */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes("@")) {
    const [u, d] = value.split("@");
    return `${u!.slice(0, 1)}***@${d}`;
  }
  return value.length > 6 ? `${value.slice(0, 5)}***${value.slice(-3)}` : "***";
}
