/** Structural view types used by client components. Kept deliberately minimal so they
 *  stay compatible with the server read models in `@/lib/library` as they evolve. */

export interface CopyItem {
  id: string;
  platform: string;
  hook: string;
  title: string;
  caption: string;
  description?: string;
  hashtags: string[];
  cta: string;
  version: number;
  approved: boolean;
}

export interface AssetItem {
  id: string;
  type: string;
  status: string;
  approvalState: string;
  approvalReason: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType?: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number | null;
  createdAt: string;
  scheduledFor?: string | null;
  failureReason?: string | null;
  candidate?: { hook: string; score: number; startSec: number; endSec: number; rank: number } | null;
  metadata?: Record<string, unknown> | null;
  copy: CopyItem[];
}

export interface SourceItem {
  id: string;
  kind: string;
  url: string | null;
  title: string | null;
  creator: string | null;
  durationSec: number | null;
  rights: string;
  status: string;
  failureReason: string | null;
  screening?: { status: string; reason: string | null };
  qualification?: string;
  activeSourceJob?: { id: string; status: string; progressPct: number; currentStep: string | null; attempts: number; error: null; result: null };
  createdAt: string;
  latestProject: { id: string; status: string; createdAt: string } | null;
  clipCount: number;
}
