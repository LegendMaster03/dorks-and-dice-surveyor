import type { ObservedPoint } from "./motif-interiors.js";

type Point = ObservedPoint;
export type PeriodicContourObservation = {
    polygon: readonly Point[];
    centroid: Point;
    classId: number;
};
export type AlignedPeriodicContourResult<T extends PeriodicContourObservation> =
    | {status:"aligned"; observations: readonly T[];
        rejectedObservations:number; rotatedObservations:number}
    | {status:"inconclusive";reason:string};

/**
 * Reconcile cyclic polygon corner INDICES across independently observed
 * repetitions of a motif class, without changing one source-image vertex.
 *
 * Connected-region tracing gives each polygon an arbitrary start corner.
 * Labels/roads that touch just one edge can make the first contour vertex
 * switch by a whole polygon side (e.g. ~one 176 px cell period). This is
 * NOT geometric drift. The polygon shape, winding, and all physical corner
 * coordinates remain unchanged here.
 *
 * Compare coordinates *relative to independently observed centroids*, so
 * no guessed world phase, rotation, tiling template or period is required.
 * Derive the reference index order from a multi-cell medoid, never the first
 * raster component. Different motif classes are aligned independently.
 */
export function alignPeriodicContourCorners<T extends PeriodicContourObservation>(
    observations: readonly T[],
    numberOfClasses: number,
    options: {
        maximumShapeResidualPixels?: number;
        maximumRejectedFraction?: number
    } = {}
): AlignedPeriodicContourResult<T> {
    const maxError=options.maximumShapeResidualPixels??8;
    const maxDropped=options.maximumRejectedFraction??.15;
    const failure=(reason:string):AlignedPeriodicContourResult<T>=>({
        status:"inconclusive",reason
    });
    if(!Number.isSafeInteger(numberOfClasses)||numberOfClasses<1
        ||numberOfClasses>24||observations.length>600
        ||!Number.isFinite(maxError)||maxError<1||maxError>16
        ||!Number.isFinite(maxDropped)||maxDropped<0||maxDropped>.2)
        return failure("Unsupported periodic corner correspondence limits");
    const accepted=new Map<T,{polygon:readonly Point[];rotated:boolean}>();
    let rejected=0,rotated=0;
    for(let id=0;id<numberOfClasses;id++){
        const copies=observations.filter(o=>o.classId===id);
        if(copies.length<3)return failure("Too few repeated polygons for corner correspondence");
        const sides=copies[0]!.polygon.length;
        if(sides<3||sides>12 || copies.some(cell=>
            cell.polygon.length!==sides
            || !Number.isFinite(cell.centroid.x)||!Number.isFinite(cell.centroid.y)
            || cell.polygon.some(pt=>!Number.isFinite(pt.x)||!Number.isFinite(pt.y))))
            return failure("Incomplete original polygon corner observations");
        const relative=(cell:T):readonly Point[]=>cell.polygon.map(pt=>({
            x:pt.x-cell.centroid.x,y:pt.y-cell.centroid.y
        }));
        const normalized=copies.map(relative);
        // A contour can differ only by a cyclic rotation, never reflection.
        // Winding is retained because mirrors change topology/handedness.
        const bestShift=(template:readonly Point[],polygon:readonly Point[])=>{
            let best=Infinity,bestIndex=0;
            for(let shift=0;shift<sides;shift++){
                let worst=0;
                for(let i=0;i<sides;i++){
                    const a=template[i]!,b=polygon[(i+shift)%sides]!;
                    worst=Math.max(worst,Math.hypot(a.x-b.x,a.y-b.y));
                    if(worst>=best)break;
                }
                if(worst<best){best=worst;bestIndex=shift;}
            }
            return {worst:best,shift:bestIndex};
        };
        // At most 24 sampled medoid candidates, each compared with every
        // original observation. Median mismatch resists minority artwork,
        // unlike selecting the first observed polygon to define all corners.
        const count=Math.min(24,copies.length);
        const candidateIndices=Array.from({length:count},(_,i)=>
            count===1?0:Math.floor(i*(copies.length-1)/(count-1)));
        let selected=0,bestScore=Infinity,bestReindexCount=Infinity;
        for(const index of candidateIndices){
            const comparisons=normalized.map(poly=>bestShift(normalized[index]!,poly));
            const errors=comparisons.map(match=>match.worst).sort((a,b)=>a-b);
            // 65th percentile, rather than the maximum, prevents one badly
            // painted source cell from determining the motif's corner order.
            const percentile=errors[Math.floor((errors.length-1)*.65)]!;
            // Cyclic index gauge is arbitrary, but prefer the modal observed
            // corner start if multiple equally consistent representatives
            // exist. Otherwise one unusual FIRST cell would reindex 80 good
            // observations even though it cannot corrupt their geometry.
            const reindexCount=comparisons.filter(match=>match.shift!==0).length;
            if(percentile<bestScore-1e-6 ||
                (Math.abs(percentile-bestScore)<=1e-6 && reindexCount<bestReindexCount)){
                bestScore=percentile;bestReindexCount=reindexCount;selected=index;
            }
        }
        const template=normalized[selected]!;
        let droppedClass=0,retainedClass=0;
        for(let i=0;i<copies.length;i++){
            const cell=copies[i]!;
            const match=bestShift(template,normalized[i]!);
            if(match.worst>maxError){
                droppedClass++;rejected++;continue;
            }
            const rotatedPolygon=Array.from({length:sides},(_,corner)=>
                cell.polygon[(corner+match.shift)%sides]!);
            accepted.set(cell,{polygon:rotatedPolygon,rotated:match.shift!==0});
            if(match.shift!==0)rotated++;
            retainedClass++;
        }
        if(retainedClass<3||droppedClass>Math.floor(copies.length*maxDropped))
            return failure("Repeated polygon contours disagree beyond bounded cyclic corner correspondence");
    }
    if(rejected>Math.floor(observations.length*maxDropped))
        return failure("Too many independently observed contours have incompatible corner geometry");
    return {status:"aligned",observations:observations
        .filter(c=>accepted.has(c))
        .map(c=>({...c,polygon:accepted.get(c)!.polygon} as T)),
        rejectedObservations:rejected,rotatedObservations:rotated};
}
