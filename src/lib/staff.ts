import { createClient } from "@/lib/supabase/server";

export interface StaffContext {
  userId: string;
  orgId: string;
  fullName: string;
  role: "admin" | "staff";
}

/**
 * Authorization gate for every server action / staff route. Server Functions
 * are reachable by direct POST, so each one must call this itself.
 */
export async function requireStaff(): Promise<StaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: staff } = await supabase
    .from("staff_users")
    .select("org_id, full_name, role")
    .eq("id", user.id)
    .single();
  if (!staff) throw new Error("Not authorized");

  return {
    userId: user.id,
    orgId: staff.org_id,
    fullName: staff.full_name,
    role: staff.role,
  };
}
