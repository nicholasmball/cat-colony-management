"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createIncident } from "@/app/app/colonies/[id]/incidents/actions";
import { IncidentTypeIcon, PawIcon, WarningIcon } from "@/components/icons";
import { INCIDENT_TYPES, type IncidentType } from "@/lib/incident";
import { btnGhost, btnGhostDanger, btnPrimary, input } from "@/lib/ui";

type Cat = { id: string; name: string | null; temp_id: string | null };
type UrgencyLevel = {
  id: string;
  label: string;
  alerts_immediately: boolean;
};

// Labels for each enum member. Order/grouping below floats the time-critical
// types first (Hick's Law — design §2); the enum strings are the REAL
// public.incident_type values, NOT the design doc's placeholder strings.
const TYPE_LABEL: Record<IncidentType, string> = {
  poisoning: "Poisoning",
  sick_injured: "Sick / injured",
  dog_danger: "Dog danger",
  threat_person: "Threat from person",
  new_cat: "New cat",
  missing_concern: "Missing concern",
  dead_cat: "Dead cat",
  access_problem: "Feeding / access",
  other: "Other",
};

const DANGER_TYPES: IncidentType[] = [
  "poisoning",
  "sick_injured",
  "dog_danger",
  "threat_person",
];
const REPORT_TYPES: IncidentType[] = INCIDENT_TYPES.filter(
  (t) => !DANGER_TYPES.includes(t),
);

function TypeTile({
  type,
  checked,
  onSelect,
  full,
}: {
  type: IncidentType;
  checked: boolean;
  onSelect: () => void;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
        full ? "col-span-2" : ""
      } ${
        checked
          ? "border-accent bg-accent/10 text-accent"
          : "border-border text-foreground"
      }`}
    >
      <IncidentTypeIcon type={type} className="h-5 w-5 shrink-0" />
      <span className="flex-1">{TYPE_LABEL[type]}</span>
      {checked ? <span aria-hidden>✓</span> : null}
    </button>
  );
}

export function IncidentForm({
  colonyId,
  cats,
  urgencyLevels,
  defaultUrgencyId,
}: {
  colonyId: string;
  cats: Cat[];
  urgencyLevels: UrgencyLevel[];
  defaultUrgencyId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const typeGroupRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<IncidentType | "">("");
  const [urgencyId, setUrgencyId] = useState<string>(defaultUrgencyId ?? "");
  const [catId, setCatId] = useState<string>(""); // "" = no specific cat
  const [typeError, setTypeError] = useState(false);

  // Photo state mirrors image-upload.tsx: presign → PUT to R2, then stash the
  // returned key in a hidden field so the action attaches it after the incident
  // saves. A failed upload never blocks the report (non-blocking requirement).
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoKey, setPhotoKey] = useState<string>("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const urgent =
    urgencyLevels.find((l) => l.id === urgencyId)?.alerts_immediately ?? false;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!type) {
      e.preventDefault();
      setTypeError(true);
      typeGroupRef.current
        ?.querySelector<HTMLButtonElement>('[role="radio"]')
        ?.focus();
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
          entityType: "incident",
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
    // Best-effort: just forget the key locally. The orphaned object (if any)
    // is harmless and the incident is unaffected.
    setPhotoKey("");
    setPhotoPreview(null);
    setPhotoError(null);
  }

  return (
    <form
      ref={formRef}
      action={createIncident}
      onSubmit={onSubmit}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="colony_id" value={colonyId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="urgency_level_id" value={urgencyId} />
      <input type="hidden" name="cat_id" value={catId} />
      <input type="hidden" name="photo_key" value={photoKey} />

      {/* ── Type (required) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="type-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          What’s happening? <span className="text-red-600">*</span>
        </h2>
        {typeError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            Choose what’s happening before you report.
          </p>
        ) : null}
        <div
          ref={typeGroupRef}
          role="radiogroup"
          aria-labelledby="type-label"
          aria-required="true"
          aria-invalid={typeError}
          className={`grid grid-cols-2 gap-2 ${
            typeError
              ? "rounded-xl outline outline-2 outline-offset-4 outline-red-600"
              : ""
          }`}
        >
          <p className="col-span-2 mt-1 flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-red-600">
            <WarningIcon className="h-3.5 w-3.5" aria-hidden /> Urgent / danger
          </p>
          {DANGER_TYPES.map((t) => (
            <TypeTile
              key={t}
              type={t}
              checked={type === t}
              onSelect={() => {
                setType(t);
                setTypeError(false);
              }}
            />
          ))}
          <p className="col-span-2 mt-1 text-[0.65rem] font-bold uppercase tracking-wide text-muted">
            Reports
          </p>
          {REPORT_TYPES.map((t) => (
            <TypeTile
              key={t}
              type={t}
              checked={type === t}
              full={t === "other"}
              onSelect={() => {
                setType(t);
                setTypeError(false);
              }}
            />
          ))}
        </div>
      </section>

      {/* ── Urgency (defaulted) ── */}
      {urgencyLevels.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2
            id="urgency-label"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Urgency
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="urgency-label"
            className="grid grid-cols-2 gap-2"
          >
            {urgencyLevels.map((l) => {
              const on = urgencyId === l.id;
              const onClass = l.alerts_immediately
                ? "border-red-600 bg-red-600 text-white"
                : "border-foreground bg-foreground text-background";
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setUrgencyId(l.id)}
                  className={`flex min-h-12 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                    on ? `${onClass} font-semibold` : "border-border text-foreground"
                  }`}
                >
                  {l.alerts_immediately ? (
                    <WarningIcon className="h-4 w-4" aria-hidden />
                  ) : on ? (
                    <span aria-hidden>✓</span>
                  ) : null}
                  {l.label}
                </button>
              );
            })}
          </div>
          <p
            className={`text-xs ${urgent ? "font-semibold text-red-600" : "text-muted"}`}
            role="status"
          >
            {urgent
              ? "Flagged as urgent for caretakers."
              : "Defaults to your org’s ‘Not urgent’. Tap Urgent to flag it for caretakers."}
          </p>
        </section>
      ) : null}

      {/* ── Cat (optional) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Which cat? <span className="font-normal normal-case text-muted">(optional)</span>
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            <button
              type="button"
              role="radio"
              aria-checked={catId === ""}
              onClick={() => setCatId("")}
              className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                catId === ""
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface"
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted">
                —
              </span>
              <span className="flex-1 text-sm font-medium">No specific cat</span>
              {catId === "" ? <span aria-hidden className="text-accent">✓</span> : null}
            </button>
          </li>
          {cats.map((c) => {
            const on = catId === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCatId(c.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                    on ? "border-accent bg-accent/10" : "border-border bg-surface"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface">
                    <PawIcon className="h-5 w-5 text-muted" />
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {c.name ?? c.temp_id ?? "Unnamed cat"}
                  </span>
                  {on ? <span aria-hidden className="text-accent">✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Notes (optional) ── */}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>Notes (optional)</span>
        <textarea name="notes" rows={2} className={`${input} py-2`} />
      </label>

      {/* ── Photo (optional, non-blocking) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Photo <span className="font-normal normal-case text-muted">(optional)</span>
        </h2>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreview}
                alt="Incident photo"
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
        className={`sticky bottom-4 min-h-13 ${
          urgent ? "bg-red-600 text-white hover:bg-red-700" : btnPrimary
        } inline-flex items-center justify-center gap-2 rounded-lg px-4 font-semibold`}
      >
        {urgent ? (
          <>
            <WarningIcon className="h-4 w-4" aria-hidden /> Report urgent incident
          </>
        ) : (
          "Report incident"
        )}
      </SubmitButton>
    </form>
  );
}

// Downscale + JPEG-compress in the browser so field uploads are small.
// Mirrors components/image-upload.tsx (kept local to avoid exporting it).
async function resizeToJpeg(file: File, max = 1600, quality = 0.82): Promise<Blob> {
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
      (b) => (b ? resolve(b) : reject(new Error("Couldn’t process the image."))),
      "image/jpeg",
      quality,
    ),
  );
}
