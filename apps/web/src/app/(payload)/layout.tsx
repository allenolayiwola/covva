import type { ServerFunctionClient } from "payload";
import config from "@payload-config";
import { RootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import "@payloadcms/next/css";
import { cmsBootstrapState, cmsReady } from "@/cms/bootstrap";
import { cmsConfigured } from "@/cms/env";
import { importMap } from "./cms/importMap.js";
import { CmsDisabled, CmsNotInitialised } from "./cms-disabled";
import "./custom.scss";

/**
 * Root layout for the Payload admin (/cms). It is its own root layout (own <html>), which is why the
 * rest of the site lives under app/(site). With the CMS unconfigured it renders a plain notice and
 * never touches Payload, so builds and previews without secrets keep working. With the CMS
 * configured but no user yet it also stays closed (see cms/bootstrap.ts): Payload's public
 * "create first user" screen is never served; the first admin comes from `cms:seed`.
 *
 * `instant = false`: the admin is a blocking, request-time route. The bootstrap check runs on
 * every request (memoised) and nothing of it is prerendered into a static shell.
 */
export const instant = false;

const serverFunction: ServerFunctionClient = async function (args) {
  "use server";
  if (!(await cmsReady())) throw new Error("CMS is not initialised");
  return handleServerFunctions({ ...args, config, importMap });
};

export default async function PayloadLayout({ children }: { children: React.ReactNode }) {
  if (!cmsConfigured()) return <CmsDisabled />;
  const state = await cmsBootstrapState();
  if (state !== "ready") return <CmsNotInitialised state={state} />;
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  );
}
