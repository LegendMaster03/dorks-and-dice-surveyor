import { originalRasterContrast } from "./original-raster-contrast.js";
import { PERIODIC_ANALYSIS_MAX_PIXELS } from "./analysis-raster-limits.js";
import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { TranslationVector } from "./translations.js";
import { splitObservedTJunctionSides } from "./raster-t-junctions.js";
import { alignPeriodicContourCorners } from "./periodic-contour-corner-alignment.js";

export type ObservedPoint = { x: number; y: number };
export type ObservedInterior = {
    /** Polygon sampled in source-image pixel coordinates; not yet an exact tiling witness. */
    polygon: readonly ObservedPoint[];
    pixels: number;
    centroid: ObservedPoint;
    representative: boolean;
    motifClass: number;
};
export type InteriorObservation = {
    status: "observed" | "inconclusive" | "unsupported";
    reason: string;
    classes: readonly { id: number; sideCount: number; examples: number }[];
    interiors: readonly ObservedInterior[];
    consideredComponents: number;
};
export type InteriorOptions = {
    maxPixels?: number;
    maxComponents?: number;
    maxInteriors?: number;
    minAreaPixels?: number;
    contourTolerancePixels?: number;
};

type Point = ObservedPoint;
type Component = { count: number; sumX: number; sumY: number; pixels: number[]; boundary: boolean };
const key = (p: Point): string => `${p.x},${p.y}`;
const sqDist = (a: Point, b: Point): number => (a.x-b.x)**2+(a.y-b.y)**2;
const cross = (a: Point,b: Point,c: Point):number => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const segmentDistance = (p:Point,a:Point,b:Point):number => {
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    if(!length)return Math.sqrt(sqDist(p,a));
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
function simplifyClosed(polygon:readonly Point[], tolerance:number):Point[] {
    // Rotate cyclic contour to a deterministic extremal point, then split into two
    // open chains. A single open-chain simplification would erase its closing side.
    const first=polygon.reduce((a,p,i)=>p.y<polygon[a].y||(p.y===polygon[a].y&&p.x<polygon[a].x)?i:a,0);
    const rotated=[...polygon.slice(first),...polygon.slice(0,first)];
    const origin=rotated[0];
    let far=1,max=-1;
    for(let i=1;i<rotated.length;i++){
        const d=sqDist(origin,rotated[i]);if(d>max){max=d;far=i;}
    }
    const chain=(points:Point[]):Point[]=>{
        if(points.length<3)return points;
        let distance=0,cut=0;
        for(let i=1;i<points.length-1;i++){
            const d=segmentDistance(points[i],points[0],points[points.length-1]);
            if(d>distance){distance=d;cut=i;}
        }
        if(distance<=tolerance)return [points[0],points[points.length-1]];
        return [...chain(points.slice(0,cut+1)).slice(0,-1),...chain(points.slice(cut))];
    };
    const combined=[...chain(rotated.slice(0,far+1)).slice(0,-1),...chain([...rotated.slice(far),origin]).slice(0,-1)];
    return combined.filter((p,i)=>i===0||sqDist(p,combined[i-1])>.01);
}
/**
 * Remove a raster staircase fragment only when its two incident contour
 * segments are nearly collinear and the omitted corner stays inside the
 * existing contour uncertainty. A sharp short side is not removed. Run this
 * before reconstructing T-junctions, whose collinear subdivision is evidence.
 */
function stabilizeRasterContour(points: readonly Point[], tolerance: number): Point[] {
    const polygon = [...points];
    while (polygon.length > 3) {
        let best = -1, bestError = Infinity;
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[(i + polygon.length - 1) % polygon.length];
            const b = polygon[i], c = polygon[(i + 1) % polygon.length];
            const ab = { x: b.x - a.x, y: b.y - a.y };
            const bc = { x: c.x - b.x, y: c.y - b.y };
            const lenA = Math.hypot(ab.x, ab.y), lenB = Math.hypot(bc.x, bc.y);
            if (lenA < 1 || lenB < 1 ||
                Math.min(lenA, lenB) > Math.max(8, Math.max(lenA, lenB) * 0.5))
                continue;
            // A genuine change of direction or a separately observable short
            // side cannot be merged on length alone.
            if ((ab.x * bc.x + ab.y * bc.y) / (lenA * lenB) < 0.97)
                continue;
            const error = segmentDistance(b, a, c);
            if (error <= tolerance && error < bestError) {
                bestError = error;
                best = i;
            }
        }
        if (best < 0) break;
        polygon.splice(best, 1);
    }
    return polygon;
}
function traceContour(component:Component, labels:Int32Array,id:number,width:number,height:number,maxEdges:number):Point[]|null {
    const starts=new Map<string,Point[]>();
    let count=0;
    const add=(x:number,y:number,xx:number,yy:number)=>{
        if(++count>maxEdges)return;
        const k=`${x},${y}`,values=starts.get(k)??[];
        values.push({x:xx,y:yy});starts.set(k,values);
    };
    for(const pos of component.pixels){
        const x=pos%width,y=Math.floor(pos/width);
        // Directed clockwise in image coordinates: inside lies to the right.
        if(y===0||labels[pos-width]!==id)add(x,y,x+1,y);
        if(x===width-1||labels[pos+1]!==id)add(x+1,y,x+1,y+1);
        if(y===height-1||labels[pos+width]!==id)add(x+1,y+1,x,y+1);
        if(x===0||labels[pos-1]!==id)add(x,y+1,x,y);
    }
    if(count>maxEdges || count<12)return null;
    const origin=[...starts.keys()].map(s=>s.split(',').map(Number))
        .sort((a,b)=>a[1]-b[1]||a[0]-b[0])[0];
    const start:Point={x:origin[0],y:origin[1]},poly:Point[]=[];
    let current=start;
    while(true){
        poly.push(current);
        const edges=starts.get(key(current));
        if(!edges||edges.length!==1)return null;
        const next=edges.pop()!;
        starts.delete(key(current));
        current=next;
        if(current.x===start.x&&current.y===start.y)break;
        if(poly.length>maxEdges)return null;
    }
    // The topmost/leftmost boundary point belongs to this component's outer
    // contour. Other cycles are interiors of dark marks (letters, labels,
    // symbols, artwork), not evidence that its surrounding cell is open.
    // Critically, do not promote the dark hole boundaries to tile edges:
    // only this outer contour may contribute to polygon reconstruction.
    // Ambiguous junctions on the selected outer cycle still fail above.
    return poly;
}
function fraction(value:number):number{return ((value%1)+1)%1;}
function phaseDistance(a:Point,b:Point,basis:readonly [TranslationVector,TranslationVector]):number{
    let best=Infinity;
    for(let u=-1;u<=1;u++)for(let v=-1;v<=1;v++){
        const dx=a.x-b.x+basis[0].x*u+basis[1].x*v;
        const dy=a.y-b.y+basis[0].y*u+basis[1].y*v;
        best=Math.min(best,Math.hypot(dx,dy));
    }
    return best;
}
/**
 * Bounded evidence probe for high-contrast, closed-line maps, NOT a general tiling
 * detector. Uses source raster once; does not warp/correct the image recursively.
 * Contour observations are uncertain geometry, not authoritative shared borders.
 */
export function observeMotifInteriors(
    raster:GrayscaleRaster,
    basis:readonly [TranslationVector,TranslationVector],
    options:InteriorOptions={}
):InteriorObservation {
    const {width,height,pixels}=raster;
    // The preprocessing contract retains images up to 2048 x 2048 pixels.
    // Reconstruct at that bounded analysis size rather than rejecting otherwise
    // valid 1584 x 1584 original-resolution grid references.
    const maxPixels=options.maxPixels??PERIODIC_ANALYSIS_MAX_PIXELS,maxComponents=options.maxComponents??3000;
    const maxInteriors=options.maxInteriors??600,minArea=options.minAreaPixels??100;
    const tolerance=options.contourTolerancePixels??2.5;
    const empty=(status:InteriorObservation["status"],reason:string,consideredComponents=0):InteriorObservation=>({
        status,reason,classes:[],interiors:[],consideredComponents
    });
    if(!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>8_000_000
        ||!Number.isSafeInteger(maxComponents)||maxComponents<1||maxComponents>10_000
        ||!Number.isSafeInteger(minArea)||minArea<16||minArea>100_000
        ||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<8||height<8
        ||width*height>maxPixels||pixels.length!==width*height
        ||!Number.isFinite(tolerance)||tolerance<=0||tolerance>10
        ||!Number.isSafeInteger(maxInteriors)||maxInteriors<1||maxInteriors>2000)
        return empty("unsupported","Unsupported raster size or contour limits");
    const [a,b]=basis,det=a.x*b.y-a.y*b.x;
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite)||Math.abs(det)<1)
        return empty("unsupported","No independent periodic translation basis");
    // Detect the image's own ink/background contrast when printed grid strokes
    // are dark gray, not black. The exact same source-pixel interpretation is
    // used by both independent final verification stages; no mask counts as ink.
    const contrast=originalRasterContrast(raster);
    if(!contrast)
        return empty("inconclusive",
            "The source image does not separate printed grid lines from cell interiors; use a clearer grid image or manual placement");
    // White connected regions; four-neighbor traversal never jumps a black stroke.
    const labels=new Int32Array(pixels.length), components:Component[]=[];
    const queue=new Int32Array(pixels.length);
    for(let start=0;start<pixels.length;start++){
        if(pixels[start]<contrast.segmentationFloor||labels[start])continue;
        if(components.length>=maxComponents)return empty("unsupported","Too many connected raster components",components.length);
        const id=components.length+1,comp:Component={count:0,sumX:0,sumY:0,pixels:[],boundary:false};
        let head=0,tail=1;queue[0]=start;labels[start]=id;
        while(head<tail){
            const p=queue[head++],x=p%width,y=Math.floor(p/width);
            comp.count++;comp.sumX+=x;comp.sumY+=y;
            if(x===0||x===width-1||y===0||y===height-1)comp.boundary=true;
            comp.pixels.push(p);
            for(const neighbor of [x? p-1:-1,x<width-1?p+1:-1,y?p-width:-1,y<height-1?p+width:-1]){
                if(neighbor>=0&&!labels[neighbor]&&pixels[neighbor]>=contrast.segmentationFloor){labels[neighbor]=id;queue[tail++]=neighbor;}
            }
        }
        components.push(comp);
    }
    const found:{polygon:Point[];centroid:Point;count:number;phase:Point;classId:number}[]=[];
    for(let i=0;i<components.length;i++){
        const comp=components[i];
        if(comp.boundary||comp.count<minArea)continue;
        if(found.length>=maxInteriors)return empty("unsupported","Too many interior cells",components.length);
        const contour=traceContour(comp,labels,i+1,width,height,30000);
        if(!contour||contour.length>4096)continue;
        const polygon=stabilizeRasterContour(simplifyClosed(contour,tolerance),tolerance);
        if(polygon.length<3||polygon.length>32)continue;
        const centroid={x:comp.sumX/comp.count,y:comp.sumY/comp.count};
        const u=fraction((centroid.x*b.y-centroid.y*b.x)/det);
        const v=fraction((a.x*centroid.y-a.y*centroid.x)/det);
        const phase={x:u*a.x+v*b.x,y:u*a.y+v*b.y};
        found.push({polygon,centroid,count:comp.count,phase,classId:-1});
    }
    if(found.length<6)return empty("inconclusive","Too few complete repeating cell interiors",components.length);
    // The closed white-region contour alone may simplify away a collinear
    // T-junction. Restore a split only when the opposing ink-separated sides
    // independently support it. The same normalized side count is subsequently
    // required to repeat across distant motif instances.
    const normalized = splitObservedTJunctionSides(found.map(cell => cell.polygon), {
        maxInkGapPixels: 6, maxPolygonSides: 12
    });
    if (normalized.status !== "split")
        return empty("inconclusive", normalized.reason, components.length);
    for (let i = 0; i < found.length; i++) found[i].polygon = normalized.polygons[i];
    if(normalized.unresolvedIndices.length){
        // Labels, roads, and icons can intersect the actual printed edge of
        // an otherwise valid cell. Never make its incompatible contour a
        // fabricated polygon, and never let one bad local contour veto all
        // independent, distant periodic cell observations.
        const rejected=new Set(normalized.unresolvedIndices);
        const complete=found.filter((_,i)=>!rejected.has(i));
        if(complete.length<6||rejected.size>Math.floor(found.length*.20))
            return empty("inconclusive","Too many locally ambiguous contours to establish repeated cell geometry",components.length);
        found.splice(0,found.length,...complete);
    }
    // A heavy decorative ink frame differs from the actual repeated interior
    // boundaries. Its first/last cells can have contour corners displaced
    // diagonally by more than the *unchanged* 6 px metric residual bound even
    // when the interior grid is exact. Observe the original source raster's
    // four crop edges, not the candidate tiling shape, to identify a frame.
    // Ignore uncertain border-cell CONTOURS as motif votes, but keep all
    // original pixels for global metric/held-out source projection checks.
    const frameSampleCount=96;
    const frameInkFraction=(edge:number):number=>{
        let supported=0;
        for(let i=0;i<frameSampleCount;i++){
            const t=(i+0.5)/frameSampleCount;
            const x=edge===0||edge===1
                ? Math.min(width-1,Math.floor(t*width))
                : edge===2 ? 3 : width-4;
            const y=edge===2||edge===3
                ? Math.min(height-1,Math.floor(t*height))
                : edge===0 ? 3 : height-4;
            if(pixels[y*width+x]<contrast.inkUpperExclusive)supported++;
        }
        return supported/frameSampleCount;
    };
    const fullFrame=[0,1,2,3].filter(edge=>frameInkFraction(edge)>=.60).length>=3;
    if(fullFrame){
        const margin=Math.max(8,Math.ceil(tolerance*2+3));
        const interior=found.filter(cell=>cell.polygon.every(p=>
            p.x>=margin&&p.x<=width-margin&&
            p.y>=margin&&p.y<=height-margin));
        if(interior.length>=6 && interior.length>=Math.ceil(found.length*.25))
            found.splice(0,found.length,...interior);
    }
    if (normalized.restoredVertices > 0) {
        // An intact white component very near the crop can lack a complete
        // neighboring component beyond the image. Its long side can only be
        // partially subdivided by the local evidence. Omit the peripheral
        // component from topology *votes*, not from original-image validation.
        // This is a generic edge-length-derived margin, not a tiling profile.
        const longestEdge = Math.max(...found.flatMap(cell=>cell.polygon.map((p,i)=>
            Math.hypot(p.x-cell.polygon[(i+1)%cell.polygon.length].x,
                p.y-cell.polygon[(i+1)%cell.polygon.length].y))));
        const margin = Math.min(128,Math.ceil(longestEdge+8));
        const complete = found.filter(cell=>cell.polygon.every(p=>
            p.x >= margin && p.y >= margin &&
            p.x <= width-margin && p.y <= height-margin));
        if (complete.length < 6)
            return empty("inconclusive",
                "Too few complete interior junctions after excluding uncertain crop boundaries",
                components.length);
        found.splice(0,found.length,...complete);
    }
    // Classify by lattice phase first, independently of side count: a cell
    // near a crop boundary may have one locally unobservable T-junction.
    // Never repair it by inventing a side; discard only that isolated contour
    // when distant repetitions establish one dominant complete polygon.
    const groups:{
        point:Point;
        sides:number;
        examples:number;
        counts:Map<number,number>;
    }[]=[];
    for(const observation of found){
        let which=groups.findIndex(group=>
            phaseDistance(group.point,observation.phase,basis)<Math.max(4,tolerance*2));
        if(which<0){
            which=groups.length;
            groups.push({point:observation.phase,sides:observation.polygon.length,
                examples:0,counts:new Map()});
        }
        const group=groups[which];
        group.examples++;
        group.counts.set(observation.polygon.length,
            (group.counts.get(observation.polygon.length)??0)+1);
        observation.classId=which;
    }
    const discarded = new Set<typeof found[number]>();
    for(const group of groups){
        const counts=[...group.counts.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
        if(counts.length===0)return empty("inconclusive","Unresolved repeating contour topology",components.length);
        const [sideCount,majority]=counts[0];
        if(counts.length>1){
            if(majority<3 || majority/group.examples<0.70)
                return empty("inconclusive","Repeated cell contours disagree on junction subdivision",components.length);
            // A small number of locally incomplete contours must not become
            // distinct geometric motifs. Their ink evidence is not enough to
            // support the omitted side, so exclude them from topology votes.
            group.sides=sideCount;
            for(const observation of found)
                if(observation.classId===groups.indexOf(group)
                    &&observation.polygon.length!==sideCount)
                    discarded.add(observation);
        } else group.sides=sideCount;
    }
    const retained=found.filter(observation=>!discarded.has(observation));
    const retainedCounts=groups.map((group,id)=>
        retained.filter(observation=>observation.classId===id).length);
    if(groups.some((group,id)=>retainedCounts[id]<3)
        ||retained.length<6
        ||discarded.size>Math.max(3,Math.floor(found.length*0.15)))
        return empty("inconclusive","Insufficient complete repeated contour witnesses",components.length);
    // Every copy of a periodic motif class must name the SAME physical
    // polygon corners in the SAME cyclic order. Contour tracing selects the
    // topmost surviving raster vertex, which can be a *different corner* when
    // artwork obscures the top-left boundary of a cell. That is a one-period
    // vertex-index error, not a translation or scaling error.
    //
    // Select a geometry-neutral medoid from multiple independently observed
    // copies, rotate corner INDEXES only, and exclude isolated incompatible
    // contours. No vertices are moved or snapped, and no polygon type or
    // ruleset is supplied. Original source ink remains authoritative later.
    const corners=alignPeriodicContourCorners(retained, groups.length, {
        maximumShapeResidualPixels:Math.max(8,tolerance*3),
        maximumRejectedFraction:.15
    });
    if(corners.status!=="aligned")
        return empty("inconclusive",corners.reason,components.length);
    const alignedCounts=groups.map((_,id)=>
        corners.observations.filter(o=>o.classId===id).length);
    if(alignedCounts.some(n=>n<3)||corners.observations.length<6)
        return empty("inconclusive","Insufficient consistently indexed original-image contour witnesses",components.length);
    return {
        status:"observed",reason:"Repeated closed cell interiors observed; topology and D-symbol remain unverified",
        consideredComponents:components.length,
        classes:groups.map((g,id)=>({id,sideCount:g.sides,examples:alignedCounts[id]})),
        interiors:corners.observations.map(o=>({
            polygon:o.polygon,pixels:o.count,centroid:o.centroid,
            representative:true,motifClass:o.classId
        }))
    };
}
