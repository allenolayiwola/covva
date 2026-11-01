// Shared settings for the marketing site e2e specs (no sign-in: the site has none).

/** Every row the browser tests create carries this prefix so it can be purged. */
export const TAG = "E2E-PLAYWRIGHT";

/**
 * Origin of the app (covva-app). The site forwards app paths (/quote, /account, /sign-in…) there; tests that
 * follow such a link stub the app with page.route, so the app does not need to be running.
 */
export const APP_ORIGIN = new URL(process.env.E2E_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3102").origin;

/** Answer every request to the app with a stub page, so cross-app navigation can be asserted without it. */
export async function stubApp(target) {
  await target.route(`${APP_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>app</title><h1>App</h1>" }));
}
