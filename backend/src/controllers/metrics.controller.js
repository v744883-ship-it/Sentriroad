const supabase = require("../config/supabaseClient");
const { asyncHandler } = require("../utils/asyncHandler");

const getMetricsSummary = asyncHandler(async (req, res) => {
  const { data: workOrders, error } = await supabase.from("work_orders").select("status, sla_deadline, cost_estimate");
  if (error) throw error;

  const total = workOrders.length;
  const verifiedCount = workOrders.filter((w) => w.status === "verified").length;
  const open = workOrders.filter((w) => w.status !== "verified").length;
  const now = new Date();
  const overdue = workOrders.filter((w) => w.status !== "verified" && new Date(w.sla_deadline) < now).length;

  // cost_avoided is a placeholder heuristic (sum of estimated repair
  // costs for verified issues, framed as "cost of damage avoided by
  // catching it early") — replace with your team's actual ROI formula
  // once you have real accident-cost data to justify it, as flagged
  // in the SRS assumptions.
  const costAvoided = workOrders
    .filter((w) => w.status === "verified")
    .reduce((sum, w) => sum + Number(w.cost_estimate || 0) * 15, 0); // 15x multiplier placeholder

  res.json({
    cost_avoided_inr: costAvoided,
    riders_protected_monthly: null, // requires external traffic-volume data source — not computable from our schema alone; wire up once available
    percent_repairs_verified: total ? Math.round((verifiedCount / total) * 100) : 0,
    open_issues: open,
    overdue_sla_count: overdue,
  });
});

module.exports = { getMetricsSummary };
