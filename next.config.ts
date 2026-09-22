import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Old standalone admin pages that got merged into a tab of another
  // page — kept as redirects so any bookmark or stale link still lands
  // somewhere useful instead of 404ing.
  async redirects() {
    return [
      { source: '/admin/activity', destination: '/admin/analytics?tab=engagement', permanent: false },
      { source: '/admin/programs', destination: '/admin/courses?tab=programs', permanent: false },
      { source: '/admin/audit-log', destination: '/admin/tracker?tab=audit-log', permanent: false },
    ];
  },
  serverExternalPackages: ['unpdf', 'jszip'],
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  webpack: (config: { resolve: { alias: Record<string, boolean> } }) => {
    // pdfjs-dist requires 'canvas' which doesn't exist in browsers — alias it away
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
