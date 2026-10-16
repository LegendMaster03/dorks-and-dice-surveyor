import test from "node:test";
import assert from "node:assert/strict";
import { verifyRigidMotifFit } from "../dist/src/analysis/periodic-tiling/global-motif-fit.js";
const SIZE=720,PITCH=80;
function grid(damagedCount=0){
    const pixels=new Uint8Array(SIZE*SIZE).fill(255);
    for(let n=0;n<=8;n++)for(let t=0;t<SIZE;t++)
        for(let delta=-1;delta<=1;delta++){
            const coord=n*PITCH+delta;
            if(coord>=0&&coord<SIZE){
                pixels[coord*SIZE+t]=0;
                pixels[t*SIZE+coord]=0;
            }
        }
    const interiors=[];
    for(let y=1;y<=7;y++)for(let x=1;x<=7;x++){
        const ox=x*PITCH,oy=y*PITCH;
        const polygon=[{x:ox+2,y:oy+2},{x:ox+78,y:oy+2},
                       {x:ox+78,y:oy+78},{x:ox+2,y:oy+78}];
        const centroid={x:ox+40,y:oy+40};
        if(interiors.length<damagedCount){
            for(const vertex of polygon){vertex.x+=4;vertex.y+=4;}
            centroid.x+=4;centroid.y+=4;
        }
        interiors.push({polygon,centroid,pixels:76*76,
            representative:true,motifClass:0});
    }
    return {raster:{width:SIZE,height:SIZE,pixels},
        observation:{status:"observed",reason:"independent observed raster",
        classes:[{id:0,sideCount:4,examples:49}],
        interiors,consideredComponents:49}};
}
const basis=[{x:PITCH,y:0},{x:0,y:PITCH}];

test("D02 one locally displaced first contour cannot determine global motif alignment",()=>{
    const {raster,observation}=grid(1);
    assert.deepEqual(observation.interiors[0].polygon[0],{x:86,y:86});
    const fit=verifyRigidMotifFit(raster,observation,basis);
    assert.equal(fit.status,"supported",fit.reason);
    assert.ok(fit.originalRasterEdgeSupport>=.83);
    assert.ok(fit.maxVertexResidualPixels<=5);
    assert.ok(fit.supportedRegions>=4);
    assert.equal(fit.checkedCells,49);
    assert.equal(fit.excludedContourObservations,1);
});
test("D02 a basis that accumulates drift is rejected despite centering",()=>{
    const {raster,observation}=grid();
    const wrong=[{x:PITCH+2.5,y:0},basis[1]];
    const fit=verifyRigidMotifFit(raster,observation,wrong);
    assert.equal(fit.status,"inconclusive");
    assert.match(fit.reason,/drift|addresses|contradict/i);
});
test("D02 a small minority of damaged local cells cannot alter the global phase",()=>{
    const {raster,observation}=grid(4);
    const fit=verifyRigidMotifFit(raster,observation,basis);
    assert.equal(fit.status,"supported",fit.reason);
    assert.equal(fit.excludedContourObservations,4);
    assert.ok(fit.originalRasterEdgeSupport>=.83);
});
test("D02 a substantial fraction of damaged cell observations is inconclusive",()=>{
    const {raster,observation}=grid(10);
    const fit=verifyRigidMotifFit(raster,observation,basis);
    assert.equal(fit.status,"inconclusive");
});
test("D02 guessed geometry without source ink stays inconclusive",()=>{
    const {observation}=grid();
    const raster={width:SIZE,height:SIZE,pixels:new Uint8Array(SIZE*SIZE).fill(255)};
    assert.notEqual(verifyRigidMotifFit(raster,observation,basis).status,"supported");
});
