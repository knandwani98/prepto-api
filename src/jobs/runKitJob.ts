import { Kit } from "../models/Kit";
import { crawlCompanySite, guessCompanyName } from "../services/crawl";
import { searchInterviewDiscussion } from "../services/search";
import { generateKit } from "../services/generateKit";
import type { KitInput, KitResearch } from "../types/kit";

export async function runKitJob(kitId: string) {
  const kit = await Kit.findById(kitId);
  if (!kit) return;

  try {
    kit.status = "researching";
    kit.error = undefined;
    await kit.save();

    const input = kit.input as KitInput | undefined;
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

    kit.set("research", research);
    kit.status = "generating";
    if (!input.companyName) kit.set("input.companyName", companyName);
    await kit.save();

    const generated = await generateKit(
      { ...input, companyName },
      research,
    );

    kit.set("kit", generated);
    kit.set("input.companyName", generated.companyBrief.name);
    kit.status = "ready";
    await kit.save();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Kit generation failed";
    kit.status = "failed";
    kit.error = message.slice(0, 500);
    await kit.save();
  }
}
