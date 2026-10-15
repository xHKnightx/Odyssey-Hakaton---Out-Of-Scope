const $ = s => document.querySelector(s);
let data=null, googleState=null, currentRun=null, activeFilter='All', period='q', toastTimer, activeUserId=Number(localStorage.getItem('pythia-demo-user'))||1;
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
function view(id){document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===id));document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='connections')loadGoogleStatus()}
function avatar(person,size=''){return `<span class="av ${size}" style="background:${esc(person.color||'#d4a855')}" title="${esc(person.name)}">${esc(person.initials||person.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</span>`}
function iconLaurel(){let leaves='';for(let i=0;i<9;i++){const d=255-i*15,a=d*Math.PI/180,r=i%2?52:46,x=60+r*Math.cos(a),y=60-r*Math.sin(a),rot=-d+90+(i%2?-28:28);leaves+=`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="8.5" ry="3.4" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`}return `<svg class="laurel-svg" viewBox="0 0 120 120" fill="currentColor"><g>${leaves}<path d="M47.6 106.4A49 49 0 0 1 22 22" fill="none" stroke="currentColor" stroke-width="1.6"/></g><g transform="translate(120 0) scale(-1 1)">${leaves}<path d="M47.6 106.4A49 49 0 0 1 22 22" fill="none" stroke="currentColor" stroke-width="1.6"/></g></svg>`}

function renderSolutions(){
  $('#solutions').innerHTML=data.solutions.map(s=>`<article class="card"><div class="kind">${esc(s.kind)}${s.runnable?' · RUNNABLE':''}</div><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p><div class="card-foot"><span>By ${esc(s.owner)} · ~${s.minutes_saved} min saved</span>${s.runnable?`<button data-run="${s.id}">Try it →</button>`:''}</div></article>`).join('');
}
function expertiseGroup(person){
  if(/finance/i.test(person.team)) return 'Finance';
  if(/data|risk/i.test(person.team)) return 'Data';
  if(/platform/i.test(person.team)) return 'Platform';
  if(/sales|crm|customer success/i.test(person.team)) return 'Sales';
  if(/legal/i.test(person.team)) return 'Legal';
  if(/security/i.test(person.team)) return 'Security';
  if(/cloud|infrastructure/i.test(person.team)) return 'Cloud & Infrastructure';
  if(/enterprise apps/i.test(person.team)) return 'Enterprise Apps';
  if(/product|mobile|payments/i.test(person.team)) return 'Product';
  if(/workplace/i.test(person.team)) return 'Digital Workplace';
  if(/transformation/i.test(person.team)) return 'Transformation';
  return person.team;
}
function renderDirectory(){
  const q=$('#people-search').value.trim().toLowerCase();
  const people=data.people.filter(p=>p.name!=='Anastasia');
  const baseFilters=['Finance','Data','Platform','Sales','Legal','Security','Cloud & Infrastructure','Enterprise Apps','Product','Digital Workplace','Transformation'];
  const filters=['All',...new Set([...baseFilters,...people.map(p=>p.team).filter(Boolean)])];
  $('#people-filters').innerHTML=filters.map(f=>`<button class="fchip ${activeFilter===f?'on':''}" data-filter="${esc(f)}">${esc(f)}</button>`).join('');
  const rows=people.filter(p=>{
    const matchesFilter=activeFilter==='All'||expertiseGroup(p)===activeFilter||p.team===activeFilter;
    const haystack=`${p.name} ${p.title} ${p.team} ${p.location} ${p.skills}`.toLowerCase();
    return matchesFilter&&(!q||haystack.includes(q));
  });
  $('#people-result-count').textContent=`${rows.length} ${rows.length===1?'colleague':'colleagues'}${q?` matching “${$('#people-search').value.trim()}”`:''}`;
  $('#people-directory').innerHTML=rows.map(p=>`<button class="drow person-link" data-person="${p.id}" aria-label="View ${esc(p.name)}’s profile"><span class="person-summary">${avatar(p)}<span class="person-main"><b>${esc(p.name)}</b><small>${esc(p.title)} · ${esc(p.team)} · ${esc(p.location||'')}</small></span></span><span class="cover">${String(p.skills).split(',').map(s=>`<span class="chip">${esc(s.trim())}</span>`).join('')}</span><span class="frow-go" aria-hidden="true">›</span></button>`).join('')||'<p class="empty-state">No one matches yet. Try a broader skill.</p>';
}
function renderExpertise(){
  const me=data.people.find(p=>p.id===data.activeUserId)||data.people[0];
  const skills=data.mySkills||[],rank=gamificationLabel(me);
  $('#profile-card').innerHTML=`<div class="row">${avatar(me,'lg')}<div><h3>${esc(me.name)}</h3><div class="faint profile-role">${esc(me.team)} · ${esc(me.location||'')}</div><div class="profile-laurels">${esc(rank)} · ${Number(me.points||0).toLocaleString()} laurels</div></div></div><div class="stack skill-group"><div class="eyebrow">Your skills</div>${skills.map((s,i)=>`<div class="skill"><span class="grow">${esc(s)}</span><span class="lvl">${[1,2,3,4,5].map(n=>`<i class="${n<=[4,3,3][i%3]?'f':''}"></i>`).join('')}</span></div>`).join('')}</div><div class="stack skill-group"><div class="eyebrow">Suggested by PYTHIA</div>${[['Customer research','14 interviews in “Mobile onboarding 2026”'],['Hackathon facilitation','Organised T1A hackathon']].map(([name,note])=>`<div class="suggested"><div class="row"><span class="grow">${esc(name)}</span><button class="btn ghost" data-confirm-skill="${esc(name)}">Confirm</button></div><small>${esc(note)}</small></div>`).join('')}</div>`;
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
function renderActiveUser(){const select=$('#active-user');if(!select)return;select.innerHTML=data.people.map(p=>`<option value="${p.id}">${esc(p.name)} · ${Number(p.points||0).toLocaleString()} laurels</option>`).join('');select.value=String(data.activeUserId);}
function render(){if(!data)return;activeUserId=data.activeUserId;renderActiveUser();renderSolutions();renderExpertise();renderPantheon();const groups={};data.requests.forEach(r=>{const text=r.text.toLowerCase(),k=text.includes('calendar')?'Calendar overload':text.includes('contract')||text.includes('invoice')?'Invoice ↔ contract checks':text.includes('salesforce')?'Call notes into CRM':text.includes('databricks')?'Databricks access requests':'Jira feedback digest';(groups[k]??=[]).push(r)});$('#discoveries-list').innerHTML=Object.entries(groups).map(([title,rs])=>`<article class="discovery"><div><h3>${esc(title)}</h3><p>${rs.map(r=>esc(r.text)).join(' · ')}</p></div><span class="count">${rs.length} related ${rs.length===1?'request':'requests'} · ${rs.length>1?'Opportunity':'Emerging'}</span></article>`).join('')}
async function load(){data=await api(`/api/overview?userId=${activeUserId}&period=${period}`);render();}
async function loadGoogleStatus(){
  const status=$('#google-status'),actions=$('#google-actions');if(!status||!actions)return;
  try{googleState=await api('/api/google/status');
    if(googleState.connected){status.innerHTML=`<div class="connected-mark">✓</div><div><b>Google account connected</b><small>${esc(googleState.email)} · Calendar and Gmail</small></div>`;actions.innerHTML='<button class="btn" id="disconnect-google">Disconnect Google</button>';}
    else if(googleState.configured){status.innerHTML='<div class="unconnected-mark">◌</div><div><b>Google is ready to connect</b><small>Consent will request Calendar event access and Gmail read-only access.</small></div>';actions.innerHTML='<a class="btn primary" href="/auth/google">Connect Google</a>';}
    else{status.innerHTML='<div class="unconnected-mark">◌</div><div><b>OAuth client credentials needed</b><small>Follow the one-time steps below, then restart the local server.</small></div>';actions.innerHTML='<code>cp .env.example .env</code>';}
  }catch(error){status.textContent=error.message;}
}

function personDetail(id){
  const p=data.people.find(x=>x.id===Number(id));if(!p)return;
  const experience=p.experience?`<div class="detail-section"><div class="eyebrow">PROJECT / EXPERIENCE</div><p class="profile-experience">${esc(p.experience)}</p></div>`:'<div class="detail-section"><div class="eyebrow">PROJECT / EXPERIENCE</div><p class="profile-experience muted">No experience example has been added to this profile yet.</p></div>';
  $('#person-dialog-content').innerHTML=`<button class="close" type="button" data-close-person aria-label="Close">×</button><div class="profile-detail-head">${avatar(p,'xl')}<div><div class="eyebrow">EXPERTISE PROFILE</div><h2>${esc(p.name)}</h2><p>${esc(p.title)}</p><small>${esc(p.team)} · ${esc(p.location||'')}</small></div></div><div class="detail-section"><div class="eyebrow">SKILLS & EXPERIENCE</div><p class="profile-detail-copy">Explore this colleague’s demonstrated skills. Select one to find others with the same expertise.</p><div class="detail-skills">${String(p.skills).split(',').map(s=>`<button type="button" class="chip skill-filter" data-skill="${esc(s.trim())}">${esc(s.trim())}</button>`).join('')}</div></div>${experience}<div class="availability"><b>Availability</b><span>${esc(p.availability||'Availability not listed')}</span></div><button class="btn primary" data-ask-person="${p.id}">Ask for help</button>`;
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
  if(event.target.closest('#seek-choice')){$('#seek-form').hidden=false;$('#seek-form').scrollIntoView({behavior:'smooth',block:'center'});$('#question').focus({preventScroll:true});return}
  if(event.target.closest('[data-action="share"]')){$('#share-dialog').showModal();return}
  if(event.target.closest('#share-dialog .close')){$('#share-dialog').close();return}
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
$('#seek-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button'),text=$('#question').value;button.disabled=true;button.textContent='Consulting…';
  try{const result=await api('/api/seek',{method:'POST',body:JSON.stringify({text,userId:activeUserId})}),s=result.solution;$('#answer').hidden=false;$('#answer').innerHTML=`<div class="eyebrow">THE ORACLE HAS FOUND A PATH</div><span class="match">${result.match}% RELEVANCE · ${result.recommendation.toUpperCase()}${result.award?.points?` · +${result.award.points} LAURELS`:''}</span><h2>${esc(s.title)}</h2><p>${esc(s.summary)}</p><p class="people-hint">Created by ${esc(s.owner)}. The catalogue contains matching colleagues and related know-how.</p><div class="answer-actions">${s.runnable?`<button class="button gold" data-run="${s.id}" data-request="${result.requestId}">Run it on my week →</button>`:''}<button class="button" data-view="expertise">Explore expertise</button></div>`;$('#answer').scrollIntoView({behavior:'smooth',block:'center'});await load()}catch(error){toast(error.message)}finally{button.disabled=false;button.innerHTML='Ask the Oracle <span>→</span>'}
});
$('#share-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const result=await api('/api/share',{method:'POST',body:JSON.stringify({title:form.get('title'),body:form.get('body'),userId:activeUserId})});$('#share-dialog').close();event.currentTarget.reset();await load();toast(result.award.points?`Your offering was saved · +${result.award.points} laurels`:`Your offering was saved · ${result.award.reason==='weekly_cap'?'weekly reward cap reached':'duplicate offering earned no laurels'}`)}catch(error){toast(error.message)}});
$('#share-dialog .close').addEventListener('click',()=>$('#share-dialog').close());
document.querySelectorAll('[data-close-ask]').forEach(button=>button.addEventListener('click',()=>$('#ask-person-dialog').close()));
$('#ask-person-form').addEventListener('submit',event=>{event.preventDefault();const name=$('#ask-person-dialog').dataset.personName;$('#ask-person-dialog').close();toast(`Message prepared for ${name}. Connect a messaging service to send it.`)});
document.querySelectorAll('[data-close-profile]').forEach(button=>button.addEventListener('click',()=>$('#create-profile-dialog').close()));
$('#active-user').addEventListener('change',async event=>{activeUserId=Number(event.currentTarget.value)||1;localStorage.setItem('pythia-demo-user',String(activeUserId));await load();toast(`Now acting as ${data.people.find(p=>p.id===activeUserId)?.name||'demo user'}`)});
$('#create-profile-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),values=new FormData(form);button.disabled=true;button.textContent='Saving…';
  try{
    const result=await api('/api/people',{method:'POST',body:JSON.stringify({name:values.get('name'),title:values.get('title'),team:values.get('team'),location:values.get('location'),availability:values.get('availability'),skills:values.get('skills'),experience:values.get('experience')})});
    $('#create-profile-dialog').close();form.reset();activeUserId=result.person.id;localStorage.setItem('pythia-demo-user',String(activeUserId));await load();activeFilter='All';$('#people-search').value=result.person.name;renderDirectory();toast(`${result.person.name}’s profile was saved · starts at 0 laurels`);
  }catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Save profile'}
});

load().then(()=>{loadGoogleStatus();connectStatusFromQuery()}).catch(error=>toast(error.message));
