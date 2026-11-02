// Stand-in for the app (covva-app) during the site's e2e run. The site answers app paths (/quote, /account…)
// with a 307 to the app origin. Playwright's page.route does not intercept the target of a server redirect, so
// a real server must answer on the app's port. Every path returns a small page that tests can wait on.
import { createServer } from "node:http";

const origin = new URL(process.env.E2E_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3102");
const port = Number(origin.port || 80);

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>app</title><h1>App</h1>");
}).listen(port, () => console.log(`app stub on ${origin.origin}`));
