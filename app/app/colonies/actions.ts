"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { deleteObject } from "@/lib/storage/r2";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import { isKeyInOrg } from "@/lib/photo-key";
import { parseNeutered } from "@/lib/cat-report";
import { planConcernSightingAlert } from "@/lib/alert-engine";
import { alertRecipients } from "@/lib/alert-recipients";
import { persistAlerts } from "@/lib/alert-persist";

type PhotoResult = { ok: true } | { error: string };

// Save the uploaded photo's object key onto the cat (after the browser has
// PUT it to R2). Manager-only; old object is deleted best-effort.
export async function setCatPhoto(
  catId: string,
  key: string,
): Promise<PhotoResult> {
  const t = await getTranslations("errors");
  const org = await getActiveOrg();
  if (!org || (org.role !== "admin" && org.role !== "caretaker")) {
    return { error: t("notAllowed") };
  }
  // The key is client-supplied; only accept one minted under this org's prefix
  // (`org/{orgId}/…`) so a tampered key can't point the record at another org's
  // object. The presign route always issues org-scoped keys.
  if (!isKeyInOrg(key, org.organisation_id)) {
    return { error: t("photoCouldNotBeSaved") };
  }
  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("cats")
    .select("id, colony_id, photo_url")
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) return { error: t("catNotFound") };

  const previous = cat.photo_url as string | null;
  // .select("id") + isFailedWrite: an RLS-filtered 0-row update would otherwise
  // report success while nothing changed. Org-scoped as defence-in-depth.
  const { data, error } = await supabase
    .from("cats")
    .update({ photo_url: key })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    return {
      error: writeErrorMessage({ error, rows: data }, t("catNoLongerExists")),
    };
  }

  if (previous && previous !== key) await deleteObject(previous);
  revalidatePath(`/app/colonies/${cat.colony_id}`);
  revalidatePath(`/app/colonies/${cat.colony_id}/cats/${catId}/edit`);
  return { ok: true };
}

export async function removeCatPhoto(catId: string): Promise<PhotoResult> {
  const t = await getTranslations("errors");
  const org = await getActiveOrg();
  if (!org || (org.role !== "admin" && org.role !== "caretaker")) {
    return { error: t("notAllowed") };
  }
  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("cats")
    .select("id, colony_id, photo_url")
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();
  if (!cat) return { error: t("catNotFound") };

  const previous = cat.photo_url as string | null;
  // .select("id") + isFailedWrite: an RLS-filtered 0-row update would otherwise
  // report success while nothing changed. Org-scoped as defence-in-depth.
  const { data, error } = await supabase
    .from("cats")
    .update({ photo_url: null })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    return {
      error: writeErrorMessage({ error, rows: data }, t("catNoLongerExists")),
    };
  }

  if (previous) await deleteObject(previous);
  revalidatePath(`/app/colonies/${cat.colony_id}`);
  revalidatePath(`/app/colonies/${cat.colony_id}/cats/${catId}/edit`);
  return { ok: true };
}

export async function createColony(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("feeding_window_start") ?? "") || null;
  const end = String(formData.get("feeding_window_end") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("colonies").insert({
    organisation_id: org.organisation_id,
    name,
    feeding_window_start: start,
    feeding_window_end: end,
    notes,
  });

  if (error) {
    redirect(`/app/colonies/new?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/colonies");
  redirect("/app/colonies");
}

export async function updateColony(formData: FormData) {
  const id = String(formData.get("id"));
  // Manager-only trust boundary in app code — the UI hides this but the server
  // must not trust that. (Previously this had no gate and relied on RLS.)
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect("/app/colonies");
  }

  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("feeding_window_start") ?? "") || null;
  const end = String(formData.get("feeding_window_end") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const isActive = formData.get("is_active") === "on";

  // Write through the service-role client (RLS bypassed) scoped to id + the
  // server-trusted org, mirroring archiveColony: in the server-action write
  // context the RLS-bound client's auth.uid() is not reliably present, so the
  // manager UPDATE policy filtered the row out and the edit was a silent 0-row
  // no-op. .select() + isFailedWrite turns 0 rows into a surfaced error.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("colonies")
    .update({
      name,
      feeding_window_start: start,
      feeding_window_end: end,
      notes,
      is_active: isActive,
    })
    .eq("id", id)
    .eq("organisation_id", org.organisation_id)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    const t = await getTranslations("errors");
    const message = writeErrorMessage(
      { error, rows: data },
      t("colonyNoLongerExists"),
    );
    redirect(`/app/colonies/${id}/edit?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/app/colonies/${id}`);
  revalidatePath("/app/colonies");
  redirect(`/app/colonies/${id}`);
}

export async function archiveColony(formData: FormData) {
  const id = String(formData.get("id"));
  // Manager-only trust boundary in app code — the UI hides this but the server
  // must not trust that. (Previously this relied solely on RLS.)
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect("/app/colonies");
  }

  // Soft-delete through the service-role client (RLS bypassed) scoped to id +
  // org, mirroring deleteSchedule: in the server-action write context the
  // RLS-bound client's auth.uid() is not reliably present, so the manager
  // UPDATE policy filtered the row out and the archive was a silent 0-row
  // no-op. .select() + isFailedWrite turns 0 rows into a surfaced error.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("colonies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", org.organisation_id)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    const t = await getTranslations("errors");
    const message = writeErrorMessage(
      { error, rows: data },
      t("colonyNoLongerExists"),
    );
    redirect(`/app/colonies/${id}/edit?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/app/colonies");
  redirect("/app/colonies");
}

export async function createCat(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const t = await getTranslations("errors");
  const name = String(formData.get("name") ?? "").trim() || null;
  const tempId = String(formData.get("temp_id") ?? "").trim() || null;
  // Schema requires a name OR a temp id — never block on the rest.
  if (!name && !tempId) {
    redirect(
      `/app/colonies/${colonyId}/cats/new?error=${encodeURIComponent(
        t("nameOrDescription"),
      )}`,
    );
  }
  const colour = String(formData.get("colour") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();

  // Cross-org write integrity: the route-param colony_id is attacker-controlled
  // and RLS ("insert cats") only checks org membership + status — there is no DB
  // constraint tying cats.colony_id to cats.organisation_id. Re-validate that the
  // colony belongs to the caller's active org before inserting, so an Org A
  // member can't pass an Org B colony_id and create an orphaned row.
  const { data: colony } = await supabase
    .from("colonies")
    .select("id")
    .eq("id", colonyId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) {
    redirect(
      `/app/colonies/${colonyId}/cats/new?error=${encodeURIComponent(
        t("colonyNotFound"),
      )}`,
    );
  }

  const { error } = await supabase.from("cats").insert({
    organisation_id: org.organisation_id,
    colony_id: colonyId,
    name,
    temp_id: tempId,
    colour,
    notes,
    status: "active",
  });

  if (error) {
    redirect(
      `/app/colonies/${colonyId}/cats/new?error=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}

export async function updateCat(formData: FormData) {
  const catId = String(formData.get("cat_id"));
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const t = await getTranslations("errors");
  const name = String(formData.get("name") ?? "").trim() || null;
  const tempId = String(formData.get("temp_id") ?? "").trim() || null;
  const editPath = `/app/colonies/${colonyId}/cats/${catId}/edit`;
  // Same rule as create: at least one identifier, never block on the rest.
  if (!name && !tempId) {
    redirect(`${editPath}?error=${encodeURIComponent(t("nameOrDescription"))}`);
  }
  // Tri-state so "unknown" stays null — records accept incomplete data.
  const neutered = parseNeutered(formData.get("neutered")?.toString());

  const supabase = await createClient();
  // RLS scopes this to the caller's org and Caretaker/Admin role — it is the
  // only authz here, so we keep the RLS-bound client rather than service-role.
  // .select("id") + isFailedWrite turns an RLS-filtered 0-row match into a
  // surfaced error instead of a silent success.
  const { data, error } = await supabase
    .from("cats")
    .update({
      name,
      temp_id: tempId,
      colour: String(formData.get("colour") ?? "").trim() || null,
      markings: String(formData.get("markings") ?? "").trim() || null,
      sex: String(formData.get("sex") ?? "").trim() || null,
      neutered,
      approx_age: String(formData.get("approx_age") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", catId)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    const message = writeErrorMessage(
      { error, rows: data },
      t("catNoLongerExists"),
    );
    redirect(`${editPath}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}

// The 30-second feeding update: one append-only feeding_event for the colony,
// plus one append-only cat_sighting per cat the feeder marked.
export async function submitFeeding(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const feederId = user?.id ?? null;

  const { data: event, error: eventError } = await supabase
    .from("feeding_events")
    .insert({
      organisation_id: org.organisation_id,
      colony_id: colonyId,
      feeder_id: feederId,
      fed: formData.get("fed") === "1",
      problem: formData.get("problem") === "1",
      food_issue: formData.get("food_issue") === "1",
      danger: formData.get("danger") === "1",
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .select("id")
    .single();

  if (eventError || !event) {
    const t = await getTranslations("errors");
    redirect(
      `/app/colonies/${colonyId}/feed?error=${encodeURIComponent(
        eventError?.message ?? t("couldNotSaveFeeding"),
      )}`,
    );
  }

  const sightings: {
    organisation_id: string;
    cat_id: string;
    feeding_event_id: string;
    feeder_id: string | null;
    status: string;
  }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cat:") && typeof value === "string" && value) {
      sightings.push({
        organisation_id: org.organisation_id,
        cat_id: key.slice(4),
        feeding_event_id: event.id,
        feeder_id: feederId,
        status: value,
      });
    }
  }

  let insertedSightings:
    | { cat_id: string; observed_at: string; status: string }[]
    | null = null;
  if (sightings.length > 0) {
    const { data: sightingData, error: sightingError } = await supabase
      .from("cat_sightings")
      .insert(sightings)
      .select("cat_id, observed_at, status");
    if (sightingError) {
      redirect(
        `/app/colonies/${colonyId}/feed?error=${encodeURIComponent(sightingError.message)}`,
      );
    }
    insertedSightings = sightingData ?? null;
  }

  // Non-blocking alert: any sighting the feeder marked `concern` raises one
  // routine alert per (cat, observed_at) to the org's caretakers+admins. The
  // cron sweep owns the time-based not_seen rules and deliberately SKIPS concern
  // (lib/alert-engine.planNotSeenAlerts), so this hook is the only path for a
  // live concern flag. A failure here must NEVER fail the feeding update
  // (mirrors the non-blocking photo pattern); records intent only — no
  // push/SMS/email, dispatched_at stays NULL.
  const concernSightings = (insertedSightings ?? []).filter(
    (s) => s.status === "concern",
  );
  if (concernSightings.length > 0) {
    try {
      const svc = createServiceClient();
      const concernCatIds = [...new Set(concernSightings.map((s) => s.cat_id))];
      const [{ data: colony }, { data: catRows }, { data: members }] =
        await Promise.all([
          svc.from("colonies").select("name").eq("id", colonyId).maybeSingle(),
          svc.from("cats").select("id, name, temp_id").in("id", concernCatIds),
          svc
            .from("memberships")
            .select("user_id, role, deleted_at")
            .eq("organisation_id", org.organisation_id),
        ]);
      const recipients = alertRecipients(members ?? []);
      if (recipients.length > 0) {
        const catNameById = new Map(
          (catRows ?? []).map((c) => [
            c.id as string,
            (c.name as string | null)?.trim() ||
              (c.temp_id as string | null)?.trim() ||
              "",
          ]),
        );
        const specs = concernSightings.flatMap((s) =>
          planConcernSightingAlert({
            catId: s.cat_id,
            colonyId,
            colonyName: colony?.name ?? "",
            catName: catNameById.get(s.cat_id) ?? "",
            reporterName: user?.email ?? "",
            observedAt: s.observed_at,
          }),
        );
        await persistAlerts(svc, org.organisation_id, specs, recipients);
      }
    } catch {
      // Swallow: the feeding update stands regardless of the alert fan-out.
    }
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}?updated=1`);
}
