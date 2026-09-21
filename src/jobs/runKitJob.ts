import { Kit } from "../models/Kit";
import { crawlCompanySite, guessCompanyName } from "../services/crawl";
import { searchInterviewDiscussion } from "../services/search";
import { generateKit } from "../services/generateKit";
import type { KitInput, KitResearch } from "../types/kit";

type StoredKit = NonNullable<Awaited<ReturnType<typeof Kit.findById>>>;

async function persist(kitId: string, apply: (kit: StoredKit) => void) {
  const kit = await Kit.findById(kitId);
  if (!kit) return null;
  apply(kit);
  await kit.save();
  return kit;
}

export async function runKitJob(kitId: string) {
  try {
    const started = await persist(kitId, (current) => {
      current.status = "researching";
      current.error = undefined;
    });
    if (!started) return;

    const input = started.input as KitInput | undefined;
    if (!input) throw new Error("Kit is missing input");
    const companyName = input.companyName || guessCompanyName(input.companyUrl);

    const [pages, search] = await Promise.all([
      crawlCompanySite(input.companyUrl),
      searchInterviewDiscussion(companyName),
    ]);

    const research: KitResearch = {
      pages,
      snippets: search.snippets,
      interviewProcessInferred: search.inferred,
    };

    const researched = await persist(kitId, (current) => {
      current.set("research", research);
      current.status = "generating";
      if (!input.companyName) current.set("input.companyName", companyName);
    });
    if (!researched) return;

    const generated = await generateKit(
      { ...input, companyName },
      research,
    );

    await persist(kitId, (current) => {
      current.set("kit", generated);
      current.set("input.companyName", generated.companyBrief.name);
      current.status = "ready";
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Kit generation failed";
    await persist(kitId, (current) => {
      current.status = "failed";
      current.error = message.slice(0, 500);
    });
  }
}
