import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { ObservedPoint } from "./motif-interiors.js";

/** A rigid plane isometry already established from independently verified geometry. */
export type RasterIsometry = {
    sourceOrigin: ObservedPoint;
    targetOrigin: ObservedPoint;
    xAxis: ObservedPoint;
    yAxis: ObservedPoint;
};
export type OriginalRasterIsometryCheck =
    | { status: "supported"; checkedInk: number; checkedBackground: number;
        matchedInk: number; matchedBackground: number; checkedRegions: number;
        supportedRegions: number; worstRegionInkSupport: number;
        inkSupport: number; backgroundSupport: number;
        evidence: "unchanged-source-raster" }
    | { status: "inconclusive" | "unsupported"; reason: string };

/**
 * A conservative, bounded source-IMAGE check for a proposed rigid isometry.
 * Unlike a mathematical chamber quotient, this checks the actual, untouched
 * grayscale pixels; unlike a detector, it does NOT discover the isometry.
 *
 * Sample high-contrast ink and bright background independently over a 3x3
 * spatial grid. Both must map to the same type of pixel across distant regions.
 * This rejects an isometry that fits a local region but not the entire image.
 *
 * It cannot prove semantic equivalence, exhaustive symmetry, or confidence
 * calibrated on real uploaded maps; no authority is derived from this result.
 */
export function verifyOriginalRasterIsometry(
    raster: GrayscaleRaster,
    proposed: RasterIsometry,
    options: {
        maxRasterPixels?: number;
        minimumInkSupport?: number;
        minimumBackgroundSupport?: number;
        minimumRegionInkSupport?: number;
        minimumSupportedRegions?: number;
    } = {}
): OriginalRasterIsometryCheck {
    const unsupported = (reason: string): OriginalRasterIsometryCheck => ({status:"unsupported",reason});
    const inconclusive = (reason: string): OriginalRasterIsometryCheck => ({status:"inconclusive",reason});
    const {width,height,pixels}=raster;
    const maxPixels=options.maxRasterPixels??1_500_000;
    const minInk=options.minimumInkSupport??0.87;
    const minBackground=options.minimumBackgroundSupport??0.94;
    const minRegional=options.minimumRegionInkSupport??0.72;
    const minRegions=options.minimumSupportedRegions??6;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
        ||width<96||height<96||width*height!==pixels.length
        ||!Number.isSafeInteger(maxPixels)||maxPixels<100_000||maxPixels>1_500_000
        ||width*height>maxPixels
        ||![minInk,minBackground,minRegional].every(x=>Number.isFinite(x)&&x>=0.5&&x<=1)
        ||!Number.isSafeInteger(minRegions)||minRegions<4||minRegions>9)
        return unsupported("Raster dimensions or bounded verification options are invalid");
    const {sourceOrigin,targetOrigin,xAxis,yAxis}=proposed;
    if(![sourceOrigin,targetOrigin,xAxis,yAxis].every(p=>
        p&&Number.isFinite(p.x)&&Number.isFinite(p.y)
        &&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7))
        return unsupported("Proposed isometry coordinates are not finite and bounded");
    const norm=(p:ObservedPoint):number=>Math.hypot(p.x,p.y);
    const dot=xAxis.x*yAxis.x+xAxis.y*yAxis.y;
    const det=xAxis.x*yAxis.y-xAxis.y*yAxis.x;
    if(Math.abs(norm(xAxis)-1)>1e-5||Math.abs(norm(yAxis)-1)>1e-5
        ||Math.abs(dot)>1e-5||Math.abs(Math.abs(det)-1)>1e-5)
        return unsupported("Only rigid orthogonal rotation/reflection transforms are accepted");
    // Identity is not positive evidence for a previously unknown symmetry.
    if(Math.abs(xAxis.x-1)<1e-7&&Math.abs(xAxis.y)<1e-7
        &&Math.abs(yAxis.x)<1e-7&&Math.abs(yAxis.y-1)<1e-7
        &&Math.hypot(targetOrigin.x-sourceOrigin.x,targetOrigin.y-sourceOrigin.y)<1e-7)
        return unsupported("The identity transformation supplies no independent raster symmetry evidence");

    const transform=(x:number,y:number):ObservedPoint=>{
        const dx=x-sourceOrigin.x,dy=y-sourceOrigin.y;
        return {x:targetOrigin.x+xAxis.x*dx+yAxis.x*dy,
            y:targetOrigin.y+xAxis.y*dx+yAxis.y*dy};
    };
    const nearDark=(x:number,y:number):boolean=>{
        const xx=Math.round(x),yy=Math.round(y);
        for(let v=-2;v<=2;v++)for(let u=-2;u<=2;u++){
            const px=xx+u,py=yy+v;
            if(px>=0&&px<width&&py>=0&&py<height
                &&pixels[py*width+px]<100)return true;
        }
        return false;
    };
    // Bright reference points must stay bright at the target rather than
    // being falsely matched by dark texture or a fully inked region.
    const brightAt=(x:number,y:number):boolean=>{
        const xx=Math.round(x),yy=Math.round(y);
        if(xx<0||xx>=width||yy<0||yy>=height)return false;
        return pixels[yy*width+xx]>180;
    };
    const ink=new Int32Array(9),matchedInk=new Int32Array(9);
    const background=new Int32Array(9),matchedBackground=new Int32Array(9);
    // Uniformly spaced bounded original-image sampling, not an image warp.
    // Stride deliberately deterministic so a candidate cannot select only
    // supportive pixels; multiple region requirements protect local false fits.
    const stride=Math.max(2,Math.ceil(Math.sqrt(width*height/90_000)));
    const validTarget=(p:ObservedPoint):boolean=>p.x>=3&&p.y>=3
        &&p.x<width-3&&p.y<height-3;
    for(let y=3;y<height-3;y+=stride)for(let x=3;x<width-3;x+=stride){
        const destination=transform(x,y);
        if(!validTarget(destination))continue;
        const index=Math.min(2,Math.floor(3*x/width))
            +3*Math.min(2,Math.floor(3*y/height));
        const value=pixels[y*width+x];
        if(value<100){
            ink[index]++;
            if(nearDark(destination.x,destination.y))matchedInk[index]++;
        }else if(value>220){
            background[index]++;
            if(brightAt(destination.x,destination.y))matchedBackground[index]++;
        }
    }
    const totalInk=ink.reduce((a,b)=>a+b,0),totalBackground=background.reduce((a,b)=>a+b,0);
    const matchedDark=matchedInk.reduce((a,b)=>a+b,0);
    const matchedLight=matchedBackground.reduce((a,b)=>a+b,0);
    const supported=[] as number[], checked=[] as number[];
    for(let i=0;i<9;i++){
        if(ink[i]<25||background[i]<80)continue;
        checked.push(i);
        if(matchedInk[i]/ink[i]>=minRegional
            &&matchedBackground[i]/background[i]>=minBackground)
            supported.push(i);
    }
    if(totalInk<200||totalBackground<600||checked.length<minRegions)
        return inconclusive("Too little spatially distributed ink and background evidence");
    if(supported.length<minRegions
        ||new Set(supported.map(i=>i%3)).size<3
        ||new Set(supported.map(i=>Math.floor(i/3))).size<3)
        return inconclusive("Proposed isometry lacks distant-region original-image support");
    const inkFraction=matchedDark/totalInk,brightFraction=matchedLight/totalBackground;
    if(inkFraction<minInk||brightFraction<minBackground)
        return inconclusive("Original raster strokes or negative space contradict the isometry");
    return {status:"supported",checkedInk:totalInk,checkedBackground:totalBackground,
        matchedInk:matchedDark,matchedBackground:matchedLight,
        checkedRegions:checked.length,supportedRegions:supported.length,
        worstRegionInkSupport:Math.min(...checked.map(i=>matchedInk[i]/ink[i])),
        inkSupport:inkFraction,backgroundSupport:brightFraction,
        evidence:"unchanged-source-raster"};
}
