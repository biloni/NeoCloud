// Server-only: reads the acting-worker and proxy-target cookies and builds
// an AuthContext. Every Server Component/Server Action that needs to ask
// the authorization engine a question calls this ONE function rather than
// re-reading cookies itself — the single place that would need to change
// if this app ever grows a real session/login layer (see security/README.md).
import { cookies } from "next/headers";
import { buildAuthContext, type AuthContext } from "@/security/authorization";
import { WORKER_COOKIE, PROXY_WORKER_COOKIE } from "./persona-constants";

const DEFAULT_WORKER_ID = "E0004"; // arbitrary employee-tier default when no cookie is set yet

export async function getAuthContext(): Promise<AuthContext> {
  const store = cookies();
  const actualWorkerId = (store.get(WORKER_COOKIE)?.value || DEFAULT_WORKER_ID).toUpperCase();
  const proxyWorkerId = store.get(PROXY_WORKER_COOKIE)?.value?.toUpperCase() || null;
  return buildAuthContext(actualWorkerId, proxyWorkerId);
}
