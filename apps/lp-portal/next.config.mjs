/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@gramercy/fund-admin` re-exports modules (nav, distribution) that import
  // `@gramercy/ledger` at runtime, so it must be transpiled alongside the two
  // packages the portal consumes directly.
  transpilePackages: ['@gramercy/fund-admin', '@gramercy/core', '@gramercy/ledger'],
};

export default nextConfig;
