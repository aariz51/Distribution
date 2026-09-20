import type { JobQueue } from "@distribution/jobs";
import { brandPalette } from "./brand/palette";
import { sourceIngest } from "./shorts/ingest";
import { sourceTranscribe } from "./shorts/transcribe";
import { shortsRank } from "./shorts/rank";
import { shortsCut } from "./shorts/cut";
import { shortsThumbnail } from "./shorts/thumbnail";
import { copyGenerate } from "./copy/job";
import { registerEnrich, shortsEnrich } from "./shorts/enrich";
import { registerPublish, publishPost, publishPoll } from "./publish";

export { brandPalette, sourceIngest, sourceTranscribe, shortsRank, shortsCut, shortsThumbnail, copyGenerate, shortsEnrich, publishPost, publishPoll };
export * from "./copy/platform-copy";
export * from "./shorts/ranking";
export * from "./shorts/enrich";
export * from "./publish";

/** Register every implemented handler. Types in the registry without a
 *  handler here fail fast with "no handler registered" instead of hanging. */
export function registerPipelines(queue: JobQueue): void {
  queue.register("brand.palette", brandPalette);
  queue.register("source.ingest", sourceIngest);
  queue.register("source.transcribe", sourceTranscribe);
  queue.register("shorts.rank", shortsRank);
  queue.register("shorts.cut", shortsCut);
  queue.register("shorts.thumbnail", shortsThumbnail);
  queue.register("copy.generate", copyGenerate);
  registerEnrich(queue);
  registerPublish(queue);
}
