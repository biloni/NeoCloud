import { AskChat } from "@/components/ask/AskChat";
import { getAuthContext } from "@/lib/auth-context";
import { guardRoute } from "@/security/routeGuard";
import { effectiveRoles } from "@/security/authorization";
import { getExamplePrompts, getRoleFraming } from "@/lib/ai-tools";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const ctx = await getAuthContext();
  guardRoute(ctx, "/ask", "/home");
  const roles = effectiveRoles(ctx);
  return <AskChat examples={getExamplePrompts(roles)} framing={getRoleFraming(roles)} />;
}
