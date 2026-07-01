import { NextRequest } from "next/server";

// Valida o header x-admin-token contra ADMIN_TOKEN (mesmo padrão do endpoint
// send-proposal). Usado nas rotas do painel /admin.
export function isAuthorizedAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  const expected = process.env.ADMIN_TOKEN;
  return !!expected && token === expected;
}
