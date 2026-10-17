import test from "node:test";
import assert from "node:assert/strict";
import { alignPeriodicContourCorners } from "../dist/src/analysis/periodic-tiling/periodic-contour-corner-alignment.js";

const poly=(x,y)=>[
    {x:x+3,y:y+3},{x:x+173,y:y+3},
    {x:x+173,y:y+173},{x:x+3,y:y+173}
];
const rotate=(p,by)=>[...p.slice(by),...p.slice(0,by)];
function witness(x,y,polygon,cls=0){
    return {centroid:{x:x+88,y:y+88},polygon,classId:cls};
}
test("D02 original square grid: one rotated contour corner cannot cause a 176px metric error",()=>{
    const cases=[];
    for(let y=0;y<9;y++)for(let x=0;x<9;x++){
        const p=poly(x*176,y*176);
        // A painted boundary changes the *first returned* contour vertex
        // but does not justify moving its true vertices by one side.
        cases.push(witness(x*176,y*176,(x===6&&y===6)?rotate(p,1):p));
    }
    const result=alignPeriodicContourCorners(cases,1);
    assert.equal(result.status,"aligned",result.reason);
    assert.equal(result.rejectedObservations,0);
    assert.equal(result.rotatedObservations,1);
    const target=result.observations[6+6*9];
    const reference=result.observations[0];
    for(let i=0;i<4;i++){
        assert.ok(Math.abs((target.polygon[i].x-target.centroid.x)-
            (reference.polygon[i].x-reference.centroid.x))<1);
        assert.ok(Math.abs((target.polygon[i].y-target.centroid.y)-
            (reference.polygon[i].y-reference.centroid.y))<1);
    }
});
test("D02 unordered distorted first cell does not establish repeated corner indexing",()=>{
    const cases=Array.from({length:25},(_,i)=>{
        const x=i%5*80,y=Math.floor(i/5)*80;
        const p=poly(x,y);
        return witness(x,y,i===0?rotate(p,2):p);
    });
    const result=alignPeriodicContourCorners(cases,1);
    assert.equal(result.status,"aligned",result.reason);
    assert.equal(result.rotatedObservations,1);
});
test("D02 triangle and hexagon copies align cyclic indexing without named tiling templates",()=>{
    for(const base of [
        [{x:0,y:0},{x:80,y:0},{x:40,y:69}],
        [{x:25,y:0},{x:75,y:29},{x:75,y:86},{x:25,y:115},
         {x:-25,y:86},{x:-25,y:29}]
    ]){
        const centroid={x:base.reduce((s,p)=>s+p.x,0)/base.length,
            y:base.reduce((s,p)=>s+p.y,0)/base.length};
        const cases=Array.from({length:12},(_,i)=>{
            const tx=i*100,ty=(i%3)*145;
            const points=base.map(p=>({x:p.x+tx,y:p.y+ty}));
            return {classId:0,centroid:{x:centroid.x+tx,y:centroid.y+ty},
                polygon:i%4===0?rotate(points,2):points};
        });
        const aligned=alignPeriodicContourCorners(cases,1);
        assert.equal(aligned.status,"aligned",aligned.reason);
        assert.equal(aligned.rejectedObservations,0);
        const ref=aligned.observations[0];
        for(const cell of aligned.observations)for(let j=0;j<base.length;j++){
            assert.ok(Math.abs((cell.polygon[j].x-cell.centroid.x)-
                (ref.polygon[j].x-ref.centroid.x))<1e-8);
        }
    }
});
test("D02 an incompatible artwork-damaged minority is excluded, while a majority fails closed",()=>{
    const cases=Array.from({length:20},(_,i)=>{
        const x=i*80,y=0,p=poly(x,y);
        if(i<2)p[1]={x:p[1].x+40,y:p[1].y+40};
        return witness(x,y,p);
    });
    const okay=alignPeriodicContourCorners(cases,1);
    assert.equal(okay.status,"aligned",okay.reason);
    assert.equal(okay.rejectedObservations,2);
    const bad=cases.map((cell,i)=>i<8?{...cell,polygon:
        cell.polygon.map((p,j)=>j===1?{x:p.x+40,y:p.y+40}:p)}:cell);
    assert.equal(alignPeriodicContourCorners(bad,1).status,"inconclusive");
});
test("D02 no reflection of polygon orientation is silently accepted as a cyclic rotation",()=>{
    const cases=Array.from({length:14},(_,i)=>{
        const x=i*200,p=poly(x,0);
        return witness(x,0,i<2?[p[0],p[3],p[2],p[1]]:p);
    });
    const checked=alignPeriodicContourCorners(cases,1);
    assert.equal(checked.status,"aligned");
    assert.equal(checked.rejectedObservations,2);
});
