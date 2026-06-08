import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { presignPut, r2Configured } from "@/lib/storage/r2";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Mints a short-lived presigned PUT URL so the browser can upload one image
// straight to R2. Authorises the caller and scopes the object key by org.
//
// entityType selects the auth + key policy:
//   • "cat"      → MANAGER-ONLY (admin/caretaker) + the cat must belong to the
//                  org. Key: org/{orgId}/cats/{catId}/{uuid}.jpg. UNCHANGED.
//   • "incident" → ANY org member (feeders report incidents). The incident may
//                  not exist yet at upload time, so the key is scoped to the
//                  colony as a temp bucket:
//                  org/{orgId}/incidents/{colonyId}/{uuid}.jpg
//                  (entity_id is set on the attachments row after the incident
//                  saves; the key just needs to be org-scoped and unique).
//   • "cat_report" → ANY org member (feeders report new cats). Like incident,
//                  the cat row doesn't exist yet, so the key is colony-scoped:
//                  org/{orgId}/cats/_unassigned/{colonyId}/{uuid}.jpg
//                  The report action stores this key on cats.photo_url on
//                  insert. DISTINCT from the manager-only "cat" branch — it
//                  never widens that branch.
export async function POST(req: Request) {
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Photo storage isn’t configured yet." },
      { status: 503 },
    );
  }

  const org = await getActiveOrg();
  if (!org)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: {
    entityType?: string;
    catId?: string;
    colonyId?: string;
    contentType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const ext = EXT[String(body.contentType ?? "")];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type." },
      { status: 400 },
    );
  }

  // Default to the cat branch so the existing caller (image-upload.tsx, which
  // sends no entityType) keeps its exact behaviour.
  const entityType =
    body.entityType === "incident"
      ? "incident"
      : body.entityType === "cat_report"
        ? "cat_report"
        : "cat";
  const supabase = await createClient();

  // Both "incident" and "cat_report" are colony-scoped, member-allowed branches:
  // the target entity doesn't exist yet at upload time, so the key is scoped to
  // a colony the caller can see in their org. They differ only in the key prefix.
  if (entityType === "incident" || entityType === "cat_report") {
    const colonyId = String(body.colonyId ?? "");
    if (!colonyId) {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const { data: colony } = await supabase
      .from("colonies")
      .select("id")
      .eq("id", colonyId)
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!colony) {
      return NextResponse.json({ error: "Colony not found." }, { status: 404 });
    }
    const prefix =
      entityType === "incident"
        ? `incidents/${colonyId}`
        : `cats/_unassigned/${colonyId}`;
    const key = `org/${org.organisation_id}/${prefix}/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await presignPut(key);
    return NextResponse.json({ uploadUrl, key });
  }

  // ── cat branch (UNCHANGED): manager-only + cat-ownership ──
  if (org.role !== "admin" && org.role !== "caretaker") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const catId = String(body.catId ?? "");
  if (!catId) {
    return NextResponse.json(
      { error: "Unsupported image type." },
      { status: 400 },
    );
  }
  // The cat must belong to the caller's org (RLS also scopes this read).
  const { data: cat } = await supabase
    .from("cats")
    .select("id")
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat)
    return NextResponse.json({ error: "Cat not found." }, { status: 404 });

  const key = `org/${org.organisation_id}/cats/${catId}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await presignPut(key);
  return NextResponse.json({ uploadUrl, key });
}
