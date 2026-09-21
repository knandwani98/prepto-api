import { env } from "../config/env";
import type { SearchSnippet } from "../types/kit";

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

async function braveSearch(query: string): Promise<SearchSnippet[]> {
  if (!env.BRAVE_API_KEY) return [];

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "6");

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": env.BRAVE_API_KEY,
    },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as BraveResponse;
  return (data.web?.results ?? [])
    .filter((item) => item.title && item.url)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      description: item.description ?? "",
    }));
}

export async function searchInterviewDiscussion(
  company: string,
  role?: string,
): Promise<{ snippets: SearchSnippet[]; inferred: boolean }> {
  if (!env.BRAVE_API_KEY) {
    return { snippets: [], inferred: true };
  }

  const queries = [
    `"${company}" interview process`,
    `"${company}" ${role ? `${role} ` : ""}interview questions`.trim(),
  ];

  const seen = new Set<string>();
  const snippets: SearchSnippet[] = [];

  for (const query of queries) {
    const results = await braveSearch(query);
    for (const result of results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      snippets.push(result);
    }
  }

  return {
    snippets: snippets.slice(0, 10),
    inferred: snippets.length === 0,
  };
}
