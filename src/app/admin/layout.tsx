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
      <header className="border-b border-zinc-200 border-t-2 border-t-forza-red bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin" className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/f-mark.png" alt="" className="h-6 w-auto" />
              <span className="wordmark text-lg text-zinc-900">Forza Sign</span>
            </Link>
            <Link href="/admin" className="text-zinc-600 hover:text-forza-red">
              Worksheets
            </Link>
            <Link href="/admin/applications" className="text-zinc-600 hover:text-forza-red">
              Applications
            </Link>
            <Link href="/admin/customers" className="text-zinc-600 hover:text-forza-red">
              Customers
            </Link>
            <Link href="/admin/templates" className="text-zinc-600 hover:text-forza-red">
              Templates
            </Link>
          </nav>
          <span className="text-sm text-zinc-500">{staff.full_name}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
