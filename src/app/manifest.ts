import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Larder",
    short_name: "Larder",
    description: "Know what's in your kitchen, what to eat first, and what to cook with it.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f4ee",
    theme_color: "#2d5b4c",
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Shown in the richer install sheet on Android and desktop Chrome.
    screenshots: [
      { src: "/screenshots/today-phone.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "Today: what to eat first" },
      { src: "/screenshots/list-phone.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "Shopping list by aisle" },
      { src: "/screenshots/larder-wide.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: "Your larder, most urgent first" },
    ],
    // "Share to Larder" from a browser or social app opens the recipe importer with the link.
    share_target: { action: "/recipes", method: "GET", params: { title: "title", text: "text", url: "url" } },
    shortcuts: [
      { name: "Scan a receipt", url: "/add?method=receipt" },
      { name: "Shopping list", url: "/list" },
    ],
  };
}
