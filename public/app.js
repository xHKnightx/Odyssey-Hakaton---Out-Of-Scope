const $ = s => document.querySelector(s);
let data=null, googleState=null, oracleState=null, currentRun=null, activeFilter='All', period='q', toastTimer, activeUserId=Number(localStorage.getItem('pythia-demo-user'))||1;
let oracleMessages=[],wisdomDraft=null,wisdomText='';
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const solutionKindLabel = kind => String(kind||'').toLowerCase()==='skill'?'playbook / agent skill':String(kind||'');
async function api(path, options={}) {
  const response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) {
    const routeDetail=payload.method||payload.path?` Server received ${payload.method||'unknown method'} ${payload.path||'unknown path'}.`:` Client requested ${options.method||'GET'} ${path}.`;
    throw new Error(payload.error==='API route not found.'?`${payload.error}${routeDetail}`:(payload.error||`Request failed (${response.status})`));
  }
  return payload;
}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400)}
const BrowserSpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let activeRecognition=null,activeVoiceButton=null;
function renderComposerActions(){
  document.querySelectorAll('[data-composer-actions]').forEach(bar=>{
    const target=bar.dataset.composerActions,label=bar.dataset.submitLabel,title=bar.dataset.voiceTitle;
    bar.innerHTML=`<button class="voice-button" type="button" data-voice-target="${esc(target)}" aria-label="Start voice input" aria-pressed="false" title="${esc(title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3M9 21h6"/></svg></button><button class="button gold" type="submit">${esc(label)} <span>→</span></button>`;
  });
}
function renderReturnControls(){
  const states=['#seek-consult','#share-consult','#seek-results','#share-results'];
  for(const selector of states){
    const state=$(selector);if(!state)continue;
    const placement=state.querySelector('.seek-input-head')||state;
    let button=state.querySelector('[data-seek-home]');
    if(!button){button=document.createElement('button');button.type='button';button.dataset.seekHome=''}
    button.className='return-button';button.textContent='← Return';
    placement.prepend(button);
  }
  const sanctumReturn=$('#sanctum .back');
  if(sanctumReturn){sanctumReturn.className='return-button';sanctumReturn.textContent='← Return'}
}
function resetVoiceInput(){
  if(activeVoiceButton){
    activeVoiceButton.classList.remove('listening');
    activeVoiceButton.setAttribute('aria-pressed','false');
    activeVoiceButton.setAttribute('aria-label','Start voice input');
  }
  activeRecognition=null;activeVoiceButton=null;
}
function startVoiceInput(button){
  if(!BrowserSpeechRecognition){toast('Voice input is not supported in this browser. Try Chrome or type your message.');return}
  if(activeRecognition){activeRecognition.stop();if(activeVoiceButton===button)return}
  const input=$(`#${button.dataset.voiceTarget}`);if(!input)return;
  const base=input.value===input.defaultValue?'':input.value.trim();
  const recognition=new BrowserSpeechRecognition();
  recognition.continuous=true;recognition.interimResults=true;recognition.lang=navigator.language||'en-US';
  recognition.onstart=()=>{
    activeRecognition=recognition;activeVoiceButton=button;
    button.classList.add('listening');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','Stop voice input');
  };
  recognition.onresult=event=>{
    let transcript='';
    for(let i=0;i<event.results.length;i++)transcript+=event.results[i][0]?.transcript||'';
    input.value=[base,transcript.trim()].filter(Boolean).join(base?' ':'');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  };
  recognition.onerror=event=>{
    if(event.error==='not-allowed'||event.error==='service-not-allowed')toast('Microphone access was not allowed. Enable it for this site or type your message.');
    else if(event.error!=='aborted'&&event.error!=='no-speech')toast(`Voice input stopped: ${event.error}.`);
  };
  recognition.onend=()=>{if(activeRecognition===recognition)resetVoiceInput()};
  try{recognition.start()}catch(error){resetVoiceInput();toast('Voice input could not start. Try again or type your message.')}
}
function view(id){document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===id));document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='connections')loadGoogleStatus()}
function avatar(person,size=''){return `<span class="av ${size}" style="background:${esc(person.color||'#d4a855')}" title="${esc(person.name)}">${esc(person.initials||person.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</span>`}
function iconLaurel(){let leaves='';for(let i=0;i<9;i++){const d=255-i*15,a=d*Math.PI/180,r=i%2?52:46,x=60+r*Math.cos(a),y=60-r*Math.sin(a),rot=-d+90+(i%2?-28:28);leaves+=`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="8.5" ry="3.4" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`}return `<svg class="laurel-svg" viewBox="0 0 120 120" fill="currentColor"><g>${leaves}<path d="M47.6 106.4A49 49 0 0 1 22 22" fill="none" stroke="currentColor" stroke-width="1.6"/></g><g transform="translate(120 0) scale(-1 1)">${leaves}<path d="M47.6 106.4A49 49 0 0 1 22 22" fill="none" stroke="currentColor" stroke-width="1.6"/></g></svg>`}

function renderSolutions(){
  $('#solutions').innerHTML=data.solutions.map(s=>`<article class="card"><div class="kind">${esc(solutionKindLabel(s.kind))}${s.runnable?' · RUNNABLE':''}</div><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p><div class="card-foot"><span>By ${esc(s.owner)} · ~${s.minutes_saved} min saved</span>${s.runnable?`<button data-run="${s.id}">Try it →</button>`:''}</div></article>`).join('');
}
const expertiseKey=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('en');
const personExpertise=person=>String(person.skills||'').split(',').map(value=>value.normalize('NFKC').replace(/\s+/g,' ').trim()).filter(Boolean);
function renderDirectory(){
  const q=$('#people-search').value.trim().toLowerCase();
  const people=data.people.filter(p=>p.name!=='Anastasia');
  const expertiseByKey=new Map();
  for(const person of people)for(const area of personExpertise(person)){
    const key=expertiseKey(area),entry=expertiseByKey.get(key);
    if(entry)entry.count+=1;else expertiseByKey.set(key,{label:area,count:1});
  }
  const filters=['All',...[...expertiseByKey.values()].filter(item=>item.count>1).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,undefined,{sensitivity:'base'})).map(item=>item.label)];
  $('#people-filters').innerHTML=filters.map(f=>`<button class="fchip ${activeFilter===f?'on':''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('');
  const rows=people.filter(p=>{
    const matchesFilter=activeFilter==='All'||personExpertise(p).some(area=>expertiseKey(area)===expertiseKey(activeFilter));
    const haystack=`${p.name} ${p.title} ${p.team} ${p.location} ${p.skills}`.toLowerCase();
    return matchesFilter&&(!q||haystack.includes(q));
  });
  $('#people-result-count').textContent=`${rows.length} ${rows.length===1?'colleague':'colleagues'}${q?` matching “${$('#people-search').value.trim()}”`:''}`;
  $('#people-directory').innerHTML=rows.map(p=>`<button class="drow person-link" data-person="${p.id}" aria-label="View ${esc(p.name)}’s profile"><span class="person-summary">${avatar(p)}<span class="person-main"><b>${esc(p.name)}</b><small>${esc(p.title)} · ${esc(p.team)} · ${esc(p.location||'')}</small></span></span><span class="cover">${String(p.skills).split(',').map(s=>`<span class="chip">${esc(s.trim())}</span>`).join('')}</span></button>`).join('')||'<p class="empty-state">No one matches yet. Try a broader area of expertise.</p>';
}
function renderExpertise(){
  const me=data.people.find(p=>p.id===data.activeUserId)||data.people[0];
  const skills=data.mySkills||[],rank=gamificationLabel(me);
  $('#profile-card').innerHTML=`<div class="row">${avatar(me,'lg')}<div><h3>${esc(me.name)}</h3><div class="faint profile-role">${esc(me.team)} · ${esc(me.location||'')}</div><div class="profile-laurels">${esc(rank)} · ${Number(me.points||0).toLocaleString()} laurels</div></div></div><div class="stack skill-group"><div class="eyebrow">Areas of expertise</div>${skills.map((s,i)=>`<div class="skill"><span class="grow">${esc(s)}</span><span class="lvl">${[1,2,3,4,5].map(n=>`<i class="${n<=[4,3,3][i%3]?'f':''}"></i>`).join('')}</span></div>`).join('')}</div><div class="stack skill-group"><div class="eyebrow">Suggested by PYTHIA</div>${[['Customer research','14 interviews in “Mobile onboarding 2026”'],['Hackathon facilitation','Organised T1A hackathon']].map(([name,note])=>`<div class="suggested"><div class="row"><span class="grow">${esc(name)}</span><button class="btn ghost" data-confirm-skill="${esc(name)}">Confirm</button></div><small>${esc(note)}</small></div>`).join('')}</div>`;
  renderDirectory();
}
function gamificationLabel(person){const labels=['Pilgrim','Acolyte','Scholar','Sage','Elder','Oracle'];return person.level||labels[0]}
function renderPantheon(){
  const fmt=n=>Math.round(Number(n)||0).toLocaleString('en-US');
  const periodName={m:'this month',q:'this quarter',y:'all time'}[period]||'this period';
  const peopleByName=new Map(data.people.map(p=>[p.name,p]));
  const entries=data.pantheon||[];
  const podiumPlaces=[{person:entries[1],rank:2},{person:entries[0],rank:1},{person:entries[2],rank:3}].filter(place=>place.person);
  const medals={1:'#e3c06b',2:'#c9ccd2',3:'#c98a5a'},roman={1:'I',2:'II',3:'III'};
  $('#pantheon-podium').innerHTML=podiumPlaces.map(({person:h,rank})=>{const p=peopleByName.get(h.name),medal=medals[rank];return `<article class="pod pod-${rank}"><div class="wreath" style="color:${medal}">${iconLaurel()}${avatar(p,'xl')}</div><div class="pod-rank" style="color:${medal}">${roman[rank]}</div><div class="pod-name">${esc(h.name)}</div><div class="pod-title">${esc(h.title)}</div><div class="pod-stats"><span><b>${fmt(h.points)}</b>laurels</span><span><b>${fmt(h.helped)}</b>helped</span><span><b>${fmt(h.hours)}</b>hours saved</span><span><b>${h.shared}</b>shared</span></div><p class="pod-deed">${esc(h.deed||'')}</p><div class="pod-base"></div></article>`}).join('');
  $('#heroes').innerHTML=entries.slice(3).map(h=>{const p=peopleByName.get(h.name);return `<div class="frow"><span class="pan-r">${romanRank(h.rank)}</span>${avatar(p)}<span class="grow"><span class="frow-t">${esc(h.name)} <span class="faint rank-title">· ${esc(h.title)}</span></span><span class="frow-d"><b>${fmt(h.points)} laurels ${periodName}</b> · ${fmt(h.helped)} colleagues helped · ${fmt(h.hours)} hours saved · ${h.shared} shared</span></span><button class="btn ghost" data-thank-user="${p?.id||''}">Thank</button></div>`}).join('');
  const me=data.myStanding, meProfile=data.people.find(p=>p.id===data.activeUserId);
  const nextText=me.nextLevel?`${fmt(me.pointsToNext)} more laurels to reach ${esc(me.nextLevel)}.`:'You have reached the highest Path of the Sage level.';
  $('#my-standing').innerHTML=`<div class="eyebrow">Your standing</div><div class="row">${avatar(meProfile,'lg')}<div class="grow"><div class="standing-name">${esc(me.rank)} · ${esc(meProfile.name)}</div><div class="faint">${esc(me.level)} · ${fmt(me.points)} laurels</div></div></div><div class="prog"><i style="width:${me.progress}%"></i></div><p class="standing-copy">${nextText} ${esc(me.nudge)}</p><button class="btn primary" data-action="share">Share wisdom</button>`;
  $('#gratitude').innerHTML=`<div class="eyebrow">Recent gratitude</div>${data.gratitude.map(g=>`<div class="gratitude-row">${avatar({name:g.from_name,initials:g.from_initials,color:g.from_color})}<div class="grow"><b>${esc(g.from_name.split(' ')[0])}</b> <span class="faint">thanked</span> <b>${esc(g.to_name.split(' ')[0])}</b><div class="gratitude-note">${esc(g.note)}</div></div></div>`).join('')}`;
  document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('on',b.dataset.period===period));
}
function romanRank(value){let number=Number(value)||1,output='';for(const [n,symbol] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(number>=n){output+=symbol;number-=n}return output||'I'}
function render(){if(!data)return;activeUserId=data.activeUserId;renderSolutions();renderExpertise();renderPantheon();const groups={};data.requests.forEach(r=>{const text=r.text.toLowerCase(),k=text.includes('calendar')?'Calendar overload':text.includes('contract')||text.includes('invoice')?'Invoice ↔ contract checks':text.includes('salesforce')?'Call notes into CRM':text.includes('databricks')?'Databricks access requests':'Jira feedback digest';(groups[k]??=[]).push(r)});$('#discoveries-list').innerHTML=Object.entries(groups).map(([title,rs])=>`<article class="discovery"><div><h3>${esc(title)}</h3><p>${rs.map(r=>esc(r.text)).join(' · ')}</p></div><span class="count">${rs.length} related ${rs.length===1?'request':'requests'} · ${rs.length>1?'Opportunity':'Emerging'}</span></article>`).join('')}
async function load(){data=await api(`/api/overview?userId=${activeUserId}&period=${period}`);render();}
async function loadGoogleStatus(){
  const status=$('#google-status'),actions=$('#google-actions');if(!status||!actions)return;
  try{googleState=await api('/api/google/status');
    if(googleState.connected){status.innerHTML=`<div class="connected-mark">✓</div><div><b>Google account connected</b><small>${esc(googleState.email)} · Calendar and Gmail</small></div>`;actions.innerHTML='<button class="btn" id="disconnect-google">Disconnect Google</button>';}
    else if(googleState.configured){status.innerHTML='<div class="unconnected-mark">◌</div><div><b>Google is ready to connect</b><small>Consent will request Calendar event access and Gmail read-only access.</small></div>';actions.innerHTML='<a class="btn primary" href="/auth/google">Connect Google</a>';}
    else{status.innerHTML='<div class="unconnected-mark">◌</div><div><b>OAuth client credentials needed</b><small>Follow the one-time steps below, then restart the local server.</small></div>';actions.innerHTML='<code>cp .env.example .env</code>';}
  }catch(error){status.textContent=error.message;}
}

async function loadOracleStatus(){
  try{
    oracleState=await api('/api/oracle/status');
  }catch(error){oracleState={configured:false};}
}

function showSeekState(name){
  if(activeRecognition)activeRecognition.stop();
  const states=['seek-home','seek-consult','seek-results','share-consult','share-results'];
  const active=name.includes('-')?name:`seek-${name}`;
  for(const state of states)$(`#${state}`).hidden=state!==active;
  document.querySelector('main>.notice').hidden=name!=='home';
  if(active==='seek-consult')setTimeout(()=>$('#question').focus({preventScroll:true}),0);
  if(active==='share-consult')setTimeout(()=>$('#share-text').focus({preventScroll:true}),0);
  // State changes can dramatically shorten the page. Reset the previous
  // result-page scroll position after layout settles so the next screen does
  // not open with its header clipped.
  requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
}

function renderWisdomReview(waiting=false,saved=null){
  const target=$('#share-answer');showSeekState('share-results');
  if(waiting){
    target.innerHTML=`<details class="oracle-request"><summary><span>YOU SHARED</span><q>${esc(wisdomText)}</q><b>⌄</b></summary><p>${esc(wisdomText)}</p></details><div class="oracle-thinking wisdom-thinking"><div class="oracle-thinking-mark"><span></span></div><div><div class="eyebrow">PYTHIA IS READING YOUR OFFERING</div><h1>Finding what others can reuse.</h1></div><ul><li class="done">Reading what you shared</li><li class="active">Extracting areas of expertise and experience</li><li>Identifying reusable assets</li><li>Checking the wisdom catalogue</li></ul></div>`;
    return;
  }
  if(saved){
    const parts=[];
    if(saved.saved.skills)parts.push(`${saved.saved.skills} area${saved.saved.skills===1?'':'s'} of expertise added to your profile.`);
    if(saved.saved.experience)parts.push(`${saved.saved.experience} experience item${saved.saved.experience===1?'':'s'} added to your profile.`);
    if(saved.saved.solutions)parts.push(`${saved.saved.solutions} reusable asset${saved.saved.solutions===1?'':'s'} published in the catalogue.`);
    if(saved.duplicates?.length)parts.push(`${saved.duplicates.length} existing catalogue item${saved.duplicates.length===1?' was':'s were'} not duplicated.`);
    target.innerHTML=`<section class="oracle-card wisdom-success"><div class="oracle-card-head"><div class="oracle-emblem">✓</div><div class="eyebrow">YOUR WISDOM IS SHARED</div></div><h1>Thank you. It is now part of the Oracle.</h1><ul class="oracle-why">${parts.map(item=>`<li>${esc(item)}</li>`).join('')}<li>People can now find it through Seek Wisdom and Expertise.</li></ul><div class="oracle-primary-actions"><button class="button gold" type="button" data-view="expertise">See your profile →</button><button class="button" type="button" data-share-new>Share more wisdom</button></div></section>`;
    return;
  }
  const x=wisdomDraft,skills=x.skills.map((skill,index)=>`<label class="share-review-item share-skill-row"><input class="share-include" type="checkbox" checked><input data-share-skill="${index}" value="${esc(skill)}" maxlength="60" aria-label="Area of expertise"></label>`).join('');
  const experience=x.experience.map((item,index)=>`<label class="share-review-item"><input class="share-include" type="checkbox" checked><span class="grow"><input class="share-inline strong" data-share-experience-title="${index}" value="${esc(item.title)}" maxlength="160"><textarea class="share-inline" data-share-experience-details="${index}" rows="2" maxlength="400">${esc(item.details)}</textarea></span></label>`).join('');
  const solutions=x.solutions.map((item,index)=>`<label class="share-review-item share-solution"><input class="share-include" type="checkbox" checked><span class="grow"><span class="share-solution-head"><input class="share-inline strong" data-share-solution-title="${index}" value="${esc(item.title)}" maxlength="120"><select data-share-solution-kind="${index}">${['skill','agent','automation','guide','tool','knowledge'].map(kind=>`<option value="${kind}" ${kind===item.kind?'selected':''}>${esc(solutionKindLabel(kind))}</option>`).join('')}</select></span><textarea class="share-inline" data-share-solution-summary="${index}" rows="3" maxlength="800">${esc(item.summary)}</textarea>${item.evidence?`<small class="share-evidence">Based on: “${esc(item.evidence)}”</small>`:''}</span></label>`).join('');
  target.innerHTML=`<details class="oracle-request"><summary><span>YOU SHARED</span><q>${esc(wisdomText)}</q><b>⌄</b></summary><div><p>${esc(wisdomText)}</p><button class="seek-back" type="button" data-share-edit>Edit</button></div></details><section class="oracle-card wisdom-discovered"><div class="oracle-card-head"><div class="oracle-emblem">♢</div><div class="eyebrow">PYTHIA DISCOVERED${x.mode==='llm'?'':' · LOCAL FALLBACK'}</div></div><h1>${esc(x.headline)}</h1><p class="oracle-answer">${esc(x.summary)}</p></section><div class="share-review-head"><div><h2>Review before saving</h2><p>Remove or correct anything Pythia got wrong.</p></div></div><form id="share-review-form" class="share-review">${skills?`<section><div class="share-section-head"><span>AREAS OF EXPERTISE</span><b>${x.skills.length}</b></div>${skills}</section>`:''}${experience?`<section><div class="share-section-head"><span>EXPERIENCE</span><b>${x.experience.length}</b></div>${experience}</section>`:''}${solutions?`<section><div class="share-section-head"><span>REUSABLE ASSETS</span><b>${x.solutions.length}</b></div>${solutions}</section>`:''}<div class="share-confirm"><ul class="oracle-why"><li>Areas of expertise and experience update your Expertise profile.</li><li>Reusable assets become searchable in the wisdom catalogue.</li><li>Your original message stays in the local contribution history.</li></ul><button class="button gold" type="submit">Save &amp; share →</button></div></form>`;
}

function oracleVerdict(result){
  const rec=result.recommendation||{};
  if(rec.type==='solution'&&result.solution)return result.solution.runnable?'This already exists. Use it today.':'Start with what already works.';
  if(rec.type==='person'&&result.people?.length)return `Talk to ${result.people[0].name}.`;
  if(rec.type==='build')return 'Build it, but don’t start from zero.';
  return 'Here is the clearest way forward.';
}

function oracleRecommendation(result){
  const rec=result.recommendation||{};
  if(rec.type==='solution'&&result.solution){
    const solution=result.solution;
    return `<article class="oracle-preview"><div class="oracle-preview-icon">◇</div><div class="grow"><div class="kind">${esc(solutionKindLabel(solution.kind))}${solution.runnable?' · RUNNABLE':''}</div><h3>${esc(solution.title)}</h3><p>${esc(solution.summary)}</p></div><div class="oracle-match"><b>${Math.round(rec.confidence||0)}%</b><span>match</span></div></article><div class="oracle-primary-actions">${solution.runnable?`<button class="button gold" data-run="${solution.id}" data-request="${result.requestId}">Run ${esc(solution.title)} →</button>`:''}<button class="button" data-view="expertise">Explore expertise</button></div>`;
  }
  if(rec.type==='person'&&result.people?.length){
    return `<div class="oracle-people">${result.people.map(person=>`<button class="oracle-person" data-person="${person.id}">${avatar(person,'lg')}<span><b>${esc(person.name)}</b><small>${esc(person.title)} · ${esc(person.team)}</small><em>${esc(person.skills)}</em></span><span class="oracle-person-go">›</span></button>`).join('')}</div><div class="oracle-primary-actions"><button class="button gold" data-person="${result.people[0].id}">Ask ${esc(result.people[0].name.split(' ')[0])} for help →</button><button class="button" data-view="expertise">See all expertise</button></div>`;
  }
  if(rec.type==='build'){
    const steps=(rec.instructions||[]).map(step=>`<li>${esc(step)}</li>`).join('');
    return `<article class="oracle-preview build-preview"><div class="oracle-preview-icon">⬡</div><div class="grow"><div class="kind">NEW ${/agent/i.test(rec.title||'')?'AGENT':'PLAYBOOK / AGENT SKILL'}</div><h3>${esc(rec.title||'New PYTHIA playbook')}</h3><p>Turn this request into a reusable asset for the next colleague.</p></div></article>${steps?`<ol class="oracle-build-steps">${steps}</ol>`:''}<div class="oracle-primary-actions"><button class="button gold" data-action="share">Build it with Pythia →</button><button class="button" data-view="expertise">Find a reviewer</button></div>`;
  }
  return '';
}

function oracleWhy(result){
  const rec=result.recommendation||{},retrieval=result.retrieval||{},items=[];
  if(rec.reason)items.push(rec.reason);
  if(retrieval.solutionCandidates)items.push(`${retrieval.solutionCandidates} relevant solution candidate${retrieval.solutionCandidates===1?' was':'s were'} checked.`);
  if(retrieval.peopleCandidates)items.push(`${retrieval.peopleCandidates} expertise candidate${retrieval.peopleCandidates===1?' was':'s were'} compared locally.`);
  if(rec.confidence)items.push(`Recommendation confidence: ${Math.round(rec.confidence)}%.`);
  return items.slice(0,3).map(item=>`<li>${esc(item)}</li>`).join('');
}

function oracleFound(result){
  const rec=result.recommendation||{},retrieval=result.retrieval||{};
  return `<section class="oracle-found"><div class="oracle-found-head"><h2>What Pythia found</h2><span>Other paths, if the advice doesn’t fit</span></div><div class="found"><button class="frow" data-toast="Pythia ranked the closest catalogue matches for this request."><span class="frow-ic">◇</span><span class="grow"><span class="frow-t">Relevant solutions <b>${retrieval.solutionCandidates||0}</b></span><span class="frow-d">Ranked by semantic similarity and exact search</span></span><span class="frow-go">›</span></button><button class="frow" data-view="expertise"><span class="frow-ic">◎</span><span class="grow"><span class="frow-t">People who can help <b>${retrieval.peopleCandidates||result.people?.length||0}</b></span><span class="frow-d">Areas of expertise, role, team, and experience were compared</span></span><span class="frow-go">›</span></button>${rec.type==='build'?'<button class="frow" data-action="share"><span class="frow-ic">⬡</span><span class="grow"><span class="frow-t">Build something new</span><span class="frow-d">Save the proposed playbook or agent as an offering</span></span><span class="frow-go">›</span></button>':''}</div></section>`;
}

function renderOracleConversation(waiting=false){
  const thread=$('#answer'),question=[...oracleMessages].reverse().find(message=>message.role==='user')?.content||'';
  showSeekState('results');
  if(waiting){
    thread.innerHTML=`<details class="oracle-request"><summary><span>YOUR REQUEST</span><q>${esc(question)}</q><b>⌄</b></summary><p>${esc(question)}</p></details><div class="oracle-thinking"><div class="oracle-thinking-mark"><span></span></div><div><div class="eyebrow">PYTHIA IS CONSULTING THE ORACLE</div><h1>Looking for the strongest path.</h1></div><ul><li class="done">Understanding your question</li><li class="active">Searching solutions and agents</li><li>Consulting the expertise directory</li><li>Preparing a grounded recommendation</li></ul></div>`;
    return;
  }
  const message=[...oracleMessages].reverse().find(item=>item.role==='assistant'),result=message?.result;
  if(!result){thread.innerHTML=`<button class="seek-back" type="button" data-seek-followup>← Try again</button><section class="oracle-card error"><div class="oracle-card-head"><div class="oracle-emblem">!</div><div class="eyebrow">THE ORACLE COULD NOT ANSWER</div></div><h1>Let’s try that once more.</h1><p class="oracle-answer">${esc(message?.content||'Something went wrong.')}</p></section>`;return;}
  thread.innerHTML=`<details class="oracle-request"><summary><span>YOUR REQUEST</span><q>${esc(question)}</q><b>⌄</b></summary><div><p>${esc(question)}</p><button class="seek-back" type="button" data-change-request>Edit request</button></div></details><section class="oracle-card"><div class="oracle-card-head"><div class="oracle-emblem">♜</div><div class="eyebrow">THE ORACLE HAS SPOKEN</div></div><h1>${esc(oracleVerdict(result))}</h1><p class="oracle-answer">${esc(result.answer).replace(/\n/g,'<br>')}</p>${oracleRecommendation(result)}<ul class="oracle-why">${oracleWhy(result)}</ul></section>${oracleFound(result)}<div class="oracle-followup"><div><div class="eyebrow">KEEP THE CONVERSATION GOING</div><p>Pythia remembers this request and the recommendation.</p></div><button class="button gold" type="button" data-seek-followup>Ask a follow-up →</button><button class="button" type="button" data-seek-home>New request</button></div>`;
}

function personDetail(id){
  const p=data.people.find(x=>x.id===Number(id));if(!p)return;
  const experience=p.experience?`<div class="detail-section"><div class="eyebrow">PROJECT / EXPERIENCE</div><p class="profile-experience">${esc(p.experience)}</p></div>`:'<div class="detail-section"><div class="eyebrow">PROJECT / EXPERIENCE</div><p class="profile-experience muted">No experience example has been added to this profile yet.</p></div>';
  $('#person-dialog-content').innerHTML=`<button class="close" type="button" data-close-person aria-label="Close">×</button><div class="profile-detail-head">${avatar(p,'xl')}<div><div class="eyebrow">EXPERTISE PROFILE</div><h2>${esc(p.name)}</h2><p>${esc(p.title)}</p><small>${esc(p.team)} · ${esc(p.location||'')}</small></div></div><div class="detail-section"><div class="eyebrow">AREAS OF EXPERTISE</div><p class="profile-detail-copy">Explore this colleague’s demonstrated expertise. Select an area to find others with similar expertise.</p><div class="detail-skills">${String(p.skills).split(',').map(s=>`<button type="button" class="chip skill-filter" data-skill="${esc(s.trim())}">${esc(s.trim())}</button>`).join('')}</div></div>${experience}<div class="availability"><b>Availability</b><span>${esc(p.availability||'Availability not listed')}</span></div><button class="btn primary" data-ask-person="${p.id}">Ask for help</button>`;
  $('#person-dialog').showModal();
}

function askPerson(id){
  const p=data.people.find(x=>x.id===Number(id));if(!p)return;
  $('#ask-person-title').textContent=`Ask ${p.name}`;
  $('#ask-person-context').textContent=`${p.title} · ${p.team} · ${p.availability||p.location||'Colleague'}`;
  $('#ask-person-message').value=`Hi ${p.name.split(' ')[0]}, I found your profile in PYTHIA and noticed your experience with ${String(p.skills).split(',').slice(0,2).map(s=>s.trim()).join(' and ')}. Would you be open to a short conversation?`;
  $('#ask-person-dialog').dataset.personName=p.name;
  $('#person-dialog').close();$('#ask-person-dialog').showModal();
}

async function connectStatusFromQuery(){const params=new URLSearchParams(location.search);if(params.get('google')==='connected')toast('Google account connected');if(params.has('google_error'))toast(`Google connection failed: ${params.get('google_error')}`);if(params.has('connect'))toast('Add Google OAuth credentials to .env, then restart the server');if(params.size){history.replaceState({},'',location.pathname+location.hash)}}

async function run(id,requestId){
  try{
    toast('Calendar Breather is checking your week…');
    const r=await api('/api/run',{method:'POST',body:JSON.stringify({solutionId:Number(id),requestId:Number(requestId)||null,userId:activeUserId,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
    currentRun=r.id;const result=r.result;await load();
    const eventCards=(result.events||[]).map(ev=>`<article class="meeting-card"><div class="meeting-top"><div><div class="meeting-time">${new Date(ev.start.dateTime).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:result.timeZone})} · ${ev.durationMinutes} min</div><h3>${esc(ev.title)}</h3></div><span class="strain strain-${ev.strain>=7?'high':ev.strain>=5?'mid':'low'}">Strain ${ev.strain}/10</span></div><div class="meeting-meta"><span class="tone tone-${ev.sentiment.toLowerCase()}">${esc(ev.sentiment)} tone</span><span>${ev.attendees?.length||0} attendees</span><span>${ev.emailCount||0} related emails</span></div><p class="meeting-reason">${esc(ev.reason)}</p>${ev.emailContext?.length?`<details class="email-context"><summary>Gmail context (${ev.emailContext.length})</summary>${ev.emailContext.map(m=>`<div class="email-snippet"><b>${esc(m.subject)}</b><small>${esc(m.from)} · ${esc(m.sentiment)} tone</small><p>${esc(m.snippet)}</p></div>`).join('')}</details>`:''}</article>`).join('');
    const proposalHtml=result.proposals?.length?result.proposals.map(p=>`<label class="proposal"><input type="checkbox" value="${p.id||esc(p.key)}" ${r.live?'checked disabled':''}><span><b>${esc(p.label)}</b><small>${esc(p.reason)}</small></span></label>`).join(''):'<p class="empty-state">No open 20-minute gaps were found between your meetings.</p>';
    const writePanel=r.live&&result.proposals?.length?`<div class="calendar-write"><div class="eyebrow">REVIEW BEFORE WRITING</div><p>Selected breaks will be added to your primary Google Calendar. They will be organized by your connected Google account.</p><label class="invite-label">Optional invitees <input id="invitees" placeholder="colleague@company.com, another@company.com"><small>Google sends invitations to these people when you confirm.</small></label><button class="btn primary" id="add-selected-breaks">Add selected breaks to my calendar</button></div>`:r.live?'':'<div class="demo-callout">This is seeded mockup data. Connect Google in Connections to analyze your calendar and Gmail. Demo suggestions are not written to any calendar.</div>';
    $('#run-title').textContent=r.solution.title;
    $('#run-result').innerHTML=`<div class="run-result"><div class="eyebrow">${r.live?'LIVE GOOGLE DATA':'SEEDED DEMO DATA'} · ${esc(result.timeZone||'')}${r.award?.points?` · +${r.award.points} LAURELS TO THE AUTHOR`:''}</div><h2>Your week, with room to breathe</h2><div class="analysis-stats"><div><b>${result.meetingCount}</b><small>meetings</small></div><div><b>${result.emailCount}</b><small>email snippets</small></div><div><b>${result.strainedMeetings}</b><small>strained meetings</small></div><div><b>${result.proposals.length}</b><small>break proposals</small></div></div><div class="trace">${result.steps.map((s,i)=>`<div class="run-step"><span class="check">${i+1}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p></div></div>`).join('')}</div><div class="eyebrow meeting-heading">MEETING ANALYSIS</div>${eventCards||'<p class="empty-state">No meetings were found in the selected range.</p>'}<div class="eyebrow meeting-heading">PROPOSED RECOVERY BREAKS</div><div class="proposal-list">${proposalHtml}</div>${writePanel}<p class="analysis-disclaimer">Sentiment uses a local phrase-based estimate on Gmail subject/snippet text. Message bodies are not fetched or retained.</p></div>`;
    view('sanctum');
  }catch(error){toast(error.message)}
}

async function sendFeedback(button){if(!currentRun)return;try{await api(`/api/runs/${currentRun}/feedback`,{method:'POST',body:JSON.stringify({feedback:button.dataset.feedback,thanks:$('#thanks-note').value})});document.querySelectorAll('[data-feedback]').forEach(x=>x.disabled=true);toast(button.dataset.feedback==='helped'?'Feedback saved · author received laurels':'Feedback saved');await load()}catch(error){toast(error.message)}}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]');if(nav){view(nav.dataset.view);return}
  if(event.target.closest('#create-profile')){$('#create-profile-dialog').showModal();return}
  const person=event.target.closest('[data-person]');if(person){personDetail(person.dataset.person);return}
  if(event.target.closest('[data-close-person]')){$('#person-dialog').close();return}
  const skill=event.target.closest('[data-skill]');if(skill){$('#person-dialog').close();activeFilter='All';$('#people-search').value=skill.dataset.skill;renderDirectory();$('#people-search').focus();return}
  const ask=event.target.closest('[data-ask-person]');if(ask){askPerson(ask.dataset.askPerson);return}
  const filter=event.target.closest('[data-filter]');if(filter){activeFilter=filter.dataset.filter;renderDirectory();return}
  const periodButton=event.target.closest('[data-period]');if(periodButton){period=periodButton.dataset.period;await load();return}
  const thanks=event.target.closest('[data-thank-user]');if(thanks){const targetId=Number(thanks.dataset.thankUser);if(!targetId)return;thanks.disabled=true;try{const result=await api('/api/thanks',{method:'POST',body:JSON.stringify({userId:activeUserId,targetId})});await load();toast(result.award.points?`Thank-you sent · +1 Laurel · colleague received +5`:(result.message||'Thank-you recorded'))}catch(error){thanks.disabled=false;toast(error.message)}return}
  const confirmSkill=event.target.closest('[data-confirm-skill]');if(confirmSkill){const skillName=confirmSkill.dataset.confirmSkill;confirmSkill.disabled=true;try{const result=await api('/api/skills/confirm',{method:'POST',body:JSON.stringify({userId:activeUserId,skill:skillName})});await load();toast(result.award.points?`${skillName} confirmed · +1 Laurel`:`${skillName} is already on the profile`)}catch(error){confirmSkill.disabled=false;toast(error.message)}return}
  if(event.target.closest('#seek-choice')){showSeekState('consult');return}
  if(event.target.closest('[data-seek-home]')){oracleMessages=[];wisdomDraft=null;wisdomText='';$('#question').value='';$('#share-text').value='';$('#question').placeholder='e.g. I spend two days every month matching supplier invoices to contracts…';$('#seek-question-title').textContent='What do you seek?';showSeekState('home');return}
  if(event.target.closest('[data-seek-followup]')){$('#seek-question-title').textContent='What else would you like to know?';$('#question').placeholder='Ask a follow-up about this recommendation…';showSeekState('consult');return}
  if(event.target.closest('[data-change-request]')){const previous=[...oracleMessages].reverse().find(message=>message.role==='user')?.content||'';oracleMessages=[];$('#seek-question-title').textContent='What do you seek?';$('#question').value=previous;showSeekState('consult');return}
  const sample=event.target.closest('[data-seek-sample]');if(sample){$('#question').value=sample.dataset.seekSample;$('#question').focus();return}
  if(event.target.closest('[data-action="share"]')){wisdomDraft=null;wisdomText='';$('#share-text').value='';showSeekState('share-consult');return}
  const shareSample=event.target.closest('[data-share-sample]');if(shareSample){$('#share-text').value=shareSample.dataset.shareSample;$('#share-text').focus();return}
  if(event.target.closest('[data-share-edit]')){$('#share-text').value=wisdomText;showSeekState('share-consult');return}
  if(event.target.closest('[data-share-new]')){wisdomDraft=null;wisdomText='';$('#share-text').value='';showSeekState('share-consult');return}
  const runner=event.target.closest('[data-run]');if(runner){run(runner.dataset.run,runner.dataset.request);return}
  const feedback=event.target.closest('[data-feedback]');if(feedback){sendFeedback(feedback);return}
  const disc=event.target.closest('#disconnect-google');if(disc){try{await api('/api/google/disconnect',{method:'POST',body:'{}'});await loadGoogleStatus();toast('Google disconnected')}catch(error){toast(error.message)}return}
  const add=event.target.closest('#add-selected-breaks');if(add){
    const proposalIds=[...document.querySelectorAll('.proposal input:checked:not(:disabled)')].map(i=>Number(i.value)).filter(Number.isFinite);
    if(!proposalIds.length){toast('Select at least one proposed break');return}
    const attendees=($('#invitees').value||'').split(',').map(x=>x.trim()).filter(Boolean);
    add.disabled=true;add.textContent='Adding to Google Calendar…';
    try{const result=await api('/api/calendar/invites',{method:'POST',body:JSON.stringify({runId:currentRun,proposalIds,attendees})});add.textContent='Added to calendar';toast(`${result.created.length} break${result.created.length===1?'':'s'} added${result.invitees?` · ${result.invitees} invitees emailed`:''}`)}catch(error){add.disabled=false;add.textContent='Add selected breaks to my calendar';toast(error.message)}return;
  }
  const notice=event.target.closest('[data-toast]');if(notice)toast(notice.dataset.toast);
});

$('#people-search').addEventListener('input',renderDirectory);
renderComposerActions();
renderReturnControls();
document.querySelectorAll('[data-voice-target]').forEach(button=>{
  if(!BrowserSpeechRecognition){button.disabled=true;button.title='Voice input is not supported in this browser';button.setAttribute('aria-label','Voice input is not supported')}
  button.addEventListener('click',()=>startVoiceInput(button));
});
$('#question').addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.repeat)return;
  event.preventDefault();
  const form=event.currentTarget.form,button=form?.querySelector('button[type="submit"]');
  if(form&&button&&!button.disabled)form.requestSubmit(button);
});
$('#seek-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]'),input=$('#question'),text=input.value.trim();if(!text)return;
  oracleMessages.push({role:'user',content:text});input.value='';button.disabled=true;button.textContent='Consulting…';renderOracleConversation(true);
  try{
    const result=await api('/api/oracle/chat',{method:'POST',body:JSON.stringify({messages:oracleMessages.map(({role,content})=>({role,content})),userId:activeUserId})});
    oracleMessages.push({role:'assistant',content:result.answer,result});renderOracleConversation();await load();
    if(result.fallbackReason)toast(`LLM unavailable · using local matching: ${result.fallbackReason}`);
    else if(result.mode==='local')toast('Oracle is using local matching. Add LLM settings in .env for live chat.');
    input.placeholder='Ask a follow-up question…';
  }catch(error){oracleMessages.push({role:'assistant',content:`I could not complete that request: ${error.message}`});renderOracleConversation();toast(error.message)}
  finally{button.disabled=false;button.innerHTML='Ask <span>→</span>'}
});
$('#share-analyze-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),text=$('#share-text').value.trim();if(!text)return;
  wisdomText=text;button.disabled=true;button.textContent='Reading…';renderWisdomReview(true);
  try{
    wisdomDraft=await api('/api/share/analyze',{method:'POST',body:JSON.stringify({text,userId:activeUserId})});
    renderWisdomReview();
    if(wisdomDraft.fallbackReason)toast(`LLM unavailable · using local extraction: ${wisdomDraft.fallbackReason}`);
    else if(wisdomDraft.mode==='local')toast('Pythia is using local extraction. Add LLM settings for richer analysis.');
  }catch(error){showSeekState('share-consult');toast(error.message)}
  finally{button.disabled=false;button.innerHTML='Share <span>→</span>'}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='share-review-form')return;
  event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]');
  const skills=[...form.querySelectorAll('.share-skill-row')].filter(row=>row.querySelector('.share-include').checked).map(row=>row.querySelector('[data-share-skill]').value.trim()).filter(Boolean);
  const experience=[...form.querySelectorAll('[data-share-experience-title]')].filter(input=>input.closest('.share-review-item').querySelector('.share-include').checked).map(input=>({title:input.value.trim(),details:form.querySelector(`[data-share-experience-details="${input.dataset.shareExperienceTitle}"]`).value.trim()})).filter(item=>item.title);
  const solutions=[...form.querySelectorAll('[data-share-solution-title]')].filter(input=>input.closest('.share-review-item').querySelector('.share-include').checked).map(input=>{const index=input.dataset.shareSolutionTitle,source=wisdomDraft.solutions[Number(index)]||{};return {title:input.value.trim(),kind:form.querySelector(`[data-share-solution-kind="${index}"]`).value,summary:form.querySelector(`[data-share-solution-summary="${index}"]`).value.trim(),evidence:source.evidence,runnable:source.runnable,minutesSaved:source.minutesSaved}}).filter(item=>item.title&&item.summary);
  if(!skills.length&&!experience.length&&!solutions.length){toast('Select at least one thing to save.');return}
  button.disabled=true;button.textContent='Saving…';
  try{
    const result=await api('/api/share',{method:'POST',body:JSON.stringify({text:wisdomText,userId:activeUserId,analysis:{headline:wisdomDraft.headline,summary:wisdomDraft.summary,skills,experience,solutions}})});
    await load();renderWisdomReview(false,result);
    toast(result.award.points?`Your offering was saved · +${result.award.points} laurels`:`Your offering was saved · ${result.award.reason==='weekly_cap'?'weekly reward cap reached':'duplicate offering earned no laurels'}`);
  }catch(error){button.disabled=false;button.textContent='Save & share →';toast(error.message)}
});
document.querySelectorAll('[data-close-ask]').forEach(button=>button.addEventListener('click',()=>$('#ask-person-dialog').close()));
$('#ask-person-form').addEventListener('submit',event=>{event.preventDefault();const name=$('#ask-person-dialog').dataset.personName;$('#ask-person-dialog').close();toast(`Message prepared for ${name}. Connect a messaging service to send it.`)});
document.querySelectorAll('[data-close-profile]').forEach(button=>button.addEventListener('click',()=>$('#create-profile-dialog').close()));
$('#create-profile-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),values=new FormData(form);button.disabled=true;button.textContent='Saving…';
  try{
    const result=await api('/api/people',{method:'POST',body:JSON.stringify({name:values.get('name'),title:values.get('title'),team:values.get('team'),location:values.get('location'),availability:values.get('availability'),skills:values.get('skills'),experience:values.get('experience')})});
    $('#create-profile-dialog').close();form.reset();activeUserId=result.person.id;localStorage.setItem('pythia-demo-user',String(activeUserId));await load();activeFilter='All';$('#people-search').value=result.person.name;renderDirectory();toast(`${result.person.name}’s profile was saved · starts at 0 laurels`);
  }catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Save profile'}
});

load().then(()=>{loadGoogleStatus();loadOracleStatus();connectStatusFromQuery()}).catch(error=>toast(error.message));
