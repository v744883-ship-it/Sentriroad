const supabase = require("../config/supabaseClient");
const config = require("../config/env");

/**
 * Generates a signed upload URL so the FRONTEND uploads large files
 * (photos/videos) directly to Supabase Storage — the raw bytes never
 * pass through this backend. This is the direct-to-cloud pattern we
 * discussed: solves the RAM/crash risk of proxying big video uploads
 * through a small Node process.
 */
async function createSignedUploadUrl(userId, filename, fileType) {
  // fileType is optional. When omitted (every existing citizen call
  // site), the path is generated exactly as before — this only adds a
  // "telemetry/" prefix when the drone dashboard explicitly asks for
  // one, it doesn't change behavior for anything already calling this.
  const prefix = fileType === "telemetry" ? "telemetry/" : "";
  const path = `${prefix}${userId}/${Date.now()}-${sanitizeFilename(filename)}`;

  const { data, error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .createSignedUploadUrl(path);

  if (error) throw error;

  const { data: publicUrlData } = supabase.storage
    .from(config.supabaseStorageBucket)
    .getPublicUrl(path);

  return {
    upload_url: data.signedUrl,
    file_path: path,
    public_url_after_upload: publicUrlData.publicUrl,
    // Supabase signed upload URLs are valid for 2 hours by default
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Used internally by the work-order controller to store the generated
 * PDF buffer and get back a public URL to save on the work_order row.
 */
async function uploadWorkOrderPdf(workOrderId, pdfBuffer) {
  const path = `work-orders/${workOrderId}.pdf`;

  const { error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from(config.supabaseStorageBucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * DRONE PATH ONLY. Used by the drone branch of aiPipelineService.js to
 * store each clustered detection's winning video frame as its own
 * evidence image (the ai-service sends the frame back as base64 bytes;
 * this is where it actually lands in storage). Mirrors the existing
 * uploadWorkOrderPdf pattern above rather than inventing a new one.
 */
async function uploadEvidenceImage(reportId, clusterIndex, imageBuffer) {
  const path = `evidence/${reportId}-${clusterIndex}.jpg`;

  const { error } = await supabase.storage
    .from(config.supabaseStorageBucket)
    .upload(path, imageBuffer, { contentType: "image/jpeg", upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from(config.supabaseStorageBucket).getPublicUrl(path);
  return data.publicUrl;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

module.exports = { createSignedUploadUrl, uploadWorkOrderPdf, uploadEvidenceImage };
