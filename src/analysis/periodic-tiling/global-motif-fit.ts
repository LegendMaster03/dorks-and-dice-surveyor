import { originalRasterContrast } from "./original-raster-contrast.js";
import { PERIODIC_ANALYSIS_MAX_PIXELS } from "./analysis-raster-limits.js";
import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { InteriorObservation, ObservedPoint } from "./motif-interiors.js";
import type { TranslationVector } from "./translations.js";

export type RigidMotifFit =
    | { status: "supported"; maxVertexResidualPixels: number; rmsVertexResidualPixels: number;
        originalRasterEdgeSupport: number; supportedRegions: number; checkedCells: number;
        /** Local contour traces excluded from median geometry ONLY.
         * They still contribute to the unchanged-source ink evidence. */
        excludedContourObservations: number }
    | { status: "inconclusive" | "unsupported"; reason: string };

export type RigidFitOptions = {
    maxVertexResidualPixels?: number;
    minimumRasterEdgeSupport?: number;
};

/**
 * Check an entire proposed translation motif against the untouched image.
 * Fit ONE polygon per motif class from the coordinate-wise median of
 * independently observed, lattice-aligned source cell contours. No one
 * scanned cell determines the image alignment. Retain an independent
 * long-baseline drift test so centering cannot conceal wrong periods.
 * Check every predicted boundary against unchanged source-image ink.
 */
export function verifyRigidMotifFit(
    raster: GrayscaleRaster,
    observation: InteriorObservation,
    basis: readonly [TranslationVector, TranslationVector],
    options: RigidFitOptions = {}
): RigidMotifFit {
    const inconclusive = (reason: string): RigidMotifFit => ({ status: "inconclusive", reason });
    const unsupported = (reason: string): RigidMotifFit => ({ status: "unsupported", reason });
    const maxResidual = options.maxVertexResidualPixels ?? 5.0;
    const minRasterSupport = options.minimumRasterEdgeSupport ?? 0.83;
    if (!Number.isFinite(maxResidual) || maxResidual < 0.5 || maxResidual > 12 ||
        !Number.isFinite(minRasterSupport) || minRasterSupport < 0.5 || minRasterSupport > 1)
        return unsupported("Invalid bounded metric verification options");
    const { width, height, pixels } = raster;
    const contrast = originalRasterContrast(raster);
    if (observation.status !== "observed" || !observation.interiors.length ||
        !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || pixels.length !== width * height ||
        width * height > PERIODIC_ANALYSIS_MAX_PIXELS || observation.interiors.length > 600)
        return unsupported("No bounded original raster and complete geometric observations");
    if (!contrast) return inconclusive("Original source raster lacks separately supported ink and background");
    const [a, b] = basis, det = a.x * b.y - a.y * b.x;
    if (!Number.isFinite(det) || Math.abs(det) < 4)
        return unsupported("Invalid translation basis");
    const p = (x: number, y: number): ObservedPoint => ({ x, y });

    type CellWitness = {
        cell: (typeof observation.interiors)[number];
        shift: ObservedPoint;
        centroidPhase: ObservedPoint;
    };
    const median = (values: number[]): number => {
        values.sort((x,y)=>x-y);
        const n=values.length, i=Math.floor(n/2);
        return n%2?values[i]!:(values[i-1]!+values[i]!)/2;
    };
    const percentile=(sorted:readonly number[], q:number):number=>
        sorted[Math.floor((sorted.length-1)*q)]!;
    const consensus: {polygon:ObservedPoint[];witnesses:CellWitness[]}[]=[];
    for(const kind of observation.classes){
        const copies=observation.interiors.filter(c=>c.motifClass===kind.id);
        if(copies.length<3||copies.some(c=>
            c.polygon.length!==kind.sideCount ||
            !Number.isFinite(c.centroid.x)||!Number.isFinite(c.centroid.y)))
            return inconclusive("Insufficient repeated cell geometry for a global motif");
        // A scanned observation fixes only the INTEGRAL ADDRESS gauge,
        // not the geometry. The template itself is fitted from ALL copies.
        const gauge=copies[0]!.centroid;
        const witnesses:CellWitness[]=[];
        for(const cell of copies){
            const dx=cell.centroid.x-gauge.x,dy=cell.centroid.y-gauge.y;
            const fu=(dx*b.y-dy*b.x)/det,fv=(a.x*dy-a.y*dx)/det;
            const u=Math.round(fu),v=Math.round(fv);
            if(!Number.isSafeInteger(u)||!Number.isSafeInteger(v)
                ||Math.max(Math.abs(fu-u),Math.abs(fv-v))>.12)
                return inconclusive("Distant cell addresses disagree with the proposed translation basis");
            const shift=p(u*a.x+v*b.x,u*a.y+v*b.y);
            witnesses.push({cell,shift,
                centroidPhase:p(cell.centroid.x-shift.x,cell.centroid.y-shift.y)});
        }
        const xs=witnesses.map(w=>w.centroidPhase.x).sort((x,y)=>x-y);
        const ys=witnesses.map(w=>w.centroidPhase.y).sort((x,y)=>x-y);
        const baseline=Math.hypot(percentile(xs,.9)-percentile(xs,.1),
            percentile(ys,.9)-percentile(ys,.1));
        if(baseline>maxResidual)
            return inconclusive(`Distant repeated cells drift ${baseline.toFixed(2)} pixels under the proposed translation basis`);
        const polygon=Array.from({length:kind.sideCount},(_,corner)=>p(
            median(witnesses.map(w=>w.cell.polygon[corner]!.x-w.shift.x)),
            median(witnesses.map(w=>w.cell.polygon[corner]!.y-w.shift.y))));
        if(polygon.some(pt=>!Number.isFinite(pt.x)||!Number.isFinite(pt.y)))
            return unsupported("Nonfinite original-image motif consensus");
        consensus[kind.id]={polygon,witnesses};
    }
    if(consensus.length!==observation.classes.length||consensus.some(x=>!x))
        return inconclusive("Global motif class consensus is incomplete");
    let worst = 0, sumSq = 0, vertexCount = 0, supported = 0, tested = 0;
    let outlierCells=0;
    const retainedPerClass=new Array<number>(consensus.length).fill(0);
    const seenRegions = new Set<number>();
    // Use samples distributed along every predicted side. Pixels within three
    // of its white-region contour should contain part of the original ink stroke.
    const darkNear = (x: number, y: number): boolean => {
        const cx = Math.round(x), cy = Math.round(y);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const xx = cx + dx, yy = cy + dy;
            if (xx >= 0 && xx < width && yy >= 0 && yy < height && pixels[yy * width + xx] < contrast.inkUpperExclusive)
                return true;
        }
        return false;
    };

    for(let classId=0;classId<consensus.length;classId++){
        const template=consensus[classId]!;
        for(const {cell,shift} of template.witnesses){
            let cellWorst=0,cellSumSq=0;
            for(let i=0;i<cell.polygon.length;i++){
                const actual=cell.polygon[i]!;
                const predicted=p(template.polygon[i]!.x+shift.x,
                    template.polygon[i]!.y+shift.y);
                const residual=Math.hypot(actual.x-predicted.x,actual.y-predicted.y);
                if(!Number.isFinite(residual))return unsupported("Nonfinite contour coordinate");
                cellWorst=Math.max(cellWorst,residual);
                cellSumSq+=residual*residual;
                const next=template.polygon[(i+1)%template.polygon.length]!;
                // Outlying contours are not allowed to erase source evidence:
                // still check EVERY predicted edge at the ORIGINAL pixels.
                for(const t of [.25,.5,.75]){
                    const x=predicted.x+(next.x-template.polygon[i]!.x)*t;
                    const y=predicted.y+(next.y-template.polygon[i]!.y)*t;
                    if(x<4||x>=width-4||y<4||y>=height-4)continue;
                    tested++;
                    if(darkNear(x,y))supported++;
                }
            }
            if(cellWorst>maxResidual)outlierCells++;
            else {
                retainedPerClass[classId]++;
                worst=Math.max(worst,cellWorst);
                sumSq+=cellSumSq;
                vertexCount+=cell.polygon.length;
            }
            const region=Math.min(2,Math.floor(3*cell.centroid.x/width))+
                3*Math.min(2,Math.floor(3*cell.centroid.y/height));
            seenRegions.add(region);
        }
    }
    // A wrong lattice normally displaces an entire rank, not a few damaged
    // image contours. Permit at most 10% individual outlier observations.
    if(outlierCells>Math.floor(observation.interiors.length*.10)
        ||retainedPerClass.some(n=>n<3))
        return inconclusive("Too many repeated cells contradict one global rigid motif");
    if (tested < 100 || vertexCount < 24 || seenRegions.size < 4)
        return inconclusive("Too few distant original-image motif samples");
    const support = supported / tested;
    if (support < minRasterSupport)
        return inconclusive("Rigid motif edges are not consistently supported by source raster ink");
    return { status: "supported", maxVertexResidualPixels: worst,
        rmsVertexResidualPixels: Math.sqrt(sumSq / vertexCount), originalRasterEdgeSupport: support,
        supportedRegions: seenRegions.size, checkedCells: observation.interiors.length,
        excludedContourObservations: outlierCells };
}
