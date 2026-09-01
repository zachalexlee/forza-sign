import { NextResponse } from "next/server";
import { validateSigningToken } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";

/** Stream the filled PDF to the authenticated signer's viewer. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await validateSigningToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }
  if (!result.application.filled_pdf_path) {
    return NextResponse.json({ error: "no_pdf" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data } = await supabase.storage
    .from("filled")
    .download(result.application.filled_pdf_path);
  if (!data) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  return new NextResponse(data.stream(), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "Content-Disposition": "inline; filename=application.pdf",
    },
  });
}
