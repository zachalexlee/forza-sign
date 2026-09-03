import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Streams the application PDF (executed final if present, else the filled
 * draft) to a signed-in staff member. Replaces short-lived signed URLs in the
 * admin UI — those expired while the page sat open, breaking the preview
 * iframe and the Download link. RLS on the applications select enforces org
 * scoping; the admin client only touches storage.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not authenticated", { status: 401 });

  const { data: application } = await supabase
    .from("applications")
    .select("id, filled_pdf_path, final_pdf_path")
    .eq("id", id)
    .maybeSingle();
  if (!application) return new NextResponse("Not found", { status: 404 });

  const executed = !!application.final_pdf_path;
  const bucket = executed ? "final" : "filled";
  const path = application.final_pdf_path ?? application.filled_pdf_path;
  if (!path) return new NextResponse("No PDF generated yet", { status: 404 });

  const admin = createAdminClient();
  const { data: file, error } = await admin.storage.from(bucket).download(path);
  if (error || !file) return new NextResponse("Not found", { status: 404 });

  const attachment =
    new URL(request.url).searchParams.get("download") === "1";
  const filename = `${executed ? "executed" : "application"}-${id.slice(0, 8)}.pdf`;
  return new NextResponse(Buffer.from(await file.arrayBuffer()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
