import type { EdgeField, EdgeSample } from "../hex-grid/detector.js";

/**
 * The translation-basis search consumes the existing Sobel edge evidence.
 * It uses new geometry-agnostic displacement voting; the hex-specific Hough
 * autocorrelation fitter is not called by the experimental v3 pipeline.
 * All vectors are evaluated as ONE rigid displacement against the ORIGINAL edge
 * samples across distant regions. This stage makes no tiling-identity claim:
 * an edge lattice is neither a chamber system nor a certified polygon motif.
 */
export type TranslationVector = { x: number; y: number };
export type TranslationEvidence = {
    vector: TranslationVector;
    support: number;
    regionSupport: readonly number[];
    worstRegionSupport: number;
};
export type TranslationHypothesis = {
    basis: readonly [TranslationVector, TranslationVector];
    support: number;
    coveredRegions: number;
    worstRegionSupport: number;
};
export type TranslationSearch = {
    status: "candidates" | "inconclusive";
    reason: string;
    vectors: readonly TranslationEvidence[];
    hypotheses: readonly TranslationHypothesis[];
};
export type TranslationOptions = {
    minDistance?: number;
    maxDistance?: number;
    minRegionSupport?: number;
    maxPairVotes?: number;
    maxHypotheses?: number;
};
const PI = Math.PI;
function halfTurnDistance(a: number, b: number): number {
    const delta = Math.abs(a - b) % PI;
    return Math.min(delta, PI - delta);
}
function length(v: TranslationVector): number { return Math.hypot(v.x, v.y); }
function determinant(a: TranslationVector, b: TranslationVector): number { return a.x * b.y - a.y * b.x; }
function uniformSamples<T>(items: readonly T[], count: number): T[] {
    if (items.length <= count) return [...items];
    const result: T[] = [];
    for (let i = 0; i < count; i++) result.push(items[Math.floor(i * items.length / count)]);
    return result;
}
function region(x: number, y: number, width: number, height: number): number {
    return Math.min(2, Math.floor(3 * y / height)) * 3 + Math.min(2, Math.floor(3 * x / width));
}
function rankVector(field: EdgeField, vector: TranslationVector, source: readonly EdgeSample[], orientation: Float32Array): TranslationEvidence {
    const matched = new Float64Array(9), considered = new Int32Array(9);
    for (const sample of source) {
        const x = sample.x + vector.x, y = sample.y + vector.y;
        if (x < 1 || x >= field.width - 1 || y < 1 || y >= field.height - 1) continue;
        const r = region(sample.x, sample.y, field.width, field.height);
        considered[r]++;
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const idx = (y + dy) * field.width + x + dx;
            if (orientation[idx] !== -1 && halfTurnDistance(sample.normal, orientation[idx]) < 0.18) {
                best = Math.max(best, dx === 0 && dy === 0 ? 1 : (dx === 0 || dy === 0 ? 0.55 : 0.30));
            }
        }
        matched[r] += best;
    }
    const regional = Array.from(considered, (count, index) => count >= 18 ? matched[index] / count : 0);
    const supported = regional.filter((_, index) => considered[index] >= 18);
    const total = considered.reduce((a, b) => a + b, 0);
    const hits = matched.reduce((a, b) => a + b, 0);
    return {
        vector,
        support: total >= 200 ? hits / total : 0,
        regionSupport: regional,
        worstRegionSupport: supported.length ? Math.min(...supported) : 0
    };
}

/**
 * Bounded, deterministic candidate generation; a second stage must reconstruct
 * polygon incidence and derive a D-symbol before a pattern may be reported.
 */
export function discoverTranslations(field: EdgeField, options: TranslationOptions = {}): TranslationSearch {
    for (const [name, value] of Object.entries(options)) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError(`${name} must be finite and positive`);
        }
    }
    if (options.maxHypotheses !== undefined && !Number.isSafeInteger(options.maxHypotheses))
        throw new RangeError("maxHypotheses must be an exact positive integer");
    if (options.maxPairVotes !== undefined && !Number.isSafeInteger(options.maxPairVotes))
        throw new RangeError("maxPairVotes must be an exact positive integer");
    const min = Math.max(8, options.minDistance ?? 12);
    const max = Math.min(Math.min(field.width, field.height) / 2, options.maxDistance ?? 220);
    const maxVotes = Math.min(1_000_000, Math.max(1000, options.maxPairVotes ?? 500_000));
    if (field.samples.length < 500 || max <= min + 2)
        return {status:"inconclusive",reason:"Insufficient repeated edge evidence",vectors:[],hypotheses:[]};
    const anchors = uniformSamples(field.samples, 128);
    const comparison = uniformSamples(field.samples, Math.max(1, Math.floor(maxVotes / anchors.length)));
    const frequencies = new Map<string, number>();
    const maxSq = max * max, minSq = min * min;
    for (const anchor of anchors) for (const sample of comparison) {
        let dx = sample.x - anchor.x, dy = sample.y - anchor.y;
        if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; }
        const squared = dx * dx + dy * dy;
        if (squared < minSq || squared > maxSq || halfTurnDistance(anchor.normal, sample.normal) > 0.17) continue;
        const qx = Math.round(dx / 2), qy = Math.round(dy / 2);
        const key = `${qx},${qy}`;
        frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    const votes = [...frequencies].sort((a,b) => b[1] - a[1]).slice(0, 40);
    const testing = uniformSamples(field.samples, 5_000);
    const orientation = new Float32Array(field.width * field.height).fill(-1);
    for (const sample of field.samples) orientation[sample.y * field.width + sample.x] = sample.normal;
    const ranked: TranslationEvidence[] = [];
    for (const [key] of votes) {
        const [qx, qy] = key.split(",").map(Number);
        let best: TranslationEvidence | null = null;
        for (let x = 2*qx-2; x <= 2*qx+2; x++) for (let y = 2*qy-2; y <= 2*qy+2; y++) {
            if (x*x + y*y < minSq || x*x + y*y > maxSq) continue;
            const forward = rankVector(field,{x,y},testing,orientation);
            const backwards = rankVector(field,{x:-x,y:-y},testing,orientation);
            const score = Math.min(forward.support,backwards.support);
            const evidence: TranslationEvidence = {
                vector: {x,y}, support: score,
                regionSupport: forward.regionSupport.map((v,i)=>Math.min(v,backwards.regionSupport[i])),
                worstRegionSupport: Math.min(...forward.regionSupport,...backwards.regionSupport)
            };
            if (!best || evidence.support > best.support) best = evidence;
        }
        if (best && !ranked.some(other => Math.hypot(other.vector.x-best!.vector.x,other.vector.y-best!.vector.y)<3))
            ranked.push(best);
    }
    ranked.sort((a,b)=>b.support-a.support);
    const admissible = ranked.filter(candidate=>candidate.support >= (options.minRegionSupport ?? .65));
    const hypotheses: TranslationHypothesis[] = [];
    for (let i=0;i<admissible.length;i++) for (let j=i+1;j<admissible.length;j++) {
        const a=admissible[i],b=admissible[j];
        const det=Math.abs(determinant(a.vector,b.vector));
        if(det < .20*length(a.vector)*length(b.vector) || det < minSq) continue;
        const support = Math.min(a.support,b.support);
        const coveredRegions = a.regionSupport.filter((v,k)=>v>=.55&&b.regionSupport[k]>=.55).length;
        if (coveredRegions < 5) continue;
        hypotheses.push({basis:[a.vector,b.vector],support,coveredRegions,
            worstRegionSupport:Math.min(a.worstRegionSupport,b.worstRegionSupport)});
    }
    hypotheses.sort((a,b) => b.coveredRegions-a.coveredRegions || b.support-a.support
        || Math.abs(determinant(...a.basis))-Math.abs(determinant(...b.basis)));
    const selected=hypotheses.slice(0,Math.min(12,options.maxHypotheses ?? 5));
    return {status:selected.length?"candidates":"inconclusive",reason:selected.length
        ?"Periodic translation hypotheses require motif and chamber reconstruction"
        :"No two independent translation vectors met original-image multi-region criteria",
        vectors:ranked.slice(0,16),hypotheses:selected};
}
