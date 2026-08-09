/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  output: "standalone",
  // 生产部署：通过 NEXT_PUBLIC_BASE_PATH 挂到子路径（如 /abyss-miner），本地开发默认为空。
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
