import { NextRequest } from "next/server";

// ===========================================================================
// Autorização de LEITURA para o painel comercial (/painel).
// A equipe comercial recebe o VIEWER_TOKEN — pode ver a fila, copiar mensagens
// e marcar itens da worklist como feito/pular. NÃO aprova disparos de e-mail
// (isso continua exigindo o ADMIN_TOKEN via isAuthorizedAdmin).
// O ADMIN_TOKEN também é aceito aqui (admin enxerga tudo que o viewer enxerga).
// ===========================================================================
export function isAuthorizedViewer(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  if (!token) return false;
  const viewer = process.env.VIEWER_TOKEN;
  const admin = process.env.ADMIN_TOKEN;
  return (!!viewer && token === viewer) || (!!admin && token === admin);
}
