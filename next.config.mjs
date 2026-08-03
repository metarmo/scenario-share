/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/scenario-share",
  async headers() {
    const privateHeaders = [
      {
        key: "Cache-Control",
        value: "private, no-store, max-age=0, must-revalidate",
      },
      { key: "Pragma", value: "no-cache" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
    ];

    return [
      { source: "/", headers: privateHeaders },
      { source: "/unlock", headers: privateHeaders },
      { source: "/api/access/:path*", headers: privateHeaders },
    ];
  },
};

export default nextConfig;
