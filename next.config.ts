import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
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
