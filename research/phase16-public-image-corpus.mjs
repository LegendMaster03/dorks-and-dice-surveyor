/**
 * Independent, externally authored artwork benchmark for the experimental
 * Surveyor Phase 16 path. It NEVER writes map data or returns a detected
 * geometry identity. Manual execution only: npm run build && node
 * research/phase16-public-image-corpus.mjs --run
 *
 * This intentionally downloads originals at probe time rather than vendoring
 * CC-BY-SA photographs or depending on live network during ordinary CI.
 * The public Commons file SHA-1 values are pinned to independently verify
 * the image bytes. Outputs are research observations, not calibrated truth.
 */
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import sharp from 'sharp';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';

export const PUBLIC_IMAGE_CASES=Object.freeze([
  {
    id:'commons-hexagon-triangle-artwork',
    file:'A_periodic_tiling_by_regular_hexagons_and_equilateral_triangles.svg',
    sha1:'5a03bd6bf603642d524cea6d26d7f96e9a5946bd',
    source:'https://commons.wikimedia.org/wiki/File:A_periodic_tiling_by_regular_hexagons_and_equilateral_triangles.svg',
    originalUrl:'https://upload.wikimedia.org/wikipedia/commons/6/66/A_periodic_tiling_by_regular_hexagons_and_equilateral_triangles.svg',
    author:'Arthur Baelde',
    license:'CC BY-SA 3.0',
    morphology:'hexagons and triangles, non-edge-to-edge',
    medium:'externally-authored-vector'
  },
  {
    id:'commons-rome-hexagonal-floor',
    file:'Hexagonal_tessellation.JPG',
    sha1:'68f08e84b5ce0ad0adda1ff07a3519f7d10bc952',
    source:'https://commons.wikimedia.org/wiki/File:Hexagonal_tessellation.JPG',
    originalUrl:'https://upload.wikimedia.org/wikipedia/commons/e/ef/Hexagonal_tessellation.JPG',
    author:'David Shay',
    license:'CC BY-SA 3.0',
    morphology:'hexagonal floor tiles under photographic perspective',
    medium:'photograph'
  },
  {
    id:'commons-square-tiles-2026',
    file:'Square_Tiles.jpg',
    sha1:'8fc47cec443788ca38544562dd051fd044f2008f',
    source:'https://commons.wikimedia.org/wiki/File:Square_Tiles.jpg',
    originalUrl:'https://upload.wikimedia.org/wikipedia/commons/7/73/Square_Tiles.jpg',
    author:'121 Unbiunium',
    license:'CC BY-SA 4.0',
    morphology:'square tiles photographed on site',
    medium:'photograph'
  }
]);

const MAX_DOWNLOAD=5_500_000;
const MAX_DECODED_PIXELS=25_000_000;
const MAX_ANALYSIS_DIMENSION=640;

/** Reject modified or unrecognized bytes; do not silently change a holdout. */
export function verifyPinnedFixtureBytes(data,expectedSha1){
  if(!Buffer.isBuffer(data)||data.byteLength===0||data.byteLength>MAX_DOWNLOAD
    ||!/^[0-9a-f]{40}$/.test(expectedSha1))
    return false;
  return createHash('sha1').update(data).digest('hex')===expectedSha1;
}

export function validateManifest(cases=PUBLIC_IMAGE_CASES){
  const ids=new Set(),sha1s=new Set();
  for(const c of cases){
    if(typeof c.id!=='string'||!/^[a-z0-9-]+$/.test(c.id)||ids.has(c.id)
       ||!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:[A-Za-z0-9_().-]+$/.test(c.source)
       ||typeof c.originalUrl!=='string'
       ||!/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/([0-9a-f]{2})\/[A-Za-z0-9_().-]+$/.test(c.originalUrl)
       ||!c.originalUrl.endsWith('/'+c.file)
       ||!/^CC BY-SA (3\.0|4\.0)$/.test(c.license)
       ||typeof c.author!=='string'||!c.author.trim()
       ||typeof c.morphology!=='string'||!c.morphology.trim()
       ||!['photograph','externally-authored-vector'].includes(c.medium)
       ||!/^[0-9a-f]{40}$/.test(c.sha1)||sha1s.has(c.sha1)
       ||typeof c.file!=='string'||!/^[A-Za-z0-9_().-]+$/.test(c.file))
      return false;
    ids.add(c.id);sha1s.add(c.sha1);
  }
  return cases.length>=3;
}

async function fetchBounded(url){
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),30_000);
  try{
    const response=await fetch(url,{signal:ctrl.signal,redirect:'follow',
      headers:{'user-agent':'DorksAndDice-SurveyorResearch/1.0 (public Wikimedia corpus)'}});
    if(!response.ok)throw new Error('External image fetch failed: HTTP '+response.status);
    const contentLength=Number(response.headers.get('content-length'));
    if(Number.isFinite(contentLength)&&contentLength>MAX_DOWNLOAD)
      throw new Error('External image exceeds bounded download allowance');
    const buffers=[];let total=0;
    for await(const chunk of response.body){
      total+=chunk.byteLength;
      if(total>MAX_DOWNLOAD)throw new Error('External image exceeds bounded download allowance');
      buffers.push(Buffer.from(chunk));
    }
    return Buffer.concat(buffers,total);
  }finally{clearTimeout(timeout);}
}

export async function probeIndependentPublicCase(c){
  // Pin immutable authored artwork bytes even when the redirect URL resolves
  // to a newer Commons revision. Changed checksums are explicit blockers.
  // Direct immutable-format original file URI from Commons' "Original file"
  // link. The expected SHA-1 is always rechecked on the downloaded bytes.
  const encoded=await fetchBounded(c.originalUrl);
  if(!verifyPinnedFixtureBytes(encoded,c.sha1))
    throw new Error(c.id+': downloaded bytes do not match pinned Commons SHA-1');
  const prepared=await sharp(encoded,{limitInputPixels:MAX_DECODED_PIXELS})
    .flatten({background:'#ffffff'})
    .resize({width:MAX_ANALYSIS_DIMENSION,height:MAX_ANALYSIS_DIMENSION,fit:'inside',
      withoutEnlargement:true})
    .greyscale().raw().toBuffer({resolveWithObject:true});
  const {width,height,channels}=prepared.info;
  if(channels!==1||width*height!==prepared.data.length||width*height>640*640)
    throw new Error(c.id+': invalid bounded grayscale raster');
  const start=performance.now();
  const observed=investigatePeriodicMotif({width,height,pixels:prepared.data});
  const elapsed=Math.round(performance.now()-start);
  const good=observed.status==='consistent-candidate';
  const metric=good?observed.metricRegistration:null;
  // Never treat a mathematical isometry alone as proof of one seen in pixels.
  if(metric && (metric.rasterSymmetriesSupported>metric.rasterSymmetriesChecked
    || metric.rasterSymmetriesChecked>(metric.mathematicalMetricSymmetries??0)))
    throw new Error(c.id+': impossible original-raster symmetry evidence counts');
  return {
    id:c.id,source:c.source,sha1:c.sha1,medium:c.medium,morphology:c.morphology,
    raster:{width,height},status:observed.status,elapsedMs:elapsed,
    candidateSymbol:good?observed.candidateDsSymbol:null,
    polygonSides:good?observed.motifCells.map(x=>x.polygonAnalysisPixels.length):null,
    verifiedMetricStatus:metric?.status??null,
    metricReason:metric?.reason??null,
    verifiedPixelSymmetries:metric?.rasterSymmetriesSupported??0,
    testedPixelSymmetries:metric?.rasterSymmetriesChecked??0,
    // This is NOT a confidence measurement or a test of the final Phase 16 gate.
    acceptance:'research-only-not-calibrated'
  };
}

async function main(){
  if(!validateManifest())throw new Error('Invalid independently sourced corpus manifest');
  if(process.argv.length===2||process.argv.includes('--list')){
    for(const c of PUBLIC_IMAGE_CASES)
      process.stdout.write(JSON.stringify(c)+'\n');
    return;
  }
  if(!process.argv.includes('--run')||process.argv.some(x=>x!=='--run'&&x!==process.argv[0]&&x!==process.argv[1]))
    throw new Error('Usage: node research/phase16-public-image-corpus.mjs [--list|--run]');
  const failures=[];
  for(const c of PUBLIC_IMAGE_CASES){
    try{
      const outcome=await probeIndependentPublicCase(c);
      process.stdout.write('PHASE16_PUBLIC_HOLDOUT '+JSON.stringify(outcome)+'\n');
    }catch(e){
      failures.push({id:c.id,message:e instanceof Error?e.message:String(e)});
      process.stderr.write('PHASE16_PUBLIC_HOLDOUT_ERROR '+JSON.stringify(failures.at(-1))+'\n');
    }
  }
  if(failures.length)process.exitCode=1; // never report a partial corpus as green
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
