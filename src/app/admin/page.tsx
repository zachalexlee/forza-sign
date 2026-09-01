import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_BADGES: Record<string, string> = {
  sent: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-amber-100 text-amber-800",
  submitted: "bg-blue-100 text-blue-800",
  reviewed: "bg-green-100 text-green-800",
};

const STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  in_progress: "In progress",
  submitted: "Submitted",
  reviewed: "Reviewed",
};

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("worksheets")
    .select("id, status, submitted_at, created_at, customers(business_name, contact_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && status in STATUS_LABELS) query = query.eq("status", status);
  const { data: worksheets } = await query;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Worksheets</h1>
        <Link
          href="/admin/worksheets/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          New worksheet
        </Link>
      </div>

      <div className="mt-4 flex gap-2 text-sm">
        <FilterTab href="/admin" label="All" active={!status} />
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <FilterTab
            key={value}
            href={`/admin?status=${value}`}
            label={label}
            active={status === value}
          />
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(worksheets ?? []).map((w) => {
              const customer = w.customers as unknown as {
                business_name: string;
                contact_name: string | null;
                email: string | null;
              } | null;
              return (
                <tr key={w.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/worksheets/${w.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {customer?.business_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {customer?.contact_name ?? customer?.email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGES[w.status]}`}
                    >
                      {STATUS_LABELS[w.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {w.submitted_at ? new Date(w.submitted_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              );
            })}
            {(worksheets ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-zinc-400">
                  No worksheets yet. Send one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {label}
    </Link>
  );
}
