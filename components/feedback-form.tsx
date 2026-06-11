"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { submitFeedback } from "@/app/app/feedback/actions";
import { FEEDBACK_KINDS, FEEDBACK_MESSAGE_MAX } from "@/lib/feedback";
import type { FeedbackKind } from "@/lib/feedback";
import { btnGhost, btnGhostDanger, btnPrimary, card, input } from "@/lib/ui";

// Decorative glyphs kept as JS constants (the lint rule disallows bare string
// literals inside JSX). All are aria-hidden — the visible word carries meaning.
const CAMERA_GLYPH = "📷";
const KIND_GLYPH: Record<FeedbackKind, string> = { bug: "🐞", idea: "💡" };

// Downscale + JPEG-compress in the browser so screenshot uploads are small.
// Same routine as image-upload.tsx (kept local — that copy is cat-specific).
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
  if (!ctx) throw new Error("image");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("image"))),
      "image/jpeg",
      quality,
    ),
  );
}

export function FeedbackForm() {
  const t = useTranslations("feedback");
  const fileRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const kindLabelId = useId();
  const messageErrId = useId();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  // Screenshot state: the resolved R2 key + a local object-URL preview, plus
  // the mid-flight / failed flags. An optional field never blocks the report.
  const [screenshotKey, setScreenshotKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onPickScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError(t("errorNotImage"));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError(t("errorTooLarge"));
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const blob = await resizeToJpeg(file);
      const res = await fetch("/api/photos/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "feedback",
          contentType: "image/jpeg",
        }),
      });
      if (!res.ok) throw new Error("upload");
      const { uploadUrl, key } = (await res.json()) as {
        uploadUrl: string;
        key: string;
      };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!put.ok) throw new Error("upload");

      // Replace any previous preview's object URL.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setScreenshotKey(key);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      // Drop the image; the message still submits without a screenshot.
      setUploadError(t("errorUpload"));
      setScreenshotKey(null);
    } finally {
      setUploading(false);
    }
  }

  function removeScreenshot() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setScreenshotKey(null);
    setUploadError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || uploading) return;

    const trimmed = message.trim();
    if (!trimmed) {
      setMessageError(true);
      messageRef.current?.focus();
      return;
    }
    setMessageError(false);
    setSubmitError(null);
    setSubmitting(true);

    // Honest page context: where the tester came from before opening Feedback.
    const pageUrl =
      typeof document !== "undefined" && document.referrer
        ? document.referrer
        : null;

    try {
      const result = await submitFeedback({
        kind,
        message: trimmed,
        pageUrl,
        screenshotKey,
      });
      if ("error" in result) {
        setSubmitError(result.error);
        setSubmitting(false);
        return;
      }
      setDone(true);
      // Move focus to the success panel so SR users hear the confirmation.
      requestAnimationFrame(() => successRef.current?.focus());
    } catch {
      setSubmitError(t("errorSubmit"));
      setSubmitting(false);
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setKind("bug");
    setMessage("");
    setMessageError(false);
    setScreenshotKey(null);
    setPreviewUrl(null);
    setUploadError(null);
    setSubmitError(null);
    setSubmitting(false);
    setDone(false);
  }

  if (done) {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        role="status"
        className={`${card} flex flex-col gap-3 p-5 text-center outline-none`}
      >
        <p className="text-base font-semibold text-foreground">
          {t("successTitle")}
        </p>
        <p className="text-sm text-muted">{t("successBody")}</p>
        <button
          type="button"
          onClick={reset}
          className={`${btnGhost} mt-1 w-full`}
        >
          {t("sendMore")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {submitError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {submitError}
        </p>
      ) : null}

      {/* Kind toggle — segmented radio group (glyph + word, never colour-alone) */}
      <fieldset className="flex flex-col gap-2">
        <legend id={kindLabelId} className="text-sm font-medium">
          {t("kindLabel")}
        </legend>
        <div
          role="radiogroup"
          aria-labelledby={kindLabelId}
          className="grid grid-cols-2 gap-2"
        >
          {FEEDBACK_KINDS.map((k) => {
            const on = kind === k;
            const label = k === "bug" ? t("kindBug") : t("kindIdea");
            const glyph = KIND_GLYPH[k];
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k)}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                  on
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface text-foreground hover:bg-foreground/5"
                }`}
              >
                <span aria-hidden>{glyph}</span>
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Message — required, soft 2000-char counter */}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t("messageLabel")}
        <textarea
          ref={messageRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (messageError) setMessageError(false);
          }}
          rows={5}
          placeholder={t("messagePlaceholder")}
          aria-invalid={messageError || undefined}
          aria-describedby={messageError ? messageErrId : undefined}
          className={`${input} py-2 ${messageError ? "border-red-500 focus:border-red-500 focus:ring-red-500/25" : ""}`}
        />
      </label>
      <p className="-mt-3.5 text-right text-xs text-muted">
        {t("charCount", { count: message.length, max: FEEDBACK_MESSAGE_MAX })}
      </p>
      {messageError ? (
        <p
          id={messageErrId}
          role="alert"
          className="-mt-3.5 text-sm text-red-700 dark:text-red-300"
        >
          {t("errorEmpty")}
        </p>
      ) : null}

      {/* Screenshot — optional, presigned feedback PUT + preview/remove */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("screenshotLabel")}</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label={t("addScreenshot")}
          onChange={onPickScreenshot}
          className="hidden"
        />
        {uploading ? (
          <p aria-live="polite" className="text-sm text-muted">
            {t("uploading")}
          </p>
        ) : previewUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={t("screenshotAlt")}
              className="h-20 w-20 rounded-lg border border-border object-cover"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`${btnGhost} h-9 px-3 text-sm`}
              >
                {t("replaceScreenshot")}
              </button>
              <button
                type="button"
                aria-label={t("removeScreenshot")}
                onClick={removeScreenshot}
                className={`${btnGhostDanger} h-9 px-3 text-sm`}
              >
                {t("removeScreenshot")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`${btnGhost} h-10 gap-2 self-start px-3 text-sm`}
          >
            <span aria-hidden>{CAMERA_GLYPH}</span>
            {t("addScreenshot")}
          </button>
        )}
        {uploadError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {uploadError}
          </p>
        ) : null}
      </div>

      <p className="text-xs text-muted">{t("autoContext")}</p>
      <p className="text-xs text-muted">{t("privacy")}</p>

      <button
        type="submit"
        disabled={submitting || uploading}
        aria-busy={submitting || undefined}
        className={`${btnPrimary} min-h-13`}
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
