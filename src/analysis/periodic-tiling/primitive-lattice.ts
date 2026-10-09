import type { GrayscaleRaster } from "../hex-grid/detector.js";
import { inspectDSymbol } from "../../resources/periodic-tiling/topology/d-symbol.js";
import { projectChambers } from "../../resources/periodic-tiling/topology/equivalence.js";
import type { InteriorObservation, ObservedInterior, ObservedPoint } from "./motif-interiors.js";
import { deriveObservedTopology, type ObservedTopologyOptions } from "./observed-topology.js";
import { refineRigidTranslationBasis, type BasisRefinementOptions } from "./rigid-basis-refinement.js";
import { verifyRigidMotifFit, type RigidFitOptions } from "./global-motif-fit.js";
import { registerObservedMetric } from "./observed-metric-registration.js";
import { verifyProjectedPolygonsInOriginalRaster } from "./original-polygon-projection.js";
import type { TranslationVector } from "./translations.js";

type Basis = readonly [TranslationVector, TranslationVector];
type Derived = Extract<ReturnType<typeof deriveObservedTopology>, { status: "derived" }>;
type Candidate = {
    basis: Basis;
    interior: InteriorObservation;
    topology: Derived;
    rasterSupport: number;
    rigidResidual: number;
};
export type PrimitiveLatticeResult =
    | { status: "verified"; candidate: Candidate; reductions: number }
    | { status: "ambiguous"; reason: string };

/**
 * A translation permutes the finite polygon cells freely, so any strict
 * translation-superlattice has prime-index intermediate steps, with each prime
 * dividing the number of cells in the current fundamental domain. Exhaust
 * those superlattices instead of recognizing catalogued tilings or assuming
 * the first Sobel lattice is primitive.
 */
function primeFactors(n: number): number[] {
    const result: number[] = [];
    for (let p = 2; p <= n; p++) {
        if (n % p !== 0) continue;
        result.push(p);
        while (n % p === 0) n /= p;
    }
    return result;
}
const determinant = (a: TranslationVector, b: TranslationVector): number =>
    a.x * b.y - a.y * b.x;
const add = (a: TranslationVector, b: TranslationVector): TranslationVector =>
    ({ x: a.x + b.x, y: a.y + b.y });
const multiply = (a: TranslationVector, t: number): TranslationVector =>
    ({ x: a.x * t, y: a.y * t });
const fraction = (x: number): number => ((x % 1) + 1) % 1;
function phase(p: ObservedPoint, basis: Basis): ObservedPoint {
    const [a,b] = basis, det = determinant(a,b);
    const u = fraction(determinant(p,b)/det), v = fraction(determinant(a,p)/det);
    return add(multiply(a,u),multiply(b,v));
}
function phaseDistance(a: ObservedPoint, b: ObservedPoint, basis: Basis): number {
    let shortest = Infinity;
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
        const d = add({x:a.x-b.x,y:a.y-b.y},
            add(multiply(basis[0],u),multiply(basis[1],v)));
        shortest = Math.min(shortest,Math.hypot(d.x,d.y));
    }
    return shortest;
}

/** Align cyclic corners using observed geometry; rotation of the polygon's
 * starting index is harmless, but reflection and physical rotation are not. */
function alignCorners(polygon: readonly ObservedPoint[],
                      reference: ObservedInterior,
                      centroid: ObservedPoint): ObservedPoint[] | null {
    if (polygon.length !== reference.polygon.length) return null;
    const n = polygon.length;
    let bestIndex = -1, bestError = Infinity;
    for (let shift = 0; shift < n; shift++) {
        let worst = 0;
        for (let j = 0; j < n; j++) {
            const source = polygon[(j+shift)%n];
            const target = reference.polygon[j];
            worst = Math.max(worst, Math.hypot(
                source.x-centroid.x-(target.x-reference.centroid.x),
                source.y-centroid.y-(target.y-reference.centroid.y)));
        }
        if (worst < bestError) { bestError = worst; bestIndex = shift; }
    }
    if (bestError > 5) return null;
    return Array.from({length:n},(_,i)=>polygon[(i+bestIndex)%n]);
}

function repartition(source: InteriorObservation, basis: Basis,
                     expectedClasses: number): InteriorObservation | null {
    if (source.status !== "observed" || source.interiors.length > 600 ||
        !Number.isFinite(determinant(...basis)) || Math.abs(determinant(...basis)) < 4)
        return null;
    const groups: { at: ObservedPoint; example: ObservedInterior; count: number }[] = [];
    const interiors: ObservedInterior[] = [];
    for (const cell of source.interiors) {
        const location = phase(cell.centroid, basis);
        let groupId = -1, polygon: ObservedPoint[] | null = null;
        for (let i=0;i<groups.length;i++) {
            if (phaseDistance(location, groups[i].at, basis) > 5) continue;
            const aligned=alignCorners(cell.polygon,groups[i].example,cell.centroid);
            if (aligned) { groupId=i; polygon=aligned; break; }
        }
        if (groupId<0) {
            if (groups.length>=expectedClasses) return null;
            groupId=groups.length;
            polygon=[...cell.polygon];
            groups.push({at:location,example:cell,count:0});
        }
        if (!polygon) return null;
        groups[groupId].count++;
        interiors.push({...cell,motifClass:groupId,polygon});
    }
    if (groups.length!==expectedClasses || groups.some(g=>g.count<3)) return null;
    return {...source,classes:groups.map((g,id)=>({
        id,sideCount:g.example.polygon.length,examples:g.count
    })),interiors};
}
function primeOverlattices(basis: Basis, count: number): Basis[] {
    const [a,b]=basis, results:Basis[]=[];
    for (const p of primeFactors(count)) {
        results.push([multiply(a,1/p),b]);
        for (let k=0;k<p;k++)
            results.push([a,multiply(add(multiply(a,k),b),1/p)]);
    }
    return results;
}
function equivalentLattices(a:Basis,b:Basis):boolean {
    const det=determinant(...a);
    if(Math.abs(det)<4)return false;
    const coordinates=(p:TranslationVector):readonly [number,number] =>
        [determinant(p,a[1])/det,determinant(a[0],p)/det];
    return b.every(v=>coordinates(v).every(x=>Math.abs(x-Math.round(x))<.02));
}

/**
 * Require every reduction to re-derive observed adjacency and rigid image
 * evidence, obtain an exact chamber-cover projection, and independently
 * register/prove polygons on the unchanged raster. Recurse through all
 * prime-index intermediate translations up to the 24-cell observation bound.
 * An unverifiable reduction is not silently accepted as a canonical identity.
 */
export function recoverPrimitiveObservedLattice(
    raster: GrayscaleRaster,
    initial: Candidate,
    options: {topology?:ObservedTopologyOptions; refinement?:BasisRefinementOptions;
              globalFit?:RigidFitOptions}={}
): PrimitiveLatticeResult {
    let current=initial, reductions=0;
    while (current.interior.classes.length>1) {
        const successful: Candidate[]=[];
        const count=current.interior.classes.length;
        const sourceSymbol=inspectDSymbol(current.topology.dsSymbol,2048);
        let unresolvedSubperiod=false;
        if(sourceSymbol.status!=="euclidean")
            return {status:"ambiguous",reason:"Primitive search began with an invalid chamber graph"};
        for(const reduced of primeOverlattices(current.basis,count)) {
            const targetCount=Math.round(count*Math.abs(determinant(...reduced))/
                Math.abs(determinant(...current.basis)));
            if(targetCount<1||targetCount>=count||count%targetCount!==0)continue;
            const observation=repartition(current.interior,reduced,targetCount);
            if(!observation)continue;
            // Complete translated polygon matches establish a plausible
            // subperiod. If its topology or unchanged-image registration
            // cannot be certified, refuse the larger presentation instead
            // of claiming that the lattice is necessarily primitive.
            unresolvedSubperiod=true;
            const refined=refineRigidTranslationBasis(observation,reduced,options.refinement);
            const basis=refined.status==="refined"?refined.basis:reduced;
            const topology=deriveObservedTopology(observation,basis,options.topology);
            if(topology.status!=="derived")continue;
            const childSymbol=inspectDSymbol(topology.dsSymbol,2048);
            const index=count/targetCount;
            if(childSymbol.status!=="euclidean"||
                sourceSymbol.symbol.chamberCount!==childSymbol.symbol.chamberCount*index||
                !projectChambers(sourceSymbol.symbol,childSymbol.symbol))continue;
            const rigid=verifyRigidMotifFit(raster,observation,basis,options.globalFit);
            if(rigid.status!=="supported")continue;
            const metric=registerObservedMetric(raster,observation,topology,basis);
            if(metric.status!=="registered"||
                metric.independentlyDerivedDsSymbol!==topology.dsSymbol)continue;
            if(verifyProjectedPolygonsInOriginalRaster(raster,metric.cover).status!=="supported")
                continue;
            successful.push({basis,interior:observation,topology,
                rasterSupport:rigid.originalRasterEdgeSupport,
                rigidResidual:rigid.maxVertexResidualPixels});
        }
        if(!successful.length) {
            if(unresolvedSubperiod)
                return {status:"ambiguous",
                    reason:"A shorter observed polygon period lacks complete independent topology or image proof"};
            break;
        }
        const first=successful[0];
        if(successful.some(next=>
            next.topology.dsSymbol!==first.topology.dsSymbol ||
            !equivalentLattices(first.basis,next.basis)))
            return {status:"ambiguous",
                reason:"Several inequivalent reduced translation lattices have complete original-image evidence"};
        current=first;
        reductions++;
        if(reductions>4)
            return {status:"ambiguous",reason:"Primitive search exceeded bounded reduction depth"};
    }
    return {status:"verified",candidate:current,reductions};
}
