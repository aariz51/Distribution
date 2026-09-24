import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, writeFile, readFile, mkdir } from "node:fs/promises";
import { PipelineError } from "@distribution/core";
import { bin, run, probeMedia, chunkWords, type RunOptions } from "@distribution/media";

/**
 * The AutoShorts Python sidecars, vendored verbatim under vendor/autoshorts-py/assets.
 * Contracts (argv / stdin JSON / stdout) are unchanged from the desktop app — see
 * docs/inventory/autoshorts-python-frontend.md §1. Every runner returns the path
 * the script printed on stdout (preferred over the requested --output, as the Rust
 * callers did) after verifying it exists.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export function assetsDir(): string {
  return process.env.AUTOSHORTS_ASSETS_DIR ?? path.resolve(here, "../../../../vendor/autoshorts-py/assets");
}

export const YUNET_MODEL = () => path.join(assetsDir(), "face_detection_yunet_2023mar.onnx");

async function exists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

export interface SidecarOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onLog?: (line: string) => void;
  step?: string;
  /** Extra environment for the sidecar (merged over process.env). */
  env?: Record<string, string | undefined>;
}

/** Run a sidecar; stderr `[tag]` lines are forwarded to onLog; stdout's last non-empty line is returned. */
export async function runSidecar(script: string, args: string[], opts: SidecarOptions & { input?: string } = {}): Promise<{ lastLine: string; stdout: string }> {
  const file = path.join(assetsDir(), script);
  if (!(await exists(file))) throw new PipelineError(`sidecar missing: ${file}`, { step: opts.step });
  const runOpts: RunOptions = {
    timeoutMs: opts.timeoutMs ?? 30 * 60_000,
    signal: opts.signal,
    input: opts.input,
    step: opts.step ?? script,
    cwd: assetsDir(),
    env: { ...process.env, ...(opts.env ?? {}), PYTHONUNBUFFERED: "1" },
    onStderrLine: (line) => {
      if (opts.onLog && /^\[[a-z]+\]/.test(line)) opts.onLog(line);
    },
  };
  const res = await run(bin("python"), [file, ...args], runOpts);
  const lines = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { lastLine: lines[lines.length - 1] ?? "", stdout: res.stdout };
}

async function outputPath(printed: string, fallback: string, step: string): Promise<string> {
  const candidate = printed && !printed.startsWith("{") ? printed : fallback;
  if (!(await exists(candidate))) throw new PipelineError(`${step}: output not found at ${candidate}`, { step });
  return candidate;
}

/** facetrack.py — returns the raw JSON line (parsed by media/ports facetrack-plan). Never throws on "none". */
export async function runFacetrack(video: string, startSec: number, endSec: number, opts: SidecarOptions = {}): Promise<string> {
  try {
    const { lastLine } = await runSidecar("facetrack.py", ["--video", video, "--model", YUNET_MODEL(), "--start", startSec.toFixed(3), "--end", endSec.toFixed(3)], { ...opts, step: "facetrack", timeoutMs: opts.timeoutMs ?? 10 * 60_000 });
    return lastLine;
  } catch (err) {
    opts.onLog?.(`[facetrack] failed soft: ${err instanceof Error ? err.message : String(err)}`);
    return JSON.stringify({ mode: "none", reason: "sidecar error" });
  }
}

export interface CaptionSpecInput {
  width: number;
  height: number;
  duration: number;
  style: string;
  chunks: { text: string; start: number; end: number }[];
  outDir: string;
  /** brand colour overrides applied to the chosen preset (studio path reads these keys) */
  colors?: { textColor?: string; highlightColor?: string; strokeColor?: string; backgroundColor?: string };
}

/** captions.py — stdin JSON → path of the ffmpeg concat list (PNG overlay track). */
export async function runCaptions(spec: CaptionSpecInput, opts: SidecarOptions = {}): Promise<string> {
  const payload = {
    width: spec.width,
    height: spec.height,
    duration: spec.duration,
    style: spec.style,
    assets: assetsDir(),
    out_dir: spec.outDir,
    chunks: spec.chunks,
    ...(spec.colors ? { style_overrides: spec.colors } : {}),
  };
  const { lastLine } = await runSidecar("captions.py", [], { ...opts, step: "captions", input: JSON.stringify(payload), timeoutMs: opts.timeoutMs ?? 10 * 60_000 });
  return outputPath(lastLine, path.join(spec.outDir, "captions.txt"), "captions");
}

/** title_bar.py — burns a persistent top title that avoids detected faces. */
export async function runTitleBar(video: string, text: string, output: string, opts: SidecarOptions & { colors?: { fill?: string; stroke?: string }; artifactDirectory?: string } = {}): Promise<string> {
  const args = ["--video", video, "--text", text, "--output", output, "--assets", assetsDir()];
  if (opts.artifactDirectory) {
    await mkdir(opts.artifactDirectory, { recursive: true });
    args.push("--overlay-output", path.join(opts.artifactDirectory, "title.png"), "--layout-output", path.join(opts.artifactDirectory, "layout.json"));
  }
  if (opts.colors?.fill) args.push("--fill", opts.colors.fill);
  if (opts.colors?.stroke) args.push("--stroke", opts.colors.stroke);
  const { lastLine } = await runSidecar("title_bar.py", args, { ...opts, step: "title", timeoutMs: opts.timeoutMs ?? 20 * 60_000 });
  return outputPath(lastLine, output, "title");
}

/** make_sfx.py + sfx_mix.py — synthesised kit, then mix under the clip. */
export async function ensureSfxKit(kitDir: string, opts: SidecarOptions = {}): Promise<string> {
  if (!(await exists(path.join(kitDir, "riser.wav")))) {
    await runSidecar("make_sfx.py", ["--out", kitDir], { ...opts, step: "sfx_kit", timeoutMs: 5 * 60_000 });
  }
  return kitDir;
}

export async function runSfxMix(video: string, kitDirs: string[], output: string, opts: SidecarOptions & { transcriptJson?: string; scenes?: string } = {}): Promise<string> {
  const args = ["--video", video, "--kit", kitDirs.join(","), "--output", output];
  if (opts.scenes) args.push("--scenes", opts.scenes);
  if (opts.transcriptJson) args.push("--transcript", opts.transcriptJson);
  const { lastLine } = await runSidecar("sfx_mix.py", args, { ...opts, step: "sfx", timeoutMs: opts.timeoutMs ?? 20 * 60_000 });
  return outputPath(lastLine, output, "sfx");
}

export interface CreativeBrand {
  name: string;
  colorInk: string;
  colorAccent: string;
  colorCanvas: string;
  colorGround: string;
  fontDisplay?: string;
  fontBody?: string;
  fontHeavy?: string;
  logoPath?: string;
  ctaText?: string;
}

/** creative.py --pick-frame — scores sampled frames and returns the best (least text-like, sharpest). */
export async function pickFrame(frames: string[], opts: SidecarOptions = {}): Promise<{ path: string; score: number; textiness: number } | null> {
  const { lastLine } = await runSidecar("creative.py", ["--pick-frame", ...frames], { ...opts, step: "pick_frame", timeoutMs: 5 * 60_000 });
  try {
    const j = JSON.parse(lastLine) as { best?: { path: string; score: number; textiness: number } };
    return j.best ?? null;
  } catch {
    return null;
  }
}

/** creative.py compose mode — stdin JSON → PNG path. Layouts: bottom-anchor | top-banner | split | dark-editorial. */
export async function runCreative(spec: { frame: string; headline: string; kicker?: string; attribution?: string; brand: CreativeBrand; layout: string; size: [number, number]; screenshot?: string; out: string }, opts: SidecarOptions = {}): Promise<string> {
  const { lastLine } = await runSidecar("creative.py", [], { ...opts, step: "creative", input: JSON.stringify(spec), timeoutMs: 5 * 60_000 });
  const file = await outputPath(lastLine, spec.out, "creative");
  await validateCreative(file, spec.size, opts.signal);
  return file;
}

/** Verify the renderer's bytes before the library advertises a usable cover. */
export async function validateCreative(file: string, size: [number, number], signal?: AbortSignal): Promise<void> {
  const probe = await probeMedia(file, { signal });
  if (probe.videoCodec !== "png" || probe.width !== size[0] || probe.height !== size[1] || !probe.sizeBytes) {
    throw new PipelineError("Rendered cover is not a PNG at the requested dimensions", { step: "creative" });
  }
  await run(bin("ffmpeg"), ["-v", "error", "-xerror", "-err_detect", "explode", "-i", file, "-map", "0:v:0", "-f", "null", "-"], { signal, step: "creative", timeoutMs: 60_000 });
}

/** outro.py — branded end card (+ optional cloned voice line). */
export async function runOutro(clip: string, appName: string, output: string, opts: SidecarOptions & { logo?: string; transcriptJson?: string; line?: string; voiceAudioPath?: string; voice: "female" | "none" }): Promise<string> {
  const args = ["--clip", clip, "--app-name", appName, "--output", output, "--assets", assetsDir()];
  if (opts.logo) args.push("--logo", opts.logo);
  if (opts.transcriptJson) args.push("--transcript", opts.transcriptJson);
  if (opts.line) args.push("--line", opts.line);
  args.push("--voice", opts.voice === "female" ? "audio" : "none");
  if (opts.voice === "female") {
    if (!opts.voiceAudioPath) throw new PipelineError("Female voice audio is missing", { step: "outro" });
    args.push("--voice-audio", opts.voiceAudioPath);
  }
  const { lastLine } = await runSidecar("outro.py", args, { ...opts, step: "outro", timeoutMs: opts.timeoutMs ?? 30 * 60_000 });
  return outputPath(lastLine, output, "outro");
}

/** clean_source.py — remove burned-in caption band, isolate voice (Demucs when available). */
export async function runCleanSource(video: string, output: string, opts: SidecarOptions & { audioClean?: boolean } = {}): Promise<string> {
  const args = ["--video", video, "--output", output];
  if (opts.audioClean === false) args.push("--no-audio-clean");
  const { lastLine } = await runSidecar("clean_source.py", args, { ...opts, step: "clean", timeoutMs: opts.timeoutMs ?? 90 * 60_000 });
  return outputPath(lastLine, output, "clean");
}

// ─── B-roll ──────────────────────────────────────────────────────────────────

export type PeoplePolicy = "off" | "no-people" | "no-women";

export interface BrollOptions extends SidecarOptions {
  plan: (prompt: string) => Promise<string>;
  validateComposite?: (file: string) => Promise<unknown>;
  text?: BrollText;
  /** Steers scene selection; the Rust caller passed the candidate hook. */
  topic: string;
  /** Clip-relative `{"words":[{text,start,end}]}` JSON (see `rebaseWords`). Optional. */
  transcriptJsonPath?: string;
  output: string;
  /** b-rolls skill checkout. Default `BROLLS_SKILL_DIR` → `vendor/b-rolls`. */
  skillDir?: string;
  /** Always passed: the script's own default is `no-women`. */
  peoplePolicy: PeoplePolicy;
  /** Parent of the pinned `video-use-<sha12>` checkout (`B_ROLLS_CACHE_DIR`); default `~/.cache/b-rolls`. */
  videoUseCacheDir?: string;
}

export function brollSkillDir(): string {
  return process.env.BROLLS_SKILL_DIR ?? path.resolve(here, "../../../../vendor/b-rolls");
}

/** Pure argv builder — mirrors `broll.rs:141-156` exactly. */
export function brollArgv(clip: string, opts: Pick<BrollOptions, "topic" | "transcriptJsonPath" | "output" | "skillDir">, assets = assetsDir()): string[] {
  const args = ["--clip", clip, "--topic", opts.topic, "--skill-dir", opts.skillDir ?? brollSkillDir(), "--output", opts.output, "--assets", assets];
  if (opts.transcriptJsonPath) args.push("--transcript", opts.transcriptJsonPath);
  return args;
}

/** Pure env builder: policy is explicit; API keys pass through from `base`. */
export function brollEnv(opts: Pick<BrollOptions, "peoplePolicy" | "videoUseCacheDir">, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { BROLL_PEOPLE_POLICY: opts.peoplePolicy };
  for (const k of ["PEXELS_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"]) if (base[k]) env[k] = base[k];
  const cache = opts.videoUseCacheDir ?? base.B_ROLLS_CACHE_DIR;
  if (cache) env.B_ROLLS_CACHE_DIR = cache;
  return env;
}

/** broll_pipeline.py — plans scenes with the LLM, sources Pexels/Wikimedia clips,
 *  renders through the pinned video-use checkout. Writes `edit_<stem>/scene_plan.json`
 *  beside the clip, so callers should pass a clip that lives in scratch. */
export async function runBroll(clip: string, opts: BrollOptions): Promise<string> {
  const env = { ...(opts.env ?? {}), ...brollEnv(opts), ANTHROPIC_API_KEY: "", ANTHROPIC_OAUTH_TOKEN: "" };
  const prepared = await runSidecar("broll_pipeline.py", [...brollArgv(clip, opts), "--prepare-only"], { ...opts, env, step: "broll" });
  const { prompt } = JSON.parse(prepared.lastLine) as { prompt: string | null };
  if (!prompt) throw new PipelineError("B-roll requires a transcript with words", { step: "broll" });
  const reply = await opts.plan(prompt);
  const replyPath = path.join(path.dirname(clip), "broll-planning-reply.txt");
  await writeFile(replyPath, reply);
  for (let attempt = 0; ; attempt++) {
    const { lastLine } = await runSidecar("broll_pipeline.py", [...brollArgv(clip, opts), "--planning-reply", replyPath, ...(attempt ? ["--render-existing"] : []), ...(opts.text ? ["--external-text"] : [])], {
      ...opts, step: "broll", timeoutMs: opts.timeoutMs ?? 60 * 60_000, env,
    });
    const rendered = await outputPath(lastLine, opts.output, "broll");
    const composite = opts.text ? await restoreBrollText(clip, rendered, opts.text, opts) : rendered;
    try {
      await opts.validateComposite?.(composite);
      return composite;
    } catch (error) {
      const report = error instanceof PipelineError ? error.details?.screening as { visual?: { atSec?: number }; audio?: { status?: string } } | undefined : undefined;
      const atSec = report?.visual?.atSec;
      if (report?.audio?.status !== "allowed" || typeof atSec !== "number" || !Number.isFinite(atSec)) throw error;
      const planPath = brollScenePlanPath(clip);
      const plan = JSON.parse(await readFile(planPath, "utf8"));
      if (!replaceBlockedStockScene(plan, atSec)) throw error;
      await writeFile(planPath, JSON.stringify(plan));
      opts.onLog?.(`Replacing blocked stock scene at ${atSec}s with the original; rebuilding and screening the full composite`);
    }
  }
}

/** Remove only the offending replacement; never turn a no-stock result into success. */
export function replaceBlockedStockScene(plan: { scenes: { kind: string; start: number; end: number; [key: string]: unknown }[] }, atSec: number): boolean {
  if (!Number.isFinite(atSec) || !Array.isArray(plan.scenes)) return false;
  const scene = plan.scenes.find(s => s.kind === "video" && s.start <= atSec && atSec < s.end);
  if (!scene || plan.scenes.filter(s => s.kind === "video").length < 2) return false;
  scene.kind = "source";
  for (const key of ["file", "offset", "source_url", "crop_x", "crop_y"]) delete scene[key];
  scene.description = "Original footage replacing a stock scene blocked by composite screening";
  return true;
}

/** Where broll_pipeline.py leaves its scene plan for `clip` (consumed by sfx_mix.py --scenes). */
export function brollScenePlanPath(clip: string): string {
  return path.join(path.dirname(clip), `edit_${path.basename(clip, path.extname(clip))}`, "scene_plan.json");
}


export interface BrollText {
  words: { text: string; start: number; end: number }[];
  captionPreset?: string;
  colors?: CaptionSpecInput["colors"];
  title?: string;
  titleStroke?: string;
  titleOverlayPath?: string;
  captionOffsetY?: number;
}

/** Draw exact text only on replacement scenes; source scenes already carry their text. */
export async function restoreBrollText(source: string, rendered: string, text: BrollText, opts: SidecarOptions = {}): Promise<string> {
  const plan = JSON.parse(await readFile(brollScenePlanPath(source), "utf8")) as { scenes: { kind: string; start: number; end: number }[] };
  const replacements = plan.scenes.filter(scene => scene.kind === "video");
  if (!replacements.length) throw new PipelineError("B-roll contains no stock footage", { step: "broll" });
  for (const scene of replacements) if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start < 0 || scene.end <= scene.start) throw new PipelineError("Invalid B-roll scene timing", { step: "broll" });
  const enable = replacements.map(scene => `gte(t,${scene.start})*lt(t,${scene.end})`).join("+");
  const media = await probeMedia(rendered, { signal: opts.signal });
  const dir = path.join(path.dirname(source), "broll-text");
  await mkdir(dir, { recursive: true });
  const inputs = ["-i", rendered];
  const filters: string[] = [];
  let base = "0:v", index = 1;
  const offset = text.captionOffsetY ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= media.height!) throw new PipelineError("Invalid persisted title band", { step: "broll" });
  if (offset) {
    filters.push(`[0:v]drawbox=x=0:y=0:w=iw:h=${offset}:color=black:t=fill:enable='${enable}'[band]`);
    base = "band";
  }
  if (text.captionPreset) {
    const chunks = chunkWords(text.words, 0, media.durationSec);
    if (!chunks.length) throw new PipelineError("Cannot restore captions without transcript words", { step: "broll" });
    const captions = await runCaptions({ width: media.width!, height: media.height!, duration: media.durationSec, style: text.captionPreset, chunks, outDir: path.join(dir, "captions"), colors: text.colors }, opts);
    inputs.push("-f", "concat", "-safe", "0", "-i", captions);
    filters.push(`[${base}][${index}:v]overlay=0:${offset}:format=auto:shortest=0:enable='${enable}'[text${index}]`);
    base = `text${index++}`;
  }
  if (text.title || text.titleOverlayPath) {
    const png = text.titleOverlayPath ?? path.join(dir, "title.png");
    if (!text.titleOverlayPath) await runSidecar("title_bar.py", ["--video", source, "--text", text.title!, "--assets", assetsDir(), "--png-only", png, "--fill", "#FFFFFF", "--stroke", text.titleStroke ?? "#000000"], opts);
    inputs.push("-loop", "1", "-i", png);
    filters.push(`[${base}][${index}:v]overlay=0:0:format=auto:enable='${enable}'[text${index}]`);
    base = `text${index}`;
  }
  if (!filters.length) return rendered;
  const output = path.join(dir, "restored.mp4");
  await run(bin("ffmpeg"), ["-y", "-v", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", `[${base}]`, "-map", "0:a?", "-t", String(media.durationSec), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output], { ...opts, timeoutMs: opts.timeoutMs ?? 20 * 60_000, step: "broll_text" });
  return output;
}
