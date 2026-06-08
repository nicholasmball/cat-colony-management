"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { reportCat } from "@/app/app/colonies/[id]/cats/report/actions";
import { PawIcon } from "@/components/icons";
import { hasReportIdentifier } from "@/lib/cat-report";
import {
  btnGhost,
  btnGhostDanger,
  btnPrimary,
  fieldLabel,
  input,
} from "@/lib/ui";

// Tri-state segmented control, identical pattern to feed-form.tsx: three
// radio buttons, "Unknown" pre-selected (neutral-strong on-class), the value
// choices use the accent on-class. Selected carries a "✓" in addition to fill
// (not colour alone).
function Segmented({
  legendId,
  value,
  onChange,
  options,
}: {
  legendId: string;
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={legendId}
      className="grid grid-cols-3 gap-2"
    >
      {options.map((o) => {
        const on = value === o.key;
        const onClass =
          o.key === "unknown"
            ? "border-foreground bg-foreground text-background"
            : "border-accent bg-accent text-accent-foreground";
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            className={`flex min-h-12 items-center justify-center gap-1.5 rounded-lg border text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
              on
                ? `${onClass} font-semibold`
                : "border-border font-medium text-foreground"
            }`}
          >
            {o.label}
            {on ? <span aria-hidden>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function CatReportForm({ colonyId }: { colonyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [tempId, setTempId] = useState("");
  const [sex, setSex] = useState("unknown");
  const [neutered, setNeutered] = useState("unknown");
  const [idError, setIdError] = useState(false);

  // Photo state mirrors incident-form.tsx: presign → PUT to R2, then stash the
  // returned key in a hidden field so the action stores it on the cat. A failed
  // upload never blocks the report (non-blocking requirement).
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoKey, setPhotoKey] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Client-side first (no round-trip); the action re-validates server-side.
    if (!hasReportIdentifier({ name, temp_id: tempId })) {
      e.preventDefault();
      setIdError(true);
      nameRef.current?.focus();
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("That’s not an image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoError("That image is too large (max 25 MB).");
      return;
    }
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const blob = await resizeToJpeg(file);
      const res = await fetch("/api/photos/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "cat_report",
          colonyId,
          contentType: "image/jpeg",
        }),
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
      setPhotoKey(key);
      setPhotoPreview(URL.createObjectURL(blob));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function removePhoto() {
    setPhotoKey("");
    setPhotoPreview(null);
    setPhotoError(null);
  }

  return (
    <form
      ref={formRef}
      action={reportCat}
      onSubmit={onSubmit}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="colony_id" value={colonyId} />
      <input type="hidden" name="sex" value={sex === "unknown" ? "" : sex} />
      <input type="hidden" name="neutered" value={neutered} />
      <input type="hidden" name="photo_key" value={photoKey} />

      <p className="text-sm text-muted">
        Spotted a cat that isn’t on the list? Give it a name or a quick
        description — that’s all you need. A caretaker will review it.
      </p>

      {/* ── Identifier (name OR description) ── */}
      {idError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          Add a name or a short description so the cat can be identified.
        </p>
      ) : null}
      <div
        className={`flex flex-col gap-4 ${
          idError
            ? "rounded-xl outline outline-2 outline-offset-4 outline-red-600"
            : ""
        }`}
      >
        <label className={fieldLabel}>
          <span>
            Name{" "}
            <span className="font-normal text-muted">
              (or description below)
            </span>
          </span>
          <input
            ref={nameRef}
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (idError) setIdError(false);
            }}
            placeholder="e.g. Smudge"
            aria-invalid={idError}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>
            Description{" "}
            <span className="font-normal text-muted">(if it has no name)</span>
          </span>
          <input
            name="temp_id"
            value={tempId}
            onChange={(e) => {
              setTempId(e.target.value);
              if (idError) setIdError(false);
            }}
            placeholder="e.g. black & white by the wall"
            aria-invalid={idError}
            className={input}
          />
        </label>
      </div>

      {/* ── Colour (optional) ── */}
      <label className={fieldLabel}>
        <span>
          Colour / markings{" "}
          <span className="font-normal text-muted">(optional)</span>
        </span>
        <input
          name="colour"
          placeholder="e.g. tabby, white paws"
          className={input}
        />
      </label>

      {/* ── Sex (tri-state) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="sex-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Sex
        </h2>
        <Segmented
          legendId="sex-label"
          value={sex}
          onChange={setSex}
          options={[
            { key: "unknown", label: "Unknown" },
            { key: "male", label: "Male" },
            { key: "female", label: "Female" },
          ]}
        />
      </section>

      {/* ── Neutered (tri-state) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="neutered-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Neutered?
        </h2>
        <Segmented
          legendId="neutered-label"
          value={neutered}
          onChange={setNeutered}
          options={[
            { key: "unknown", label: "Unknown" },
            { key: "yes", label: "Yes" },
            { key: "no", label: "No" },
          ]}
        />
      </section>

      {/* ── Notes (optional) ── */}
      <label className={fieldLabel}>
        <span>
          Notes <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          placeholder="Anything useful — limping, friendly, kitten…"
          className={`${input} py-2`}
        />
      </label>

      {/* ── Photo (optional, non-blocking) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Photo{" "}
          <span className="font-normal normal-case text-muted">(optional)</span>
        </h2>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreview}
                alt="New cat photo"
                className="h-full w-full object-cover"
              />
            ) : (
              <PawIcon className="h-6 w-6 text-muted" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
                className={`${btnGhost} h-9 px-3 text-sm disabled:opacity-60`}
              >
                {photoBusy
                  ? "Working…"
                  : photoPreview
                    ? "Replace photo"
                    : "Add photo"}
              </button>
              {photoPreview && !photoBusy ? (
                <button
                  type="button"
                  onClick={removePhoto}
                  className={`${btnGhostDanger} h-9 px-3 text-sm`}
                >
                  Remove
                </button>
              ) : null}
            </div>
            {photoError ? (
              <p className="text-xs text-red-700 dark:text-red-300">
                {photoError}
              </p>
            ) : (
              <p className="text-xs text-muted">JPG/PNG/WebP · optional.</p>
            )}
          </div>
        </div>
      </section>

      <SubmitButton
        pendingText="Reporting…"
        className={`${btnPrimary} sticky bottom-4 min-h-13`}
      >
        Report cat
      </SubmitButton>
    </form>
  );
}

// Downscale + JPEG-compress in the browser so field uploads are small.
// Mirrors components/incident-form.tsx (kept local to avoid exporting it).
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
