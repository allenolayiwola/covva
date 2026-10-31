import type { Metadata } from "next";
import { sitePath } from "./site-url";

export const pageCopy = {
  home: { title: "Protect what matters. Wherever you are.", description: "Compare insurance quotes from licensed brokers in Ghana, at home or from abroad. Get real quotes for motor, home, health, travel, life and business insurance from licensed insurers in Ghana through brokers you choose. Pay by MoMo or card; the insurer issues your policy to a digital wallet with QR verification.", path: "/" },
  about: { title: "About us", description: "Our vision is to be Ghana’s most trusted independent insurance access point. Learn how we work with licensed brokers and insurers, and how we are governed.", path: "/about" },
  partners: { title: "Participating partners", description: "The licensed brokers and insurers participating in Covva, with their NIC licence numbers.", path: "/partners" },
  contact: { title: "Contact us", description: "Get in touch with the Covva team — customers, brokers, insurers, businesses and press.", path: "/contact" },
} as const;

export function pageMetadata(copy: { title: string; description: string; path: string }): Metadata {
  // Image handlers live outside route groups so Next keeps these public paths unhashed.
  const image = sitePath(copy.path === "/" ? "/opengraph-image" : `${copy.path}/opengraph-image`);
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: sitePath(copy.path) },
    openGraph: { title: copy.title, description: copy.description, url: sitePath(copy.path), images: [image] },
    twitter: { card: "summary_large_image", title: copy.title, description: copy.description, images: [image] },
  };
}
