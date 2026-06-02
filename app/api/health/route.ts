import { NextResponse } from "next/server";

// Liveness probe used by the deploy smoke-check. Intentionally does not touch
// the database — it answers "is the app process up and serving?".
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", service: "scot-colony-management" });
}
