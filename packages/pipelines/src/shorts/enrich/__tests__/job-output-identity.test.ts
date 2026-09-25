import { beforeEach, expect, it, vi } from "vitest";
import type * as StorageModule from "@distribution/storage";
import type { JobContext } from "@distribution/jobs";

// This handler regression isolates external processing. It checks storage/registration
// identity, not whether the test's synthetic byte strings are valid or screened video.
const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  stored: new Map<string, string>(),
  registered: new Map<string, { id: string; storageKey: string; metadata: Record<string, unknown> }>(),
}));
vi.mock("node:fs/promises", () => ({
  copyFile: async (source: string, destination: string) => { state.files.set(destination, state.files.get(source)!); },
  writeFile: async () => {},
  // The SFX plan file is never written by the mocked mixer; a missing plan means no placements.
  readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
}));
vi.mock("@distribution/media", () => ({ GB: 1024 ** 3, assertDiskSpace: async () => {} }));
vi.mock("@distribution/providers", () => ({ AnthropicProvider: class {}, femaleOutroSpeech: vi.fn() }));
vi.mock("@distribution/storage", async importOriginal => ({
  ...await importOriginal<typeof StorageModule>(),
  getStorage: () => ({
    localPathFor: async (key: string) => key,
    putFile: async (key: string, file: string) => { state.stored.set(key, state.files.get(file)!); },
  }),
}));
vi.mock("../../screening", () => ({
  screenOriginal: async () => {},
  screenFinalClip: async (ctx: unknown, file: string) => ({ checkedBytes: state.files.get(file) }),
}));
vi.mock("../validate", () => ({ validateEnrichedMedia: async () => ({ width: 1080, height: 1920, durationSec: 12, sizeBytes: 100 }) }));
vi.mock("../../completion", () => ({ reconcileShortsProject: async () => {} }));
vi.mock("../../common", () => ({
  withScratch: async (_label: string, run: (directory: string) => Promise<unknown>) => run("/scratch"),
  loadProfile: async () => ({ accountId: "account", version: 1, product: { name: "SafeChoice" }, brand: {}, contentPreferences: { voice: "none", peoplePolicy: "no-people" } }),
}));
vi.mock("../../sidecars", () => ({
  ensureSfxKit: async () => "/sfx",
  runSfxMix: async (source: string, _kits: string[], output: string) => { state.files.set(output, state.files.get(source) + "+sfx"); return output; },
  runOutro: async (source: string, _name: string, output: string) => { state.files.set(output, state.files.get(source) + "+outro"); return output; },
}));
vi.mock("../../../generated-assets", () => ({
  saveGeneratedAsset: async (_db: unknown, value: { id: string; storageKey: string; metadata: Record<string, unknown> }) => {
    const id = state.registered.get(value.storageKey)?.id ?? value.id;
    state.registered.set(value.storageKey, { ...value, id });
    return id;
  },
}));

import { shortsEnrich } from "../job";

function context(jobId: string, steps: Array<"sfx" | "outro">): JobContext<"shorts.enrich"> {
  const rows = [
    { id: "parent", productId: "product", projectId: "project", type: "clip", candidateId: "candidate", sourceId: "source", storageKey: "parent.mp4", metadata: {} },
    { id: "candidate", projectId: "project", transcriptId: "transcript", startSec: 0, endSec: 10 },
    { id: "transcript", sourceId: "source", words: [] },
    { id: "source", productId: "product", storageKey: "original.mp4" },
  ];
  return {
    jobId, payload: { productId: "product", projectId: "project", assetId: "parent", steps },
    signal: new AbortController().signal,
    db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [rows.shift()] }) }) }) },
    progress: async () => {}, event: async () => {},
  } as unknown as JobContext<"shorts.enrich">;
}

beforeEach(() => {
  state.files.clear(); state.stored.clear(); state.registered.clear();
  state.files.set("parent.mp4", "original-clip-bytes");
});

it("keeps completed derivatives and their screening metadata intact when another enrichment job runs", async () => {
  const first = await shortsEnrich(context("job-one", ["outro"]));
  const firstBytes = state.stored.get(first.key);
  const firstRecord = structuredClone(state.registered.get(first.key));
  const second = await shortsEnrich(context("job-two", ["sfx", "outro"]));
  expect(second.key).not.toBe(first.key);
  expect(second.assetId).not.toBe(first.assetId);
  expect(state.stored.get(first.key)).toBe(firstBytes);
  expect(state.registered.get(first.key)).toEqual(firstRecord);
  expect(state.registered.get(second.key)?.metadata.outputScreening).toEqual({ checkedBytes: state.stored.get(second.key) });
});

it("reuses the same output and library identity when the same job retries", async () => {
  const first = await shortsEnrich(context("retry-job", ["outro"]));
  const retried = await shortsEnrich(context("retry-job", ["outro"]));
  expect(retried.assetId).toBe(first.assetId);
  expect(retried.key).toBe(first.key);
  expect(state.registered.size).toBe(1);
  expect(state.stored.size).toBe(1);
});
