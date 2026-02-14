/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable webpack caching for faster builds
  webpack: (config) => {
    // Bun SQLite is handled natively
    return config
  },
}

module.exports = nextConfig
