const VERSION='1.0.0',API='https://api.sleeper.app/v1',PAPI='https://api.sleeper.app';
const POS=['QB','RB','WR','TE','K','DEF'];
const ELIG={QB:['QB'],RB:['RB'],WR:['WR'],TE:['TE'],K:['K'],DEF:['DEF'],FLEX:['RB','WR','TE'],WRRB_FLEX:['WR','RB'],REC_FLEX:['WR','TE'],SUPER_FLEX:['QB','RB','WR','TE']};
const SLOT_ORDER=['QB','RB','WR','TE','K','DEF','WRRB_FLEX','REC_FLEX','FLEX','SUPER_FLEX'];
// rough weekly coefficient of variation by position (estimate) + floor SD
const CV={QB:.32,RB:.5,WR:.55,TE:.6,K:.45,DEF:.6},SDMIN=3;
const ESPN_FIX={WSH:'WAS',JAC:'JAX'};
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={tab:'team',pos:'ALL',username:localStorage.fa_user||'LJaggers',leagueId:localStorage.fa_league||''};
let D=null;
const j=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(r.status+' '+u);return r.json()};
const idb=()=>new Promise((res,rej)=>{const q=indexedDB.open('fa',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const iget=async k=>{const d=await idb();return new Promise(r=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)})};
const iset=async(k,v)=>{const d=await idb();return new Promise(r=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=r;t.onerror=r})};
async function players(force){
  const c=await iget('players').catch(()=>null);
  if(c&&!force&&Date.now()-c.t<864e5)return c.p;
  status('Downloading NFL player database (~5MB, once a day)…');
  const raw=await j(API+'/players/nfl'),p={};
  for(const[id,x]of Object.entries(raw)){const fp=(x.fantasy_positions||[x.position]).filter(v=>POS.includes(v));if(!fp.length)continue;
    p[id]={n:x.position==='DEF'?`${x.first_name} ${x.last_name}`:(x.full_name||`${x.first_name} ${x.last_name}`),pos:x.position,fp,t:x.team,a:!!x.active,inj:x.injury_status||''}}
  await iset('players',{t:Date.now(),p}).catch(()=>{});return p}
function status(m){$('#status').innerHTML=m}
const score=(st,ss)=>{if(!st)return 0;let s=0;for(const k in ss)if(st[k])s+=ss[k]*st[k];return Math.round(s*100)/100};
const projUrl=(kind,w)=>`${PAPI}/${kind}/nfl/${D.season}/${w}?season_type=regular&`+POS.map(p=>'position[]='+p).join('&');
// ---- Vegas lines (ESPN public scoreboard) ----
async function vegas(season,week){
  const d=await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`);
  const T={};
  for(const e of d.events||[]){const c=e.competitions?.[0];if(!c)continue;
    const ab=t=>{const a=t.team.abbreviation;return ESPN_FIX[a]||a};
    const h=c.competitors.find(t=>t.homeAway==='home'),a=c.competitors.find(t=>t.homeAway==='away');
    const st=e.status?.type?.state,o=(c.odds||[])[0];
    const base={state:st,game:e.shortName};
    let H={...base,opp:ab(a),home:true},A={...base,opp:ab(h),home:false};
    if(o&&o.overUnder){const ou=+o.overUnder,sp=Math.abs(+o.spread||0);
      let favHome=o.homeTeamOdds?.favorite??null;if(favHome===null&&o.awayTeamOdds)favHome=!o.awayTeamOdds.favorite;
      if(favHome===null&&o.details)favHome=o.details.startsWith(h.team.abbreviation);
      const fav=(ou+sp)/2,dog=(ou-sp)/2;
      Object.assign(H,{ou,spread:favHome?-sp:sp,imp:favHome?fav:dog});Object.assign(A,{ou,spread:favHome?sp:-sp,imp:favHome?dog:fav});
      H.oppImp=A.imp;A.oppImp=H.imp}
    T[ab(h)]=H;T[ab(a)]=A}
  const imps=Object.values(T).map(t=>t.imp).filter(x=>x>0);
  return{T,avg:imps.length?imps.reduce((a,b)=>a+b,0)/imps.length:null,n:imps.length/2}
}
async function load(force){
  status('Loading…');
  try{
    const st=await j(API+'/state/nfl'),season=st.league_season||st.season,week=Math.max(1,st.display_week||st.week);
    const user=await j(API+'/user/'+encodeURIComponent(S.username));if(!user)throw new Error('User not found: '+S.username);
    const leagues=await j(`${API}/user/${user.user_id}/leagues/nfl/${season}`);
    if(!leagues.length)throw new Error('No leagues for '+season);
    if(!leagues.find(l=>l.league_id===S.leagueId))S.leagueId=leagues[0].league_id;
    D={st,season,week,user,leagues};
    $('#league').innerHTML=leagues.map(l=>`<option value="${l.league_id}" ${l.league_id===S.leagueId?'selected':''}>${esc(l.name)}</option>`).join('');
    const P=await players(force);
    const lid=S.leagueId,recent=[week-1,week-2,week-3].filter(w=>w>0);
    const [league,rosters,users,matchups,proj,trend,vg,...stats]=await Promise.all([j(API+'/league/'+lid),j(API+`/league/${lid}/rosters`),j(API+`/league/${lid}/users`),j(API+`/league/${lid}/matchups/${week}`).catch(()=>[]),
      j(projUrl('projections',week)),j(API+'/players/nfl/trending/add?lookback_hours=48&limit=300').catch(()=>null),vegas(season,week).catch(e=>({err:e.message})),...recent.map(w=>j(projUrl('stats',w)).catch(()=>null))]);
    Object.assign(D,{league,rosters,users,matchups,P,ss:league.scoring_settings,V:vg});
    const PR={},playing=new Set;
    for(const e of proj){PR[e.player_id]={raw:score(e.stats,D.ss),opp:e.opponent,team:e.team,inj:e.player?.injury_status};if(e.opponent)playing.add(e.team)}
    const RA={};
    (stats).forEach(arr=>(arr||[]).forEach(e=>{if(!e.stats||!(e.stats.gp>0||e.stats.gms_active>0))return;(RA[e.player_id]??=[]).push(score(e.stats,D.ss))}));
    const TR={};(trend||[]).forEach(t=>TR[t.player_id]=t.count);
    D.PR=PR;D.playing=playing;D.RA=RA;D.TR=TR;
    D.warn=[];if(vg.err||!vg.avg)D.warn.push('Vegas lines unavailable — using raw Sleeper projections.');if(!trend)D.warn.push('Trending-adds data unavailable.');if(stats.some(s=>!s))D.warn.push('Some recent stats unavailable.');
    D.updated=new Date();localStorage.fa_league=lid;
    D.cache={};analyze();render();
    status(`Week ${week} · updated ${D.updated.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}${vg.avg?` · Vegas: ${vg.n} games, avg implied ${vg.avg.toFixed(1)}`:''}`+D.warn.map(w=>`<div style="color:#e3b341">⚠ ${w}</div>`).join(''));
  }catch(e){console.error(e);status('Error: '+esc(e.message)+' — tap ⟳ to retry');if(D?.league)render()}
}
function vegasFactor(pos,g){
  if(!g||!g.imp||!D.V.avg)return 1;
  // DEF benefits when the OPPONENT's implied total is low; offense when own implied total is high.
  // Damped by 0.5 because Sleeper projections already partly price in matchup; clamped ±15%.
  const r=pos==='DEF'?D.V.avg/g.oppImp:g.imp/D.V.avg;return Math.min(1.15,Math.max(.85,1+.5*(r-1)))}
function info(id){
  if(D.cache[id])return D.cache[id];
  const p=D.P[id]||{n:'#'+id,pos:'?',fp:[]},pr=D.PR[id],ra=D.RA[id],t=p.t||pr?.team;
  const bye=!!t&&!D.playing.has(t)&&D.playing.size>0,inj=(pr?.inj??p.inj)||'';
  const out=bye||/^(Out|IR|PUP|Sus|NA)/i.test(inj)||(!t);
  const g=D.V.T?.[t],f=vegasFactor(p.pos,g),raw=bye?0:(pr?.raw||0);
  let proj=raw*f;if(/^Doubtful/i.test(inj))proj*=.25;else if(/^Quest/i.test(inj))proj*=.9;
  if(out)proj=0;
  return D.cache[id]={id,name:p.n,pos:p.pos,fp:p.fp,team:t||'FA',raw,proj,f,g,opp:pr?.opp,bye,inj,out,avg:ra&&ra.length?ra.reduce((a,b)=>a+b,0)/ra.length:null,n:ra?.length||0,trend:D.TR[id]||0,locked:g&&g.state&&g.state!=='pre'}
}
// P(A outscores B): normal approx with position-based variance (estimate)
const sd=x=>Math.max(SDMIN,x.proj*(CV[x.pos]||.5));
const erf=x=>{const t=1/(1+.3275911*Math.abs(x)),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return x>=0?y:-y};
const pBeat=(a,b)=>b.out&&!b.locked?.99:.5*(1+erf((a.proj-b.proj)/Math.sqrt(sd(a)**2+sd(b)**2)/Math.SQRT2));
const pct=p=>Math.round(Math.min(.99,Math.max(.01,p))*100)+'%';
function optimal(ids,slots,vf){
  const pool=ids.map(info).map(x=>({...x,v:vf?vf(x):x.out?-1:x.proj}));const used=new Set,res=new Array(slots.length);
  const order=slots.map((s,i)=>({s,i})).filter(o=>ELIG[o.s]).sort((a,b)=>SLOT_ORDER.indexOf(a.s)-SLOT_ORDER.indexOf(b.s));
  for(const{s,i}of order){const c=pool.filter(p=>!used.has(p.id)&&p.fp.some(f=>ELIG[s].includes(f))).sort((a,b)=>b.v-a.v)[0];if(c){used.add(c.id);res[i]=c.id}}
  return res}
function analyze(){
  const L=D.league,slots=L.roster_positions.filter(s=>s!=='BN'&&s!=='IR'&&s!=='TAXI');D.slots=slots;
  const my=D.rosters.find(r=>r.owner_id===D.user.user_id||(r.co_owners||[]).includes(D.user.user_id));D.my=my;
  if(!my)return;
  const reserve=new Set([...(my.reserve||[]),...(my.taxi||[])]);
  D.cur=(my.starters||[]).slice(0,slots.length);
  // players whose game already started can't be moved: keep them in their current slot
  const all=(my.players||[]).filter(id=>!reserve.has(id));
  const lockedCur=new Set(D.cur.filter(x=>x&&x!=='0'&&info(x).locked));
  const lockedBench=new Set(all.filter(x=>!D.cur.includes(x)&&info(x).locked));
  const freeSlots=slots.map((s,i)=>lockedCur.has(D.cur[i])?null:s);
  const o=optimal(all.filter(x=>!lockedCur.has(x)&&!lockedBench.has(x)),freeSlots.map(s=>s||'LOCKED'));
  D.opt=slots.map((s,i)=>lockedCur.has(D.cur[i])?D.cur[i]:o[i]);
  const opt=new Set(D.opt.filter(Boolean)),cur=new Set(D.cur.filter(x=>x&&x!=='0'));
  const ins=[...opt].filter(x=>!cur.has(x)).map(info).sort((a,b)=>b.proj-a.proj),outs=[...cur].filter(x=>!opt.has(x)).map(info).sort((a,b)=>a.proj-b.proj);
  D.swaps=ins.map((p,i)=>({in:p,out:outs[i]}));
  // close calls (bench player nearly as good as a starter at an eligible slot)
  D.close=[];const bench=all.filter(x=>!opt.has(x)).map(info).filter(x=>!x.out&&!x.locked&&x.proj>0);
  D.opt.forEach((id,i)=>{if(!id)return;const s=info(id);if(s.locked)return;bench.forEach(b=>{if(b.fp.some(f=>(ELIG[slots[i]]||[]).includes(f))){const p=pBeat(s,b);if(p<.62)D.close.push({s,b,p})}})});
  D.close.sort((a,b)=>a.p-b.p);
  // waivers
  const rostered=new Set(D.rosters.flatMap(r=>[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])]));
  const usedPos=new Set(slots.flatMap(s=>ELIG[s]||[]));
  D.fa=Object.keys(D.P).filter(id=>{const p=D.P[id];return!rostered.has(id)&&p.a&&p.t&&usedPos.has(p.pos)}).map(info)
    .filter(x=>x.raw>0||x.avg||x.trend).sort((a,b)=>b.proj-a.proj||b.trend-a.trend);
  const mine=(my.players||[]).map(info);
  const benchAll=mine.filter(m=>!opt.has(m.id)&&!reserve.has(m.id)).sort((a,b)=>val(a)-val(b));
  // Marginal value: how much does the best lineup improve (this week's proj AND a recent-form "typical week") if we swap FA in for a bench player?
  const lineupIds=all.filter(x=>!info(x).locked||opt.has(x));
  const wk=x=>x.locked?(opt.has(x.id)?1000:-1):x.out?-1:x.proj, ros=x=>x.out&&!x.bye?0:shrunk(x);
  const tot=(ids,vf)=>optimal(ids,slots,vf).filter(Boolean).reduce((s,id)=>s+Math.max(0,vf(info(id))),0);
  let cr=all.slice(),baseW=tot(lineupIds,wk),baseR=tot(cr,ros);
  const used=new Set;D.moves=[];
  const cands=D.fa.filter(f=>!f.out&&(f.raw>0||f.avg)).sort((a,b)=>val(b)-val(a)).slice(0,200);
  for(const f of cands){
    let best=null;
    for(const d of benchAll){if(used.has(d.id))continue;
      const ids=cr.filter(x=>x!==d.id).concat(f.id);
      const gW=tot(ids.filter(x=>!info(x).locked||opt.has(x)),wk)-baseW,gR=tot(ids,ros)-baseR;
      const depth=f.pos===d.pos?.25*(val(f)-val(d)):0; // depth/bye insurance at same position
      const g=.6*gW+.4*gR+depth-.1*val(d); // small penalty for losing bench depth
      if(!best||g>best.g)best={d,g,gW,gR}}
    if(!best||best.g<1.5)continue;
    const drop=best.d,ws=mine.filter(m=>opt.has(m.id)&&m.fp.some(p=>f.fp.includes(p))&&!m.locked).sort((a,b)=>a.proj-b.proj)[0];
    const startGain=best.gW>0&&ws?f.proj-ws.proj:0,startConf=startGain>0?pBeat(f,ws):0,conf=pBeatV(f,drop);
    const urg=best.gW>=2&&startConf>=.6?'hi':best.g>=3||f.trend>=50000&&best.g>=2?'md':'lo';
    f.rec={drop,gain:best.g,gW:best.gW,gR:best.gR,ws,startGain,conf,startConf,urg};D.moves.push(f);used.add(drop.id);
    cr=cr.filter(x=>x!==drop.id).concat(f.id);baseW=tot(cr.filter(x=>!info(x).locked||opt.has(x)),wk);baseR=tot(cr,ros);
  }
}
// recent avg shrunk toward projection (small samples are noisy)
const shrunk=x=>x.avg==null?x.raw:(x.bye||!x.raw)?x.avg:(x.n*x.avg+2*x.raw)/(x.n+2);
// value blends this week's (Vegas-adjusted) projection with recent production (rest-of-season proxy)
const val=x=>x.out&&!x.bye?shrunk(x)*.3:(x.bye?shrunk(x):x.proj)*.6+shrunk(x)*.4;
const pBeatV=(a,b)=>{const A={...a,proj:val(a)},B={...b,proj:val(b),out:false};return pBeat(A,B)};
function flags(x){let s='';if(x.bye)s+='<span class="tag bad">BYE</span>';if(x.inj)s+=`<span class="tag ${/^Q/.test(x.inj)?'warn':'bad'}">${esc(x.inj)}</span>`;if(!x.bye&&x.out&&!x.inj)s+='<span class="tag bad">OUT</span>';if(x.locked)s+='<span class="tag">🔒</span>';return s}
const gline=x=>{const g=x.g;if(!g)return x.opp?(' vs '+x.opp):'';return ` ${g.home?'vs':'@'} ${g.opp}`+(g.imp?` · imp ${g.imp.toFixed(1)} (${g.spread>0?'+':''}${g.spread}, o/u ${g.ou})`:'')};
function prow(x,slot,extra=''){if(!x)return`<div class="row"><span class="slot">${slot}</span><span class="nm muted">— empty —</span></div>`;
  return`<div class="row"><span class="slot">${slot}</span><span class="nm"><b>${esc(x.name)}${flags(x)}</b><span class="small muted">${x.pos} · ${x.team}${gline(x)} · L3 ${x.avg==null?'–':x.avg.toFixed(1)}${x.trend?' · +'+x.trend+' adds':''}</span>${extra}</span><span class="pts">${x.proj.toFixed(1)}${Math.abs(x.f-1)>.005&&x.proj?`<div class="small muted">${x.f>1?'▲':'▼'}${Math.abs((x.f-1)*100).toFixed(0)}%</div>`:''}</span></div>`}
const sum=a=>a.filter(x=>x&&x!=='0').reduce((s,id)=>s+info(id).proj,0);
function render(){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===S.tab));
  const v=$('#view');if(S.tab==='settings')return v.innerHTML=settings();
  if(!D||!D.league)return v.innerHTML='<div class="card muted">Loading…</div>';
  if(!D.my)return v.innerHTML='<div class="card">No roster for this user in this league.</div>';
  v.innerHTML=S.tab==='team'?team():S.tab==='waiver'?waiver():match();
}
function team(){
  const cp=sum(D.cur),op=sum(D.opt);
  let h=`<div class="card"><div class="vs"><div><div class="small muted">Current lineup</div><div class="big">${cp.toFixed(1)}</div></div><div><div class="small muted">Optimal</div><div class="big" style="color:#3fb950">${op.toFixed(1)}</div></div></div></div>`;
  if(D.swaps.length){h+='<h2>Lineup changes</h2>'+D.swaps.map(s=>`<div class="card rec ${s.out?.out?'hi':'md'}">Start <b>${esc(s.in.name)}</b> over <b>${s.out?esc(s.out.name):'empty slot'}</b>${s.out?flags(s.out):''} <span class="tag good">+${(s.in.proj-(s.out?.proj||0)).toFixed(1)} proj</span><div class="small muted">Est. ${s.out?pct(pBeat(s.in,s.out)):'99%'} chance ${esc(s.in.name.split(' ').pop())} outscores ${s.out?esc(s.out.name.split(' ').pop()):'an empty slot'}</div></div>`).join('')}
  else h+='<div class="card rec">✅ Your current lineup is optimal by projection.</div>';
  if(D.close.length)h+='<h2>Close calls</h2><div class="card small">'+D.close.slice(0,4).map(c=>`<div class="row"><span class="nm">${esc(c.s.name)} (${c.s.proj.toFixed(1)}) vs ${esc(c.b.name)} (${c.b.proj.toFixed(1)})</span><span class="pts">${pct(c.p)}</span></div>`).join('')+'<div class="muted">Coin-flip-ish: est. chance the starter outscores the bench option.</div></div>';
  h+='<h2>Current starters</h2><div class="card">'+D.slots.map((s,i)=>prow(D.cur[i]&&D.cur[i]!=='0'?info(D.cur[i]):null,sl(s))).join('')+'</div>';
  h+='<h2>Optimal lineup</h2><div class="card">'+D.slots.map((s,i)=>prow(D.opt[i]?info(D.opt[i]):null,sl(s))).join('')+'</div>';
  const bn=(D.my.players||[]).filter(x=>!D.opt.includes(x)).map(info).sort((a,b)=>b.proj-a.proj);
  h+='<h2>Bench / reserve</h2><div class="card">'+bn.map(x=>prow(x,(D.my.reserve||[]).includes(x.id)?'IR':'BN')).join('')+'</div>';
  return h+note()}
const sg=v=>(v>=0?'+':'')+v.toFixed(1);
const sl=s=>({SUPER_FLEX:'SFLX',WRRB_FLEX:'W/R',REC_FLEX:'W/T'}[s]||s);
function waiver(){
  const L=D.league,bud=L.settings.waiver_budget;
  let h='';if(bud){h+=`<div class="card">FAAB remaining: <b>$${bud-(D.my.settings.waiver_budget_used||0)}</b> of $${bud}</div>`}
  const ps=['ALL',...POS.filter(p=>D.slots.some(s=>(ELIG[s]||[]).includes(p)))];
  h+='<div class="chips">'+ps.map(p=>`<button data-pos="${p}" class="${S.pos===p?'on':''}">${p}</button>`).join('')+'</div>';
  const list=D.fa.filter(f=>S.pos==='ALL'||f.pos===S.pos);
  const U={hi:0,md:1,lo:2};
  const recs=D.moves.filter(f=>S.pos==='ALL'||f.pos===S.pos).sort((a,b)=>U[a.rec.urg]-U[b.rec.urg]||b.rec.gain-a.rec.gain).slice(0,8);
  h+='<h2>Recommended moves</h2>'+(recs.length?recs.map(f=>{const r=f.rec;return`<div class="card rec ${r.urg}"><span class="tag ${r.urg==='hi'?'bad':r.urg==='md'?'warn':'good'}">${{hi:'URGENT',md:'GOOD',lo:'OPTIONAL'}[r.urg]}</span> Pick up <b>${esc(f.name)}</b> (${f.pos} ${f.team}, ${f.proj.toFixed(1)} proj, L3 ${f.avg==null?'–':f.avg.toFixed(1)}${f.trend?', +'+f.trend+' adds':''}), drop <b>${esc(r.drop.name)}</b>${flags(r.drop)} (${r.drop.proj.toFixed(1)} proj, L3 ${r.drop.avg==null?'–':r.drop.avg.toFixed(1)})
  <div class="small muted">Lineup gain: ${sg(r.gW)} this week, ${sg(r.gR)} per typical week (recent form). Est. ${pct(r.conf)} chance ${esc(f.name.split(' ').pop())} outscores ${esc(r.drop.name.split(' ').pop())}.${r.startGain>0?` Would start over ${esc(r.ws.name)}: +${r.startGain.toFixed(1)} proj, est. ${pct(r.startConf)} to outscore.`:''}${bud&&r.urg!=='lo'?` Suggested bid: ~$${Math.max(1,Math.round((bud-(D.my.settings.waiver_budget_used||0))*(/K|DEF/.test(f.pos)?.01:r.urg==='hi'?.12:.05)))}`:''}</div></div>`}).join(''):'<div class="card muted">No free agent is meaningfully better than your roster.</div>');
  h+='<h2>Top free agents</h2><div class="card">'+list.slice(0,60).map(f=>prow(f,f.pos)).join('')+'</div>';
  return h+note()}
function match(){
  const me=D.matchups.find(m=>m.roster_id===D.my.roster_id);if(!me)return'<div class="card">No matchup data this week.</div>';
  const op=D.matchups.find(m=>m.matchup_id===me.matchup_id&&m.roster_id!==me.roster_id);
  const name=r=>{const u=D.users.find(u=>u.user_id===r?.owner_id);return u?(u.metadata?.team_name||u.display_name):'Opponent'};
  const opR=op&&D.rosters.find(r=>r.roster_id===op.roster_id);
  // for locked/finished games use actual points
  const tot=m=>(m.starters||[]).filter(x=>x&&x!=='0').reduce((s,id)=>{const x=info(id);return s+(x.locked&&x.g?.state==='post'&&m.players_points?.[id]!=null?m.players_points[id]:x.proj)},0);
  const sdT=m=>Math.sqrt((m.starters||[]).filter(x=>x&&x!=='0').map(info).filter(x=>!(x.locked&&x.g?.state==='post')).reduce((s,x)=>s+sd(x)**2,0));
  const ms=tot(me),os=op?tot(op):0,pw=op?.5*(1+erf((ms-os)/Math.sqrt(sdT(me)**2+sdT(op)**2+1)/Math.SQRT2)):1;
  const myOpt={...me,starters:D.opt},mo=tot(myOpt);
  let h=`<div class="card"><div class="vs"><div><div class="small muted">${esc(name(D.my))}</div><div class="big">${ms.toFixed(1)}</div><div class="small muted">if optimal ${mo.toFixed(1)}<br>actual so far ${(me.points||0).toFixed(1)}</div></div><div style="flex:0;align-self:center" class="muted">vs</div><div><div class="small muted">${esc(name(opR))}</div><div class="big">${os.toFixed(1)}</div><div class="small muted"><br>actual so far ${(op?.points||0).toFixed(1)}</div></div></div>
  <div style="text-align:center;margin-top:8px"><b>Est. win probability: ${pct(pw)}</b><div class="small muted">Records ${D.my.settings.wins}-${D.my.settings.losses} vs ${opR?opR.settings.wins+'-'+opR.settings.losses:''} · finished games use actual points</div></div></div>`;
  if(op)h+='<h2>Opponent starters</h2><div class="card">'+(op.starters||[]).map((id,i)=>prow(id&&id!=='0'?info(id):null,sl(D.slots[i]||''),op.players_points?.[id]!=null&&info(id).locked?`<span class="small muted"> · actual ${op.players_points[id]}</span>`:'')).join('')+'</div>';
  return h+note()}
function settings(){return`<div class="card"><label>Sleeper username<br><input id="uname" value="${esc(S.username)}" style="width:100%;margin:8px 0" autocapitalize="off"></label><button id="saveu" style="width:100%">Save &amp; reload</button></div>
<div class="card"><button id="pdb" style="width:100%">Re-download player database</button></div>
<div class="card small muted"><b>How numbers are made (all estimates):</b><br>• Base projections are Sleeper's projected stat lines with your league's scoring settings applied.<br>• Vegas adjustment: implied team total = (over/under ± spread)/2 from ESPN's public scoreboard (DraftKings lines). Each player's projection is nudged by half the ratio of his team's implied total to the league-average implied total (DEF uses the opponent's implied total, inverted), capped at ±15%. ▲/▼ shows the adjustment.<br>• Questionable −10%, Doubtful −75%, Out/IR/bye = 0.<br>• Confidence % = estimated chance A outscores B using a normal approximation with position-based variance. These are rough models, not true betting odds.<br>• L3 = average fantasy points over the last 3 weeks played. 🔒 = game started/finished.<br>Data is fetched directly by your browser from Sleeper and ESPN; nothing is stored on a server.</div>
<div class="card small">Version <b>${VERSION}</b></div>`}
const note=()=>'<p class="small muted" style="padding:4px">Projections from Sleeper, adjusted with Vegas lines — estimates only. See Settings.</p>';
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.t){S.tab=b.dataset.t;render();scrollTo(0,0)}else if(b.dataset.pos){S.pos=b.dataset.pos;render()}
  else if(b.id==='refresh')load();else if(b.id==='pdb')load(true);
  else if(b.id==='saveu'){S.username=$('#uname').value.trim()||'LJaggers';localStorage.fa_user=S.username;S.leagueId='';S.tab='team';load()}});
$('#league').addEventListener('change',e=>{S.leagueId=e.target.value;load()});
render();load();
if('serviceWorker'in navigator){let reloaded=false;const had=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had&&!reloaded){reloaded=true;location.reload()}});
 addEventListener('load',()=>navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{if(!reg)return;reg.update();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})})}).catch(()=>{}))}
