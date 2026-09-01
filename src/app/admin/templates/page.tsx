import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("templates")
    .select("id, version, storage_path, field_map, active, programs(code, name)")
    .order("created_at");

  // Which blanks exist in storage?
  const admin = createAdminClient();
  const uploaded = new Set<string>();
  const paths = (templates ?? [])
    .map((t) => t.storage_path)
    .filter((p): p is string => !!p);
  for (const p of new Set(paths)) {
    const dir = p.split("/").slice(0, -1).join("/");
    const name = p.split("/").pop()!;
    const { data: files } = await admin.storage.from("templates").list(dir);
    if ((files ?? []).some((f) => f.name === name)) uploaded.add(p);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Templates</h1>
      <p className="mt-1 text-sm text-zinc-500">
        One row per program variant. Upload the blank packet PDF, then map its
        form fields to the dictionary — new programs need no code changes.
      </p>
      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Program</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Blank PDF</th>
              <th className="px-4 py-3">Mapping</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {(templates ?? []).map((t) => {
              const program = t.programs as unknown as { code: string; name: string };
              const mapCount = Array.isArray(t.field_map) ? t.field_map.length : 0;
              return (
                <tr key={t.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/templates/${t.id}`} className="font-medium hover:underline">
                      {program?.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">v{t.version}</td>
                  <td className="px-4 py-3">
                    {t.storage_path && uploaded.has(t.storage_path) ? (
                      <span className="text-green-700">Uploaded ✓</span>
                    ) : (
                      <span className="text-amber-700">Missing</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {mapCount > 0
                      ? `${mapCount} fields (custom)`
                      : "Built-in Appendix B map"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
