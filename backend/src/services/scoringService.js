/**
 * PRIORITY SCORING ENGINE
 * ------------------------
 * Turns a detection into a 0-100 urgency score from 5 weighted factors.
 * This is a rules-based formula, not a trained ML model — see the note
 * in the SRS: it's fine to be explicit that this part is deterministic
 * logic, not AI, when you explain the system to your mentors.
 *
 * Weights are configurable here in one place (not scattered through
 * the codebase) — tune these as you get real repair-outcome data.
 */

const WEIGHTS = {
  severity: 0.30,
  traffic_volume: 0.25,
  accident_risk: 0.25,
  road_category: 0.10,
  time_since_detection: 0.10,
};

/**
 * @param {object} input
 * @param {number} input.confidence - detection confidence 0-1 from the AI model
 * @param {number} input.damage_area_ratio - bounding box area / frame area, 0-1
 * @param {number} input.traffic_volume - 0-100, from road category / OSM tag / manual input
 * @param {number} input.road_category_score - 0-100, e.g. highway=100, residential=40
 * @param {Date} input.first_detected_at
 * @returns {{ urgency_score: number, factor_breakdown: object }}
 */
function computeUrgencyScore({
  confidence,
  damage_area_ratio,
  traffic_volume,
  road_category_score,
  first_detected_at,
}) {
  // Severity: combination of how confident the model is and how much
  // of the frame the damage occupies (bigger pothole/crack = more severe)
  const severity = clamp(Math.round(confidence * 60 + damage_area_ratio * 100 * 0.4), 0, 100);

  const trafficVolumeScore = clamp(Math.round(traffic_volume), 0, 100);
  const roadCategoryScore = clamp(Math.round(road_category_score), 0, 100);

  // Accident risk: derived, not independently input — higher when both
  // severity AND traffic volume are high (a small crack on a quiet
  // street is low risk even though each factor alone might not be)
  const accidentRisk = clamp(Math.round((severity * 0.5 + trafficVolumeScore * 0.5)), 0, 100);

  // Time since detection: issues open longer creep up in urgency,
  // capped at 100 after ~14 days unresolved
  const daysOpen = (Date.now() - new Date(first_detected_at).getTime()) / (1000 * 60 * 60 * 24);
  const timeSinceDetection = clamp(Math.round((daysOpen / 14) * 100), 0, 100);

  const factor_breakdown = {
    severity,
    traffic_volume: trafficVolumeScore,
    accident_risk: accidentRisk,
    road_category: roadCategoryScore,
    time_since_detection: timeSinceDetection,
  };

  const urgency_score = clamp(
    Math.round(
      factor_breakdown.severity * WEIGHTS.severity +
        factor_breakdown.traffic_volume * WEIGHTS.traffic_volume +
        factor_breakdown.accident_risk * WEIGHTS.accident_risk +
        factor_breakdown.road_category * WEIGHTS.road_category +
        factor_breakdown.time_since_detection * WEIGHTS.time_since_detection
    ),
    0,
    100
  );

  return { urgency_score, factor_breakdown };
}

/**
 * Cost estimate — simple lookup by damage type, scaled by severity.
 * Replace with real municipal cost data once your authority stakeholder
 * provides it (flagged as an assumption in the SRS).
 */
const BASE_COST = {
  pothole: 12000,
  crack: 6000,
};

function estimateCost(damage_type, urgency_score) {
  const base = BASE_COST[damage_type] || 10000;
  const severityMultiplier = 0.6 + (urgency_score / 100) * 0.8; // 0.6x - 1.4x
  return Math.round(base * severityMultiplier);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = { computeUrgencyScore, estimateCost };
