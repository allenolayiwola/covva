import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "COVVA",
    short_name: "Insurance",
    description: "Find cover. Understand it. Move forward. Insurance made clearer, with human help built in.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#00796E",
    lang: "en-GH",
    categories: ["finance", "business"],
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
