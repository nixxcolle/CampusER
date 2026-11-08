const fs=require('fs'),path=require('path'),crypto=require('crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
let html=fs.readFileSync('index.html','utf8').replace(/<meta name="campus-er-release" content="[^"]+">\r?\n?/g,'').replace(/((?:src|href)="[^"?:#]+)\?v=[a-f0-9]+/g,'$1');
const files=new Set(['index.html','manifest.json']);
const add=(file)=>{file=file.replaceAll('\\','/');if(file.startsWith('../')||path.isAbsolute(file)||!fs.existsSync(file))throw Error('Invalid/missing runtime asset: '+file);if(!files.has(file)){files.add(file);pending.push(file);}};
const pending=[];
for(const m of html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g))if(!/^(https?:|data:|#)/.test(m[1]))add(m[1]);
while(pending.length){const file=pending.shift();if(!/\.(css|js|mjs|json)$/.test(file))continue;const source=fs.readFileSync(file,'utf8');const refs=file.endsWith('.css')?[...source.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)]:/\.(js|mjs)$/.test(file)?[...source.matchAll(/\b(?:from\s*|import\s*)["']([^"']+)["']/g)]:[];for(const m of refs){const spec=m[1];if(/^(https?:|data:|#)/.test(spec)||(!file.endsWith('.css')&&!spec.startsWith('./')&&!spec.startsWith('../')))continue;add(path.posix.normalize(path.posix.join(path.posix.dirname(file),spec.split('?')[0])));}}
add('images/SSULOGO.png');add('images/SSU.png');
const names=[...files].sort();
const hash=crypto.createHash('sha256').update(html).update(fs.readFileSync('sw.template.js'));for(const file of names)if(file!=='index.html')hash.update(file).update(fs.readFileSync(file));
const release=hash.digest('hex').slice(0,16);
html=html.replace(/((?:src|href)=")([^"?#]+)(")/g,(all,start,file,end)=>/^(https?:|data:|#)/.test(file)?all:start+file+'?v='+release+end);
html=html.replace('<head>','<head>\n<meta name="campus-er-release" content="'+release+'">');
fs.writeFileSync('index.html',html);
const worker=fs.readFileSync('sw.template.js','utf8').replace('__RELEASE__',release).replace('__FILES__',JSON.stringify(names,null,2));fs.writeFileSync('sw.js',worker);
const records=[...names,'sw.js'].map(file=>({file,sha256:digest(fs.readFileSync(file))}));
fs.writeFileSync('release-manifest.json',JSON.stringify({release,files:records},null,2)+'\n');
console.log(JSON.stringify({release,runtimeAssets:names.length},null,2));
