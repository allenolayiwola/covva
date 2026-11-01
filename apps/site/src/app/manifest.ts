import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Covva",
    short_name: "Covva",
    description: "Find cover. Understand it. Move forward. Insurance made clearer, with human help built in.",
    start_url: "/",
    display: "standalone",
    background_color: "#F1F7F3",
    theme_color: "#00796E",
    lang: "en-GH",
    categories: ["finance", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
