import type { Metadata } from "next";
import config from "@payload-config";
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { cmsReady } from "@/cms/bootstrap";
import { importMap } from "../importMap.js";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

// When the CMS is closed the layout's notice document carries its own <title>.
export const generateMetadata = async ({ params, searchParams }: Args): Promise<Metadata> =>
  (await cmsReady()) ? generatePageMetadata({ config, params, searchParams }) : { robots: { index: false } };

export default async function Page({ params, searchParams }: Args) {
  // The layout already rendered the "not configured" / "not initialised" document; nothing else
  // may touch Payload (its RootPage would redirect to the public create-first-user screen).
  if (!(await cmsReady())) return null;
  return RootPage({ config, params, searchParams, importMap });
}
