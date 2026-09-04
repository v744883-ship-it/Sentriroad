const express = require("express");
const cors = require("cors");
const config = require("./config/env");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const uploadsRoutes = require("./routes/uploads.routes");
const reportsRoutes = require("./routes/reports.routes");
const workordersRoutes = require("./routes/workorders.routes");
const metricsRoutes = require("./routes/metrics.routes");

const app = express();

app.use(cors());
app.use(express.json());

const PREFIX = "/api/v1";

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Sentriroad backend running", prefix: PREFIX });
});

app.use(`${PREFIX}/auth`, authRoutes);
app.use(`${PREFIX}/uploads`, uploadsRoutes);
app.use(`${PREFIX}/reports`, reportsRoutes);
app.use(`${PREFIX}/workorders`, workordersRoutes);
app.use(`${PREFIX}/metrics`, metricsRoutes);

// zones/priority is a v2 stub — same static shape as the mock server,
// kept so the drone-operator dashboard has something to call.
app.get(`${PREFIX}/zones/priority`, (req, res) => {
  res.json({
    data: [],
    note: "Static stub — real endpoint will be backed by the RL routing model (v2).",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Sentriroad backend running → http://localhost:${config.port}${PREFIX}\n`);
});
