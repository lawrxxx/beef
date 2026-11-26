import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";

// self-hosted (ofl): no runtime font requests, no new dependencies
const display = localFont({ src: "./fonts/big-shoulders-display.woff2", variable: "--font-display", weight: "100 900", display: "swap" });
const ui = localFont({ variable: "--font-ui", display: "swap", src: [
  { path: "./fonts/barlow-400.woff2", weight: "400" }, { path: "./fonts/barlow-500.woff2", weight: "500" },
  { path: "./fonts/barlow-600.woff2", weight: "600" }, { path: "./fonts/barlow-700.woff2", weight: "700" },
] });
const num = localFont({ variable: "--font-num", display: "swap", src: [
  { path: "./fonts/barlow-condensed-600.woff2", weight: "600" }, { path: "./fonts/barlow-condensed-700.woff2", weight: "700" }, { path: "./fonts/barlow-condensed-800.woff2", weight: "800" },
  { path: "./fonts/barlow-condensed-600-italic.woff2", weight: "600", style: "italic" }, { path: "./fonts/barlow-condensed-700-italic.woff2", weight: "700", style: "italic" }, { path: "./fonts/barlow-condensed-800-italic.woff2", weight: "800", style: "italic" },
] });
const mono = localFont({ src: "./fonts/jetbrains-mono.woff2", variable: "--font-mono", weight: "100 800", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: "beef — put your money where your mouth is", template: "%s · beef" },
  description: "challenge friends to stock duels, post predictions and build your rep. prices from chainlink, stakes in test usdc on base sepolia.",
  applicationName: "beef",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "beef", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/favicon.ico" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: { title: "beef", description: "put your money where your mouth is.", images: ["/icons/og.png"] },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  // follows the device by default; an explicit light/dark choice is applied by THEME_SCRIPT
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script sets class/style on <html> before react hydrates
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable} ${num.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
