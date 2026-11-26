import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // loaded with node's resolver at runtime instead of bundled (optional peer deps)
  serverExternalPackages: ["@coinbase/cdp-sdk"],
  webpack(config) {
    // cdp-core lazily references optional integrations beef doesn't use (x402 payments,
    // react-native storage). resolve them to empty modules instead of warning.
    config.resolve.alias = { ...config.resolve.alias, "x402-fetch": false, "expo-secure-store": false, "expo-web-browser": false, "@react-native-async-storage/async-storage": false };
    return config;
  },
  // coinbase's wallet sign-in api, served from beef's own domain for phones that can't reach
  // api.cdp.coinbase.com directly. see src/components/wallet/cdp-route.ts.
  async rewrites() {
    return [{ source: "/cdp-api/:path*", destination: "https://api.cdp.coinbase.com/platform/:path*" }];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
