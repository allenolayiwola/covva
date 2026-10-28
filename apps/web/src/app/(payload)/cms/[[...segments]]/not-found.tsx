import type { Metadata } from "next";
import config from "@payload-config";
import { NotFoundPage, generatePageMetadata } from "@payloadcms/next/views";
import { cmsReady } from "@/cms/bootstrap";
import { importMap } from "../importMap.js";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export const generateMetadata = async ({ params, searchParams }: Args): Promise<Metadata> =>
  (await cmsReady()) ? generatePageMetadata({ config, params, searchParams }) : { title: "Not found", robots: { index: false } };

export default async function NotFound({ params, searchParams }: Args) {
  if (!(await cmsReady())) return null;
  return NotFoundPage({ config, params, searchParams, importMap });
}
