"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IncidentTypeIcon, PawIcon, WarningIcon } from "@/components/icons";
import { INCIDENT_TYPES, type IncidentType } from "@/lib/incident";
import { enqueue } from "@/lib/offline/outbox";
import { getStore, isDefinitelyOffline } from "@/lib/offline/client";
import { btnGhost, btnGhostDanger, btnPrimary, input } from "@/lib/ui";

type Cat = { id: string; name: string | null; temp_id: string | null };
type UrgencyLevel = {
  id: string;
  label: string;
  alerts_immediately: boolean;
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
  label,
  checked,
  onSelect,
  full,
}: {
  type: IncidentType;
  label: string;
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
      <span className="flex-1">{label}</span>
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
  const t = useTranslations("incidents");
  const tType = useTranslations("incidents.type");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const typeGroupRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<IncidentType | "">("");
  const [urgencyId, setUrgencyId] = useState<string>(defaultUrgencyId ?? "");
  const [catId, setCatId] = useState<string>(""); // "" = no specific cat
  const [typeError, setTypeError] = useState(false);
  // Drives the submit button's pending state and an inline submit error,
  // replacing useFormStatus now that we POST via fetch. Same disabled-while-
  // submitting behaviour as before.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!type) {
      setTypeError(true);
      typeGroupRef.current
        ?.querySelector<HTMLButtonElement>('[role="radio"]')
        ?.focus();
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    // Capture the field time NOW, at the tap — before the offline/online branch
    // — so a queued offline report keeps when it actually occurred after syncing
    // later (the server would otherwise stamp occurred_at at sync time).
    const occurredAt = new Date().toISOString();

    const form = e.currentTarget;
    const notes =
      (
        form.elements.namedItem("notes") as HTMLTextAreaElement
      )?.value?.trim() || null;

    // Phase 1 transport: a client UUID becomes the incident's PK so a replay is
    // idempotent (the route upserts onConflict:"id"). Urgency/cat are re-resolved
    // and re-validated server-side; the photo presign→PUT already ran on pick
    // (online-only, unchanged) and we just pass the key.
    const body = {
      id: crypto.randomUUID(),
      colonyId,
      occurredAt,
      type,
      urgencyLevelId: urgencyId || null,
      catId: catId || null,
      notes,
      photoKey: photoKey || null,
    };

    // Phase 2 offline-first: if the browser KNOWS it's offline, queue without
    // hitting the network. A queued report carries no photo (presign needs the
    // network), which the form already tolerates; the client UUID PK makes the
    // later replay idempotent. We use the locally-known `urgent` for the
    // destination since the server's resolved value isn't available offline.
    if (isDefinitelyOffline()) {
      if (await queueOffline(body)) {
        router.push(
          `/app/colonies/${colonyId}?reported=${urgent ? "urgent" : "1"}`,
        );
        router.refresh();
        return;
      }
      setSubmitError(t("form.submitFailed"));
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        urgent?: boolean;
        photoFailed?: boolean;
      };
      if (!res.ok || !json.ok) {
        // Real server rejection → surface as before, NOT queued.
        setSubmitError(json.error || t("form.submitFailed"));
        setSubmitting(false);
        return;
      }
      // Same success navigation the server action built: ?reported carries the
      // urgency so the colony page says "Flagged as urgent…" vs the routine copy,
      // preserving the non-blocking &photo=failed contract.
      const params = new URLSearchParams({
        reported: json.urgent ? "urgent" : "1",
      });
      if (json.photoFailed) params.set("photo", "failed");
      router.push(`/app/colonies/${colonyId}?${params.toString()}`);
      router.refresh();
    } catch {
      // Network failure mid-submit → queue + proceed.
      if (await queueOffline(body)) {
        router.push(
          `/app/colonies/${colonyId}?reported=${urgent ? "urgent" : "1"}`,
        );
        router.refresh();
        return;
      }
      setSubmitError(t("form.submitFailed"));
      setSubmitting(false);
    }
  }

  // Enqueue the incident to the offline outbox; false only if no queue exists
  // (no IndexedDB) or the write failed, so the caller can surface an error rather
  // than silently dropping the report.
  async function queueOffline(body: unknown): Promise<boolean> {
    const store = getStore();
    if (!store) return false;
    try {
      await enqueue(store, {
        localId: (body as { id: string }).id,
        kind: "incident",
        url: "/api/incidents",
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
      setPhotoError(t("form.notAnImage"));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoError(t("form.imageTooLarge"));
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
      setPhotoError(
        err instanceof Error ? err.message : t("form.uploadFailed"),
      );
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
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* type/urgency/cat/photo are read from component state in onSubmit now,
          so no hidden mirror fields are needed (the form POSTs JSON via fetch). */}
      {submitError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {submitError}
        </p>
      ) : null}

      {/* ── Type (required) ── */}
      <section className="flex flex-col gap-2">
        <h2
          id="type-label"
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t("form.whatsHappening")} <span className="text-red-600">*</span>
        </h2>
        {typeError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/60 dark:text-red-300"
          >
            {t("form.chooseType")}
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
            <WarningIcon className="h-3.5 w-3.5" aria-hidden />{" "}
            {t("form.urgentDanger")}
          </p>
          {DANGER_TYPES.map((dt) => (
            <TypeTile
              key={dt}
              type={dt}
              label={tType(dt)}
              checked={type === dt}
              onSelect={() => {
                setType(dt);
                setTypeError(false);
              }}
            />
          ))}
          <p className="col-span-2 mt-1 text-[0.65rem] font-bold uppercase tracking-wide text-muted">
            {t("form.reports")}
          </p>
          {REPORT_TYPES.map((rt) => (
            <TypeTile
              key={rt}
              type={rt}
              label={tType(rt)}
              checked={type === rt}
              full={rt === "other"}
              onSelect={() => {
                setType(rt);
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
            {t("form.urgency")}
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
                    on
                      ? `${onClass} font-semibold`
                      : "border-border text-foreground"
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
            {urgent ? t("form.urgentFlagged") : t("form.urgencyHint")}
          </p>
        </section>
      ) : null}

      {/* ── Cat (optional) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("form.whichCat")}{" "}
          <span className="font-normal normal-case text-muted">
            ({t("form.optional")})
          </span>
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
              <span className="flex-1 text-sm font-medium">
                {t("form.noSpecificCat")}
              </span>
              {catId === "" ? (
                <span aria-hidden className="text-accent">
                  ✓
                </span>
              ) : null}
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
                    on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface">
                    <PawIcon className="h-5 w-5 text-muted" />
                  </span>
                  <span className="flex-1 text-sm font-medium">
                    {c.name ?? c.temp_id ?? t("form.unnamedCat")}
                  </span>
                  {on ? (
                    <span aria-hidden className="text-accent">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Notes (optional) ── */}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        <span>{t("form.notesOptional")}</span>
        <textarea name="notes" rows={2} className={`${input} py-2`} />
      </label>

      {/* ── Photo (optional, non-blocking) ── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("form.photo")}{" "}
          <span className="font-normal normal-case text-muted">
            ({t("form.optional")})
          </span>
        </h2>
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoPreview}
                alt={t("form.incidentPhotoAlt")}
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
                  ? t("form.working")
                  : photoPreview
                    ? t("form.replacePhoto")
                    : t("form.addPhoto")}
              </button>
              {photoPreview && !photoBusy ? (
                <button
                  type="button"
                  onClick={removePhoto}
                  className={`${btnGhostDanger} h-9 px-3 text-sm`}
                >
                  {t("form.remove")}
                </button>
              ) : null}
            </div>
            {photoError ? (
              <p className="text-xs text-red-700 dark:text-red-300">
                {photoError}
              </p>
            ) : (
              <p className="text-xs text-muted">{t("form.photoHint")}</p>
            )}
          </div>
        </div>
      </section>

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className={`sticky bottom-4 min-h-13 ${
          urgent ? "bg-red-600 text-white hover:bg-red-700" : btnPrimary
        } inline-flex items-center justify-center gap-2 rounded-lg px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {submitting ? (
          t("form.reporting")
        ) : urgent ? (
          <>
            <WarningIcon className="h-4 w-4" aria-hidden />{" "}
            {t("form.reportUrgent")}
          </>
        ) : (
          t("form.reportIncident")
        )}
      </button>
    </form>
  );
}

// Downscale + JPEG-compress in the browser so field uploads are small.
// Mirrors components/image-upload.tsx (kept local to avoid exporting it).
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
