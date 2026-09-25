import { describe, expect, it } from "vitest";
import { CONNECTABLE_PROVIDERS, PostizClient } from "../postiz";

function recording(response: () => Response) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    return response();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("channel connection", () => {
  it("asks Postiz for the provider's OAuth page with the raw key", async () => {
    const { calls, fetchImpl } = recording(() => Response.json({ url: "https://www.tiktok.com/v2/auth/authorize/?state=abc" }));
    const client = new PostizClient({ apiKey: "key-123", fetchImpl });
    await expect(client.connectUrl("tiktok")).resolves.toBe("https://www.tiktok.com/v2/auth/authorize/?state=abc");
    expect(calls).toEqual([{ url: "https://api.postiz.com/public/v1/social/tiktok", method: "GET", auth: "key-123" }]);
  });

  it("passes refresh to reconnect an existing channel", async () => {
    const { calls, fetchImpl } = recording(() => Response.json({ url: "https://accounts.google.com/o/oauth2/auth?x=1" }));
    await new PostizClient({ apiKey: "k", fetchImpl }).connectUrl("youtube", { refresh: "int-9" });
    expect(calls[0]!.url).toBe("https://api.postiz.com/public/v1/social/youtube?refresh=int-9");
  });

  it("refuses provider ids outside the supported list without calling Postiz", async () => {
    const { calls, fetchImpl } = recording(() => Response.json({ url: "https://x" }));
    await expect(new PostizClient({ apiKey: "k", fetchImpl }).connectUrl("../posts")).rejects.toThrow(/Unsupported channel type/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a response that is not an https sign-in link", async () => {
    const { fetchImpl } = recording(() => Response.json({ url: "javascript:alert(1)" }));
    await expect(new PostizClient({ apiKey: "k", fetchImpl }).connectUrl("tiktok")).rejects.toThrow(/did not return a sign-in link/);
  });

  it("offers TikTok and YouTube", () => {
    expect(CONNECTABLE_PROVIDERS.map((p) => p.id)).toEqual(expect.arrayContaining(["tiktok", "youtube"]));
  });

  it("treats removing an already-removed channel as done", async () => {
    const { calls, fetchImpl } = recording(() => new Response("not found", { status: 404 }));
    await new PostizClient({ apiKey: "k", fetchImpl }).deleteIntegration("gone");
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://api.postiz.com/public/v1/integrations/gone" });
  });
});
