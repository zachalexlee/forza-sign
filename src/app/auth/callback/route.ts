import { NextResponse } from "next/server";
import { DEFAULT_ORG_ID, isAllowedStaffEmail, safeNextPath } from "@/lib/auth-domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuth return point. The Google `hd` hint on the sign-in button is
 * only cosmetic — the domain is enforced here, server-side, before any
 * session is kept. A first-time @forzapayments.com sign-in is provisioned as
 * a regular staff member; anyone else is signed out and the account the
 * attempt created is removed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  const fail = (reason: string) => {
    const dest = new URL("/login", url.origin);
    dest.searchParams.set("error", reason);
    return NextResponse.redirect(dest);
  };

  if (!code) return fail("oauth");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail("oauth");
  const user = data.user;

  const admin = createAdminClient();
  const { data: staff } = await admin
    .from("staff_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!isAllowedStaffEmail(user.email)) {
    await supabase.auth.signOut();
    if (!staff) await admin.auth.admin.deleteUser(user.id);
    return fail("domain");
  }

  if (!staff) {
    const meta = user.user_metadata ?? {};
    const fullName =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      user.email!;
    const { error: insertError } = await admin.from("staff_users").insert({
      id: user.id,
      org_id: DEFAULT_ORG_ID,
      email: user.email!.toLowerCase(),
      full_name: fullName,
      role: "staff",
    });
    if (insertError) {
      console.error("Staff provisioning failed", insertError);
      await supabase.auth.signOut();
      return fail("provision");
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
