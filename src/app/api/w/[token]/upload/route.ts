import { NextResponse } from "next/server";
import { isRateLimited, rateLimitResponse } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateWorksheetToken } from "@/lib/worksheets";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Voided-check upload → private `uploads` bucket; path stored in the data blob. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (isRateLimited(request, "worksheet_upload", 15)) return rateLimitResponse();
  const result = await validateWorksheetToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const fieldKey = form.get("field");
  if (!(file instanceof File) || typeof fieldKey !== "string") {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (fieldKey !== "bank.voided_check") {
    return NextResponse.json({ error: "unknown_field" }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const { worksheet } = result;
  const path = `worksheets/${worksheet.id}/voided-check.${ext}`;

  const supabase = createAdminClient();
  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
    });
  if (uploadError) {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { error } = await supabase
    .from("worksheets")
    .update({ data: { ...worksheet.data, [fieldKey]: path } })
    .eq("id", worksheet.id);
  if (error) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ path });
}
