import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { postJsonWithRetry } from "../policy";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

it("does not send a provider request after its job has already been cancelled", async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{"choices":[]}'); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const controller = new AbortController();
  controller.abort();
  await expect(postJsonWithRetry({ url: `http://127.0.0.1:${address.port}`, headers: {}, body: {}, provider: "test", signal: controller.signal })).rejects.toThrow(/cancelled/);
  expect(requests).toBe(0);
});
