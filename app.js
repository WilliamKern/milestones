import {todayISO,eventStatus,eventSpan,readableParts,dateLabel,timeSinceLabel,progress,daysBetween,parseDate} from './date-utils.js';
import {CloudSync} from './sync.js';
const KEY='milestones_data_v1';
const CATEGORIES={work:['Work','💼'],housing:['Housing','🏡'],education:['Education','🎓'],relationships:['Relationships','❤️'],hobbies:['Hobbies','🎨'],travel:['Travel','✈️'],other:['Other','✨']};
const COLORS={teal:['#4b9b9b','#e7f5f4'],blue:['#6591bc','#eaf1f9'],sage:['#8ba77a','#eff4e8'],violet:['#a089c8','#f2ecfb'],peach:['#d99875','#fcf0ea'],gold:['#d7ab58','#f9f1dc']};
const DEFAULT_PREFS={view:'cards',sort:'manual',duration:'calendar',theme:'system',showCompletedHome:true,showDates:false};
let state=load(), tab='home', filter='all', search='', cloud=new CloudSync(), cloudMessage='',cloudBusy=false, syncTimer=null,lastDay=todayISO(),toastTimeout=null;
const $=(sel,root=document)=>root.querySelector(sel);
const esc=(text='')=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function uuid(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
const icon=(name)=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const activeEvents=()=>state.events.filter(e=>!e.deletedAt);
function load(){try {const v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&Array.isArray(v.events))return {events:v.events,prefs:{...DEFAULT_PREFS,...v.prefs}};}catch{}return {events:[],prefs:{...DEFAULT_PREFS}};}
function save(){localStorage.setItem(KEY,JSON.stringify(state));}
function timestamp(){return Math.max(Date.now(),...state.events.map(e=>Number(e.updatedAt||0)+1),0);}
function persist(sync=true){save();if(sync)scheduleSync();}
function setPref(k,v){state.prefs[k]=v;persist(false);applyTheme();render();}
function applyTheme(){const theme=state.prefs.theme;document.documentElement.dataset.theme=theme==='system'?'':theme;}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3500);}
function navigate(next){tab=next;filter='all';search='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));render();window.scrollTo({top:0,behavior:'instant'});}
function eventColor(e){return COLORS[e.color]||COLORS.teal;}
function catName(e){return (CATEGORIES[e.category]||CATEGORIES.other)[0];}
function eventEmoji(e){return e.emoji||(CATEGORIES[e.category]||CATEGORIES.other)[1];}
function sorted(entries){
  const sort=state.prefs.sort;
  return [...entries].sort((a,b)=>{
    if(!!a.pinned!==!!b.pinned)return a.pinned?-1:1;
    if(sort==='recent')return (b.startDate||'').localeCompare(a.startDate||'')||a.order-b.order;
    if(sort==='oldest')return (a.startDate||'').localeCompare(b.startDate||'')||a.order-b.order;
    if(sort==='category')return catName(a).localeCompare(catName(b))||a.order-b.order;
    if(sort==='status') {const ranks={ongoing:0,upcoming:1,completed:2};return ranks[eventStatus(a)]-ranks[eventStatus(b)]||a.order-b.order;}
    return (a.order??0)-(b.order??0)||(a.createdAt||0)-(b.createdAt||0);
  });
}
function durationText(e){try{return readableParts(eventSpan(e),state.prefs.duration)}catch{return 'Check dates'}}
function card(e,index,list){
 const status=eventStatus(e), c=eventColor(e), duration=durationText(e);
 const label=status==='upcoming'?'Starts in':status==='completed'?'Time recorded':'Time so far';
 const dateText=e.endDate?`${dateLabel(e.startDate)} – ${dateLabel(e.endDate)}`:`Since ${dateLabel(e.startDate)}`;
 const showArrows=state.prefs.sort==='manual';
 const sameGroup=list.filter(x=>!!x.pinned===!!e.pinned),pos=sameGroup.findIndex(x=>x.id===e.id);
 return `<article class="milestone-card" style="--card-color:${c[0]};--card-tint:${c[1]}">
  <div class="card-top"><div class="card-icon" aria-hidden="true">${esc(eventEmoji(e))}</div><div class="card-meta"><h3 class="card-title">${esc(e.title)}</h3><div class="card-category">${esc(catName(e))}${state.prefs.showDates?' · '+esc(dateText):''}</div></div>
  <button class="card-pin ${e.pinned?'pinned':''}" data-action="pin" data-id="${esc(e.id)}" aria-label="${e.pinned?'Unpin':'Pin'} ${esc(e.title)}" title="${e.pinned?'Unpin':'Pin'}">${icon('pin')}</button></div>
  <button class="card-read" data-action="detail" data-id="${esc(e.id)}"><span class="card-label">${label}</span><span class="duration">${esc(duration)}</span></button>
  <div class="card-bottom"><div class="card-status-info"><span class="status ${status}">${status==='ongoing'?'Ongoing':status==='upcoming'?'Upcoming':'Past'}</span>${status==='completed'?`<span class="elapsed-since">${esc(timeSinceLabel(e,todayISO(),state.prefs.duration))}</span>`:''}</div><div class="card-actions">
  ${showArrows?`<button class="subtle-button" data-action="up" data-id="${esc(e.id)}" aria-label="Move ${esc(e.title)} up" ${pos===0?'disabled':''}>${icon('chevron-up')}</button><button class="subtle-button" data-action="down" data-id="${esc(e.id)}" aria-label="Move ${esc(e.title)} down" ${pos===sameGroup.length-1?'disabled':''}>${icon('chevron-down')}</button>`:''}
  <button class="subtle-button" data-action="edit" data-id="${esc(e.id)}" aria-label="Edit ${esc(e.title)}">${icon('pencil')}</button></div></div>
 </article>`;
}
function section(items){const list=sorted(items);if(!list.length)return '';return `<div class="card-grid">${list.map((e,i)=>card(e,i,list)).join('')}</div>`;}
function matching(entries){return entries.filter(e=>(filter==='all'||e.category===filter) && (!search||`${e.title} ${e.note||''} ${catName(e)}`.toLowerCase().includes(search.toLowerCase())));}
function emptyHTML(){
 const isSearch=search||filter!=='all';
 return `<div class="empty"><div class="empty-icon">${icon('sparkle')}</div><h2>${isSearch?'Nothing matches yet':'Every chapter counts.'}</h2><p>${isSearch?'Try another search or category.':'Track your career, homes, hobbies, travels, and everything worth remembering.'}</p>${!isSearch?`<button class="primary-button" data-action="add">Add your first entry</button>`:''}</div>`;
}
function chipsHTML(){return `<div class="chips" role="group" aria-label="Category filter"><button data-filter="all" class="chip ${filter==='all'?'selected':''}">All</button>${Object.entries(CATEGORIES).map(([id,[name,emoji]])=>`<button data-filter="${id}" class="chip ${filter===id?'selected':''}">${emoji} ${name}</button>`).join('')}</div>`;}
function home(){const collection=activeEvents();const list=matching(collection);
 return `<p class="eyebrow">YOUR PERSONAL TIMELINE</p><h1 class="hero-title">Your time, all together.</h1><p class="hero-caption">The things ahead, the chapters you're in, and the time you've spent.</p>
 <div class="controls"><div class="search-wrap">${icon('search')}<input id="searchInput" type="search" aria-label="Search entries" value="${esc(search)}" placeholder="Search your entries..."></div><select id="durationSelect" class="small-select" aria-label="Duration format"><option value="calendar" ${state.prefs.duration==='calendar'?'selected':''}>Years · months · days</option><option value="months" ${state.prefs.duration==='months'?'selected':''}>Total months</option><option value="weeks" ${state.prefs.duration==='weeks'?'selected':''}>Weeks + days</option><option value="days" ${state.prefs.duration==='days'?'selected':''}>Total days</option></select></div>
 ${chipsHTML()}
 <section id="cardsRegion">${cardRegion(list)}</section>`;
}
function cardRegion(list){return list.length?`<div class="section-head"><h2>All entries</h2><span>${list.length} ${list.length===1?'entry':'entries'}</span></div>${section(list)}`:emptyHTML();}
function options(map,sel){return Object.entries(map).map(([val,label])=>`<option value="${val}" ${sel===val?'selected':''}>${label}</option>`).join('');}
function settings(){let cloudStatus=cloud.ready?`<span class="success-text">Signed in as ${esc(cloud.email)}</span>`:cloud.config?'Project configured, not signed in':'Not configured';
 return `<p class="eyebrow">YOUR SPACE</p><h1 class="hero-title hero-small">Make it yours.</h1><p class="hero-caption">Little choices that make Milestones feel like your app.</p>
 <h2 class="setting-section-title">Appearance & display</h2><div class="setting-card">
  <div class="setting-row"><div><label for="p-theme">Appearance</label><small>Follow iPhone theme or override it.</small></div><select id="p-theme" data-pref="theme">${options({system:'System',light:'Light',dark:'Dark'},state.prefs.theme)}</select></div>
  <div class="setting-row"><div><label for="p-duration">Time units</label><small>Change the default display any time.</small></div><select id="p-duration" data-pref="duration">${options({calendar:'Years / months / days',months:'Months + days',weeks:'Weeks + days',days:'Total days'},state.prefs.duration)}</select></div>
  <div class="setting-row"><div><label for="p-sort">Order</label><small>Manual includes up/down reorder controls.</small></div><select id="p-sort" data-pref="sort">${options({manual:'Custom order',recent:'Newest first',oldest:'Oldest first',category:'By category',status:'By status'},state.prefs.sort)}</select></div>
  <div class="setting-row"><div><label for="p-dates">Show dates on cards</label><small>Otherwise, see dates when you tap an entry.</small></div><input id="p-dates" type="checkbox" data-pref="showDates" ${state.prefs.showDates?'checked':''}></div>
 </div>
 <h2 class="setting-section-title">Data & backups</h2><div class="setting-card"><div class="cloud-panel"><p>Your entries are saved locally. Make occasional backups, especially before clearing Safari data or deleting the app.</p></div><div class="setting-actions"><button class="secondary-button" data-action="export">${icon('download')} Export backup</button><button class="secondary-button" data-action="import">${icon('upload')} Import backup</button></div></div>
 <div class="small-note" style="padding:8px 4px 0">Milestones v1.3 · Free and local to this device. No account required.<br>Entries may be lost if you clear website data or remove the installed app. You can export a copy under Data & backups.</div>`;
}
function render(){applyTheme();$('#app').innerHTML=tab==='settings'?settings():home();$('#addTop').style.visibility=tab==='settings'?'hidden':'visible';}
function showDialog(id){
 const dialog=document.getElementById(id);
 if(dialog.open)return;
 dialog.showModal();
 document.documentElement.classList.add('has-open-sheet');
 document.body.classList.add('has-open-sheet');
 // Start at the top when reusing the form, rather than reopening at an old scroll position.
 dialog.scrollTop=0;
}
function closeDialog(id){
 const dialog=document.getElementById(id);
 if(dialog.open)dialog.close();
}
// Also handle Escape and native dialog close operations without leaving the page locked.
for(const dialog of document.querySelectorAll('.sheet-dialog')){
 dialog.addEventListener('close',()=>{
  if(!document.querySelector('.sheet-dialog[open]')){
   document.documentElement.classList.remove('has-open-sheet');
   document.body.classList.remove('has-open-sheet');
  }
 });
}
function colorButtons(selected){$('#colorChoices').innerHTML=Object.entries(COLORS).map(([id,[hex]])=>`<button type="button" class="color-choice ${selected===id?'selected':''}" data-color="${id}" aria-label="${id} card color" title="${id}" style="--color:${hex}"></button>`).join('');}
function editEvent(id=null){
 const e=id?state.events.find(e=>e.id===id):null,form=$('#eventForm');form.reset();
 form.elements.id.value=e?.id||'';form.elements.title.value=e?.title||'';form.elements.startDate.value=e?.startDate||todayISO();form.elements.endDate.value=e?.endDate||'';
 form.elements.category.value=e?.category||'work';form.elements.emoji.value=e?.emoji||'';form.elements.color.value=e?.color||'teal';form.elements.afterBehavior.value=e?.afterBehavior||'countup';form.elements.note.value=e?.note||'';
 colorButtons(form.elements.color.value);$('#deleteEvent').hidden=!e;$('#eventDialogTitle').textContent=e?'Edit entry':'New entry';showDialog('eventDialog');
}
function detail(id){const e=state.events.find(x=>x.id===id&&!x.deletedAt);if(!e)return;const c=eventColor(e),status=eventStatus(e);
 $('#detailContent').innerHTML=`<div class="sheet-head"><span class="eyebrow" style="margin:0">YOUR MILESTONE</span><button class="icon-button" data-close="detailDialog" aria-label="Close">${icon('x')}</button></div>
 <div class="detail-heading"><div class="card-icon" style="background:${c[1]}">${esc(eventEmoji(e))}</div><div><h2>${esc(e.title)}</h2><span class="small-note">${esc(catName(e))}</span></div></div>
 <div class="card-label">${status==='upcoming'?'Starts in':status==='completed'?'Time recorded':'Time so far'}</div><div class="detail-duration">${esc(durationText(e))}</div>
 <dl class="detail-list"><div><dt>Status</dt><dd>${status==='upcoming'?'Upcoming':status==='completed'?'Past':'Ongoing'}</dd></div><div><dt>Start date</dt><dd>${dateLabel(e.startDate)}</dd></div>${e.endDate?`<div><dt>End date</dt><dd>${dateLabel(e.endDate)}</dd></div>`:''}${status==='completed'?`<div><dt>Time since ${e.endDate?'end':'event'}</dt><dd>${esc(timeSinceLabel(e,todayISO(),state.prefs.duration))}</dd></div>`:''}</dl>
 ${e.note?`<p class="detail-note">${esc(e.note)}</p>`:''}<div class="sheet-buttons"><button class="secondary-button" data-close="detailDialog">Close</button><button class="primary-button" data-action="edit-from-detail" data-id="${esc(e.id)}">${icon('pencil')} Edit</button></div>`;
 showDialog('detailDialog');
}
function syncStateMerge(merged){
 const byId=new Map(state.events.map(e=>[e.id,e]));for(const incoming of merged){const old=byId.get(incoming.id);if(!old||Number(incoming.updatedAt||0)>Number(old.updatedAt||0))byId.set(incoming.id,incoming);}
 state.events=[...byId.values()];persist(false);render();
}
async function runSync(silent=false){if(!cloud.ready||!navigator.onLine||cloudBusy)return;
 cloudBusy=true;cloudMessage='Syncing...';
 try{const result=await cloud.sync([...state.events],syncStateMerge);cloudMessage=`Synced ${new Date().toLocaleString()}. ${result?.uploaded||0} updates uploaded.`;if(!silent)toast('Cloud sync complete');}
 catch(err){cloudMessage=`Sync issue: ${err.message}. Your local entries are still saved.`;if(!silent)toast(cloudMessage);}
 finally{cloudBusy=false;if(tab==='settings')render();}
}
function scheduleSync(){clearTimeout(syncTimer);if(cloud.ready)syncTimer=setTimeout(()=>runSync(true),1300);}
function mutateEvent(id,mutator){const e=state.events.find(e=>e.id===id&&!e.deletedAt);if(!e)return;mutator(e);e.updatedAt=timestamp();persist();render();}
function move(id,dir){const all=sorted(activeEvents()),e=all.find(x=>x.id===id);if(!e)return;const group=all.filter(x=>!!x.pinned===!!e.pinned),idx=group.findIndex(x=>x.id===id),neighbor=group[idx+dir];if(!neighbor)return;
 // Swap only the affected pair so cloud sync can track both edits reliably.
 const old=e.order;e.order=neighbor.order;neighbor.order=old;e.updatedAt=timestamp();neighbor.updatedAt=timestamp();persist();render();
}
function exportBackup(){const payload={format:'milestones-backup',version:1,exportedAt:new Date().toISOString(),events:state.events,prefs:state.prefs};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`milestones-backup-${todayISO()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Backup saved. Keep this file somewhere safe.');}
async function importBackup(file){if(!file)return;try{const data=JSON.parse(await file.text());if(data.format!=='milestones-backup'||!Array.isArray(data.events))throw new Error('Not a Milestones backup file.');
 if(!confirm(`Import ${data.events.length} backed-up entries? Existing entries will be kept. When the same entry exists in both places, the newer edit wins.`))return;
 const byId=new Map(state.events.map(e=>[e.id,e]));let added=0;
 for(const e of data.events){if(!e||typeof e.id!=='string'||typeof e.title!=='string'||typeof e.startDate!=='string')continue;parseDate(e.startDate);if(e.endDate)parseDate(e.endDate);const local=byId.get(e.id);if(!local){byId.set(e.id,e);added++;}else if(Number(e.updatedAt||0)>Number(local.updatedAt||0))byId.set(e.id,e);}
 state.events=[...byId.values()];persist();render();toast(`Imported backup. ${added} new entries added.`);
 }catch(err){toast('Import failed: '+err.message)}finally{$('#importFile').value='';}}
// Global actions
$('#eventCategory').innerHTML=Object.entries(CATEGORIES).map(([id,[label,emoji]])=>`<option value="${id}">${emoji} ${label}</option>`).join('');
$('#eventForm').insertAdjacentHTML('beforeend','<input type="hidden" name="color" value="teal">');
$('#addTop').addEventListener('click',()=>editEvent());
document.addEventListener('click',async ev=>{
 const tabBtn=ev.target.closest('[data-tab]');if(tabBtn){navigate(tabBtn.dataset.tab);return;}
 const closer=ev.target.closest('[data-close]');if(closer){closeDialog(closer.dataset.close);return;}
 const col=ev.target.closest('[data-color]');if(col){$('#eventForm').elements.color.value=col.dataset.color;colorButtons(col.dataset.color);return;}
 const filt=ev.target.closest('[data-filter]');if(filt){filter=filt.dataset.filter;render();return;}
 const btn=ev.target.closest('[data-action]');if(!btn)return;const {action,id}=btn.dataset;
 if(action==='add')editEvent();
 if(action==='detail')detail(id);
 if(action==='edit')editEvent(id);
 if(action==='edit-from-detail'){closeDialog('detailDialog');editEvent(id);}
 if(action==='pin')mutateEvent(id,e=>e.pinned=!e.pinned);
 if(action==='up'||action==='down')move(id,action==='up'?-1:1);
 if(action==='export')exportBackup();
 if(action==='import')$('#importFile').click();
 if(action==='sync')await runSync();
 if(action==='signout'){cloud.signOut();cloudMessage='Signed out; your milestones remain on this device.';render();}
});
$('#eventForm').addEventListener('submit',ev=>{
 ev.preventDefault();const f=ev.currentTarget, id=f.elements.id.value, title=f.elements.title.value.trim(),startDate=f.elements.startDate.value,endDate=f.elements.endDate.value||null;
 if(!title){toast('Enter a name.');return;}
 try{parseDate(startDate);if(endDate){parseDate(endDate);if(endDate<startDate)throw new Error('End date must not precede start date.');}}catch(err){toast(err.message);return;}
 const old=state.events.find(e=>e.id===id),now=timestamp();
 const data={id:old?.id||uuid(),title,startDate,endDate,category:f.elements.category.value,emoji:f.elements.emoji.value.trim(),color:f.elements.color.value,afterBehavior:f.elements.afterBehavior.value,note:f.elements.note.value.trim(),pinned:old?.pinned||false,order:old?.order??(Math.max(-10,...activeEvents().map(e=>Number(e.order)||0))+10),createdAt:old?.createdAt||now,updatedAt:now,deletedAt:null};
 if(old)Object.assign(old,data);else state.events.push(data);
 persist();closeDialog('eventDialog');render();toast(old?'Entry updated':'Entry created');
});
$('#deleteEvent').addEventListener('click',()=>{const id=$('#eventForm').elements.id.value;const e=state.events.find(x=>x.id===id);if(!e||!confirm(`Delete “${e.title}” from this device?`))return;e.deletedAt=Date.now();e.updatedAt=timestamp();persist();closeDialog('eventDialog');render();toast('Entry deleted');});
$('#importFile').addEventListener('change',ev=>importBackup(ev.target.files[0]));
$('#app').addEventListener('input',ev=>{
 if(ev.target.id==='searchInput'){search=ev.target.value;const collection=activeEvents();$('#cardsRegion').innerHTML=cardRegion(matching(collection));}
});
$('#app').addEventListener('change',ev=>{
 const el=ev.target;if(el.dataset.pref){setPref(el.dataset.pref,el.type==='checkbox'?el.checked:el.value);return;}
 if(el.id==='durationSelect'){setPref('duration',el.value);}
});
$('#app').addEventListener('submit',async ev=>{
 if(ev.target.id==='cloudConfig'){
 ev.preventDefault();const data=new FormData(ev.target);try{cloud.setConfig(data.get('url'),data.get('key'));cloudMessage='Project saved. Create an account or sign in.';render();toast('Cloud project saved');}catch(err){toast(err.message);}
 }else if(ev.target.id==='cloudAuth'){
 ev.preventDefault();const form=ev.target,data=new FormData(form),email=String(data.get('email')).trim(),password=String(data.get('password'));const type=ev.submitter?.dataset.auth||'login';
 try{if(type==='register'){const result=await cloud.signUp(email,password);cloudMessage=cloud.ready?'Account created and signed in.':'Account created. Check your email to confirm, then sign in.';}else{await cloud.signIn(email,password);cloudMessage='Signed in. Downloading and merging your cloud milestones...';}render();toast(cloudMessage);if(cloud.ready)await runSync();}catch(err){toast(err.message);}
 }
});
window.addEventListener('online',()=>{if(cloud.ready)runSync(true)});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(lastDay!==todayISO()){lastDay=todayISO();render();}if(cloud.ready)runSync(true);}});
setInterval(()=>{if(lastDay!==todayISO()){lastDay=todayISO();render();}},60000);
if('serviceWorker' in navigator&&location.protocol==='https:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
applyTheme();render();if(cloud.ready && navigator.onLine)setTimeout(()=>runSync(true),500);
