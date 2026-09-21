import Groq from "groq-sdk";
import { env } from "../config/env";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  return JSON.parse(candidate);
}

export async function groqJson(system: string, user: string): Promise<unknown> {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    temperature: 0.4,
    max_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");
  return extractJson(content);
}
