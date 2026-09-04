const axios = require("axios");
const supabase = require("../config/supabaseClient");
const config = require("../config/env");
const { computeUrgencyScore, estimateCost } = require("./scoringService");
const { generateWorkOrderPdf } = require("./pdfService");
const { uploadWorkOrderPdf } = require("./storageService");

/**
 * Orchestrates: Report → call AI service → Detection → Score → Work Order (+PDF).
 * Called fire-and-forget from reports.controller after a citizen submits
 * a report, so the upload request itself returns instantly.
 *
 * This calls out to the separate Python AI service (see /ai-service).
 * If that service is down or a model isn't loaded yet, this fails
 * gracefully — the report just stays in 'reported' status until
 * someone retries (see note at bottom).
 */
async function processReportAsync(reportId) {
  const { data: report, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .single();
  if (error || !report) throw new Error(`Report ${reportId} not found`);

  // DRONE PATH — completely separate branch, does not touch or alter
  // anything below this block. Citizen reports (source_type defaults
  // to 'citizen' for every existing/old row) fall through untouched.
  if (report.source_type === "drone") {
    return processDroneReportAsync(report);
  }

  // 1. Call AI service for detection
  const detectionResult = await callAiService(report.media_url, report.media_type);
    if (!detectionResult || detectionResult.confidence < 0.35) {
    // Below-threshold detection — flag for manual review instead of leaving
    // the report indistinguishable from one the AI hasn't looked at yet.
    await supabase.from("reports").update({ status: "review_needed" }).eq("id", report.id);
    return;
  }

  // 2. Store detection
  const { data: detection, error: detErr } = await supabase
    .from("detections")
    .insert({
      report_id: report.id,
      damage_type: detectionResult.damage_type,
      confidence: detectionResult.confidence,
      bbox_x: detectionResult.bbox[0],
      bbox_y: detectionResult.bbox[1],
      bbox_w: detectionResult.bbox[2],
      bbox_h: detectionResult.bbox[3],
      evidence_image_url: detectionResult.evidence_image_url || report.media_url,
      frame_timestamp_seconds: detectionResult.frame_timestamp_seconds || null,
    })
    .select("*")
    .single();
  if (detErr) throw detErr;

  // 3. Compute urgency score
  const damageAreaRatio = detectionResult.bbox[2] * detectionResult.bbox[3];
  const { urgency_score, factor_breakdown } = computeUrgencyScore({
    confidence: detectionResult.confidence,
    damage_area_ratio: damageAreaRatio,
    traffic_volume: detectionResult.traffic_volume_hint ?? 50, // default mid-value until road-category data source is wired up
    road_category_score: detectionResult.road_category_hint ?? 50,
    first_detected_at: report.created_at,
  });

  const { data: score, error: scoreErr } = await supabase
    .from("scores")
    .insert({
      detection_id: detection.id,
      urgency_score,
      factor_severity: factor_breakdown.severity,
      factor_traffic_volume: factor_breakdown.traffic_volume,
      factor_accident_risk: factor_breakdown.accident_risk,
      factor_road_category: factor_breakdown.road_category,
      factor_time_since_detection: factor_breakdown.time_since_detection,
    })
    .select("*")
    .single();
  if (scoreErr) throw scoreErr;

  // 4. Update report status
  await supabase.from("reports").update({ status: "scored", updated_at: new Date().toISOString() }).eq("id", report.id);

  // 5. Generate work order
  const cost_estimate = estimateCost(detectionResult.damage_type, urgency_score);
  const slaDeadline = new Date(Date.now() + config.slaHoursDefault * 60 * 60 * 1000).toISOString();

  const { data: workOrder, error: woErr } = await supabase
    .from("work_orders")
    .insert({
      report_id: report.id,
      score_id: score.id,
      address: report.address || "Address not provided",
      gps_lat: report.gps_lat,
      gps_lng: report.gps_lng,
      evidence_image_url: detection.evidence_image_url,
      damage_type: detectionResult.damage_type,
      urgency_score,
      cost_estimate,
      sla_deadline: slaDeadline,
      status: "scored",
    })
    .select("*")
    .single();
  if (woErr) throw woErr;

  // 6. Generate + store PDF, link back onto the work order
  try {
    const pdfBuffer = await generateWorkOrderPdf(workOrder);
    const pdfUrl = await uploadWorkOrderPdf(workOrder.id, pdfBuffer);
    await supabase.from("work_orders").update({ pdf_url: pdfUrl }).eq("id", workOrder.id);
  } catch (pdfErr) {
    // Non-fatal — work order exists and is usable even if PDF generation
    // failed (e.g. storage bucket misconfigured). Log and move on.
    // eslint-disable-next-line no-console
    console.error(`[ai-pipeline] PDF generation failed for work order ${workOrder.id}:`, pdfErr.message);
  }
}

/**
 * DRONE PATH — mirrors the citizen pipeline above (detection -> score
 * -> work order -> PDF) but loops once per clustered detection instead
 * of assuming exactly one. The citizen function above is never called
 * from here and is not modified by any of this.
 *
 * report.status is intentionally left at 'scored' once this finishes
 * and is NOT updated further at the report level for drone reports —
 * with potentially many work orders per report, per-work-order status
 * (which already exists and already works) is the source of truth for
 * progress, not report.status. See work_orders.status for tracking.
 */
async function processDroneReportAsync(report) {
  if (!report.telemetry_url) {
    // Missing telemetry on a drone report is a data problem, not a
    // pipeline crash — flag for manual review same as a low-confidence
    // citizen detection would be.
    await supabase.from("reports").update({ status: "review_needed" }).eq("id", report.id);
    return;
  }

  const clusters = await callAiServiceDrone(report.media_url, report.telemetry_url);
  if (!clusters || clusters.length === 0) {
    await supabase.from("reports").update({ status: "review_needed" }).eq("id", report.id);
    return;
  }

  const aboveThreshold = clusters.filter((c) => c.confidence >= 0.35);
  if (aboveThreshold.length === 0) {
    await supabase.from("reports").update({ status: "review_needed" }).eq("id", report.id);
    return;
  }

  const { uploadEvidenceImage } = require("./storageService");

  for (let i = 0; i < aboveThreshold.length; i++) {
    const cluster = aboveThreshold[i];

    // Upload this cluster's winning frame as its own evidence image —
    // each cluster is a physically different pothole, so each needs
    // its own image, not one shared image/video URL.
    let evidenceImageUrl = report.media_url; // safe fallback if upload fails
    if (cluster.frame_image_base64) {
      try {
        const buffer = Buffer.from(cluster.frame_image_base64, "base64");
        evidenceImageUrl = await uploadEvidenceImage(report.id, i, buffer);
      } catch (uploadErr) {
        // eslint-disable-next-line no-console
        console.error(`[ai-pipeline] evidence image upload failed for report ${report.id} cluster ${i}:`, uploadErr.message);
      }
    }

    const { data: detection, error: detErr } = await supabase
      .from("detections")
      .insert({
        report_id: report.id,
        damage_type: cluster.damage_type,
        confidence: cluster.confidence,
        bbox_x: cluster.bbox[0],
        bbox_y: cluster.bbox[1],
        bbox_w: cluster.bbox[2],
        bbox_h: cluster.bbox[3],
        evidence_image_url: evidenceImageUrl,
        frame_timestamp_seconds: cluster.frame_timestamp_seconds || null,
        gps_lat: cluster.gps_lat,
        gps_lng: cluster.gps_lng,
      })
      .select("*")
      .single();
    if (detErr) throw detErr;

    const damageAreaRatio = cluster.bbox[2] * cluster.bbox[3];
    const { urgency_score, factor_breakdown } = computeUrgencyScore({
      confidence: cluster.confidence,
      damage_area_ratio: damageAreaRatio,
      traffic_volume: 50, // same default-until-wired-up placeholder as the citizen path
      road_category_score: 50,
      first_detected_at: report.created_at,
    });

    const { data: score, error: scoreErr } = await supabase
      .from("scores")
      .insert({
        detection_id: detection.id,
        urgency_score,
        factor_severity: factor_breakdown.severity,
        factor_traffic_volume: factor_breakdown.traffic_volume,
        factor_accident_risk: factor_breakdown.accident_risk,
        factor_road_category: factor_breakdown.road_category,
        factor_time_since_detection: factor_breakdown.time_since_detection,
      })
      .select("*")
      .single();
    if (scoreErr) throw scoreErr;

    const cost_estimate = estimateCost(cluster.damage_type, urgency_score);
    const slaDeadline = new Date(Date.now() + config.slaHoursDefault * 60 * 60 * 1000).toISOString();

    const { data: workOrder, error: woErr } = await supabase
      .from("work_orders")
      .insert({
        report_id: report.id,
        score_id: score.id,
        address: report.address || "Address not provided",
        // Drone work orders use the DETECTION's GPS (per-pothole),
        // not the report's — the report has no single point for a
        // drone submission (see reports.gps_lat/lng, nullable).
        gps_lat: cluster.gps_lat,
        gps_lng: cluster.gps_lng,
        evidence_image_url: evidenceImageUrl,
        damage_type: cluster.damage_type,
        urgency_score,
        cost_estimate,
        sla_deadline: slaDeadline,
        status: "scored",
      })
      .select("*")
      .single();
    if (woErr) throw woErr;

    try {
      const pdfBuffer = await generateWorkOrderPdf(workOrder);
      const pdfUrl = await uploadWorkOrderPdf(workOrder.id, pdfBuffer);
      await supabase.from("work_orders").update({ pdf_url: pdfUrl }).eq("id", workOrder.id);
    } catch (pdfErr) {
      // eslint-disable-next-line no-console
      console.error(`[ai-pipeline] PDF generation failed for work order ${workOrder.id}:`, pdfErr.message);
    }
  }

  await supabase.from("reports").update({ status: "scored", updated_at: new Date().toISOString() }).eq("id", report.id);
}

/**
 * Calls the drone-specific AI service endpoint. Expected contract:
 *   POST {AI_SERVICE_URL}/detect/drone  { media_url, telemetry_url }
 *   -> { detections: [{ damage_type, confidence, bbox, gps_lat, gps_lng,
 *                        frame_timestamp_seconds, frame_image_base64 }] }
 * Separate endpoint from callAiService() below — the citizen path is
 * never routed through this function.
 */
async function callAiServiceDrone(media_url, telemetry_url) {
  try {
    const { data } = await axios.post(
      `${config.aiServiceUrl}/detect/drone`,
      { media_url, telemetry_url },
      { timeout: 120000 } // drone videos + many frames take longer than a single citizen detection
    );
    return data.detections || [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ai-pipeline] drone AI service call failed:", err.message);
    return null;
  }
}

/**
 * Calls the separate Python AI service. Expected contract:
 *   POST {AI_SERVICE_URL}/detect  { media_url, media_type }
 *   → { damage_type, confidence, bbox: [x,y,w,h], evidence_image_url? }
 * See /ai-service/main.py for the reference implementation (currently
 * a placeholder model — swap in trained YOLOv8n weights there).
 */
async function callAiService(media_url, media_type) {
  try {
    const { data } = await axios.post(
      `${config.aiServiceUrl}/detect`,
      { media_url, media_type },
      { timeout: 30000 }
    );
    return data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ai-pipeline] AI service call failed:", err.message);
    return null;
  }
}

module.exports = { processReportAsync };
