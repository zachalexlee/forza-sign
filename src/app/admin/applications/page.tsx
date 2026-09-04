import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_BADGES: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-amber-100 text-amber-800",
  signed: "bg-indigo-100 text-indigo-800",
  completed: "bg-green-100 text-green-800",
  voided: "bg-red-100 text-red-700",
  declined: "bg-red-100 text-red-700",
};

/** Dashboard-tile filters: pseudo-status "out" = sent or viewed. */
const STATUS_FILTERS: Record<string, string[]> = {
  draft: ["draft"],
  out: ["sent", "viewed"],
  completed: ["completed"],
};

const PAGE_SIZE = 100;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status, page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const supabase = await createClient();
  // Paged with an exact count — the dashboard tiles promise exact totals,
  // so every counted row must be reachable, not just the first 100.
  let query = supabase
    .from("applications")
    .select(
      "id, status, created_at, filled_pdf_path, programs(name), worksheets(customers(business_name))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status && status in STATUS_FILTERS) query = query.in("status", STATUS_FILTERS[status]);
  const { data: applications, count: totalRows } = await query;

  return (
    <div>
      <h1 className="text-xl font-semibold">Applications</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Created from reviewed worksheets. Signing arrives in Milestone 4.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Program</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">PDF</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(applications ?? []).map((a) => {
              const program = a.programs as unknown as { name: string } | null;
              const business = (
                a.worksheets as unknown as {
                  customers: { business_name: string } | null;
                } | null
              )?.customers?.business_name;
              return (
                <tr key={a.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/applications/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {business ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{program?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGES[a.status]}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {a.filled_pdf_path ? "Filled ✓" : "Awaiting template"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {(applications ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-zinc-400">
                  No applications yet — create one from a reviewed worksheet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={totalRows ?? 0}
        makeHref={(p) => `/admin/applications?${status ? `status=${status}&` : ""}page=${p}`}
      />
    </div>
  );
}

function Pager({
  page,
  pageSize,
  total,
  makeHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  makeHref: (page: number) => string;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage === 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-zinc-600">
      <span>
        Page {page} of {lastPage} · {total} total
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link href={makeHref(page - 1)} className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50">
            ← Newer
          </Link>
        )}
        {page < lastPage && (
          <Link href={makeHref(page + 1)} className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50">
            Older →
          </Link>
        )}
      </span>
    </div>
  );
}
