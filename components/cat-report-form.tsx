"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PawIcon } from "@/components/icons";
import { hasReportIdentifier } from "@/lib/cat-report";
import { enqueue } from "@/lib/offline/outbox";
import { getStore, isDefinitelyOffline } from "@/lib/offline/client";
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
  const t = useTranslations("cats");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [tempId, setTempId] = useState("");
  const [sex, setSex] = useState("unknown");
  const [neutered, setNeutered] = useState("unknown");
  const [idError, setIdError] = useState(false);
  // Drives the submit button's pending state and an inline submit error,
  // replacing useFormStatus now that we POST via fetch instead of a <form
  // action>. Preserves the exact same disabled-while-submitting behaviour.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Photo state mirrors incident-form.tsx: presign → PUT to R2, then stash the
  // returned key in a hidden field so the action stores it on the cat. A failed
  // upload never blocks the report (non-blocking requirement).
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoKey, setPhotoKey] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Mirrors the incident photo=failed contract: when an upload fails the form
  // still submits (non-blocking), carrying photo_failed="1" so the action can
  // append &photo=failed and the colony page shows the soft warning.
  const [photoFailed, setPhotoFailed] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Client-side first (no round-trip); the route re-validates server-side.
    if (!hasReportIdentifier({ name, temp_id: tempId })) {
      setIdError(true);
      nameRef.current?.focus();
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const form = e.currentTarget;
    const colour =
      (form.elements.namedItem("colour") as HTMLInputElement)?.value?.trim() ||
      null;
    const notes =
      (
        form.elements.namedItem("notes") as HTMLTextAreaElement
      )?.value?.trim() || null;

    // Phase 1 transport: a client UUID becomes the new cat's PK so a replay is
    // idempotent (the route upserts onConflict:"id"). The photo presign→PUT
    // already ran on pick (online-only, unchanged); we just pass the key here.
    const body = {
      id: crypto.randomUUID(),
      colonyId,
      name: name.trim() || null,
      tempId: tempId.trim() || null,
      colour,
      sex: sex === "unknown" ? null : sex,
      neutered,
      notes,
      photoKey: photoKey || null,
      photoFailed,
    };

    // Phase 2 offline-first: if the browser KNOWS it's offline, queue without
    // hitting the network. A queued report carries no photo (presign needs the
    // network), which the form already tolerates; the client UUID PK makes the
    // later replay idempotent.
    if (isDefinitelyOffline()) {
      if (await queueOffline(body)) {
        router.push(`/app/colonies/${colonyId}?reported=cat`);
        router.refresh();
        return;
      }
      setSubmitError(t("submitFailed"));
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/cats/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        photoFailed?: boolean;
      };
      if (!res.ok || !json.ok) {
        // Real server rejection → surface as before, NOT queued.
        setSubmitError(json.error || t("submitFailed"));
        setSubmitting(false);
        return;
      }
      // Same destination + ?reported=cat the server action used, preserving the
      // non-blocking &photo=failed contract when the photo couldn't be saved.
      const photoParam = json.photoFailed ? "&photo=failed" : "";
      router.push(`/app/colonies/${colonyId}?reported=cat${photoParam}`);
      router.refresh();
    } catch {
      // Network failure mid-submit → queue + proceed.
      if (await queueOffline(body)) {
        router.push(`/app/colonies/${colonyId}?reported=cat`);
        router.refresh();
        return;
      }
      setSubmitError(t("submitFailed"));
      setSubmitting(false);
    }
  }

  // Enqueue the cat report to the offline outbox; false only if no queue exists
  // (no IndexedDB) or the write failed, so the caller can surface an error rather
  // than silently dropping the report.
  async function queueOffline(body: unknown): Promise<boolean> {
    const store = getStore();
    if (!store) return false;
    try {
      await enqueue(store, {
        localId: (body as { id: string }).id,
        kind: "cat_report",
        url: "/api/cats/report",
        body,
        createdAt: Date.now(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError(t("notAnImage"));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoError(t("imageTooLarge"));
      return;
    }
    setPhotoError(null);
    setPhotoFailed(false);
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
      setPhotoFailed(false);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t("uploadFailed"));
      // Non-blocking: let the report submit and surface the soft photo warning.
      setPhotoFailed(true);
    } finally {
      setPhotoBusy(false);
    }
  }

  function removePhoto() {
    setPhotoKey("");
    setPhotoPreview(null);
    setPhotoError(null);
    setPhotoFailed(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* sex/neutered/photo are read from component state in onSubmit now, so no
          hidden mirror fields are needed (the form POSTs JSON via fetch). */}

      <p className="text-sm text-muted">{t("reportLede")}</p>

      {submitError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {submitError}
        </p>
      ) : null}

      {/* ── Identifier (name OR description) ── */}
      {idError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {t("idErrorAlert")}
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
            {t("name")}{" "}
            <span className="font-normal text-muted">
              {t("nameOrDescription")}
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
            placeholder={t("namePlaceholder")}
            aria-invalid={idError}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>
            {t("description")}{" "}
            <span className="font-normal text-muted">
              {t("descriptionIfNoName")}
            </span>
          </span>
          <input
            name="temp_id"
            value={tempId}
            onChange={(e) => {
              setTempId(e.target.value);
              if (idError) setIdError(false);
            }}
            placeholder={t("descriptionPlaceholder")}
            aria-invalid={idError}
            className={input}
          />
        </label>
      </div>

      {/* ── Colour (optional) ── */}
      <label className={fieldLabel}>
        <span>
          {t("colourMarkings")}{" "}
          <span className="font-normal text-muted">({t("optional")})</span>
        </span>
        <input
          name="colour"
          placeholder={t("colourPlaceholder")}
          className={input}
        />
      </label>

      {/* ── Sex (tri-state) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="sex-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t("sex")}
        </h2>
        <Segmented
          legendId="sex-label"
          value={sex}
          onChange={setSex}
          options={[
            { key: "unknown", label: t("sexUnknown") },
            { key: "male", label: t("sexMale") },
            { key: "female", label: t("sexFemale") },
          ]}
        />
      </section>

      {/* ── Neutered (tri-state) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="neutered-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t("neutered")}
        </h2>
        <Segmented
          legendId="neutered-label"
          value={neutered}
          onChange={setNeutered}
          options={[
            { key: "unknown", label: t("neuteredUnknown") },
            { key: "yes", label: t("neuteredYes") },
            { key: "no", label: t("neuteredNo") },
          ]}
        />
      </section>

      {/* ── Notes (optional) ── */}
      <label className={fieldLabel}>
        <span>
          {t("notes")}{" "}
          <span className="font-normal text-muted">({t("optional")})</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          placeholder={t("notesPlaceholder")}
          className={`${input} py-2`}
        />
      </label>

      {/* ── Photo (optional, non-blocking) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("photo")}{" "}
          <span className="font-normal normal-case text-muted">
            ({t("optional")})
          </span>
        </h2>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreview}
                alt={t("newCatPhotoAlt")}
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
                  ? t("working")
                  : photoPreview
                    ? t("replacePhoto")
                    : t("addPhoto")}
              </button>
              {photoPreview && !photoBusy ? (
                <button
                  type="button"
                  onClick={removePhoto}
                  className={`${btnGhostDanger} h-9 px-3 text-sm`}
                >
                  {t("remove")}
                </button>
              ) : null}
            </div>
            {photoError ? (
              <p className="text-xs text-red-700 dark:text-red-300">
                {photoError}
              </p>
            ) : (
              <p className="text-xs text-muted">{t("photoHint")}</p>
            )}
          </div>
        </div>
      </section>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className={`${btnPrimary} sticky bottom-4 min-h-13 disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {submitting ? t("reporting") : t("reportCat")}
      </button>
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
