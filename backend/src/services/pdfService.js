const PDFDocument = require("pdfkit");
const axios = require("axios");
 
/**
 * Renders a work-order PDF (location, image, cost, urgency/severity, SLA)
 * into a Buffer, which the controller then uploads to Supabase Storage
 * and links back onto the work_order row as pdf_url.
 *
 * Uses pdfkit directly (no headless browser needed) — lighter weight
 * and faster than Puppeteer for a simple structured document like this.
 *
 * Images (the evidence photo, and the after-repair photo once a crew
 * has submitted one) are downloaded and embedded directly in the PDF,
 * not just linked — this was a gap in the earlier version, fixed here.
 * pdfkit can embed JPEG and PNG natively; other formats (e.g. webp) are
 * skipped gracefully with a text fallback rather than crashing PDF
 * generation for the whole work order.
 */
async function generateWorkOrderPdf(workOrder) {
  const evidenceImage = await tryDownloadImage(workOrder.evidence_image_url);
  const afterImage = workOrder.crew_photo_url ? await tryDownloadImage(workOrder.crew_photo_url) : null;
 
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
 
    doc.fontSize(20).fillColor("#1F3A5F").text("SENTRIROAD — WORK ORDER", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#666666").text(`Work Order ID: ${workOrder.id}`);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`);
    doc.moveDown(1);
 
    line(doc);
    doc.moveDown(0.5);
 
    section(doc, "Location");
    doc.fontSize(11).fillColor("#111111").text(workOrder.address);
    doc.fontSize(9).fillColor("#666666").text(`GPS: ${workOrder.gps_lat}, ${workOrder.gps_lng}`);
    doc.moveDown(0.8);
 
    section(doc, "Damage Details");
    doc.fontSize(11).fillColor("#111111").text(`Type: ${capitalize(workOrder.damage_type)}`);
    doc.text(`Urgency Score: ${workOrder.urgency_score} / 100`);
    doc.moveDown(0.5);
 
    // --- Evidence photo ---
    if (evidenceImage) {
      doc.fontSize(9).fillColor("#666666").text("Evidence Photo:");
      doc.moveDown(0.2);
      embedImage(doc, evidenceImage);
    } else if (workOrder.evidence_image_url) {
      doc.fontSize(9).fillColor("#999999").text(
        `[Evidence photo could not be embedded — view directly: ${workOrder.evidence_image_url}]`
      );
    }
    doc.moveDown(0.8);
 
    section(doc, "Cost & SLA");
    doc.fontSize(11).fillColor("#111111").text(`Estimated Cost: Rs. ${Number(workOrder.cost_estimate).toLocaleString("en-IN")}`);
    doc.text(`SLA Deadline: ${new Date(workOrder.sla_deadline).toLocaleString("en-IN")}`);
    doc.text(`Status: ${capitalize(workOrder.status.replace(/_/g, " "))}`);
    doc.moveDown(0.8);
 
    if (workOrder.assigned_crew_id) {
      section(doc, "Assignment");
      doc.fontSize(11).fillColor("#111111").text(`Assigned crew ID: ${workOrder.assigned_crew_id}`);
      doc.moveDown(0.8);
    }
 
    // --- After-repair photo, only present once a crew has submitted one ---
    if (afterImage) {
      section(doc, "After-Repair Photo");
      embedImage(doc, afterImage);
      doc.moveDown(0.8);
    }
 
    doc.moveDown(0.5);
    line(doc);
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#999999").text(
      "Generated automatically by Sentriroad. Latest status and full history are available in the dashboard.",
      { align: "left" }
    );
 
    doc.end();
  });
}
 
/**
 * Downloads an image URL into a Buffer for embedding. Returns null
 * (never throws) if the download fails or the format isn't one pdfkit
 * can embed (JPEG/PNG only) — callers fall back to a text note instead
 * of failing the whole PDF over one bad image link.
 */
async function tryDownloadImage(url) {
  if (!url) return null;
  try {
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);
 
    const looksLikeJpeg = contentType.includes("jpeg") || contentType.includes("jpg") || isJpegMagicBytes(buffer);
    const looksLikePng = contentType.includes("png") || isPngMagicBytes(buffer);
 
    if (!looksLikeJpeg && !looksLikePng) {
      // eslint-disable-next-line no-console
      console.warn(`[pdfService] Skipping unsupported image format for PDF embed: ${url} (content-type: ${contentType})`);
      return null;
    }
    return buffer;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[pdfService] Failed to download image for PDF embed: ${url} — ${err.message}`);
    return null;
  }
}
 
function isJpegMagicBytes(buf) {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}
function isPngMagicBytes(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}
 
/**
 * Places an image on the page at a fixed max width/height, keeping
 * aspect ratio (pdfkit's `fit` option), and adds a page break first if
 * there isn't enough room left on the current page.
 */
function embedImage(doc, imageBuffer) {
  const maxWidth = 350;
  const maxHeight = 220;
  if (doc.y + maxHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
  try {
    doc.image(imageBuffer, { fit: [maxWidth, maxHeight], align: "left" });
  } catch (err) {
    // pdfkit throws if the buffer isn't actually a valid/complete
    // JPEG/PNG despite passing our magic-byte check — fail soft.
    // eslint-disable-next-line no-console
    console.warn(`[pdfService] pdfkit failed to embed image: ${err.message}`);
    doc.fontSize(9).fillColor("#999999").text("[Image could not be rendered]");
  }
}
 
function section(doc, title) {
  doc.fontSize(13).fillColor("#2E6F5E").text(title);
}
 
function line(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#DDDDDD").stroke();
}
 
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
 
module.exports = { generateWorkOrderPdf };
