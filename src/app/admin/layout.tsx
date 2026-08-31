import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff_users")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  // Authenticated but not provisioned as staff — deny.
  if (!staff) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <span className="font-semibold">Forza Sign</span>
            <Link href="/admin" className="text-zinc-600 hover:text-zinc-900">
              Worksheets
            </Link>
            <Link href="/admin/applications" className="text-zinc-600 hover:text-zinc-900">
              Applications
            </Link>
            <Link href="/admin/customers" className="text-zinc-600 hover:text-zinc-900">
              Customers
            </Link>
          </nav>
          <span className="text-sm text-zinc-500">{staff.full_name}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
