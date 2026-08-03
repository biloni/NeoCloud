"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { uploadProfilePhotoAction } from "@/lib/actions";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function initialsOf(legalName: string): string {
  return legalName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Circular avatar. `editable` renders it as an upload control (click to
 * choose a file, immediate preview + save) — used only when viewing your
 * own profile. Every other viewer gets the same avatar as a plain, static
 * display, so a photo one worker uploads is visible to anyone who can view
 * their profile, but only they can change it.
 */
export function ProfilePhotoUpload({ photoUrl, legalName, editable }: { photoUrl: string | null; legalName: string; editable: boolean }) {
  const [preview, setPreview] = useState<string | null>(photoUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const initials = initialsOf(legalName);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("That image is too large — choose one under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      startTransition(async () => {
        try {
          await uploadProfilePhotoAction(dataUrl);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to upload photo");
          setPreview(photoUrl);
        }
      });
    };
    reader.readAsDataURL(file);
  }

  const avatar = (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI, next/image can't optimize it anyway
        <img src={preview} alt={`${legalName}'s profile photo`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground" aria-hidden="true">
          {initials}
        </span>
      )}
      {editable && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <Camera size={16} className="text-white" />
        </span>
      )}
    </div>
  );

  if (!editable) return avatar;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="group rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={photoUrl ? "Change profile photo" : "Add profile photo"}
      >
        {avatar}
      </button>
      <div>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={pending} className="text-xs font-medium text-accent hover:underline disabled:opacity-50">
          {pending ? "Uploading..." : photoUrl ? "Change photo" : "Add photo"}
        </button>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}
