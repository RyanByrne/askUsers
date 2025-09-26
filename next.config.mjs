/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma']
  },
  webpack: (config) => {
    config.externals.push('@prisma/client')
    return config
  }
}

export default nextConfig