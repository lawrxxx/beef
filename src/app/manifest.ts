import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "beef — stock duels with friends",
    short_name: "beef",
    description: "put your money where your mouth is. stock duels, predictions and rivalries.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // static per the manifest spec; the live page sets theme-color for light/dark (see lib/theme.ts)
    background_color: "#F6F5F2",
    theme_color: "#F6F5F2",
    categories: ["social", "finance", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "start a beef", url: "/duel/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "leaderboard", url: "/leaderboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
