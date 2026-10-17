// Reproduce the exact acceptance rasters without expected geometry or counts.
// An optional output directory emits full v3 wire responses for client tests.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareRaster} from '../dist/src/image/preprocess.js';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import {mapExperimentalMotifToSource} from '../dist/src/resources/periodic-tiling/source-candidate.js';

const output=process.argv[2];
if(output)mkdirSync(output,{recursive:true});
for(const name of ['fallout-wanderer-5x5-blank','fallout-wanderer-5x5-populated',
    'fallout-warfare2-9x9-blank','fallout-warfare2-9x9-populated','qa-regular-hex-grid']){
    const prepared=await prepareRaster(readFileSync(new URL(`../test/fixtures/acceptance/${name}.png`,import.meta.url)),
        'image/png',16_000_000,2048);
    const start=performance.now(),observed=investigatePeriodicMotif(prepared.raster);
    console.log(JSON.stringify({name,status:observed.status,
        reason:observed.status==='consistent-candidate'?null:observed.reason,
        milliseconds:Math.round(performance.now()-start),
        projection:observed.status==='consistent-candidate'?observed.metricRegistration?.sourceProjection:null}));
    if(observed.status!=='consistent-candidate'){process.exitCode=1;continue;}
    if(output)writeFileSync(resolve(output,`${name}.json`),JSON.stringify({
        apiVersion:'v3',capability:'map.periodic-tiling.investigate',
        maturity:'experimental',authoritative:false,status:observed.status,
        reason:'Exact original acceptance raster on the D02 correction branch',
        ...mapExperimentalMotifToSource(observed,prepared.analysisScale),
        source:{width:prepared.sourceWidth,height:prepared.sourceHeight,mediaType:'image/png'},
        analysis:{width:prepared.raster.width,height:prepared.raster.height,
            scale:prepared.analysisScale,sourceResolutionVerified:prepared.analysisScale===1}
    },null,2)+'\n');
}
