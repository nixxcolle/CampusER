import React from 'https://esm.sh/react@18.3.1';
import {createRoot} from 'https://esm.sh/react-dom@18.3.1/client?external=react';
import * as icons from 'https://esm.sh/lucide-react@0.468.0?external=react';

// Small React roots keep the existing vanilla-JavaScript application intact.
const roots=new Map();
const extraSymbols={'🏠':'LayoutDashboard','📄':'FileText'};
const symbols={'🏥':'HeartPulse','🛡️':'Shield','🛡':'Shield','🚨':'Siren','🏛️':'Landmark','🏛':'Landmark','📊':'ChartColumn','📋':'ClipboardList','🗺️':'Map','🗺':'Map','⚙️':'Settings','⚙':'Settings','👮':'UserRound','🔊':'Volume2','🔇':'VolumeX','📍':'MapPin','✔':'Check','✓':'Check','⚡':'Zap','✏':'Pencil','🏢':'Building2','⏱️':'Timer','⏱':'Timer','🎙️':'Mic','🎙':'Mic','🌐':'Globe','🧠':'Brain','🔑':'KeyRound','🚧':'Construction','🚑':'Ambulance','🔄':'RefreshCw','▶':'Play','⏹':'Square','☰':'Menu','✕':'X','⏳':'Clock','🔥':'Flame','📡':'Radio','📈':'TrendingUp','📅':'Calendar','🕐':'Clock','✅':'CircleCheck','❌':'CircleX','⚠️':'TriangleAlert','⚠':'TriangleAlert','🗑':'Trash2','🗑️':'Trash2','🚪':'DoorOpen','👤':'UserRound','📞':'Phone','🎯':'Crosshair','📌':'MapPin','🟢':'Circle','🔴':'Circle','🔵':'Circle','🟡':'Circle','🟠':'Circle','🟣':'Circle','💬':'MessageSquare','🎧':'Headphones','📢':'Megaphone','🔒':'Lock','🔐':'LockKeyhole','📝':'FilePenLine','💾':'Save','📥':'Download','📤':'Upload','🔍':'Search','🕒':'Clock','🏫':'School','📁':'Folder','🖨️':'Printer','🖨':'Printer'};
Object.assign(symbols,extraSymbols);
const pattern=new RegExp(Object.keys(symbols).sort((a,b)=>b.length-a.length).join('|')+'|[\\p{Extended_Pictographic}\\uFE0F\\u200D]+','gu');
function refreshIcons(){
  document.querySelectorAll('option').forEach(el=>{pattern.lastIndex=0;const clean=el.textContent.replace(pattern,'').trim();if(clean!==el.textContent)el.textContent=clean;});
  for(const [el,root] of roots){if(!el.isConnected){root.unmount();roots.delete(el);}}
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>{pattern.lastIndex=0;return n.parentElement&&!n.parentElement.closest('script,style,svg,textarea,option,[data-lucide-react]')&&pattern.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
  const texts=[];while(walker.nextNode()){texts.push(walker.currentNode);pattern.lastIndex=0;}
  for(const n of texts){pattern.lastIndex=0;const fragment=document.createDocumentFragment();let pos=0;for(const m of n.nodeValue.matchAll(pattern)){fragment.append(document.createTextNode(n.nodeValue.slice(pos,m.index)));const span=document.createElement('span');span.className='eoc-icon';span.dataset.lucideReact=symbols[m[0]]||'Circle';span.setAttribute('aria-hidden','true');fragment.append(span);pos=m.index+m[0].length;}fragment.append(document.createTextNode(n.nodeValue.slice(pos)));n.replaceWith(fragment);}
  document.querySelectorAll('[data-lucide-react]').forEach(el=>{if(!roots.has(el)){const Icon=icons[el.dataset.lucideReact]||icons.Circle;const root=createRoot(el);roots.set(el,root);root.render(React.createElement(Icon,{size:19,strokeWidth:1.65,'aria-hidden':true}));}});
}
let queued=false;
new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;refreshIcons();});}}).observe(document.body,{childList:true,subtree:true});
refreshIcons();
