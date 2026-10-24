/* Potential Plays - live NFL player prop progress (read-only, does NOT settle bets).
   Uses ESPN's publicly accessible unofficial scoreboard and game-summary feeds.
   Refreshes about every two minutes when Live Bets is visible.
   Never treats a failed/missing lookup as 0 or as a settled result. */
(function(){
'use strict';
const ROOT='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const REFRESH_MS=120000,FINAL_HOURS=48,MAX_EVENTS=18;
let tracked=[],snapshot=new Map(),lastFetch=0,loading=false,hadFetch=false,requestSeq=0,hadError=false;
let gameStatus='Waiting for an NFL game with available live stats.',lastChecked='';
let timer=null;
const byId=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/\s+/g,' ').trim();
const digits=s=>{if(typeof s==='number')return Number.isFinite(s)?s:null;const t=String(s??'').replace(/,/g,'').trim();return /^-?\d+(?:\.\d+)?$/.test(t)?Number(t):null;};
function parse(text){
 const t=String(text||'').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
 if(t.length<9||t.length>280)return null;
 const match=/\b(rushing|rush|receiving|rec|passing|pass)\s*(?:yards?|yds?)\b|\b(receptions?|catches)\b/i.exec(t);
 if(!match)return null;
 let metric;
 const k=(match[0]||'').toLowerCase();
 if(/reception|catch/.test(k))metric='receptions';
 else if(/^rush/.test(k))metric='rushingYards';
 else if(/^receiv|^rec\b/.test(k))metric='receivingYards';
 else if(/^pass/.test(k))metric='passingYards';
 else return null;
 const left=t.slice(0,match.index).trim(),right=t.slice(match.index+match[0].length).trim();
 if(/\b(?:under|less\s+than)\b/i.test(left+' '+right)&&!/\bover\b/i.test(left+' '+right))return null; // first release: over/at-least only
 let threshold=null;
 const explicit=left.match(/\b(?:over|more\s+than|at\s+least)\s*(\d+(?:\.\d+)?)/i);
 if(explicit)threshold=Number(explicit[1]);
 const plus=left.match(/(\d+(?:\.\d+)?)\s*\+\s*$/);
 if(threshold===null&&plus)threshold=Number(plus[1]);
 if(threshold===null){
  const before=left.match(/(\d+(?:\.\d+)?)\s*$/);
  if(before)threshold=Number(before[1]);
 }
 if(threshold===null){
  const after=right.match(/^\s*(?:over|at\s+least)?\s*(\d+(?:\.\d+)?)(?:\s*\+)?/i);
  if(after)threshold=Number(after[1]);
 }
 if(!Number.isFinite(threshold)||threshold<=0||threshold>1200)return null;
 let player=left
  .replace(/\b(?:over|more\s+than|at\s+least|to\s+(?:record|get|have)|for)\b\s*[\d.]+\s*\+?\s*$/i,'')
  .replace(/\b(?:over|more\s+than|at\s+least)\s*$/i,'')
  .replace(/[\d.]+\s*\+?\s*$/,'')
  .replace(/\b(?:to\s+(?:record|get|have)|for)\s*$/i,'')
  .replace(/^[\s#:"'\-]+|[\s#:"'\-]+$/g,'')
  .replace(/\b(?:player|prop)\s*[:\-]\s*/gi,'')
  .trim();
 // Match the full athlete name, never a surname-only guess.
 const words=norm(player).split(' ').filter(Boolean);
 if(words.length<2||words.length>5||!words.some(w=>w.length>2))return null;
 return{player,normalized:norm(player),metric,threshold,market:match[0],original:t};
}
function getTracked(bets){
 const all=[];
 for(const bet of Array.isArray(bets)?bets:[]){
  if(!['pending','proposed','reviewing','approved','placed'].includes(String(bet.status||'')))continue;
  for(const [i,leg] of (bet.legs||[]).entries()){
   const p=parse(leg.text||leg.label);
   if(!p)continue;
   all.push({...p,playId:String(bet.id),id:String(bet.id)+':'+i,legNo:i+1,owner:bet.owner||'',title:bet.title||'',isProposal:bet.kind==='proposal'});
  }
 }
 return all;
}
function shortMarket(m){return{rushingYards:'rushing yards',receivingYards:'receiving yards',passingYards:'passing yards',receptions:'receptions'}[m]||m;}
function percentage(current,target){return Math.max(0,Math.min(100,Math.round(current/target*100)))}
function statusLabel(row){
 if(row&&row.phase==='live')return{label:'LIVE · '+row.detail,cls:'live'};
 if(row&&row.phase==='final')return{label:'FINAL · Unofficial',cls:'final'};
 return{label:'Waiting for live stats',cls:'waiting'};
}
function barHtml(p){
 const row=snapshot.get(p.normalized+':'+p.metric);
 const status=statusLabel(row);
 const value=row&&typeof row.value==='number'?row.value:null;
 const current=value===null?'—':String(value);
 const pct=value===null?0:percentage(value,p.threshold);
 const hit=value!==null&&value>=p.threshold;
 const partial=value!==null&&pct>=75&&!hit;
 const color=hit?'#3fe49d':partial?'#e9c979':'#178fff';
 const note=hit?'Target reached in reported stats — not a settled bet.':row&&row.phase==='final'?'Final game stat reported; sportsbook result still must be verified.':value!==null?'Updates while the game is active.':hadError?'Could not read a matching live box score.':'No verified player stat matched yet.';
 return'<article class="pp-live-prop" data-pp-leg="'+esc(p.id)+'">'+
  '<div class="pp-prop-top"><div><b>'+esc(p.player)+'</b><div class="tiny">'+esc(shortMarket(p.metric))+' · Goal '+esc(p.threshold)+(p.threshold%1?'':'')+'</div></div><span class="pp-prop-state '+status.cls+'">'+esc(status.label)+'</span></div>'+
  '<div class="pp-prop-numbers"><strong>'+esc(current)+' <span>/ '+esc(p.threshold)+'</span></strong><span>'+ (value===null?'—':pct+'%')+'</span></div>'+
  '<div class="pp-prop-track" role="progressbar" aria-label="'+esc(p.player+' '+shortMarket(p.metric))+'" aria-valuemin="0" aria-valuemax="'+esc(p.threshold)+'"'+(value!==null?' aria-valuenow="'+esc(Math.max(0,value))+'"':'')+'><span style="width:'+pct+'%;background:'+color+'"></span></div>'+
  '<div class="tiny pp-prop-note">'+esc(note)+'</div></article>';
}
function paint(){
 const panel=byId('pp-prop-center'),body=byId('pp-prop-center-list');
 if(panel&&body){
  panel.hidden=false;
  if(!tracked.length){
   body.innerHTML='<div class="tiny" style="padding:12px 0">Save an NFL prop such as “Derrick Henry 50+ rushing yards” to see its live progress here when a game is underway.</div>';
  }else{
   body.innerHTML=tracked.map(barHtml).join('');
  }
  const status=byId('pp-prop-status');
  if(status)status.textContent=tracked.length?(loading?'Checking NFL player stats…':gameStatus+(lastChecked?' · '+lastChecked:'')):'No supported NFL player props saved yet.';
 }
 for(const holder of document.querySelectorAll('.pp-live-props-placeholder')){
  const playId=holder.getAttribute('data-pp-play');
  const parts=tracked.filter(t=>t.playId===playId);
  if(!parts.length){holder.innerHTML='';holder.hidden=true;continue}
  holder.hidden=false;
  holder.innerHTML='<div class="tiny" style="margin:12px 0 6px;color:#e9c879">⚡ LIVE PROP TRACKER</div>'+parts.map(barHtml).join('');
 }
}
function statusOf(event){
 const competition=event?.competitions?.[0]||{};
 const type=competition.status?.type||event.status?.type||{};
 const state=String(type.state||'').toLowerCase();
 const final=Boolean(type.completed||state==='post'||String(type.name||'').includes('FINAL'));
 const live=Boolean(state==='in'||String(type.name||'').includes('IN_PROGRESS'));
 const detail=String(type.shortDetail||type.description||competition.status?.displayClock||'Game in progress').slice(0,55);
 return{live,final,detail};
}
function groupMetric(group){
 const name=String(group.name||group.displayName||group.label||'').toLowerCase().replace(/\s+/g,'');
 if(name.includes('rushing'))return'rushingYards';
 if(name.includes('receiving'))return'receivingYards';
 if(name.includes('passing'))return'passingYards';
 return null;
}
function getStat(group,metric,athlete){
 const labels=(group.labels||group.keys||[]).map(x=>String(x).toUpperCase().trim().replace(/\s+/g,''));
 let index;
 if(metric==='receptions')index=labels.findIndex(x=>x==='REC'||x==='RECEPTIONS');
 else index=labels.findIndex(x=>x==='YDS'||x==='YARDS');
 // Stable ESPN NFL boxscore columns when labels are absent.
 if(index<0&&labels.length===0){
  if(metric==='receptions')index=0;
  else index=1;
 }
 if(index<0)return null;
 return digits(athlete.stats?.[index]);
}
function extractGames(event,summary){
 const box=summary?.boxscore?.players;
 if(!Array.isArray(box))return [];
 const phase=statusOf(event);
 const athletes=new Map();
 for(const team of box){
  for(const group of team.statistics||[]){
   const gm=groupMetric(group);
   if(!gm)continue;
   for(const athlete of group.athletes||[]){
    const name=athlete.athlete?.fullName||athlete.athlete?.displayName;
    if(!name)continue;
    const normalized=norm(name),rec=athletes.get(normalized)||{name,normalized,metricValues:{}};
    const stat=getStat(group,gm,athlete);
    if(stat!==null){
     rec.metricValues[gm]=stat;
     if(gm==='receivingYards'){
      const receptions=getStat(group,'receptions',athlete);
      if(receptions!==null)rec.metricValues.receptions=receptions;
     }
    }
    athletes.set(normalized,rec);
   }
  }
 }
 return [...athletes.values()].map(p=>({...p,phase:phase.live?'live':phase.final?'final':'other',detail:phase.detail,eventId:String(event.id)}));
}
async function fetchJson(url){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),11500);
 try{
  const res=await fetch(url,{signal:controller.signal,cache:'no-store'});
  if(!res.ok)throw new Error('Sports feed HTTP '+res.status);
  return await res.json();
 }finally{clearTimeout(timeout)}
}
async function check(force=false){
 if(loading||!tracked.length||document.hidden)return;
 if(!force&&Date.now()-lastFetch<REFRESH_MS){paint();return}
 // Avoid data usage while the app is open on another tab.
 const tab=byId('bets');
 if(!force&&(!tab||!tab.classList.contains('active')))return;
 loading=true;paint();const my=++requestSeq;
 try{
  const board=await fetchJson(ROOT+'scoreboard?limit=60');
  if(!Array.isArray(board.events))throw new Error('Missing NFL scoreboard');
  const now=Date.now();
  const relevant=board.events.filter(e=>{
   const status=statusOf(e);
   const when=Date.parse(e.date||'');
   return status.live||(status.final&&Number.isFinite(when)&&now-when<FINAL_HOURS*3600000&&now>=when);
  }).slice(0,MAX_EVENTS);
  if(my!==requestSeq)return;
  if(!relevant.length){
    hadError=false;gameStatus='No active or recently finished NFL games in the current scoreboard.';
    snapshot.clear();lastFetch=Date.now();hadFetch=true;lastChecked='checked '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    return;
  }
  const results=[];
  // Avoid sending parallel requests for all NFL matches at once.
  for(let i=0;i<relevant.length;i+=4){
    const group=relevant.slice(i,i+4);
    const out=await Promise.allSettled(group.map(async e=>({event:e,data:await fetchJson(ROOT+'summary?event='+encodeURIComponent(String(e.id)))})));
    for(const r of out)if(r.status==='fulfilled')results.push(...extractGames(r.value.event,r.value.data));
    if(my!==requestSeq)return;
  }
  let count=0,matched=0;
  const next=new Map();
  for(const p of tracked){
   const candidates=results.filter(x=>x.normalized===p.normalized&&Object.hasOwn(x.metricValues,p.metric));
   const ids=[...new Set(candidates.map(x=>x.eventId))];
   if(ids.length===1){
    const winner=candidates[0],key=p.normalized+':'+p.metric;
    next.set(key,{value:winner.metricValues[p.metric],phase:winner.phase,detail:winner.detail,eventId:winner.eventId});
    matched++;count++;
   }
  }
  snapshot=next;hadError=false;hadFetch=true;lastFetch=Date.now();
  lastChecked='checked '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  gameStatus=matched?('Tracking '+matched+' of '+tracked.length+' NFL props'):('No matching player box scores found for '+tracked.length+' saved props');
 }catch(e){
  hadError=true;gameStatus='Player stats temporarily unavailable; use Refresh to retry.';
  console.warn('Potential Plays NFL live props:',String(e));
 }finally{
  loading=false;
  paint();
 }
}
function render(bets){
 const next=getTracked(bets);
 const prev=tracked.map(x=>x.id+'|'+x.original).join('~'),curr=next.map(x=>x.id+'|'+x.original).join('~');
 tracked=next;
 if(curr!==prev){snapshot.clear();lastFetch=0;hadFetch=false;gameStatus='Waiting for a matching NFL live game.'}
 paint();
 if(byId('bets')?.classList.contains('active'))check();
}
function activate(){paint();check()}
function refresh(){lastFetch=0;check(true)}
window.PPLiveProps={render,activate,refresh,parse,extractGames};
byId('pp-prop-refresh')?.addEventListener('click',refresh);
timer=setInterval(()=>{if(byId('bets')?.classList.contains('active')&&!document.hidden)check()},REFRESH_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&byId('bets')?.classList.contains('active'))check()});
// Rehydrate player bars if login completed before this deferred script loaded.
if(byId('appwrap')&&!byId('appwrap').hidden&&typeof window.render==='function')window.render();
})();