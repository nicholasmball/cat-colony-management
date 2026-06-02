"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createOrganisation(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organisation", {
    p_name: String(formData.get("name") ?? ""),
  });
  if (error) {
    redirect(`/app?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app");
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
