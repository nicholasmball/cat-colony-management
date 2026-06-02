import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points at ./i18n/request.ts by default.
const withNextIntl = createNextIntlPlugin();

// Baseline security headers applied to every response. A full Content-Security
// -Policy is deferred to the hardening task (it needs testing against Supabase
// auth/storage and any future embeds). camera/geolocation are left enabled for
// `self` since the app will use the camera (cat photos) and GPS (colonies).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(), geolocation=(self), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
