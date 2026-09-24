export interface ReferenceCandidate {
  id: string; title: string; url: string; durationSec: number | null;
  categoryTags: string[]; productType: string | null; groundPreference: string | null;
  curatorScore: number; lastUsedProductId: string | null; visualLanguage: string[];
}
export interface ReferenceTarget { id: string; category: { primary: string; tags: string[] }; platforms: string[]; ground?: string; durationSec: number }
/** Explainable product-spec weights; deterministic tie-breaking, no random default. */
export function rankReferences(candidates: ReferenceCandidate[], target: ReferenceTarget) {
  const categories = new Set([target.category.primary, ...target.category.tags].map(value => value.trim().toLowerCase()));
  const productTypes = new Set([...(target.platforms.some(p => p === "ios" || p === "android") ? ["mobile-app"] : []), ...(target.platforms.some(p => p === "web" || p === "desktop") ? ["saas-web"] : [])]);
  const color = target.ground?.match(/^#([0-9a-f]{6})$/i)?.[1];
  const brightness = color ? (0.2126 * parseInt(color.slice(0, 2), 16) + 0.7152 * parseInt(color.slice(2, 4), 16) + 0.0722 * parseInt(color.slice(4, 6), 16)) / 255 : null;
  const ground = brightness === null ? null : brightness >= 0.5 ? "light" : "dark";
  return candidates.map(candidate => {
    const components = {
      category: candidate.categoryTags.some(tag => categories.has(tag.trim().toLowerCase())) ? 3 : 0,
      productType: candidate.productType && productTypes.has(candidate.productType) ? 2 : 0,
      ground: ground && (candidate.groundPreference === ground || candidate.groundPreference === "mixed") ? 2 : 0,
      duration: candidate.durationSec && candidate.durationSec > 0 ? Math.max(0, 1 - Math.abs(candidate.durationSec - target.durationSec) / Math.max(candidate.durationSec, target.durationSec)) : 0,
      curation: Math.max(0, Math.min(5, candidate.curatorScore)) / 5,
      repetition: candidate.lastUsedProductId === target.id ? -2 : 0,
    };
    const reasons = [components.category ? "Matches the product category" : null, components.productType ? "Matches the product platform" : null, components.ground ? "Compatible with the brand background" : null, components.duration >= 0.75 ? "Similar duration" : null, components.repetition ? "Used for this product most recently" : null].filter((reason): reason is string => Boolean(reason));
    return { ...candidate, score: Object.values(components).reduce((sum, value) => sum + value, 0), components, reasons };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
