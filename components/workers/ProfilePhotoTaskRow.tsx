import Link from "next/link";
import { Camera } from "lucide-react";
import { Badge } from "@/components/ui";

// The self-service "add a photo" nudge — shared by app/home/page.tsx's "My
// Tasks" preview and app/inbox/page.tsx's full list, so the two pages
// (which render the identical "My Tasks" heading for an Employee-tier
// persona) don't silently disagree about what's pending.
export function ProfilePhotoTaskRow() {
  return (
    <Link href="/profile" className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-muted">
      <span className="flex items-center gap-2"><Camera size={14} className="text-muted-foreground" /> Add a profile photo</span>
      <Badge variant="warning">To do</Badge>
    </Link>
  );
}
