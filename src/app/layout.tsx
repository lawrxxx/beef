import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";

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
    <html lang="en" suppressHydrationWarning>
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
