import { AskChat } from "@/components/ask/AskChat";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/ask", "/home");
  return <AskChat />;
}
