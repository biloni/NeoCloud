import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { effectiveWorkerId } from "@/security/authorization";

// "Profile" reuses the existing worker detail page (app/workers/[id]) rather
// than duplicating its rendering — that page already enforces the
// canViewEmployee data-access guard, and self-viewing always passes it.
export default async function ProfilePage() {
  const ctx = await getAuthContext();
  redirect(`/workers/${effectiveWorkerId(ctx)}`);
}
