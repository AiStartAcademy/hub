import type { MetadataRoute } from "next";

import { brand } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.hubName,
    short_name: brand.hubShortName,
    description:
      `The ${brand.name} learning hub — cohort-based, hands-on AI automation training.`,
    start_url: "/",
    display: "standalone",
    background_color: "#1B1F3B",
    theme_color: "#1B1F3B",
    icons: [
      {
        src: brand.assets.logo,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
