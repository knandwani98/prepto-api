import { Router } from "express";
import { getAuth } from "@clerk/express";
import mongoose from "mongoose";
import { z } from "zod";
import { Kit } from "../models/Kit";
import { runKitJob } from "../jobs/runKitJob";
import { regenerateSection } from "../services/generateKit";
import { guessCompanyName } from "../services/crawl";
import type { GeneratedKit, KitInput, KitResearch, RegenerableSection } from "../types/kit";

export const kitsRouter = Router();

const MAX_PINNED_KITS = 5;

const createSchema = z.object({
  jobDescription: z.string().trim().min(50).max(20000),
  companyUrl: z.string().url(),
  daysUntilInterview: z.coerce.number().int().min(1).max(30),
  companyName: z.string().trim().max(120).optional(),
});

const regenerateSchema = z.object({
  section: z.enum([
    "companyBrief",
    "roleBreakdown",
    "questions",
    "flashcards",
    "quiz",
    "schedule",
  ]),
  instruction: z.string().trim().max(2000).optional(),
});

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function allowCreate(userId: string, max = 8, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

function userIdOf(req: Parameters<typeof getAuth>[0]) {
  const { userId } = getAuth(req);
  if (!userId) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return userId;
}

async function findOwnedKit(id: string | string[] | undefined, userId: string) {
  const kitId = Array.isArray(id) ? id[0] : id;
  if (!kitId || !mongoose.isValidObjectId(kitId)) return null;
  return Kit.findOne({ _id: kitId, clerkUserId: userId });
}

kitsRouter.post("/", async (req, res) => {
  const userId = userIdOf(req);
  if (!allowCreate(userId)) {
    res.status(429).json({ error: "Too many kits generated. Try again later." });
    return;
  }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const input = {
    ...parsed.data,
    companyName:
      parsed.data.companyName || guessCompanyName(parsed.data.companyUrl),
  };

  await Kit.deleteMany({ clerkUserId: userId });

  const kit = await Kit.create({
    clerkUserId: userId,
    status: "queued",
    input,
    practice: { flashcards: {}, quizResults: [], shortAnswerRatings: [] },
  });

  void runKitJob(String(kit._id));
  res.status(201).json(kit.toJSON());
});

kitsRouter.get("/", async (req, res) => {
  const userId = userIdOf(req);
  const kits = await Kit.find({ clerkUserId: userId })
    .select("-research")
    .sort({ createdAt: -1 });
  res.json(kits.map((kit) => kit.toJSON()));
});

kitsRouter.get("/:id", async (req, res) => {
  const userId = userIdOf(req);
  const kit = await findOwnedKit(req.params.id, userId);
  if (!kit) {
    res.status(404).json({ error: "Kit not found" });
    return;
  }
  res.json(kit.toJSON());
});

kitsRouter.patch("/:id", async (req, res) => {
  const userId = userIdOf(req);
  const kit = await findOwnedKit(req.params.id, userId);
  if (!kit) {
    res.status(404).json({ error: "Kit not found" });
    return;
  }

  if (req.body.kit) {
    kit.kit = req.body.kit;
    kit.markModified("kit");
  }
  if (req.body.practice) {
    kit.practice = req.body.practice;
    kit.markModified("practice");
  }
  if (typeof req.body.pinned === "boolean") {
    if (req.body.pinned) {
      if (!kit.pinnedAt) {
        const pinnedCount = await Kit.countDocuments({
          clerkUserId: userId,
          pinnedAt: { $ne: null },
        });
        if (pinnedCount >= MAX_PINNED_KITS) {
          res.status(400).json({ error: "You can pin up to 5 kits" });
          return;
        }
        kit.pinnedAt = new Date();
      }
    } else {
      kit.pinnedAt = null;
    }
  }
  await kit.save();
  res.json(kit.toJSON());
});

kitsRouter.delete("/:id", async (req, res) => {
  const userId = userIdOf(req);
  const kit = await findOwnedKit(req.params.id, userId);
  if (!kit) {
    res.status(404).json({ error: "Kit not found" });
    return;
  }

  await kit.deleteOne();
  res.status(204).end();
});

kitsRouter.post("/:id/regenerate", async (req, res) => {
  const userId = userIdOf(req);
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const kit = await findOwnedKit(req.params.id, userId);
  if (!kit) {
    res.status(404).json({ error: "Kit not found" });
    return;
  }
  if (kit.status !== "ready" || !kit.kit) {
    res.status(409).json({ error: "Kit is not ready to regenerate" });
    return;
  }

  try {
    const research = (kit.research ?? {
      pages: [],
      snippets: [],
      interviewProcessInferred: true,
    }) as KitResearch;

    const next = await regenerateSection(
      parsed.data.section as RegenerableSection,
      parsed.data.instruction,
      kit.input as KitInput,
      research,
      kit.kit as GeneratedKit,
    );
    kit.kit = next;
    kit.markModified("kit");
    await kit.save();
    res.json(kit.toJSON());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Regeneration failed";
    res.status(500).json({ error: message.slice(0, 500) });
  }
});
