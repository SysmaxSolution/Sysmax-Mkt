import type { NextConfig } from "next";

// Raiz do projeto = este diretório. Sem isso, o Next/Turbopack sobe até
// C:\SysMax (que tem lockfile e src/) e passa a compilar arquivos do VetMax.
const projectRoot = process.cwd();

const nextConfig: NextConfig = {
  // App enxuto: apenas rotas de API (webhooks + crons). Sem UI pública por ora.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
