import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  BRAVE_API_KEY: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
