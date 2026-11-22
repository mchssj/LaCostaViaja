import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Paquetes del monorepo que se publican como TypeScript fuente.
  transpilePackages: ['@lacosta/domain', '@lacosta/driver-core'],
};

export default nextConfig;
