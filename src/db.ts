import mongoose from "mongoose";
import { env } from "./config/env";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
}
