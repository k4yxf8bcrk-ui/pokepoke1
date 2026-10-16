(() => {
  'use strict';

  const LS_DATA = 'd_records_v1';
  const LS_PRED = 'd_predictions_v1';
  const JP_DAYS = ['日','月','火','水','木','金','土'];
  const state = { records: [], analysis: null, predictions: [] };

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat('ja-JP');
  const pct = (v, d=1) => Number.isFinite(v) ? `${(v*100).toFixed(d)}%` : '—';
  const signed = (v) => !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${fmt.format(Math.round(v))}`;
  const prob = (g, n) => Number(n) > 0 ? `1/${(Number(g)/Number(n)).toFixed(1)}` : '—';
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const dayMs = 86400000;
  const dateKey = (s) => new Date(`${s}T00:00:00`).getTime();
  const isNextDay = (a,b) => dateKey(b)-dateKey(a) === dayMs;
  const addDays = (s,n) => { const d=new Date(`${s}T00:00:00`); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const weekday = (s) => JP_DAYS[new Date(`${s}T00:00:00`).getDay()];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2200); }

  function num(v){
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const x = String(v).replace(/,/g,'').replace(/[枚G回]/g,'').replace(/＋/g,'+').replace(/−/g,'-').trim();
    const n = Number(x); return Number.isFinite(n) ? n : 0;
  }

  function normDate(v){
    if (!v) return '';
    let s = String(v).trim().replace(/\./g,'/').replace(/-/g,'/');
    const m = s.match(/(20\d{2})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return '';
    return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  }

  const alias = {
    date:['date','日付','日時','年月日'], machineNo:['machineno','machine_no','台番','台番号','番号','no'],
    machine:['machine','機種','機種名','model','name'], games:['games','game','g','g数','ゲーム','ゲーム数','回転','回転数','総回転'],
    diff:['diff','差枚','差枚数','枚数','差玉'], bb:['bb','big','big回数','big回','b'], rb:['rb','reg','reg回数','reg回','r']
  };
  function keyOf(k){
    const q = String(k).toLowerCase().replace(/[\s_\-]/g,'');
    for (const [dest, list] of Object.entries(alias)) if (list.some(x => q === String(x).toLowerCase().replace(/[\s_\-]/g,''))) return dest;
    return null;
  }
  function normalizeRecord(row, seq=0){
    const o={}; for(const [k,v] of Object.entries(row||{})){ const nk=keyOf(k); if(nk) o[nk]=v; }
    const date=normDate(o.date), machineNo=String(o.machineNo ?? '').trim(), machine=String(o.machine ?? 'Unknown').trim() || 'Unknown';
    if(!date || !machineNo) return null;
    return { date, machineNo, machine, games:num(o.games), diff:num(o.diff), bb:num(o.bb), rb:num(o.rb), _seq:seq };
  }

  function splitLine(line, delim){
    if (delim !== ',') return line.split(delim);
    const out=[]; let cur='', quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"' && line[i+1]==='"' && quoted){cur+='"'; i++;}
      else if(c==='"') quoted=!quoted;
      else if(c===',' && !quoted){out.push(cur);cur='';}
      else cur+=c;
    }
    out.push(cur); return out;
  }
  function parseDelimited(text){
    const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
    if(lines.length<2) return [];
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const headers=splitLine(lines[0],delim).map(x=>x.trim());
    return lines.slice(1).map((line,i)=>{
      const vals=splitLine(line,delim); const r={}; headers.forEach((h,j)=>r[h]=vals[j]??''); return normalizeRecord(r,i);
    }).filter(Boolean);
  }
  function parseAny(text){
    const s=String(text).trim(); if(!s) return [];
    try{
      const j=JSON.parse(s); const arr=Array.isArray(j)?j:(Array.isArray(j.records)?j.records:[]);
      if(arr.length) return arr.map((r,i)=>normalizeRecord(r,i)).filter(Boolean);
    }catch(_){ }
    return parseDelimited(s);
  }

  function mergeRecords(incoming){
    const all=[...state.records,...incoming]; const map=new Map();
    all.forEach((r,i)=>{ if(!r) return; const k=`${r.date}|${r.machineNo}`; map.set(k,{...r,_seq:i}); });
    state.records=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.machineNo.localeCompare(b.machineNo,undefined,{numeric:true}));
    saveData(); renderDataStatus(); populateFilters(); autoScorePredictions();
  }
  function saveData(){ try{ localStorage.setItem(LS_DATA,JSON.stringify(state.records.map(({_seq,...r})=>r))); }catch(e){ toast('保存容量を超えました。取込データはこの画面では利用できます。'); } }
  function loadLocal(){
    try{ const d=JSON.parse(localStorage.getItem(LS_DATA)||'[]'); state.records=Array.isArray(d)?d:[]; }catch(_){ state.records=[]; }
    try{ const p=JSON.parse(localStorage.getItem(LS_PRED)||'[]'); state.predictions=Array.isArray(p)?p:[]; }catch(_){ state.predictions=[]; }
  }

  async function loadRepoData(){
    try{
      const r=await fetch('./data.json',{cache:'no-store'}); if(!r.ok) return;
      const j=await r.json(); const arr=Array.isArray(j)?j:(j.records||[]);
      const n=arr.map((x,i)=>normalizeRecord(x,i)).filter(Boolean); if(n.length) mergeRecords(n);
    }catch(_){ }
  }

  function groupsByMachine(records=state.records){
    const m=new Map(); for(const r of records){ if(!m.has(r.machineNo)) m.set(r.machineNo,[]); m.get(r.machineNo).push(r); }
    for(const a of m.values()) a.sort((x,y)=>x.date.localeCompare(y.date)); return m;
  }
  function pairs(rows){ const p=[]; for(let i=0;i<rows.length-1;i++) if(isNextDay(rows[i].date,rows[i+1].date)) p.push({x:rows[i],y:rows[i+1],i}); return p; }
  function statRows(rows){
    if(!rows.length) return {n:0,games:0,diff:0,avg:0,median:0,winRate:0,bbProb:null,rbProb:null,totalProb:null,avgGames:0};
    const diffs=rows.map(x=>x.diff).sort((a,b)=>a-b), games=rows.reduce((s,x)=>s+x.games,0), diff=rows.reduce((s,x)=>s+x.diff,0), bb=rows.reduce((s,x)=>s+x.bb,0), rb=rows.reduce((s,x)=>s+x.rb,0), n=rows.length;
    return { n,games,diff,avg:diff/n,median:n%2?diffs[(n-1)/2]:(diffs[n/2-1]+diffs[n/2])/2,winRate:rows.filter(x=>x.diff>0).length/n,bbProb:bb?games/bb:null,rbProb:rb?games/rb:null,totalProb:(bb+rb)?games/(bb+rb):null,avgGames:games/n };
  }
  function nextStat(ps){ const rows=ps.map(z=>z.y); return statRows(rows); }
  function shrunkWin(s, strength=10){ return s.n ? (s.winRate*s.n + .5*strength)/(s.n+strength) : .5; }
  function band(diff){ if(diff>=2000)return '+2000~'; if(diff>=1000)return '+1000~+1999'; if(diff>=500)return '+500~+999'; if(diff>0)return '+1~+499'; if(diff<=-1500)return '-1500~'; if(diff<=-1000)return '-1000~-1499'; if(diff<=-500)return '-500~-999'; return '-1~-499'; }
  function sameBand(a,b){ return band(a)===band(b); }

  function recent(rows,n){ return statRows(rows.slice(-n)); }
  function currentStreak(rows){
    if(!rows.length) return {type:'none',days:0,sum:0}; const last=rows.at(-1), positive=last.diff>0, negative=last.diff<0; if(!positive&&!negative)return {type:'flat',days:1,sum:0};
    let days=0,sum=0; for(let i=rows.length-1;i>=0;i--){ const r=rows[i], next=rows[i+1]; if(next && !isNextDay(r.date,next.date)) break; if((positive&&r.diff>0)||(negative&&r.diff<0)){days++;sum+=r.diff;} else break; }
    return {type:positive?'plus':'minus',days,sum};
  }
  function runCrossPairs(rows, threshold, type='minus'){
    const out=[]; let run=0,days=0;
    for(let i=0;i<rows.length-1;i++){
      const r=rows[i], prev=rows[i-1], next=rows[i+1]; if(prev && !isNextDay(prev.date,r.date)){run=0;days=0;}
      const val=type==='minus'?-r.diff:r.diff;
      if(val>0){ const before=run; run+=val; days++; if(days>=2 && before<threshold && run>=threshold && isNextDay(r.date,next.date)) out.push({x:r,y:next,draw:run,days}); }
      else {run=0;days=0;}
    }
    return out;
  }
  function afterCondition(rows, fn){ return nextStat(pairs(rows).filter(z=>fn(z.x))); }

  function percentile(arr,p){ if(!arr.length)return null; const a=[...arr].sort((x,y)=>x-y); const i=(a.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo); }

  function feature(r, prev5){
    const bp=r.bb>0?r.games/r.bb:500, rp=r.rb>0?r.games/r.rb:700, tp=(r.bb+r.rb)>0?r.games/(r.bb+r.rb):300;
    return [clamp(r.diff/2500,-2,2),clamp(r.games/6000,0,2),clamp((bp-280)/120,-2,2),clamp((rp-380)/180,-2,2),clamp((tp-160)/70,-2,2),clamp((prev5?.avg||0)/1200,-2,2)];
  }
  function similarCases(rows, current, k){
    if(rows.length<4) return {n:0,avg:0,median:0,winRate:0,cases:[]};
    const curPrev=statRows(rows.slice(Math.max(0,rows.length-5))), fv=feature(current,curPrev), candidates=[];
    for(let i=4;i<rows.length-1;i++){
      if(!isNextDay(rows[i].date,rows[i+1].date)) continue;
      const prev=statRows(rows.slice(Math.max(0,i-4),i+1)), v=feature(rows[i],prev); let d=0; for(let j=0;j<v.length;j++) d+=(v[j]-fv[j])**2;
      candidates.push({date:rows[i].date,next:rows[i+1].diff,distance:Math.sqrt(d)});
    }
    const c=candidates.sort((a,b)=>a.distance-b.distance).slice(0,k); const vals=c.map(x=>x.next).sort((a,b)=>a-b), n=c.length;
    return {n,avg:n?c.reduce((s,x)=>s+x.next,0)/n:0,median:n?(n%2?vals[(n-1)/2]:(vals[n/2-1]+vals[n/2])/2):0,winRate:n?c.filter(x=>x.next>0).length/n:0,cases:c};
  }

  function analyzeMachine(machineNo, rows, targetDate){
    const latest=rows.at(-1), targetWd=weekday(targetDate), ps=pairs(rows), minGames=num($('weekdayMinGames').value)||2000, k=num($('similarK').value)||12;
    const wd=statRows(rows.filter(r=>weekday(r.date)===targetWd && r.games>=minGames));
    const r5=recent(rows,5), r7=recent(rows,7), r10=recent(rows,10), r30=recent(rows,30), all=statRows(rows), streak=currentStreak(rows), sim=similarCases(rows,latest,k);
    const afterBand=afterCondition(rows,r=>sameBand(r.diff,latest.diff));
    const afterReg300=afterCondition(rows,r=>r.games>=2000&&r.rb>0&&r.games/r.rb<=300);
    const afterReg350=afterCondition(rows,r=>r.games>=2000&&r.rb>0&&r.games/r.rb<=350);
    const afterBig250=afterCondition(rows,r=>r.games>=2000&&r.bb>0&&r.games/r.bb<=250);
    const afterBoth=afterCondition(rows,r=>r.games>=2000&&r.bb>0&&r.rb>0&&r.games/r.bb<=250&&r.games/r.rb<=350);
    const afterPlus2000=afterCondition(rows,r=>r.diff>=2000), afterMinus1000=afterCondition(rows,r=>r.diff<=-1000);
    let run=null;
    if(streak.type==='minus'){
      const d=-streak.sum; const t=d>=2500?2500:d>=2000?2000:d>=1500?1500:d>=1000?1000:d>=750?750:d>=500?500:null;
      if(t) run={threshold:t,...nextStat(runCrossPairs(rows,t,'minus'))};
    } else if(streak.type==='plus'){
      const d=streak.sum; const t=d>=3000?3000:d>=2500?2500:d>=2000?2000:d>=1500?1500:d>=1000?1000:d>=500?500:null;
      if(t) run={threshold:t,...nextStat(runCrossPairs(rows,t,'plus'))};
    }

    const empirical = [];
    empirical.push({name:'曜日',s:wd,w:.24});
    empirical.push({name:'前日差枚帯',s:afterBand,w:.13});
    empirical.push({name:'類似',s:sim,w:.20});
    if(run) empirical.push({name:'連続波',s:run,w:.16});
    if(latest.games>=2000 && latest.rb>0 && latest.games/latest.rb<=350) empirical.push({name:'REG条件',s:latest.games/latest.rb<=300?afterReg300:afterReg350,w:.12});
    if(latest.games>=2000 && latest.bb>0 && latest.games/latest.bb<=250) empirical.push({name:'BIG条件',s:afterBig250,w:.06});
    if(latest.games>=2000 && latest.bb>0 && latest.rb>0 && latest.games/latest.bb<=250 && latest.games/latest.rb<=350) empirical.push({name:'BB+REG',s:afterBoth,w:.08});
    if(latest.diff>=2000) empirical.push({name:'+2000後',s:afterPlus2000,w:.10});
    if(latest.diff<=-1000) empirical.push({name:'-1000後',s:afterMinus1000,w:.10});
    let wsum=0, edge=0, evidence=0;
    for(const e of empirical){ const sw=shrunkWin(e.s,10); edge += (sw-.5)*2*e.w; wsum+=e.w; evidence += Math.min(e.s.n||0,30)*e.w; }
    if(wsum) edge/=wsum;
    const recentEdge=clamp((r7.avg/1200)*.035,-.05,.05)+clamp((r30.winRate-.5)*.08,-.03,.03);
    const score=clamp(50 + edge*32 + recentEdge*100,25,82);
    const confidence=evidence>=14?'高':evidence>=7?'中':'低';

    const factors=[];
    const sorted=[...empirical].filter(e=>e.s.n>=5).map(e=>({...e,adj:shrunkWin(e.s,10)})).sort((a,b)=>Math.abs(b.adj-.5)-Math.abs(a.adj-.5));
    sorted.slice(0,3).forEach(e=>factors.push(`${e.name} ${e.s.n}件・翌日プラス${pct(e.s.winRate)}`));
    if(streak.type!=='flat'&&streak.type!=='none') factors.push(`${streak.days}日連続${streak.type==='minus'?'マイナス':'プラス'} 累計${signed(streak.sum)}枚`);
    if(latest.games>=1500) factors.push(`前日 REG ${prob(latest.games,latest.rb)} / BIG ${prob(latest.games,latest.bb)}`);
    const view=score>=65?'上位候補':score>=55?'候補':score>=47?'中立':'慎重';
    return {machineNo,machine:latest.machine,latest,targetDate,targetWd,score,confidence,view,wd,r5,r7,r10,r30,all,streak,sim,afterBand,afterReg300,afterReg350,afterBig250,afterBoth,afterPlus2000,afterMinus1000,run,factors};
  }

  function runAnalysis(){
    if(!state.records.length){toast('先にデータを取り込んでください');return;}
    const latestDate=state.records.map(r=>r.date).sort().at(-1), targetDate=addDays(latestDate,1), grouped=groupsByMachine(); const list=[];
    for(const [no,rows] of grouped) if(rows.length>=8) list.push(analyzeMachine(no,rows,targetDate));
    list.sort((a,b)=>b.score-a.score||a.machineNo.localeCompare(b.machineNo,undefined,{numeric:true}));
    state.analysis={latestDate,targetDate,targetWd:weekday(targetDate),list,recordCount:state.records.length,machineCount:grouped.size};
    renderAll(); toast('最新データで再分析しました');
  }

  function renderDataStatus(){
    if(!state.records.length){$('dataStatus').textContent='JSON / CSV / TSV に対応。ブラウザ内だけで処理します。';return;}
    const dates=state.records.map(r=>r.date).sort(); const models=new Set(state.records.map(r=>r.machine));
    $('dataStatus').textContent=`${fmt.format(state.records.length)}件 / ${new Set(state.records.map(r=>r.machineNo)).size}台 / ${models.size}機種 / ${dates[0]}〜${dates.at(-1)}`;
  }
  function populateFilters(){
    const models=[...new Set(state.records.map(r=>r.machine))].sort(), machines=[...new Set(state.records.map(r=>r.machineNo))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const mf=$('modelFilter'), bm=$('backtestMachine'); const oldM=mf.value, oldB=bm.value;
    mf.innerHTML='<option value="ALL">全機種</option>'+models.map(x=>`<option>${esc(x)}</option>`).join('');
    bm.innerHTML='<option value="ALL">全台</option>'+machines.map(x=>`<option>${esc(x)}</option>`).join('');
    if([...mf.options].some(o=>o.value===oldM)) mf.value=oldM; if([...bm.options].some(o=>o.value===oldB)) bm.value=oldB;
  }
  function renderKpis(){
    const a=state.analysis; if(!a){$('kpis').innerHTML='';return;}
    const top=a.list[0], rows=[['対象日',`${a.targetDate} (${a.targetWd})`],['データ',`${fmt.format(a.recordCount)}件`],['対象台',`${a.list.length}台`],['1位候補',top?`${top.machineNo} / ${top.score.toFixed(1)}点`:'—']];
    $('kpis').innerHTML=rows.map(([l,v])=>`<div class="card kpi"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('');
  }
  function filteredList(){
    if(!state.analysis)return[]; const m=$('modelFilter').value, q=$('machineSearch').value.trim().toLowerCase(); let a=state.analysis.list.filter(x=>(m==='ALL'||x.machine===m)&&(!q||x.machineNo.toLowerCase().includes(q)||x.machine.toLowerCase().includes(q)));
    const sort=$('sortBy').value;
    if(sort==='recent')a.sort((x,y)=>y.r7.avg-x.r7.avg); else if(sort==='reg')a.sort((x,y)=>(x.latest.rb?x.latest.games/x.latest.rb:9999)-(y.latest.rb?y.latest.games/y.latest.rb:9999)); else if(sort==='drawdown')a.sort((x,y)=>(x.streak.type==='minus'?x.streak.sum:0)-(y.streak.type==='minus'?y.streak.sum:0)); else a.sort((x,y)=>y.score-x.score);
    return a;
  }
  function renderRanking(){
    const a=filteredList().slice(0,num($('topN').value)||10); const box=$('ranking');
    if(!a.length){box.className='ranking empty';box.textContent='対象データなし';return;} box.className='ranking';
    box.innerHTML=a.map((x,i)=>`<div class="rank-item ${i===0?'top1':''}"><div class="rank-num">${i+1}</div><div class="machine-no">${esc(x.machineNo)}</div><div class="model-name" title="${esc(x.machine)}">${esc(x.machine)}</div><div class="score ${x.score>=65?'good':x.score>=55?'mid':'low'}">${x.score.toFixed(1)}</div><div class="reason">${esc(x.factors.slice(0,2).join(' / '))}</div></div>`).join('');
  }
  function renderTable(){
    const a=filteredList(), body=$('detailTable').querySelector('tbody');
    body.innerHTML=a.map((x,i)=>{
      const rp=x.latest.rb?x.latest.games/x.latest.rb:null, run=x.streak.type==='minus'?`${x.streak.days}日 ${signed(x.streak.sum)}`:x.streak.type==='plus'?`${x.streak.days}日 ${signed(x.streak.sum)}`:'—';
      return `<tr><td>${i+1}</td><td>${esc(x.machineNo)}</td><td>${esc(x.machine)}</td><td>${x.score.toFixed(1)}</td><td class="${x.latest.diff>0?'pos-text':x.latest.diff<0?'neg-text':''}">${signed(x.latest.diff)}</td><td>${run}</td><td>${rp?`1/${rp.toFixed(1)}`:'—'}</td><td>${x.wd.n?`${pct(x.wd.winRate)} n=${x.wd.n}`:'—'}</td><td>${x.sim.n?`${pct(x.sim.winRate)} n=${x.sim.n}`:'—'}</td><td><span class="pill ${x.score>=60?'pos':x.score<45?'neg':''}">${x.view}</span></td></tr>`;
    }).join('');
  }
  function renderWatch(){
    if(!state.analysis?.list.length){$('watchPoints').innerHTML='';return;} const top=state.analysis.list.slice(0,3), items=[];
    top.forEach((x,i)=>items.push(`${i+1}位 ${x.machineNo}: ${x.factors.slice(0,2).join('。')}`));
    const hot=state.analysis.list.filter(x=>x.streak.type==='minus'&&-x.streak.sum>=1500).slice(0,3); if(hot.length) items.push(`連続凹み監視: ${hot.map(x=>`${x.machineNo}(${signed(x.streak.sum)})`).join(' / ')}`);
    items.push('朝の実データが前日条件と大きく変わる場合は、事前順位を固定観念にしない。');
    $('watchPoints').innerHTML=items.map(x=>`<div class="watch">${esc(x)}</div>`).join('');
  }
  function renderAll(){ if(!state.analysis)return; $('targetTitle').textContent=`${state.analysis.targetDate}（${state.analysis.targetWd}）編集長予想`; renderKpis(); renderRanking(); renderTable(); renderWatch(); renderTrack(); }

  function backtest(){
    if(!state.records.length)return; const no=$('backtestMachine').value, cond=$('backtestCondition').value, groups=groupsByMachine(no==='ALL'?state.records:state.records.filter(r=>r.machineNo===no)); let ps=[];
    const normalFn={minus500:r=>r.diff<=-500,minus1000:r=>r.diff<=-1000,minus1500:r=>r.diff<=-1500,reg300:r=>r.games>=2000&&r.rb>0&&r.games/r.rb<=300,reg350:r=>r.games>=2000&&r.rb>0&&r.games/r.rb<=350,big250:r=>r.games>=2000&&r.bb>0&&r.games/r.bb<=250,both:r=>r.games>=2000&&r.bb>0&&r.rb>0&&r.games/r.bb<=250&&r.games/r.rb<=350,total130:r=>r.games>=2000&&(r.bb+r.rb)>0&&r.games/(r.bb+r.rb)<=130};
    if(cond.startsWith('run')){ const t=num(cond.replace('run','')); for(const rows of groups.values()) ps.push(...runCrossPairs(rows,t,'minus')); }
    else { for(const rows of groups.values()) ps.push(...pairs(rows).filter(z=>normalFn[cond](z.x))); }
    const s=nextStat(ps), vals=ps.map(z=>z.y.diff).sort((a,b)=>a-b), med=s.median;
    const recent=ps.slice(-8).reverse();
    $('backtestResult').innerHTML=`<div class="metric-row"><div class="metric-mini">件数<b>${s.n}</b></div><div class="metric-mini">翌日プラス<b>${pct(s.winRate)}</b></div><div class="metric-mini">平均差枚<b>${signed(s.avg)}</b></div><div class="metric-mini">中央値<b>${signed(med)}</b></div></div>${recent.length?`<div class="muted">直近例</div>${recent.map(z=>`<div>${esc(z.x.machineNo)} ${z.x.date} ${signed(z.x.diff)} → ${z.y.date} <span class="${z.y.diff>0?'pos-text':'neg-text'}">${signed(z.y.diff)}</span></div>`).join('')}`:'該当データなし'}`;
  }

  function predictionResults(){
    const by=new Map(state.records.map(r=>[`${r.date}|${r.machineNo}`,r])); return state.predictions.map(p=>{
      const rows=p.ranking.map(x=>({...x,actual:by.get(`${p.targetDate}|${x.machineNo}`)?.diff ?? null})); return {...p,rows};
    });
  }
  function autoScorePredictions(){ renderTrack(); }
  function renderTrack(){
    const all=predictionResults(), scored=all.filter(p=>p.rows.some(x=>x.actual!==null)); if(!scored.length){$('trackRecord').innerHTML='固定保存した予想を翌日のデータ取込後に自動採点します。';return;}
    const first=scored.flatMap(p=>p.rows.slice(0,1)).filter(x=>x.actual!==null), top3=scored.flatMap(p=>p.rows.slice(0,3)).filter(x=>x.actual!==null);
    const fwin=first.length?first.filter(x=>x.actual>0).length/first.length:0, twin=top3.length?top3.filter(x=>x.actual>0).length/top3.length:0, avg=top3.length?top3.reduce((s,x)=>s+x.actual,0)/top3.length:0;
    const recent=scored.slice(-5).reverse(); $('trackRecord').innerHTML=`<div class="metric-row"><div class="metric-mini">1位プラス率<b>${pct(fwin)}</b></div><div class="metric-mini">TOP3プラス率<b>${pct(twin)}</b></div><div class="metric-mini">TOP3平均<b>${signed(avg)}</b></div><div class="metric-mini">採点日<b>${scored.length}</b></div></div>${recent.map(p=>`<div>${p.targetDate}: ${p.rows.slice(0,3).map((x,i)=>`${i+1}位 ${x.machineNo} ${x.actual===null?'未確定':signed(x.actual)}`).join(' / ')}</div>`).join('')}`;
  }
  function savePrediction(){
    if(!state.analysis){toast('先に予想を生成してください');return;} const target=state.analysis.targetDate;
    if(state.predictions.some(p=>p.targetDate===target)){toast('この日の予想はすでに固定保存済みです');return;}
    const ranking=state.analysis.list.map((x,i)=>({rank:i+1,machineNo:x.machineNo,machine:x.machine,score:+x.score.toFixed(2),view:x.view}));
    state.predictions.push({targetDate:target,sourceLatestDate:state.analysis.latestDate,generatedAt:new Date().toISOString(),ranking}); localStorage.setItem(LS_PRED,JSON.stringify(state.predictions)); renderTrack(); toast('予想を固定保存しました');
  }
  function exportHistory(){
    const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),predictions:state.predictions},null,2)],{type:'application/json'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='history.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function noteDraft(){
    if(!state.analysis){toast('先に編集長予想を生成してください');return;} const a=state.analysis, n=clamp(num($('paidCount').value)||3,1,a.list.length), top=a.list.slice(0,n), top3=a.list.slice(0,3);
    const modelCounts={}; state.records.filter(r=>r.date===a.latestDate).forEach(r=>modelCounts[r.machine]=(modelCounts[r.machine]||0)+1); const mainModel=Object.entries(modelCounts).sort((x,y)=>y[1]-x[1])[0]?.[0]||'';
    $('noteTitle').value=`${a.targetDate.replaceAll('-','/')} データ分析｜過去${fmt.format(a.recordCount)}件から見る本日の注目台`;
    $('noteFree').value=[
      `${a.targetDate.replaceAll('-','/')}（${a.targetWd}）のデータ分析です。`,
      '',
      `今回は過去${fmt.format(a.recordCount)}件・${a.machineCount}台分の履歴を使い、曜日、直近5/7/10/30日、BIG・REG・合算、前日差枚、連続凹み・連続上昇、現在に近い過去パターンを横断して比較しました。`,
      '',
      `単純に「前日出た／凹んだ」だけではなく、同じ台で過去に似た状態になった翌日の成績と、サンプル数の少なさも補正して順位を作っています。`,
      '',
      `本日の上位${Math.min(3,top3.length)}台はスコア差が${top3.length>=2?(top3[0].score-top3[1].score).toFixed(1):'—'}点。${mainModel?`対象には${mainModel}を含む複数機種があります。`:''}`,
      '',
      `ここから先では、具体的な台番号、編集長スコア、プラス材料・マイナス材料、過去の同条件の翌日成績まで掲載します。`,
      '',
      `※過去データを使った統計上の参考分析です。将来の結果や利益を保証するものではありません。`
    ].join('\n');
    const paid=[]; paid.push(`本日の編集長ランキング TOP${n}`,'');
    top.forEach((x,i)=>{
      paid.push(`${i+1}位　${x.machineNo}　${x.machine}`,`編集長スコア：${x.score.toFixed(1)} / 100　評価：${x.view}`,
        `前日：${fmt.format(x.latest.games)}G / ${signed(x.latest.diff)}枚 / BIG ${prob(x.latest.games,x.latest.bb)} / REG ${prob(x.latest.games,x.latest.rb)}`,
        `直近7日：平均${signed(x.r7.avg)}枚・プラス率${pct(x.r7.winRate)}`,
        `曜日条件：n=${x.wd.n}・プラス率${pct(x.wd.winRate)}・平均${signed(x.wd.avg)}枚`,
        `類似${x.sim.n}例：プラス率${pct(x.sim.winRate)}・平均${signed(x.sim.avg)}枚`,
        `見立て：${x.factors.slice(0,4).join('。')}。`);
      if(x.run) paid.push(`連続波条件：累計${x.streak.type==='minus'?'-':'+'}${fmt.format(x.run.threshold)}枚到達後 n=${x.run.n}・翌日プラス${pct(x.run.winRate)}・平均${signed(x.run.avg)}枚`);
      paid.push('');
    });
    paid.push('朝の確認ポイント','・事前順位は「前日まで」の情報。朝のREG・合算・回転の付き方が極端に悪い場合は固執しない。','・サンプル数が10件未満の条件は参考度を下げる。','・当日の最終結果は翌日に記録し、予想成績へ反映します。','','※本記事はデータ分析・娯楽目的の情報で、結果や利益を保証するものではありません。');
    $('notePaid').value=paid.join('\n');
    $('noteX').value=`${a.targetDate.replaceAll('-','/')} データ分析完了。\n過去${fmt.format(a.recordCount)}件から、曜日・REG/BIG・差枚・連続凹み・類似パターンまで再集計。\n今日は上位候補の根拠がそれぞれ違う日。具体的な台番号と過去条件は記事内にまとめました。\n※過去データに基づく参考分析です。`;
    toast('note原稿を生成しました');
  }

  function bind(){
    $('importBtn').onclick=()=>$('fileInput').click();
    $('fileInput').onchange=async e=>{ const f=e.target.files?.[0]; if(!f)return; const t=await f.text(), rows=parseAny(t); if(!rows.length){toast('読み取れるデータがありません');return;} mergeRecords(rows); runAnalysis(); e.target.value=''; };
    $('pasteBtn').onclick=()=>$('pasteModal').classList.remove('hidden'); $('closePaste').onclick=()=>$('pasteModal').classList.add('hidden');
    $('applyPaste').onclick=()=>{ const rows=parseAny($('pasteArea').value); if(!rows.length){toast('読み取れるデータがありません');return;} mergeRecords(rows); $('pasteModal').classList.add('hidden'); $('pasteArea').value=''; runAnalysis(); };
    $('runBtn').onclick=runAnalysis; $('savePredictionBtn').onclick=savePrediction; $('generateNoteBtn').onclick=noteDraft; $('backtestBtn').onclick=backtest; $('exportHistoryBtn').onclick=exportHistory;
    $('modelFilter').onchange=()=>{renderRanking();renderTable();}; $('machineSearch').oninput=()=>{renderRanking();renderTable();}; $('sortBy').onchange=()=>{renderRanking();renderTable();}; $('topN').onchange=renderRanking;
    document.querySelectorAll('.copy').forEach(b=>b.onclick=async()=>{ const el=$(b.dataset.copy); try{await navigator.clipboard.writeText(el.value);toast('コピーしました');}catch(_){el.select();document.execCommand('copy');toast('コピーしました');} });
    $('clearBtn').onclick=()=>{ if(!confirm('このブラウザに保存した取込データと予想履歴を消去しますか？'))return; localStorage.removeItem(LS_DATA);localStorage.removeItem(LS_PRED);state.records=[];state.predictions=[];state.analysis=null;location.reload(); };
  }

  async function init(){ loadLocal(); bind(); renderDataStatus(); populateFilters(); renderTrack(); await loadRepoData(); renderDataStatus(); populateFilters(); if(state.records.length) runAnalysis(); }
  init();
})();
