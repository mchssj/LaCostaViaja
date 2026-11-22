import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@lacosta/domain', '@lacosta/driver-core'],
};

export default nextConfig;