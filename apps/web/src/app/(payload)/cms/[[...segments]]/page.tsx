import type { Metadata } from "next";
import config from "@payload-config";
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { cmsConfigured } from "@/cms/env";
import { importMap } from "../importMap.js";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  cmsConfigured() ? generatePageMetadata({ config, params, searchParams }) : Promise.resolve({ title: "Covva CMS is not configured", robots: { index: false } });

export default function Page({ params, searchParams }: Args) {
  // The layout already rendered the "not configured" document; nothing else may touch Payload.
  if (!cmsConfigured()) return null;
  return RootPage({ config, params, searchParams, importMap });
}
