import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateCat } from "../../../../actions";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { SubmitButton } from "@/components/submit-button";
import { ImageUpload } from "@/components/image-upload";
import { btnPrimary, fieldLabel, input } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function EditCat({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; catId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, catId } = await params;
  const { error } = await searchParams;

  const org = await getActiveOrg();
  // Edit is a manager action; Feeders report new cats but don't edit records.
  if (org && org.role !== "admin" && org.role !== "caretaker") {
    redirect(`/app/colonies/${id}`);
  }

  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("cats")
    .select(
      "id, name, temp_id, colour, markings, sex, neutered, approx_age, notes, photo_url",
    )
    .eq("id", catId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) notFound();

  const neuteredValue =
    cat.neutered === true ? "yes" : cat.neutered === false ? "no" : "";
  const photo = await photoSrc(cat.photo_url as string | null);

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← Colony
      </Link>
      <h1 className="font-display text-3xl">
        Edit {cat.name ?? cat.temp_id ?? "cat"}
      </h1>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <ImageUpload
        catId={catId}
        initialSrc={photo}
        label={cat.name ?? cat.temp_id ?? "cat"}
      />

      <form action={updateCat} className="flex flex-col gap-4">
        <input type="hidden" name="cat_id" value={catId} />
        <input type="hidden" name="colony_id" value={id} />

        <p className="text-sm text-muted">
          Keep a name, or a short description if it has no name yet — at least
          one. Everything else is optional; fill in what you know.
        </p>
        <label className={fieldLabel}>
          <span>Name</span>
          <input name="name" defaultValue={cat.name ?? ""} className={input} />
        </label>
        <label className={fieldLabel}>
          <span>
            Description{" "}
            <span className="font-normal text-muted">(if it has no name)</span>
          </span>
          <input
            name="temp_id"
            defaultValue={cat.temp_id ?? ""}
            placeholder="e.g. ginger tom by the bins"
            className={input}
          />
        </label>

        <label className={fieldLabel}>
          <span>Colour</span>
          <input
            name="colour"
            defaultValue={cat.colour ?? ""}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>Markings</span>
          <input
            name="markings"
            defaultValue={cat.markings ?? ""}
            className={input}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className={fieldLabel}>
            <span>Sex</span>
            <select name="sex" defaultValue={cat.sex ?? ""} className={input}>
              <option value="">Unknown</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <label className={fieldLabel}>
            <span>Neutered</span>
            <select name="neutered" defaultValue={neuteredValue} className={input}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <label className={fieldLabel}>
          <span>Approx. age</span>
          <input
            name="approx_age"
            defaultValue={cat.approx_age ?? ""}
            placeholder="e.g. ~2 years, kitten"
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>Notes</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={cat.notes ?? ""}
            className={`${input} py-2`}
          />
        </label>

        <SubmitButton pendingText="Saving…" className={btnPrimary}>
          Save changes
        </SubmitButton>
      </form>
    </div>
  );
}
