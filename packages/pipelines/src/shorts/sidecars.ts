import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { PipelineError } from "@distribution/core";
import { bin, run, type RunOptions } from "@distribution/media";

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
export async function runTitleBar(video: string, text: string, output: string, opts: SidecarOptions & { colors?: { fill?: string; stroke?: string } } = {}): Promise<string> {
  const args = ["--video", video, "--text", text, "--output", output, "--assets", assetsDir()];
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
  return outputPath(lastLine, spec.out, "creative");
}

/** A path that never exists: makes outro.py skip voice cloning cleanly. An empty
 *  string would not — Python's `Path("").exists()` is True and the spawn crashes. */
export const NO_TTS_PYTHON = "/nonexistent/tts-python";
/** `--line` for a silent end card: outro.py has no "no voice" switch and `--line ""`
 *  falls back to the default line, so a whitespace line is spoken (≈ nothing). */
export const SILENT_OUTRO_LINE = " ";

/** outro.py — branded end card (+ optional cloned voice line). */
export async function runOutro(clip: string, appName: string, output: string, opts: SidecarOptions & { logo?: string; transcriptJson?: string; line?: string; ttsPython?: string } = {}): Promise<string> {
  const args = ["--clip", clip, "--app-name", appName, "--output", output, "--assets", assetsDir()];
  if (opts.logo) args.push("--logo", opts.logo);
  if (opts.transcriptJson) args.push("--transcript", opts.transcriptJson);
  if (opts.line) args.push("--line", opts.line);
  args.push("--tts-python", opts.ttsPython || process.env.TTS_PYTHON_BIN || NO_TTS_PYTHON);
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
  const { lastLine } = await runSidecar("broll_pipeline.py", brollArgv(clip, opts), {
    ...opts,
    step: "broll",
    timeoutMs: opts.timeoutMs ?? 60 * 60_000,
    env: { ...(opts.env ?? {}), ...brollEnv(opts) },
  });
  return outputPath(lastLine, opts.output, "broll");
}

/** Where broll_pipeline.py leaves its scene plan for `clip` (consumed by sfx_mix.py --scenes). */
export function brollScenePlanPath(clip: string): string {
  return path.join(path.dirname(clip), `edit_${path.basename(clip, path.extname(clip))}`, "scene_plan.json");
}
