import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { OperationalCover, Point2 } from "../../resources/periodic-tiling/topology/motif.js";

export type SourcePolygonProjection =
    | {status:"supported"; evidence:"unchanged-source-polygon-projection";
        checkedEdgeSamples:number; matchedEdgeSamples:number;
        checkedInteriorSamples:number; matchedInteriorSamples:number;
        edgeSupport:number; interiorSupport:number;
        checkedRegions:number; supportedRegions:number;
        worstCheckedRegionEdgeSupport:number}
    | {status:"inconclusive" | "unsupported";reason:string};

/** An independent held-out image check: we sample the entire predicted
 * geometric periodic cover, including regions that did NOT yield a complete
 * white component during original raster contour segmentation. It neither
 * discovers a shape nor alters the supplied pixels or period geometry.
 *
 * A supported result remains research evidence only: a source image may
 * contain perspective, artwork, partial masks and nonuniform contrast for
 * which this high-contrast, locally Euclidean model does not apply.
 */
export function verifyProjectedPolygonsInOriginalRaster(
    raster: GrayscaleRaster,
    registeredPixelCover: OperationalCover,
    options: {
        minEdgeSupport?:number;
        minInteriorSupport?:number;
        minRegionEdgeSupport?:number;
        minSupportedRegions?:number;
    } = {}
): SourcePolygonProjection {
    const unsupported=(reason:string):SourcePolygonProjection=>({status:"unsupported",reason});
    const inconclusive=(reason:string):SourcePolygonProjection=>({status:"inconclusive",reason});
    const {width,height,pixels}=raster;
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
        ||width<96||height<96||width*height>1_500_000
        ||pixels.length!==width*height)
        return unsupported("Invalid or oversized original raster");
    if(registeredPixelCover.kind!=="witness-verified"
        ||registeredPixelCover.units!=="pixel"
        ||registeredPixelCover.cells.length<1||registeredPixelCover.cells.length>24)
        return unsupported("A complete independently verified pixel-coordinate cover is required");
    const minEdge=options.minEdgeSupport??0.83;
    const minInterior=options.minInteriorSupport??0.82;
    const minRegional=options.minRegionEdgeSupport??0.66;
    const minRegions=options.minSupportedRegions??7;
    if(![minEdge,minInterior,minRegional].every(x=>
        Number.isFinite(x)&&x>=0.5&&x<=1)
        ||!Number.isSafeInteger(minRegions)||minRegions<5||minRegions>9)
        return unsupported("Invalid bounded original-image projection thresholds");
    const [a,b]=registeredPixelCover.basis;
    const det=a.x*b.y-a.y*b.x;
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite)
        ||!Number.isFinite(det)||Math.abs(det)<4)
        return unsupported("Invalid source-image translation basis");
    const inverse=(p:Point2):Point2=>({
        x:(p.x*b.y-p.y*b.x)/det,
        y:(a.x*p.y-a.y*p.x)/det
    });
    const corners=[
        {x:0,y:0},{x:width,y:0},{x:0,y:height},{x:width,y:height}
    ].map(inverse);
    const minU=Math.floor(Math.min(...corners.map(p=>p.x)))-3;
    const maxU=Math.ceil(Math.max(...corners.map(p=>p.x)))+3;
    const minV=Math.floor(Math.min(...corners.map(p=>p.y)))-3;
    const maxV=Math.ceil(Math.max(...corners.map(p=>p.y)))+3;
    const total=(maxU-minU+1)*(maxV-minV+1)*registeredPixelCover.cells.length;
    if(!Number.isSafeInteger(total)||total>8000||total<1)
        return unsupported("Full-image projection exceeds the bounded periodic cell count");
    const region=(x:number,y:number)=>Math.min(2,Math.floor(3*x/width))
        +3*Math.min(2,Math.floor(3*y/height));
    const edge=new Int32Array(9),edgeMatched=new Int32Array(9);
    const interiors=new Int32Array(9),interiorsMatched=new Int32Array(9);
    const within=(x:number,y:number)=>x>=5&&y>=5&&x<width-5&&y<height-5;
    const inkAt=(x:number,y:number):boolean=>{
        const cx=Math.round(x),cy=Math.round(y);
        for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
            const xx=cx+dx,yy=cy+dy;
            if(xx>=0&&yy>=0&&xx<width&&yy<height
                &&pixels[yy*width+xx]<100)return true;
        }
        return false;
    };
    const interiorPoint=(pt:Point2,polygon:readonly Point2[]):boolean=>{
        let odd=false;
        for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
            const p=polygon[i],q=polygon[j];
            if((p.y>pt.y)!==(q.y>pt.y)
                &&pt.x<(q.x-p.x)*(pt.y-p.y)/(q.y-p.y)+p.x)odd=!odd;
        }
        return odd;
    };
    const segmentDistance=(pt:Point2,p:Point2,q:Point2):number=>{
        const dx=q.x-p.x,dy=q.y-p.y;
        const len=dx*dx+dy*dy;
        if(!len)return Math.hypot(pt.x-p.x,pt.y-p.y);
        const t=Math.max(0,Math.min(1,((pt.x-p.x)*dx+(pt.y-p.y)*dy)/len));
        return Math.hypot(pt.x-p.x-t*dx,pt.y-p.y-t*dy);
    };
    let samples=0;
    for(let u=minU;u<=maxU;u++)for(let v=minV;v<=maxV;v++){
        const tx=u*a.x+v*b.x,ty=u*a.y+v*b.y;
        for(const cell of registeredPixelCover.cells){
            const poly=cell.polygon.map(p=>({x:p.x+tx,y:p.y+ty}));
            if(poly.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))
                return unsupported("Nonfinite predicted polygon");
            const bounds=[Math.min(...poly.map(p=>p.x)),Math.min(...poly.map(p=>p.y)),
                Math.max(...poly.map(p=>p.x)),Math.max(...poly.map(p=>p.y))];
            if(bounds[2]<5||bounds[3]<5||bounds[0]>=width-5||bounds[1]>=height-5)continue;
            for(let i=0;i<poly.length;i++){
                const start=poly[i],end=poly[(i+1)%poly.length];
                const length=Math.hypot(end.x-start.x,end.y-start.y);
                if(!Number.isFinite(length)||length<1e-6||length>100_000)
                    return unsupported("Degenerate projected periodic edge");
                const count=Math.min(600,Math.max(1,Math.ceil(length/9)));
                for(let k=0;k<count;k++){
                    const t=(k+.5)/count;
                    const x=start.x+(end.x-start.x)*t;
                    const y=start.y+(end.y-start.y)*t;
                    if(!within(x,y))continue;
                    const slot=region(x,y);
                    edge[slot]++;
                    if(inkAt(x,y))edgeMatched[slot]++;
                    if(++samples>160_000)return unsupported("Raster projection sample budget exceeded");
                }
            }
            // One candidate interior sample from the image at the polygon's
            // geometric mean. Concave or thin polygons can have an invalid
            // centroid, so count only points clearly at least 5 pixels from
            // EVERY predicted edge; do not assert empty space outside a cell.
            const center={x:poly.reduce((s,p)=>s+p.x,0)/poly.length,
                y:poly.reduce((s,p)=>s+p.y,0)/poly.length};
            if(within(center.x,center.y)&&interiorPoint(center,poly)
                &&poly.every((p,i)=>
                    segmentDistance(center,p,poly[(i+1)%poly.length])>=5)){
                const slot=region(center.x,center.y);
                interiors[slot]++;
                if(pixels[Math.round(center.y)*width+Math.round(center.x)]>180)
                    interiorsMatched[slot]++;
            }
        }
    }
    const sum=(values:Int32Array):number=>values.reduce((a,b)=>a+b,0);
    const e=sum(edge),matched=sum(edgeMatched),i=sum(interiors),im=sum(interiorsMatched);
    const covered:number[]=[],supported:number[]=[];
    for(let regionIndex=0;regionIndex<9;regionIndex++){
        if(edge[regionIndex]<20)continue;
        covered.push(regionIndex);
        if(edgeMatched[regionIndex]/edge[regionIndex]>=minRegional)
            supported.push(regionIndex);
    }
    if(e<200||i<12||covered.length<minRegions)
        return inconclusive("Insufficient full-image polygon stroke and interior coverage");
    if(supported.length<minRegions
       ||new Set(supported.map(i=>i%3)).size<3
       ||new Set(supported.map(i=>Math.floor(i/3))).size<3)
        return inconclusive("Predicted polygon strokes lack independent distant-region support");
    const edgeSupport=matched/e,interiorSupport=im/i;
    if(edgeSupport<minEdge||interiorSupport<minInterior)
        return inconclusive("Predicted polygon lines or negative space contradict original image pixels");
    return {status:"supported",evidence:"unchanged-source-polygon-projection",
        checkedEdgeSamples:e,matchedEdgeSamples:matched,
        checkedInteriorSamples:i,matchedInteriorSamples:im,
        edgeSupport,interiorSupport,checkedRegions:covered.length,
        supportedRegions:supported.length,
        worstCheckedRegionEdgeSupport:Math.min(...covered.map(j=>edgeMatched[j]/edge[j]))};
}
