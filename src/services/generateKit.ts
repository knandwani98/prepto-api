import { randomUUID } from "node:crypto";
import { z } from "zod";
import { groqJson } from "./groq";
import type {
  GeneratedKit,
  KitInput,
  KitResearch,
  RegenerableSection,
} from "../types/kit";

const companyBriefSchema = z.object({
  name: z.string().min(1),
  whatTheyDo: z.string().min(1),
  culture: z.string().min(1),
  products: z.array(z.string()).default([]),
  hiringSignals: z.array(z.string()).default([]),
});

const roleBreakdownSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  mustHaves: z.array(z.string()).default([]),
  niceToHaves: z.array(z.string()).default([]),
  interviewLoop: z.array(z.string()).default([]),
  successLooksLike: z.string().default(""),
});

const questionSchema = z.object({
  id: z.string().optional(),
  category: z.enum([
    "behavioral",
    "technical",
    "role",
    "company",
    "curveball",
  ]),
  question: z.string().min(1),
  whyAsked: z.string().default(""),
  talkingPoints: z.array(z.string()).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});

const flashcardSchema = z.object({
  id: z.string().optional(),
  front: z.string().min(1),
  back: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const quizSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().min(1),
  options: z
    .array(z.string())
    .min(2)
    .transform((options) => {
      const next = [...options];
      while (next.length < 4) next.push("None of the above");
      return next.slice(0, 4);
    }),
  correctIndex: z.number().int().min(0).max(3).default(0),
  explanation: z.string().default(""),
  source: z.string().default("flashcard"),
});

const scheduleTaskSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  relatedIds: z.array(z.string()).default([]),
});

const scheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  tasks: z.array(scheduleTaskSchema).default([]),
});

const generatedKitSchema = z.object({
  companyBrief: companyBriefSchema,
  roleBreakdown: roleBreakdownSchema,
  questions: z.array(questionSchema).min(1),
  flashcards: z.array(flashcardSchema).min(1),
  quiz: z.array(quizSchema).min(1),
  schedule: z.array(scheduleDaySchema).min(1),
});

function withIds<T extends { id?: string }>(items: T[]): Array<T & { id: string }> {
  return items.map((item) => ({
    ...item,
    id: item.id && item.id.length > 0 ? item.id : randomUUID(),
  }));
}

function normalizeKit(raw: unknown): GeneratedKit {
  const parsed = generatedKitSchema.parse(raw);
  return {
    ...parsed,
    questions: withIds(parsed.questions),
    flashcards: withIds(parsed.flashcards),
    quiz: withIds(parsed.quiz),
    schedule: parsed.schedule.map((day) => ({
      ...day,
      tasks: withIds(day.tasks),
    })),
  };
}

function researchContext(input: KitInput, research: KitResearch): string {
  const pages = research.pages
    .map((page) => `URL: ${page.url}\nTitle: ${page.title}\n${page.text}`)
    .join("\n\n---\n\n")
    .slice(0, 12000);

  const snippets = research.snippets.length
    ? research.snippets
        .map((item) => `- ${item.title} (${item.url}): ${item.description}`)
        .join("\n")
    : "No public interview-process sources were available. Infer carefully and say so in hiringSignals.";

  return `Company URL: ${input.companyUrl}
Guessed company name: ${input.companyName ?? "unknown"}
Days until interview: ${input.daysUntilInterview}
Interview process sourced: ${research.interviewProcessInferred ? "inferred" : "from public snippets"}

JOB DESCRIPTION:
${input.jobDescription.slice(0, 8000)}

COMPANY SITE RESEARCH:
${pages || "No crawlable pages. Rely on the job description and URL."}

PUBLIC INTERVIEW DISCUSSION:
${snippets}`;
}

const SYSTEM = `You are an expert interview coach. Return ONLY valid JSON matching the schema. Be specific to this company and role — no generic filler. If interview-process evidence is missing, mark claims as inferred in hiringSignals.

JSON schema:
{
  "companyBrief": {
    "name": string,
    "whatTheyDo": string,
    "culture": string,
    "products": string[],
    "hiringSignals": string[]
  },
  "roleBreakdown": {
    "title": string,
    "summary": string,
    "mustHaves": string[],
    "niceToHaves": string[],
    "interviewLoop": string[],
    "successLooksLike": string
  },
  "questions": [{ "id": string, "category": "behavioral"|"technical"|"role"|"company"|"curveball", "question": string, "whyAsked": string, "talkingPoints": string[], "difficulty": "easy"|"medium"|"hard" }],
  "flashcards": [{ "id": string, "front": string, "back": string, "tags": string[] }],
  "quiz": [{ "id": string, "prompt": string, "options": [string, string, string, string], "correctIndex": 0|1|2|3, "explanation": string, "source": string }],
  "schedule": [{ "day": number, "focus": string, "tasks": [{ "id": string, "label": string, "relatedIds": string[] }] }]
}

Counts:
- 12-16 questions mixing behavioral, technical/role, and company-specific
- 16-20 flashcards
- 8-12 multiple-choice quiz items derived from the flashcards/questions
- schedule with exactly N days (N = days until interview). Early days: role fundamentals. Later days: company/culture and mock answers.`;

export async function generateKit(
  input: KitInput,
  research: KitResearch,
): Promise<GeneratedKit> {
  const user = `Generate a full interview prep kit.\n\n${researchContext(input, research)}`;

  try {
    return normalizeKit(await groqJson(SYSTEM, user));
  } catch {
    const briefRole = await groqJson(
      `${SYSTEM}\nReturn JSON with only companyBrief, roleBreakdown, and schedule.`,
      user,
    );
    const practice = await groqJson(
      `${SYSTEM}\nReturn JSON with only questions, flashcards, and quiz.`,
      user,
    );
    return normalizeKit({
      ...(briefRole as object),
      ...(practice as object),
    });
  }
}

const sectionSchemas: Record<RegenerableSection, z.ZodType> = {
  companyBrief: companyBriefSchema,
  roleBreakdown: roleBreakdownSchema,
  questions: z.array(questionSchema).min(1),
  flashcards: z.array(flashcardSchema).min(1),
  quiz: z.array(quizSchema).min(1),
  schedule: z.array(scheduleDaySchema).min(1),
};

export async function regenerateSection(
  section: RegenerableSection,
  instruction: string | undefined,
  input: KitInput,
  research: KitResearch,
  current: GeneratedKit,
): Promise<GeneratedKit> {
  const system = `You rewrite one section of an interview kit. Return JSON as { "${section}": <value matching that field's schema> }. Keep it specific to the company and role.`;
  const user = `${researchContext(input, research)}

CURRENT SECTION JSON:
${JSON.stringify(current[section], null, 2)}

USER INSTRUCTION:
${instruction?.trim() || "Improve this section. Keep useful specifics, tighten generic language."}`;

  const raw = (await groqJson(system, user)) as Record<string, unknown>;
  const value = raw[section] ?? raw;
  const parsed = sectionSchemas[section].parse(value);

  const next: GeneratedKit = { ...current, [section]: parsed };

  if (section === "questions") next.questions = withIds(next.questions);
  if (section === "flashcards") next.flashcards = withIds(next.flashcards);
  if (section === "quiz") next.quiz = withIds(next.quiz);
  if (section === "schedule") {
    next.schedule = next.schedule.map((day) => ({
      ...day,
      tasks: withIds(day.tasks),
    }));
  }

  return next;
}
