import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./config/env";
import { connectDb } from "./db";
import { requireUser } from "./middleware/clerk";
import { kitsRouter } from "./routes/kits";

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    db: dbOk ? "connected" : "disconnected",
  });
});

app.use(clerkMiddleware());

app.use("/kits", requireUser, kitsRouter);

app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message || "Server error" });
  },
);

await connectDb();
app.listen(env.PORT, () => {
  console.log(`Prepto API listening on ${env.PORT}`);
});
