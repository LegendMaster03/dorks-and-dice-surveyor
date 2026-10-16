import { PERIODIC_ANALYSIS_MAX_PIXELS } from "./analysis-raster-limits.js";
import { buildEdgeField, type EdgeField, type GrayscaleRaster } from "../hex-grid/detector.js";
import type { TranslationVector } from "./translations.js";

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
        /** Allow masks to reuse the original, unchanged Sobel field. */
        edgeField?: EdgeField;
    } = {}
): EdgeDerivedMasks {
    const { width, height, pixels } = raster;
    const maxPixels = options.maxPixels ?? PERIODIC_ANALYSIS_MAX_PIXELS;
    const radius = options.dilationRadius ?? 1;
    const thresholds = options.thresholds ?? [0.92, 0.75, 0.58];
    if(!Number.isSafeInteger(maxPixels)||maxPixels<100||maxPixels>PERIODIC_ANALYSIS_MAX_PIXELS
        ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
        ||width<96||height<96||width*height>maxPixels
        ||pixels.length!==width*height
        ||!Number.isSafeInteger(radius)||radius<0||radius>2
        ||thresholds.length<1||thresholds.length>4
        ||thresholds.some(x=>!Number.isFinite(x)||x<0.25||x>1))
        return {status:"unsupported",reason:"Invalid bounded gradient contour options or raster"};
    const field=options.edgeField??buildEdgeField(raster,60_000);
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

/**
 * Generic, geometry-neutral contour reconstruction from repeated original
 * raster gradients. An image-derived translation basis determines where to
 * seek corroborating edges, never what polygon, tiling or line family to draw.
 *
 * The output is a non-authoritative segmentation mask, NOT ink evidence.
 * Topology, rigid geometry and independent full-image projection must still
 * be verified against the untouched original raster.
 */
export function derivePeriodicallyCorroboratedInteriorMask(
    raster: GrayscaleRaster,
    basis: readonly [TranslationVector, TranslationVector],
    options: { maxPixels?: number; edgeField?: EdgeField } = {}
): EdgeDerivedMasks {
    const {width,height,pixels}=raster;
    const maxPixels=options.maxPixels??PERIODIC_ANALYSIS_MAX_PIXELS;
    const [a,b]=basis,det=a.x*b.y-a.y*b.x;
    if(!Number.isSafeInteger(maxPixels)||maxPixels<100||maxPixels>PERIODIC_ANALYSIS_MAX_PIXELS
        ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
        ||width<96||height<96||pixels.length!==width*height||width*height>maxPixels
        ||![a.x,a.y,b.x,b.y].every(Number.isFinite)||Math.abs(det)<64)
        return {status:"unsupported",reason:"Invalid bounded periodic edge reconstruction input"};
    const field=options.edgeField??buildEdgeField(raster,60_000);
    if(field.width!==width||field.height!==height||!field.denseNormals)
        return {status:"inconclusive",reason:"Original image has no oriented source gradient evidence"};
    // One-pixel positional tolerance compensates for raster quantization,
    // without shifting or modifying the source image.
    const nearStrength=new Float32Array(pixels.length);
    const nearNormal=new Float32Array(pixels.length).fill(-1);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
        const i=y*width+x,normal=field.denseNormals[i];
        if(normal<0||field.strength[i]<0.45)continue;
        const strength=field.strength[i];
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const at=(y+dy)*width+x+dx;
            if(strength>nearStrength[at]){
                nearStrength[at]=strength;
                nearNormal[at]=normal;
            }
        }
    }
    // Sample neighboring repeats in the candidate's own two-dimensional
    // lattice, with no square, hexagonal or other fixed orientation.
    const shifts=[
        {x:0,y:0},a,b,{x:-a.x,y:-a.y},{x:-b.x,y:-b.y},
        {x:a.x+b.x,y:a.y+b.y},{x:a.x-b.x,y:a.y-b.y},
        {x:-a.x+b.x,y:-a.y+b.y},{x:-a.x-b.x,y:-a.y-b.y}
    ].map(v=>({x:Math.round(v.x),y:Math.round(v.y)}));
    const mask=new Uint8Array(pixels.length).fill(255);
    const normalDifference=(first:number,second:number):number=>{
        const difference=Math.abs(first-second)%Math.PI;
        return Math.min(difference,Math.PI-difference);
    };
    let dark=0;
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
        let first=-1,alternative=-1,available=0;
        for(const shift of shifts){
            const xx=x+shift.x,yy=y+shift.y;
            if(xx<2||yy<2||xx>=width-2||yy>=height-2)continue;
            available++;
            const i=yy*width+xx;
            if(nearStrength[i]<0.55)continue;
            const angle=nearNormal[i];
            if(first<0)first=angle;
            else if(alternative<0&&normalDifference(first,angle)>0.25)alternative=angle;
        }
        if(first<0||available<4)continue;
        let hits=0,otherHits=0;
        for(const shift of shifts){
            const xx=x+shift.x,yy=y+shift.y;
            if(xx<2||yy<2||xx>=width-2||yy>=height-2)continue;
            const i=yy*width+xx;
            if(nearStrength[i]<0.55)continue;
            if(normalDifference(first,nearNormal[i])<=0.19)hits++;
            if(alternative>=0&&normalDifference(alternative,nearNormal[i])<=0.19)
                otherHits++;
        }
        const support=Math.max(hits,otherHits);
        if(support<3||support/available<0.45)continue;
        mask[y*width+x]=0;
        dark++;
    }
    const fraction=dark/pixels.length;
    if(fraction<.005||fraction>.30)
        return {status:"inconclusive",reason:"Repeated image gradients did not form safely sparse contour boundaries"};
    // Close adjacent pixels only after periodic multi-image-position voting.
    const closed=mask.slice();
    let count=dark;
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
        const i=y*width+x;
        if(mask[i]!==0)continue;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
            const at=i+dy*width+dx;
            if(closed[at]!==0){closed[at]=0;count++;}
        }
    }
    if(count/pixels.length>.30)
        return {status:"inconclusive",reason:"Periodically reinforced contour mask is excessively dense"};
    return {status:"generated",masks:[{
        threshold:0.55,darkFraction:count/pixels.length,
        raster:{width,height,pixels:closed},
        provenance:"original-sobel-gradient-boundaries"
    }]};
}
