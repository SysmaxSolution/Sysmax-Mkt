import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App enxuto: apenas rotas de API (webhooks + crons). Sem UI publica por ora.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
