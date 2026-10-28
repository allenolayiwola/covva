import type { ServerFunctionClient } from "payload";
import config from "@payload-config";
import { RootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import "@payloadcms/next/css";
import { cmsConfigured } from "@/cms/env";
import { importMap } from "./cms/importMap.js";
import { CmsDisabled } from "./cms-disabled";
import "./custom.scss";

/**
 * Root layout for the Payload admin (/cms). It is its own root layout (own <html>), which is why the
 * rest of the site lives under app/(site). With the CMS unconfigured it renders a plain notice and
 * never touches Payload, so builds and previews without secrets keep working.
 */
const serverFunction: ServerFunctionClient = async function (args) {
  "use server";
  return handleServerFunctions({ ...args, config, importMap });
};

export default function PayloadLayout({ children }: { children: React.ReactNode }) {
  if (!cmsConfigured()) return <CmsDisabled />;
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  );
}
