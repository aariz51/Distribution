import { PipelineError } from "@distribution/core";

export interface EffectPlacement {
  at: number;
  end: number;
  effect: string;
}

interface Finding {
  label?: string;
  status?: string;
  startSec?: number;
  endSec?: number;
}

/**
 * Decides whether a finished clip that screening blocked can be rebuilt with
 * fewer sound effects, and which windows to keep clear.
 *
 * Only an audio music finding that lies under a placed effect qualifies: then
 * the effect is what the classifier heard, and dropping it removes the cause.
 * Anything else (a visual finding, music outside every effect, a report
 * without located findings) returns null and the clip stays blocked. The
 * screening threshold is never relaxed; the rebuilt clip is screened again.
 */
export function sfxRecoveryWindows(error: unknown, placements: EffectPlacement[]): Array<[number, number]> | null {
  if (!(error instanceof PipelineError) || error.step !== "final_screening") return null;
  const report = (error.details as { screening?: { visual?: { status?: string }; audio?: { status?: string; findings?: Finding[] } } } | undefined)?.screening;
  if (!report?.audio || report.audio.status === "allowed") return null;
  // Screening stops before the picture once the audio fails ("not-run"); that is
  // not a visual finding. Only a picture actually flagged rules recovery out,
  // and the rebuilt clip is screened in full, picture included.
  if (report.visual?.status === "rejected" || report.visual?.status === "uncertain") return null;
  const findings = (report.audio.findings ?? []).filter((f) => f.status === "rejected" || f.status === "uncertain");
  if (findings.length === 0 || placements.length === 0) return null;
  const windows: Array<[number, number]> = [];
  for (const f of findings) {
    if (!/music|sing/i.test(f.label ?? "") || !Number.isFinite(f.startSec) || !Number.isFinite(f.endSec)) return null;
    const start = f.startSec!;
    const end = f.endSec!;
    if (!placements.some((p) => p.at < end && p.end > start)) return null;
    windows.push([Math.max(0, start - 0.1), end + 0.1]);
  }
  return windows;
}
