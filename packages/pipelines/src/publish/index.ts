import type { JobQueue } from "@distribution/jobs";
import { publishPost, publishPoll } from "./jobs";

export { publishPost, publishPoll };

export function registerPublish(queue: JobQueue): void {
  queue.register("publish.post", publishPost);
  queue.register("publish.poll", publishPoll);
}
