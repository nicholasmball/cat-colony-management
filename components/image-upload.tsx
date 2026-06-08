"use client";

import { useRef, useState } from "react";
import { setCatPhoto, removeCatPhoto } from "@/app/app/colonies/actions";
import { PawIcon } from "@/components/icons";
import { btnGhost, btnGhostDanger } from "@/lib/ui";

// Downscale + JPEG-compress in the browser so field uploads are small.
async function resizeToJpeg(
  file: File,
  max = 1600,
  quality = 0.82,
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  let { width, height } = bitmap;
  if (width > max || height > max) {
    const scale = Math.min(max / width, max / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn’t process the image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Couldn’t process the image.")),
      "image/jpeg",
      quality,
    ),
  );
}

export function ImageUpload({
  catId,
  initialSrc,
  label = "cat",
}: {
  catId: string;
  initialSrc: string | null;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(initialSrc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That’s not an image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("That image is too large (max 25 MB).");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const blob = await resizeToJpeg(file);
      const res = await fetch("/api/photos/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catId, contentType: "image/jpeg" }),
      });
      if (!res.ok) {
        throw new Error(
          (await res.json().catch(() => ({})))?.error ?? "Upload failed.",
        );
      }
      const { uploadUrl, key } = (await res.json()) as {
        uploadUrl: string;
        key: string;
      };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!put.ok) throw new Error("Upload failed. Please try again.");

      const saved = await setCatPhoto(catId, key);
      if ("error" in saved) throw new Error(saved.error);

      setSrc(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await removeCatPhoto(catId);
      if ("error" in res) throw new Error(res.error);
      setSrc(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn’t remove the photo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Photo of ${label}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <PawIcon className="h-7 w-7 text-muted" />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          className="hidden"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className={`${btnGhost} h-9 px-3 text-sm disabled:opacity-60`}
          >
            {busy ? "Working…" : src ? "Replace photo" : "Add photo"}
          </button>
          {src && !busy ? (
            <button
              type="button"
              onClick={onRemove}
              className={`${btnGhostDanger} h-9 px-3 text-sm`}
            >
              Remove
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        ) : (
          <p className="text-xs text-muted">JPG/PNG/WebP · optional.</p>
        )}
      </div>
    </div>
  );
}
