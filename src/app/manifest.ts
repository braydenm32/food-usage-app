import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Larder",
    short_name: "Larder",
    description: "Know what's in your kitchen, what to eat first, and what to cook with it.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f4ee",
    theme_color: "#2d5b4c",
    orientation: "portrait",
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scan a receipt", url: "/add?method=receipt" },
      { name: "Shopping list", url: "/list" },
    ],
  };
}
