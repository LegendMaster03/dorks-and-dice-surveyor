import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { InteriorObservation, ObservedPoint } from "./motif-interiors.js";
import type { ObservedTopology } from "./observed-topology.js";
import type { TranslationVector } from "./translations.js";
import {
    deriveTranslationMotif, CoverValidationError, type OperationalCover, type PeriodicWitness
} from "../../resources/periodic-tiling/topology/motif.js";
import { verifyRigidMotifFit } from "./global-motif-fit.js";

export type ObservedMetricRegistration =
    | { status: "registered"; cover: OperationalCover;
        maximumContourResidualPixels: number; rmsContourResidualPixels: number;
        originalRasterEdgeSupport: number; independentlyDerivedDsSymbol: string;
        evidence: "experimental-joint-original-raster-registration" }
    | { status: "inconclusive" | "unsupported"; reason: string };

export type ObservedMetricRegistrationOptions = {
    maximumContourResidualPixels?: number;
    minimumOriginalRasterEdgeSupport?: number;
};

/**
 * Construct the best constrained geometric candidate, without guessing a
 * registered shape or altering raster data. Side endpoints are IDENTIFIED by
 * the observed reciprocal periodic adjacency, and each identity is fitted
 * ONCE over all translated original-image polygon observations.
 *
 * The resulting tiling is re-derived independently from exact shared edges.
 * A finite topological chamber graph by itself can not supply these metric
 * coordinates. Neither this synthetic/closed-line research envelope nor its
 * output certifies general map artwork or authoritative world coordinates.
 */
export function registerObservedMetric(
    raster: GrayscaleRaster,
    observation: InteriorObservation,
    topology: ObservedTopology,
    basis: readonly [TranslationVector, TranslationVector],
    options: ObservedMetricRegistrationOptions = {}
): ObservedMetricRegistration {
    const unsupported = (reason: string): ObservedMetricRegistration => ({status:"unsupported",reason});
    const inconclusive = (reason: string): ObservedMetricRegistration => ({status:"inconclusive",reason});
    // Each contour lies on a different side of a three-pixel ink stroke.
    // Its noisy corner can be farther from the jointly fitted ideal vertex
    // than the independent translation-drift tolerance. Keep those two
    // checks distinct: the original multi-region rigid fit remains 5 px.
    const maximumResidual=options.maximumContourResidualPixels??6;
    const minimumEdgeSupport=options.minimumOriginalRasterEdgeSupport??0.83;
    if(!Number.isFinite(maximumResidual)||maximumResidual<.5||maximumResidual>8
        ||!Number.isFinite(minimumEdgeSupport)||minimumEdgeSupport<.6||minimumEdgeSupport>1)
        return unsupported("Unsupported bounded metric registration options");
    if(observation.status!=="observed"||topology.status!=="derived")
        return inconclusive("A verified observed translation chamber graph is required");
    const kinds=observation.classes,interiors=observation.interiors,cells=topology.cells;
    if(!kinds.length||kinds.length>24||cells.length!==kinds.length
        ||interiors.length<6||interiors.length>600
        ||kinds.some((kind,i)=>kind.id!==i||kind.sideCount<3||kind.sideCount>12)
        ||cells.some((cell,i)=>cell.classId!==i
            ||cell.boundaries.length!==kinds[i].sideCount))
        return unsupported("Unbounded or inconsistent observed metric topology");
    const [a,b]=basis;
    const det=a.x*b.y-a.y*b.x;
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite)||Math.abs(det)<4)
        return unsupported("The shared periodic basis is not independent");
    const add=(p:ObservedPoint,q:ObservedPoint):ObservedPoint=>({x:p.x+q.x,y:p.y+q.y});
    const sub=(p:ObservedPoint,q:ObservedPoint):ObservedPoint=>({x:p.x-q.x,y:p.y-q.y});
    const mul=(p:ObservedPoint,t:number):ObservedPoint=>({x:p.x*t,y:p.y*t});
    const shift=(u:number,v:number):ObservedPoint=>add(mul(a,u),mul(b,v));
    const length=(p:ObservedPoint):number=>Math.hypot(p.x,p.y);
    const coordinates=(p:ObservedPoint):ObservedPoint=>({
        x:(p.x*b.y-p.y*b.x)/det,y:(a.x*p.y-a.y*p.x)/det
    });
    const anchor=kinds.map(kind=>interiors.find(x=>x.motifClass===kind.id)?.centroid);
    if(anchor.some(x=>!x))return inconclusive("A motif class lacks any observed image instance");
    const addresses:[number,number][]=[];
    for(const obs of interiors){
        if(!Number.isSafeInteger(obs.motifClass)||obs.motifClass<0||obs.motifClass>=kinds.length
            ||obs.polygon.length!==kinds[obs.motifClass].sideCount
            ||obs.polygon.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))
            return unsupported("Malformed polygon contour or class identity");
        const fractional=coordinates(sub(obs.centroid,anchor[obs.motifClass]!));
        const u=Math.round(fractional.x),v=Math.round(fractional.y);
        if(!Number.isSafeInteger(u)||!Number.isSafeInteger(v)||Math.abs(u)>2048||Math.abs(v)>2048
            ||length(sub(fractional,{x:u,y:v}))>.08)
            return inconclusive("Contour centroids are not jointly aligned to the fixed period basis");
        addresses.push([u,v]);
    }
    const starts:number[]=[],total=kinds.reduce((n,kind)=>n+kind.sideCount,0);
    if(total>288)return unsupported("Observed polygon vertex count exceeds the bounded fit");
    let current=0;
    for(const kind of kinds){starts.push(current);current+=kind.sideCount;}
    const key=(id:number,side:number):number=>starts[id]+side;
    const neighbors:{index:number;displacement:ObservedPoint}[][]=
        Array.from({length:total},()=>[]);
    // Every observed boundary imposes two oriented endpoint equations.
    // P[from] = P[target] + lattice(edge.translation). Edges are identified
    // as the SAME ideal geometric boundary, even though white-region contours
    // lie on opposite sides of the image's nonzero-thickness ink.
    for(const cell of cells){
        for(let i=0;i<cell.boundaries.length;i++){
            const edge=cell.boundaries[i];
            const target=cells[edge.targetClass];
            if(edge.sideIndex!==i||!target||!Number.isSafeInteger(edge.targetSide)
                ||edge.targetSide<0||edge.targetSide>=target.boundaries.length
                ||!edge.translation.every(Number.isSafeInteger)
                ||edge.translation.some(x=>Math.abs(x)>2048))
                return unsupported("Malformed reciprocal endpoint constraint");
            const reciprocal=target.boundaries[edge.targetSide];
            if(reciprocal.targetClass!==cell.classId
                ||reciprocal.targetSide!==i
                ||reciprocal.translation[0]!==-edge.translation[0]
                ||reciprocal.translation[1]!==-edge.translation[1])
                return inconclusive("The observed endpoint constraints are not reciprocal");
            const voltage=shift(...edge.translation);
            const pairs=[
                [key(cell.classId,i),key(edge.targetClass,
                    (edge.targetSide+1)%target.boundaries.length)],
                [key(cell.classId,(i+1)%cell.boundaries.length),
                    key(edge.targetClass,edge.targetSide)]
            ];
            for(const [from,to] of pairs){
                neighbors[from].push({index:to,displacement:voltage});
                neighbors[to].push({index:from,displacement:mul(voltage,-1)});
            }
        }
    }
    // Potential[i] = P[i] - P[root]; traversal checks ALL periodic cycles.
    // Inconsistent lattice holonomy can not be repaired with a local offset.
    const potential:(ObservedPoint|null)[]=Array.from({length:total},()=>null);
    const group=new Int32Array(total).fill(-1);
    let components=0;
    for(let root=0;root<total;root++){
        if(potential[root])continue;
        potential[root]={x:0,y:0};group[root]=components;
        const queue=[root];
        for(let index=0;index<queue.length;index++){
            const from=queue[index];
            for(const edge of neighbors[from]){
                const expected=sub(potential[from]!,edge.displacement);
                if(!potential[edge.index]){
                    potential[edge.index]=expected;group[edge.index]=components;
                    queue.push(edge.index);
                }else if(length(sub(expected,potential[edge.index]!))>1e-5){
                    return inconclusive("Raster incidence implies contradictory periodic vertex holonomy");
                }
            }
        }
        components++;
    }
    const votes:ObservedPoint[][]=Array.from({length:components},()=>[]);
    for(let i=0;i<interiors.length;i++){
        const obs=interiors[i],address=addresses[i];
        const offset=shift(...address);
        for(let corner=0;corner<obs.polygon.length;corner++){
            const id=key(obs.motifClass,corner);
            votes[group[id]].push(sub(sub(obs.polygon[corner],offset),potential[id]!));
        }
    }
    // The median is a bounded, robust estimate of each shared periodic
    // vertex's *one* image-space location; it is not a per-cell alignment.
    const median=(values:number[]):number=>{
        values.sort((x,y)=>x-y);
        const half=Math.floor(values.length/2);
        return values.length%2?values[half]:(values[half-1]+values[half])/2;
    };
    const roots:ObservedPoint[]=[];
    for(const samples of votes){
        if(samples.length<3)return inconclusive("Insufficient joint contour vertex observations");
        roots.push({x:median(samples.map(p=>p.x)),y:median(samples.map(p=>p.y))});
    }
    const fitted=potential.map((p,i)=>add(roots[group[i]],p!));
    let sum=0,count=0,worst=0;
    for(let i=0;i<interiors.length;i++){
        const obs=interiors[i],offset=shift(...addresses[i]);
        for(let corner=0;corner<obs.polygon.length;corner++){
            const residual=length(sub(obs.polygon[corner],
                add(fitted[key(obs.motifClass,corner)],offset)));
            if(!Number.isFinite(residual))
                return unsupported("Nonfinite global contour fitting residual");
            worst=Math.max(worst,residual);sum+=residual*residual;count++;
        }
    }
    if(worst>maximumResidual)
        return inconclusive(`Shared periodic polygon vertices deviate by ${worst.toFixed(2)} px from one exact joint fit (limit ${maximumResidual.toFixed(2)} px)`);
    // The source image crop can begin many whole lattice periods from the
    // origin. Bring the ENTIRE motif into one nearby representative domain
    // by a single integral period displacement. This changes no cell shape,
    // adjacency, fit residual, or infinite-cover registration.
    const centroid=mul(fitted.reduce(add,{x:0,y:0}),1/fitted.length);
    const centerAddress=coordinates(centroid);
    const centerU=Math.round(centerAddress.x-.5);
    const centerV=Math.round(centerAddress.y-.5);
    if(!Number.isSafeInteger(centerU)||!Number.isSafeInteger(centerV)
        ||Math.abs(centerU)>2048||Math.abs(centerV)>2048)
        return unsupported("Image-domain translation normalization exceeds bounded lattice coordinates");
    const uniformOriginShift=shift(centerU,centerV);
    const witness:PeriodicWitness={units:"pixel",basis:[a,b],
        cells:kinds.map(kind=>({id:`observed-${kind.id}`,
            polygon:Array.from({length:kind.sideCount},(_,i)=>
                sub(fitted[key(kind.id,i)],uniformOriginShift))}))};
    let cover:OperationalCover;
    try{cover=deriveTranslationMotif(witness);}
    catch(error){
        if(!(error instanceof CoverValidationError))throw error;
        return inconclusive(`Independently reconstructed periodic polygon geometry fails: ${error.message}; candidate=${JSON.stringify(witness.cells.map(cell => cell.polygon.map(p => [Math.round(p.x), Math.round(p.y)])))}`);
    }
    if(cover.translationSymbol!==topology.dsSymbol)
        return inconclusive("A geometry-derived chamber graph disagrees with the original raster-derived topology");
    const original=verifyRigidMotifFit(raster,observation,basis,{
        maxVertexResidualPixels:Math.min(5,maximumResidual),
        minimumRasterEdgeSupport:minimumEdgeSupport
    });
    if(original.status!=="supported")
        return inconclusive(`Global original-raster verification fails: ${original.reason}`);
    return {status:"registered",cover,
        independentlyDerivedDsSymbol:cover.translationSymbol,
        maximumContourResidualPixels:worst,rmsContourResidualPixels:Math.sqrt(sum/count),
        originalRasterEdgeSupport:original.originalRasterEdgeSupport,
        evidence:"experimental-joint-original-raster-registration"};
}
