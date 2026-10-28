import type { Metadata } from "next";
import config from "@payload-config";
import { NotFoundPage, generatePageMetadata } from "@payloadcms/next/views";
import { cmsConfigured } from "@/cms/env";
import { importMap } from "../importMap.js";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  cmsConfigured() ? generatePageMetadata({ config, params, searchParams }) : Promise.resolve({ title: "Not found", robots: { index: false } });

export default function NotFound({ params, searchParams }: Args) {
  if (!cmsConfigured()) return null;
  return NotFoundPage({ config, params, searchParams, importMap });
}
