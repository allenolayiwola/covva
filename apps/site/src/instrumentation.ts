import type { Instrumentation } from "next";

/**
 * Server instrumentation for the marketing site: structured JSON logs for unhandled request errors.
 * (Payment and identity provider checks run in the app, covva-app, which owns those flows.)
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.LOG_LEVEL === "debug") {
    console.log(JSON.stringify({ level: "debug", msg: "instrumentation.register", time: new Date().toISOString(), service: "site" }));
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      msg: "request.unhandled_error",
      time: new Date().toISOString(),
      service: "site",
      digest: e.digest,
      error: { name: e.name, message: e.message, stack: e.stack?.split("\n").slice(0, 8).join("\n") },
      request: { method: request.method, path: request.path, requestId: (request.headers["x-request-id"] as string | undefined) ?? null },
      context: { routerKind: context.routerKind, routePath: context.routePath, routeType: context.routeType, renderSource: context.renderSource },
    }),
  );
};
