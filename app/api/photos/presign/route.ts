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
export async function POST(req: Request) {
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Photo storage isn’t configured yet." },
      { status: 503 },
    );
  }

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (org.role !== "admin" && org.role !== "caretaker") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  let body: { catId?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const catId = String(body.catId ?? "");
  const ext = EXT[String(body.contentType ?? "")];
  if (!catId || !ext) {
    return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
  }

  // The cat must belong to the caller's org (RLS also scopes this read).
  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("cats")
    .select("id")
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) return NextResponse.json({ error: "Cat not found." }, { status: 404 });

  const key = `org/${org.organisation_id}/cats/${catId}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await presignPut(key);
  return NextResponse.json({ uploadUrl, key });
}
