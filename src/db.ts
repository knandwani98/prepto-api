import dns from "node:dns";
import mongoose from "mongoose";
import { env } from "./config/env";

dns.setDefaultResultOrder("ipv4first");

const CONNECT_OPTIONS: mongoose.ConnectOptions = {
  dbName: "prepto",
  family: 4,
  serverSelectionTimeoutMS: 30_000,
  connectTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeMongoError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ReplicaSetNoPrimary") ||
    message.includes("ENOTFOUND") ||
    message.includes("ECONNREFUSED") ||
    message.includes("querySrv")
  ) {
    return [
      message.split("\n")[0],
      "MongoDB Atlas did not accept this host.",
      "In Atlas → Network Access, allow 0.0.0.0/0 (or Render outbound IPs) and confirm the cluster is not paused.",
    ].join(" ");
  }
  return message.split("\n")[0] ?? message;
}

export async function connectDb() {
  mongoose.set("strictQuery", true);

  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, CONNECT_OPTIONS);
      console.log("Connected to MongoDB");
      return;
    } catch (error) {
      const detail = describeMongoError(error);
      console.error(`MongoDB connection attempt ${attempt}/${attempts} failed: ${detail}`);
      if (attempt === attempts) {
        throw new Error(detail);
      }
      await sleep(2000 * attempt);
    }
  }
}
