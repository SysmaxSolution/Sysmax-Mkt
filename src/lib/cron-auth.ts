import { NextRequest } from "next/server";

// Valida o Bearer CRON_SECRET nas rotas de cron/webhook internas.
// Mesmo padrao usado nos crons do VetMax.
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
