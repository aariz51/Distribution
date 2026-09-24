import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveStorageRoot } from "../index";

describe("shared storage root", () => {
  it("resolves web, worker and CLI relative paths to the same workspace volume", () => {
    const root = resolveStorageRoot("storage");
    const workspace = path.dirname(root);
    for (const directory of ["apps/web", "apps/worker", "."]) {
      expect(resolveStorageRoot("./storage", path.join(workspace, directory))).toBe(root);
    }
  });
  it("preserves explicitly mounted volumes and rejects ambiguous packaged relative roots", () => {
    expect(resolveStorageRoot("/var/lib/distribution", "/tmp")).toBe("/var/lib/distribution");
    expect(() => resolveStorageRoot("storage", "/")).toThrow("absolute shared persistent");
  });
});
