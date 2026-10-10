import { canonicalDSymbol, inspectDSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";
import type { OperationalCover, Point2, LatticeShift } from "./motif.js";
import { reduceCombinatorialChamberSymmetry } from "./chamber-symmetry-reduction.js";

export type VerifiedRigidIsometry = {
    sourceOrigin: Point2;
    targetOrigin: Point2;
    xAxis: Point2;
    yAxis: Point2;
};
export type MetricChamberSymmetryResult =
    | { status: "verified"; translationDsSymbol: string; metricQuotientDsSymbol: string;
        metricAutomorphisms: number; combinatorialAutomorphisms: number;
        sourceChambers: number; quotientChambers: number; maximumResidual: number;
        verifiedRigidIsometries: readonly VerifiedRigidIsometry[];
        evidence: "complete-periodic-polygon-witness" }
    | { status: "inconclusive" | "unsupported"; reason: string };

/**
 * Derives the Euclidean ISOMETRIES of a separately validated translation
 * motif. This does not use noisy pixels or assert that Surveyor has located
 * the correct motif in any given image.
 *
 * Enumerate every color-preserving chamber automorphism (the image of a
 * single flag determines all remaining flags), then retain one only when
 * an explicit rotation/reflection and integer unimodular lattice action
 * map EVERY barycentric flag, polygon side, and periodic edge voltage.
 *
 * A combinatorial quotient can be strictly smaller than this metric one.
 * Neither may replace a raster-derived identity without original-image
 * registration and a separate uncertainty evaluation.
 */
export function verifyMetricChamberSymmetry(
    cover: OperationalCover,
    tolerance = 1e-7
): MetricChamberSymmetryResult {
    const unsupported = (reason: string): MetricChamberSymmetryResult => ({ status: "unsupported", reason });
    const inconclusive = (reason: string): MetricChamberSymmetryResult => ({ status: "inconclusive", reason });
    if (cover.kind !== "witness-verified" || !Number.isFinite(tolerance)
        || tolerance <= 0 || tolerance > 0.01
        || cover.basis.length !== 2 || !cover.cells.length || cover.cells.length > 24)
        return unsupported("A bounded independently verified metric motif and strict numerical tolerance are required");
    const [a,b] = cover.basis;
    const cross = (u: Point2,v: Point2): number => u.x*v.y-u.y*v.x;
    const add = (u: Point2,v: Point2): Point2 => ({ x:u.x+v.x,y:u.y+v.y });
    const sub = (u: Point2,v: Point2): Point2 => ({ x:u.x-v.x,y:u.y-v.y });
    const mul = (u: Point2,t: number): Point2 => ({ x:u.x*t,y:u.y*t });
    const norm = (u: Point2): number => Math.hypot(u.x,u.y);
    const lattice = (u:number,v:number): Point2 => add(mul(a,u),mul(b,v));
    const determinant = cross(a,b);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9)
        return unsupported("Translation basis is not numerically independent");
    type Flag = { vertex:Point2; midpoint:Point2; center:Point2;
        cell:number; side:number; isEnd:boolean; shift:LatticeShift };
    const flags:Flag[] = [{vertex:{x:0,y:0},midpoint:{x:0,y:0},center:{x:0,y:0},
        cell:-1,side:-1,isEnd:false,shift:[0,0]}];
    const starts:number[][] = [];
    const byId = new Map(cover.cells.map((c,i)=>[c.id,i]));
    for (let i=0;i<cover.cells.length;i++) {
        const cell=cover.cells[i];
        if (!cell.boundary.length || cell.boundary.length > 32)
            return unsupported("Motif polygon exceeds metric symmetry bounds");
        // Average all atomic side vertices, not an arbitrary choice of the
        // original polygon's collinear contour simplification.
        const center = mul(cell.boundary.reduce((s,edge)=>add(s,edge.segment[0]),{x:0,y:0}),
            1/cell.boundary.length);
        starts[i]=[];
        for(let side=0;side<cell.boundary.length;side++) {
            const edge=cell.boundary[side], [from,to]=edge.segment;
            starts[i].push(flags.length);
            const midpoint=mul(add(from,to),.5);
            flags.push({vertex:from,midpoint,center,cell:i,side,isEnd:false,
                shift:edge.target.lattice});
            flags.push({vertex:to,midpoint,center,cell:i,side,isEnd:true,
                shift:edge.target.lattice});
        }
    }
    const n=flags.length-1;
    if(n<6 || n>1024) return unsupported("Metric symmetry chamber limit exceeded");
    const maps:[number[],number[],number[]]=[
        new Array(n+1).fill(0),new Array(n+1).fill(0),new Array(n+1).fill(0)
    ];
    const m01=new Array(n+1).fill(0),m12=new Array(n+1).fill(0);
    for(let cell=0;cell<cover.cells.length;cell++) {
        const boundaries=cover.cells[cell].boundary, sides=boundaries.length;
        for(let side=0;side<sides;side++) {
            const edge=boundaries[side];
            const peerCell=byId.get(edge.target.motifCell);
            if(peerCell===undefined || edge.reciprocalEdgeIndex<0
                || edge.reciprocalEdgeIndex>=cover.cells[peerCell].boundary.length)
                return inconclusive("Metric motif contains an unresolved reciprocal edge");
            const first=starts[cell][side], previous=starts[cell][(side+sides-1)%sides];
            const next=starts[cell][(side+1)%sides], peer=starts[peerCell][edge.reciprocalEdgeIndex];
            maps[0][first]=first+1;maps[0][first+1]=first;
            maps[1][first]=previous+1;maps[1][first+1]=next;
            maps[2][first]=peer+1;maps[2][first+1]=peer;
            m01[first]=sides;m01[first+1]=sides;
        }
    }
    const visited=new Set<number>();
    for(let root=1;root<=n;root++){
        if(visited.has(root))continue;
        const orbit=[root];visited.add(root);
        for(let p=0;p<orbit.length;p++)for(const map of [maps[1],maps[2]]) {
            const next=map[orbit[p]];
            if(!next || next>n) return inconclusive("Invalid metric chamber adjacency");
            if(!visited.has(next)){visited.add(next);orbit.push(next);}
        }
        if(orbit.length%2) return inconclusive("Invalid vertex chamber orbit");
        for(const member of orbit)m12[member]=orbit.length/2;
    }
    const derived=canonicalDSymbol(maps,m01,m12);
    const inspected=inspectDSymbol(derived,2048);
    if(inspected.status!=="euclidean" || derived!==cover.translationSymbol)
        return inconclusive("Metric motif incidence differs from its validated translation symbol");
    const combinatorial=reduceCombinatorialChamberSymmetry(derived,2048);
    if(combinatorial.status!=="reduced")
        return inconclusive("Cannot independently prove the combinatorial reference quotient");

    const parent=Array.from({length:n+1},(_,i)=>i);
    const find=(p:number):number=>{while(parent[p]!==p){parent[p]=parent[parent[p]];p=parent[p];}return p;};
    const union=(x:number,y:number):void=>{
        const px=find(x),py=find(y);
        if(px!==py)parent[Math.max(px,py)]=Math.min(px,py);
    };
    let metricAutomorphisms=0, maximumResidual=0;
    const verifiedRigidIsometries: VerifiedRigidIsometry[] = [];
    const reference=flags[1];
    const d=sub(reference.midpoint,reference.vertex),length=norm(d);
    if(length<1e-9)return unsupported("Barycentric reference side is degenerate");
    const u=mul(d,1/length),v={x:-u.y,y:u.x};

    for(let root=1;root<=n;root++){
        if(m01[1]!==m01[root] || m12[1]!==m12[root])continue;
        const map=new Array<number>(n+1).fill(0),queue=[1];
        map[1]=root;let valid=true;
        for(let k=0;k<queue.length&&valid;k++){
            const from=queue[k],target=map[from];
            if(m01[from]!==m01[target] || m12[from]!==m12[target]){valid=false;break;}
            for(const relation of maps){
                const next=relation[from],image=relation[target];
                if(!map[next]){map[next]=image;queue.push(next);}
                else if(map[next]!==image){valid=false;break;}
            }
        }
        if(!valid||queue.length!==n||new Set(map.slice(1)).size!==n)continue;
        const desired=flags[root],e=sub(desired.midpoint,desired.vertex);
        if(Math.abs(norm(e)-length)>tolerance)continue;
        const U=mul(e,1/length),V={x:-U.y,y:U.x};
        for(const handedness of [1,-1]){
            const linear=(p:Point2):Point2=>{
                const along=p.x*u.x+p.y*u.y;
                const perpendicular=p.x*v.x+p.y*v.y;
                return add(mul(U,along),mul(V,handedness*perpendicular));
            };
            const transform=(p:Point2):Point2=>
                add(desired.vertex,linear(sub(p,reference.vertex)));
            const latticeCoordinates=(p:Point2):readonly [number,number]=>[
                cross(p,b)/determinant,cross(a,p)/determinant
            ];
            // The transformed two basis generators must be integer and
            // unimodular. Otherwise an apparent local isometry can map into
            // a proper sublattice while missing the infinite periodic tiling.
            const [aa,ab]=latticeCoordinates(linear(a));
            const [ba,bb]=latticeCoordinates(linear(b));
            const M=[Math.round(aa),Math.round(ab),Math.round(ba),Math.round(bb)];
            if([aa,ab,ba,bb].some((x,i)=>Math.abs(x-M[i])>1e-6)
                || Math.abs(M[0]*M[3]-M[1]*M[2])!==1)continue;

            const offsets:Array<readonly [number,number]>=[ [0,0] ];
            let worst=0,works=true;
            for(let f=1;f<=n;f++){
                const original=flags[f],target=flags[map[f]];
                const coordinates=latticeCoordinates(sub(transform(original.vertex),target.vertex));
                const rounded:[number,number]=[Math.round(coordinates[0]),Math.round(coordinates[1])];
                if(rounded.some(x=>!Number.isSafeInteger(x))){works=false;break;}
                const displacement=lattice(...rounded);
                const landmarks:[Point2,Point2,Point2]=[
                    original.vertex,original.midpoint,original.center
                ];
                const destinations:[Point2,Point2,Point2]=[
                    target.vertex,target.midpoint,target.center
                ];
                for(let h=0;h<3;h++){
                    const error=norm(sub(transform(landmarks[h]),add(destinations[h],displacement)));
                    if(!Number.isFinite(error)||error>tolerance){works=false;break;}
                    worst=Math.max(worst,error);
                }
                if(!works)break;
                offsets.push(rounded);
            }
            if(!works)continue;
            // Check periodic s2 edge voltages and zero-offset s0/s1
            // incidence. Geometry alone modulo the torus is insufficient:
            // this also proves the infinite-cover lift commutes with edges.
            for(let f=1;f<=n&&works;f++)for(let k=0;k<3;k++){
                const next=maps[k][f];
                const sourceShift=k===2?flags[f].shift:[0,0];
                const targetShift=k===2?flags[map[f]].shift:[0,0];
                // A source offset is an exact JSON integer, but a lattice
                // basis automorphism can amplify it beyond Number.MAX_SAFE_INTEGER.
                // Prove the voltage equation over integers, not rounded floats.
                const targetU=BigInt(targetShift[0]),targetV=BigInt(targetShift[1]);
                const nextU=BigInt(offsets[next][0]),nextV=BigInt(offsets[next][1]);
                const originU=BigInt(offsets[f][0]),originV=BigInt(offsets[f][1]);
                if(nextU+BigInt(M[0])*BigInt(sourceShift[0])
                       +BigInt(M[2])*BigInt(sourceShift[1])!==originU+targetU
                    ||nextV+BigInt(M[1])*BigInt(sourceShift[0])
                       +BigInt(M[3])*BigInt(sourceShift[1])!==originV+targetV){
                    works=false;break;
                }
            }
            if(!works)continue;
            metricAutomorphisms++;
            verifiedRigidIsometries.push({
                sourceOrigin: reference.vertex,
                targetOrigin: desired.vertex,
                xAxis: linear({x:1,y:0}),
                yAxis: linear({x:0,y:1})
            });
            maximumResidual=Math.max(maximumResidual,worst);
            for(let i=1;i<=n;i++)union(i,map[i]);
            break;
        }
    }
    if(!metricAutomorphisms)return inconclusive("No identity metric isometry verified");

    const representatives=[0],classId=new Array<number>(n+1).fill(0);
    const seen=new Map<number,number>();
    for(let chamber=1;chamber<=n;chamber++){
        const p=find(chamber);
        if(!seen.has(p)){seen.set(p,representatives.length);representatives.push(chamber);}
        classId[chamber]=seen.get(p)!;
    }
    const qn=representatives.length-1;
    const qmaps=maps.map(relation=>representatives.map((old,i)=>
        i===0?0:classId[relation[old]])) as [number[],number[],number[]];
    const qa=representatives.map((old,i)=>i?m01[old]:0);
    const qb=representatives.map((old,i)=>i?m12[old]:0);
    const quotient=inspectDSymbol(canonicalDSymbol(qmaps,qa,qb),2048);
    if(quotient.status!=="euclidean"||quotient.symbol.chamberCount!==qn
        ||!projectChambers(inspected.symbol,quotient.symbol))
        return inconclusive("Proposed geometric quotient did not pass independent covering proof");
    return {status:"verified",translationDsSymbol:derived,
        metricQuotientDsSymbol:quotient.symbol.canonical,
        metricAutomorphisms,combinatorialAutomorphisms:combinatorial.automorphismCount,
        sourceChambers:n,quotientChambers:qn,maximumResidual,
        verifiedRigidIsometries,
        evidence:"complete-periodic-polygon-witness"};
}
