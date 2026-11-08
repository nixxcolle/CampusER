const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('playwright');
const manifest=require('./release-manifest.json');
const networkOnly=['campus-er-config.js','api/probe','auth/probe'];
const legacyCaches=['campus-er-v1','campus-er-assets-old','campus-er-static-old'];
const assets=manifest.files.map(({file})=>file).filter(file=>file!=='sw.js');
assert(!assets.includes('campus-er-config.js'));
for(const {file,sha256} of manifest.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256,file);
let online=true;
const server=http.createServer((req,res)=>{if(!online){res.destroy();return;}const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/CampusER\//,'/');if(networkOnly.includes(pathname.slice(1)))res.setHeader('Cache-Control','no-store');if(pathname==='/api/probe'||pathname==='/auth/probe'){res.setHeader('Content-Type','text/plain');res.end('network probe');return;}const file=path.join(__dirname,pathname.replace(/\/$/,'/index.html'));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json'})[ext]||'text/html');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const prefix of ['/','/CampusER/']){
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://*.supabase.co/**',r=>r.abort());
 await page.goto(origin+prefix+'api/probe');
 await page.evaluate(async names=>{await Promise.all(names.map(name=>caches.open(name)));},legacyCaches);
 await page.goto(origin+prefix);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('meta[name="campus-er-release"]').getAttribute('content'),manifest.release);
 const configSrc=await page.locator('script[src*="campus-er-config.js"]').getAttribute('src');
 assert.equal(new URL(configSrc,origin+prefix).href,origin+prefix+'campus-er-config.js');
 await page.waitForFunction(()=>document.querySelectorAll('svg.lucide').length>0);
 assert(await page.evaluate(()=>document.fonts.check('400 14px Inter')));
 const cacheName='campus-er-assets-'+manifest.release;
 assert.deepEqual(await page.evaluate(()=>caches.keys()),[cacheName]);
 const cachePaths=await page.evaluate(async name=>{
  const cache=await caches.open(name);
  return (await cache.keys()).map(request=>new URL(request.url).pathname).sort();
 },cacheName);
 assert.deepEqual(cachePaths,assets.map(file=>prefix+file).sort());
 for(const file of networkOnly){
  const url=origin+prefix+file;
  const pending=page.waitForResponse(response=>response.url()===url);
  await page.evaluate(url=>fetch(url).then(response=>response.text()),url);
  const response=await pending;
  assert.equal(response.status(),200,file);
  assert.equal(response.fromServiceWorker(),false,file);
 }
 for(const viewport of [{width:1440,height:1000},{width:1024,height:600},{width:390,height:844}]){await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 online=false;await page.reload({waitUntil:'load'});assert.equal(await page.locator('meta[name="campus-er-release"]').getAttribute('content'),manifest.release);await page.waitForFunction(()=>document.querySelectorAll('svg.lucide').length>0);online=true;
 for(const file of networkOnly){
  const response=await page.goto(origin+prefix+file);
  assert.equal(response.status(),200,file);
  assert.equal(response.fromServiceWorker(),false,file);
 }
 const cachedRequests=await page.evaluate(async()=>{
  const requests=await Promise.all((await caches.keys()).map(async name=>(await caches.open(name)).keys()));
  return requests.flat().map(request=>new URL(request.url).pathname);
 });
 for(const file of networkOnly)assert(!cachedRequests.includes(prefix+file),file);
 assert.deepEqual(errors,[]);await context.close();
}
console.log(JSON.stringify({release:manifest.release,assetHashes:manifest.files.length,checks:['root and GitHub Pages subpath','service worker installation and legacy cache cleanup','offline styles, fonts, images and icons','source configuration, API and auth requests excluded','desktop, Pi and mobile widths','no browser errors']}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
