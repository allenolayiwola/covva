export function isProductionDeployment(): boolean {
  // Preview builds also use NODE_ENV=production; Vercel takes precedence.
  return (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
}
