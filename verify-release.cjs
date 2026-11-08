const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),crypto=require('crypto');
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const manifest=require('./release-manifest.json');
for(const {file,sha256} of manifest.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256,file);
let online=true;
const server=http.createServer((req,res)=>{if(!online){res.destroy();return;}const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/probe')){res.end('uncached API');return;}const file=path.join(__dirname,pathname.replace(/^\/CampusER\//,'/').replace(/\/$/,'/index.html'));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json'})[ext]||'text/html');res.end(data);});});
(async()=>{await new Promise(r=>server.listen(4182,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const prefix of ['/','/CampusER/']){
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://*.supabase.co/**',r=>r.abort());
 await page.goto('http://127.0.0.1:4182'+prefix);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('meta[name="campus-er-release"]').getAttribute('content'),manifest.release);
 await page.waitForFunction(()=>document.querySelectorAll('svg.lucide').length>0);
 assert(await page.evaluate(()=>document.fonts.check('400 14px Inter')));
 const cache=await page.evaluate(async()=>{const c=await caches.open((await caches.keys()).find(k=>k.startsWith('campus-er-assets-')));return(await c.keys()).map(r=>new URL(r.url).pathname);});assert.equal(cache.length,40);assert(cache.every(p=>p.startsWith(prefix)));
 await page.evaluate(()=>fetch('./probe'));assert.equal(await page.evaluate(async()=>{for(const n of await caches.keys()){if((await(await caches.open(n)).keys()).some(r=>r.url.endsWith('/probe')))return true;}return false;}),false);
 for(const viewport of [{width:1440,height:1000},{width:1024,height:600},{width:390,height:844}]){await page.setViewportSize(viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 online=false;await page.reload({waitUntil:'load'});assert.equal(await page.locator('meta[name="campus-er-release"]').getAttribute('content'),manifest.release);await page.waitForFunction(()=>document.querySelectorAll('svg.lucide').length>0);online=true;
 assert.deepEqual(errors,[]);await context.close();
}
console.log(JSON.stringify({release:manifest.release,assetHashes:manifest.files.length,checks:['root and GitHub Pages subpath','service worker installation','offline styles, fonts, images and icons','API requests excluded','desktop, Pi and mobile widths','no browser errors']}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
