/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace domain packages ship raw TypeScript source (main: ./src/index.ts),
  // so Next must transpile them rather than expecting pre-built JS.
  transpilePackages: [
    '@gramercy/fund-admin',
    '@gramercy/portfolio',
    '@gramercy/ledger',
    '@gramercy/core',
    '@gramercy/agents',
  ],
};

export default nextConfig;
