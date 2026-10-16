import {
    buildEdgeField,
    type GrayscaleRaster
} from "../hex-grid/detector.js";
import { discoverTranslations, type TranslationOptions, type TranslationSearch } from "./translations.js";

/**
 * Additive Phase 16 research kernel, reusing the current detector's Sobel edge samples and normals.
 * The generalized translation votes and multiregion rigid checks are new
 * kernels, not calls to the hex-specific Hough/autocorrelation fitter.
 * No production API or D-symbol identity is changed here. If noise obscures the
 * ordinary edge field, retry with only the strongest original gradients. This
 * neither transforms the input image nor corrects individual cell positions;
 * motif reconstruction and final metric evidence still use the original raster.
 */
export function evaluateOriginalRasterTranslations(
    raster: GrayscaleRaster,
    options: TranslationOptions & { maxEdgeSamples?: number } = {}
): TranslationSearch {
    if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height)
        || raster.width < 8 || raster.height < 8
        || raster.pixels.length !== raster.width * raster.height) {
        throw new Error("Invalid grayscale raster dimensions or pixel length.");
    }
    const requested = options.maxEdgeSamples ?? 60_000;
    if (!Number.isSafeInteger(requested) || requested < 500 || requested > 100_000) {
        throw new RangeError("maxEdgeSamples must be between 500 and 100000.");
    }
    const field = buildEdgeField(raster, requested);
    const original = discoverTranslations(field, options);
    if (original.status === "candidates") return original;

    // Gradient magnitudes are already normalized by the original Sobel field.
    // Retry a single stronger-evidence hypothesis when diffuse texture produces
    // many weak, unrelated edge samples. This does not invent a shape or change
    // the final unchanged-raster verification gate.
    const strongSamples = field.samples.filter(sample =>
        field.strength[sample.y * field.width + sample.x] >= 0.9);
    if (strongSamples.length >= 500 && strongSamples.length !== field.samples.length) {
        const strong = discoverTranslations({ ...field, samples: strongSamples }, options);
        if (strong.status === "candidates")
            return { ...strong, reason: "Strong-gradient original-image candidate; requires independent whole-motif verification" };
    }

    // Populated maps contain many art/label edges competing with their printed
    // cell boundaries. A genuine printed boundary remains locally straight
    // over several separated positions along its tangent. Keep only qualified
    // original-raster edges with that generic property for a bounded second
    // displacement vote. Do NOT draw, remove, or infer any cells or shapes:
    // every accepted candidate still goes through complete original-raster
    // incidence, rigid metric, and projection verification.
    const normals = field.denseNormals;
    if (!normals) return original;
    const normalDifference = (a: number, b: number): number => {
        const diff = Math.abs(a-b) % Math.PI;
        return Math.min(diff, Math.PI-diff);
    };
    const coherent = field.samples.filter(sample => {
        const tx=-Math.sin(sample.normal),ty=Math.cos(sample.normal);
        let matches=0;
        for(const distance of [-24,-16,-8,8,16,24]) {
            const px=Math.round(sample.x+tx*distance);
            const py=Math.round(sample.y+ty*distance);
            if(px<2||py<2||px>=field.width-2||py>=field.height-2)continue;
            let found=false;
            for(let dy=-1;dy<=1&&!found;dy++)for(let dx=-1;dx<=1;dx++){
                const i=(py+dy)*field.width+px+dx;
                if(normals[i]>=0&&field.strength[i]>=0.35
                    &&normalDifference(sample.normal,normals[i])<=0.18){
                    found=true;break;
                }
            }
            if(found)matches++;
        }
        return matches>=4;
    });
    if(coherent.length<500 || coherent.length===field.samples.length)
        return original;
    const structural=discoverTranslations({...field,samples:coherent},options);
    return structural.status==="candidates"
        ? {...structural,reason:"Straight original-image edge candidate; requires independent whole-motif verification"}
        : original;
}
