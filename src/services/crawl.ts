import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import type { CrawledPage } from "../types/kit";

const MAX_PAGES = 8;
const MAX_DEPTH = 2;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 500_000;
const MAX_TEXT_CHARS = 3500;

const PRIORITY_KEYWORDS = [
  "about",
  "careers",
  "jobs",
  "culture",
  "values",
  "mission",
  "team",
  "story",
  "who-we",
  "company",
  "life",
  "engineering",
  "hiring",
  "work-with",
  "join",
];

const SKIP_KEYWORDS = [
  "login",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "privacy",
  "terms",
  "cookie",
  "legal",
  "cart",
  "checkout",
  "account",
  "press-kit",
  "mailto:",
];

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80") ||
      v.startsWith("::ffff:127.") ||
      v.startsWith("::ffff:10.") ||
      v.startsWith("::ffff:192.168.")
    );
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid company URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("That host is not allowed");
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error("Private IP addresses are not allowed");
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Private IP addresses are not allowed");
  }

  return url;
}

async function fetchSafe(
  url: URL,
  origin: string,
  redirectsLeft = 3,
): Promise<{ finalUrl: URL; html: string } | null> {
  await assertSafeUrl(url.toString());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "PreptoBot/1.0 (+https://prepto.dev; interview prep research)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location || redirectsLeft <= 0) return null;
      const next = new URL(location, url);
      if (next.origin !== origin) return null;
      return fetchSafe(next, origin, redirectsLeft - 1);
    }

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("xml")) {
      return null;
    }

    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;

    return { finalUrl: url, html: buf.toString("utf8") };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseRobots(text: string): string[] {
  const disallows: string[] = [];
  let applies = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (key.toLowerCase() === "user-agent") {
      applies = value === "*";
    } else if (applies && key.toLowerCase() === "disallow" && value) {
      disallows.push(value);
    }
  }
  return disallows;
}

function isDisallowed(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => rule !== "/" && pathname.startsWith(rule));
}

function scorePath(pathname: string): number {
  const lower = pathname.toLowerCase();
  if (SKIP_KEYWORDS.some((word) => lower.includes(word))) return -1;
  if (pathname === "/" || pathname === "") return 80;
  let score = 0;
  for (const keyword of PRIORITY_KEYWORDS) {
    if (lower.includes(keyword)) score += 20;
  }
  return score;
}

function extractPage(html: string, url: string): CrawledPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, canvas").remove();

  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    url;

  const meta = [
    $('meta[name="description"]').attr("content"),
    $('meta[property="og:description"]').attr("content"),
    $('script[type="application/ld+json"]').first().text(),
  ]
    .filter(Boolean)
    .join("\n");

  const main = $("main, article, [role='main']").text() || $("body").text();
  const text = `${meta}\n${main}`.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

  return { url, title, text };
}

function collectLinks($: cheerio.CheerioAPI, pageUrl: URL): URL[] {
  const found: URL[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const next = new URL(href, pageUrl);
      if (next.origin !== pageUrl.origin) return;
      next.hash = "";
      found.push(next);
    } catch {
      // ignore malformed hrefs
    }
  });
  return found;
}

export async function crawlCompanySite(rawUrl: string): Promise<CrawledPage[]> {
  const start = await assertSafeUrl(rawUrl);
  const origin = start.origin;

  let robotsRules: string[] = [];
  try {
    const robots = await fetchSafe(new URL("/robots.txt", origin), origin);
    if (robots) robotsRules = parseRobots(robots.html);
  } catch {
    robotsRules = [];
  }

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const queue: { url: URL; depth: number }[] = [{ url: start, depth: 0 }];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    queue.sort((a, b) => scorePath(b.url.pathname) - scorePath(a.url.pathname));
    const item = queue.shift();
    if (!item) break;

    const href = item.url.toString();
    if (visited.has(href)) continue;
    visited.add(href);

    if (isDisallowed(item.url.pathname, robotsRules)) continue;
    if (scorePath(item.url.pathname) < 0) continue;

    const fetched = await fetchSafe(item.url, origin);
    if (!fetched) continue;

    const $ = cheerio.load(fetched.html);
    pages.push(extractPage(fetched.html, fetched.finalUrl.toString()));

    if (item.depth >= MAX_DEPTH) continue;
    for (const link of collectLinks($, fetched.finalUrl)) {
      if (!visited.has(link.toString()) && scorePath(link.pathname) >= 0) {
        queue.push({ url: link, depth: item.depth + 1 });
      }
    }
  }

  return pages;
}

export function guessCompanyName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const root = host.split(".")[0] ?? "Company";
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return "Company";
  }
}
