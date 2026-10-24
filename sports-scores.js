/* Potential Plays Sports Score Center — display only.
   Does NOT settle bets, modify bankrolls, or grade props. ESPN unofficial score feed. */
(()=>{'use strict';
const root=document.getElementById('sports-score-center');
if(!root)return;
const LEAGUES={
 nfl:{sport:'football',code:'nfl',label:'NFL'},
 nba:{sport:'basketball',code:'nba',label:'NBA'},
 mlb:{sport:'baseball',code:'mlb',label:'MLB'},
 nhl:{sport:'hockey',code:'nhl',label:'NHL'},
 ncaaf:{sport:'football',code:'college-football',label:'College Football'},
 ncaab:{sport:'basketball',code:'mens-college-basketball',label:'College Basketball'}
};
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let league='nfl',date=localDate(),lastKey='',latest=0,busy=false,seq=0;
function localDate(){
 const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
 return y+'-'+m+'-'+day;
}
function setMessage(text,warning=false){const el=document.getElementById('sports-scores-status');if(el){el.textContent=text;el.style.color=warning?'#ffb4b6':'#a3c4e6'}}
function statusFor(event,contest){
 const t=contest?.status?.type||event?.status?.type||{};
 if(t.completed||t.name==='STATUS_FINAL')return{label:'FINAL',kind:'final'};
 if(t.state==='in'||t.name==='STATUS_IN_PROGRESS'||String(t.description||'').toLowerCase().includes('halftime'))return{label:String(t.shortDetail||t.description||'LIVE'),kind:'live'};
 return{label:String(t.shortDetail||t.description||'UPCOMING'),kind:'upcoming'};
}
function gameHtml(event){
 const contest=(event.competitions||[])[0]||{};
 const teams=(contest.competitors||[]).map(c=>({
  name:c.team?.shortDisplayName||c.team?.displayName||c.team?.name||'Team',
  score:c.score==null?'–':String(c.score),
  home:c.homeAway==='home',
  winner:c.winner===true
 }));
 const state=statusFor(event,contest);
 const className=state.kind==='live'?'live':state.kind==='final'?'final':'upcoming';
 const kickoff=event.date?new Date(event.date).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
 const scoreKnown=state.kind==='live'||state.kind==='final';
 const display=teams.map(t=>'<div class="sports-score-row"><span'+(t.winner?' class="sports-winner"':'')+'>'+escape(t.name)+'</span><b>'+escape(scoreKnown?t.score:'–')+'</b></div>').join('');
 const eventURL=(event.links||[]).map(x=>x.href).find(x=>{try{const u=new URL(x);return u.protocol==='https:'&&(u.hostname==='www.espn.com'||u.hostname==='espn.com')}catch{return false}});
 return '<article class="sports-game"><div class="sports-game-top"><span class="sports-state '+className+'">'+escape(state.label)+'</span><span>'+escape(kickoff)+'</span></div><div class="sports-teams">'+display+'</div>'+(eventURL?'<a class="sports-detail-link" href="'+escape(eventURL)+'" target="_blank" rel="noopener noreferrer">Game details ↗</a>':'')+'</article>';
}
function render(events){
 const area=document.getElementById('sports-scores-list');if(!area)return;
 if(!events.length){area.innerHTML='<p class="muted" style="padding:18px 0">No games listed for this league and date.</p>';return}
 area.innerHTML=events.map(gameHtml).join('');
}
async function update(force=false){
 if(busy){return}
 const key=league+':'+date,now=Date.now();
 if(!force&&key===lastKey&&now-latest<60000)return;
 const details=LEAGUES[league];if(!details)return;
 busy=true;const my=++seq;
 const btn=document.getElementById('sports-scores-refresh');if(btn)btn.disabled=true;
 setMessage('Checking scores…');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const reqDate=date.replace(/-/g,'');
  const url='https://site.api.espn.com/apis/site/v2/sports/'+details.sport+'/'+details.code+'/scoreboard?dates='+reqDate+'&limit=300';
  const res=await fetch(url,{signal:controller.signal,cache:'no-store'});
  if(!res.ok)throw Error('Score feed returned HTTP '+res.status);
  const data=await res.json();
  if(my!==seq)return;
  if(!Array.isArray(data.events))throw Error('Unexpected score feed response');
  const filtered=data.events.filter(e=>e?.competitions?.[0]?.competitors?.length>=2);
  render(filtered);lastKey=key;latest=Date.now();
  setMessage(details.label+' · '+filtered.length+' games · checked '+new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+' · Source: ESPN (unofficial feed)');
 }catch(e){
  if(my!==seq)return;
  setMessage('Live scores temporarily unavailable. Tap Refresh to retry. No bet records were changed.',true);
  document.getElementById('sports-scores-list').innerHTML='<p class="muted">Unable to load sports scores right now.</p>';
 }finally{clearTimeout(timer);busy=false;if(btn)btn.disabled=false}
}
const select=document.getElementById('sports-scores-league');
const input=document.getElementById('sports-scores-date');
if(select){select.value=league;select.addEventListener('change',()=>{league=select.value;update(true)})}
if(input){input.value=date;input.addEventListener('change',()=>{if(/^\d{4}-\d{2}-\d{2}$/.test(input.value)){date=input.value;update(true)}})}
document.getElementById('sports-scores-refresh')?.addEventListener('click',()=>update(true));
const resultTab=document.getElementById('results');
if(resultTab){
 new MutationObserver(()=>{if(resultTab.classList.contains('active'))update()}).observe(resultTab,{attributes:true,attributeFilter:['class']});
 if(resultTab.classList.contains('active'))update();
}
setInterval(()=>{if(resultTab?.classList.contains('active')&&date===localDate()&&!document.hidden)update(true)},180000);
})();