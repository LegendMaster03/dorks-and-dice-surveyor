import { buildEdgeField, type GrayscaleRaster } from "../hex-grid/detector.js";

/** An experimental alternative *segmentation substrate*, not a detector.
 * The same unchanged source Sobel field used for periodicity analysis supplies
 * candidate boundaries when cells are colored or gray instead of white.
 * Source pixels are not warped, localized, or refitted.
 *
 * IMPORTANT: An edge mask cannot be treated as original-raster ink evidence.
 * The existing global ink/negative-space verification must not be run against
 * this generated mask and called a source-image proof.
 */
export type EdgeDerivedMask = {
    threshold: number;
    darkFraction: number;
    raster: GrayscaleRaster;
    provenance: "original-sobel-gradient-boundaries";
};
export type EdgeDerivedMasks =
    | { status: "generated"; masks: readonly EdgeDerivedMask[] }
    | { status: "inconclusive" | "unsupported"; reason: string };

export function deriveInteriorMasksFromOriginalEdges(
    raster: GrayscaleRaster,
    options: {
        thresholds?: readonly number[];
        dilationRadius?: number;
        maxPixels?: number;
    } = {}
): EdgeDerivedMasks {
    const { width, height, pixels } = raster;
    const maxPixels = options.maxPixels ?? 1_500_000;
    const radius = options.dilationRadius ?? 1;
    const thresholds = options.thresholds ?? [0.92, 0.75, 0.58];
    if(!Number.isSafeInteger(maxPixels)||maxPixels<100||maxPixels>2_000_000
        ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
        ||width<96||height<96||width*height>maxPixels
        ||pixels.length!==width*height
        ||!Number.isSafeInteger(radius)||radius<0||radius>2
        ||thresholds.length<1||thresholds.length>4
        ||thresholds.some(x=>!Number.isFinite(x)||x<0.25||x>1))
        return {status:"unsupported",reason:"Invalid bounded gradient contour options or raster"};
    const field=buildEdgeField(raster,60_000);
    if(field.samples.length<500)
        return {status:"inconclusive",reason:"Insufficient source image Sobel boundaries"};
    const masks:EdgeDerivedMask[]=[];
    for(const threshold of thresholds){
        const mask=new Uint8Array(pixels.length).fill(255);
        let black=0;
        for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
            if(field.strength[y*width+x]<threshold)continue;
            for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
                const yy=y+dy,xx=x+dx;
                if(xx<0||xx>=width||yy<0||yy>=height)continue;
                const i=yy*width+xx;
                if(mask[i]===0)continue;
                mask[i]=0;black++;
            }
        }
        const fraction=black/pixels.length;
        // Preserve the existing enclosed-interior complexity/contrast gate:
        // an overly dense noisy gradient mask cannot become a polygon catalog.
        if(fraction<0.005||fraction>0.30)continue;
        masks.push({threshold,darkFraction:fraction,
            raster:{width,height,pixels:mask},
            provenance:"original-sobel-gradient-boundaries"});
    }
    if(!masks.length)
        return {status:"inconclusive",reason:"Original gradient strokes do not enclose safely sparse raster interiors"};
    return {status:"generated",masks};
}
