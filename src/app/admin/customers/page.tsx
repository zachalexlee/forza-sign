import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function CustomersPage() {
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, business_name, contact_name, email, phone, created_at, worksheets(id, status)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <h1 className="text-xl font-semibold">Customers</h1>
      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Worksheets</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(customers ?? []).map((c) => {
              const worksheets = (c.worksheets ?? []) as { id: string; status: string }[];
              return (
                <tr key={c.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium">{c.business_name}</td>
                  <td className="px-4 py-3 text-zinc-600">{c.contact_name ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600">{c.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    {worksheets.map((w) => (
                      <Link
                        key={w.id}
                        href={`/admin/worksheets/${w.id}`}
                        className="mr-2 text-xs underline"
                      >
                        {w.status}
                      </Link>
                    ))}
                    {worksheets.length === 0 && <span className="text-zinc-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {(customers ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-zinc-400">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
