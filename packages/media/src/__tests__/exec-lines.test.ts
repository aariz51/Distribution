import { expect, it } from "vitest";
import { run } from "../exec";

it("reassembles actual subprocess pipe chunks, UTF-8 and unterminated final lines", async () => {
  const stdout: string[] = [], stderr: string[] = [];
  const result = await run(process.execPath, ["-e", `
    const parts = [Buffer.from('out_time_'), Buffer.from('ms=1200\\r'), Buffer.from('\\n[screen] visual '), Buffer.from('120/1000 frames\\n'), Buffer.from([0xc3]), Buffer.from([0xa9]), Buffer.from(' final')];
    let i = 0;
    function send() { if (i === parts.length) return; process.stdout.write(parts[i]); process.stderr.write(parts[i++]); setTimeout(send, 25); }
    send();
  `], { timeoutMs: 5_000, onStdoutLine: line => stdout.push(line), onStderrLine: line => stderr.push(line) });
  expect(stdout).toEqual(["out_time_ms=1200", "[screen] visual 120/1000 frames", "é final"]);
  expect(stderr).toEqual(stdout);
  expect(result.stdout).toContain("é final");
});

it("preserves complete fragmented failure lines in the diagnostic tail", async () => {
  await expect(run(process.execPath, ["-e", `process.stderr.write('decoder '); setTimeout(() => { process.stderr.write('failed: corrupt packet'); process.exitCode = 2; }, 25);`], { timeoutMs: 5_000 })).rejects.toThrow("decoder failed: corrupt packet");
});

it("handles a large newline-free subprocess record without losing later progress", async () => {
  const lines: string[] = [];
  await run(process.execPath, ["-e", `
    async function send() {
      for (let i = 0; i < 512; i++) {
        if (!process.stdout.write('x'.repeat(8192))) await new Promise(resolve => process.stdout.once('drain', resolve));
      }
      process.stdout.write('\\nprogress=end\\n');
    }
    send();
  `], { timeoutMs: 5_000, onStdoutLine: line => lines.push(line) });
  expect(lines.map(line => line.length)).toEqual([4 * 1024 * 1024, 12]);
  expect(lines[1]).toBe("progress=end");
});
