import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {verifyProjectedPolygonsInOriginalRaster as project}
  from '../dist/src/analysis/periodic-tiling/original-polygon-projection.js';

const pt=(x,y)=>({x,y});
const cover=deriveTranslationMotif({units:'pixel',
    basis:[pt(40,0),pt(0,40)],
    cells:[{id:'square',polygon:[pt(29,37),pt(69,37),pt(69,77),pt(29,77)]}]});

function source({eraseRight=false,eraseCorner=false,blackCenters=false}={}){
 const width=640,height=640,pixels=new Uint8Array(width*height).fill(255);
 const near=(v,phase)=>Math.abs(((v-phase+16000)%40))<=1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   if(eraseRight&&x>320)continue;
   if(eraseCorner&&x>415&&y>415)continue;
   const paintCenter=blackCenters
     &&Math.abs(((x-49+16000)%40))<6
     &&Math.abs(((y-57+16000)%40))<6
     &&Math.floor((x-29)/40)%2===0;
   if(near(x,29)||near(y,37)||paintCenter)pixels[y*width+x]=0;
 }
 return {width,height,pixels};
}

test('unmodified periodic source raster supports independently projected strokes and negative space',()=>{
 const result=project(source(),cover);
 assert.equal(result.status,'supported',result.reason);
 assert.equal(result.evidence,'unchanged-source-polygon-projection');
 assert.equal(result.checkedRegions,9);
 assert.equal(result.supportedRegions,9);
 assert.ok(result.checkedEdgeSamples>1000);
 assert.ok(result.checkedInteriorSamples>150);
 assert.ok(result.edgeSupport>.98);
 assert.ok(result.interiorSupport>.98);
});
test('independent image projection rejects a motif confined to one half of a crop',()=>{
 const result=project(source({eraseRight:true}),cover);
 assert.equal(result.status,'inconclusive');
 assert.match(result.reason,/distant-region|contradict/);
});
test('local occlusion need not invalidate all distant original-image evidence',()=>{
 const result=project(source({eraseCorner:true}),cover);
 assert.equal(result.status,'supported',result.reason);
 assert.ok(result.supportedRegions>=7);
 assert.ok(result.supportedRegions<9);
});
test('painted-in polygon interiors contradict negative-space evidence even if all edges remain',()=>{
 const result=project(source({blackCenters:true}),cover);
 assert.equal(result.status,'inconclusive');
 assert.match(result.reason,/negative space|contradict/);
});
test('malformed projected geometry and unsafe resource options fail without an identity',()=>{
 assert.equal(project(source(),{...cover,units:'world'}).status,'unsupported');
 assert.equal(project(source(),cover,{minEdgeSupport:.01}).status,'unsupported');
 assert.equal(project(source(),cover,{minSupportedRegions:10}).status,'unsupported');
 assert.equal(project({width:640,height:640,pixels:new Uint8Array(20)},cover).status,'unsupported');
});
