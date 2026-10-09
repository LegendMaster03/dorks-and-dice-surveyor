import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {verifyMetricChamberSymmetry} from '../dist/src/resources/periodic-tiling/topology/metric-chamber-symmetry.js';
import {verifyOriginalRasterIsometry as verify,
    crossCheckMetricSymmetryWithOriginalRaster as crossCheck} from
    '../dist/src/analysis/periodic-tiling/original-raster-isometry.js';

const p=(x,y)=>({x,y});
const quarterTurn={sourceOrigin:p(319.5,319.5),targetOrigin:p(319.5,319.5),
    xAxis:p(0,1),yAxis:p(-1,0)};
const halfTurn={sourceOrigin:p(319.5,319.5),targetOrigin:p(319.5,319.5),
    xAxis:p(-1,0),yAxis:p(0,-1)};
function raster({xPitch=40,yPitch=40,width=640,height=640,
    grid=true,local=false,maskCorner=false,texture=false}={}){
    const pixels=new Uint8Array(width*height).fill(255);
    const dark=(x,y)=>{if(x>=0&&x<width&&y>=0&&y<height)pixels[y*width+x]=0;};
    const dx=(x)=>Math.abs(((x-40+xPitch*100)%xPitch));
    const dy=(y)=>Math.abs(((y-40+yPitch*100)%yPitch));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        if(grid && (!local || x>=210&&x<430&&y>=210&&y<430)
            && (!maskCorner || !(x>410&&y>410))
            && (dx(x)<=1||dy(y)<=1))dark(x,y);
        if(texture && x>400&&y>400 && (x+y)%13<4)dark(x,y);
    }
    return {width,height,pixels};
}
const square=deriveTranslationMotif({units:'pixel',
    basis:[p(40,0),p(0,40)],cells:[{id:'unit',
        polygon:[p(0,0),p(40,0),p(40,40),p(0,40)]}]});
const rectangle=deriveTranslationMotif({units:'pixel',
    basis:[p(40,0),p(0,80)],cells:[{id:'unit',
        polygon:[p(0,0),p(40,0),p(40,80),p(0,80)]}]});

test('independent geometric square symmetry also survives complete unchanged raster',()=>{
    const metric=verifyMetricChamberSymmetry(square);
    assert.equal(metric.status,'verified');
    assert.equal(metric.metricAutomorphisms,8);
    const source=raster();
    const result=verify(source,quarterTurn);
    assert.equal(result.status,'supported',result.reason);
    assert.equal(result.evidence,'unchanged-source-raster');
    assert.ok(result.supportedRegions>=6);
    assert.ok(result.inkSupport>=0.87);
    assert.ok(result.checkedInk>200);
    assert.equal(verify(source,halfTurn).status,'supported');
});
test('a non-square rectangular grid rejects 90 degree image symmetry despite combinatorial square topology',()=>{
    const metric=verifyMetricChamberSymmetry(rectangle);
    assert.equal(metric.status,'verified');
    assert.equal(metric.combinatorialAutomorphisms,8);
    assert.equal(metric.metricAutomorphisms,4);
    const result=verify(raster({yPitch:80}),quarterTurn);
    assert.equal(result.status,'inconclusive');
});
test('local square patch cannot masquerade as distant source-image symmetry',()=>{
    const result=verify(raster({local:true}),quarterTurn);
    assert.equal(result.status,'inconclusive');
    assert.match(result.reason,/spatially distributed|distant-region/);
});
test('missing distant grid lines and asymmetric artwork reject symmetry',()=>{
    const missing=verify(raster({maskCorner:true}),quarterTurn);
    assert.equal(missing.status,'inconclusive');
    const unrelated=verify(raster({texture:true}),quarterTurn);
    assert.equal(unrelated.status,'inconclusive');
});
test('gridless images and invalid candidate transforms produce no symmetry claim',()=>{
    assert.equal(verify(raster({grid:false}),quarterTurn).status,'inconclusive');
    assert.equal(verify(raster(),{...quarterTurn,xAxis:p(2,0)}).status,'unsupported');
    assert.equal(verify(raster(),{sourceOrigin:p(0,0),targetOrigin:p(0,0),
        xAxis:p(1,0),yAxis:p(0,1)}).status,'unsupported');
    assert.equal(verify({width:640,height:640,pixels:new Uint8Array(2)},quarterTurn).status,'unsupported');
    assert.equal(verify(raster(),quarterTurn,{minimumInkSupport:0.2}).status,'unsupported');
    assert.equal(verify(raster(),quarterTurn,{minimumSupportedRegions:10}).status,'unsupported');
});

test('verified exact pixel metric isometries are independently checked on original raster',()=>{
    const exact=crossCheck(raster(),square);
    assert.equal(exact.status,'evaluated',exact.reason);
    assert.equal(exact.metricSymmetries,8);
    assert.equal(exact.checkedNontrivialSymmetries,7);
    assert.equal(exact.supportedNontrivialSymmetries,7);
    assert.equal(exact.evidence,'non-authoritative-original-raster-cross-check');
    const local=crossCheck(raster({local:true}),square);
    assert.equal(local.status,'evaluated');
    assert.equal(local.supportedNontrivialSymmetries,0,
        'A purely local-looking square patch must not manufacture an observed global symmetry');
    const rectangleResult=crossCheck(raster({yPitch:80}),rectangle);
    assert.equal(rectangleResult.status,'evaluated',rectangleResult.reason);
    assert.equal(rectangleResult.metricSymmetries,4);
    assert.equal(rectangleResult.checkedNontrivialSymmetries,3);
    assert.equal(rectangleResult.supportedNontrivialSymmetries,3);
    assert.equal(crossCheck(raster(),{...square,units:'mile'}).status,'unsupported');
});
