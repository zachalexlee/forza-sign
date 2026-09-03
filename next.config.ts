import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Blank packet PDFs uploaded via the admin template form run ~1.5MB,
      // over the 1MB server-action default. Vercel's own request cap is
      // 4.5MB, so 4mb is the practical ceiling.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
