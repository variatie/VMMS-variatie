
(() => {
'use strict';
const VMMS_BUILD='4.1.0-drive-fotoarchief-20260718';
const STORAGE_KEY='vmms_variatie_data_v1';
const DRIVE_ENABLED_KEY='vmms_drive_enabled_v1';
const DRIVE_FILE_ID_KEY='vmms_drive_file_id_v1';
const DRIVE_DIRTY_KEY='vmms_drive_dirty_v1';
const DRIVE_LAST_SYNC_KEY='vmms_drive_last_sync_v1';
const DRIVE_CONFIG=window.VMMS_DRIVE_CONFIG||{};
const DRIVE_API='https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API='https://www.googleapis.com/upload/drive/v3';
const WEATHER_CACHE_KEY='vmms_weather_cache_v1';
const WEATHER_CACHE_MS=30*60*1000;
const SECURITY_SESSION_KEY='vmms_security_unlocked_v1';
const SECURITY_PIN_HASH='f8f97fdcf31377cdd1364be67d0e56e378902392acc5f667ce880757ef5299b3';
const SECURITY_PIN_SALT='vmms-variatie-2026:';
const SECURITY_IDLE_MS=15*60*1000;
const SECURITY_MAX_ATTEMPTS=5;
const SECURITY_BLOCK_MS=30*1000;
const THEME_KEY='vmms_theme_v1';
const VRM_TOKEN_KEY='vmms_vrm_token_v1';
const VRM_SITE_KEY='vmms_vrm_site_v1';
const DRIVE_BACKUP_DATE_KEY='vmms_drive_backup_date_v1';
const LOCAL_BACKUPS_KEY='vmms_local_backups_v1';
const LOCAL_BACKUP_LIMIT=8;
const NOTIFY_PREF_KEY='vmms_notify_pref_v1';
const LAST_SUMMARY_NOTIFY_KEY='vmms_last_summary_notify_v1';
const DRIVE_PHOTO_CACHE=new Map();
const LIBRARY_PHOTO_CACHE=new Map();
let libraryPhotoObserver=null;
const titles={dashboard:'Vandaag',ship:'Scheepsgegevens',workorder:'Nieuwe werkbon',objects:'Objecten',objectdetail:'Object',maintenance:'Onderhoud',inspections:'Inspecties',paintplan:'Verfplan',ballast:'Ballastplanner',logbook:'Logboek',projects:'Projecten',restoration:'Restauratie',victron:'Victron',costs:'Kosten',parts:'Restauratie-inkoop',documents:'Documenten',settings:'Instellingen',manuals:'Handleidingen',photos:"Foto\'s",inspiration:'Inspiratie'};
let db=loadData(), currentView='dashboard', deferredPrompt=null;
let driveTokenClient=null, driveAccessToken='', driveFileId=localStorage.getItem(DRIVE_FILE_ID_KEY)||'';
let driveConnected=false, driveSyncing=false, driveSyncTimer=null, driveLastError='';
let appInitialized=false, securityIdleTimer=null, securityAttempts=0, securityBlockedUntil=0;
let workOrderDraftPhotos=[], inspectionDraftPhotos=[];
let selectedWorkOrderMaintenanceIds=new Set();
let paintWorkOrderPrefill=null;
let currentObjectId='', prefillWorkOrderObjectId='', vrmRefreshTimer=null;

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
const money=v=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(num(v));
const dateNL=v=>{if(!v)return '—';const d=new Date(v);return isNaN(d)?'—':d.toLocaleDateString('nl-NL')};
const todayISO=()=>new Date().toISOString().slice(0,10);
const slug=s=>String(s||'').toLowerCase().replace(/\s+/g,'-');
const unique=a=>[...new Set(a.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'nl'));
const objectById=id=>db.objects.find(o=>o.id===id);
const maintenanceById=id=>db.maintenance.find(m=>m.id===id);
const nextId=(prefix,items,digits=4)=>{
  const max=items.reduce((m,x)=>Math.max(m,parseInt(String(x.id||'').replace(/\D/g,''),10)||0),0);
  return prefix+String(max+1).padStart(digits,'0');
};

function normalizeDate(v){
  if(!v)return '';
  if(typeof v==='string')return v.slice(0,10);
  try{return new Date(v).toISOString().slice(0,10)}catch{return ''}
}
function loadData(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw)return JSON.parse(raw);
  }catch(e){}
  return structuredClone(window.SEED_DATA);
}
function ensureMeta(){
  if(!db._meta||typeof db._meta!=='object')db._meta={};
  if(!db._meta.deviceId){
    let deviceId=localStorage.getItem('vmms_device_id_v1');
    if(!deviceId){deviceId='dev-'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('vmms_device_id_v1',deviceId)}
    db._meta.deviceId=deviceId;
  }
}
function saveData(options={}){
  ensureMeta();
  if(!options.fromRemote){
    db._meta.updatedAt=new Date().toISOString();
    localStorage.setItem(DRIVE_DIRTY_KEY,'1');
  }
  localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
  const s=$('#saveStatus');
  if(s)s.textContent=options.fromRemote?'Drive geladen':'Lokaal opgeslagen '+new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  if(!options.fromRemote)scheduleDriveSync();
  if(notificationsEnabled())setTimeout(()=>maybeSendDailyVmmsNotification(false),250);
}



function uid(prefix='ID'){return prefix+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4)}
function formatFileSize(bytes){const n=num(bytes);if(n<1024)return `${Math.round(n)} B`;if(n<1024*1024)return `${(n/1024).toFixed(1)} kB`;return `${(n/1024/1024).toFixed(1)} MB`}
function escapeAttr(v){return String(v??'').replace(/"/g,'&quot;')}
function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{const img=new Image();img.onload=()=>resolve({img,dataUrl:reader.result});img.onerror=()=>reject(new Error('Afbeelding laden mislukt'));img.src=reader.result};
    reader.onerror=()=>reject(new Error('Bestand lezen mislukt'));
    reader.readAsDataURL(file);
  });
}
async function compressWorkOrderPhoto(file,maxSize=1600,quality=.8){
  const {img,dataUrl}=await loadImageFromFile(file);const scale=Math.min(1,maxSize/Math.max(img.width,img.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  let output=canvas.toDataURL('image/jpeg',quality);if(output.length>=dataUrl.length&&String(file.type||'').includes('png'))output=dataUrl;
  const thumbnail=await createThumbnailFromImage(img);return {dataUrl:output,thumbnail};
}
function renderWorkOrderPhotoPreview(){
  const wrap=$('#workOrderPhotoPreview');if(!wrap)return;
  if(!workOrderDraftPhotos.length){wrap.innerHTML='<div class="empty">Nog geen foto\'s toegevoegd.</div>';return}
  const labels={voor:'Voor',tijdens:'Tijdens',na:'Na'};
  wrap.innerHTML=`<div class="workorder-photo-grid">${workOrderDraftPhotos.map((p,i)=>`<div class="workorder-photo-card"><div class="photo-stage-badge">${labels[p.stage]||'Tijdens'}</div><img src="${photoPreviewSrc(p)}" alt="${escapeAttr(p.name||'Werkbon foto')}"><div class="workorder-photo-meta"><strong>${esc(p.name||`Foto ${i+1}`)}</strong><small>${esc(formatFileSize(p.size||0))}</small></div><button class="icon-btn remove-workorder-photo" data-index="${i}" type="button">Verwijder</button></div>`).join('')}</div>`;
  $$('.remove-workorder-photo',wrap).forEach(btn=>btn.addEventListener('click',()=>{workOrderDraftPhotos.splice(Number(btn.dataset.index),1);renderWorkOrderPhotoPreview()}));
}
async function handleWorkOrderPhotoInput(event){
  const files=[...(event.target.files||[])];if(!files.length)return;const stage=event.target.dataset.stage||'tijdens';
  const remaining=Math.max(0,12-workOrderDraftPhotos.length);if(!remaining){toast('Maximaal 12 foto\'s per werkbon.');event.target.value='';return}
  if(files.length>remaining)toast(`Alleen de eerste ${remaining} foto\'s zijn toegevoegd.`);
  for(const file of files.slice(0,remaining)){
    if(!(file.type||'').startsWith('image/'))continue;
    try{const compressed=await compressWorkOrderPhoto(file);workOrderDraftPhotos.push({id:uid('IMG'),name:file.name||'foto.jpg',type:'image/jpeg',size:file.size||0,dataUrl:compressed.dataUrl,thumbnail:compressed.thumbnail,driveFileId:'',stage,addedAt:new Date().toISOString()})}catch(error){console.warn(error)}
  }
  event.target.value='';renderWorkOrderPhotoPreview();toast(`${workOrderDraftPhotos.length} foto('s) klaar voor deze werkbon`);
}
async function loadDrivePhotoInto(img,fileId){
  if(!fileId||!driveAccessToken)return;try{let url=DRIVE_PHOTO_CACHE.get(fileId);if(!url){const response=await driveFetch(DRIVE_API+'/files/'+encodeURIComponent(fileId)+'?alt=media');url=URL.createObjectURL(await response.blob());DRIVE_PHOTO_CACHE.set(fileId,url)}img.src=url}catch(error){console.warn(error)}
}
function openWorkOrderPhotos(id){
  const workOrder=(db.workOrders||[]).find(w=>w.id===id)||((db.trash?.workOrders||[]).find(w=>w.id===id));const photos=workOrder?.photos||[];
  if(!workOrder||!photos.length){toast('Geen foto\'s gevonden.');return}const labels={voor:'Voor',tijdens:'Tijdens',na:'Na'};
  openDialog(`Foto\'s bij ${workOrder.id}`, `<div class="workorder-gallery-head"><span class="status goed">${esc(workOrder.objectName||'Object')}</span><p>${esc(workOrder.description||'Werkbon')}</p></div><div class="workorder-gallery">${photos.map((p,i)=>`<figure class="gallery-item"><span class="photo-stage-badge">${labels[p.stage]||'Tijdens'}</span><img src="${photoPreviewSrc(p)}" data-drive-file="${esc(p.driveFileId||'')}" alt="${escapeAttr(p.name||`Foto ${i+1}`)}"><figcaption>${esc(p.name||`Foto ${i+1}`)}</figcaption></figure>`).join('')}</div><div class="form-actions"><button type="button" class="btn secondary" id="closeDialogBtn">Sluiten</button></div>`);
  $$('#dialogBody img[data-drive-file]').forEach(img=>{if(img.dataset.driveFile)loadDrivePhotoInto(img,img.dataset.driveFile)});$('#closeDialogBtn').onclick=closeDialog;
}


function setTheme(theme){
  const dark=theme==='dark';document.body.classList.toggle('dark-mode',dark);localStorage.setItem(THEME_KEY,dark?'dark':'light');
  const btn=$('#themeBtn');if(btn){btn.textContent=dark?'☀':'◐';btn.title=dark?'Lichte modus':'Donkere modus'}
}
function toggleTheme(){setTheme(document.body.classList.contains('dark-mode')?'light':'dark')}
function applyStoredTheme(){setTheme(localStorage.getItem(THEME_KEY)||'light')}
function photoPreviewSrc(photo){return photo?.dataUrl||photo?.thumbnail||''}
function dataUrlToBlob(dataUrl){
  const [head,data]=String(dataUrl||'').split(',');const mime=(head.match(/data:([^;]+)/)||[])[1]||'application/octet-stream';
  const binary=atob(data||'');const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:mime});
}
async function createThumbnailFromImage(img,maxSize=360,quality=.68){
  const scale=Math.min(1,maxSize/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',quality);
}
function loadImageFromDataUrl(dataUrl){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl})}
async function createThumbnailFromDataUrl(dataUrl){try{return await createThumbnailFromImage(await loadImageFromDataUrl(dataUrl))}catch{return dataUrl}}
function genericChecklist(task=''){
  const t=String(task).toLowerCase();
  const list=['Werkplek veiliggesteld','Visuele begincontrole uitgevoerd'];
  if(/olie|filter|vloeistof|brandstof/.test(t))list.push('Juiste vloeistof / onderdeel en hoeveelheid gecontroleerd');
  if(/elektr|accu|kabel|victron/.test(t))list.push('Spanning uitgeschakeld en aansluitingen gecontroleerd');
  if(/smeer|lager|mechan/.test(t))list.push('Bewegende delen op speling en slijtage gecontroleerd');
  list.push('Werk uitgevoerd volgens handleiding of taakomschrijving','Proefdraai / eindcontrole uitgevoerd','Werkplek opgeruimd en bevindingen genoteerd');
  return list;
}

function cloneJson(value){return JSON.parse(JSON.stringify(value))}
function upsertDataItems(target, additions){
  const map=new Map((target||[]).map(item=>[item.id,item]));
  additions.forEach(addition=>{
    if(map.has(addition.id))Object.assign(map.get(addition.id),cloneJson(addition));
    else target.push(cloneJson(addition));
  });
}
function ensureRestorationPlanData(data){
  const plan=window.VMMS_RESTORATION_PLAN;
  if(!plan||!data||!Array.isArray(data.objects))return false;
  data._meta=data._meta||{};
  const version=Number(plan.schemaVersion||2);
  if(Number(data._meta.restorationPlanMigration||0)>=version)return false;
  let changed=false;

  const previous=data.restoration||{};
  const previousPackages=previous.workPackages||previous.phases||[];
  const previousById=new Map(previousPackages.map(item=>[item.id,item]));
  const previousByName=new Map(previousPackages.map(item=>[item.name,item]));
  const integrated=cloneJson(plan);

  integrated.workPackages.forEach(pkg=>{
    const old=previousById.get(pkg.id)||previousByName.get(pkg.name);
    if(!old)return;
    if(old.status)pkg.status=old.status;
    if(old.nextAction)pkg.nextAction=old.nextAction;
    if(old.actualCost!=null)pkg.actualCost=num(old.actualCost);
    if(old.progress!=null&&!Array.isArray(old.tasks))pkg.progress=num(old.progress);
    const oldTasks=new Map((old.tasks||[]).map(task=>[task.id,task]));
    pkg.tasks.forEach(task=>{
      const oldTask=oldTasks.get(task.id);
      if(oldTask){task.done=!!oldTask.done;task.note=oldTask.note||''}
    });
  });

  ['holdPoints','decisions','openPoints','documents','photoPlan'].forEach(key=>{
    const oldItems=new Map((previous[key]||[]).map(item=>[item.id,item]));
    integrated[key].forEach(item=>{
      const old=oldItems.get(item.id);
      if(old)Object.assign(item,old);
    });
  });

  data.restoration=integrated;

  data.projects=data.projects||[];
  const project={
    id:'PRJ-REST-001',name:'Restauratie historische buitenstaat Variatie',
    system:'Staal buiten / tuigage',status:'Gepland',priority:'Kritiek',
    startDate:'',endDate:'',budget:164400,actualCost:0,progress:0,
    nextAction:'Foto-opname, huidig certificaat en vlakrapport verzamelen',
    documentLink:'restauratieplan.html',
    note:'Bandbreedte inclusief reservering: €164.400–€468.000. Concept V1; niet vrijgegeven voor uitvoering.'
  };
  const existingProject=data.projects.find(p=>p.id===project.id);
  if(existingProject)Object.assign(existingProject,{...project,progress:existingProject.progress||0,actualCost:existingProject.actualCost||0});
  else data.projects.push(project);

  data.maintenance=data.maintenance||[];data.parts=data.parts||[];
  data.documents=data.documents||[];data.certificates=data.certificates||[];
  upsertDataItems(data.objects,plan.plannedObjects||[]);
  upsertDataItems(data.maintenance,plan.plannedMaintenance||[]);
  upsertDataItems(data.parts,plan.plannedParts||[]);
  upsertDataItems(data.documents,plan.mainDocuments||[]);
  upsertDataItems(data.certificates,plan.certificates||[]);

  data._meta.restorationPlanMigration=version;
  data._meta.updatedAt=new Date().toISOString();
  changed=true;
  return changed;
}


function mergeByIdKeepingUserData(seedItems,existingItems){
  const existing=new Map((existingItems||[]).map(item=>[item.id,item]));
  return (seedItems||[]).map(seed=>{
    const old=existing.get(seed.id);
    if(!old)return cloneJson(seed);
    const merged={...cloneJson(seed),...old};
    if(seed.layers){
      const oldLayers=new Map((old.layers||[]).map(layer=>[layer.name,layer]));
      merged.layers=seed.layers.map(layer=>({...cloneJson(layer),...(oldLayers.get(layer.name)||{})}));
    }
    return merged;
  });
}
function ensurePaintAndSourcingData(data){
  if(!data)return false;
  const paintSeed=window.VMMS_PAINT_PLAN, sourcingSeed=window.VMMS_SECONDHAND_PLAN;
  if(!paintSeed||!sourcingSeed)return false;
  data._meta=data._meta||{};
  if(Number(data._meta.paintRestorationMigration||0)>=1)return false;
  const oldPaint=data.paintPlan||{};
  data.paintPlan={...cloneJson(paintSeed),...oldPaint,zones:mergeByIdKeepingUserData(paintSeed.zones,oldPaint.zones),instructions:mergeByIdKeepingUserData(paintSeed.instructions,oldPaint.instructions),history:Array.isArray(oldPaint.history)?oldPaint.history:[]};
  const oldSource=data.restorationSourcing||{};
  data.restorationSourcing={...cloneJson(sourcingSeed),...oldSource,items:mergeByIdKeepingUserData(sourcingSeed.items,oldSource.items),decisions:Array.isArray(oldSource.decisions)?oldSource.decisions:[]};
  data.restoration=data.restoration||{};
  data.restoration.holdPoints=data.restoration.holdPoints||[];
  const extraHold=[
    {id:'HP-REST-09',condition:'Geen dragend, remmend of veiligheidskritisch tweedehands onderdeel monteren vóór maatcontrole, inspectie en vereiste deskundige vrijgave.',status:'Open',releasedBy:'Constructeur / specialist',date:'',evidence:''},
    {id:'HP-REST-10',condition:'Geen definitief verfsysteem aanbrengen vóór opname van bestaande lagen, hechtingstest en compatibiliteitscontrole.',status:'Open',releasedBy:'Werf / coatingspecialist',date:'',evidence:''},
    {id:'HP-REST-11',condition:'Geen mast, zwaard of lier kopen vóór maatblad en belastingsuitgangspunten zijn vastgelegd.',status:'Open',releasedBy:'Projectleider + constructeur',date:'',evidence:''}
  ];
  extraHold.forEach(item=>{if(!data.restoration.holdPoints.some(x=>x.id===item.id))data.restoration.holdPoints.push(item)});
  data.restoration.decisions=data.restoration.decisions||[];
  const extraDecisions=[
    {id:'BES-REST-05',subject:'Beleid tweedehands onderdelen',choice:'Tweedehands waar passend, inspecteerbaar en aantoonbaar veilig',status:'Voorstel',decider:'Eigenaar + constructeur',date:''},
    {id:'BES-REST-06',subject:'Definitief verfsysteem en kleurplan',choice:'Na verfopname, proefvlakken en historisch kleuronderzoek',status:'Open',decider:'Eigenaar + werf + historisch adviseur',date:''}
  ];
  extraDecisions.forEach(item=>{if(!data.restoration.decisions.some(x=>x.id===item.id))data.restoration.decisions.push(item)});
  data._meta.paintRestorationMigration=1;
  return true;
}


function ensureMaydayMaintenanceData(data){
  const source=window.MAYDAY_MAINTENANCE_DATA;
  if(!source||!data||!Array.isArray(data.objects)||!Array.isArray(data.maintenance))return false;
  data._meta=data._meta||{};let changed=false,addedObjects=0,addedTasks=0,updatedTasks=0;
  (source.newObjects||[]).forEach(item=>{if(!data.objects.some(x=>x.id===item.id)){data.objects.push(structuredClone(item));changed=true;addedObjects++}});
  (source.newTasks||[]).forEach(item=>{if(!data.maintenance.some(x=>x.id===item.id)){data.maintenance.push(structuredClone(item));changed=true;addedTasks++}});
  Object.entries(source.taskUpdates||{}).forEach(([id,patch])=>{const item=(data.maintenance||[]).find(x=>x.id===id);if(!item)return;let local=false;Object.entries(patch).forEach(([key,value])=>{if(JSON.stringify(item[key])!==JSON.stringify(value)){item[key]=structuredClone(value);local=true}});if(local){changed=true;updatedTasks++}});
  data.maydayWiki={version:source.version||1,researchedAt:source.researchedAt||'',sources:structuredClone(source.sources||[]),notApplied:structuredClone(source.notApplied||[]),addedObjects,addedTasks,updatedTasks};
  if(data._meta.maydayMaintenanceMigration!==(source.version||1)){data._meta.maydayMaintenanceMigration=source.version||1;changed=true}
  return changed;
}
function openMaydaySourcesDialog(){
  const info=db.maydayWiki||window.MAYDAY_MAINTENANCE_DATA||{};
  const sources=info.sources||[];const groups={};sources.forEach(s=>(groups[s.topic||'Overig']=groups[s.topic||'Overig']||[]).push(s));
  openDialog('MaydayWiki-onderhoudsbronnen',`
    <div class="note"><b>Aangepast voor Variatie.</b> Fabrikantvoorschriften, keuringen en de werkelijke installatie aan boord gaan altijd vóór informatie van een ander schip.</div>
    <div class="mayday-source-summary"><span><b>${sources.length}</b> geraadpleegde pagina’s</span><span><b>${(window.MAYDAY_MAINTENANCE_DATA?.newTasks||[]).length}</b> aanvullende taken</span><span><b>${Object.keys(window.MAYDAY_MAINTENANCE_DATA?.taskUpdates||{}).length}</b> taken uitgebreid</span></div>
    ${Object.entries(groups).map(([topic,items])=>`<section class="mayday-source-group"><h4>${esc(topic)}</h4><div class="list">${items.map(item=>`<a class="list-item mayday-source-link" href="${esc(item.url)}" target="_blank" rel="noopener"><strong>${esc(item.title)}</strong><small>Open bronpagina</small></a>`).join('')}</div></section>`).join('')}
    <h4>Bewust niet automatisch toegepast</h4><div class="list">${(info.notApplied||[]).map(item=>`<div class="list-item"><strong>${esc(item.topic)}</strong><small>${esc(item.reason)}</small></div>`).join('')}</div>
    <div class="form-actions"><button class="btn secondary" id="closeMaydaySources">Sluiten</button></div>`);
  $('#closeMaydaySources').onclick=closeDialog;
}



function ensurePhotoLibraryData(data){
  const seed=window.VMMS_PHOTO_LIBRARY_DATA;
  if(!seed||!data)return false;
  data._meta=data._meta||{};
  const previous=data.photoLibrary?.items||[];
  const oldMap=new Map(previous.map(item=>[item.id,item]));
  const items=(seed.items||[]).map(seedItem=>{
    const old=oldMap.get(seedItem.id)||{};
    return {...cloneJson(seedItem),...old,id:seedItem.id,legacySrc:seedItem.legacySrc,title:old.title||seedItem.title,category:old.category||seedItem.category,caption:old.caption||seedItem.caption};
  });
  previous.filter(item=>!items.some(seedItem=>seedItem.id===item.id)).forEach(item=>items.push(item));
  data.photoLibrary={version:seed.version||1,items};
  const version=seed.version||1;
  if(Number(data._meta.photoLibraryMigration||0)!==version){data._meta.photoLibraryMigration=version;return true}
  return false;
}
function photoLibraryItems(){ensurePhotoLibraryData(db);return db.photoLibrary?.items||[]}
function photoLibraryItem(id){return photoLibraryItems().find(item=>item.id===id)||null}
function photoIdForLegacySrc(src){return photoLibraryItems().find(item=>item.legacySrc===src)?.id||''}
function photoLibraryStats(){const items=photoLibraryItems();return {total:items.length,drive:items.filter(item=>item.driveFileId).length,thumbs:items.filter(item=>item.thumbnail).length}}
function photoPlaceholder(itemOrId){
  const item=typeof itemOrId==='string'?photoLibraryItem(itemOrId):itemOrId;
  const title=(item?.title||'Foto in Google Drive').slice(0,45);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0d2130"/><stop offset="1" stop-color="#34566d"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><path d="M0 332c90-55 168 38 260-15s178 28 380-32v135H0z" fill="#6ea1bd" opacity=".55"/><path d="M183 286h262l-35 36H217z" fill="#f2f6f8" opacity=".9"/><path d="M290 130h12v156h-12zM302 145l86 109h-86z" fill="#f2f6f8" opacity=".9"/><text x="320" y="375" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#fff">${title.replace(/[&<>]/g,'')}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
function photoPreviewById(id){const item=photoLibraryItem(id);return item?.thumbnail||photoPlaceholder(item||id)}
function photoImgHtml(id,alt='',className='',extra=''){
  return `<img src="${escapeAttr(photoPreviewById(id))}" data-photo-id="${escapeAttr(id)}" class="${escapeAttr(className)}" loading="lazy" alt="${escapeAttr(alt||photoLibraryItem(id)?.title||'Foto')}" ${extra}>`;
}
async function createThumbnailFromBlob(blob,maxSize=420,quality=.68){
  const url=URL.createObjectURL(blob);
  try{const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=url});return await createThumbnailFromImage(img,maxSize,quality)}finally{URL.revokeObjectURL(url)}
}
async function loadLibraryPhotoInto(img,photoId){
  const item=photoLibraryItem(photoId);if(!img||!item?.driveFileId||!driveAccessToken)return;
  try{
    let url=LIBRARY_PHOTO_CACHE.get(item.driveFileId);
    if(!url){const response=await driveFetch(DRIVE_API+'/files/'+encodeURIComponent(item.driveFileId)+'?alt=media');url=URL.createObjectURL(await response.blob());LIBRARY_PHOTO_CACHE.set(item.driveFileId,url)}
    img.src=url;img.dataset.photoLoaded='1';
    if(photoId==='PHT-CUR-003')document.documentElement.style.setProperty('--vmms-ship-bg',`url("${url}")`);
  }catch(error){console.warn('Drive-foto laden:',error)}
}
function hydratePhotoImages(root=document){
  const images=$$('img[data-photo-id]',root).filter(img=>!img.dataset.photoObserved&&!img.dataset.photoLoaded);
  if(!images.length)return;
  if(!('IntersectionObserver' in window)){images.forEach(img=>loadLibraryPhotoInto(img,img.dataset.photoId));return}
  if(!libraryPhotoObserver)libraryPhotoObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;const img=entry.target;libraryPhotoObserver.unobserve(img);loadLibraryPhotoInto(img,img.dataset.photoId)}),{rootMargin:'250px'});
  images.forEach(img=>{img.dataset.photoObserved='1';libraryPhotoObserver.observe(img)});
}
function refreshPhotoViews(){
  $$('img[data-photo-id]').forEach(img=>{delete img.dataset.photoLoaded;delete img.dataset.photoObserved;img.src=photoPreviewById(img.dataset.photoId)});hydratePhotoImages();
  const bg=photoLibraryItem('PHT-CUR-003');if(bg?.driveFileId&&driveConnected){const dummy=new Image();dummy.dataset.photoId='PHT-CUR-003';loadLibraryPhotoInto(dummy,'PHT-CUR-003')}
}
function base64ToBlob(data,mimeType='application/octet-stream'){
  const binary=atob(data);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:mimeType});
}
async function importVmmsPhotoPack(file){
  if(!driveConnected||!driveAccessToken){toast('Verbind eerst met Google Drive.');return}
  const progress=$('#photoImportProgress');
  try{
    if(progress)progress.textContent='Importpakket lezen…';
    const pack=JSON.parse(await file.text());
    if(pack.format!=='VMMS_PHOTO_PACK'||!Array.isArray(pack.photos))throw new Error('Dit is geen geldig VMMS-foto-importpakket.');
    ensurePhotoLibraryData(db);
    let uploaded=0,skipped=0;
    for(let index=0;index<pack.photos.length;index++){
      const source=pack.photos[index],item=photoLibraryItem(source.id);if(!item){skipped++;continue}
      if(item.driveFileId){skipped++;continue}
      if(progress)progress.textContent=`Foto ${index+1}/${pack.photos.length}: ${item.title}`;
      const blob=base64ToBlob(source.data,source.mimeType);
      const remote=await uploadAppDataBlob(`VMMS_FOTO_${item.id}_${slug(item.title)}.${(source.mimeType||'image/jpeg').includes('png')?'png':'jpg'}`,blob,{vmmsType:'photo-library',photoId:item.id,category:item.category||''});
      item.driveFileId=remote.id;item.mimeType=source.mimeType;item.size=blob.size;item.thumbnail=await createThumbnailFromBlob(blob);item.uploadedAt=new Date().toISOString();uploaded++;
      if(index%3===0)localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
    }
    saveData();await uploadDriveDatabase();
    if(progress)progress.textContent=`Klaar: ${uploaded} geüpload, ${skipped} al aanwezig of overgeslagen.`;
    refreshPhotoViews();renderSettings();toast(`${uploaded} foto’s naar Google Drive geüpload.`);
  }catch(error){if(progress)progress.textContent=error.message;toast(error.message||'Foto-import mislukt.');console.error(error)}
}
async function relinkPhotoLibraryFromDrive(){
  if(!driveConnected||!driveAccessToken){toast('Verbind eerst met Google Drive.');return}
  try{
    const q=encodeURIComponent("appProperties has { key='vmmsType' and value='photo-library' } and trashed=false");
    const response=await driveFetch(DRIVE_API+`/files?spaces=appDataFolder&pageSize=1000&fields=files(id,name,mimeType,size,modifiedTime,appProperties)&q=${q}`);const result=await response.json();let linked=0;
    for(const file of result.files||[]){const id=file.appProperties?.photoId,item=photoLibraryItem(id);if(item&&!item.driveFileId){item.driveFileId=file.id;item.mimeType=file.mimeType;item.size=num(file.size);item.uploadedAt=file.modifiedTime;linked++}}
    if(linked){saveData();await uploadDriveDatabase()}refreshPhotoViews();renderSettings();toast(`${linked} fotoverwijzingen hersteld.`);
  }catch(error){toast(error.message||'Foto-index herstellen mislukt.')}
}
async function uploadNewInspirationPhoto(file,fields){
  if(!driveConnected||!driveAccessToken)throw new Error('Verbind eerst met Google Drive.');
  const id=uid('PHT-CUSTOM-');const blob=file;const title=fields.title||file.name||'Inspiratiefoto';
  const remote=await uploadAppDataBlob(`VMMS_FOTO_${id}_${slug(title)}.jpg`,blob,{vmmsType:'photo-library',photoId:id,category:fields.category||'Inspiratie'});
  const libraryItem={id,title,category:fields.category||'Inspiratie',caption:fields.description||'',role:'inspiration',driveFileId:remote.id,mimeType:file.type,size:file.size,thumbnail:await createThumbnailFromBlob(blob),uploadedAt:new Date().toISOString()};
  db.photoLibrary.items.push(libraryItem);
  db.inspiration.photos.push({id:nextId('INSP',db.inspiration.photos,4),photoId:id,title,category:fields.category||'Exterieur',tags:fields.tags||[],description:fields.description||'',suggestedUse:fields.suggestedUse||'',favorite:false,linkedPackageIds:fields.linkedPackageIds||[],note:''});
  saveData();await uploadDriveDatabase();return libraryItem;
}
function openAddInspirationPhoto(){
  const packages=restorationPackages();
  openDialog('Inspiratiefoto toevoegen',`<form id="addInspirationForm" class="form-grid"><label class="span-2">Foto<input name="photo" type="file" accept="image/*" required></label><label class="span-2">Titel<input name="title" required></label><label>Categorie<select name="category">${(db.inspiration?.categories||[]).filter(x=>!['Alle','Favorieten'].includes(x)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label class="span-2">Beschrijving<textarea name="description"></textarea></label><label class="span-2">Te gebruiken voor<textarea name="suggestedUse"></textarea></label><label class="span-2">Tags<input name="tags" placeholder="zwaard, dek, lier"></label><div class="span-2"><b>Koppelen aan werkpakketten</b><div class="inspiration-package-options">${packages.map(pkg=>`<label><input type="checkbox" name="packageIds" value="${esc(pkg.id)}"><span><b>${esc(pkg.id)}</b> ${esc(pkg.name)}</span></label>`).join('')}</div></div><div class="span-2 form-actions"><button type="button" class="btn secondary" id="cancelAddInspiration">Annuleren</button><button class="btn">Upload naar Drive</button></div></form>`);
  $('#cancelAddInspiration').onclick=closeDialog;$('#addInspirationForm').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),file=data.get('photo');if(!(file instanceof File)||!file.size)return;const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;try{await uploadNewInspirationPhoto(file,{title:String(data.get('title')||''),category:String(data.get('category')||''),description:String(data.get('description')||''),suggestedUse:String(data.get('suggestedUse')||''),tags:String(data.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),linkedPackageIds:data.getAll('packageIds')});closeDialog();renderInspiration();toast('Inspiratiefoto naar Drive geüpload.')}catch(error){toast(error.message)}finally{if(submit)submit.disabled=false}};
}

function ensureInspirationData(data){
  const seed=window.VMMS_INSPIRATION_DATA;
  if(!seed||!data)return false;
  data._meta=data._meta||{};
  const existing=data.inspiration?.photos||[];
  const oldMap=new Map(existing.map(item=>[item.id,item]));
  const photos=(seed.photos||[]).map(item=>{
    const old=oldMap.get(item.id)||{};
    return {...cloneJson(item),...old,photoId:old.photoId||item.photoId||photoIdForLegacySrc(item.src),title:old.title||item.title,category:old.category||item.category,tags:Array.isArray(old.tags)?old.tags:cloneJson(item.tags||[]),linkedPackageIds:Array.isArray(old.linkedPackageIds)?old.linkedPackageIds:cloneJson(item.linkedPackageIds||[])};
  });
  const custom=existing.filter(item=>!photos.some(seedItem=>seedItem.id===item.id));
  data.inspiration={version:seed.version||1,title:seed.title||'Inspiratie',categories:cloneJson(seed.categories||[]),photos:[...photos,...custom]};
  if(Number(data._meta.inspirationMigration||0)!==(seed.version||1)){
    data._meta.inspirationMigration=seed.version||1;
    return true;
  }
  return false;
}
function inspirationPhotos(){ensureInspirationData(db);return db.inspiration?.photos||[]}
function restorationPackageName(id){return restorationPackages().find(item=>item.id===id)?.name||id}
function inspirationReferenceHtml(limit=8){
  const items=inspirationPhotos().filter(item=>item.favorite||((item.linkedPackageIds||[]).length)).slice(0,limit);
  if(!items.length)return '';
  return `<div class="card restoration-inspiration-card"><div class="section-title"><div><h3>Inspiratiereferenties</h3><small>Favorieten en foto’s die aan restauratiewerkpakketten zijn gekoppeld.</small></div><button class="btn secondary" data-view="inspiration">Open inspiratie</button></div><div class="inspiration-mini-grid">${items.map(item=>`<button class="inspiration-mini" data-view="inspiration">${photoImgHtml(item.photoId,item.title)}<span><b>${esc(item.title)}</b><small>${esc(item.category)}</small></span></button>`).join('')}</div></div>`;
}

function ensureVmms3Data(data){
  if(!data||!Array.isArray(data.objects))return false;data._meta=data._meta||{};let changed=false;
  data.settings=data.settings||{};
  if(!data.settings.weatherLocationName){data.settings.weatherLocationName='Leeuwarden';changed=true}
  if(!Number.isFinite(Number(data.settings.weatherLatitude))){data.settings.weatherLatitude=53.2012;changed=true}
  if(!Number.isFinite(Number(data.settings.weatherLongitude))){data.settings.weatherLongitude=5.7999;changed=true}
  if(!Array.isArray(data.inspections)){data.inspections=[];changed=true}
  if(!data.settings.dayPlanHours){data.settings.dayPlanHours=4;changed=true}
  if(!data.trash){data.trash={workOrders:[]};changed=true}else if(!Array.isArray(data.trash.workOrders)){data.trash.workOrders=[];changed=true}
  const defaultPhases=[
    ['RST001','Historisch onderzoek en maatvoering','Bezig',15,1500,'Oorspronkelijke uitvoering, dekplan en maatvoering vastleggen'],
    ['RST002','Stuurhut demonteren','Gepland',0,5000,'Demonteerplan, tijdelijke afdichting en opslag onderdelen'],
    ['RST003','Nieuw achterdek en opbouwherstel','Gepland',0,25000,'Constructie, conservering en afwatering uitwerken'],
    ['RST004','Mastfundatie en mast','Gepland',0,30000,'Berekening mastkoker, fundatie en houten mast'],
    ['RST005','Tuigage en zeilen','Gepland',0,35000,'Staand/lopend want, giek, blokken en zeilen'],
    ['RST006','Zwaarden en ophanging','Gepland',0,18000,'Zwaarden, zwaardbouten, lieren en bediening'],
    ['RST007','Lieren en dekbeslag','Gepland',0,12000,'Zeillieren, bolders, kikkers en beslag plaatsen'],
    ['RST008','Conservering en schilderwerk','Gepland',0,15000,'Staalwerk, houtwerk en historische kleurstelling'],
    ['RST009','Proefvaart, stabiliteit en certificering','Gepland',0,7500,'Proefzeilen, aanpassingen en CVO-afstemming']
  ];
  if(!data.restoration){data.restoration={target:'Variatie terugbrengen naar een klassiek zeilend uiterlijk',phases:defaultPhases.map(x=>({id:x[0],name:x[1],status:x[2],progress:x[3],budget:x[4],nextAction:x[5],note:''}))};changed=true}
  data.maintenance=(data.maintenance||[]).map(m=>{if(!Array.isArray(m.checklist)){m.checklist=genericChecklist(m.task);changed=true}return m});
  (data.workOrders||[]).forEach(w=>{
    (w.photos||[]).forEach(p=>{if(!p.stage){p.stage='tijdens';changed=true}if(p.dataUrl&&!p.thumbnail){p.thumbnail=p.dataUrl;changed=true}});
    if(!Array.isArray(w.checklistResults)){w.checklistResults=[];changed=true}
    if(!Array.isArray(w.maintenanceIds)){w.maintenanceIds=w.maintenanceId?[w.maintenanceId]:[];changed=true}
    w.maintenanceIds=unique(w.maintenanceIds.filter(Boolean));
    if(w.maintenanceId!==(w.maintenanceIds[0]||'')){w.maintenanceId=w.maintenanceIds[0]||'';changed=true}
    if(!Array.isArray(w.maintenanceTaskNames)){
      w.maintenanceTaskNames=w.maintenanceIds.map(id=>(data.maintenance||[]).find(m=>m.id===id)?.task).filter(Boolean);
      changed=true;
    }
  });
  data._meta.vmms3Migration=1;return changed;
}
async function googleLoginUnlock(){
  const button=$('#googleSecurityLogin');if(button){button.disabled=true;button.textContent='Google-login openen…'}
  try{
    await requestDriveAccessToken('consent');unlockVmms();
    const file=driveFileId?{id:driveFileId}:await findDriveFile();await reconcileWithDrive(file||await findDriveFile());
    toast('Ingelogd met Google en Drive verbonden');
  }catch(error){securityMessage(error.message||'Google-inloggen is mislukt.');}
  finally{if(button){button.disabled=false;button.textContent='G Inloggen met Google'}}
}
function reportEscape(v){return esc(v)}
function generateVmmsReport(){
  const {rows,counts,health}=maintenanceStats();const year=new Date().getFullYear();const cost=db.workOrders.reduce((a,w)=>a+workOrderCost(w),0);
  const recent=[...db.workOrders].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,50);
  const urgent=rows.filter(r=>['Urgent','Achterstallig','Binnenkort'].includes(r.state.status)).slice(0,50);
  const win=window.open('','_blank');if(!win){toast('Sta pop-ups toe om het rapport te maken.');return}
  win.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>VMMS Rapport Variatie</title><style>body{font-family:Arial,sans-serif;color:#172a38;margin:32px}h1,h2{color:#123b5d}header{border-bottom:3px solid #123b5d;margin-bottom:24px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi{border:1px solid #ccd7df;border-radius:10px;padding:12px}.kpi b{font-size:22px;display:block}table{width:100%;border-collapse:collapse;margin:12px 0 24px;font-size:11px}th,td{border:1px solid #d7dfe5;padding:6px;text-align:left;vertical-align:top}th{background:#eef4f7}.photo{width:105px;height:78px;object-fit:cover;border-radius:6px;margin:3px}@media print{button{display:none}body{margin:12mm}.page-break{break-before:page}}</style></head><body><header><h1>VMMS onderhoudsrapport – Variatie</h1><p>Gegenereerd ${new Date().toLocaleString('nl-NL')} · ${reportEscape(db.ship?.type||'Steilsteven')} · bouwjaar ${reportEscape(db.ship?.year||1925)}</p><button onclick="print()">Afdrukken / opslaan als PDF</button></header><div class="kpis"><div class="kpi">Gezondheid<b>${health}%</b></div><div class="kpi">Open aandacht<b>${counts.Binnenkort+counts.Achterstallig+counts.Urgent}</b></div><div class="kpi">Werkbonnen<b>${db.workOrders.length}</b></div><div class="kpi">Totale kosten<b>${money(cost)}</b></div></div><h2>Openstaand onderhoud</h2><table><thead><tr><th>Status</th><th>Object</th><th>Taak</th><th>Volgende grens</th></tr></thead><tbody>${urgent.map(r=>`<tr><td>${reportEscape(r.state.status)}</td><td>${reportEscape(objectById(r.objectId)?.name||r.objectId)}</td><td>${reportEscape(r.task)}</td><td>${r.state.nextDate?dateNL(r.state.nextDate):''}${r.state.nextMeter!=null?' / '+r.state.nextMeter+' uur':''}</td></tr>`).join('')}</tbody></table><h2 class="page-break">Recente werkbonnen</h2><table><thead><tr><th>Datum</th><th>Object</th><th>Werk</th><th>Kosten</th><th>Foto's</th></tr></thead><tbody>${recent.map(w=>`<tr><td>${dateNL(w.date)}</td><td>${reportEscape(w.objectName)}</td><td>${reportEscape(w.description)}${workOrderMaintenanceNames(w).length?'<br><b>Onderhoud:</b> '+workOrderMaintenanceNames(w).map(reportEscape).join('; '):''}<br>${reportEscape(w.note||'')}</td><td>${money(workOrderCost(w))}</td><td>${(w.photos||[]).slice(0,3).map(p=>photoPreviewSrc(p)?`<img class="photo" src="${photoPreviewSrc(p)}">`: '').join('')}</td></tr>`).join('')}</tbody></table><h2>Restauratie</h2><table><thead><tr><th>Fase</th><th>Status</th><th>Voortgang</th><th>Budget</th><th>Volgende actie</th></tr></thead><tbody>${restorationPackages().map(p=>`<tr><td>${reportEscape(p.name)}</td><td>${reportEscape(p.status)}</td><td>${packageTaskProgress(p)}%</td><td>${money(p.budget)}</td><td>${reportEscape(p.nextAction)}</td></tr>`).join('')}</tbody></table></body></html>`);win.document.close();
}

async function securityHash(pin){
  const bytes=new TextEncoder().encode(SECURITY_PIN_SALT+String(pin||''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function securityMessage(message='',success=false){
  const el=$('#securityMessage');
  if(!el)return;
  el.textContent=message;
  el.classList.toggle('success',success);
}
function resetSecurityIdleTimer(){
  if(document.body.classList.contains('security-locked'))return;
  clearTimeout(securityIdleTimer);
  securityIdleTimer=setTimeout(()=>lockVmms('VMMS is automatisch vergrendeld na 15 minuten zonder gebruik.'),SECURITY_IDLE_MS);
}
function initializeVmms(){
  if(!appInitialized){
    let vmmsMigrated=false;
    if(migrateVariatieListingData(db))vmmsMigrated=true;
    if(migrateManualMaintenanceData(db))vmmsMigrated=true;
    if(ensureVmms3Data(db))vmmsMigrated=true;
    if(ensureRestorationPlanData(db))vmmsMigrated=true;
    if(ensurePaintAndSourcingData(db))vmmsMigrated=true;
    if(ensureBallastToolData(db))vmmsMigrated=true;
    if(ensureMaydayMaintenanceData(db))vmmsMigrated=true;
    if(ensurePhotoLibraryData(db))vmmsMigrated=true;
    if(ensureInspirationData(db))vmmsMigrated=true;
    if(vmmsMigrated){
      localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
      localStorage.setItem(DRIVE_DIRTY_KEY,'1');
    }
    renderDashboard();
    setDriveUi('disconnected','Alleen lokaal opgeslagen');
    appInitialized=true;
  }else{
    renderView(currentView);
  }
  setTimeout(()=>tryRestoreDriveSession(),700);
  setTimeout(()=>maybeSendDailyVmmsNotification(false),900);
}
function unlockVmms(){
  document.body.classList.remove('security-locked');
  const screen=$('#securityScreen');
  if(screen)screen.hidden=true;
  sessionStorage.setItem(SECURITY_SESSION_KEY,'1');
  securityAttempts=0;
  securityBlockedUntil=0;
  securityMessage('');
  initializeVmms();
  resetSecurityIdleTimer();
}
function lockVmms(message=''){
  clearTimeout(securityIdleTimer);
  clearTimeout(driveSyncTimer);
  sessionStorage.removeItem(SECURITY_SESSION_KEY);
  driveAccessToken='';
  driveConnected=false;
  document.body.classList.add('security-locked');
  const screen=$('#securityScreen'),pin=$('#securityPin');
  if(screen)screen.hidden=false;
  if(pin){pin.value='';setTimeout(()=>pin.focus(),60)}
  securityMessage(message);
}
async function submitSecurityPin(event){
  event.preventDefault();
  const now=Date.now();
  if(now<securityBlockedUntil){
    const seconds=Math.ceil((securityBlockedUntil-now)/1000);
    securityMessage(`Te veel verkeerde pogingen. Wacht ${seconds} seconden.`);
    return;
  }
  const pin=String($('#securityPin')?.value||'').replace(/\D/g,'');
  if(pin.length!==4){
    securityMessage('Vul een pincode van vier cijfers in.');
    return;
  }
  const submit=$('#securitySubmit');
  if(submit)submit.disabled=true;
  try{
    const hash=await securityHash(pin);
    if(hash===SECURITY_PIN_HASH){
      securityMessage('Pincode correct.',true);
      setTimeout(unlockVmms,120);
      return;
    }
    securityAttempts++;
    if(securityAttempts>=SECURITY_MAX_ATTEMPTS){
      securityBlockedUntil=Date.now()+SECURITY_BLOCK_MS;
      securityAttempts=0;
      securityMessage('Te veel verkeerde pogingen. De invoer is 30 seconden geblokkeerd.');
    }else{
      securityMessage(`Onjuiste pincode. Nog ${SECURITY_MAX_ATTEMPTS-securityAttempts} poging(en).`);
    }
    const input=$('#securityPin');
    if(input){input.value='';input.focus()}
  }catch{
    securityMessage('De pincodecontrole wordt niet ondersteund in deze browser.');
  }finally{
    if(submit)submit.disabled=false;
  }
}
function initializeSecurity(){
  const form=$('#securityForm'),pin=$('#securityPin');
  if(form)form.addEventListener('submit',submitSecurityPin);
  $('#googleSecurityLogin')?.addEventListener('click',googleLoginUnlock);
  if(pin)pin.addEventListener('input',()=>{
    pin.value=pin.value.replace(/\D/g,'').slice(0,4);
    securityMessage('');
  });
  $('#lockBtn')?.addEventListener('click',()=>lockVmms('VMMS is handmatig vergrendeld.'));
  ['pointerdown','keydown','touchstart','scroll'].forEach(type=>{
    document.addEventListener(type,resetSecurityIdleTimer,{passive:true});
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)resetSecurityIdleTimer();
  });
  if(sessionStorage.getItem(SECURITY_SESSION_KEY)==='1'){
    unlockVmms();
  }else{
    lockVmms('');
  }
}

function setDriveUi(state,message=''){
  const btn=$('#driveBtn');
  const status=$('#saveStatus');
  if(btn){
    btn.classList.remove('connected','syncing','error');
    if(state==='connected'){btn.classList.add('connected');btn.textContent='☁ Drive gekoppeld'}
    else if(state==='syncing'){btn.classList.add('syncing');btn.textContent='☁ Synchroniseren'}
    else if(state==='error'){btn.classList.add('error');btn.textContent='☁ Drive fout'}
    else btn.textContent='☁ Drive verbinden';
    btn.title=message||btn.textContent;
  }
  if(status&&message)status.textContent=message;
  const dot=$('#driveSettingsDot'),text=$('#driveSettingsStatus'),last=$('#driveLastSync');
  if(dot){dot.className='drive-dot '+(state==='disconnected'?'':state)}
  if(text)text.textContent=message||(state==='connected'?'Google Drive is verbonden.':'Google Drive is niet verbonden.');
  if(last){
    const raw=localStorage.getItem(DRIVE_LAST_SYNC_KEY);
    last.textContent=raw?'Laatste synchronisatie: '+new Date(raw).toLocaleString('nl-NL'):'Nog niet gesynchroniseerd';
  }
}
function waitForGoogleIdentity(timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const timer=setInterval(()=>{
      if(window.google?.accounts?.oauth2){clearInterval(timer);resolve()}
      else if(Date.now()-started>timeoutMs){clearInterval(timer);reject(new Error('Google-inloggen kon niet worden geladen. Controleer internet en probeer opnieuw.'))}
    },100);
  });
}
async function initDriveClient(){
  if(driveTokenClient)return;
  if(!DRIVE_CONFIG.clientId)throw new Error('Google Client ID ontbreekt.');
  await waitForGoogleIdentity();
  driveTokenClient=google.accounts.oauth2.initTokenClient({
    client_id:DRIVE_CONFIG.clientId,
    scope:DRIVE_CONFIG.scope,
    callback:()=>{}
  });
}
function requestDriveAccessToken(prompt='consent'){
  return new Promise(async(resolve,reject)=>{
    try{
      await initDriveClient();
      driveTokenClient.callback=response=>{
        if(response?.error){reject(new Error(response.error_description||response.error));return}
        driveAccessToken=response.access_token;
        driveConnected=true;
        localStorage.setItem(DRIVE_ENABLED_KEY,'1');
        setDriveUi('connected','Google Drive verbonden');
        resolve(response.access_token);
      };
      driveTokenClient.requestAccessToken({prompt});
    }catch(error){reject(error)}
  });
}
async function driveFetch(url,options={}){
  if(!driveAccessToken)throw new Error('Google Drive is niet verbonden.');
  const headers=new Headers(options.headers||{});
  headers.set('Authorization','Bearer '+driveAccessToken);
  const response=await fetch(url,{...options,headers});
  if(response.status===401){
    driveAccessToken='';driveConnected=false;setDriveUi('error','Drive-sessie verlopen. Tik op Drive verbinden.');
    throw new Error('De Google Drive-sessie is verlopen.');
  }
  if(!response.ok){
    let detail='';
    try{detail=(await response.json())?.error?.message||''}catch{}
    throw new Error(detail||('Google Drive fout '+response.status));
  }
  return response;
}
async function findDriveFile(){
  const query=`name='${String(DRIVE_CONFIG.fileName).replace(/'/g,"\\'")}' and trashed=false`;
  const url=DRIVE_API+'/files?spaces=appDataFolder&pageSize=10&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,size)&q='+encodeURIComponent(query);
  const response=await driveFetch(url);
  const data=await response.json();
  const file=data.files?.[0]||null;
  if(file){driveFileId=file.id;localStorage.setItem(DRIVE_FILE_ID_KEY,file.id)}
  return file;
}
async function downloadDriveDatabase(fileId){
  const response=await driveFetch(DRIVE_API+'/files/'+encodeURIComponent(fileId)+'?alt=media');
  const remote=await response.json();
  if(!remote?.objects||!remote?.maintenance)throw new Error('Het Drive-bestand bevat geen geldige VMMS-database.');
  migrateVariatieListingData(remote);
  migrateManualMaintenanceData(remote);
  ensureVmms3Data(remote);
  ensureRestorationPlanData(remote);
  ensurePaintAndSourcingData(remote);
  ensureBallastToolData(remote);
  ensureMaydayMaintenanceData(remote);
  ensurePhotoLibraryData(remote);
  ensureInspirationData(remote);
  return remote;
}
async function createDriveFile(){
  const metadataResponse=await driveFetch(DRIVE_API+'/files?fields=id,modifiedTime',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:DRIVE_CONFIG.fileName,mimeType:'application/json',parents:['appDataFolder']})
  });
  const metadata=await metadataResponse.json();
  driveFileId=metadata.id;
  localStorage.setItem(DRIVE_FILE_ID_KEY,driveFileId);
  return uploadDriveDatabase();
}
async function uploadAppDataBlob(name,blob,appProperties={}){
  const boundary='vmms_'+Math.random().toString(36).slice(2);const metadata={name,mimeType:blob.type||'application/octet-stream',parents:['appDataFolder'],appProperties};
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,JSON.stringify(metadata),`\r\n--${boundary}\r\nContent-Type: ${blob.type||'application/octet-stream'}\r\n\r\n`,blob,`\r\n--${boundary}--`]);
  const response=await driveFetch(DRIVE_UPLOAD_API+'/files?uploadType=multipart&fields=id,name,modifiedTime',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});return response.json();
}
async function deleteDriveFileNow(fileId){if(!fileId)return;await driveFetch(DRIVE_API+'/files/'+encodeURIComponent(fileId),{method:'DELETE'})}
async function processPendingDriveDeletes(){
  const ids=[...(db._pendingDriveDeletes||[])];if(!ids.length)return;const remaining=[];
  for(const id of ids){try{await deleteDriveFileNow(id)}catch{remaining.push(id)}}db._pendingDriveDeletes=remaining;
}
async function syncPendingPhotos(){
  async function syncCollection(ownerType,ownerId,photos){
    for(const photo of (photos||[])){
      if(photo.driveFileId||!photo.dataUrl)continue;
      const file=await uploadAppDataBlob(`${ownerType}_${ownerId}_${photo.stage||'foto'}_${photo.id||uid('IMG')}.jpg`,dataUrlToBlob(photo.dataUrl),{vmmsType:ownerType==='WB'?'workorder-photo':'inspection-photo',ownerId,stage:photo.stage||'foto'});
      photo.driveFileId=file.id;
      if(!photo.thumbnail||photo.thumbnail===photo.dataUrl||photo.thumbnail.length>120000)photo.thumbnail=await createThumbnailFromDataUrl(photo.dataUrl);
      delete photo.dataUrl;
    }
  }
  for(const workOrder of (db.workOrders||[]))await syncCollection('WB',workOrder.id,workOrder.photos);
  for(const inspection of (db.inspections||[]))await syncCollection('INS',inspection.id,inspection.photos);
  for(const zone of (db.paintPlan?.zones||[])){if(zone.customPhoto&&!zone.customPhotoLibraryId){const id=uid('PHT-PAINT-CUSTOM-'),blob=dataUrlToBlob(zone.customPhoto),file=await uploadAppDataBlob(`VMMS_FOTO_${id}_${slug(zone.name)}.jpg`,blob,{vmmsType:'photo-library',photoId:id,category:'Verfplan'});db.photoLibrary.items.push({id,title:`Zonefoto ${zone.name}`,category:'Verfplan',caption:'Eigen foto bij verfzone '+zone.id,role:'paint-zone',driveFileId:file.id,mimeType:blob.type,size:blob.size,thumbnail:await createThumbnailFromDataUrl(zone.customPhoto),uploadedAt:new Date().toISOString()});zone.customPhotoLibraryId=id;delete zone.customPhoto;}}
}
async function createDailyDriveBackup(){
  const today=todayISO();if(localStorage.getItem(DRIVE_BACKUP_DATE_KEY)===today)return;
  const copy=structuredClone(db);(copy.workOrders||[]).forEach(w=>(w.photos||[]).forEach(p=>delete p.dataUrl));(copy.inspections||[]).forEach(item=>(item.photos||[]).forEach(p=>delete p.dataUrl));
  await uploadAppDataBlob(`VMMS_Backup_${today}.json`,new Blob([JSON.stringify(copy)],{type:'application/json'}),{vmmsType:'daily-backup',date:today});localStorage.setItem(DRIVE_BACKUP_DATE_KEY,today);
  try{const q=encodeURIComponent("name contains 'VMMS_Backup_' and trashed=false");const r=await driveFetch(DRIVE_API+`/files?spaces=appDataFolder&pageSize=100&fields=files(id,name,modifiedTime)&q=${q}`);const d=await r.json();const cutoff=Date.now()-14*86400000;for(const f of d.files||[]){if(Date.parse(f.modifiedTime)<cutoff)await deleteDriveFileNow(f.id)}}catch(error){console.warn('Back-up opschonen:',error)}
}
async function uploadDriveDatabase(){
  if(!driveFileId)return createDriveFile();ensureMeta();await processPendingDriveDeletes();await syncPendingPhotos();
  const response=await driveFetch(DRIVE_UPLOAD_API+'/files/'+encodeURIComponent(driveFileId)+'?uploadType=media&fields=id,modifiedTime',{method:'PATCH',headers:{'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(db)});
  const result=await response.json();localStorage.setItem(DRIVE_DIRTY_KEY,'0');const now=new Date().toISOString();localStorage.setItem(DRIVE_LAST_SYNC_KEY,now);driveLastError='';setDriveUi('connected','Gesynchroniseerd '+new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}));
  try{await createDailyDriveBackup()}catch(error){console.warn('Dagback-up:',error)}refreshPhotoViews();return result;
}
function dataTimestamp(data){return Date.parse(data?._meta?.updatedAt||0)||0}
function dataSummary(data){
  return `${data?.workOrders?.length||0} werkbonnen, ${data?.objects?.length||0} objecten`;
}
async function reconcileWithDrive(file){
  if(!file){
    await createDriveFile();
    toast('VMMS is voor het eerst in Google Drive opgeslagen.');
    return;
  }
  const remote=await downloadDriveDatabase(file.id);
  const localTime=dataTimestamp(db),remoteTime=dataTimestamp(remote);
  const localDirty=localStorage.getItem(DRIVE_DIRTY_KEY)==='1';
  let useRemote=false;
  if(remoteTime>localTime+1500){
    if(localDirty){
      useRemote=confirm(
        'Google Drive bevat nieuwere gegevens ('+dataSummary(remote)+').\\n\\n'+
        'OK = gegevens uit Google Drive laden\\nAnnuleren = gegevens van dit apparaat naar Drive sturen'
      );
    }else useRemote=true;
  }else if(localTime>remoteTime+1500){
    if(remoteTime&&localDirty){
      const uploadLocal=confirm(
        'Dit apparaat bevat nieuwere gegevens ('+dataSummary(db)+').\\n\\n'+
        'OK = deze gegevens naar Google Drive sturen\\nAnnuleren = Drive-versie laden'
      );
      useRemote=!uploadLocal;
    }
  }else if(!remoteTime&&!localTime){
    const remoteHasWork=(remote.workOrders?.length||0)>0;
    const localHasWork=(db.workOrders?.length||0)>0;
    if(remoteHasWork&&localHasWork){
      useRemote=confirm('Er bestaan lokale én Drive-gegevens.\\n\\nOK = Drive laden\\nAnnuleren = lokale gegevens uploaden');
    }else useRemote=remoteHasWork;
  }
  if(useRemote){
    db=remote;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
    localStorage.setItem(DRIVE_DIRTY_KEY,'0');
    localStorage.setItem(DRIVE_LAST_SYNC_KEY,new Date().toISOString());
    renderView(currentView);
    setDriveUi('connected','Gegevens uit Google Drive geladen');
    toast('Google Drive-gegevens geladen.');
  }else{
    await uploadDriveDatabase();
    toast('Lokale gegevens naar Google Drive gestuurd.');
  }
}
async function connectGoogleDrive(prompt='consent'){
  if(driveSyncing)return;
  driveSyncing=true;setDriveUi('syncing','Verbinden met Google Drive…');
  try{
    await requestDriveAccessToken(prompt);
    const file=driveFileId?{id:driveFileId}:await findDriveFile();
    if(driveFileId&&!file){
      try{await downloadDriveDatabase(driveFileId)}catch{driveFileId='';localStorage.removeItem(DRIVE_FILE_ID_KEY)}
    }
    await reconcileWithDrive(driveFileId?{id:driveFileId}:await findDriveFile());
    refreshPhotoViews();
  }catch(error){
    driveLastError=error.message||String(error);
    setDriveUi('error',driveLastError);
    if(prompt!=='')toast(driveLastError);
  }finally{driveSyncing=false}
}
async function syncNow(){
  if(driveSyncing)return;
  if(!driveAccessToken){await connectGoogleDrive('');return}
  driveSyncing=true;setDriveUi('syncing','Synchroniseren met Google Drive…');
  try{
    if(!driveFileId)await findDriveFile();
    if(!driveFileId)await createDriveFile();else await uploadDriveDatabase();
  }catch(error){
    driveLastError=error.message||String(error);setDriveUi('error',driveLastError);toast(driveLastError);
  }finally{driveSyncing=false}
}
function scheduleDriveSync(){
  if(localStorage.getItem(DRIVE_ENABLED_KEY)!=='1'||!driveConnected)return;
  clearTimeout(driveSyncTimer);
  driveSyncTimer=setTimeout(()=>syncNow(),1400);
}
function disconnectGoogleDrive(){
  if(driveAccessToken&&window.google?.accounts?.oauth2){
    try{google.accounts.oauth2.revoke(driveAccessToken,()=>{})}catch{}
  }
  driveAccessToken='';driveConnected=false;
  localStorage.removeItem(DRIVE_ENABLED_KEY);
  setDriveUi('disconnected','Alleen lokaal opgeslagen');
  toast('Google Drive is losgekoppeld.');
}
async function tryRestoreDriveSession(){
  if(localStorage.getItem(DRIVE_ENABLED_KEY)!=='1'){setDriveUi('disconnected','Alleen lokaal opgeslagen');return}
  setDriveUi('syncing','Google Drive-sessie herstellen…');
  await connectGoogleDrive('');
}

function toast(msg){
  const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400);
}
function addMonths(dateStr,months){
  if(!dateStr||!months)return null;
  const d=new Date(dateStr+'T12:00:00');d.setMonth(d.getMonth()+Number(months));return d;
}
function addDays(dateStr,days){
  if(!dateStr||!days)return null;
  const d=new Date(dateStr+'T12:00:00');d.setDate(d.getDate()+Number(days));return d;
}
function dayDiff(target){
  if(!target)return null;
  const now=new Date();now.setHours(0,0,0,0);target=new Date(target);target.setHours(0,0,0,0);
  return Math.ceil((target-now)/86400000);
}
function maintenanceState(m){
  if(m.applicable===false)return {status:'Niet van toepassing',rank:10};
  const o=objectById(m.objectId);
  if(!o||o.status!=='Actief')return {status:'Niet actief',rank:9};
  const ih=num(m.intervalHours), im=num(m.intervalMonths), idays=num(m.intervalDays);
  const needsMeter=ih>0, needsDate=im>0||idays>0;
  if((needsMeter && (m.lastMeter===''||m.lastMeter==null)) || (needsDate && !m.lastDate)) return {status:'Nog invullen',rank:4};
  const nextDate=idays>0?addDays(normalizeDate(m.lastDate),idays):(im>0?addMonths(normalizeDate(m.lastDate),im):null);
  const remainingDays=nextDate?dayDiff(nextDate):null;
  const nextMeter=needsMeter?num(m.lastMeter)+ih:null;
  const remainingHours=needsMeter?nextMeter-num(o.meter):null;
  const s=db.settings;
  let status='Goed',rank=5;
  if((remainingDays!==null&&remainingDays<=-num(s.urgentDaysOverdue))||(remainingHours!==null&&remainingHours<=-num(s.urgentHoursOverdue))){status='Urgent';rank=1}
  else if((remainingDays!==null&&remainingDays<0)||(remainingHours!==null&&remainingHours<0)){status='Achterstallig';rank=2}
  else if((remainingDays!==null&&remainingDays<=num(s.soonDays))||(remainingHours!==null&&remainingHours<=num(s.soonHours))){status='Binnenkort';rank=3}
  return {status,rank,nextDate:nextDate?nextDate.toISOString().slice(0,10):'',nextMeter,remainingDays,remainingHours};
}
function statusPill(status){return `<span class="status ${slug(status)}">${esc(status)}</span>`}
function workOrderCost(w){return num(w.laborCost)+num(w.materialCost)}
function projectCost(id){return db.workOrders.filter(w=>w.projectId===id).reduce((a,w)=>a+workOrderCost(w),0)}
function maintenanceStats(){
  const rows=db.maintenance.map(m=>({...m,state:maintenanceState(m)}));
  const counts={Goed:0,Binnenkort:0,Achterstallig:0,Urgent:0,'Nog invullen':0,'Niet actief':0,'Niet van toepassing':0};
  rows.forEach(r=>counts[r.state.status]=(counts[r.state.status]||0)+1);
  const valid=counts.Goed+counts.Binnenkort+counts.Achterstallig+counts.Urgent;
  return {rows,counts,health:valid?Math.round(counts.Goed/valid*100):0};
}
function navTo(view){
  currentView=view;
  $$('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+view));
  $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const moreViews=['ship','photos','paintplan','restoration','manuals','projects','victron','costs','parts','documents','inspections','settings'];
  $('#mobileMoreBtn')?.classList.toggle('active',moreViews.includes(view));
  $('#pageTitle').textContent=titles[view]||view;
  renderView(view);
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderView(v){
  ({dashboard:renderDashboard,ship:renderShip,workorder:renderWorkOrder,objects:renderObjects,objectdetail:renderObjectDetail,maintenance:renderMaintenance,inspections:renderInspections,paintplan:renderPaintPlan,ballast:renderBallastTool,manuals:renderManuals,photos:renderPhotos,inspiration:renderInspiration,logbook:renderLogbook,projects:renderProjects,restoration:renderRestoration,victron:renderVictron,costs:renderCosts,parts:renderParts,documents:renderDocuments,settings:renderSettings}[v]||(()=>{}))();
  setTimeout(()=>hydratePhotoImages($('#view-'+v)||document),0);
}

const VMMS_MANUAL_LIBRARY=[{"id":"MAN0001","title":"Daewoo / Doosan L136 – Operation & Maintenance Manual","manufacturer":"Daewoo / Doosan","model":"L136","objectIds":["OBJ0001","OBJ0007","OBJ0008","OBJ0009","OBJ0010","OBJ0011"],"status":"Geverifieerd model","kind":"Bedienings- en onderhoudshandleiding","url":"https://www.manuals.co.uk/doosan/l136/manual","alternateUrl":"https://www.scribd.com/doc/37187304/L136-65-99897-8080-operating-manual","note":"Modelhandleiding gevonden. De onderhoudstabel is in VMMS verwerkt; enkele slecht leesbare tabelregels zijn bewust als voorlopig gemarkeerd."},{"id":"MAN0002","title":"Westerbeke 7.6 BTD / 5.7 BTD 50 Hz – Operators Manual","manufacturer":"Westerbeke","model":"5.7 BTD kandidaat","objectIds":["OBJ0013","OBJ0097"],"status":"Typeplaat controleren","kind":"Officiële bedienings- en onderhoudshandleiding","url":"https://www.westerbeke.com/operator%27s%20manual/40457_rev2_7.6btd_operator_man.pdf","alternateUrl":"https://www.westerbeke.com/operator%27s%20manual/56315%207.6-5.7%20egtd%20operators%20manual%20rev%200.pdf","note":"De advertentie noemt 'Westerbeke 5,7 K2'. Controleer het volledige typenummer op de generator. De ingelezen intervallen zijn voorlopig gebaseerd op de officiële 5,7 kW BTD/EGTD-schema’s."},{"id":"MAN0003","title":"Victron MultiPlus 24/3000/70 – Handleiding","manufacturer":"Victron Energy","model":"Multi 24/3000/70","objectIds":["OBJ0014","OBJ0015"],"status":"Geverifieerde productfamilie","kind":"Officiële handleiding","url":"https://www.victronenergy.com/upload/documents/Manual-MultiPlus-3k-230V-16A-50A-%28firmware-xxxx4xx%29-EN-NL-FR-DE-ES-SE.pdf","note":"Controleer het firmware-/typenummer op het front. Victron schrijft geen vast periodiek intern onderhoud voor; VMMS bevat daarom uitsluitend preventieve visuele controles."},{"id":"MAN0004","title":"Victron SmartSolar MPPT 150/45 – Handleiding","manufacturer":"Victron Energy","model":"SmartSolar MPPT 150/45","objectIds":["OBJ0017"],"status":"Geverifieerd model","kind":"Officiële handleiding","url":"https://www.victronenergy.com/upload/documents/Manual_SmartSolar_MPPT_150-35__150-45/29694-MPPT_solar_charger_manual-pdf-nl.pdf","note":"Vaste onderhoudsintervallen worden niet voorgeschreven; aansluitingen, ventilatie, zekeringen en kabels blijven als VMMS-preventieve controles staan."},{"id":"MAN0005","title":"Victron MPPT 150/75 – exact type nog bevestigen","manufacturer":"Victron Energy","model":"150/75 zoals ingevoerd","objectIds":["OBJ0016"],"status":"Typeplaat controleren","kind":"Handleiding nog niet eenduidig","url":"https://www.victronenergy.com/support-and-downloads/manuals","note":"Een officiële actuele Victron-handleiding voor exact '150/75' is niet eenduidig gevonden. Controleer of het type mogelijk 150/70, 150/85 of een ander model is."},{"id":"MAN0006","title":"Victron Cerbo GX – Handleiding","manufacturer":"Victron Energy","model":"Cerbo GX","objectIds":["OBJ0018"],"status":"Geverifieerd model","kind":"Officiële handleiding","url":"https://www.victronenergy.com/upload/documents/Cerbo_GX/140558-Ekrano_GX__Venus_GX__Cerbo_GX__Cerbo-S_GX_Manual-pdf-en.pdf","note":"Geen vast mechanisch onderhoud; VMMS plant configuratieback-up, alarmlog, firmware- en kabelcontrole als preventieve beheertaken."},{"id":"MAN0007","title":"Victron BMV / SmartShunt – Handleiding","manufacturer":"Victron Energy","model":"BMV / SmartShunt","objectIds":["OBJ0019"],"status":"Productfamilie controleren","kind":"Officiële handleiding","url":"https://www.victronenergy.com/upload/documents/SmartShunt/9172-Manual_BMV_and_SmartShunt-pdf-en.pdf","note":"Controleer of aan boord een BMV-700, BMV-712 of SmartShunt is gemonteerd."},{"id":"MAN0008","title":"Victron Cyrix – Handleiding","manufacturer":"Victron Energy","model":"Cyrix 24 V / 80 A zoals advertentie","objectIds":["OBJ0096"],"status":"Typeplaat controleren","kind":"Officiële productfamiliehandleiding","url":"https://www.victronenergy.com/upload/documents/Manual-Cyrix-ct-120-EN-NL-DE-FR-ES.pdf","note":"De advertentie noemt 80 A; de gevonden huidige Cyrix-documentatie betreft onder andere 120 A. Controleer het etiket voordat zekering- of aansluitwaarden worden overgenomen."},{"id":"MAN0009","title":"Zenith AGM ZL-serie – Gebruikershandleiding","manufacturer":"Zenith","model":"ZL060130 / ZL-serie","objectIds":["OBJ0020"],"status":"Geverifieerde productfamilie","kind":"Accuhandleiding","url":"https://www.accutotaal.com/media/pdf/Manual_Zenith_ZGL-ZL-ZLS-ZLM-ZPC-ZGEL.pdf","alternateUrl":"https://static-eu.insales.ru/files/1/1377/8209761/original/ZL060130.pdf","note":"De ZL-serie is onderhoudsvrij voor elektrolyt. Inspectie, individuele rustspanning en aansluitingen zijn als periodieke taken verwerkt."},{"id":"MAN0010","title":"EVA Calòr – Pelletkachel installatie, gebruik en onderhoud","manufacturer":"EVA Calòr","model":"Sola 15 / pellet hydro productfamilie","objectIds":["OBJ0072","OBJ0079"],"status":"Productfamiliehandleiding","kind":"Officiële instructiehandleiding","url":"https://www.evacalor.com/profiles/evacalor/images/file/2616712844.pdf","note":"Dagelijkse reiniging van branderpot en verbrandingskamer, jaarlijkse rookgasreiniging en jaarlijkse service zijn in VMMS verwerkt."},{"id":"MAN0011","title":"Honeywell Home T6 / T6R – Nederlandse gebruikershandleiding","manufacturer":"Honeywell Home / Resideo","model":"T6 / T6R","objectIds":["OBJ0075"],"status":"Geverifieerde productfamilie","kind":"Officiële gebruikershandleiding","url":"https://homecomfort-techlit.resideo.com/emeadocuments/pim%20-%20renamed/t6-t6r-ug-nl2h32317085-002uk07.pdf","note":"Geen vast onderhoudsschema; VMMS houdt een functionele controle en controle van voeding/instellingen aan."},{"id":"MAN0012","title":"Intergas Kombi Kompakt HRE – Installatiehandleiding","manufacturer":"Intergas","model":"Advertentie: HRE 24/19; handleiding: HRE 24/18 A","objectIds":[],"status":"Historisch / modelverschil","kind":"Officiële installatiehandleiding","url":"https://www.intergas-verwarming.nl/app/uploads/2018/01/Installatievoorschrift-Kombi-Kompakt-HRE-88557803.pdf","alternateUrl":"https://www.intergas-verwarming.nl/app/uploads/2018/01/Bedieningsvoorschrift-Kombi-Kompakt-HRE-88558701.pdf","note":"De verkoopadvertentie noemt HRE 24/19, terwijl officiële documentatie HRE 24/18 A vermeldt. Bovendien is nu een Sola 15 aanwezig. Daarom zijn geen actieve Intergas-onderhoudstaken toegevoegd."},{"id":"MAN0013","title":"Mercury buitenboordmotor – Handleidingzoeker","manufacturer":"Mercury Marine","model":"6 pk, exact type/jaar onbekend","objectIds":["OBJ0104"],"status":"Serienummer nodig","kind":"Officiële handleidingzoeker","url":"https://www.mercurymarine.com/eu/en/parts-and-service/service-and-support/owners-manual","note":"Voor een betrouwbaar schema zijn serienummer, bouwjaar en 2- of 4-taktuitvoering nodig. De huidige onderhoudstaken blijven voorlopig."},{"id":"MAN0014","title":"Dong keerkoppeling – type nog identificeren","manufacturer":"Dong","model":"Onbekend","objectIds":["OBJ0002"],"status":"Typeplaat nodig","kind":"Nog geen passende handleiding","url":"","note":"Maak een foto van de typeplaat. De olie-intervallen in VMMS blijven voorlopig en worden niet als fabrikantvoorschrift aangeduid."},{"id":"MAN0015","title":"Variatie – verkoopadvertentie en uitrustingsbron","manufacturer":"Scheepsmakelaardij Fikkers","model":"Variatie","objectIds":[],"status":"Brongegevens","kind":"Scheepsgegevens","url":"https://fikkers.nl/schepen/steilsteven-variatie-leeuwarden/","note":"Bron voor de opgegeven uitrusting. Controleer altijd of apparatuur sinds de advertentie is vervangen."}];
const VMMS_MANUAL_MAINTENANCE_UPDATES={"MNT0001":{"task":"Motoroliepeil controleren","intervalDays":1,"intervalHours":"","intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Dagelijkse controle vóór gebruik."},"MNT0002":{"intervalDays":"","intervalHours":250,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Eerste verversing na 50 uur; daarna iedere 250 uur."},"MNT0003":{"intervalDays":"","intervalHours":250,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Eerste vervanging na 50 uur; daarna iedere 250 uur."},"MNT0004":{"task":"Luchtfilter reinigen","intervalDays":"","intervalHours":100,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Reinigen iedere 100 uur; eerder bij stoffige omstandigheden."},"MNT0005":{"intervalDays":"","intervalHours":600,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Luchtfilterelement vervangen iedere 600 uur."},"MNT0006":{"intervalDays":"","intervalHours":1000,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Klepspeling controleren en afstellen iedere 1000 uur."},"MNT0007":{"intervalDays":"","intervalHours":100,"intervalMonths":6,"manualId":"MAN0001","basis":"Voorlopig","confidence":"Middel","note":"Handleiding schrijft inspectie en afstelling voor; controlefrequentie als conservatieve VMMS-grens aangehouden."},"MNT0008":{"intervalDays":"","intervalHours":2000,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"V-snaar uiterlijk bij circa 2000 uur vervangen of eerder bij slijtage."},"MNT0009":{"intervalDays":1,"intervalHours":"","intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Dagelijkse visuele controle vóór gebruik."},"MNT0030":{"intervalDays":1,"intervalHours":"","intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Koelvloeistofniveau dagelijks vóór gebruik controleren."},"MNT0031":{"intervalDays":"","intervalHours":1200,"intervalMonths":6,"manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Iedere 1200 uur of 6 maanden, wat het eerst wordt bereikt."},"MNT0034":{"task":"Koelsysteem, warmtewisselaar en waterleidingen reinigen","intervalDays":"","intervalHours":1200,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Reinigen volgens 1200-uursinterval."},"MNT0043":{"intervalDays":"","intervalHours":100,"intervalMonths":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Waterafscheider iedere 100 uur aftappen."},"MNT0044":{"intervalDays":"","intervalHours":250,"intervalMonths":12,"manualId":"MAN0001","basis":"Voorlopig","confidence":"Laag","note":"Brandstoffilter staat in de fabrikantentabel, maar het exacte interval is in de beschikbare scan niet eenduidig leesbaar. Voorlopige veilige VMMS-grens behouden."},"MNT0047":{"intervalDays":"","intervalHours":250,"intervalMonths":12,"manualId":"MAN0001","basis":"Voorlopig","confidence":"Laag","note":"Exact filterinterval op papieren/typegebonden handleiding controleren."},"MNT0053":{"intervalDays":"","intervalHours":100,"intervalMonths":12,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Officieel 5,7 kW BTD/EGTD-schema; exact generatortype op typeplaat bevestigen."},"MNT0054":{"intervalDays":"","intervalHours":100,"intervalMonths":12,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Officieel 5,7 kW BTD/EGTD-schema; exact generatortype bevestigen."},"MNT0055":{"intervalDays":"","intervalHours":250,"intervalMonths":12,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Brandstoffilter en afdichtringen; exact model bevestigen."},"MNT0056":{"intervalDays":"","intervalHours":100,"intervalMonths":12,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Luchtinlaat/filter controleren; exact model bevestigen."},"MNT0057":{"task":"Koelvloeistofsysteem generator onderhouden","intervalDays":"","intervalHours":500,"intervalMonths":60,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"500 uur of 5 jaar in gevonden 5,7 kW-schema; typeplaat bevestigen."},"MNT0058":{"intervalDays":"","intervalHours":50,"intervalMonths":1,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Startaccu en elektrolyt/verbindingen volgens 50 uur of maandelijks schema."},"MNT0060":{"intervalDays":"","intervalHours":250,"intervalMonths":12,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Uitlaatbocht en compleet uitlaatsysteem controleren."},"MNT0084":{"task":"Rustspanning van iedere accu afzonderlijk meten","intervalDays":"","intervalHours":"","intervalMonths":3,"manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Handleiding adviseert 3–4 controles per jaar."},"MNT0085":{"task":"Polen, kabelogen, oxidatie en kabelvastheid controleren","intervalDays":"","intervalHours":"","intervalMonths":3,"manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Handleiding adviseert 4–5 inspecties per jaar."},"MNT0086":{"task":"Accu's controleren op vervorming en bevestiging","intervalDays":"","intervalHours":"","intervalMonths":3,"manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Handleiding adviseert 4–5 inspecties per jaar."},"MNT0087":{"intervalDays":"","intervalHours":"","intervalMonths":3,"manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Controleer ruimte, ventilatie en vervuiling; elektrolyt niet bijvullen."},"MNT0268":{"task":"Branderkamer en warmtewisselaar grondig laten reinigen","intervalDays":"","intervalHours":"","intervalMonths":12,"manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Onderdeel van de jaarlijkse geplande onderhoudsbeurt."},"MNT0269":{"task":"Aslade, vuurhaard en glas reinigen","intervalDays":1,"intervalHours":"","intervalMonths":"","manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Koud dagelijks reinigen vóór gebruik."},"MNT0270":{"task":"Pelletreservoir en vijzelbuis legen aan einde stookseizoen","intervalDays":"","intervalHours":"","intervalMonths":12,"manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Aan het einde van het stookseizoen uitvoeren."},"MNT0271":{"intervalDays":"","intervalHours":"","intervalMonths":6,"manualId":"MAN0010","basis":"VMMS preventief","confidence":"Middel","note":"Visuele controle; vervangen bij beschadiging of lekkage."},"MNT0272":{"task":"Ventilatoren en rookgastraject laten controleren/reinigen","intervalDays":"","intervalHours":"","intervalMonths":12,"manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Bij jaarlijkse service door deskundige."},"MNT0273":{"intervalDays":"","intervalHours":"","intervalMonths":1,"manualId":"MAN0010","basis":"VMMS preventief","confidence":"Middel","note":"Regelmatige gebruikscontrole."},"MNT0274":{"intervalDays":"","intervalHours":"","intervalMonths":12,"manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Jaarlijkse geplande onderhoudsbeurt door servicebedrijf."},"MNT0282":{"manualId":"MAN0011","basis":"VMMS preventief","confidence":"Middel","note":"Functionele controle; fabrikant geeft geen vast periodiek onderhoudsinterval."},"MNT0283":{"manualId":"MAN0011","basis":"VMMS preventief","confidence":"Middel","note":"Voeding/batterijen afhankelijk van exacte T6-uitvoering."},"MNT0284":{"manualId":"MAN0011","basis":"VMMS preventief","confidence":"Middel","note":"Programma, klok, verbinding en setpoints controleren."},"MNT0359":{"manualId":"MAN0013","basis":"Voorlopig","confidence":"Laag","note":"Serienummer en 2-/4-taktuitvoering nodig voor exact interval."},"MNT0360":{"manualId":"MAN0013","basis":"Voorlopig","confidence":"Laag","note":"Serienummer nodig voor exact onderhoudsschema."},"MNT0361":{"manualId":"MAN0013","basis":"Voorlopig","confidence":"Laag","note":"Serienummer nodig voor juiste olie- en schroefprocedure."},"MNT0362":{"manualId":"MAN0013","basis":"Voorlopig","confidence":"Laag","note":"Bougie-interval afhankelijk van exact model."},"MNT0338":{"manualId":"MAN0008","basis":"VMMS preventief","confidence":"Laag","note":"Controleer eerst exact Cyrix-type en stroomwaarde op etiket."},"MNT0339":{"manualId":"MAN0008","basis":"VMMS preventief","confidence":"Laag","note":"Controleer schakeldrempels/werking; exact type nog bevestigen."}};
const VMMS_MANUAL_MAINTENANCE_ADDITIONS=[{"id":"MNT0376","objectId":"OBJ0007","task":"Antivriesconcentratie controleren","intervalHours":600,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Iedere 600 draaiuren.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0377","objectId":"OBJ0001","task":"Intercooler reinigen","intervalHours":1000,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Iedere 1000 draaiuren.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0378","objectId":"OBJ0001","task":"Turbocharger reinigen","intervalHours":2000,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Iedere 2000 draaiuren.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0379","objectId":"OBJ0001","task":"Olieleidingen turbo controleren","intervalHours":250,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Bij iedere motoroliewissel.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0380","objectId":"OBJ0001","task":"Brandstofinspuittiming controleren","intervalHours":"","intervalMonths":12,"intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Jaarlijkse controle; specialistisch werk.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0381","objectId":"OBJ0001","task":"Inspuitnozzles controleren","intervalHours":"","intervalMonths":12,"intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Jaarlijkse controle; specialistisch werk.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0382","objectId":"OBJ0001","task":"Kabelboom en elektrische verbindingen motor controleren","intervalHours":600,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Hoog","note":"Iedere 600 draaiuren.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0383","objectId":"OBJ0008","task":"Zeewaterpompimpeller vervangen","intervalHours":2000,"intervalMonths":"","intervalDays":"","manualId":"MAN0001","basis":"Fabrikant","confidence":"Middel","note":"2000-uursgrens uit onderhoudstabel; visueel eerder controleren.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0384","objectId":"OBJ0013","task":"Dagelijkse voorstartcontrole generator","intervalHours":"","intervalMonths":"","intervalDays":1,"manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Olie, koelvloeistof, lekkage, brandstof/waterafscheider en riem; exact model bevestigen.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0385","objectId":"OBJ0013","task":"Aandrijfriem generator controleren en afstellen","intervalHours":50,"intervalMonths":1,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"50 uur of maandelijks.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0386","objectId":"OBJ0013","task":"Brandstof/waterafscheider generator onderhouden","intervalHours":250,"intervalMonths":12,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"250 uur of jaarlijks.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0387","objectId":"OBJ0013","task":"Elektrische brandstofpomp generator controleren","intervalHours":50,"intervalMonths":1,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"50 uur of maandelijks.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0388","objectId":"OBJ0013","task":"Zinkanode generator controleren/vervangen","intervalHours":50,"intervalMonths":1,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"50 uur of maandelijks; alleen indien dit model een zinkanode heeft.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0389","objectId":"OBJ0013","task":"Rauwwaterpomp generator inspecteren","intervalHours":500,"intervalMonths":60,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"500 uur of 5 jaar.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0390","objectId":"OBJ0013","task":"Klepspeling generator controleren","intervalHours":500,"intervalMonths":60,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"500 uur of 5 jaar; exact model bevestigen.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0391","objectId":"OBJ0013","task":"Warmtewisselaar generator reinigen en druktesten","intervalHours":500,"intervalMonths":60,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"Door deskundige; exact model bevestigen.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0392","objectId":"OBJ0013","task":"Koelwater- en brandstofslangen generator controleren","intervalHours":250,"intervalMonths":12,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"250 uur of jaarlijks.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0393","objectId":"OBJ0013","task":"DC-laaddynamo generator controleren","intervalHours":250,"intervalMonths":12,"intervalDays":"","manualId":"MAN0002","basis":"Voorlopig fabrikant","confidence":"Middel","note":"250 uur of jaarlijks.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0394","objectId":"OBJ0020","task":"Accuposities in de bank afwisselen","intervalHours":"","intervalMonths":4,"intervalDays":"","manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Handleiding adviseert 2–3 keer per jaar om temperatuur- en laadverschillen te beperken.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0395","objectId":"OBJ0020","task":"Laadinstellingen en volledige herlading controleren","intervalHours":"","intervalMonths":12,"intervalDays":"","manualId":"MAN0009","basis":"Fabrikant","confidence":"Hoog","note":"Niet verder dan circa 80% ontladen en na ontlading direct volledig herladen.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0396","objectId":"OBJ0072","task":"Branderpot reinigen","intervalHours":"","intervalMonths":"","intervalDays":1,"manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Bij iedere ontsteking of pelletbijvulling; in VMMS als dagelijkse taak gepland.","lastDate":"","lastMeter":"","lastWorkOrder":""},{"id":"MNT0397","objectId":"OBJ0079","task":"Rookgasafvoer / schoorsteen laten reinigen","intervalHours":"","intervalMonths":12,"intervalDays":"","manualId":"MAN0010","basis":"Fabrikant","confidence":"Hoog","note":"Jaarlijks essentieel; door geschikt vakbedrijf.","lastDate":"","lastMeter":"","lastWorkOrder":""}];

function migrateManualMaintenanceData(data){
  if(!data||!Array.isArray(data.objects)||!Array.isArray(data.maintenance))return false;
  data._meta=data._meta||{};
  const migrationVersion=5;
  if(Number(data._meta.manualMaintenanceMigration||0)>=migrationVersion)return false;
  let changed=false;
  data.manuals=VMMS_MANUAL_LIBRARY.map(x=>({...x}));
  data.maintenance.forEach(m=>{
    if(m.intervalDays==null){m.intervalDays='';changed=true}
    if(m.manualId==null){m.manualId='';changed=true}
    if(m.basis==null){m.basis='VMMS preventief';changed=true}
    if(m.confidence==null){m.confidence='Middel';changed=true}
    const patch=VMMS_MANUAL_MAINTENANCE_UPDATES[m.id];
    if(patch){
      Object.entries(patch).forEach(([key,value])=>{
        if(m[key]!==value){m[key]=value;changed=true}
      });
    }
  });
  VMMS_MANUAL_MAINTENANCE_ADDITIONS.forEach(item=>{
    if(!data.maintenance.some(m=>m.id===item.id)){
      data.maintenance.push({...item,lastDate:'',lastMeter:'',lastWorkOrder:''});
      changed=true;
    }
  });
  data._meta.manualMaintenanceMigration=migrationVersion;
  data._meta.updatedAt=new Date().toISOString();
  return true;
}

const VARIATIE_PHOTOS=[{photoId:'PHT-CUR-001',title:'Huidige foto · open water',caption:'Variatie op open water, boegaanzicht.',group:'current'},{photoId:'PHT-CUR-002',title:'Huidige foto · ligplaats',caption:'Zijaanzicht van de Variatie aan de kade.',group:'current'},{photoId:'PHT-CUR-003',title:'Huidige foto · profiel',caption:'Profiel aan stuurboordzijde.',group:'current'},{photoId:'PHT-CUR-004',title:'Huidige foto · achterschip',caption:'Achter- en zijaanzicht van de Variatie.',group:'current'},{photoId:'PHT-CUR-005',title:'Huidige foto · boegdetail',caption:'Close-up van boeg en voordek.',group:'current'},{photoId:'PHT-CUR-006',title:'Huidige foto · varend profiel',caption:'Variatie varend op open water.',group:'current'},{photoId:'PHT-HIS-001',title:'Historische foto · zwart-wit',caption:'Oud zijaanzicht van de Variatie met tuigage.',group:'historic'},{photoId:'PHT-HIS-002',title:'Historische foto · onderhoud',caption:'Werkzaamheden aan dek bij de historische Variatie.',group:'historic'},{photoId:'PHT-HIS-003',title:'Historische foto · vracht',caption:'Variatie geladen met vracht in zwart-wit.',group:'historic'},{photoId:'PHT-HIS-004',title:'Historische foto · sluis',caption:'Historische opname van de Variatie in een sluis.',group:'historic'},{photoId:'PHT-HIS-005',title:'Historische foto · kleur',caption:'Kleurenfoto van de Variatie in profiel.',group:'historic'},{photoId:'PHT-HIS-006',title:'Historische foto · kleur boeg',caption:'Kleurenfoto van de Variatie schuin van voren.',group:'historic'},{photoId:'PHT-HIS-007',title:'Historische foto · kleur varend',caption:'Kleurenfoto van de Variatie varend op open water.',group:'historic'}];

const VARIATIE_LISTING_SPECS={"sourceUrl":"https://fikkers.nl/schepen/steilsteven-variatie-leeuwarden/","sourceLabel":"Scheepsmakelaardij Fikkers – verkoopadvertentie Variatie","sourceNote":"Brongegevens uit de verkoopadvertentie. Apparatuur kan na de verkoop zijn vervangen of gewijzigd.","general":[["Type","Steilsteven"],["Bouwjaar","1925"],["Werf","Peters Scheepsbouw N.V. te Dedemsvaart"],["Afmetingen","27,4 × 5,12 × 1,00 m"],["Casco","Staal, geklonken en gelast"],["Spantvorm","Rondspant"],["Kielvorm","Platbodem"],["Waterverplaatsing","67 m³"],["Dek","Staal onder houten luizenkap"],["Opbouw / stuurhuis","Staal, geklonken en gelast"],["Besturing","Engels stuurwerk"],["Doorvaarthoogte","ca. 3,7 m; ca. 3,0 m met alles plat"],["Laatste hellingbeurt volgens advertentie","2 december 2024"],["Verfsysteem","1-component"],["CBB / CVO","Geldig tot 17 april 2032"],["Vaargebied","Binnenwater"],["Walaansluitingen","Alle aansluitingen, inclusief riool"]],"interior":[["Indeling","Stuurhut met achteronder; roef met keuken en toilet; woonkamer met open keuken; slaapkamer; badkamer; toilet; slaap-/werkkamer; werkplaats; machinekamer; voorpiek"],["Hutten","2"],["Slaapplaatsen","4"],["Betimmering","Plaatmateriaal en kraaldelen"],["Stahoogte","1,80–2,18 m"],["Verwarming in advertentie","Intergas Kombi-Kompact HRE 24/19 (2011) en houtkachel"],["Keuken","Dubbele spoelbak en vaatwasseraansluiting"],["Kooktoestel","4-pits butagas"],["Warm water","Combiketel en 70 L boiler"],["Drinkwatertank volgens advertentie","1400 L"],["Vuilwatertanks","350 L + 100 L met pomp voor rioolaansluiting"],["Isolatie","Glaswol / steenwol"]],"engine":[["Hoofdmotor","Daewoo L136"],["Vermogen","160 pk / 118 kW"],["Cilinders","6"],["Brandstof","Diesel"],["Draaiuren in advertentie","700 uur"],["Maximumsnelheid","13,8 km/h"],["Kruissnelheid","10,8 km/h"],["Verbruik bij kruissnelheid","ca. 7 L/h"],["Keerkoppeling","Dong"],["Schroef","3-blads"],["Boegmanoeuvre","Koproer"],["Brandstoftanks","950 L hoofdtank + 70 L dagtank"],["Instrumenten","Toerenteller, oliedrukmeter en temperatuurmeter"]],"electrical":[["Boordnet","24 / 230 V"],["Boordaccubank","8 × Zenith AGM deep cycle ZL060130, 410 Ah, 6 V"],["Dynamo hoofdmotor","24 V / 80 A"],["Walstroom","220 V met aardlekschakelaar"],["Omvormer / lader","2 × Victron Multi 24-3000-70"],["Scheidingsrelais","Victron Cyrix 24 V / 80 A"],["Generator","Westerbeke 5,7 K2, bouwjaar 2008"]],"rigging":[["Mast","1 houten mast"],["Lier","Standaard 3-rols zeillier"]],"navigation":[["Marifoons","2 × met ATIS"],["Roerstandaanwijzer","Aanwezig"],["Navigatieverlichting","24 V"],["Schijnwerper","24 V"]],"deck":[["Anker","1"],["Spudpaal","1 telescopische spudpaal"],["Ankerlier","Aanwezig"],["Davits","Aanwezig"],["Bijboot","Schottelvlet met mast en tuig"],["Buitenboordmotor","Mercury 6 pk"]],"safety":[["Reddingsboeien","3, waarvan 1 met joon"],["Zwemvesten","2 volwassenen en 3 kinderen"],["Lenspomp","Aanwezig"],["Brandblussers","3 × schuim 6 L en 1 × poeder 6 L"],["Radarreflector","Aanwezig"],["Gasbun","Aanwezig"]]};

function migrateVariatieListingData(data){
  if(!data||!Array.isArray(data.objects)||!Array.isArray(data.maintenance))return false;
  data._meta=data._meta||{};
  const migrationVersion=4;
  if(Number(data._meta.variatieListingMigration||0)>=migrationVersion)return false;
  let changed=false;
  const getObj=id=>data.objects.find(o=>o.id===id);
  const mergeObj=(id,patch,onlyMeterIfBlank=false)=>{
    let obj=getObj(id);
    if(!obj){obj={id};data.objects.push(obj)}
    Object.entries(patch).forEach(([key,value])=>{
      if(key==='meter'&&onlyMeterIfBlank&&obj.meter!==''&&obj.meter!=null)return;
      if(obj[key]!==value){obj[key]=value;changed=true}
    });
  };
  const addObj=obj=>{if(!getObj(obj.id)){data.objects.push({...obj});changed=true}};
  data.ship={
    ...(data.ship||{}),
    name:'Variatie',type:'Steilsteven',year:1925,
    yard:'Peters Scheepsbouw N.V. te Dedemsvaart',
    dimensions:'27,4 × 5,12 × 1,00 m',displacement:'67 m³',
    specifications:VARIATIE_LISTING_SPECS
  };
  mergeObj('OBJ0001',{name:'Daewoo L136 hoofdmotor',brand:'Daewoo',model:'L136',type:'Motor',system:'Hoofdmotor',location:'Machinekamer',status:'Actief',priority:'Hoog',meterUnit:'Draaiuren',note:'6 cilinders; 160 pk / 118 kW; diesel. Advertentie vermeldde 700 draaiuren, 10,8 km/h kruissnelheid en ca. 7 L/h.'});
  const engine=getObj('OBJ0001');if(engine&&(engine.meter===''||engine.meter==null)){engine.meter=700;changed=true}
  mergeObj('OBJ0002',{name:'Dong keerkoppeling',brand:'Dong',note:'Gekoppeld aan Daewoo L136.'});
  mergeObj('OBJ0004',{name:'3-blads schroef',note:'Volgens verkoopadvertentie 3-blads.'});
  mergeObj('OBJ0013',{name:'Westerbeke 5,7 K2 generator',brand:'Westerbeke',model:'5,7 K2',status:'Actief',installDate:'2008-01-01',meterUnit:'Bedrijfsuren',note:'Bouwjaar 2008 volgens verkoopadvertentie.'});
  mergeObj('OBJ0014',{name:'Victron Multi 24-3000-70 nr. 1',brand:'Victron',model:'Multi 24-3000-70',status:'Actief',note:'Bestaande installatie volgens verkoopadvertentie.'});
  mergeObj('OBJ0015',{name:'Victron Multi 24-3000-70 nr. 2',brand:'Victron',model:'Multi 24-3000-70',status:'Actief',note:'Bestaande installatie volgens verkoopadvertentie.'});
  mergeObj('OBJ0020',{name:'Boordaccubank 8× Zenith AGM 6 V 410 Ah',brand:'Zenith',model:'ZL060130',note:'8 × AGM deep cycle, 6 V, 410 Ah; onderdeel van het 24 V-boordsysteem.'});
  mergeObj('OBJ0021',{name:'Startaccu hoofdmotor',note:'Startaccu voor Daewoo L136.'});
  mergeObj('OBJ0065',{name:'Boiler 70 L',model:'70 L',note:'70 liter volgens verkoopadvertentie.'});
  mergeObj('OBJ0067',{name:'Vuilwatertank 350 L',model:'350 L',note:'Met pomp voor rioolaansluiting.'});
  mergeObj('OBJ0083',{name:'Brandblussers: 3× schuim 6 L + 1× poeder 6 L',note:'Aantal en typen volgens verkoopadvertentie.'});
  mergeObj('OBJ0086',{name:'Zwemvesten: 2 volwassenen + 3 kinderen',note:'Aantallen volgens verkoopadvertentie.'});
  mergeObj('OBJ0087',{name:'Reddingsboeien: 3 stuks, 1 met joon',note:'Aantallen volgens verkoopadvertentie.'});
  const extraObjects=[{"id":"OBJ0096","name":"Victron Cyrix 24 V / 80 A scheidingsrelais","type":"Verdeelbord","system":"Electra binnen","location":"Technische ruimte","brand":"Victron","model":"Cyrix 24 V 80 A","serial":"","status":"Actief","priority":"Normaal","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0097","name":"Startaccu generator","type":"Accu","system":"Electra binnen","location":"Machinekamer","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Startaccu van Westerbeke generator."},{"id":"OBJ0098","name":"Diesel hoofdtank 950 L","type":"Tank","system":"Hoofdmotor","location":"Machinekamer","brand":"","model":"950 L","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Inhoud volgens verkoopadvertentie."},{"id":"OBJ0099","name":"Diesel dagtank 70 L","type":"Tank","system":"Hoofdmotor","location":"Machinekamer","brand":"","model":"70 L","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Inhoud volgens verkoopadvertentie."},{"id":"OBJ0100","name":"Koproer","type":"Aandrijving","system":"Staal buiten","location":"Voorschip","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Voor manoeuvreren; genoemd als boegschroefvoorziening in advertentie."},{"id":"OBJ0101","name":"Telescopische spudpaal","type":"Romp/dek","system":"Staal buiten","location":"Dek","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Telescopische spudpaal volgens verkoopadvertentie."},{"id":"OBJ0102","name":"Davits","type":"Romp/dek","system":"Staal buiten","location":"Achterdek","brand":"","model":"","serial":"","status":"Actief","priority":"Normaal","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0103","name":"Schottelvlet met mast en tuig","type":"Romp/dek","system":"Staal buiten","location":"Dek","brand":"","model":"","serial":"","status":"Actief","priority":"Normaal","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Bijboot volgens verkoopadvertentie."},{"id":"OBJ0104","name":"Mercury buitenboordmotor 6 pk","type":"Motor","system":"Hoofdmotor","location":"Dek","brand":"Mercury","model":"6 pk","serial":"","status":"Actief","priority":"Normaal","installDate":"","documentLink":"","meter":"","meterUnit":"Bedrijfsuren","note":"Buitenboordmotor van de bijboot."},{"id":"OBJ0105","name":"Marifoon 1 met ATIS","type":"Monitoring","system":"Electra binnen","location":"Stuurhut","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0106","name":"Marifoon 2 met ATIS","type":"Monitoring","system":"Electra binnen","location":"Stuurhut","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0107","name":"Roerstandaanwijzer","type":"Monitoring","system":"Electra binnen","location":"Stuurhut","brand":"","model":"","serial":"","status":"Actief","priority":"Normaal","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0108","name":"Radarreflector","type":"Veiligheidsmiddel","system":"Veiligheid","location":"Mast","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Volgens verkoopadvertentie."},{"id":"OBJ0109","name":"Gasbun","type":"Veiligheidsmiddel","system":"Veiligheid","location":"Dek","brand":"","model":"","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Voor butagasinstallatie; ventilatie en afvoer vrijhouden."},{"id":"OBJ0110","name":"Vuilwatertank 100 L","type":"Tank","system":"Water & sanitair","location":"Diverse","brand":"","model":"100 L","serial":"","status":"Actief","priority":"Hoog","installDate":"","documentLink":"","meter":"","meterUnit":"","note":"Tweede vuilwatertank volgens verkoopadvertentie."}];
  extraObjects.forEach(addObj);
  const extraMaintenance=[{"id":"MNT0338","objectId":"OBJ0096","task":"Aansluitingen en kabels controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0339","objectId":"OBJ0096","task":"Werking scheidingsrelais testen","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0340","objectId":"OBJ0097","task":"Accuspanning en laadspanning controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0341","objectId":"OBJ0097","task":"Accupolen, kabels en bevestiging controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0342","objectId":"OBJ0098","task":"Tank en aansluitingen controleren op lekkage","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0343","objectId":"OBJ0098","task":"Water en bezinksel aftappen / controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0344","objectId":"OBJ0098","task":"Ontluchting en vulleiding controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0345","objectId":"OBJ0099","task":"Dagtank en aansluitingen controleren op lekkage","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0346","objectId":"OBJ0099","task":"Water en bezinksel aftappen / controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0347","objectId":"OBJ0099","task":"Ontluchting en afsluiters controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0348","objectId":"OBJ0100","task":"Koproer en lagering inspecteren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0349","objectId":"OBJ0100","task":"Bediening en volledige uitslag testen","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0350","objectId":"OBJ0100","task":"Draaipunten en mechaniek smeren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0351","objectId":"OBJ0101","task":"Spudpaal reinigen en visueel inspecteren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0352","objectId":"OBJ0101","task":"Hefmechanisme en geleiding smeren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0353","objectId":"OBJ0101","task":"Borging en bediening testen","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0354","objectId":"OBJ0102","task":"Davits, lassen en bevestigingen controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0355","objectId":"OBJ0102","task":"Draaipunten, kabels en lieren smeren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0356","objectId":"OBJ0103","task":"Bijbootromp en lekkage controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0357","objectId":"OBJ0103","task":"Mast, tuig en lijnen van bijboot controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0358","objectId":"OBJ0103","task":"Bevestiging in davits controleren","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0359","objectId":"OBJ0104","task":"Buitenboordmotor proefdraaien en koelwaterstraal controleren","intervalHours":25,"intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0360","objectId":"OBJ0104","task":"Brandstofsysteem en slangen controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0361","objectId":"OBJ0104","task":"Staartstukolie en schroef controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0362","objectId":"OBJ0104","task":"Bougie en ontsteking controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0363","objectId":"OBJ0105","task":"Marifoon zenden en ontvangen testen","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0364","objectId":"OBJ0105","task":"ATIS, antenne en bekabeling controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0365","objectId":"OBJ0106","task":"Marifoon zenden en ontvangen testen","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0366","objectId":"OBJ0106","task":"ATIS, antenne en bekabeling controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0367","objectId":"OBJ0107","task":"Roerstandaanwijzer vergelijken met werkelijke roerstand","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0368","objectId":"OBJ0107","task":"Sensor, bekabeling en display controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0369","objectId":"OBJ0108","task":"Radarreflector en bevestiging inspecteren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0370","objectId":"OBJ0109","task":"Gasbun ventilatie en bodemafvoer controleren","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0371","objectId":"OBJ0109","task":"Gasflessen en bevestiging controleren","intervalHours":"","intervalMonths":3,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0372","objectId":"OBJ0109","task":"Slangen, regelaar en afsluiters controleren","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0373","objectId":"OBJ0110","task":"Vuilwatertank controleren op lekkage","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0374","objectId":"OBJ0110","task":"Tank reinigen en doorspoelen","intervalHours":"","intervalMonths":12,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."},{"id":"MNT0375","objectId":"OBJ0110","task":"Ontluchting, niveausensor en pompverbinding controleren","intervalHours":"","intervalMonths":6,"lastDate":"","lastMeter":"","lastWorkOrder":"","note":"Richtinterval; controleer handleiding en huidige installatie."}];
  extraMaintenance.forEach(item=>{if(!data.maintenance.some(m=>m.id===item.id)){data.maintenance.push({...item});changed=true}});
  data._meta.variatieListingMigration=migrationVersion;
  data._meta.updatedAt=new Date().toISOString();
  return true;
}

function quickMeterObject(id,fallbackText){
  return objectById(id)||db.objects.find(o=>String(o.name||'').toLowerCase().includes(String(fallbackText).toLowerCase()));
}
function meterUpdatedText(o){
  if(!o?.lastMeterUpdate)return 'Nog niet bijgewerkt';
  const d=new Date(o.lastMeterUpdate);
  return isNaN(d)?'Nog niet bijgewerkt':'Bijgewerkt '+d.toLocaleString('nl-NL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function saveQuickMeter(objectId,inputId){
  const o=objectById(objectId);
  const input=$('#'+inputId);
  if(!o||!input){toast('Object of invoerveld niet gevonden.');return}
  const raw=String(input.value||'').trim();
  if(raw===''){toast('Vul eerst een tellerstand in.');input.focus();return}
  const value=Number(raw.replace(',','.'));
  if(!Number.isFinite(value)||value<0){toast('Vul een geldige tellerstand in.');input.focus();return}
  const oldValue=o.meter===''||o.meter==null?null:Number(o.meter);
  if(Number.isFinite(oldValue)&&value<oldValue){
    if(!confirm(`De nieuwe stand (${value}) is lager dan de huidige stand (${oldValue}). Toch opslaan?`))return;
  }
  o.meter=value;
  o.lastMeterUpdate=new Date().toISOString();
  saveData();
  renderDashboard();
  toast(`${o.name}: ${value} ${o.meterUnit||'uur'} opgeslagen`);
}


function renderShip(){
  const ship=db.ship||{};
  const specs=ship.specifications||VARIATIE_LISTING_SPECS;
  const groups=[
    ['Algemeen','general'],['Interieur','interior'],['Hoofdmotor en aandrijving','engine'],
    ['Elektrische installatie','electrical'],['Tuigage','rigging'],['Navigatie','navigation'],
    ['Dekuitrusting','deck'],['Veiligheid','safety']
  ];
  $('#view-ship').innerHTML=`
  <div class="note"><b>Brongegevens:</b> ${esc(specs.sourceLabel||'Verkoopadvertentie')}. ${esc(specs.sourceNote||'Controleer de huidige situatie aan boord.')} <a href="${esc(specs.sourceUrl||'#')}" target="_blank" rel="noopener">Bron openen</a></div>
  <div class="ship-hero card">
    <div><span class="meter-label">Schip</span><h3>${esc(ship.name||'Variatie')}</h3><p>${esc(ship.type||'Steilsteven')} · bouwjaar ${esc(ship.year||1925)}</p><div class="hero-photo-actions"><button class="btn small" data-view="photos">Open fotogalerij</button></div></div>
    <div class="ship-facts"><div><span>Afmetingen</span><b>${esc(ship.dimensions||'27,4 × 5,12 × 1,00 m')}</b></div><div><span>Werf</span><b>${esc(ship.yard||'Peters Scheepsbouw')}</b></div><div><span>Waterverplaatsing</span><b>${esc(ship.displacement||'67 m³')}</b></div></div>
  </div>
  <div class="card ship-photo-preview">
    ${photoImgHtml('PHT-CUR-001','Variatie op open water')}
    <div><span class="meter-label">Fotovoorbeeld</span><h3>Fotogalerij Variatie</h3><p>Huidige en historische foto's van het schip zijn nu onderdeel van VMMS. Handig voor documentatie, restauratie en referentie.</p><button class="btn" data-view="photos">Bekijk alle foto's</button></div>
  </div>
  <div class="ship-spec-grid">${groups.map(([title,key])=>`
    <div class="card ship-spec-card"><div class="section-title"><h3>${esc(title)}</h3></div>
      <dl>${(specs[key]||[]).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    </div>`).join('')}
  </div>`;
}


function weatherCodeInfo(code){
  const value=Number(code);
  if(value===0)return {icon:'☀️',label:'Helder'};
  if([1,2].includes(value))return {icon:'🌤️',label:'Licht bewolkt'};
  if(value===3)return {icon:'☁️',label:'Bewolkt'};
  if([45,48].includes(value))return {icon:'🌫️',label:'Mist'};
  if([51,53,55,56,57].includes(value))return {icon:'🌦️',label:'Motregen'};
  if([61,63,65,66,67].includes(value))return {icon:'🌧️',label:'Regen'};
  if([71,73,75,77,85,86].includes(value))return {icon:'❄️',label:'Sneeuw'};
  if([80,81,82].includes(value))return {icon:'🌦️',label:'Buien'};
  if([95,96,99].includes(value))return {icon:'⛈️',label:'Onweer'};
  return {icon:'🌥️',label:'Wisselend'};
}
function clampScore(value){return Math.max(0,Math.min(100,Math.round(value)))}
function weatherAdviceLevel(score){
  if(score>=75)return {key:'good',label:'Geschikt'};
  if(score>=50)return {key:'warn',label:'Alleen met controle'};
  return {key:'bad',label:'Niet verstandig'};
}
function weatherDayHours(data,date){
  const times=data.hourly?.time||[];
  return times.map((time,index)=>({time,index,hour:Number(String(time).slice(11,13))}))
    .filter(item=>String(item.time).startsWith(date)&&item.hour>=8&&item.hour<=18);
}
function average(values){const list=values.filter(Number.isFinite);return list.length?list.reduce((a,b)=>a+b,0)/list.length:0}
function maxValue(values){const list=values.filter(Number.isFinite);return list.length?Math.max(...list):0}
function minValue(values){const list=values.filter(Number.isFinite);return list.length?Math.min(...list):0}
function weatherDayProfile(data,index){
  const date=data.daily.time[index];
  const hours=weatherDayHours(data,date);
  const get=name=>hours.map(item=>Number(data.hourly?.[name]?.[item.index]));
  const temperatures=get('temperature_2m');
  const humidity=get('relative_humidity_2m');
  const probability=get('precipitation_probability');
  const precipitation=get('precipitation');
  const wind=get('wind_speed_10m');
  const gusts=get('wind_gusts_10m');

  const minTemp=minValue(temperatures);
  const maxTemp=maxValue(temperatures);
  const avgHumidity=average(humidity);
  const maxProbability=maxValue(probability);
  const rainSum=precipitation.filter(Number.isFinite).reduce((a,b)=>a+b,0);
  const maxWind=maxValue(wind);
  const maxGust=maxValue(gusts);
  const dryHours=hours.filter((item,j)=>
    Number(probability[j]||0)<=20 && Number(precipitation[j]||0)<=0.1
  ).length;

  let paint=100-maxProbability*.75-rainSum*15-Math.max(0,avgHumidity-72)*1.5-
    Math.max(0,maxWind-4)*11-Math.max(0,maxGust-7)*6;
  if(minTemp<8)paint-=(8-minTemp)*8;
  if(maxTemp>28)paint-=(maxTemp-28)*5;
  if(dryHours<6)paint-=(6-dryHours)*10;

  let rigging=100-maxProbability*.8-rainSum*18-
    Math.max(0,maxWind-4)*14-Math.max(0,maxGust-7)*8;
  if(dryHours<6)rigging-=(6-dryHours)*10;
  if(minTemp<2)rigging-=15;

  let steel=100-maxProbability*.65-rainSum*14-
    Math.max(0,maxWind-6)*9-Math.max(0,maxGust-10)*5;
  if(dryHours<5)steel-=(5-dryHours)*9;
  if(minTemp<3)steel-=(3-minTemp)*6;

  let cleaning=92-maxProbability*.25-rainSum*3-
    Math.max(0,maxWind-8)*8-Math.max(0,maxGust-13)*4;
  if(maxTemp<5)cleaning-=(5-maxTemp)*8;

  const outdoorBest=Math.max(paint,rigging,steel,cleaning);
  const inside=clampScore(72+(100-outdoorBest)*.25);

  return {
    date,
    code:Number(data.daily.weather_code[index]),
    min:Number(data.daily.temperature_2m_min[index]),
    max:Number(data.daily.temperature_2m_max[index]),
    rain:Number(data.daily.precipitation_sum[index]),
    probability:Number(data.daily.precipitation_probability_max[index]),
    wind:Number(data.daily.wind_speed_10m_max[index]),
    gust:Number(data.daily.wind_gusts_10m_max[index]),
    humidity:Math.round(avgHumidity),
    dryHours,
    scores:{
      paint:clampScore(paint),rigging:clampScore(rigging),
      steel:clampScore(steel),cleaning:clampScore(cleaning),inside
    }
  };
}
function weatherTaskCategory(task,object){
  const text=[task,object?.name,object?.type,object?.system,object?.location].join(' ').toLowerCase();
  if(/schilder|verf|lak|coating|primer|conserver|roest|antifouling/.test(text))return 'paint';
  if(/mast|want|tuig|zeil|gaffel|giek|strijk|hoogte|radarreflector/.test(text))return 'rigging';
  if(/las|slijp|staal|dek|romp|luik|spud|anker|bolder|lier|zwaard/.test(text))return 'steel';
  if(/reinig|schoon|wassen|spoel|aslade|branderpot|poets/.test(text))return 'cleaning';
  return 'inside';
}
function weatherCategoryInfo(key){
  return {
    paint:{icon:'🎨',label:'Schilderen en coaten'},
    rigging:{icon:'⛵',label:'Mast, tuigage en hoogtewerk'},
    steel:{icon:'🛠️',label:'Staal- en dekwerk buiten'},
    cleaning:{icon:'🧽',label:'Reinigen en afspuiten'},
    inside:{icon:'🔧',label:'Binnenwerk en techniek'}
  }[key];
}
function weatherDayBestCategory(profile){
  const outdoor=['paint','rigging','steel','cleaning']
    .map(key=>({key,score:profile.scores[key]}))
    .sort((a,b)=>b.score-a.score);
  if(outdoor[0].score<50)return {key:'inside',score:profile.scores.inside};
  return outdoor[0];
}
function weatherRecommendedTasks(profile,limit=5){
  const {rows}=maintenanceStats();
  const candidates=rows.filter(row=>row.state.rank<=4)
    .map(row=>{
      const object=objectById(row.objectId);
      const category=weatherTaskCategory(row.task,object);
      return {...row,object,category,weatherScore:profile.scores[category]||0};
    })
    .filter(row=>row.weatherScore>=50)
    .sort((a,b)=>a.state.rank-b.state.rank||b.weatherScore-a.weatherScore);
  return candidates.slice(0,limit);
}
function weatherDateLabel(date){
  return new Date(date+'T12:00:00').toLocaleDateString('nl-NL',{
    weekday:'short',day:'numeric',month:'short'
  });
}
function readWeatherCache(){
  try{return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)||'null')}catch{return null}
}
async function fetchWeatherForecast(force=false){
  const latitude=Number(db.settings.weatherLatitude||53.2012);
  const longitude=Number(db.settings.weatherLongitude||5.7999);
  const cache=readWeatherCache();
  const cacheKey=`${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if(!force&&cache&&cache.key===cacheKey&&Date.now()-cache.savedAt<WEATHER_CACHE_MS)return cache.data;

  const params=new URLSearchParams({
    latitude:String(latitude),longitude:String(longitude),
    current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly:'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset',
    timezone:'auto',forecast_days:'7',wind_speed_unit:'ms'
  });
  const response=await fetch('https://api.open-meteo.com/v1/forecast?'+params.toString(),{cache:'no-store'});
  if(!response.ok)throw new Error('Weersverwachting kon niet worden opgehaald.');
  const data=await response.json();
  localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({key:cacheKey,savedAt:Date.now(),data}));
  return data;
}
function renderWeatherForecast(data){
  const host=$('#weatherAdvicePanel');if(!host)return;
  const profiles=(data.daily?.time||[]).map((_,index)=>weatherDayProfile(data,index));
  const today=profiles[0];
  const current=data.current||{};
  const info=weatherCodeInfo(current.weather_code);
  const recommended=weatherRecommendedTasks(today,5);
  const categoryKeys=['paint','rigging','steel','cleaning','inside'];

  host.innerHTML=`
    <div class="section-title weather-title">
      <div><span class="meter-label">Weer & klusadvies</span><h3>${esc(db.settings.weatherLocationName||'Leeuwarden')}</h3></div>
      <div class="section-actions"><button class="btn secondary small" id="refreshWeather">Vernieuwen</button><button class="btn secondary small" data-view="settings">Locatie</button></div>
    </div>
    <div class="weather-current">
      <div class="weather-current-icon">${info.icon}</div>
      <div><strong>${Math.round(Number(current.temperature_2m||0))}°C</strong><span>${esc(info.label)} · gevoel ${Math.round(Number(current.apparent_temperature||0))}°C</span></div>
      <div><b>${Math.round(Number(current.wind_speed_10m||0)*3.6)} km/u</b><span>wind · vlagen ${Math.round(Number(current.wind_gusts_10m||0)*3.6)} km/u</span></div>
      <div><b>${Math.round(Number(current.relative_humidity_2m||0))}%</b><span>luchtvochtigheid</span></div>
    </div>
    <div class="weather-advice-grid">
      ${categoryKeys.map(key=>{
        const item=weatherCategoryInfo(key),score=today.scores[key],level=weatherAdviceLevel(score);
        return `<div class="weather-advice ${level.key}"><span class="weather-advice-icon">${item.icon}</span><div><b>${esc(item.label)}</b><small>${esc(level.label)} · score ${score}/100</small></div></div>`;
      }).join('')}
    </div>
    <div class="weather-task-advice">
      <div class="section-title"><div><h3>Klusjes die vandaag passen</h3><small>Gebaseerd op het weer én open onderhoud in VMMS.</small></div></div>
      <div class="weather-task-list">
        ${recommended.length?recommended.map(row=>`<button class="weather-task" data-object-page="${esc(row.objectId)}"><span>${weatherCategoryInfo(row.category).icon}</span><div><b>${esc(row.object?.name||row.objectId)}</b><small>${esc(row.task)} · ${weatherAdviceLevel(row.weatherScore).label}</small></div>${statusPill(row.state.status)}</button>`).join(''):'<div class="empty">Geen passende open onderhoudstaken gevonden. Binnenwerk, documentatie en inspecties kunnen meestal wel.</div>'}
      </div>
    </div>
    <div class="weather-days">
      ${profiles.map(profile=>{
        const dayInfo=weatherCodeInfo(profile.code);
        const best=weatherDayBestCategory(profile);
        const bestInfo=weatherCategoryInfo(best.key);
        const level=weatherAdviceLevel(best.score);
        return `<article class="weather-day"><div class="weather-day-head"><b>${esc(weatherDateLabel(profile.date))}</b><span>${dayInfo.icon}</span></div><strong>${Math.round(profile.max)}° / ${Math.round(profile.min)}°</strong><small>${esc(dayInfo.label)} · regen ${Math.round(profile.probability)}%</small><small>wind ${Math.round(profile.wind*3.6)} · vlagen ${Math.round(profile.gust*3.6)} km/u</small><div class="weather-best ${level.key}">${bestInfo.icon} ${esc(bestInfo.label)}</div></article>`;
      }).join('')}
    </div>
    <p class="weather-disclaimer">Modelverwachting en automatisch advies. Controleer vóór buitenwerk altijd de werkelijke wind, neerslag, ondergrond en veiligheid aan boord. Weerdata: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
  $('#refreshWeather')?.addEventListener('click',()=>loadWeatherAdvice(true));
  $$('[data-object-page]',host).forEach(button=>button.addEventListener('click',()=>openObjectPage(button.dataset.objectPage)));
}
async function loadWeatherAdvice(force=false){
  const host=$('#weatherAdvicePanel');if(!host)return;
  host.innerHTML='<div class="weather-loading"><span>🌦️</span><div><b>Weer en klusadvies laden…</b><small>Locatie: '+esc(db.settings.weatherLocationName||'Leeuwarden')+'</small></div></div>';
  try{
    const data=await fetchWeatherForecast(force);
    if($('#weatherAdvicePanel'))renderWeatherForecast(data);
  }catch(error){
    const cache=readWeatherCache();
    if(cache?.data){renderWeatherForecast(cache.data);toast('Offline: laatst opgeslagen weersverwachting getoond.')}
    else host.innerHTML=`<div class="empty">Het weer kon niet worden geladen. Controleer internet of de locatie bij Instellingen.<br><small>${esc(error.message)}</small></div>`;
  }
}
async function saveWeatherLocation(event){
  event.preventDefault();
  const input=String(new FormData(event.currentTarget).get('weatherLocation')||'').trim();
  if(input.length<2){toast('Vul een plaatsnaam in.');return}
  const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;button.textContent='Zoeken…';
  try{
    const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({
      name:input,count:'10',language:'nl',format:'json'
    }),{cache:'no-store'});
    if(!response.ok)throw new Error('Locatie zoeken is mislukt.');
    const data=await response.json();
    const result=(data.results||[]).find(item=>String(item.name).toLowerCase()===input.toLowerCase()&&item.country_code==='NL')
      ||(data.results||[]).find(item=>item.country_code==='NL')
      ||data.results?.[0];
    if(!result)throw new Error('Geen passende locatie gevonden.');
    db.settings.weatherLocationName=[result.name,result.admin1].filter(Boolean).join(', ');
    db.settings.weatherLatitude=Number(result.latitude);
    db.settings.weatherLongitude=Number(result.longitude);
    localStorage.removeItem(WEATHER_CACHE_KEY);
    saveData();toast('Weerlocatie opgeslagen: '+db.settings.weatherLocationName);renderSettings();
  }catch(error){toast(error.message||'Locatie kon niet worden opgeslagen.')}
  finally{button.disabled=false;button.textContent='Locatie zoeken en opslaan'}
}
function useDeviceWeatherLocation(){
  if(!navigator.geolocation){toast('Locatiebepaling wordt niet ondersteund.');return}
  toast('Telefoonlocatie bepalen…');
  navigator.geolocation.getCurrentPosition(position=>{
    db.settings.weatherLocationName='Huidige telefoonlocatie';
    db.settings.weatherLatitude=Number(position.coords.latitude);
    db.settings.weatherLongitude=Number(position.coords.longitude);
    localStorage.removeItem(WEATHER_CACHE_KEY);saveData();renderSettings();toast('Telefoonlocatie opgeslagen.');
  },()=>toast('De telefoonlocatie kon niet worden bepaald.'),{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
}


const DAY_PLAN_KEY='vmms_day_plan_hours_v1';
function estimatedTaskHours(row){
  const category=weatherTaskCategory(row.task,objectById(row.objectId));
  return {paint:2.5,rigging:2.0,steel:3.0,cleaning:1.25,inside:1.5}[category]||1.5;
}
function buildSmartDayPlan(hours=4,profile=null){
  const available=Math.max(.5,num(hours)||4);let remaining=available;
  const rows=maintenanceStats().rows
    .filter(row=>row.state.rank<=4&&row.applicable!==false)
    .map(row=>{const category=weatherTaskCategory(row.task,objectById(row.objectId));const weatherScore=profile?(profile.scores[category]||0):(category==='inside'?90:60);return {...row,category,weatherScore,estimate:estimatedTaskHours(row)}})
    .filter(row=>row.category==='inside'||row.weatherScore>=50)
    .sort((a,b)=>a.state.rank-b.state.rank||b.weatherScore-a.weatherScore||a.estimate-b.estimate);
  const plan=[];
  for(const row of rows){
    if(row.estimate<=remaining+.15){plan.push(row);remaining-=row.estimate}
    if(remaining<.5)break;
  }
  const openInspections=(db.inspections||[]).filter(item=>!['Afgerond','Gesloten'].includes(item.status)).sort((a,b)=>({Urgent:1,Plannen:2,Observeren:3}[a.severity]||4)-({Urgent:1,Plannen:2,Observeren:3}[b.severity]||4));
  for(const item of openInspections){if(remaining<.75)break;plan.push({inspection:item,estimate:Math.min(1.5,remaining),category:'inside',weatherScore:90});remaining-=Math.min(1.5,remaining)}
  return {available,remaining:Math.max(0,remaining),plan};
}
async function loadSmartDayPlan(hours){
  const host=$('#smartDayPlanBody');if(!host)return;
  host.innerHTML='<div class="empty">Klusdag berekenen…</div>';
  let profile=null;
  try{const data=await fetchWeatherForecast(false);profile=weatherDayProfile(data,0)}catch{}
  const result=buildSmartDayPlan(hours,profile);
  const rows=result.plan.map((row,index)=>{
    if(row.inspection){const item=row.inspection;return `<button class="day-plan-row" data-view="inspections"><span class="day-plan-number">${index+1}</span><div><b>Inspectie ${esc(item.zone)}</b><small>${esc(item.issue)} · ${esc(item.severity)}</small></div><strong>${row.estimate.toFixed(1)} u</strong></button>`}
    const object=objectById(row.objectId);return `<button class="day-plan-row" data-object-page="${esc(row.objectId)}"><span class="day-plan-number">${index+1}</span><div><b>${esc(object?.name||row.objectId)}</b><small>${esc(row.task)}</small></div><strong>${row.estimate.toFixed(1)} u</strong></button>`;
  }).join('');
  host.innerHTML=rows||'<div class="empty">Geen passende urgente klus gevonden. Gebruik de onderhoudsnulmeting of werk documentatie bij.</div>';
  $('#smartDaySummary').textContent=result.plan.length?`${result.plan.length} klusjes · circa ${(result.available-result.remaining).toFixed(1)} van ${result.available.toFixed(1)} uur gepland`:'Geen passend plan';
  $$('[data-object-page]',host).forEach(button=>button.onclick=()=>openObjectPage(button.dataset.objectPage));
}
function saveDayPlanHours(){const hours=Math.max(.5,num($('#dayPlanHours')?.value)||4);localStorage.setItem(DAY_PLAN_KEY,String(hours));db.settings.dayPlanHours=hours;saveData();loadSmartDayPlan(hours)}

function renderDashboard(){
  const {rows,counts,health}=maintenanceStats();
  const year=new Date().getFullYear();
  const yearCost=db.workOrders.filter(w=>new Date(w.date).getFullYear()===year).reduce((a,w)=>a+workOrderCost(w),0);
  const openProjects=db.projects.filter(p=>p.status==='Bezig').length;
  const sourcingOpen=(db.restorationSourcing?.items||[]).filter(item=>!['Gekocht','Afgewezen'].includes(item.status));
  const expiringCerts=(db.certificates||[]).filter(c=>c.expiryDate&&dayDiff(new Date(c.expiryDate))<=90).sort((a,b)=>String(a.expiryDate).localeCompare(String(b.expiryDate)));
  const todayItems=rows.filter(r=>r.state.rank<=3).slice(0,6);
  const upcoming=rows.filter(r=>r.state.rank<=4).sort((a,b)=>a.state.rank-b.state.rank||(a.state.remainingDays??999999)-(b.state.remainingDays??999999)).slice(0,10);
  const total=Math.max(1,counts.Goed+counts.Binnenkort+counts.Achterstallig+counts.Urgent+counts['Nog invullen']);
  const degs={
    good:counts.Goed/total*360,
    soon:counts.Binnenkort/total*360,
    overdue:counts.Achterstallig/total*360,
    urgent:counts.Urgent/total*360
  };
  const a=degs.good,b=a+degs.soon,c=b+degs.overdue,d=c+degs.urgent;
  const months=Array.from({length:12},(_,i)=>new Date(2024,i,1).toLocaleDateString('nl-NL',{month:'short'}));
  const monthVals=Array(12).fill(0);
  db.workOrders.forEach(w=>{const dt=new Date(w.date);if(dt.getFullYear()===year)monthVals[dt.getMonth()]+=workOrderCost(w)});
  const max=Math.max(1,...monthVals);
  const mainEngine=quickMeterObject('OBJ0001','DAF 575');
  const generator=quickMeterObject('OBJ0013','Generator');
  $('#view-dashboard').innerHTML=`
  <div class="card today-panel">
    <div class="section-title"><div><span class="meter-label">Vandaag</span><h3>Wat vraagt nu aandacht?</h3></div><div class="section-actions"><button class="btn secondary small" id="todayReport">PDF-rapport</button><button class="btn small" data-view="workorder">Nieuwe werkbon</button></div></div>
    <div class="today-grid">
      <div class="today-column"><b>Onderhoud</b>${todayItems.length?todayItems.map(r=>`<button class="today-item" data-object-page="${esc(r.objectId)}"><span>${statusPill(r.state.status)}</span><strong>${esc(objectById(r.objectId)?.name||r.objectId)}</strong><small>${esc(r.task)}</small></button>`).join(''):'<div class="empty">Geen urgent onderhoud.</div>'}</div>
      <div class="today-column"><b>Restauratie-inkoop</b>${sourcingOpen.length?sourcingOpen.slice(0,5).map(item=>`<div class="today-item static"><strong>${esc(item.name)}</strong><small>${esc(item.status)} · ${esc(item.priority)}</small></div>`).join(''):'<div class="empty">Geen open zoekitems.</div>'}<button class="btn secondary small" data-view="parts">Open tweedehands zoeken</button></div>
      <div class="today-column"><b>Certificaten</b>${expiringCerts.length?expiringCerts.slice(0,5).map(c=>`<div class="today-item static"><strong>${esc(c.name)}</strong><small>${dateNL(c.expiryDate)}</small></div>`).join(''):'<div class="empty">Geen certificaten binnen 90 dagen.</div>'}<button class="btn secondary small" data-view="documents">Open documenten</button></div>
    </div>
  </div>
  <div id="weatherAdvicePanel" class="card weather-panel">
    <div class="weather-loading"><span>🌦️</span><div><b>Weer en klusadvies laden…</b><small>Locatie: ${esc(db.settings.weatherLocationName||'Leeuwarden')}</small></div></div>
  </div>
  <div class="card smart-day-plan" style="margin-bottom:16px">
    <div class="section-title"><div><span class="meter-label">Slim klusdagplan</span><h3>Wat past vandaag?</h3><small id="smartDaySummary">Gebaseerd op tijd, weer, urgentie en onderdelen.</small></div><div class="day-plan-controls"><label>Beschikbaar<input id="dayPlanHours" type="number" min="0.5" max="16" step="0.5" value="${esc(localStorage.getItem(DAY_PLAN_KEY)||db.settings.dayPlanHours||4)}"></label><button class="btn" id="buildDayPlan">Plan klusdag</button></div></div>
    <div id="smartDayPlanBody" class="day-plan-list"><div class="empty">Klusdag berekenen…</div></div>
  </div>
  <div class="grid kpis">
    <div class="card kpi good"><h3>Goed</h3><strong>${counts.Goed}</strong><div class="muted">onderhoudstaken</div></div>
    <div class="card kpi soon"><h3>Binnenkort</h3><strong>${counts.Binnenkort}</strong><div class="muted">aandacht nodig</div></div>
    <div class="card kpi bad"><h3>Achterstallig / urgent</h3><strong>${counts.Achterstallig+counts.Urgent}</strong><div class="muted">direct beoordelen</div></div>
    <div class="card kpi info"><h3>Gezondheidsscore</h3><strong>${health}%</strong><div class="muted">${counts['Nog invullen']} taken nog invullen</div></div>
  </div>
  <div class="grid kpis" style="margin-top:16px">
    <div class="card kpi info"><h3>Objecten</h3><strong>${db.objects.length}</strong><div class="muted">in het register</div></div>
    <div class="card kpi info"><h3>Werkbonnen</h3><strong>${db.workOrders.length}</strong><div class="muted">in het logboek</div></div>
    <div class="card kpi info"><h3>Kosten ${year}</h3><strong style="font-size:24px">${money(yearCost)}</strong><div class="muted">arbeid en materiaal</div></div>
    <div class="card kpi info"><h3>Foto's</h3><strong>${photoLibraryStats().total}</strong><div class="muted">originelen in Drive</div></div>
  </div>
  <div class="card dashboard-photo-banner" style="margin-top:16px">
    ${photoImgHtml('PHT-CUR-001','Variatie op open water')}
    <div class="dashboard-photo-copy"><span class="meter-label">Fotodocumentatie</span><h3>Fotoarchief Variatie</h3><p>De app bevat actuele, historische en ingedeelde inspiratiefoto's voor de restauratie.</p><div class="row-actions"><button class="btn" data-view="photos">Open fotogalerij</button><button class="btn secondary" data-view="inspiration">Open inspiratie</button></div></div>
  </div>
  <div class="card meter-panel" style="margin-top:16px">
    <div class="section-title">
      <div><h3>Motoruren snel bijwerken</h3><div class="muted">De nieuwe standen worden automatisch met Google Drive gesynchroniseerd.</div></div>
    </div>
    <div class="meter-grid">
      <div class="meter-card">
        <div class="meter-icon">⚙</div>
        <div class="meter-info">
          <span class="meter-label">Hoofdmotor</span>
          <strong>${esc(mainEngine?.name||'Hoofdmotor')}</strong>
          <small>${esc(mainEngine?.meterUnit||'Draaiuren')} · ${meterUpdatedText(mainEngine)}</small>
        </div>
        <div class="meter-current"><span>Huidige stand</span><b>${mainEngine?.meter!==''&&mainEngine?.meter!=null?esc(mainEngine.meter):'—'}</b></div>
        <div class="meter-entry">
          <input id="quickMainMeter" type="number" min="0" step="0.1" inputmode="decimal" value="${mainEngine?.meter!==''&&mainEngine?.meter!=null?esc(mainEngine.meter):''}" placeholder="Nieuwe stand">
          <button class="btn quick-meter-save" data-object="${esc(mainEngine?.id||'OBJ0001')}" data-input="quickMainMeter">Opslaan</button>
        </div>
      </div>
      <div class="meter-card">
        <div class="meter-icon">⚡</div>
        <div class="meter-info">
          <span class="meter-label">Generator</span>
          <strong>${esc(generator?.name||'Generator')}</strong>
          <small>${esc(generator?.meterUnit||'Bedrijfsuren')} · ${meterUpdatedText(generator)}</small>
        </div>
        <div class="meter-current"><span>Huidige stand</span><b>${generator?.meter!==''&&generator?.meter!=null?esc(generator.meter):'—'}</b></div>
        <div class="meter-entry">
          <input id="quickGeneratorMeter" type="number" min="0" step="0.1" inputmode="decimal" value="${generator?.meter!==''&&generator?.meter!=null?esc(generator.meter):''}" placeholder="Nieuwe stand">
          <button class="btn quick-meter-save" data-object="${esc(generator?.id||'OBJ0013')}" data-input="quickGeneratorMeter">Opslaan</button>
        </div>
      </div>
    </div>
  </div>
  <div class="grid dashboard-grid">
    <div class="card">
      <div class="section-title"><h3>Komende werkzaamheden</h3><button class="btn small" data-view="maintenance">Alle onderhoud</button></div>
      <div class="list">${upcoming.length?upcoming.map(r=>{const o=objectById(r.objectId);return `<div class="list-item"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(o?.name||r.objectId)}</strong>${statusPill(r.state.status)}</div><div>${esc(r.task)}</div><small class="muted">${r.state.nextDate?'Datum: '+dateNL(r.state.nextDate):''}${r.state.nextMeter!=null?' · Teller: '+r.state.nextMeter:''}</small></div>`}).join(''):'<div class="empty">Geen open onderhoud.</div>'}</div>
    </div>
    <div class="card">
      <div class="section-title"><h3>Onderhoudsstatus</h3></div>
      <div class="chart-row">
        <div class="donut" style="background:conic-gradient(#3aa957 0 ${a}deg,#e4b52d ${a}deg ${b}deg,#d26a6a ${b}deg ${c}deg,#ba3030 ${c}deg ${d}deg,#d8dee3 ${d}deg 360deg)"><div class="donut-label">${health}%<small>gezond</small></div></div>
        <div class="legend">
          ${[['#3aa957','Goed',counts.Goed],['#e4b52d','Binnenkort',counts.Binnenkort],['#d26a6a','Achterstallig',counts.Achterstallig],['#ba3030','Urgent',counts.Urgent],['#d8dee3','Nog invullen',counts['Nog invullen']]].map(x=>`<div class="legend-row"><span class="dot" style="background:${x[0]}"></span>${x[1]} <b>${x[2]}</b></div>`).join('')}
        </div>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="section-title"><h3>Kosten per maand · ${year}</h3><button class="btn secondary small" data-view="costs">Kostenoverzicht</button></div>
    <div class="bars">${months.map((m,i)=>`<div class="bar-row"><span>${m}</span><div class="bar-track"><div class="bar" style="width:${monthVals[i]/max*100}%"></div></div><strong class="money">${money(monthVals[i])}</strong></div>`).join('')}</div>
  </div>`;
  $('#todayReport')?.addEventListener('click',generateVmmsReport);$$('[data-object-page]').forEach(b=>b.addEventListener('click',()=>openObjectPage(b.dataset.objectPage)));loadWeatherAdvice();const planHours=num(localStorage.getItem(DAY_PLAN_KEY)||db.settings.dayPlanHours||4);loadSmartDayPlan(planHours);$('#buildDayPlan').onclick=saveDayPlanHours;$('#dayPlanHours').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();saveDayPlanHours()}};
  $$('.quick-meter-save').forEach(button=>{
    button.addEventListener('click',()=>saveQuickMeter(button.dataset.object,button.dataset.input));
  });
  ['quickMainMeter','quickGeneratorMeter'].forEach(id=>{
    const input=$('#'+id);
    if(input)input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        const button=document.querySelector(`.quick-meter-save[data-input="${id}"]`);
        if(button)saveQuickMeter(button.dataset.object,id);
      }
    });
  });
}
function workOrderMaintenanceIds(workOrder){
  if(Array.isArray(workOrder?.maintenanceIds))return unique(workOrder.maintenanceIds.filter(Boolean));
  return workOrder?.maintenanceId?[workOrder.maintenanceId]:[];
}
function workOrderMaintenanceNames(workOrder){
  const saved=Array.isArray(workOrder?.maintenanceTaskNames)?workOrder.maintenanceTaskNames.filter(Boolean):[];
  if(saved.length)return saved;
  return workOrderMaintenanceIds(workOrder).map(id=>maintenanceById(id)?.task).filter(Boolean);
}
function workOrderTaskSummaryHtml(workOrder){
  const names=workOrderMaintenanceNames(workOrder);
  if(!names.length)return '';
  return `<div class="workorder-task-summary"><b>${names.length} onderhoudstaak${names.length===1?'':'en'}</b>${names.map(name=>`<span>${esc(name)}</span>`).join('')}</div>`;
}
function maintenanceSelectionStatus(maintenance){
  const state=maintenanceState(maintenance);
  return {state,label:state.status,rank:state.rank};
}
function selectedMaintenanceTasks(){return [...selectedWorkOrderMaintenanceIds].map(maintenanceById).filter(Boolean)}
function mergedSelectedChecklist(){
  const uniqueItems=new Map();
  selectedMaintenanceTasks().forEach(maintenance=>{
    const items=Array.isArray(maintenance.checklist)&&maintenance.checklist.length?maintenance.checklist:genericChecklist(maintenance.task);
    items.forEach(item=>{
      const key=String(item||'').trim().toLowerCase();
      if(key&&!uniqueItems.has(key))uniqueItems.set(key,{item:String(item).trim(),sources:[maintenance.task]});
      else if(key){const row=uniqueItems.get(key);if(!row.sources.includes(maintenance.task))row.sources.push(maintenance.task)}
    });
  });
  return [...uniqueItems.values()];
}
function renderWorkOrder(){
  workOrderDraftPhotos=[];selectedWorkOrderMaintenanceIds=new Set();
  const paintPrefill=paintWorkOrderPrefill;
  const selectedObject=prefillWorkOrderObjectId||(paintPrefill?.objectId||'');prefillWorkOrderObjectId='';
  const objectOpts=db.objects.filter(o=>o.status!=='Buiten gebruik').map(o=>`<option value="${esc(o.id)}" ${o.id===selectedObject?'selected':''}>${esc(o.id)} · ${esc(o.name)}</option>`).join('');
  const projectOpts=db.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.name)}</option>`).join('');
  $('#view-workorder').innerHTML=`<div class="note">Selecteer één of meerdere onderhoudstaken van hetzelfde object. De checklist en onderhoudshistorie worden automatisch bijgewerkt.</div><div class="card" style="max-width:980px"><div class="section-title"><h3>Nieuwe werkbon</h3><span class="muted">Wordt direct opgeslagen en gesynchroniseerd</span></div><form id="workOrderForm" class="form-grid">
  <label>Datum<input type="date" name="date" value="${todayISO()}" required></label><label>Type werk<select name="type" required><option value="">Kies...</option>${['Gepland onderhoud','Reparatie','Storing','Inspectie','Project','Vrij werk'].map(x=>`<option>${x}</option>`).join('')}</select></label>
  <label class="span-2">Object<select name="objectId" id="woObject" required><option value="">Kies object...</option>${objectOpts}</select></label>
  <div class="span-2 maintenance-multiselect-panel">
    <div class="section-title"><div><h3>Onderhoudstaken</h3><small class="muted">Meerdere taken selecteren is mogelijk</small></div><span class="maintenance-selected-count" id="woSelectedCount">0 geselecteerd</span></div>
    <div class="maintenance-selector-filters"><input id="woMaintenanceSearch" type="search" placeholder="Zoek onderhoudstaak"><select id="woMaintenanceStatus"><option value="">Alle taken</option><option value="attention">Alleen aandacht</option><option value="Urgent">Urgent</option><option value="Achterstallig">Achterstallig</option><option value="Binnenkort">Binnenkort</option><option value="Goed">Goed</option><option value="Nog invullen">Nog invullen</option></select><button type="button" class="btn secondary" id="woClearMaintenance">Selectie wissen</button></div>
    <div id="woMaintenanceList" class="maintenance-multiselect-list"><div class="empty">Kies eerst een object.</div></div>
  </div>
  <div class="span-2 checklist-panel" id="woChecklist"><div class="empty">Selecteer onderhoudstaken om de gezamenlijke checklist te zien.</div></div>
  <label class="span-2">Vrije omschrijving / extra werk<textarea name="description" placeholder="Wat is aanvullend uitgevoerd?"></textarea></label>
  <label>Tellerstand<input type="number" step="0.1" name="meter" placeholder="Bijv. 1260"></label><label>Bestede tijd (uren)<input type="number" step="0.25" min="0" name="hours"></label>
  <label>Kosten arbeid (€)<input type="number" step="0.01" min="0" name="laborCost"></label><label>Kosten materiaal (€)<input type="number" step="0.01" min="0" name="materialCost"></label>
  <label>Project<select name="projectId"><option value="">Geen project</option>${projectOpts}</select></label><label>Documentlink<input type="url" name="documentLink" placeholder="https://..."></label>
  <div class="span-2 staged-photo-inputs"><label>Voorfoto's<input class="wo-stage-photo" data-stage="voor" type="file" accept="image/*" multiple></label><label>Tijdensfoto's<input class="wo-stage-photo" data-stage="tijdens" type="file" accept="image/*" multiple></label><label>Nafoto's<input class="wo-stage-photo" data-stage="na" type="file" accept="image/*" multiple></label></div>
  <div class="span-2" id="workOrderPhotoPreview"><div class="empty">Nog geen foto's toegevoegd.</div></div><label class="span-2">Opmerking<textarea name="note"></textarea></label>
  <div class="span-2 form-actions"><button type="reset" class="btn secondary" id="resetWorkOrder">Leegmaken</button><button class="btn" type="submit">Werkbon verwerken</button></div></form></div>`;
  $('#woObject').addEventListener('change',()=>{selectedWorkOrderMaintenanceIds.clear();updateWorkOrderMaintenance()});
  $('#woMaintenanceSearch').addEventListener('input',drawWorkOrderMaintenanceOptions);
  $('#woMaintenanceStatus').addEventListener('change',drawWorkOrderMaintenanceOptions);
  $('#woClearMaintenance').addEventListener('click',()=>{selectedWorkOrderMaintenanceIds.clear();drawWorkOrderMaintenanceOptions();renderSelectedMaintenanceChecklist()});
  $$('.wo-stage-photo').forEach(i=>i.addEventListener('change',handleWorkOrderPhotoInput));
  $('#resetWorkOrder').addEventListener('click',()=>setTimeout(()=>{workOrderDraftPhotos=[];selectedWorkOrderMaintenanceIds.clear();renderWorkOrderPhotoPreview();$('#workOrderForm [name=date]').value=todayISO();updateWorkOrderMaintenance()},0));
  $('#workOrderForm').addEventListener('submit',submitWorkOrder);renderWorkOrderPhotoPreview();if(selectedObject)updateWorkOrderMaintenance();
  if(paintPrefill){
    const form=$('#workOrderForm');form.elements.type.value='Gepland onderhoud';form.elements.description.value=`Schilderwerk ${paintPrefill.zoneName}`;form.elements.note.value=`Verfzone ${paintPrefill.zoneId}. Volg de laagopbouw en veiligheidsinstructies uit het VMMS-verfplan. Leg foto's vóór, tijdens en na vast.`;if(form.elements.projectId)form.elements.projectId.value='PRJ-REST-001';paintWorkOrderPrefill=null;
  }
}
function drawWorkOrderMaintenanceOptions(){
  const host=$('#woMaintenanceList');if(!host)return;
  const objectId=$('#woObject')?.value||'';
  if(!objectId){host.innerHTML='<div class="empty">Kies eerst een object.</div>';updateSelectedMaintenanceCount();return}
  const query=($('#woMaintenanceSearch')?.value||'').toLowerCase();
  const filter=$('#woMaintenanceStatus')?.value||'';
  const rows=db.maintenance.filter(m=>m.objectId===objectId&&m.applicable!==false).map(m=>({...m,selection:maintenanceSelectionStatus(m)}))
    .filter(m=>!query||[m.id,m.task,m.note].join(' ').toLowerCase().includes(query))
    .filter(m=>!filter||(filter==='attention'?['Urgent','Achterstallig','Binnenkort'].includes(m.selection.label):m.selection.label===filter))
    .sort((a,b)=>a.selection.rank-b.selection.rank||String(a.task).localeCompare(String(b.task),'nl'));
  host.innerHTML=rows.map(m=>`<label class="maintenance-multi-option ${selectedWorkOrderMaintenanceIds.has(m.id)?'selected':''}"><input type="checkbox" class="wo-maintenance-check" value="${esc(m.id)}" ${selectedWorkOrderMaintenanceIds.has(m.id)?'checked':''}><span class="maintenance-option-copy"><b>${esc(m.task)}</b><small>${esc(m.id)}${m.note?' · '+esc(m.note):''}</small></span>${statusPill(m.selection.label)}</label>`).join('')||'<div class="empty">Geen onderhoudstaken gevonden voor dit filter.</div>';
  $$('.wo-maintenance-check',host).forEach(input=>input.addEventListener('change',()=>{
    if(input.checked)selectedWorkOrderMaintenanceIds.add(input.value);else selectedWorkOrderMaintenanceIds.delete(input.value);
    input.closest('.maintenance-multi-option')?.classList.toggle('selected',input.checked);
    updateSelectedMaintenanceCount();renderSelectedMaintenanceChecklist();
  }));
  updateSelectedMaintenanceCount();
}
function updateSelectedMaintenanceCount(){
  const count=selectedWorkOrderMaintenanceIds.size;const el=$('#woSelectedCount');if(el)el.textContent=`${count} geselecteerd`;
}
function renderSelectedMaintenanceChecklist(){
  const tasks=selectedMaintenanceTasks(),wrap=$('#woChecklist');if(!wrap)return;
  if(!tasks.length){wrap.innerHTML='<div class="empty">Selecteer onderhoudstaken om de gezamenlijke checklist te zien.</div>';return}
  const items=mergedSelectedChecklist();
  wrap.innerHTML=`<div class="section-title"><div><h3>Gezamenlijke werkchecklist</h3><small class="muted">${tasks.length} taak${tasks.length===1?'':'taken'} · dubbele stappen zijn samengevoegd</small></div></div><div class="selected-maintenance-chips">${tasks.map(task=>`<span>${esc(task.task)}</span>`).join('')}</div><div class="checklist-items">${items.map(row=>`<label><input type="checkbox" name="checklistItem" value="${esc(row.item)}"><span>${esc(row.item)}${row.sources.length>1?`<small>Gebruikt door ${row.sources.length} taken</small>`:''}</span></label>`).join('')}</div>`;
}
function updateWorkOrderMaintenance(){
  const objectId=$('#woObject')?.value||'';
  selectedWorkOrderMaintenanceIds=new Set([...selectedWorkOrderMaintenanceIds].filter(id=>maintenanceById(id)?.objectId===objectId));
  const object=objectById(objectId),meter=$('#workOrderForm [name=meter]');
  if(meter)meter.placeholder=object?.meterUnit?`${object.meterUnit} · huidig ${object.meter||'onbekend'}`:'Niet van toepassing';
  drawWorkOrderMaintenanceOptions();renderSelectedMaintenanceChecklist();
}
async function submitWorkOrder(event){
  event.preventDefault();const form=event.currentTarget,formData=new FormData(form);
  const objectId=formData.get('objectId'),free=String(formData.get('description')||'').trim();
  const object=objectById(objectId);const maintenanceIds=[...selectedWorkOrderMaintenanceIds];
  const tasks=maintenanceIds.map(maintenanceById).filter(m=>m&&m.objectId===objectId&&m.applicable!==false);
  if(tasks.length!==maintenanceIds.length){toast('De onderhoudsselectie bevat een ongeldige taak. Kies de taken opnieuw.');return}
  if(!tasks.length&&!free){toast('Selecteer onderhoud of vul een omschrijving in.');return}
  const taskNames=tasks.map(task=>task.task);
  const taskDescription=tasks.length===1?taskNames[0]:(tasks.length?`${tasks.length} onderhoudstaken uitgevoerd`:'');
  const description=[taskDescription,free].filter(Boolean).join(' – ');
  const workOrder={
    id:nextId('WB',db.workOrders,6),date:formData.get('date'),type:formData.get('type'),objectId,
    objectName:object?.name||objectId,system:object?.system||'',maintenanceId:maintenanceIds[0]||'',maintenanceIds,
    maintenanceTaskNames:taskNames,description,meter:formData.get('meter')||'',hours:formData.get('hours')||'',
    laborCost:num(formData.get('laborCost')),materialCost:num(formData.get('materialCost')),projectId:formData.get('projectId')||'',
    documentLink:formData.get('documentLink')||'',note:formData.get('note')||'',
    checklistResults:[...form.querySelectorAll('[name=checklistItem]')].map(input=>({item:input.value,done:input.checked})),
    photos:workOrderDraftPhotos.map(photo=>({...photo}))
  };
  db.workOrders.push(workOrder);
  tasks.forEach(task=>{task.lastDate=workOrder.date;if(workOrder.meter!=='')task.lastMeter=num(workOrder.meter);task.lastWorkOrder=workOrder.id});
  if(object&&workOrder.meter!==''&&num(workOrder.meter)>=num(object.meter))object.meter=num(workOrder.meter);
  saveData();workOrderDraftPhotos=[];selectedWorkOrderMaintenanceIds.clear();
  form.reset();form.querySelector('[name=date]').value=todayISO();updateWorkOrderMaintenance();renderWorkOrderPhotoPreview();
  toast(`Werkbon ${workOrder.id} verwerkt met ${tasks.length} onderhoudstaak${tasks.length===1?'':'en'}${workOrder.photos.length?` en ${workOrder.photos.length} foto('s)`:''}`);
}
function renderObjects(){
  const systems=unique(db.objects.map(o=>o.system));
  $('#view-objects').innerHTML=`
  <div class="card">
    <div class="section-title"><h3>Objectenregister · ${db.objects.length}</h3><button class="btn" id="addObjectBtn">Object toevoegen</button></div>
    <div class="filters"><input id="objectSearch" placeholder="Zoek naam, ID of locatie"><select id="objectSystem"><option value="">Alle systemen</option>${systems.map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="objectStatus"><option value="">Alle statussen</option>${unique(db.objects.map(o=>o.status)).map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Naam</th><th>Systeem</th><th>Locatie</th><th>Status</th><th>Prioriteit</th><th>Teller</th><th></th></tr></thead><tbody id="objectsBody"></tbody></table></div>
  </div>`;
  $('#objectSearch').addEventListener('input',drawObjects);$('#objectSystem').addEventListener('change',drawObjects);$('#objectStatus').addEventListener('change',drawObjects);
  $('#addObjectBtn').addEventListener('click',()=>openObjectDialog());
  drawObjects();
}
function drawObjects(){
  const q=($('#objectSearch')?.value||'').toLowerCase(),sys=$('#objectSystem')?.value||'',st=$('#objectStatus')?.value||'';
  const rows=db.objects.filter(o=>(!q||[o.id,o.name,o.location,o.brand,o.model].join(' ').toLowerCase().includes(q))&&(!sys||o.system===sys)&&(!st||o.status===st));
  $('#objectsBody').innerHTML=rows.map(o=>`<tr><td><b>${esc(o.id)}</b></td><td>${esc(o.name)}<br><small class="muted">${esc([o.brand,o.model].filter(Boolean).join(' '))}</small></td><td>${esc(o.system)}</td><td>${esc(o.location)}</td><td>${statusPill(o.status==='Actief'?'Goed':o.status==='Gepland'?'Binnenkort':'Niet actief')}</td><td>${esc(o.priority)}</td><td>${o.meter!==''?esc(o.meter)+' '+esc(o.meterUnit):'—'}</td><td><div class="row-actions"><button class="icon-btn open-object" data-id="${esc(o.id)}">Open</button><button class="icon-btn edit-object" data-id="${esc(o.id)}">Bewerk</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty">Geen objecten gevonden.</td></tr>';
  $$('.open-object').forEach(b=>b.addEventListener('click',()=>openObjectPage(b.dataset.id)));$$('.edit-object').forEach(b=>b.addEventListener('click',()=>openObjectDialog(b.dataset.id)));
}

function openObjectPage(id){currentObjectId=id;navTo('objectdetail')}
function renderObjectDetail(){
  const o=objectById(currentObjectId);if(!o){$('#view-objectdetail').innerHTML='<div class="empty">Object niet gevonden.</div>';return}
  $('#pageTitle').textContent=o.name;const maint=db.maintenance.filter(m=>m.objectId===o.id).map(m=>({...m,state:maintenanceState(m)})).sort((a,b)=>a.state.rank-b.state.rank);const orders=db.workOrders.filter(w=>w.objectId===o.id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));const manuals=(db.manuals||[]).filter(m=>(m.objectIds||[]).includes(o.id));const photos=orders.flatMap(w=>(w.photos||[]).map(p=>({...p,workOrderId:w.id,date:w.date})));
  $('#view-objectdetail').innerHTML=`<div class="object-detail-hero card"><div><button class="btn secondary small" data-view="objects">← Objecten</button><span class="meter-label">${esc(o.id)} · ${esc(o.system)}</span><h3>${esc(o.name)}</h3><p>${esc([o.brand,o.model,o.location].filter(Boolean).join(' · '))}</p></div><div class="object-meter"><span>${esc(o.meterUnit||'Teller')}</span><b>${o.meter!==''?esc(o.meter):'—'}</b><button class="btn small" id="objectNewWorkOrder">Nieuwe werkbon</button></div></div>
  <div class="grid kpis"><div class="card kpi info"><h3>Onderhoudstaken</h3><strong>${maint.length}</strong></div><div class="card kpi ${maint.some(m=>m.state.rank<=2)?'bad':'good'}"><h3>Aandacht</h3><strong>${maint.filter(m=>m.state.rank<=3).length}</strong></div><div class="card kpi info"><h3>Werkbonnen</h3><strong>${orders.length}</strong></div><div class="card kpi info"><h3>Kosten</h3><strong style="font-size:22px">${money(orders.reduce((a,w)=>a+workOrderCost(w),0))}</strong></div></div>
  <div class="grid dashboard-grid"><div class="card"><div class="section-title"><h3>Onderhoud</h3></div><div class="list">${maint.slice(0,12).map(m=>`<div class="list-item"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(m.task)}</strong>${statusPill(m.state.status)}</div><small>${m.state.nextDate?dateNL(m.state.nextDate):''}${m.state.nextMeter!=null?' · '+m.state.nextMeter+' '+esc(o.meterUnit):''}</small></div>`).join('')||'<div class="empty">Geen onderhoud gekoppeld.</div>'}</div></div><div class="card"><div class="section-title"><h3>Handleidingen</h3></div><div class="list">${manuals.map(m=>`<a class="list-item" href="${esc(m.url)}" target="_blank"><strong>${esc(m.title)}</strong><small>${esc(m.status)}</small></a>`).join('')||'<div class="empty">Geen handleiding gekoppeld.</div>'}</div></div></div>
  <div class="card" style="margin-top:16px"><div class="section-title"><h3>Recente werkbonnen</h3></div><div class="list">${orders.slice(0,12).map(w=>`<div class="list-item"><div style="display:flex;justify-content:space-between"><strong>${dateNL(w.date)} · ${esc(w.description)}</strong><b>${money(workOrderCost(w))}</b></div>${workOrderTaskSummaryHtml(w)}${(w.photos||[]).length?`<button class="btn secondary small open-object-photos" data-id="${esc(w.id)}">${w.photos.length} foto's bekijken</button>`:''}</div>`).join('')||'<div class="empty">Nog geen werkbonnen.</div>'}</div></div>
  ${photos.length?`<div class="card" style="margin-top:16px"><div class="section-title"><h3>Foto's</h3></div><div class="object-photo-strip">${photos.slice(0,12).map(p=>`<img src="${photoPreviewSrc(p)}" alt="Objectfoto">`).join('')}</div></div>`:''}`;
  $('#objectNewWorkOrder').onclick=()=>{prefillWorkOrderObjectId=o.id;navTo('workorder')};$$('.open-object-photos').forEach(b=>b.onclick=()=>openWorkOrderPhotos(b.dataset.id));
}

function openObjectDialog(id=''){
  const o=id?objectById(id):{id:nextId('OBJ',db.objects),name:'',type:'',system:'Hoofdmotor',location:'',brand:'',model:'',serial:'',status:'Actief',priority:'Normaal',meter:'',meterUnit:'',note:''};
  openDialog(id?'Object bewerken':'Object toevoegen',`
  <form id="objectForm" class="form-grid">
    <label>Object ID<input name="id" value="${esc(o.id)}" ${id?'readonly':''} required></label>
    <label>Naam<input name="name" value="${esc(o.name)}" required></label>
    <label>Type<input name="type" value="${esc(o.type)}"></label>
    <label>Systeem<select name="system">${unique([...db.objects.map(x=>x.system),'Hoofdmotor','Electra binnen','Electra buiten','Staal buiten','Water & sanitair','Verwarming','Veiligheid','Interieur']).map(x=>`<option ${x===o.system?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
    <label>Locatie<input name="location" value="${esc(o.location)}"></label>
    <label>Status<select name="status">${['Actief','Gepland','Reserve','Buiten gebruik'].map(x=>`<option ${x===o.status?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>Merk<input name="brand" value="${esc(o.brand)}"></label>
    <label>Model<input name="model" value="${esc(o.model)}"></label>
    <label>Prioriteit<select name="priority">${['Hoog','Normaal','Laag'].map(x=>`<option ${x===o.priority?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>Huidige tellerstand<input type="number" step="0.1" name="meter" value="${esc(o.meter)}"></label>
    <label>Tellereenheid<input name="meterUnit" value="${esc(o.meterUnit)}"></label>
    <label class="span-2">Opmerking<textarea name="note">${esc(o.note)}</textarea></label>
    <div class="span-2 form-actions">${id?'<button type="button" class="btn danger" id="deleteObject">Verwijderen</button>':''}<button type="button" class="btn secondary" id="cancelDialog">Annuleren</button><button class="btn">Opslaan</button></div>
  </form>`);
  $('#cancelDialog').onclick=closeDialog;
  $('#objectForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const data=Object.fromEntries(f.entries());data.meter=data.meter===''?'':num(data.meter);if(id)Object.assign(o,data);else db.objects.push(data);saveData();closeDialog();renderObjects();toast('Object opgeslagen')};
  if(id)$('#deleteObject').onclick=()=>{if(db.maintenance.some(m=>m.objectId===id)){toast('Verwijder eerst gekoppelde onderhoudstaken.');return}if(confirm('Object definitief verwijderen?')){db.objects=db.objects.filter(x=>x.id!==id);saveData();closeDialog();renderObjects()}};
}

function manualById(id){return (db.manuals||[]).find(m=>m.id===id)}
function confidenceBadge(value){
  const cls=value==='Hoog'?'goed':value==='Middel'?'binnenkort':'achterstallig';
  return `<span class="status ${cls}">${esc(value||'Niet bepaald')}</span>`;
}
function manualStatusBadge(value){
  const low=/nodig|controleren|verschil|identificeren/i.test(value||'');
  return `<span class="status ${low?'binnenkort':'goed'}">${esc(value||'Onbekend')}</span>`;
}


function renderPhotos(){
  const current=VARIATIE_PHOTOS.filter(p=>p.group==='current');
  const historic=VARIATIE_PHOTOS.filter(p=>p.group==='historic');
  const stats=photoLibraryStats();
  const makeGrid=(items)=>`<div class="photo-grid">${items.map((p,i)=>`<article class="photo-card"><button class="photo-thumb" data-photo-id="${esc(p.photoId)}" data-title="${esc(p.title)}" data-caption="${esc(p.caption)}">${photoImgHtml(p.photoId,p.title)}</button><div class="photo-meta"><span class="meter-label">${esc(p.title)}</span><p>${esc(p.caption)}</p><small>${photoLibraryItem(p.photoId)?.driveFileId?'Origineel in Google Drive':'Nog niet naar Drive geïmporteerd'}</small></div></article>`).join('')}</div>`;
  $('#view-photos').innerHTML=`
  <div class="card photos-hero">
    ${photoImgHtml('PHT-CUR-001','Variatie hoofdbeeld')}
    <div><span class="meter-label">Drive-fotoarchief</span><h3>Variatie door de jaren heen</h3><p>De grote originele bestanden staan in Google Drive. VMMS bewaart alleen lichte voorbeelden en koppelingen.</p><div class="photo-legend"><span><b>${current.length}</b> huidige foto’s</span><span><b>${historic.length}</b> historische foto’s</span><span><b>${stats.drive}/${stats.total}</b> in Drive</span></div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="section-title"><h3>Huidige foto’s</h3></div>${makeGrid(current)}</div>
  <div class="card" style="margin-top:16px"><div class="section-title"><h3>Historische foto’s</h3></div>${makeGrid(historic)}</div>`;
  $$('.photo-thumb').forEach(button=>button.onclick=()=>{const id=button.dataset.photoId,item=photoLibraryItem(id);openDialog(button.dataset.title||'Foto',`<div class="photo-dialog-body">${photoImgHtml(id,button.dataset.title||'Foto')}<p class="muted">${esc(button.dataset.caption||'')}</p><div class="form-actions"><button class="btn secondary" id="closePhotoLibraryDialog">Sluiten</button></div></div>`);hydratePhotoImages($('#dialogBody'));$('#closePhotoLibraryDialog').onclick=closeDialog});
  hydratePhotoImages($('#view-photos'));
}


function inspirationFilterItems(){
  const category=$('#inspirationCategory')?.value||'Alle';
  const query=String($('#inspirationSearch')?.value||'').toLowerCase().trim();
  return inspirationPhotos().filter(item=>{
    if(category==='Favorieten'&&!item.favorite)return false;
    if(!['Alle','Favorieten'].includes(category)&&item.category!==category)return false;
    const hay=[item.title,item.category,item.description,item.suggestedUse,item.note,...(item.tags||[]),...(item.linkedPackageIds||[]).map(restorationPackageName)].join(' ').toLowerCase();
    return !query||hay.includes(query);
  });
}
function openInspirationPhoto(itemId){
  const item=inspirationPhotos().find(photo=>photo.id===itemId);if(!item)return;
  openDialog(item.title,`<div class="inspiration-dialog">${photoImgHtml(item.photoId,item.title)}<div class="inspiration-dialog-copy"><span class="status goed">${esc(item.category)}</span><p>${esc(item.description)}</p><div class="note"><b>Te gebruiken voor:</b> ${esc(item.suggestedUse)}</div>${item.note?`<p><b>Eigen notitie:</b> ${esc(item.note)}</p>`:''}<div class="inspiration-tags">${(item.tags||[]).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><div class="inspiration-links">${(item.linkedPackageIds||[]).map(id=>`<span>${esc(id)} · ${esc(restorationPackageName(id))}</span>`).join('')||'<small>Nog niet aan een werkpakket gekoppeld.</small>'}</div><div class="form-actions"><button class="btn secondary" id="closeInspirationPhoto">Sluiten</button><button class="btn" id="editInspirationPhoto">Notitie & koppeling</button></div></div></div>`);
  hydratePhotoImages($('#dialogBody'));$('#closeInspirationPhoto').onclick=closeDialog;$('#editInspirationPhoto').onclick=()=>openInspirationEditor(itemId);
}
function openInspirationEditor(itemId){
  const item=inspirationPhotos().find(photo=>photo.id===itemId);if(!item)return;
  const packages=restorationPackages();
  openDialog('Inspiratiefoto bewerken',`<form id="inspirationEditForm" class="form-grid"><label class="span-2">Titel<input name="title" value="${esc(item.title)}"></label><label>Categorie<select name="category">${(db.inspiration?.categories||[]).filter(x=>!['Alle','Favorieten'].includes(x)).map(x=>`<option ${x===item.category?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label class="favorite-toggle"><input name="favorite" type="checkbox" ${item.favorite?'checked':''}> Beste voorbeeld / favoriet</label><label class="span-2">Eigen notitie<textarea name="note">${esc(item.note||'')}</textarea></label><label class="span-2">Tags, gescheiden door komma’s<input name="tags" value="${esc((item.tags||[]).join(', '))}"></label><div class="span-2"><b>Koppelen aan restauratiewerkpakketten</b><div class="inspiration-package-options">${packages.map(pkg=>`<label><input type="checkbox" name="packageIds" value="${esc(pkg.id)}" ${(item.linkedPackageIds||[]).includes(pkg.id)?'checked':''}><span><b>${esc(pkg.id)}</b> ${esc(pkg.name)}</span></label>`).join('')}</div></div><div class="span-2 form-actions"><button type="button" class="btn secondary" id="cancelInspirationEdit">Annuleren</button><button class="btn">Opslaan</button></div></form>`);
  $('#cancelInspirationEdit').onclick=closeDialog;
  $('#inspirationEditForm').onsubmit=event=>{event.preventDefault();const form=new FormData(event.currentTarget);item.title=String(form.get('title')||item.title).trim();item.category=String(form.get('category')||item.category);item.favorite=form.get('favorite')==='on';item.note=String(form.get('note')||'').trim();item.tags=String(form.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean);item.linkedPackageIds=form.getAll('packageIds').map(String);saveData();closeDialog();renderInspiration();toast('Inspiratiereferentie opgeslagen')};
}
function toggleInspirationFavorite(itemId){const item=inspirationPhotos().find(photo=>photo.id===itemId);if(!item)return;item.favorite=!item.favorite;saveData();renderInspiration();toast(item.favorite?'Toegevoegd aan beste voorbeelden':'Uit favorieten verwijderd')}
function renderInspiration(){
  ensureInspirationData(db);const all=inspirationPhotos(),favorites=all.filter(item=>item.favorite),linked=all.filter(item=>(item.linkedPackageIds||[]).length);const categories=(db.inspiration?.categories||[]);
  $('#view-inspiration').innerHTML=`<div class="card inspiration-hero">${photoImgHtml('PHT-INSP-008','Klassiek schip als restauratie-inspiratie')}<div><span class="meter-label">VMMS 4.1</span><h3>Inspiratiefoto’s & restauratiereferenties</h3><p>Voorbeelden van klassieke zwaarden, tuigage, roef, stuurstand, achterschip en kleurgebruik. Gebruik ze als gesprek- en ontwerpreferentie, niet als maatvaste constructietekening.</p><div class="photo-legend"><span><b>${all.length}</b> foto’s</span><span><b>${favorites.length}</b> favorieten</span><span><b>${linked.length}</b> gekoppeld</span></div></div></div><div class="card" style="margin-top:16px"><div class="section-title"><h3>Inspiratiearchief</h3><button class="btn" id="addInspirationPhoto">Foto toevoegen</button></div><div class="filters inspiration-filters"><input id="inspirationSearch" type="search" placeholder="Zoek op detail, categorie of notitie"><select id="inspirationCategory">${categories.map(category=>`<option>${esc(category)}</option>`).join('')}</select></div><div id="inspirationGrid" class="inspiration-grid"></div></div>`;
  const draw=()=>{const items=inspirationFilterItems();$('#inspirationGrid').innerHTML=items.map(item=>`<article class="inspiration-card ${item.favorite?'favorite':''}"><button class="inspiration-thumb open-inspiration" data-id="${esc(item.id)}">${photoImgHtml(item.photoId,item.title)}<span class="inspiration-category">${esc(item.category)}</span></button><div class="inspiration-card-copy"><div class="inspiration-card-head"><div><span class="meter-label">${esc(item.id)}</span><h3>${esc(item.title)}</h3></div><button class="favorite-btn toggle-inspiration-favorite" data-id="${esc(item.id)}" title="Favoriet">${item.favorite?'★':'☆'}</button></div><p>${esc(item.description)}</p><small><b>Gebruik:</b> ${esc(item.suggestedUse)}</small><div class="inspiration-tags">${(item.tags||[]).slice(0,5).map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><div class="inspiration-package-chips">${(item.linkedPackageIds||[]).map(id=>`<span title="${esc(restorationPackageName(id))}">${esc(id)}</span>`).join('')}</div><div class="row-actions"><button class="btn secondary small open-inspiration" data-id="${esc(item.id)}">Bekijk groot</button><button class="btn secondary small edit-inspiration" data-id="${esc(item.id)}">Notitie & koppeling</button></div></div></article>`).join('')||'<div class="empty">Geen inspiratiefoto’s gevonden met deze filters.</div>';$$('.open-inspiration').forEach(button=>button.onclick=()=>openInspirationPhoto(button.dataset.id));$$('.edit-inspiration').forEach(button=>button.onclick=()=>openInspirationEditor(button.dataset.id));$$('.toggle-inspiration-favorite').forEach(button=>button.onclick=()=>toggleInspirationFavorite(button.dataset.id));hydratePhotoImages($('#inspirationGrid'));};
  $('#inspirationSearch').oninput=draw;$('#inspirationCategory').onchange=draw;$('#addInspirationPhoto').onclick=openAddInspirationPhoto;draw();
}

function renderManuals(){
  const qHtml=`<div class="card manual-intro"><h3>Handleidingen en onderhoudsbronnen</h3><p>Groen betekent dat het model of de productfamilie voldoende is bevestigd. Oranje betekent dat een typeplaat, serienummer of exacte uitvoering nog nodig is. Alleen onderbouwde fabrikantintervallen zijn als zodanig gemarkeerd.</p></div>`;
  const items=(db.manuals||[]);
  $('#view-manuals').innerHTML=qHtml+`
  <div class="card" style="margin-top:16px">
    <div class="section-title"><h3>${items.length} bronnen</h3><input id="manualSearch" style="max-width:290px" placeholder="Zoek fabrikant, model of object"></div>
    <div id="manualGrid" class="manual-grid"></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="section-title"><h3>Nog nodig voor exacte handleidingen</h3></div>
    <div class="list">
      <div class="list-item"><strong>Westerbeke generator</strong><span>Foto van de volledige typeplaat, inclusief model- en serienummer.</span></div>
      <div class="list-item"><strong>Mercury 6 pk</strong><span>Serienummer en aangeven of het een 2- of 4-taktmotor is.</span></div>
      <div class="list-item"><strong>Dong keerkoppeling</strong><span>Foto van typeplaat en eventueel olielabel.</span></div>
      <div class="list-item"><strong>Victron MPPT “150/75” en Cyrix “80 A”</strong><span>Foto van de etiketten; deze typen zijn niet eenduidig gekoppeld aan de gevonden huidige handleidingen.</span></div>
    </div>
  </div>`;
  const draw=()=>{
    const q=($('#manualSearch')?.value||'').toLowerCase();
    const filtered=items.filter(m=>!q||[m.title,m.manufacturer,m.model,m.note,...(m.objectIds||[]).map(id=>objectById(id)?.name||id)].join(' ').toLowerCase().includes(q));
    $('#manualGrid').innerHTML=filtered.map(m=>`
      <article class="manual-card">
        <div class="manual-card-head"><div><span class="meter-label">${esc(m.manufacturer)}</span><h3>${esc(m.title)}</h3></div>${manualStatusBadge(m.status)}</div>
        <p class="muted">${esc(m.kind)}</p>
        <p>${esc(m.note)}</p>
        ${(m.objectIds||[]).length?`<div class="manual-objects">${m.objectIds.map(id=>`<span>${esc(objectById(id)?.name||id)}</span>`).join('')}</div>`:''}
        <div class="manual-actions">
          ${m.url?`<a class="btn small" href="${esc(m.url)}" target="_blank" rel="noopener">Handleiding openen</a>`:''}
          ${m.alternateUrl?`<a class="btn secondary small" href="${esc(m.alternateUrl)}" target="_blank" rel="noopener">Alternatieve bron</a>`:''}
        </div>
      </article>`).join('')||'<div class="empty">Geen handleidingen gevonden.</div>';
  };
  $('#manualSearch').addEventListener('input',draw);draw();
}


function renderBaselineSystem(system){
  const host=$('#baselineTaskList');if(!host)return;
  const rows=db.maintenance.filter(m=>objectById(m.objectId)?.system===system).sort((a,b)=>String(objectById(a.objectId)?.name).localeCompare(String(objectById(b.objectId)?.name),'nl'));
  host.innerHTML=rows.map(m=>{const object=objectById(m.objectId);return `<div class="baseline-row" data-id="${esc(m.id)}"><div><b>${esc(object?.name||m.objectId)}</b><small>${esc(m.task)}</small></div><label>Toepassing<select class="baseline-applicable"><option value="1" ${m.applicable!==false?'selected':''}>Van toepassing</option><option value="0" ${m.applicable===false?'selected':''}>Niet van toepassing</option></select></label><label>Laatste datum<input class="baseline-date" type="date" value="${esc(normalizeDate(m.lastDate))}"></label><label>Teller<input class="baseline-meter" type="number" step="0.1" value="${esc(m.lastMeter)}" placeholder="${esc(object?.meter||'')}"></label></div>`}).join('')||'<div class="empty">Geen onderhoudstaken in dit systeem.</div>';
}
function openMaintenanceBaselineWizard(){
  const systems=unique(db.objects.map(o=>o.system));
  openDialog('Onderhoudsnulmeting',`<div class="note"><b>Stap voor stap:</b> kies een systeem, vul de laatste bekende datum en tellerstand in en zet irrelevante taken op Niet van toepassing.</div><div class="baseline-toolbar"><label>Systeem<select id="baselineSystem">${systems.map(system=>`<option>${esc(system)}</option>`).join('')}</select></label><button class="btn secondary" id="baselineUseToday">Vandaag invullen waar leeg</button></div><div id="baselineTaskList" class="baseline-list"></div><div class="form-actions"><button class="btn secondary" id="baselineClose">Sluiten</button><button class="btn" id="baselineSave">Dit systeem opslaan</button></div>`);
  const select=$('#baselineSystem');renderBaselineSystem(select.value);select.onchange=()=>renderBaselineSystem(select.value);
  $('#baselineUseToday').onclick=()=>{$$('.baseline-date').forEach(input=>{if(!input.value)input.value=todayISO()})};
  $('#baselineSave').onclick=()=>{const system=select.value;$$('.baseline-row').forEach(row=>{const m=maintenanceById(row.dataset.id);if(!m)return;m.applicable=row.querySelector('.baseline-applicable').value==='1';m.lastDate=row.querySelector('.baseline-date').value||'';const raw=row.querySelector('.baseline-meter').value;m.lastMeter=raw===''?'':num(raw)});saveData();renderBaselineSystem(system);toast('Nulmeting voor '+system+' opgeslagen')};
  $('#baselineClose').onclick=()=>{closeDialog();renderMaintenance()};
}
function toggleMaintenanceApplicable(id){const m=maintenanceById(id);if(!m)return;m.applicable=m.applicable===false;saveData();drawMaintenance();toast(m.applicable===false?'Taak uitgeschakeld':'Taak weer actief')}

function renderMaintenance(){
  const systems=unique(db.objects.map(o=>o.system)),stats=maintenanceStats();
  $('#view-maintenance').innerHTML=`
  <div class="card mayday-maintenance-card">
    <div class="section-title"><div><span class="meter-label">Onderhoudskennis</span><h3>MaydayWiki toegepast op Variatie</h3></div><button class="btn secondary" id="maydaySourcesBtn">Bekijk bronnen</button></div>
    <p>Praktische kennis van de Nicolaas Mulerius is vertaald naar de installaties van Variatie. Onzekere of typegebonden instructies zijn gemarkeerd en worden niet als fabrikantvoorschrift gepresenteerd.</p>
    <div class="mayday-source-summary"><span><b>${db.maydayWiki?.sources?.length||0}</b> bronnen</span><span><b>${(window.MAYDAY_MAINTENANCE_DATA?.newTasks||[]).length||0}</b> aanvullende taken</span><span><b>${Object.keys(window.MAYDAY_MAINTENANCE_DATA?.taskUpdates||{}).length||0}</b> checklists uitgebreid</span></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="section-title"><h3>Onderhoudsplanning · ${db.maintenance.length} taken</h3><div class="section-actions"><button class="btn secondary" id="baselineWizardBtn">Onderhoudsnulmeting</button><button class="btn" id="addMaintenanceBtn">Taak toevoegen</button></div></div>
    <div class="filters"><input id="maintenanceSearch" placeholder="Zoek object, taak of bron"><select id="maintenanceSystem"><option value="">Alle systemen</option>${systems.map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="maintenanceStatus"><option value="">Alle statussen</option>${Object.keys(stats.counts).map(x=>`<option>${esc(x)}</option>`).join('')}</select><select id="maintenanceSource"><option value="">Alle bronnen</option><option value="MaydayWiki">MaydayWiki</option><option value="Fabrikant">Fabrikant</option><option value="VMMS">VMMS</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Object</th><th>Onderhoudstaak</th><th>Interval</th><th>Basis</th><th>Volgende grens</th><th>Status</th><th></th></tr></thead><tbody id="maintenanceBody"></tbody></table></div>
  </div>`;
  $('#maintenanceSearch').addEventListener('input',drawMaintenance);$('#maintenanceSystem').addEventListener('change',drawMaintenance);$('#maintenanceStatus').addEventListener('change',drawMaintenance);$('#maintenanceSource').addEventListener('change',drawMaintenance);
  $('#maydaySourcesBtn').onclick=openMaydaySourcesDialog;$('#baselineWizardBtn').onclick=openMaintenanceBaselineWizard;$('#addMaintenanceBtn').onclick=()=>openMaintenanceDialog();drawMaintenance();
}
function drawMaintenance(){
  const q=($('#maintenanceSearch')?.value||'').toLowerCase(),sys=$('#maintenanceSystem')?.value||'',st=$('#maintenanceStatus')?.value||'',source=$('#maintenanceSource')?.value||'';
  const rows=db.maintenance.map(m=>({m,o:objectById(m.objectId),s:maintenanceState(m)})).filter(x=>(!q||[x.m.id,x.m.task,x.m.note,x.m.sourcePage,x.m.basis,x.o?.name].join(' ').toLowerCase().includes(q))&&(!sys||x.o?.system===sys)&&(!st||x.s.status===st)&&(!source||String(x.m.basis||'').includes(source))).sort((a,b)=>a.s.rank-b.s.rank||String(a.o?.name).localeCompare(String(b.o?.name),'nl'));
  $('#maintenanceBody').innerHTML=rows.map(({m,o,s})=>`<tr><td><b>${esc(m.id)}</b></td><td>${esc(o?.name||m.objectId)}<br><small class="muted">${esc(o?.system||'')}</small></td><td>${esc(m.task)}${m.sourcePage?`<br><small class="muted">Bron: ${m.sourceUrl?`<a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">${esc(m.sourcePage)}</a>`:esc(m.sourcePage)}</small>`:''}</td><td>${m.intervalDays?esc(m.intervalDays)+' dag'+(num(m.intervalDays)===1?'':'en'):''}${m.intervalDays&&(m.intervalHours||m.intervalMonths)?' óf ':''}${m.intervalHours?esc(m.intervalHours)+' uur':''}${m.intervalHours&&m.intervalMonths?' óf ':''}${m.intervalMonths?esc(m.intervalMonths)+' maanden':''}</td><td><span class="source-label">${esc(m.basis||'VMMS')}</span><br>${confidenceBadge(m.confidence||'Middel')}</td><td>${s.nextDate?'📅 '+dateNL(s.nextDate):''}${s.nextDate&&s.nextMeter!=null?'<br>':''}${s.nextMeter!=null?'⏱ '+esc(s.nextMeter):''}</td><td>${statusPill(s.status)}</td><td><div class="row-actions"><button class="icon-btn edit-maintenance" data-id="${esc(m.id)}">Bewerk</button><button class="icon-btn toggle-maintenance" data-id="${esc(m.id)}">${m.applicable===false?'Aanzetten':'N.v.t.'}</button></div></td></tr>`).join('')||'<tr><td colspan="8" class="empty">Geen onderhoud gevonden.</td></tr>';
  $$('.edit-maintenance').forEach(b=>b.onclick=()=>openMaintenanceDialog(b.dataset.id));$$('.toggle-maintenance').forEach(b=>b.onclick=()=>toggleMaintenanceApplicable(b.dataset.id));
}
function openMaintenanceDialog(id=''){
  const m=id?maintenanceById(id):{id:nextId('MNT',db.maintenance),objectId:'',task:'',intervalHours:'',intervalMonths:'',intervalDays:'',manualId:'',basis:'VMMS preventief',confidence:'Middel',lastDate:'',lastMeter:'',note:''};
  openDialog(id?'Onderhoud bewerken':'Onderhoud toevoegen',`
  <form id="maintenanceForm" class="form-grid">
    <label>MNT ID<input name="id" value="${esc(m.id)}" ${id?'readonly':''} required></label>
    <label>Object<select name="objectId" required><option value="">Kies...</option>${db.objects.map(o=>`<option value="${esc(o.id)}" ${o.id===m.objectId?'selected':''}>${esc(o.id)} · ${esc(o.name)}</option>`).join('')}</select></label>
    <label class="span-2">Onderhoudstaak<input name="task" value="${esc(m.task)}" required></label>
    <label>Interval draaiuren<input type="number" min="0" step="1" name="intervalHours" value="${esc(m.intervalHours)}"></label>
    <label>Interval maanden<input type="number" min="0" step="1" name="intervalMonths" value="${esc(m.intervalMonths)}"></label>
    <label>Interval dagen<input type="number" min="0" step="1" name="intervalDays" value="${esc(m.intervalDays||'')}"></label>
    <label>Toepasselijk<select name="applicable"><option value="1" ${m.applicable!==false?'selected':''}>Ja</option><option value="0" ${m.applicable===false?'selected':''}>Nee, niet van toepassing</option></select></label><label>Onderhoudsbasis<select name="basis">${['Fabrikant','Voorlopig fabrikant','Voorlopig fabrikant + MaydayWiki','VMMS preventief','MaydayWiki · aangepast','Keuring / MaydayWiki','Keuring / VMMS preventief','Voorlopig'].map(x=>`<option ${x===m.basis?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>Betrouwbaarheid<select name="confidence">${['Hoog','Middel','Laag'].map(x=>`<option ${x===m.confidence?'selected':''}>${x}</option>`).join('')}</select></label>
    <label>Handleiding<select name="manualId"><option value="">Geen koppeling</option>${(db.manuals||[]).map(x=>`<option value="${esc(x.id)}" ${x.id===m.manualId?'selected':''}>${esc(x.id)} · ${esc(x.manufacturer)} ${esc(x.model)}</option>`).join('')}</select></label>
    <label>Laatste datum<input type="date" name="lastDate" value="${esc(normalizeDate(m.lastDate))}"></label>
    <label>Laatste tellerstand<input type="number" step="0.1" name="lastMeter" value="${esc(m.lastMeter)}"></label>
    <label>Bronpagina<input name="sourcePage" value="${esc(m.sourcePage||'')}"></label>
    <label>Bronlink<input type="url" name="sourceUrl" value="${esc(m.sourceUrl||'')}"></label>
    <label class="span-2">Checklist (één regel per stap)<textarea name="checklistText">${esc((m.checklist||genericChecklist(m.task)).join('\n'))}</textarea></label><label class="span-2">Opmerking<textarea name="note">${esc(m.note)}</textarea></label>
    <div class="span-2 form-actions">${id?'<button type="button" class="btn danger" id="deleteMaintenance">Verwijderen</button>':''}<button type="button" class="btn secondary" id="cancelDialog">Annuleren</button><button class="btn">Opslaan</button></div>
  </form>`);
  $('#cancelDialog').onclick=closeDialog;
  $('#maintenanceForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());d.intervalHours=d.intervalHours===''?'':num(d.intervalHours);d.intervalMonths=d.intervalMonths===''?'':num(d.intervalMonths);d.intervalDays=d.intervalDays===''?'':num(d.intervalDays);d.lastMeter=d.lastMeter===''?'':num(d.lastMeter);d.applicable=d.applicable==='1';d.checklist=String(d.checklistText||'').split(/\n/).map(x=>x.trim()).filter(Boolean);delete d.checklistText;if(id)Object.assign(m,d);else db.maintenance.push(d);saveData();closeDialog();renderMaintenance();toast('Onderhoud opgeslagen')};
  if(id)$('#deleteMaintenance').onclick=()=>{if(confirm('Onderhoudstaak verwijderen?')){db.maintenance=db.maintenance.filter(x=>x.id!==id);saveData();closeDialog();renderMaintenance()}};
}

function restoreMaintenanceFromRemainingWorkOrders(maintenanceId){
  if(!maintenanceId)return;
  const maintenance=maintenanceById(maintenanceId);
  if(!maintenance)return;
  const previous=(db.workOrders||[])
    .filter(w=>workOrderMaintenanceIds(w).includes(maintenanceId))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')))[0];
  if(previous){
    maintenance.lastDate=previous.date||'';
    maintenance.lastMeter=previous.meter!==''&&previous.meter!=null?num(previous.meter):'';
    maintenance.lastWorkOrder=previous.id||'';
  }else{
    maintenance.lastDate='';
    maintenance.lastMeter='';
    maintenance.lastWorkOrder='';
  }
}
function queuePhotoDeletes(workOrder){db._pendingDriveDeletes=db._pendingDriveDeletes||[];(workOrder.photos||[]).forEach(p=>{if(p.driveFileId&&!db._pendingDriveDeletes.includes(p.driveFileId))db._pendingDriveDeletes.push(p.driveFileId)})}
function deleteWorkOrder(id){
  const index=(db.workOrders||[]).findIndex(w=>w.id===id);if(index<0)return;const workOrder=db.workOrders[index];if(!confirm(`Werkbon ${workOrder.id} naar de prullenbak verplaatsen?`))return;
  db.trash=db.trash||{workOrders:[]};db.trash.workOrders.push({...workOrder,deletedAt:new Date().toISOString()});db.workOrders.splice(index,1);workOrderMaintenanceIds(workOrder).forEach(restoreMaintenanceFromRemainingWorkOrders);saveData();renderLogbook();toast(`Werkbon ${id} staat in de prullenbak`);
}
function restoreTrashedWorkOrder(id){const list=db.trash?.workOrders||[];const index=list.findIndex(w=>w.id===id);if(index<0)return;const w=list[index];delete w.deletedAt;db.workOrders.push(w);list.splice(index,1);workOrderMaintenanceIds(w).forEach(maintenanceId=>{const m=maintenanceById(maintenanceId);if(m){m.lastDate=w.date;m.lastMeter=w.meter!==''?num(w.meter):'';m.lastWorkOrder=w.id}});saveData();renderTrashDialog();toast(`${id} hersteld`)}
function permanentlyDeleteTrashedWorkOrder(id){const list=db.trash?.workOrders||[];const index=list.findIndex(w=>w.id===id);if(index<0)return;if(!confirm(`${id} definitief verwijderen, inclusief foto's?`))return;queuePhotoDeletes(list[index]);list.splice(index,1);saveData();renderTrashDialog();toast(`${id} definitief verwijderd`)}
function renderTrashDialog(){const list=[...(db.trash?.workOrders||[])].sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt)));openDialog(`Prullenbak · ${list.length}`,`<div class="note">Werkbonnen blijven herstelbaar totdat je ze definitief verwijdert.</div><div class="list trash-list">${list.map(w=>`<div class="list-item"><div><strong>${esc(w.id)} · ${esc(w.objectName)}</strong><br><small>${dateNL(w.date)} · verwijderd ${new Date(w.deletedAt).toLocaleDateString('nl-NL')}</small><p>${esc(w.description)}</p>${workOrderTaskSummaryHtml(w)}</div><div class="row-actions"><button class="btn secondary small restore-trash" data-id="${esc(w.id)}">Herstellen</button><button class="btn danger small permanent-trash" data-id="${esc(w.id)}">Definitief</button></div></div>`).join('')||'<div class="empty">De prullenbak is leeg.</div>'}</div><div class="form-actions"><button class="btn secondary" id="closeTrash">Sluiten</button></div>`);$$('.restore-trash').forEach(b=>b.onclick=()=>restoreTrashedWorkOrder(b.dataset.id));$$('.permanent-trash').forEach(b=>b.onclick=()=>permanentlyDeleteTrashedWorkOrder(b.dataset.id));$('#closeTrash').onclick=closeDialog}
function renderLogbook(){
  const rows=[...db.workOrders].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.id).localeCompare(String(a.id)));
  $('#view-logbook').innerHTML=`<div class="card"><div class="section-title"><h3>Logboek · ${rows.length} werkbonnen</h3><div class="section-actions"><button class="btn secondary" id="trashLogbookBtn">Prullenbak (${(db.trash?.workOrders||[]).length})</button><button class="btn secondary" id="exportLogCsv">Export CSV</button></div></div><div class="filters"><input id="logSearch" placeholder="Zoek werk, object of werkbon"></div><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Werkbon</th><th>Object</th><th>Werk</th><th>Teller</th><th>Tijd</th><th>Kosten</th><th>Project</th><th></th></tr></thead><tbody id="logBody"></tbody></table></div></div>`;
  $('#logSearch').oninput=drawLogbook;$('#trashLogbookBtn').onclick=renderTrashDialog;
  $('#exportLogCsv').onclick=()=>exportCsv('vmms_logboek.csv',rows.map(w=>({...w,maintenanceIds:workOrderMaintenanceIds(w).join(', '),maintenanceTasks:workOrderMaintenanceNames(w).join(' | '),fotos:(w.photos||[]).length})));
  drawLogbook();
}
function drawLogbook(){
  const q=($('#logSearch')?.value||'').toLowerCase();
  const rows=[...db.workOrders].filter(w=>!q||[w.id,w.objectName,w.description,w.note,...workOrderMaintenanceNames(w)].join(' ').toLowerCase().includes(q)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  $('#logBody').innerHTML=rows.map(w=>`<tr><td>${dateNL(w.date)}</td><td><b>${esc(w.id)}</b><br><small class="muted">${esc(w.type)}</small></td><td>${esc(w.objectName)}</td><td>${esc(w.description)}${workOrderTaskSummaryHtml(w)}${w.note?'<br><small class="muted">'+esc(w.note)+'</small>':''}${(w.checklistResults||[]).length?`<br><small class="checklist-summary">Checklist ${(w.checklistResults||[]).filter(x=>x.done).length}/${w.checklistResults.length}</small>`:''}${(w.photos||[]).length?`<div class="logbook-photo-strip">${w.photos.slice(0,3).map((p,i)=>`<img src="${photoPreviewSrc(p)}" alt="${escapeAttr(p.name||`Foto ${i+1}`)}">`).join('')}<button type="button" class="btn secondary small open-log-photos" data-id="${esc(w.id)}">Bekijk ${(w.photos||[]).length} foto\'s</button></div>`:''}</td><td>${w.meter!==''?esc(w.meter):'—'}</td><td>${w.hours||'—'}</td><td class="money">${money(workOrderCost(w))}</td><td>${esc(w.projectId||'—')}</td><td><button type="button" class="icon-btn danger-icon delete-workorder" data-id="${esc(w.id)}" title="Werkbon verwijderen">Verwijder</button></td></tr>`).join('')||'<tr><td colspan="9" class="empty">Nog geen werkbonnen.</td></tr>';
  $$('.open-log-photos').forEach(btn=>btn.addEventListener('click',()=>openWorkOrderPhotos(btn.dataset.id)));
  $$('.delete-workorder').forEach(btn=>btn.addEventListener('click',()=>deleteWorkOrder(btn.dataset.id)));
}




const INSPECTION_ZONES=['Voorschip','Middenschip bakboord','Middenschip stuurboord','Achterdek','Stuurhut','Roef / interieur','Machinekamer','Onderwaterschip','Mast en tuigage','Elektrische installatie','Water en sanitair','Veiligheidsmiddelen'];
function renderInspectionPhotoPreview(){
  const host=$('#inspectionPhotoPreview');if(!host)return;
  if(!inspectionDraftPhotos.length){host.innerHTML='<div class="empty">Nog geen inspectiefoto’s toegevoegd.</div>';return}
  host.innerHTML=`<div class="workorder-photo-grid">${inspectionDraftPhotos.map((photo,index)=>`<article class="workorder-photo-card"><span class="photo-stage-badge">${photo.stage==='na'?'Na':'Voor'}</span><img src="${photoPreviewSrc(photo)}" alt="Inspectiefoto"><div class="workorder-photo-meta"><strong>${esc(photo.name||'Foto')}</strong></div><button type="button" class="btn danger small remove-inspection-photo" data-index="${index}">Verwijderen</button></article>`).join('')}</div>`;
  $$('.remove-inspection-photo',host).forEach(button=>button.onclick=()=>{inspectionDraftPhotos.splice(num(button.dataset.index),1);renderInspectionPhotoPreview()});
}
async function handleInspectionPhotoInput(event){
  const stage=event.target.dataset.stage||'voor';const files=[...event.target.files].slice(0,6);
  for(const file of files){if(!(file.type||'').startsWith('image/'))continue;try{const compressed=await compressWorkOrderPhoto(file);inspectionDraftPhotos.push({id:uid('IMG'),name:file.name||'inspectie.jpg',type:'image/jpeg',size:file.size||0,dataUrl:compressed.dataUrl,thumbnail:compressed.thumbnail,driveFileId:'',stage,addedAt:new Date().toISOString()})}catch(error){console.warn(error)}}
  event.target.value='';renderInspectionPhotoPreview();
}
function inspectionSeverityPill(severity){return statusPill(severity==='Urgent'?'Urgent':severity==='Plannen'?'Binnenkort':'Goed')}
function inspectionPhotoHtml(inspection,stage){
  const photo=(inspection.photos||[]).filter(item=>item.stage===stage).slice(-1)[0];
  if(!photo)return `<div class="inspection-photo-empty">Geen ${stage==='voor'?'voorfoto':'nafoto'}</div>`;
  return `<img src="${photoPreviewSrc(photo)}" data-drive-file="${esc(photo.driveFileId||'')}" alt="${stage==='voor'?'Voor':'Na'}foto">`;
}
function createWorkOrderFromInspection(inspection){
  const object=objectById(inspection.objectId);if(!object)return '';
  const id=nextId('WB',db.workOrders,6);db.workOrders.push({id,date:inspection.date,type:'Inspectie',objectId:inspection.objectId,objectName:object.name,system:object.system||'',maintenanceId:'',maintenanceIds:[],maintenanceTaskNames:[],description:`Inspectie ${inspection.zone}: ${inspection.issue}`,meter:'',hours:'',laborCost:0,materialCost:0,projectId:'',documentLink:'',note:`Aangemaakt vanuit ${inspection.id}. Ernst: ${inspection.severity}. ${inspection.note||''}`,checklistResults:[],photos:[]});return id;
}
async function submitInspection(event){
  event.preventDefault();const form=event.currentTarget,f=new FormData(form);const inspection={id:nextId('INS',db.inspections||[],5),date:f.get('date'),zone:f.get('zone'),objectId:f.get('objectId'),severity:f.get('severity'),issue:String(f.get('issue')||'').trim(),note:String(f.get('note')||'').trim(),status:'Open',photos:inspectionDraftPhotos.map(photo=>({...photo})),workOrderId:'',createdAt:new Date().toISOString()};
  if(!inspection.issue){toast('Beschrijf wat je hebt gevonden.');return}
  if(f.get('createWorkOrder')==='on')inspection.workOrderId=createWorkOrderFromInspection(inspection);
  db.inspections=db.inspections||[];db.inspections.push(inspection);inspectionDraftPhotos=[];saveData();renderInspections();toast(`${inspection.id} opgeslagen${inspection.workOrderId?' en werkbon '+inspection.workOrderId+' aangemaakt':''}`);
}
async function addInspectionAfterPhotos(id,event){
  const inspection=(db.inspections||[]).find(item=>item.id===id);if(!inspection)return;
  for(const file of [...event.target.files].slice(0,6)){if(!(file.type||'').startsWith('image/'))continue;try{const compressed=await compressWorkOrderPhoto(file);inspection.photos.push({id:uid('IMG'),name:file.name||'nafoto.jpg',type:'image/jpeg',size:file.size||0,dataUrl:compressed.dataUrl,thumbnail:compressed.thumbnail,driveFileId:'',stage:'na',addedAt:new Date().toISOString()})}catch(error){console.warn(error)}}
  event.target.value='';inspection.status='Afgerond';inspection.completedAt=new Date().toISOString();saveData();renderInspections();toast('Nafoto toegevoegd en inspectie afgerond');
}
function deleteInspection(id){const index=(db.inspections||[]).findIndex(item=>item.id===id);if(index<0||!confirm('Deze inspectie verwijderen?'))return;queuePhotoDeletes(db.inspections[index]);db.inspections.splice(index,1);saveData();renderInspections();toast('Inspectie verwijderd')}
function renderInspections(){
  inspectionDraftPhotos=[];db.inspections=db.inspections||[];
  const objectOptions=db.objects.filter(o=>o.status!=='Buiten gebruik').map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  const cards=[...db.inspections].sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(item=>`<article class="card inspection-card"><div class="inspection-head"><div><span class="meter-label">${esc(item.id)} · ${dateNL(item.date)}</span><h3>${esc(item.zone)}</h3><p>${esc(item.issue)}</p></div><div>${inspectionSeverityPill(item.severity)} ${statusPill(item.status==='Afgerond'?'Goed':'Binnenkort')}</div></div><div class="inspection-meta"><span><b>Object</b>${esc(objectById(item.objectId)?.name||item.objectId)}</span><span><b>Werkbon</b>${esc(item.workOrderId||'Niet aangemaakt')}</span></div>${item.note?`<p class="muted">${esc(item.note)}</p>`:''}<div class="inspection-comparison"><figure><figcaption>Voor</figcaption>${inspectionPhotoHtml(item,'voor')}</figure><figure><figcaption>Na</figcaption>${inspectionPhotoHtml(item,'na')}</figure></div><div class="row-actions"><label class="btn secondary small">Nafoto toevoegen<input class="inspection-after-input" data-id="${esc(item.id)}" type="file" accept="image/*" multiple hidden></label><button class="btn secondary small inspection-object" data-id="${esc(item.objectId)}">Open object</button><button class="btn danger small delete-inspection" data-id="${esc(item.id)}">Verwijderen</button></div></article>`).join('');
  $('#view-inspections').innerHTML=`<div class="card inspection-form-card"><div class="section-title"><div><h3>Schade- en inspectiemodus</h3><small>Leg een plek vast, bepaal de ernst en maak optioneel automatisch een werkbon.</small></div></div><form id="inspectionForm" class="form-grid"><label>Datum<input type="date" name="date" value="${todayISO()}" required></label><label>Zone<select name="zone">${INSPECTION_ZONES.map(zone=>`<option>${esc(zone)}</option>`).join('')}</select></label><label class="span-2">Object<select name="objectId" required><option value="">Kies object…</option>${objectOptions}</select></label><label>Ernst<select name="severity"><option>Observeren</option><option selected>Plannen</option><option>Urgent</option></select></label><div><span class="form-field-label">Werkbon</span><label class="check-inline"><input type="checkbox" name="createWorkOrder" checked> Automatisch werkbon maken</label></div><label class="span-2">Wat is gevonden?<textarea name="issue" required placeholder="Bijvoorbeeld: beginnende roestvorming bij lasnaad"></textarea></label><label class="span-2">Opmerking<textarea name="note"></textarea></label><div class="span-2 staged-photo-inputs"><label>Voorfoto's<input class="inspection-photo-input" data-stage="voor" type="file" accept="image/*" multiple></label><label>Nafoto's<input class="inspection-photo-input" data-stage="na" type="file" accept="image/*" multiple></label></div><div class="span-2" id="inspectionPhotoPreview"><div class="empty">Nog geen inspectiefoto’s toegevoegd.</div></div><div class="span-2 form-actions"><button class="btn" type="submit">Inspectie opslaan</button></div></form></div><div class="section-title inspection-list-title"><h3>Inspectiehistorie · ${db.inspections.length}</h3></div><div class="inspection-list">${cards||'<div class="card empty">Nog geen inspecties vastgelegd.</div>'}</div>`;
  $('#inspectionForm').onsubmit=submitInspection;$$('.inspection-photo-input').forEach(input=>input.onchange=handleInspectionPhotoInput);$$('.inspection-after-input').forEach(input=>input.onchange=event=>addInspectionAfterPhotos(input.dataset.id,event));$$('.inspection-object').forEach(button=>button.onclick=()=>openObjectPage(button.dataset.id));$$('.delete-inspection').forEach(button=>button.onclick=()=>deleteInspection(button.dataset.id));$$('#view-inspections img[data-drive-file]').forEach(img=>{if(img.dataset.driveFile)loadDrivePhotoInto(img,img.dataset.driveFile)});
}

function restorationPackages(){return db.restoration?.workPackages||db.restoration?.phases||[]}
function packageTaskProgress(pkg){
  const tasks=pkg.tasks||[];
  return tasks.length?Math.round(tasks.filter(task=>task.done).length/tasks.length*100):num(pkg.progress);
}
function restorationProgress(){
  const packages=restorationPackages();
  const totalHours=packages.reduce((sum,p)=>sum+num(p.estimatedHours),0);
  if(!totalHours)return 0;
  return Math.round(packages.reduce((sum,p)=>sum+packageTaskProgress(p)*num(p.estimatedHours),0)/totalHours);
}
function restorationStatusPill(status){
  if(['Gereed','Vrijgegeven','Besloten','Gemaakt'].includes(status))return statusPill('Goed');
  if(['Bezig','In voorbereiding','Voorstel','Te controleren'].includes(status))return statusPill('Binnenkort');
  if(['Geblokkeerd','Afgekeurd'].includes(status))return statusPill('Urgent');
  return statusPill('Niet actief');
}
function saveRestorationPlan(){
  const restoration=db.restoration;
  restoration.workPackages.forEach(pkg=>{
    pkg.status=$(`.rest-package-status[data-id="${pkg.id}"]`)?.value||pkg.status;
    pkg.actualCost=num($(`.rest-package-actual[data-id="${pkg.id}"]`)?.value);
    pkg.nextAction=$(`.rest-package-action[data-id="${pkg.id}"]`)?.value||'';
    (pkg.tasks||[]).forEach(task=>{
      task.done=!!$(`.rest-task[data-id="${task.id}"]`)?.checked;
      task.note=$(`.rest-task-note[data-id="${task.id}"]`)?.value||'';
    });
    pkg.progress=packageTaskProgress(pkg);
    if(pkg.progress===100)pkg.status='Gereed';
    else if(pkg.progress>0&&['Niet gestart','Gepland'].includes(pkg.status))pkg.status='Bezig';
  });
  restoration.holdPoints.forEach(item=>{
    item.status=$(`.hold-status[data-id="${item.id}"]`)?.value||item.status;
    item.evidence=$(`.hold-evidence[data-id="${item.id}"]`)?.value||'';
    item.date=$(`.hold-date[data-id="${item.id}"]`)?.value||'';
  });
  restoration.decisions.forEach(item=>{
    item.choice=$(`.decision-choice[data-id="${item.id}"]`)?.value||'';
    item.status=$(`.decision-status[data-id="${item.id}"]`)?.value||item.status;
    item.date=$(`.decision-date[data-id="${item.id}"]`)?.value||'';
  });
  restoration.openPoints.forEach(item=>{
    item.done=!!$(`.open-point-done[data-id="${item.id}"]`)?.checked;
    item.targetDate=$(`.open-point-date[data-id="${item.id}"]`)?.value||'';
    item.note=$(`.open-point-note[data-id="${item.id}"]`)?.value||'';
  });
  restoration.documents.forEach(item=>{
    item.status=$(`.rest-doc-status[data-id="${item.id}"]`)?.value||item.status;
    item.link=$(`.rest-doc-link[data-id="${item.id}"]`)?.value||'';
    item.note=$(`.rest-doc-note[data-id="${item.id}"]`)?.value||'';
  });
  restoration.photoPlan.forEach(item=>{
    item.status=$(`.photo-plan-status[data-id="${item.id}"]`)?.value||item.status;
    item.note=$(`.photo-plan-note[data-id="${item.id}"]`)?.value||'';
  });
  const project=db.projects.find(p=>p.id==='PRJ-REST-001');
  if(project){
    project.progress=restorationProgress()/100;
    project.actualCost=restoration.workPackages.reduce((sum,p)=>sum+num(p.actualCost),0);
    project.nextAction=restoration.workPackages.find(p=>p.status!=='Gereed')?.nextAction||'Oplevering afronden';
  }
  saveData();renderRestoration();toast('Restauratieplan opgeslagen en gesynchroniseerd');
}
function generateRestorationReport(){
  const r=db.restoration,packages=restorationPackages(),progress=restorationProgress();
  const doneTasks=packages.flatMap(p=>p.tasks||[]).filter(t=>t.done).length;
  const totalTasks=packages.flatMap(p=>p.tasks||[]).length;
  const win=window.open('','_blank');if(!win){toast('Sta pop-ups toe om het rapport te openen.');return}
  const rows=packages.map(p=>`<tr><td>${reportEscape(p.id)}</td><td>${reportEscape(p.name)}</td><td>${reportEscape(p.status)}</td><td>${packageTaskProgress(p)}%</td><td>${money(p.costLow)}–${money(p.costHigh)}</td><td>${reportEscape(p.nextAction)}</td></tr>`).join('');
  const taskSections=packages.map(p=>`<h3>${reportEscape(p.id)} · ${reportEscape(p.name)}</h3><ul>${(p.tasks||[]).map(t=>`<li>${t.done?'☑':'☐'} ${reportEscape(t.name)}${t.note?` – ${reportEscape(t.note)}`:''}</li>`).join('')}</ul>`).join('');
  const holdRows=(r.holdPoints||[]).map(h=>`<tr><td>${reportEscape(h.id)}</td><td>${reportEscape(h.condition)}</td><td>${reportEscape(h.status)}</td><td>${reportEscape(h.releasedBy)}</td><td>${reportEscape(h.evidence||'')}</td></tr>`).join('');
  win.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Restauratieplan Variatie</title><style>body{font-family:Arial,sans-serif;color:#162c3b;margin:30px;line-height:1.4}h1,h2,h3{color:#123b5d}header{border-bottom:4px solid #123b5d;margin-bottom:22px}.warning{background:#fff3c7;border:1px solid #deb84c;padding:12px;border-radius:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi{border:1px solid #ccd8df;padding:12px;border-radius:9px}.kpi b{font-size:22px;display:block}table{width:100%;border-collapse:collapse;font-size:10px;margin:12px 0 22px}th,td{border:1px solid #d5dee4;padding:6px;text-align:left;vertical-align:top}th{background:#edf4f7}li{margin:4px 0}@media print{button{display:none}.page-break{break-before:page}body{margin:12mm}}</style></head><body><header><h1>Restauratieplan Variatie</h1><p>Concept V1 · actuele VMMS-stand · ${new Date().toLocaleString('nl-NL')}</p><button onclick="print()">Afdrukken / opslaan als PDF</button></header><div class="warning"><b>Documentstatus:</b> ${reportEscape(r.document.status)}. ${reportEscape(r.document.warning)}</div><div class="kpis"><div class="kpi">Voortgang<b>${progress}%</b></div><div class="kpi">Taken gereed<b>${doneTasks}/${totalTasks}</b></div><div class="kpi">Begroting laag<b>${money(r.project.costReserveLow)}</b></div><div class="kpi">Begroting hoog<b>${money(r.project.costReserveHigh)}</b></div></div><h2>Werkpakketten</h2><table><thead><tr><th>ID</th><th>Werkpakket</th><th>Status</th><th>Voortgang</th><th>Kosten</th><th>Volgende actie</th></tr></thead><tbody>${rows}</tbody></table><h2>Hold points</h2><table><thead><tr><th>ID</th><th>Voorwaarde</th><th>Status</th><th>Vrijgave</th><th>Bewijs</th></tr></thead><tbody>${holdRows}</tbody></table><div class="page-break"><h2>Alle taken</h2>${taskSections}</div></body></html>`);win.document.close();
}

function paintStatusClass(status){return ({Vastgesteld:'goed',Uitgevoerd:'goed',Concept:'binnenkort',Onderzoeken:'achterstallig',Tijdelijk:'niet-actief'}[status]||'nog-invullen')}
function paintZonePhotoId(zone){return zone.customPhotoLibraryId||zone.photoId||photoIdForLegacySrc(zone.photo)||'PHT-CUR-002'}
function startPaintWorkOrder(zoneId){
  const zone=(db.paintPlan?.zones||[]).find(item=>item.id===zoneId);if(!zone)return;
  paintWorkOrderPrefill={zoneId:zone.id,zoneName:zone.name,objectId:zone.objectId};navTo('workorder');
}

async function handlePaintZonePhoto(event){
  const zone=(db.paintPlan?.zones||[]).find(item=>item.id===event.currentTarget.dataset.id),file=event.currentTarget.files?.[0];if(!zone||!file)return;
  if(!driveConnected){toast('Verbind eerst met Google Drive om een zonefoto op te slaan.');return}
  try{const id=uid('PHT-PAINT-CUSTOM-'),remote=await uploadAppDataBlob(`VMMS_FOTO_${id}_${slug(zone.name)}.jpg`,file,{vmmsType:'photo-library',photoId:id,category:'Verfplan'});db.photoLibrary.items.push({id,title:`Zonefoto ${zone.name}`,category:'Verfplan',caption:'Eigen foto bij verfzone '+zone.id,role:'paint-zone',driveFileId:remote.id,mimeType:file.type,size:file.size,thumbnail:await createThumbnailFromBlob(file),uploadedAt:new Date().toISOString()});zone.customPhotoLibraryId=id;delete zone.customPhoto;saveData();await uploadDriveDatabase();renderPaintPlan();toast('Zonefoto in Google Drive opgeslagen.')}catch(error){toast(error.message||'Foto verwerken mislukt.')}
}

function savePaintPlan(){
  const plan=db.paintPlan;if(!plan)return;
  (plan.zones||[]).forEach(zone=>{
    const get=(field)=>document.querySelector(`.paint-zone-field[data-id="${zone.id}"][data-field="${field}"]`)?.value;
    ['systemStatus','condition','currentSystem','desiredSystem','color','lastPainted','nextReview','compatibility','note'].forEach(field=>{const value=get(field);if(value!==undefined)zone[field]=value});
    (zone.layers||[]).forEach((layer,index)=>{
      ['product','coats','color','documentLink'].forEach(field=>{const input=document.querySelector(`.paint-layer-field[data-zone="${zone.id}"][data-index="${index}"][data-field="${field}"]`);if(input)layer[field]=field==='coats'?num(input.value):input.value})
    });
  });
  saveData();toast('Verfplan opgeslagen.');renderPaintPlan();
}
function generatePaintPlanReport(){
  const plan=db.paintPlan;if(!plan)return;const win=window.open('','_blank');if(!win){toast('Sta pop-ups toe voor het rapport.');return}
  const zones=(plan.zones||[]).map(zone=>`<section><h2>${reportEscape(zone.id)} · ${reportEscape(zone.name)}</h2><p><b>Status:</b> ${reportEscape(zone.systemStatus)} · <b>Ondergrond:</b> ${reportEscape(zone.substrate)}</p><p><b>Huidige staat:</b> ${reportEscape(zone.condition)}</p><p><b>Huidig systeem:</b> ${reportEscape(zone.currentSystem)}</p><p><b>Doelsysteem:</b> ${reportEscape(zone.desiredSystem)}</p><table><thead><tr><th>Laag</th><th>Product</th><th>Lagen</th><th>Kleur</th></tr></thead><tbody>${(zone.layers||[]).map(layer=>`<tr><td>${reportEscape(layer.name)}</td><td>${reportEscape(layer.product)}</td><td>${reportEscape(layer.coats)}</td><td>${reportEscape(layer.color)}</td></tr>`).join('')}</tbody></table><p><b>Voorbewerking:</b> ${(zone.preparation||[]).map(reportEscape).join(' · ')}</p><p><b>Compatibiliteit:</b> ${reportEscape(zone.compatibility)}</p></section>`).join('');
  win.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Verfplan Variatie</title><style>body{font-family:Arial;margin:28px;color:#172b3a;line-height:1.4}h1,h2{color:#123b5d}section{break-inside:avoid;border-top:2px solid #123b5d;margin-top:22px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd7df;padding:7px;text-align:left}th{background:#eef4f7}.warning{background:#fff3c7;padding:12px;border:1px solid #d6b34d}@media print{button{display:none}}</style></head><body><h1>Verfplan Variatie</h1><button onclick="print()">Afdrukken / opslaan als PDF</button><p class="warning"><b>Conceptdocument.</b> Definitieve producten en laagopbouw pas vaststellen na onderzoek van de bestaande lagen en controle van actuele productbladen.</p>${zones}</body></html>`);win.document.close();
}
function renderPaintPlan(){
  const plan=db.paintPlan;if(!plan){$('#view-paintplan').innerHTML='<div class="empty">Verfplan niet geladen.</div>';return}
  const zones=plan.zones||[],established=zones.filter(z=>['Vastgesteld','Uitgevoerd'].includes(z.systemStatus)).length,research=zones.filter(z=>z.systemStatus==='Onderzoeken').length;
  $('#view-paintplan').innerHTML=`
    <div class="paint-hero card"><div><span class="meter-label">VMMS 3.7 · Verfplan</span><h3>Wat hoort waar op de Variatie?</h3><p>De foto hieronder verdeelt het schip in verfzones. Tik op een nummer voor de ondergrond, voorbewerking en laagopbouw.</p><div class="restoration-tags"><span>${zones.length} zones</span><span>${established} vastgesteld</span><span>${research} nog onderzoeken</span></div></div><div class="paint-hero-actions"><button class="btn" id="savePaintPlanTop">Opslaan</button><button class="btn secondary" id="paintPlanReport">PDF-verfplan</button></div></div>
    <div class="note"><b>Belangrijk:</b> dit is een technisch concept. Merk, product en overschildertijd moeten per zone worden bevestigd na hechtings- en compatibiliteitsonderzoek. De structuur is geïnspireerd op het onderhoudsplan van de Nicolaas Mulerius.</div>
    <div class="card paint-map-card"><div class="section-title"><div><h3>Visuele verfkaart</h3><small>Externe zones op een actuele foto van de Variatie</small></div></div><div class="paint-photo-map">${photoImgHtml('PHT-CUR-002','Variatie met verfzones')}${zones.filter(z=>z.mapVisible).map(zone=>`<button class="paint-map-pin ${paintStatusClass(zone.systemStatus)}" data-paint-zone="${esc(zone.id)}" style="left:${zone.marker.x}%;top:${zone.marker.y}%" title="${esc(zone.name)}">${zone.number}</button>`).join('')}</div><div class="paint-map-legend">${zones.filter(z=>z.mapVisible).map(zone=>`<button data-paint-zone="${esc(zone.id)}"><b>${zone.number}</b>${esc(zone.name)}</button>`).join('')}</div></div>
    <div class="grid dashboard-grid paint-overview"><div class="card"><div class="section-title"><h3>Werkwijze vóór schilderen</h3></div><div class="list">${(plan.instructions||[]).map(item=>`<div class="list-item"><strong>${esc(item.id)} · ${esc(item.title)}</strong><small>${esc(item.text)}</small></div>`).join('')}</div></div><div class="card"><div class="section-title"><h3>Systeemstatus</h3></div><div class="list"><div class="list-item"><strong>Onderzoeken</strong><small>Bestaande lagen, hechting en compatibiliteit nog niet vastgesteld.</small></div><div class="list-item"><strong>Concept</strong><small>Laagopbouw is voorbereid maar producten zijn nog niet vrijgegeven.</small></div><div class="list-item"><strong>Vastgesteld</strong><small>Producten, kleuren en productbladen zijn gecontroleerd.</small></div></div></div></div>
    <div class="section-title restoration-heading"><div><h3>Verfzones</h3><small>Productvelden zijn bewust nog invulbaar.</small></div></div>
    <div class="paint-zone-list">${zones.map(zone=>`<details class="card paint-zone-card" id="paint-${esc(zone.id)}"><summary>${photoImgHtml(paintZonePhotoId(zone),zone.name)}<div><span class="meter-label">${esc(zone.id)} · ${esc(zone.group)}</span><h3>${esc(zone.number)}. ${esc(zone.name)}</h3><small>${esc(zone.substrate)} · ${esc(zone.condition)}</small></div><span class="status ${paintStatusClass(zone.systemStatus)}">${esc(zone.systemStatus)}</span></summary><div class="paint-zone-body">
      <div class="form-grid"><label>Status<select class="paint-zone-field" data-id="${esc(zone.id)}" data-field="systemStatus">${['Onderzoeken','Concept','Vastgesteld','Uitgevoerd','Tijdelijk'].map(x=>`<option ${x===zone.systemStatus?'selected':''}>${x}</option>`).join('')}</select></label><label>Ondergrond<input value="${esc(zone.substrate)}" readonly></label><label class="span-2">Huidige staat<textarea class="paint-zone-field" data-id="${esc(zone.id)}" data-field="condition">${esc(zone.condition)}</textarea></label><label class="span-2">Bekend huidig systeem<textarea class="paint-zone-field" data-id="${esc(zone.id)}" data-field="currentSystem">${esc(zone.currentSystem)}</textarea></label><label class="span-2">Gewenst systeem<textarea class="paint-zone-field" data-id="${esc(zone.id)}" data-field="desiredSystem">${esc(zone.desiredSystem)}</textarea></label><label>Kleur / kleurplan<input class="paint-zone-field" data-id="${esc(zone.id)}" data-field="color" value="${esc(zone.color)}"></label><label>Laatste schilderdatum<input type="date" class="paint-zone-field" data-id="${esc(zone.id)}" data-field="lastPainted" value="${esc(zone.lastPainted||'')}"></label><label>Volgende beoordeling<input type="date" class="paint-zone-field" data-id="${esc(zone.id)}" data-field="nextReview" value="${esc(zone.nextReview||'')}"></label><label>Eigen zonefoto<input class="paint-zone-photo" data-id="${esc(zone.id)}" type="file" accept="image/*"></label></div>
      <div class="paint-prep"><h4>Voorbewerking</h4>${(zone.preparation||[]).map(step=>`<span>✓ ${esc(step)}</span>`).join('')}</div>
      <div class="table-wrap paint-layer-table"><table><thead><tr><th>Laag</th><th>Product</th><th>Aantal</th><th>Kleur</th><th>Productblad</th></tr></thead><tbody>${(zone.layers||[]).map((layer,index)=>`<tr><td><b>${esc(layer.name)}</b></td><td><input class="paint-layer-field" data-zone="${esc(zone.id)}" data-index="${index}" data-field="product" value="${esc(layer.product)}"></td><td><input type="number" min="0" class="paint-layer-field" data-zone="${esc(zone.id)}" data-index="${index}" data-field="coats" value="${esc(layer.coats)}"></td><td><input class="paint-layer-field" data-zone="${esc(zone.id)}" data-index="${index}" data-field="color" value="${esc(layer.color)}"></td><td><input class="paint-layer-field" data-zone="${esc(zone.id)}" data-index="${index}" data-field="documentLink" value="${esc(layer.documentLink||'')}" placeholder="https://..."></td></tr>`).join('')}</tbody></table></div>
      <label>Compatibiliteit en waarschuwingen<textarea class="paint-zone-field" data-id="${esc(zone.id)}" data-field="compatibility">${esc(zone.compatibility)}</textarea></label><label>Zone-opmerking<textarea class="paint-zone-field" data-id="${esc(zone.id)}" data-field="note">${esc(zone.note||'')}</textarea></label><div class="form-actions"><button class="btn secondary paint-workorder" data-id="${esc(zone.id)}" type="button">Maak schilderwerkbon</button><button class="btn save-single-paint" type="button">Alles opslaan</button></div>
    </div></details>`).join('')}</div>`;
  $('#savePaintPlanTop').onclick=savePaintPlan;$('#paintPlanReport').onclick=generatePaintPlanReport;$$('.save-single-paint').forEach(button=>button.onclick=savePaintPlan);$$('.paint-zone-photo').forEach(input=>input.onchange=handlePaintZonePhoto);$$('[data-paint-zone]').forEach(button=>button.onclick=()=>{const details=$('#paint-'+button.dataset.paintZone);if(details){details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'})}});$$('.paint-workorder').forEach(button=>button.onclick=()=>startPaintWorkOrder(button.dataset.id));hydratePhotoImages($('#view-paintplan'));
}
function sourcingCandidateTotal(candidate){return num(candidate.purchasePrice)+num(candidate.transportCost)+num(candidate.revisionCost)+num(candidate.adaptationCost)}
function selectedSourcingCandidate(item){return (item.candidates||[]).find(candidate=>candidate.selected)||(item.candidates||[])[0]||null}
function sourcingSummary(){
  const items=db.restorationSourcing?.items||[];const allNew=items.reduce((sum,item)=>sum+num(item.newEstimate),0);const targetUsed=items.reduce((sum,item)=>sum+num(item.usedTarget),0);const current=items.reduce((sum,item)=>{const c=selectedSourcingCandidate(item);return sum+(c?sourcingCandidateTotal(c):num(item.newEstimate))},0);const found=items.filter(item=>(item.candidates||[]).length).length;return {items,allNew,targetUsed,current,found,potential:allNew-current};
}
function sourcingSummaryHtml(){const s=sourcingSummary();return `<div class="card sourcing-summary-card"><div class="section-title"><div><h3>Tweedehands onderdelen en hergebruik</h3><small>${esc(db.restorationSourcing?.policy||'')}</small></div><button class="btn" data-view="parts">Open volledige inkoopmodule</button></div><div class="grid kpis"><div class="kpi info"><h3>Zoekitems</h3><strong>${s.items.length}</strong></div><div class="kpi info"><h3>Met kandidaat</h3><strong>${s.found}</strong></div><div class="kpi info"><h3>Alles nieuw</h3><strong style="font-size:20px">${money(s.allNew)}</strong></div><div class="kpi info"><h3>Huidige keuze</h3><strong style="font-size:20px">${money(s.current)}</strong></div></div><p class="drive-help">Indicatieve bedragen. Een lage aankoopprijs is pas een besparing nadat transport, revisie, aanpassing, inspectie en eventuele constructiekosten zijn meegenomen.</p></div>`}
function openSourcingCandidateDialog(itemId,candidateId=''){
  const item=(db.restorationSourcing?.items||[]).find(row=>row.id===itemId);if(!item)return;const existing=(item.candidates||[]).find(row=>row.id===candidateId);const c=existing||{id:uid('KAND'),title:'',sourceType:'Tweedehands',link:'',seller:'',location:'',purchasePrice:0,transportCost:0,revisionCost:0,adaptationCost:0,status:'Beoordelen',fit:'Onvoldoende gegevens',risk:'Middel',selected:false,notes:''};
  openDialog(`${existing?'Kandidaat bewerken':'Kandidaat toevoegen'} · ${item.name}`,`<form id="candidateForm" class="form-grid"><label class="span-2">Omschrijving<input name="title" value="${esc(c.title)}" required></label><label>Herkomst<select name="sourceType">${['Tweedehands','Sloop','Nieuw','Zelfbouw','Hergebruik eigen schip'].map(x=>`<option ${x===c.sourceType?'selected':''}>${x}</option>`).join('')}</select></label><label>Status<select name="status">${['Beoordelen','Informatie gevraagd','Bezichtiging plannen','Bod gedaan','Geselecteerd','Gekocht','Afgewezen'].map(x=>`<option ${x===c.status?'selected':''}>${x}</option>`).join('')}</select></label><label class="span-2">Advertentie- of bronlink<input name="link" type="url" value="${esc(c.link)}" placeholder="https://..."></label><label>Verkoper<input name="seller" value="${esc(c.seller)}"></label><label>Locatie<input name="location" value="${esc(c.location)}"></label><label>Aankoopprijs<input name="purchasePrice" type="number" min="0" step="1" value="${num(c.purchasePrice)}"></label><label>Transport<input name="transportCost" type="number" min="0" step="1" value="${num(c.transportCost)}"></label><label>Revisie<input name="revisionCost" type="number" min="0" step="1" value="${num(c.revisionCost)}"></label><label>Aanpassing<input name="adaptationCost" type="number" min="0" step="1" value="${num(c.adaptationCost)}"></label><label>Passendheid<select name="fit">${['Onvoldoende gegevens','Past waarschijnlijk','Aanpassing nodig','Niet passend'].map(x=>`<option ${x===c.fit?'selected':''}>${x}</option>`).join('')}</select></label><label>Risico<select name="risk">${['Laag','Middel','Hoog','Kritiek'].map(x=>`<option ${x===c.risk?'selected':''}>${x}</option>`).join('')}</select></label><label class="span-2 check-inline"><input type="checkbox" name="selected" ${c.selected?'checked':''}> Gebruik als huidige voorkeurskandidaat</label><label class="span-2">Notities en gebreken<textarea name="notes">${esc(c.notes)}</textarea></label><div class="span-2 form-actions"><button type="button" class="btn secondary" id="cancelCandidate">Annuleren</button><button class="btn">Opslaan</button></div></form>`);
  $('#cancelCandidate').onclick=closeDialog;$('#candidateForm').onsubmit=event=>{event.preventDefault();const d=Object.fromEntries(new FormData(event.currentTarget).entries());['purchasePrice','transportCost','revisionCost','adaptationCost'].forEach(key=>d[key]=num(d[key]));d.selected=event.currentTarget.elements.selected.checked;d.id=c.id;if(d.selected)(item.candidates||[]).forEach(row=>row.selected=false);item.candidates=item.candidates||[];if(existing)Object.assign(existing,d);else item.candidates.push(d);saveData();closeDialog();renderParts();toast('Kandidaat opgeslagen.')};
}
function saveSourcingItems(){
  (db.restorationSourcing?.items||[]).forEach(item=>{['status','decision','requiredSpecs','notes','newEstimate','usedTarget'].forEach(field=>{const input=document.querySelector(`.sourcing-item-field[data-id="${item.id}"][data-field="${field}"]`);if(input)item[field]=['newEstimate','usedTarget'].includes(field)?num(input.value):input.value})});saveData();toast('Restauratie-inkoop opgeslagen.');renderParts();
}
function deleteSourcingCandidate(itemId,candidateId){const item=(db.restorationSourcing?.items||[]).find(row=>row.id===itemId);if(!item||!confirm('Deze kandidaat verwijderen?'))return;item.candidates=(item.candidates||[]).filter(row=>row.id!==candidateId);saveData();renderParts();}
function renderParts(){
  const s=sourcingSummary();const query=($('#sourcingSearch')?.value||'').toLowerCase();
  $('#view-parts').innerHTML=`<div class="paint-hero card"><div><span class="meter-label">Restauratieplan · tweedehands</span><h3>Zoeken, beoordelen en vergelijken</h3><p>Geen voorraadbeheer: deze module gaat alleen over grote restauratieonderdelen, advertenties, maatvoering, revisie en aankoopbesluiten.</p></div><div class="paint-hero-actions"><button class="btn" id="saveSourcing">Alles opslaan</button><button class="btn secondary" id="exportSourcing">Export CSV</button></div></div><div class="grid kpis"><div class="card kpi info"><h3>Zoekitems</h3><strong>${s.items.length}</strong></div><div class="card kpi info"><h3>Kandidaten gevonden</h3><strong>${s.found}</strong></div><div class="card kpi info"><h3>Alles nieuw</h3><strong style="font-size:20px">${money(s.allNew)}</strong></div><div class="card kpi info"><h3>Huidige keuze</h3><strong style="font-size:20px">${money(s.current)}</strong></div></div><div class="note"><b>Hold point:</b> koop geen mast, zwaard, lier of ander dragend onderdeel voordat maatblad, belastingsuitgangspunten en vereiste deskundige beoordeling gereed zijn.</div><div class="card"><div class="section-title"><h3>Budgetscenario’s</h3></div><div class="scenario-grid"><div><span>Alles nieuw</span><b>${money(s.allNew)}</b><small>Referentieraming</small></div><div><span>Doel tweedehands</span><b>${money(s.targetUsed)}</b><small>Zoekbudget vóór definitieve offertes</small></div><div><span>Huidige kandidaten</span><b>${money(s.current)}</b><small>Niet gevonden items staan nog op nieuwprijs</small></div><div><span>Potentiële besparing</span><b>${money(Math.max(0,s.potential))}</b><small>Alleen indicatief</small></div></div></div><div class="card" style="margin-top:16px"><div class="filters"><input id="sourcingSearch" type="search" placeholder="Zoek onderdeel of categorie"><select id="sourcingStatus"><option value="">Alle statussen</option>${['Zoeken','Gevonden','Beoordelen','Bod gedaan','Gekocht','Afgewezen'].map(x=>`<option>${x}</option>`).join('')}</select></div></div><div class="sourcing-item-list">${s.items.map(item=>{const candidates=item.candidates||[],selected=selectedSourcingCandidate(item);return `<details class="card sourcing-item"><summary><div><span class="meter-label">${esc(item.id)} · ${esc(item.category)}</span><h3>${esc(item.name)}</h3><small>${esc(item.priority)} · ${esc(item.reviewer)}</small></div><div class="sourcing-summary-right"><span class="status ${paintStatusClass(item.status==='Gekocht'?'Uitgevoerd':item.status==='Zoeken'?'Onderzoeken':'Concept')}">${esc(item.status)}</span><b>${candidates.length} kandidaat${candidates.length===1?'':'en'}</b></div></summary><div class="sourcing-body"><div class="form-grid"><label>Status<select class="sourcing-item-field" data-id="${esc(item.id)}" data-field="status">${['Zoeken','Gevonden','Beoordelen','Bod gedaan','Gekocht','Afgewezen'].map(x=>`<option ${x===item.status?'selected':''}>${x}</option>`).join('')}</select></label><label>Besluit<select class="sourcing-item-field" data-id="${esc(item.id)}" data-field="decision">${['Nog niet besloten','Tweedehands voorkeur','Nieuw voorkeur','Zelfbouw','Afgewezen'].map(x=>`<option ${x===item.decision?'selected':''}>${x}</option>`).join('')}</select></label><label>Nieuwe referentieprijs<input type="number" class="sourcing-item-field" data-id="${esc(item.id)}" data-field="newEstimate" value="${num(item.newEstimate)}"></label><label>Doelbudget tweedehands<input type="number" class="sourcing-item-field" data-id="${esc(item.id)}" data-field="usedTarget" value="${num(item.usedTarget)}"></label><label class="span-2">Benodigde maten en specificaties<textarea class="sourcing-item-field" data-id="${esc(item.id)}" data-field="requiredSpecs">${esc(item.requiredSpecs)}</textarea></label><label class="span-2">Notities<textarea class="sourcing-item-field" data-id="${esc(item.id)}" data-field="notes">${esc(item.notes||'')}</textarea></label></div><div class="search-term-row">${(item.searchTerms||[]).map(term=>`<a class="btn secondary small" href="https://www.google.com/search?q=${encodeURIComponent(term)}" target="_blank" rel="noopener">Zoek: ${esc(term)}</a>`).join('')}</div><div class="section-title" style="margin-top:16px"><h3>Kandidaten</h3><button class="btn add-candidate" data-id="${esc(item.id)}">Advertentie / kandidaat toevoegen</button></div><div class="candidate-list">${candidates.map(c=>`<div class="candidate-card ${c.selected?'selected':''}"><div><strong>${esc(c.title||'Naamloze kandidaat')}</strong><small>${esc(c.sourceType)} · ${esc(c.status)} · ${esc(c.location||'locatie onbekend')}</small></div><div class="candidate-cost"><span>Totaal</span><b>${money(sourcingCandidateTotal(c))}</b><small>aankoop ${money(c.purchasePrice)} + transport/revisie/aanpassing</small></div><div class="candidate-flags"><span class="status ${c.fit==='Past waarschijnlijk'?'goed':c.fit==='Niet passend'?'urgent':'binnenkort'}">${esc(c.fit)}</span><span class="status ${c.risk==='Laag'?'goed':c.risk==='Kritiek'?'urgent':'binnenkort'}">Risico ${esc(c.risk)}</span>${c.selected?'<span class="status goed">Voorkeur</span>':''}</div><div class="row-actions">${c.link?`<a class="btn secondary small" href="${esc(c.link)}" target="_blank" rel="noopener">Open bron</a>`:''}<button class="btn secondary small edit-candidate" data-item="${esc(item.id)}" data-id="${esc(c.id)}">Bewerk</button><button class="btn danger small delete-candidate" data-item="${esc(item.id)}" data-id="${esc(c.id)}">Verwijder</button></div>${c.notes?`<p>${esc(c.notes)}</p>`:''}</div>`).join('')||'<div class="empty">Nog geen advertentie of kandidaat opgeslagen.</div>'}</div>${selected?`<div class="note"><b>Huidige vergelijking:</b> geselecteerde kandidaat ${money(sourcingCandidateTotal(selected))} tegenover nieuwraming ${money(item.newEstimate)}.</div>`:''}</div></details>`}).join('')}</div>`;
  $('#saveSourcing').onclick=saveSourcingItems;$('#exportSourcing').onclick=()=>exportCsv('vmms_restauratie_inkoop.csv',s.items.flatMap(item=>(item.candidates||[]).length?(item.candidates||[]).map(c=>({item:item.name,categorie:item.category,status:item.status,kandidaat:c.title,herkomst:c.sourceType,link:c.link,locatie:c.location,aankoop:c.purchasePrice,transport:c.transportCost,revisie:c.revisionCost,aanpassing:c.adaptationCost,totaal:sourcingCandidateTotal(c),passendheid:c.fit,risico:c.risk,voorkeur:c.selected})): [{item:item.name,categorie:item.category,status:item.status,kandidaat:'',nieuwraming:item.newEstimate,doel_tweedehands:item.usedTarget}]));$$('.add-candidate').forEach(button=>button.onclick=()=>openSourcingCandidateDialog(button.dataset.id));$$('.edit-candidate').forEach(button=>button.onclick=()=>openSourcingCandidateDialog(button.dataset.item,button.dataset.id));$$('.delete-candidate').forEach(button=>button.onclick=()=>deleteSourcingCandidate(button.dataset.item,button.dataset.id));$('#sourcingSearch').oninput=event=>{const q=event.target.value.toLowerCase();$$('.sourcing-item').forEach(card=>card.hidden=!card.textContent.toLowerCase().includes(q))};$('#sourcingStatus').onchange=event=>{const status=event.target.value;$$('.sourcing-item').forEach((card,index)=>card.hidden=!!status&&s.items[index]?.status!==status)};
}

function renderRestoration(){
  const r=db.restoration||window.VMMS_RESTORATION_PLAN;
  if(!r){$('#view-restoration').innerHTML='<div class="empty">Restauratieplan niet geladen.</div>';return}
  const packages=restorationPackages(),progress=restorationProgress();
  const tasks=packages.flatMap(p=>p.tasks||[]);
  const doneTasks=tasks.filter(t=>t.done).length;
  const actualCost=packages.reduce((sum,p)=>sum+num(p.actualCost),0);
  const released=(r.holdPoints||[]).filter(h=>h.status==='Vrijgegeven').length;
  const openActions=(r.openPoints||[]).filter(p=>!p.done).length;

  $('#view-restoration').innerHTML=`
  <div class="restoration-dossier-hero card">
    <div>
      <span class="meter-label">Restauratiedossier · Concept V1</span>
      <h3>Variatie terug naar de historische buitenstaat</h3>
      <p>${esc(r.target)}</p>
      <div class="restoration-tags"><span>${esc(r.document.targetPeriod)}</span><span>${esc(r.document.restorationClass)}</span><span>${esc(r.document.use)}</span></div>
    </div>
    <div class="restoration-score"><b>${progress}%</b><span>gewogen voortgang</span></div>
  </div>
  <div class="note restoration-warning"><b>${esc(r.document.status)}.</b> ${esc(r.document.warning)}</div>

  <div class="grid kpis">
    <div class="card kpi info"><h3>Werkpakketten</h3><strong>${packages.length}</strong><div class="muted">maand 1–15</div></div>
    <div class="card kpi info"><h3>Taken</h3><strong>${doneTasks}/${tasks.length}</strong><div class="muted">afgerond</div></div>
    <div class="card kpi info"><h3>Reservering</h3><strong style="font-size:18px">${money(r.project.costReserveLow)}<br>– ${money(r.project.costReserveHigh)}</strong></div>
    <div class="card kpi info"><h3>Werkelijke kosten</h3><strong style="font-size:21px">${money(actualCost)}</strong></div>
    <div class="card kpi info"><h3>Projecturen</h3><strong>${r.project.estimatedHours}</strong></div>
    <div class="card kpi info"><h3>Hold points</h3><strong>${released}/${r.holdPoints.length}</strong><div class="muted">vrijgegeven</div></div>
    <div class="card kpi info"><h3>Open acties</h3><strong>${openActions}</strong></div>
    <div class="card kpi info"><h3>Doelperiode</h3><strong style="font-size:22px">${esc(r.document.targetPeriod)}</strong></div>
  </div>

  <div class="card restoration-actions-card">
    <div class="section-title"><div><h3>Eerstvolgende acties</h3><small>De eerste stappen leveren de informatie voor het maatvaste voorontwerp.</small></div></div>
    <div class="restoration-first-actions">
      ${r.openPoints.slice(0,8).map((item,i)=>`<label class="restoration-action-row ${item.done?'done':''}"><input class="open-point-done" data-id="${esc(item.id)}" type="checkbox" ${item.done?'checked':''}><span class="action-number">${i+1}</span><span><b>${esc(item.name)}</b><small>${esc(item.owner)}</small></span><input class="open-point-date" data-id="${esc(item.id)}" type="date" value="${esc(item.targetDate||'')}"><input class="open-point-note" data-id="${esc(item.id)}" placeholder="Notitie" value="${esc(item.note||'')}"></label>`).join('')}
    </div>
  </div>

  <div class="card restoration-timeline-card">
    <div class="section-title"><div><h3>Planning maand 1–15</h3><small>Vroege projectplanning; pas definitief maken na opname en offertes.</small></div></div>
    <div class="restoration-timeline">
      <div class="timeline-months">${Array.from({length:15},(_,i)=>`<span>${i+1}</span>`).join('')}</div>
      ${packages.map(p=>`<div class="timeline-row"><b>${esc(p.id)}</b><span>${esc(p.name)}</span><div class="timeline-track"><i style="left:${(p.startMonth-1)/15*100}%;width:${(p.endMonth-p.startMonth+1)/15*100}%"></i></div></div>`).join('')}
    </div>
  </div>

  <div class="section-title restoration-heading"><div><h3>12 werkpakketten en 60 taken</h3><small>Vink taken af; de voortgang wordt automatisch berekend.</small></div></div>
  <div class="restoration-package-list">
    ${packages.map(p=>{
      const pp=packageTaskProgress(p),done=(p.tasks||[]).filter(t=>t.done).length;
      return `<details class="card restoration-work-package" ${p.status==='Bezig'||p.id==='WP-REST-01'?'open':''}>
        <summary>
          <div><span class="meter-label">${esc(p.id)} · ${esc(p.phase)}</span><h3>${esc(p.name)}</h3><small>${esc(p.owner)} · maand ${p.startMonth}–${p.endMonth} · ${p.estimatedHours} uur</small></div>
          <div class="package-summary-right">${restorationStatusPill(p.status)}<b>${pp}%</b><small>${done}/${p.tasks.length} taken</small></div>
        </summary>
        <div class="package-body">
          <div class="progress-track"><span style="width:${pp}%"></span></div>
          <div class="restoration-package-facts">
            <div><span>Afhankelijk van</span><b>${esc(p.dependsOn)}</b></div>
            <div><span>Prioriteit</span><b>${esc(p.priority)}</b></div>
            <div><span>Begroting</span><b>${money(p.costLow)} – ${money(p.costHigh)}</b></div>
            <div><span>Hold point</span><b>${esc(p.holdPoint)}</b></div>
            <div class="wide"><span>Acceptatiecriterium</span><b>${esc(p.acceptance)}</b></div>
          </div>
          <div class="restoration-package-inputs">
            <label>Status<select class="rest-package-status" data-id="${esc(p.id)}">${['Niet gestart','In voorbereiding','Bezig','Gepauzeerd','Geblokkeerd','Gereed'].map(x=>`<option ${x===p.status?'selected':''}>${x}</option>`).join('')}</select></label>
            <label>Werkelijke kosten<input class="rest-package-actual" data-id="${esc(p.id)}" type="number" min="0" step="100" value="${num(p.actualCost)}"></label>
            <label class="wide">Volgende actie<textarea class="rest-package-action" data-id="${esc(p.id)}">${esc(p.nextAction)}</textarea></label>
          </div>
          <div class="restoration-task-list">
            ${(p.tasks||[]).map(task=>`<div class="restoration-task-row ${task.done?'done':''}"><label><input class="rest-task" data-id="${esc(task.id)}" type="checkbox" ${task.done?'checked':''}><span><b>${esc(task.id)}</b> ${esc(task.name)}</span></label><input class="rest-task-note" data-id="${esc(task.id)}" value="${esc(task.note||'')}" placeholder="Taaknotitie"></div>`).join('')}
          </div>
        </div>
      </details>`}).join('')}
  </div>

  <div class="grid dashboard-grid restoration-registers">
    <div class="card"><div class="section-title"><h3>Hold points</h3></div>
      <div class="restoration-register-list">${r.holdPoints.map(h=>`<div class="register-item"><div class="register-head"><b>${esc(h.id)}</b>${restorationStatusPill(h.status)}</div><p>${esc(h.condition)}</p><small>Vrijgave door: ${esc(h.releasedBy)}</small><div class="register-inputs"><select class="hold-status" data-id="${esc(h.id)}">${['Open','In voorbereiding','Vrijgegeven','Afgekeurd'].map(x=>`<option ${x===h.status?'selected':''}>${x}</option>`).join('')}</select><input class="hold-date" data-id="${esc(h.id)}" type="date" value="${esc(h.date||'')}"><input class="hold-evidence" data-id="${esc(h.id)}" value="${esc(h.evidence||'')}" placeholder="Bewijs / rapport"></div></div>`).join('')}</div>
    </div>
    <div class="card"><div class="section-title"><h3>Besluitenregister</h3></div>
      <div class="restoration-register-list">${r.decisions.map(d=>`<div class="register-item"><div class="register-head"><b>${esc(d.id)} · ${esc(d.subject)}</b>${restorationStatusPill(d.status)}</div><small>Beslisser: ${esc(d.decider)}</small><div class="register-inputs"><input class="decision-choice" data-id="${esc(d.id)}" value="${esc(d.choice)}"><select class="decision-status" data-id="${esc(d.id)}">${['Open','Voorstel','Besloten'].map(x=>`<option ${x===d.status?'selected':''}>${x}</option>`).join('')}</select><input class="decision-date" data-id="${esc(d.id)}" type="date" value="${esc(d.date||'')}"></div></div>`).join('')}</div>
    </div>
  </div>

  <div class="card restoration-documents-card">
    <div class="section-title"><div><h3>Ontwerpdocumenten</h3><small>D-001 tot en met D-014</small></div></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Document</th><th>Eigenaar</th><th>Status</th><th>Link</th><th>Notitie</th></tr></thead><tbody>${r.documents.map(d=>`<tr><td><b>${esc(d.id)}</b></td><td>${esc(d.name)}</td><td>${esc(d.owner)}</td><td><select class="rest-doc-status" data-id="${esc(d.id)}">${['Te maken na opname','Te maken','Te berekenen','Te ontwerpen','Te bepalen','In voorbereiding','Beschikbaar','Goedgekeurd','Na uitvoering'].map(x=>`<option ${x===d.status?'selected':''}>${x}</option>`).join('')}</select></td><td><input class="rest-doc-link" data-id="${esc(d.id)}" value="${esc(d.link||'')}" placeholder="Link"></td><td><input class="rest-doc-note" data-id="${esc(d.id)}" value="${esc(d.note||'')}" placeholder="Notitie"></td></tr>`).join('')}</tbody></table></div>
  </div>

  <div class="card restoration-photo-plan-card">
    <div class="section-title"><div><h3>Foto-opnameplan</h3><small>Maak iedere opname met de genoemde maatreferentie.</small></div></div>
    <div class="restoration-photo-plan">${r.photoPlan.map(f=>`<div class="photo-plan-row"><b>${esc(f.id)}</b><span><strong>${esc(f.name)}</strong><small>${esc(f.reference)}</small></span><select class="photo-plan-status" data-id="${esc(f.id)}">${['Open','Gemaakt','Goedgekeurd','Opnieuw maken'].map(x=>`<option ${x===f.status?'selected':''}>${x}</option>`).join('')}</select><input class="photo-plan-note" data-id="${esc(f.id)}" value="${esc(f.note||'')}" placeholder="Bestand / notitie"></div>`).join('')}</div>
  </div>

  ${inspirationReferenceHtml()}

  ${sourcingSummaryHtml()}

  <div class="form-actions restoration-footer-actions">
    <button class="btn" id="saveRestoration">Alles opslaan</button>
    <button class="btn secondary" id="restorationReport">Actueel PDF-rapport</button>
    <a class="btn secondary restoration-static-link" href="restauratieplan.html" target="_blank" rel="noopener">Open vast dossier</a>
  </div>`;

  $('#saveRestoration').onclick=saveRestorationPlan;
  $('#restorationReport').onclick=generateRestorationReport;
}

function showShipZone(system){const objects=db.objects.filter(o=>o.system===system);openDialog(system,`<div class="list">${objects.map(o=>`<button class="list-item zone-object" data-id="${esc(o.id)}"><strong>${esc(o.name)}</strong><small>${esc(o.location||'')}</small></button>`).join('')||'<div class="empty">Geen objecten in deze zone.</div>'}</div>`);$$('.zone-object').forEach(b=>b.onclick=()=>{closeDialog();openObjectPage(b.dataset.id)})}

function renderProjects(){
  $('#view-projects').innerHTML=`<div class="card"><div class="section-title"><h3>Projecten · ${db.projects.length}</h3><button class="btn" id="addProjectBtn">Project toevoegen</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Project</th><th>Systeem</th><th>Status</th><th>Budget</th><th>Kosten</th><th>Voortgang</th><th>Volgende actie</th><th></th></tr></thead><tbody>${db.projects.map(p=>`<tr><td><b>${esc(p.id)}</b></td><td>${esc(p.name)}</td><td>${esc(p.system)}</td><td>${statusPill(p.status==='Gereed'?'Goed':p.status==='Bezig'?'Binnenkort':'Niet actief')}</td><td>${money(p.budget)}</td><td>${money(projectCost(p.id))}</td><td>${Math.round(num(p.progress)*100)}%</td><td>${esc(p.nextAction)}</td><td><button class="icon-btn edit-project" data-id="${esc(p.id)}">Bewerk</button></td></tr>`).join('')}</tbody></table></div></div>`;
  $('#addProjectBtn').onclick=()=>openProjectDialog();$$('.edit-project').forEach(b=>b.onclick=()=>openProjectDialog(b.dataset.id));
}
function openProjectDialog(id=''){
  const p=id?db.projects.find(x=>x.id===id):{id:nextId('PRJ',db.projects),name:'',system:'Staal buiten',status:'Gepland',priority:'Normaal',budget:0,progress:0,nextAction:'',note:''};
  openDialog(id?'Project bewerken':'Project toevoegen',`<form id="projectForm" class="form-grid">
  <label>Project ID<input name="id" value="${esc(p.id)}" ${id?'readonly':''}></label><label>Naam<input name="name" value="${esc(p.name)}" required></label>
  <label>Systeem<input name="system" value="${esc(p.system)}"></label><label>Status<select name="status">${['Gepland','Bezig','Gepauzeerd','Gereed'].map(x=>`<option ${x===p.status?'selected':''}>${x}</option>`).join('')}</select></label>
  <label>Budget<input type="number" step=".01" name="budget" value="${esc(p.budget)}"></label><label>Voortgang (0–100%)<input type="number" min="0" max="100" name="progressPct" value="${Math.round(num(p.progress)*100)}"></label>
  <label class="span-2">Volgende actie<input name="nextAction" value="${esc(p.nextAction)}"></label><label class="span-2">Opmerking<textarea name="note">${esc(p.note)}</textarea></label>
  <div class="span-2 form-actions"><button type="button" class="btn secondary" id="cancelDialog">Annuleren</button><button class="btn">Opslaan</button></div></form>`);
  $('#cancelDialog').onclick=closeDialog;$('#projectForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());d.budget=num(d.budget);d.progress=num(d.progressPct)/100;delete d.progressPct;if(id)Object.assign(p,d);else db.projects.push(d);saveData();closeDialog();renderProjects();toast('Project opgeslagen')};
}

function vrmCollect(node,path='',out=[]){if(node==null)return out;if(Array.isArray(node)){node.forEach((v,i)=>vrmCollect(v,path+'['+i+']',out));return out}if(typeof node==='object'){const desc=node.description||node.name||node.code||node.attributeName;const value=node.value??node.valueFormattedWithUnit??node.formattedValue;if(desc&&value!=null)out.push({label:String(desc),value});Object.entries(node).forEach(([k,v])=>vrmCollect(v,path+'.'+k,out));}return out}
function findVrmMetric(fields,terms){const f=fields.find(x=>terms.every(t=>x.label.toLowerCase().includes(t)));return f?.value??'—'}
async function loadVictronData(){
  const token=localStorage.getItem(VRM_TOKEN_KEY)||'',site=localStorage.getItem(VRM_SITE_KEY)||'';const status=$('#vrmStatus');if(!token||!site){if(status)status.textContent='Vul eerst een VRM access token en installatie-ID in.';return}
  if(status)status.textContent='Victron-gegevens laden…';try{const response=await fetch(`https://vrmapi.victronenergy.com/v2/installations/${encodeURIComponent(site)}/system-overview`,{headers:{'X-Authorization':'Token '+token,'Accept':'application/json'}});if(!response.ok)throw new Error('VRM API fout '+response.status);const data=await response.json();const fields=vrmCollect(data);$('#vrmSoc').textContent=findVrmMetric(fields,['soc']);$('#vrmBattery').textContent=findVrmMetric(fields,['battery','voltage']);$('#vrmPv').textContent=findVrmMetric(fields,['solar']);$('#vrmPower').textContent=findVrmMetric(fields,['power']);$('#vrmRaw').textContent=JSON.stringify(data,null,2);if(status)status.textContent='Laatst bijgewerkt '+new Date().toLocaleTimeString('nl-NL');}catch(error){if(status)status.textContent='Kon VRM niet laden: '+error.message+' Controleer token, installatie-ID en internet.'}
}
function renderVictron(){
  clearInterval(vrmRefreshTimer);const configured=localStorage.getItem(VRM_TOKEN_KEY)&&localStorage.getItem(VRM_SITE_KEY);
  $('#view-victron').innerHTML=`<div class="note"><b>Veiligheid:</b> de VRM-token wordt alleen lokaal in deze browser opgeslagen en niet naar de VMMS-database of Google Drive geschreven.</div><div class="grid kpis"><div class="card kpi info"><h3>Accu-SOC</h3><strong id="vrmSoc">—</strong></div><div class="card kpi info"><h3>Accuspanning</h3><strong id="vrmBattery">—</strong></div><div class="card kpi info"><h3>Zonne-energie</h3><strong id="vrmPv">—</strong></div><div class="card kpi info"><h3>Systeemvermogen</h3><strong id="vrmPower">—</strong></div></div><div class="grid dashboard-grid"><div class="card"><div class="section-title"><h3>VRM-koppeling</h3></div><form id="vrmForm" class="form-grid"><label>Installatie-ID<input name="site" value="${esc(localStorage.getItem(VRM_SITE_KEY)||'')}" placeholder="Nummer uit VRM-URL"></label><label>VRM access token<input name="token" type="password" placeholder="${localStorage.getItem(VRM_TOKEN_KEY)?'Token is opgeslagen':'Plak token'}"></label><div class="span-2 form-actions"><button class="btn">Opslaan en verbinden</button><button type="button" class="btn secondary" id="refreshVrm">Vernieuwen</button><button type="button" class="btn danger" id="clearVrm">Koppeling wissen</button></div></form><p id="vrmStatus" class="muted">${configured?'Koppeling ingesteld.':'Nog niet gekoppeld.'}</p></div><div class="card"><div class="section-title"><h3>Technische respons</h3></div><pre id="vrmRaw" class="vrm-raw">Nog geen gegevens geladen.</pre></div></div>`;
  $('#vrmForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('site'))localStorage.setItem(VRM_SITE_KEY,String(f.get('site')).trim());if(f.get('token'))localStorage.setItem(VRM_TOKEN_KEY,String(f.get('token')).trim());loadVictronData()};$('#refreshVrm').onclick=loadVictronData;$('#clearVrm').onclick=()=>{localStorage.removeItem(VRM_TOKEN_KEY);localStorage.removeItem(VRM_SITE_KEY);renderVictron()};if(configured){loadVictronData();vrmRefreshTimer=setInterval(()=>{if(currentView==='victron')loadVictronData()},60000)}
}

function renderCosts(){
  const years=unique(db.workOrders.map(w=>String(new Date(w.date).getFullYear()))).reverse();const selected=String($('#costYear')?.value||years[0]||new Date().getFullYear());const rows=db.workOrders.filter(w=>String(new Date(w.date).getFullYear())===selected);const total=rows.reduce((a,w)=>a+workOrderCost(w),0),month=Array(12).fill(0),bySystem={},byObject={};rows.forEach(w=>{const d=new Date(w.date);month[d.getMonth()]+=workOrderCost(w);bySystem[w.system||'Overig']=(bySystem[w.system||'Overig']||0)+workOrderCost(w);byObject[w.objectName||w.objectId]=(byObject[w.objectName||w.objectId]||0)+workOrderCost(w)});const max=Math.max(1,...month);
  $('#view-costs').innerHTML=`<div class="card"><div class="section-title"><h3>Kostenanalyse</h3><select id="costYear">${years.length?years.map(y=>`<option ${y===selected?'selected':''}>${y}</option>`).join(''):`<option>${selected}</option>`}</select></div></div><div class="grid kpis" style="margin-top:16px"><div class="card kpi info"><h3>Totaal ${selected}</h3><strong style="font-size:24px">${money(total)}</strong></div><div class="card kpi info"><h3>Werkbonnen</h3><strong>${rows.length}</strong></div><div class="card kpi info"><h3>Gemiddeld</h3><strong style="font-size:22px">${money(rows.length?total/rows.length:0)}</strong></div><div class="card kpi info"><h3>Duurste object</h3><strong style="font-size:16px">${esc(Object.entries(byObject).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—')}</strong></div></div><div class="grid dashboard-grid"><div class="card"><div class="section-title"><h3>Per maand</h3><button class="btn secondary small" id="exportCostsCsv">Export CSV</button></div><div class="bars">${month.map((v,i)=>`<div class="bar-row"><span>${new Date(2024,i,1).toLocaleDateString('nl-NL',{month:'short'})}</span><div class="bar-track"><div class="bar" style="width:${v/max*100}%"></div></div><strong>${money(v)}</strong></div>`).join('')}</div></div><div class="card"><h3>Per systeem</h3><div class="list">${Object.entries(bySystem).sort((a,b)=>b[1]-a[1]).map(([s,v])=>`<div class="list-item"><div style="display:flex;justify-content:space-between"><strong>${esc(s)}</strong><b>${money(v)}</b></div></div>`).join('')||'<div class="empty">Geen kosten.</div>'}</div></div></div><div class="card" style="margin-top:16px"><div class="section-title"><h3>Kosten per object</h3></div><div class="table-wrap"><table><thead><tr><th>Object</th><th>Werkbonnen</th><th>Kosten</th></tr></thead><tbody>${Object.entries(byObject).sort((a,b)=>b[1]-a[1]).map(([name,value])=>`<tr><td>${esc(name)}</td><td>${rows.filter(w=>(w.objectName||w.objectId)===name).length}</td><td>${money(value)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Geen kosten.</td></tr>'}</tbody></table></div></div>`;$('#costYear').onchange=renderCosts;$('#exportCostsCsv').onclick=()=>exportCsv(`vmms_kosten_${selected}.csv`,rows.map(w=>({datum:w.date,werkbon:w.id,object:w.objectName,systeem:w.system,werk:w.description,arbeid:w.laborCost,materiaal:w.materialCost,totaal:workOrderCost(w)})));
}

function renderDocuments(){
  $('#view-documents').innerHTML=`<div class="note">De fabrikant- en producthandleidingen staan nu in een apart overzicht. <button class="btn small" data-view="manuals">Open Handleidingen</button></div><div class="card"><div class="section-title"><h3>Documenten en certificaten</h3></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Categorie</th><th>Naam</th><th>Object</th><th>Vervaldatum</th><th>Link</th></tr></thead><tbody>${[...db.documents,...db.certificates.map(c=>({id:c.id,category:c.category,name:c.name,objectId:'',expiryDate:c.expiryDate,link:c.documentLink}))].map(d=>`<tr><td>${esc(d.id)}</td><td>${esc(d.category)}</td><td>${esc(d.name)}</td><td>${esc(objectById(d.objectId)?.name||'—')}</td><td>${dateNL(d.expiryDate)}</td><td>${d.link?`<a href="${esc(d.link)}" target="_blank">Openen</a>`:'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function getLocalBackups(){
  try{const raw=localStorage.getItem(LOCAL_BACKUPS_KEY);const list=raw?JSON.parse(raw):[];return Array.isArray(list)?list:[]}catch{return []}
}
function setLocalBackups(list){localStorage.setItem(LOCAL_BACKUPS_KEY,JSON.stringify((list||[]).slice(0,LOCAL_BACKUP_LIMIT)))}
function estimateDbSize(){try{return new Blob([JSON.stringify(db)]).size}catch{return 0}}
function workOrderPhotoCount(){return (db.workOrders||[]).reduce((sum,workOrder)=>sum+((workOrder.photos||[]).length||0),0)+(db.inspections||[]).reduce((sum,item)=>sum+((item.photos||[]).length||0),0)}
function getSystemSnapshot(){
  const lastSync=localStorage.getItem(DRIVE_LAST_SYNC_KEY)||'';
  const dirty=localStorage.getItem(DRIVE_DIRTY_KEY)==='1';
  return {
    version:VMMS_BUILD,
    online:navigator.onLine,
    driveConnected,
    dirty,
    lastSync,
    objectCount:db.objects?.length||0,
    maintenanceCount:db.maintenance?.length||0,
    workOrderCount:db.workOrders?.length||0,
    inspectionCount:db.inspections?.length||0,
    logCount:db.logbook?.length||0,
    archivePhotoCount:photoLibraryStats().drive,
    workPhotoCount:workOrderPhotoCount(),
    localSize:estimateDbSize(),
    weatherCached:!!localStorage.getItem(WEATHER_CACHE_KEY),
    backupCount:getLocalBackups().length,
    notifications:notificationsEnabled() && typeof Notification!=='undefined' ? Notification.permission : 'uit'
  };
}
function notificationsEnabled(){return localStorage.getItem(NOTIFY_PREF_KEY)==='1'}
function setNotificationsEnabled(enabled){localStorage.setItem(NOTIFY_PREF_KEY,enabled?'1':'0')}
async function requestVmmsNotifications(){
  if(typeof Notification==='undefined'){toast('Meldingen worden niet ondersteund op dit toestel.');return false}
  const permission=await Notification.requestPermission();
  if(permission==='granted'){setNotificationsEnabled(true);toast('Meldingen zijn ingeschakeld.');return true}
  setNotificationsEnabled(false);toast('Meldingen zijn niet toegestaan.');return false;
}
async function showVmmsNotification(title,options={}){
  if(typeof Notification==='undefined' || Notification.permission!=='granted' || !notificationsEnabled())return false;
  const payload={icon:'vmms-logo-192.png',badge:'vmms-logo-192.png',tag:'vmms-summary',renotify:false,...options};
  try{const reg=await navigator.serviceWorker?.ready;if(reg?.showNotification){await reg.showNotification(title,payload);return true}}catch(error){console.warn(error)}
  try{new Notification(title,payload);return true}catch(error){console.warn(error);return false}
}
async function sendTestNotification(){
  if(!notificationsEnabled() || Notification.permission!=='granted'){const ok=await requestVmmsNotifications();if(!ok)return}
  await showVmmsNotification('VMMS Variatie',{
    body:'Testmelding geslaagd. Je ontvangt voortaan een korte samenvatting bij openstaande aandachtspunten.',
    tag:'vmms-test'
  });
  toast('Testmelding verzonden.');
}
async function maybeSendDailyVmmsNotification(force=false){
  if(!notificationsEnabled() || typeof Notification==='undefined' || Notification.permission!=='granted')return;
  const today=todayISO();if(!force&&localStorage.getItem(LAST_SUMMARY_NOTIFY_KEY)===today)return;
  const {counts}=maintenanceStats();
  const expiring=(db.certificates||[]).filter(cert=>{const days=dayDiff(cert.expiryDate);return days!==null&&days>=0&&days<=30}).length;
  const staleMeters=(db.objects||[]).filter(object=>object.meterUnit&&(!object.lastMeterUpdate||Date.now()-Date.parse(object.lastMeterUpdate)>30*86400000)).length;
  let goodWeather=false;try{const cache=readWeatherCache();if(cache?.data){const profiles=cache.data.daily.time.map((_,index)=>weatherDayProfile(cache.data,index));goodWeather=profiles.slice(0,4).some(profile=>profile.scores.paint>=75||profile.scores.steel>=75)}}catch{}
  const openInspections=(db.inspections||[]).filter(item=>!['Afgerond','Gesloten'].includes(item.status)).length;
  const pieces=[];if(counts.Urgent)pieces.push(`${counts.Urgent} urgent`);if(counts.Achterstallig)pieces.push(`${counts.Achterstallig} achterstallig`);if(counts.Binnenkort)pieces.push(`${counts.Binnenkort} binnenkort`);if(expiring)pieces.push(`${expiring} certificaten`);if(staleMeters)pieces.push(`${staleMeters} tellers oud`);if(openInspections)pieces.push(`${openInspections} inspecties open`);if(goodWeather)pieces.push('goed klusweer verwacht');
  if(!pieces.length&&!force)return;
  const sent=await showVmmsNotification('VMMS aandachtspunten',{body:pieces.join(' · ')||'Geen urgente aandachtspunten.',tag:'vmms-daily'});if(sent)localStorage.setItem(LAST_SUMMARY_NOTIFY_KEY,today);
}
function createLocalRestorePoint(label='Handmatige back-up'){
  const copy=structuredClone(db);
  (copy.workOrders||[]).forEach(workOrder=>(workOrder.photos||[]).forEach(photo=>{if(photo.thumbnail && photo.thumbnail.length>120000)delete photo.thumbnail;}));
  const backups=getLocalBackups();
  backups.unshift({id:uid('BKP'),createdAt:new Date().toISOString(),label,data:copy,summary:{workOrders:copy.workOrders?.length||0,objects:copy.objects?.length||0,maintenance:copy.maintenance?.length||0}});
  setLocalBackups(backups);
  return backups[0];
}
function restoreLocalBackupById(id){
  const backup=getLocalBackups().find(item=>item.id===id);
  if(!backup){toast('Herstelpunt niet gevonden.');return}
  if(!confirm('Deze back-up terugzetten als actieve VMMS-database?'))return;
  db=backup.data;saveData();renderSettings();toast('Back-up teruggezet.');
}
function deleteLocalBackupById(id){
  const backups=getLocalBackups().filter(item=>item.id!==id);setLocalBackups(backups);renderSettings();toast('Herstelpunt verwijderd.');
}
function localBackupsHtml(){
  const backups=getLocalBackups();
  return backups.length?backups.map(item=>`<div class="list-item backup-item"><div><strong>${esc(item.label||'Herstelpunt')}</strong><br><small>${new Date(item.createdAt).toLocaleString('nl-NL')} · ${item.summary?.workOrders||0} werkbonnen · ${item.summary?.maintenance||0} taken</small></div><div class="row-actions"><button class="btn secondary small restore-local-backup" data-id="${esc(item.id)}">Terugzetten</button><button class="btn secondary small export-local-backup" data-id="${esc(item.id)}">Download</button><button class="btn danger small delete-local-backup" data-id="${esc(item.id)}">Verwijderen</button></div></div>`).join(''):'<div class="empty">Nog geen lokale herstelpunten gemaakt.</div>';
}
function systemCheckHtml(){
  const snap=getSystemSnapshot();
  const status=(ok,label)=>`<span class="status ${ok?'goed':'nog-invullen'}">${esc(label)}</span>`;
  const lastSyncText=snap.lastSync?new Date(snap.lastSync).toLocaleString('nl-NL'):'Nog niet gesynchroniseerd';
  return `
    <div class="system-grid">
      <div class="system-item"><span>Appversie</span><strong>${esc(snap.version)}</strong></div>
      <div class="system-item"><span>Lokale database</span><strong>${esc(formatFileSize(snap.localSize))}</strong></div>
      <div class="system-item"><span>Werkbonfoto's</span><strong>${snap.workPhotoCount}</strong></div>
      <div class="system-item"><span>Fotoarchief</span><strong>${snap.archivePhotoCount}</strong></div>
    </div>
    <div class="system-status-row">
      ${status(snap.online,'Internet '+(snap.online?'verbonden':'offline'))}
      ${status(snap.driveConnected,'Drive '+(snap.driveConnected?'verbonden':'uit'))}
      ${status(!snap.dirty,'Sync '+(!snap.dirty?'bij':'wijzigingen open'))}
      ${status(snap.weatherCached,'Weerdata cache '+(snap.weatherCached?'gevuld':'leeg'))}
    </div>
    <div class="list compact-list" style="margin-top:12px">
      <div class="list-item"><strong>Laatste Drive-synchronisatie</strong><small>${esc(lastSyncText)}</small></div>
      <div class="list-item"><strong>Data-overzicht</strong><small>${snap.objectCount} objecten · ${snap.maintenanceCount} onderhoudstaken · ${snap.workOrderCount} werkbonnen · ${snap.inspectionCount} inspecties</small></div>
      <div class="list-item"><strong>Herstelpunten</strong><small>${snap.backupCount} lokale herstelpunten beschikbaar</small></div>
      <div class="list-item"><strong>Meldingen</strong><small>${esc(String(snap.notifications))}</small></div>
    </div>`;
}



async function listDriveBackups(){
  if(!driveAccessToken)throw new Error('Verbind eerst met Google Drive.');
  const q=encodeURIComponent("name contains 'VMMS_Backup_' and trashed=false");
  const response=await driveFetch(DRIVE_API+`/files?spaces=appDataFolder&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime,size,appProperties)&q=${q}`);const data=await response.json();return data.files||[];
}
async function openDriveBackupManager(){
  if(!driveConnected){toast('Verbind eerst met Google Drive.');return}
  openDialog('Drive-back-ups','<div class="empty">Back-ups laden…</div>');
  try{const files=await listDriveBackups();$('#dialogBody').innerHTML=`<div class="note">Dagelijkse back-ups worden 14 dagen bewaard. Bij terugzetten wordt eerst automatisch een lokaal herstelpunt gemaakt.</div><div class="list">${files.map(file=>`<div class="list-item"><strong>${esc(file.name)}</strong><small>${new Date(file.modifiedTime).toLocaleString('nl-NL')} · ${formatFileSize(file.size)}</small><button class="btn secondary restore-drive-backup" data-id="${esc(file.id)}">Deze back-up terugzetten</button></div>`).join('')||'<div class="empty">Geen Drive-back-ups gevonden.</div>'}</div><div class="form-actions"><button class="btn secondary" id="closeDriveBackups">Sluiten</button></div>`;$$('.restore-drive-backup').forEach(button=>button.onclick=()=>restoreDriveBackup(button.dataset.id));$('#closeDriveBackups').onclick=closeDialog}catch(error){$('#dialogBody').innerHTML=`<div class="empty">${esc(error.message)}</div>`}
}
async function restoreDriveBackup(fileId){
  if(!confirm('Deze dagelijkse Drive-back-up terugzetten?'))return;
  try{const response=await driveFetch(DRIVE_API+'/files/'+encodeURIComponent(fileId)+'?alt=media');const backup=await response.json();if(!backup?.objects||!backup?.maintenance)throw new Error('Ongeldige back-up.');createLocalRestorePoint('Automatisch herstelpunt vóór Drive-herstel');migrateVariatieListingData(backup);migrateManualMaintenanceData(backup);ensureVmms3Data(backup);ensureRestorationPlanData(backup);ensurePaintAndSourcingData(backup);ensureBallastToolData(backup);ensureMaydayMaintenanceData(backup);ensureInspirationData(backup);db=backup;saveData();closeDialog();renderSettings();toast('Drive-back-up teruggezet en klaar om te synchroniseren')}catch(error){toast(error.message||'Drive-back-up herstellen mislukt')}
}
async function clearVmmsCaches(){
  if(!confirm('De app-cache vernieuwen? Je VMMS-data blijft behouden en de pagina wordt opnieuw geladen.'))return;
  try{for(const key of await caches.keys())await caches.delete(key);const registrations=await navigator.serviceWorker?.getRegistrations?.()||[];for(const registration of registrations)await registration.update();location.replace(location.pathname+'?fresh='+Date.now())}catch(error){toast('Cache vernieuwen mislukt: '+error.message)}
}



/* VMMS 3.8 – Ballastplanner */
function defaultBallastStations(length=27.4,beam=5.12){
  const fractions=[0,.125,.25,.375,.5,.625,.75,.875,1];
  const widths=[.12,.62,.90,.98,1,.98,.90,.62,.12];
  return fractions.map((fraction,index)=>({id:uid('BST'),x:Number((length*fraction).toFixed(2)),width:Number((beam*widths[index]).toFixed(2))}));
}
function defaultBallastZones(length=27.4){
  const rows=[
    ['Achterpiek',.5,.16,'Midden'],
    ['Midden achter',.22,.42,'Midden'],
    ['Midden voor',.58,.78,'Midden'],
    ['Voorpiek',.84,.98,'Midden']
  ];
  return rows.map(([name,a,b,side])=>({
    id:uid('BLZ'),name,start:Number((length*a).toFixed(2)),end:Number((length*b).toFixed(2)),side,
    bottomWidth:0,topWidth:0,height:0,shape:'round',usable:85,density:2.40,currentMass:0,z:0.20,lateralOffset:0,enabled:true,note:''
  }));
}
function defaultBallastProfile(){
  const length=Number(db?.ship?.length||27.4)||27.4, beam=Number(db?.ship?.beam||5.12)||5.12;
  return {
    id:uid('BLS'),name:(db?.ship?.name||'Variatie')+' – voorlopig',length,beam,
    waterDensity:1.000,blockCoefficient:.70,currentDraftFore:1.00,currentDraftAft:1.00,targetDraftFore:1.00,targetDraftAft:1.00,
    gm:'',listDifferenceCm:0,targetListDifferenceCm:0,stations:defaultBallastStations(length,beam),zones:defaultBallastZones(length),
    notes:'Voorbeeldprofiel. Vervang waterlijnbreedtes, diepgangen en ballastzone-afmetingen door gemeten of berekende waarden.',createdAt:new Date().toISOString()
  };
}
function ensureBallastToolData(data){
  if(!data)return false;let changed=false;data.settings=data.settings||{};data._meta=data._meta||{};
  if(!Array.isArray(data.ballastProfiles)||!data.ballastProfiles.length){data.ballastProfiles=[defaultBallastProfile()];changed=true}
  data.ballastProfiles.forEach(profile=>{
    profile.length=num(profile.length)||27.4;profile.beam=num(profile.beam)||5.12;
    if(!Array.isArray(profile.stations)||profile.stations.length<2)profile.stations=defaultBallastStations(profile.length,profile.beam);
    if(!Array.isArray(profile.zones))profile.zones=[];
    profile.zones.forEach(zone=>{if(zone.enabled===undefined)zone.enabled=true;if(!zone.shape)zone.shape='round';if(zone.usable===undefined)zone.usable=85;if(zone.density===undefined)zone.density=2.4;if(zone.z===undefined)zone.z=.2;if(zone.side===undefined)zone.side='Midden'});
  });
  if(!data.settings.activeBallastProfileId||!data.ballastProfiles.some(profile=>profile.id===data.settings.activeBallastProfileId)){data.settings.activeBallastProfileId=data.ballastProfiles[0].id;changed=true}
  if(Number(data._meta.ballastToolMigration||0)<1){data._meta.ballastToolMigration=1;changed=true}
  return changed;
}
function activeBallastProfile(){ensureBallastToolData(db);return db.ballastProfiles.find(profile=>profile.id===db.settings.activeBallastProfileId)||db.ballastProfiles[0]}
function ballastShapeFactor(shape){return ({round:.72,chine:.86,flat:1}[shape]||.72)}
function ballastShapeLabel(shape){return ({round:'Ronde kim / komvorm',chine:'Knikspant',flat:'Vlak / rechthoekig'}[shape]||'Ronde kim / komvorm')}
function ballastZoneCapacity(zone){
  const length=Math.max(0,num(zone.end)-num(zone.start));
  const averageWidth=Math.max(0,(num(zone.bottomWidth)+num(zone.topWidth))/2);
  const volume=length*averageWidth*Math.max(0,num(zone.height))*ballastShapeFactor(zone.shape)*(Math.max(0,Math.min(100,num(zone.usable)))/100);
  return {length,volume,mass:volume*Math.max(0,num(zone.density))};
}
function ballastZoneX(zone){return (num(zone.start)+num(zone.end))/2}
function ballastZoneY(zone,profile){
  const manual=Math.abs(num(zone.lateralOffset));if(manual)return zone.side==='Bakboord'?-manual:(zone.side==='Stuurboord'?manual:0);
  const offset=num(profile.beam)*.32;return zone.side==='Bakboord'?-offset:(zone.side==='Stuurboord'?offset:0)
}
function ballastHydrostatics(profile){
  const length=Math.max(.1,num(profile.length)),beam=Math.max(.1,num(profile.beam));
  const draft=(num(profile.currentDraftFore)+num(profile.currentDraftAft))/2;
  const rho=Math.max(.9,num(profile.waterDensity)||1),cb=Math.max(.2,Math.min(.98,num(profile.blockCoefficient)||.7));
  const stations=[...(profile.stations||[])].map(row=>({x:Math.max(0,Math.min(length,num(row.x))),width:Math.max(0,num(row.width))})).sort((a,b)=>a.x-b.x);
  let area=0,moment=0,second=0,transverseI=0;
  for(let i=0;i<stations.length-1;i++){
    const a=stations[i],b=stations[i+1],dx=b.x-a.x;if(dx<=0)continue;
    area+=(a.width+b.width)*.5*dx;
    moment+=(a.x*a.width+b.x*b.width)*.5*dx;
    second+=(a.x*a.x*a.width+b.x*b.x*b.width)*.5*dx;
    transverseI+=((Math.pow(a.width,3)+Math.pow(b.width,3))/24)*dx;
  }
  if(area<=0){area=length*beam*.82;moment=area*length/2;second=area*(length*length/3);transverseI=length*Math.pow(beam,3)/12*.75}
  const lcf=moment/area, longitudinalI=Math.max(0,second-area*lcf*lcf);
  const volume=Math.max(.01,length*beam*Math.max(.05,draft)*cb),displacement=volume*rho;
  const tpc=rho*area/100;
  const mct=rho*longitudinalI/(100*length);
  const bmt=transverseI/volume;
  const kb=Math.max(.01,draft*(.50+Math.max(0,Math.min(.08,(.75-cb)*.18))));
  const km=kb+bmt;
  return {length,beam,draft,rho,cb,area,lcf,longitudinalI,volume,displacement,tpc,mct,bmt,kb,km,cwp:area/(length*beam)};
}
function solveTwoZoneAllocation(totalMass,targetX,zones,capacityField='available'){
  if(totalMass<=0||!zones.length)return null;
  let best=null;
  for(let i=0;i<zones.length;i++){
    const a=zones[i],xa=a.x,ca=Math.max(0,a[capacityField]);
    if(ca>=totalMass){const score=Math.abs(xa-targetX)*100+num(a.zone.z);if(!best||score<best.score)best={score,items:[{...a,mass:totalMass}],residualX:xa-targetX}}
    for(let j=i+1;j<zones.length;j++){
      const b=zones[j],xb=b.x,cb=Math.max(0,b[capacityField]);if(Math.abs(xb-xa)<.001)continue;
      const wb=totalMass*(targetX-xa)/(xb-xa),wa=totalMass-wb;
      if(wa>=-.0001&&wb>=-.0001&&wa<=ca+.0001&&wb<=cb+.0001){
        const score=(Math.max(0,wa)*num(a.zone.z)+Math.max(0,wb)*num(b.zone.z))/totalMass+Math.abs(xa-targetX)+Math.abs(xb-targetX);
        if(!best||score<best.score)best={score,items:[{...a,mass:Math.max(0,wa)},{...b,mass:Math.max(0,wb)}],residualX:0};
      }
    }
  }
  if(best)return best;
  const sorted=[...zones].sort((a,b)=>Math.abs(a.x-targetX)-Math.abs(b.x-targetX));let remaining=totalMass,items=[];
  for(const row of sorted){const mass=Math.min(remaining,Math.max(0,row[capacityField]));if(mass>0){items.push({...row,mass});remaining-=mass}if(remaining<=.001)break}
  if(!items.length)return null;
  const actualX=items.reduce((sum,row)=>sum+row.mass*row.x,0)/items.reduce((sum,row)=>sum+row.mass,0);
  return {score:999,items,remaining,residualX:actualX-targetX};
}
function ballastRecommendation(profile,hydro){
  const currentMean=(num(profile.currentDraftFore)+num(profile.currentDraftAft))/2,targetMean=(num(profile.targetDraftFore)+num(profile.targetDraftAft))/2;
  const currentTrim=num(profile.currentDraftFore)-num(profile.currentDraftAft),targetTrim=num(profile.targetDraftFore)-num(profile.targetDraftAft);
  const totalMass=hydro.tpc*(targetMean-currentMean)*100;
  const trimMoment=hydro.mct*(targetTrim-currentTrim)*100;
  const zones=(profile.zones||[]).filter(zone=>zone.enabled).map(zone=>{const cap=ballastZoneCapacity(zone);return {zone,x:ballastZoneX(zone),y:ballastZoneY(zone,profile),capacity:cap.mass,current:Math.max(0,num(zone.currentMass)),available:Math.max(0,cap.mass-Math.max(0,num(zone.currentMass))),cap}}).filter(row=>row.capacity>0||row.current>0);
  let mode='Geen wijziging',allocation=null,targetX=hydro.lcf,warning='';
  if(totalMass>.02){
    mode='Ballast toevoegen';targetX=hydro.lcf+trimMoment/totalMass;allocation=solveTwoZoneAllocation(totalMass,targetX,zones,'available');
    if(targetX<0||targetX>hydro.length)warning='De gevraagde combinatie van inzinking en trim vraagt om een virtueel aangrijpingspunt buiten het schip. Controleer de doel-diepgangen.';
  }else if(totalMass<-.02){
    mode='Ballast verwijderen';const amount=Math.abs(totalMass);targetX=hydro.lcf+trimMoment/totalMass;allocation=solveTwoZoneAllocation(amount,targetX,zones.map(row=>({...row,available:row.current})),'available');
    if(allocation)allocation.items.forEach(item=>item.mass=-item.mass);
    if(!zones.some(row=>row.current>0))warning='Vul per ballastzone de huidige massa in om een verwijderadvies te kunnen maken.';
  }else if(Math.abs(trimMoment)>.02){
    mode='Bestaande ballast verplaatsen';
    let best=null;
    for(const source of zones.filter(row=>row.current>0))for(const destination of zones.filter(row=>row.available>0&&row.zone.id!==source.zone.id)){
      const dx=destination.x-source.x;if(Math.abs(dx)<.01||Math.sign(dx)!==Math.sign(trimMoment))continue;
      const mass=Math.abs(trimMoment/dx);if(mass<=source.current+.001&&mass<=destination.available+.001&&(!best||mass<best.mass))best={source,destination,mass};
    }
    if(best)allocation={items:[{...best.source,mass:-best.mass},{...best.destination,mass:best.mass}],residualX:0};
    else warning='Voor alleen trimcorrectie zijn huidige ballastmassa’s en vrije capaciteit op twee verschillende lengtes nodig.';
  }
  const totalRecommended=allocation?.items?.reduce((sum,row)=>sum+row.mass,0)||0;
  const momentRecommended=allocation?.items?.reduce((sum,row)=>sum+row.mass*(row.x-hydro.lcf),0)||0;
  let newGM='';const gm=num(profile.gm);
  if(gm>0&&totalMass>0&&allocation?.items?.length){
    const currentKG=hydro.km-gm,newDisplacement=hydro.displacement+totalMass;
    const addedVertical=allocation.items.filter(row=>row.mass>0).reduce((sum,row)=>sum+row.mass*num(row.zone.z),0);
    const newKG=(hydro.displacement*currentKG+addedVertical)/newDisplacement;newGM=hydro.km-newKG;
  }
  return {currentMean,targetMean,currentTrim,targetTrim,totalMass,trimMoment,targetX,zones,mode,allocation,warning,totalRecommended,momentRecommended,newGM};
}
function ballastHeelRecommendation(profile,hydro,recommendation){
  const gm=num(profile.gm),difference=num(profile.listDifferenceCm)-num(profile.targetListDifferenceCm);
  if(!gm||Math.abs(difference)<.05)return null;
  const moment=hydro.displacement*gm*((difference/100)/Math.max(.1,hydro.beam));
  const desiredSide=difference>0?'Bakboord':'Stuurboord';
  const candidates=recommendation.zones.filter(row=>row.zone.side===desiredSide&&row.available>0&&Math.abs(row.y)>.05).sort((a,b)=>Math.abs(b.y)-Math.abs(a.y));
  const zone=candidates[0];if(!zone)return {moment,desiredSide,mass:null,warning:`Maak een vrije ballastzone aan aan ${desiredSide.toLowerCase()} met een laterale afstand.`};
  const mass=Math.abs(moment/zone.y);return {moment,desiredSide,mass,zone,warning:mass>zone.available?'De gekozen zijzone heeft onvoldoende berekende vrije capaciteit.':''};
}
function ballastFmt(value,digits=2){return Number.isFinite(Number(value))?Number(value).toLocaleString('nl-NL',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—'}
function ballastProfileOptions(activeId){return (db.ballastProfiles||[]).map(profile=>`<option value="${esc(profile.id)}" ${profile.id===activeId?'selected':''}>${esc(profile.name)}</option>`).join('')}
function ballastTopViewSvg(profile,recommendation){
  const length=Math.max(.1,num(profile.length)),beam=Math.max(.1,num(profile.beam)),stations=[...(profile.stations||[])].sort((a,b)=>num(a.x)-num(b.x));
  const xpx=x=>50+(num(x)/length)*800, ypx=(width,sign)=>180+sign*(Math.max(0,num(width))/beam)*135;
  const top=stations.map(row=>`${xpx(row.x)},${ypx(row.width,-1)}`).join(' '),bottom=[...stations].reverse().map(row=>`${xpx(row.x)},${ypx(row.width,1)}`).join(' ');
  const zoneRects=(profile.zones||[]).map(zone=>{const x=xpx(zone.start),w=Math.max(3,xpx(zone.end)-x),side=zone.side||'Midden';let y=145,h=70;if(side==='Bakboord'){y=76;h=64}else if(side==='Stuurboord'){y=220;h=64}const cap=ballastZoneCapacity(zone);return `<g class="ballast-zone-svg" data-ballast-zone="${esc(zone.id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7"></rect><title>${esc(zone.name)} · max ${ballastFmt(cap.mass)} t</title></g>`}).join('');
  const markers=(recommendation.allocation?.items||[]).map(row=>{const x=xpx(row.x),side=row.zone.side||'Midden',y=side==='Bakboord'?105:(side==='Stuurboord'?255:180),label=(row.mass>=0?'+':'')+ballastFmt(row.mass)+' t';return `<g class="ballast-recommendation-marker"><circle cx="${x}" cy="${y}" r="18"></circle><text x="${x}" y="${y+4}" text-anchor="middle">${esc(label)}</text></g>`}).join('');
  return `<svg class="ballast-topview" viewBox="0 0 900 360" role="img" aria-label="Bovenaanzicht met ballastzones"><polygon points="${top} ${bottom}" class="ballast-waterline"></polygon><line x1="50" y1="180" x2="850" y2="180" class="ballast-centerline"></line>${zoneRects}${markers}<text x="50" y="335">Achter</text><text x="850" y="335" text-anchor="end">Voor</text><text x="450" y="24" text-anchor="middle">Bakboord</text><text x="450" y="350" text-anchor="middle">Stuurboord</text></svg>`;
}
function ballastCrossSectionSvg(zone){
  const shape=zone.shape||'round';let path='M30 25 L30 155 L270 155 L270 25';
  if(shape==='round')path='M30 25 C38 115 88 155 150 155 C212 155 262 115 270 25';
  if(shape==='chine')path='M30 25 L65 125 L105 155 L195 155 L235 125 L270 25';
  const h=Math.max(10,Math.min(105,num(zone.height)*70||35));
  return `<svg viewBox="0 0 300 180" class="ballast-cross-section"><path d="${path}" class="ballast-section-hull"></path><path d="M45 ${155-h} L255 ${155-h} L255 155 L45 155 Z" class="ballast-section-fill"></path><text x="150" y="173" text-anchor="middle">${esc(ballastShapeLabel(shape))}</text></svg>`;
}
function ballastAllocationHtml(profile,hydro,recommendation){
  if(!recommendation.allocation?.items?.length)return `<div class="empty">Nog geen uitvoerbaar plaatsingsadvies. Vul ballastzones met maten en capaciteit in.</div>`;
  return `<div class="table-wrap"><table class="ballast-result-table"><thead><tr><th>Actie</th><th>Zone</th><th>Positie vanaf achter</th><th>Massa</th><th>Hoogte</th><th>Capaciteit</th></tr></thead><tbody>${recommendation.allocation.items.map(row=>`<tr><td>${row.mass>=0?'Toevoegen':'Verwijderen'}</td><td>${esc(row.zone.name)}</td><td>${ballastFmt(row.x)} m</td><td><b>${row.mass>=0?'+':''}${ballastFmt(row.mass)} t</b></td><td>${ballastFmt(row.zone.z)} m boven kiel</td><td>${ballastFmt(row.capacity)} t</td></tr>`).join('')}</tbody></table></div>`;
}
function renderBallastTool(){
  ensureBallastToolData(db);const profile=activeBallastProfile(),hydro=ballastHydrostatics(profile),recommendation=ballastRecommendation(profile,hydro),heel=ballastHeelRecommendation(profile,hydro,recommendation);
  const capacityTotal=(profile.zones||[]).reduce((sum,zone)=>sum+ballastZoneCapacity(zone).mass,0);
  $('#view-ballast').innerHTML=`
    <div class="card ballast-hero"><div><span class="meter-label">VMMS Ballastplanner</span><h3>Ballast verdelen op lengte, breedte en hoogte</h3><p>Voor snelle planning én een gedetailleerder model met gemeten waterlijnbreedtes en afgeronde ballastvakken. De berekening is een technische schatting en geen goedgekeurde stabiliteitsberekening.</p></div><div class="ballast-hero-actions"><button class="btn secondary" id="ballastReport">Rapport</button><button class="btn" id="ballastCalculate">Opnieuw berekenen</button></div></div>
    <div class="note ballast-safety"><b>Veiligheidsgrens:</b> gebruik het resultaat voor ontwerp en voorbereiding. Controleer werkelijke diepgangen, vrije boord, constructiesterkte, bevestiging van vaste ballast en stabiliteit met een scheepsbouwkundig deskundige vóór plaatsing of verplaatsing.</div>
    <div class="card ballast-profile-card">
      <div class="section-title"><div><h3>Scheepsprofiel</h3><small>Bewaar meerdere schepen in dezelfde app.</small></div><div class="section-actions"><button class="btn secondary" id="newBallastProfile">Nieuw schip</button><button class="btn secondary" id="duplicateBallastProfile">Dupliceren</button><button class="btn danger" id="deleteBallastProfile">Verwijderen</button></div></div>
      <label>Actief schip<select id="ballastProfileSelect">${ballastProfileOptions(profile.id)}</select></label>
    </div>
    <div class="grid dashboard-grid ballast-input-grid">
      <div class="card"><div class="section-title"><h3>Scheeps- en diepgangsgegevens</h3></div><form id="ballastShipForm" class="form-grid">
        <label class="span-2">Naam<input name="name" value="${esc(profile.name)}"></label>
        <label>Lengte waterlijn LWL (m)<input type="number" step="0.01" name="length" value="${esc(profile.length)}"></label>
        <label>Grootste breedte (m)<input type="number" step="0.01" name="beam" value="${esc(profile.beam)}"></label>
        <label>Blokcoëfficiënt Cb<input type="number" min="0.2" max="0.98" step="0.01" name="blockCoefficient" value="${esc(profile.blockCoefficient)}"></label>
        <label>Water<select name="waterDensity"><option value="1" ${num(profile.waterDensity)===1?'selected':''}>Zoet water · 1,000 t/m³</option><option value="1.025" ${num(profile.waterDensity)===1.025?'selected':''}>Zout water · 1,025 t/m³</option></select></label>
        <label>Huidige diepgang voor (m)<input type="number" step="0.001" name="currentDraftFore" value="${esc(profile.currentDraftFore)}"></label>
        <label>Huidige diepgang achter (m)<input type="number" step="0.001" name="currentDraftAft" value="${esc(profile.currentDraftAft)}"></label>
        <label>Gewenste diepgang voor (m)<input type="number" step="0.001" name="targetDraftFore" value="${esc(profile.targetDraftFore)}"></label>
        <label>Gewenste diepgang achter (m)<input type="number" step="0.001" name="targetDraftAft" value="${esc(profile.targetDraftAft)}"></label>
        <label>Gemeten/gekende GM (m, optioneel)<input type="number" step="0.01" name="gm" value="${esc(profile.gm)}" placeholder="Nodig voor zijwaartse correctie"></label>
        <label>Stuurboord minus bakboord diepgang (cm)<input type="number" step="0.1" name="listDifferenceCm" value="${esc(profile.listDifferenceCm||0)}"></label>
        <label>Gewenst verschil zijden (cm)<input type="number" step="0.1" name="targetListDifferenceCm" value="${esc(profile.targetListDifferenceCm||0)}"></label>
        <label class="span-2">Notities<textarea name="notes">${esc(profile.notes||'')}</textarea></label>
        <div class="span-2 form-actions"><button class="btn">Gegevens opslaan en berekenen</button></div>
      </form></div>
      <div class="card ballast-hydro-card"><div class="section-title"><h3>Hydrostatische schatting</h3></div><div class="system-grid">
        <div class="system-item"><span>Waterverplaatsing</span><strong>${ballastFmt(hydro.displacement)} t</strong></div>
        <div class="system-item"><span>Waterlijnoppervlak</span><strong>${ballastFmt(hydro.area)} m²</strong></div>
        <div class="system-item"><span>Tonnen per cm</span><strong>${ballastFmt(hydro.tpc,3)} t/cm</strong></div>
        <div class="system-item"><span>MCT 1 cm</span><strong>${ballastFmt(hydro.mct)} tm/cm</strong></div>
        <div class="system-item"><span>LCF vanaf achter</span><strong>${ballastFmt(hydro.lcf)} m</strong></div>
        <div class="system-item"><span>Berekende Cwp</span><strong>${ballastFmt(hydro.cwp,3)}</strong></div>
        <div class="system-item"><span>KMt indicatie</span><strong>${ballastFmt(hydro.km)} m</strong></div>
        <div class="system-item"><span>Zonecapaciteit</span><strong>${ballastFmt(capacityTotal)} t</strong></div>
      </div><p class="drive-help">De waterlijnvorm wordt geïntegreerd uit de stations hieronder. De waterverplaatsing blijft een benadering met LWL × B × gemiddelde diepgang × Cb.</p></div>
    </div>
    <div class="card ballast-stations-card"><div class="section-title"><div><h3>Waterlijnstations</h3><small>Positie gemeten vanaf het achterste punt van de waterlijn. Hiermee wordt de ronding en versmalling over de scheepslengte meegenomen.</small></div><div class="section-actions"><button class="btn secondary" id="generateBallastStations">Voorbeeldvorm opnieuw maken</button><button class="btn secondary" id="addBallastStation">Station toevoegen</button></div></div>
      <div class="table-wrap"><table class="ballast-station-table"><thead><tr><th>Positie x (m)</th><th>Totale breedte waterlijn (m)</th><th></th></tr></thead><tbody>${[...(profile.stations||[])].sort((a,b)=>num(a.x)-num(b.x)).map(row=>`<tr><td><input type="number" step="0.01" data-station-id="${esc(row.id)}" data-station-field="x" value="${esc(row.x)}"></td><td><input type="number" step="0.01" data-station-id="${esc(row.id)}" data-station-field="width" value="${esc(row.width)}"></td><td><button class="btn danger small delete-ballast-station" data-id="${esc(row.id)}">Verwijderen</button></td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card ballast-zones-card"><div class="section-title"><div><h3>Ballastzones en ronding</h3><small>Vul per vak de lengte, breedte onder/boven, hoogte en rompvorm in. De vormfactor verlaagt het theoretische rechthoekige volume.</small></div><button class="btn" id="addBallastZone">Ballastzone toevoegen</button></div>
      <div class="ballast-zone-list">${(profile.zones||[]).map(zone=>{const cap=ballastZoneCapacity(zone);return `<details class="ballast-zone-card"><summary><div><b>${esc(zone.name)}</b><small>${ballastFmt(zone.start)}–${ballastFmt(zone.end)} m · ${esc(zone.side)}</small></div><div><strong>${ballastFmt(cap.mass)} t</strong><small>max. berekend</small></div></summary><div class="ballast-zone-body"><div class="ballast-zone-fields form-grid">
        <label>Naam<input data-zone-id="${esc(zone.id)}" data-zone-field="name" value="${esc(zone.name)}"></label>
        <label>Zijde<select data-zone-id="${esc(zone.id)}" data-zone-field="side"><option ${zone.side==='Midden'?'selected':''}>Midden</option><option ${zone.side==='Bakboord'?'selected':''}>Bakboord</option><option ${zone.side==='Stuurboord'?'selected':''}>Stuurboord</option></select></label>
        <label>Begin vanaf achter (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="start" value="${esc(zone.start)}"></label>
        <label>Einde vanaf achter (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="end" value="${esc(zone.end)}"></label>
        <label>Breedte onder (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="bottomWidth" value="${esc(zone.bottomWidth)}"></label>
        <label>Breedte bovenzijde ballast (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="topWidth" value="${esc(zone.topWidth)}"></label>
        <label>Maximale hoogte (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="height" value="${esc(zone.height)}"></label>
        <label>Rompvorm<select data-zone-id="${esc(zone.id)}" data-zone-field="shape"><option value="round" ${zone.shape==='round'?'selected':''}>Ronde kim / komvorm · 72%</option><option value="chine" ${zone.shape==='chine'?'selected':''}>Knikspant · 86%</option><option value="flat" ${zone.shape==='flat'?'selected':''}>Vlak / rechthoekig · 100%</option></select></label>
        <label>Bruikbaar volume (%)<input type="number" min="0" max="100" step="1" data-zone-id="${esc(zone.id)}" data-zone-field="usable" value="${esc(zone.usable)}"></label>
        <label>Dichtheid ballast (t/m³)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="density" value="${esc(zone.density)}"></label>
        <label>Huidige ballastmassa (t)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="currentMass" value="${esc(zone.currentMass)}"></label>
        <label>Hoogte zwaartepunt boven kiel (m)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="z" value="${esc(zone.z)}"></label>
        <label>Laterale afstand hartlijn (m, optioneel)<input type="number" step="0.01" data-zone-id="${esc(zone.id)}" data-zone-field="lateralOffset" value="${esc(zone.lateralOffset||0)}"></label>
        <label class="toggle-label"><input type="checkbox" data-zone-id="${esc(zone.id)}" data-zone-field="enabled" ${zone.enabled?'checked':''}> Beschikbaar voor advies</label>
        <label class="span-2">Notitie<textarea data-zone-id="${esc(zone.id)}" data-zone-field="note">${esc(zone.note||'')}</textarea></label>
      </div><div class="ballast-zone-preview">${ballastCrossSectionSvg(zone)}<div><b>Berekende inhoud: ${ballastFmt(cap.volume)} m³</b><p>Maximaal ${ballastFmt(cap.mass)} ton bij de gekozen dichtheid en bruikbare fractie.</p></div></div><div class="form-actions"><button class="btn danger delete-ballast-zone" data-id="${esc(zone.id)}">Zone verwijderen</button></div></div></details>`}).join('')||'<div class="empty">Voeg minimaal één ballastzone toe.</div>'}</div>
    </div>
    <div class="card ballast-result-card"><div class="section-title"><div><h3>Advies: ${esc(recommendation.mode)}</h3><small>Doel: ${ballastFmt(recommendation.targetMean,3)} m gemiddelde diepgang · trim voor minus achter ${ballastFmt(recommendation.targetTrim*100,1)} cm</small></div><span class="status ${recommendation.allocation?.items?.length?'goed':'binnenkort'}">${recommendation.allocation?.items?.length?'Berekening beschikbaar':'Meer invoer nodig'}</span></div>
      <div class="system-grid ballast-result-kpis"><div class="system-item"><span>Totale massawijziging</span><strong>${recommendation.totalMass>=0?'+':''}${ballastFmt(recommendation.totalMass)} t</strong></div><div class="system-item"><span>Benodigd trimmoment</span><strong>${recommendation.trimMoment>=0?'+':''}${ballastFmt(recommendation.trimMoment)} tm</strong></div><div class="system-item"><span>Gewenst aangrijpingspunt</span><strong>${ballastFmt(recommendation.targetX)} m</strong></div><div class="system-item"><span>GM na toevoeging</span><strong>${recommendation.newGM!==''?ballastFmt(recommendation.newGM)+' m':'Niet berekend'}</strong></div></div>
      ${recommendation.warning?`<div class="note">${esc(recommendation.warning)}</div>`:''}
      ${ballastAllocationHtml(profile,hydro,recommendation)}
      <div class="ballast-visual-wrap">${ballastTopViewSvg(profile,recommendation)}</div>
      ${heel?`<div class="ballast-heel-card"><h3>Zijwaartse correctie</h3>${heel.mass!=null?`<p>Bij een ingevoerde GM van <b>${ballastFmt(profile.gm)} m</b> is indicatief <b>${ballastFmt(heel.mass)} t</b> aan <b>${esc(heel.desiredSide.toLowerCase())}</b> nodig in zone <b>${esc(heel.zone.zone.name)}</b>.</p>`:`<p>${esc(heel.warning)}</p>`}${heel.warning&&heel.mass!=null?`<div class="note">${esc(heel.warning)}</div>`:''}<small>Deze zijwaartse berekening wordt apart getoond en is niet automatisch samengevoegd met het lengteadvies.</small></div>`:''}
    </div>`;
  bindBallastEvents(profile);
}
function bindBallastEvents(profile){
  $('#ballastProfileSelect').onchange=e=>{db.settings.activeBallastProfileId=e.target.value;saveData();renderBallastTool()};
  $('#ballastShipForm').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget).entries());['length','beam','waterDensity','blockCoefficient','currentDraftFore','currentDraftAft','targetDraftFore','targetDraftAft','gm','listDifferenceCm','targetListDifferenceCm'].forEach(key=>profile[key]=values[key]===''?'':num(values[key]));profile.name=values.name||profile.name;profile.notes=values.notes||'';saveData();renderBallastTool();toast('Ballastgegevens opgeslagen')};
  $('#newBallastProfile').onclick=()=>{const created=defaultBallastProfile();created.name='Nieuw schip';db.ballastProfiles.push(created);db.settings.activeBallastProfileId=created.id;saveData();renderBallastTool()};
  $('#duplicateBallastProfile').onclick=()=>{const copy=cloneJson(profile);copy.id=uid('BLS');copy.name=profile.name+' – kopie';copy.createdAt=new Date().toISOString();copy.stations=(copy.stations||[]).map(row=>({...row,id:uid('BST')}));copy.zones=(copy.zones||[]).map(zone=>({...zone,id:uid('BLZ')}));db.ballastProfiles.push(copy);db.settings.activeBallastProfileId=copy.id;saveData();renderBallastTool();toast('Scheepsprofiel gekopieerd')};
  $('#deleteBallastProfile').onclick=()=>{if(db.ballastProfiles.length<=1){toast('Minimaal één scheepsprofiel blijft nodig.');return}if(confirm(`Scheepsprofiel “${profile.name}” verwijderen?`)){db.ballastProfiles=db.ballastProfiles.filter(row=>row.id!==profile.id);db.settings.activeBallastProfileId=db.ballastProfiles[0].id;saveData();renderBallastTool()}};
  $('#generateBallastStations').onclick=()=>{if(confirm('De huidige waterlijnstations vervangen door een algemene voorbeeldvorm?')){profile.stations=defaultBallastStations(profile.length,profile.beam);saveData();renderBallastTool()}};
  $('#addBallastStation').onclick=()=>{profile.stations.push({id:uid('BST'),x:num(profile.length)/2,width:num(profile.beam)});saveData();renderBallastTool()};
  $$('[data-station-field]').forEach(input=>input.onchange=()=>{const row=profile.stations.find(item=>item.id===input.dataset.stationId);if(!row)return;row[input.dataset.stationField]=num(input.value);saveData()});
  $$('.delete-ballast-station').forEach(button=>button.onclick=()=>{if(profile.stations.length<=2){toast('Minimaal twee stations zijn nodig.');return}profile.stations=profile.stations.filter(row=>row.id!==button.dataset.id);saveData();renderBallastTool()});
  $('#addBallastZone').onclick=()=>{profile.zones.push({id:uid('BLZ'),name:'Nieuwe ballastzone',start:0,end:num(profile.length),side:'Midden',bottomWidth:0,topWidth:0,height:0,shape:'round',usable:85,density:2.4,currentMass:0,z:.2,lateralOffset:0,enabled:true,note:''});saveData();renderBallastTool()};
  $$('[data-zone-field]').forEach(input=>input.onchange=()=>{const zone=profile.zones.find(item=>item.id===input.dataset.zoneId);if(!zone)return;const field=input.dataset.zoneField;if(input.type==='checkbox')zone[field]=input.checked;else if(['name','side','shape','note'].includes(field))zone[field]=input.value;else zone[field]=num(input.value);saveData()});
  $$('.delete-ballast-zone').forEach(button=>button.onclick=()=>{if(confirm('Deze ballastzone verwijderen?')){profile.zones=profile.zones.filter(row=>row.id!==button.dataset.id);saveData();renderBallastTool()}});
  $('#ballastCalculate').onclick=()=>renderBallastTool();$('#ballastReport').onclick=generateBallastReport;
}
function generateBallastReport(){
  const profile=activeBallastProfile(),hydro=ballastHydrostatics(profile),recommendation=ballastRecommendation(profile,hydro),heel=ballastHeelRecommendation(profile,hydro,recommendation),win=window.open('','_blank');if(!win){toast('Sta pop-ups toe om het rapport te maken.');return}
  win.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Ballastplan ${esc(profile.name)}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#172a38}h1,h2{color:#123b5d}.warning{padding:12px;border:2px solid #b55;background:#fff1f1}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.box{border:1px solid #ccd7df;padding:10px;border-radius:8px}.box b{display:block;font-size:19px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #ccd7df;padding:7px;text-align:left;font-size:12px}th{background:#eef4f7}@media print{button{display:none}}</style></head><body><button onclick="print()">Afdrukken / opslaan als PDF</button><h1>Ballastplan – ${esc(profile.name)}</h1><p>Gegenereerd ${new Date().toLocaleString('nl-NL')}</p><div class="warning"><b>Geen goedgekeurde stabiliteitsberekening.</b> Laat de uitkomst vóór uitvoering toetsen aan werkelijke diepgangen, stabiliteit, constructie en borging.</div><h2>Hydrostatische schatting</h2><div class="grid"><div class="box">Waterverplaatsing<b>${ballastFmt(hydro.displacement)} t</b></div><div class="box">TPC<b>${ballastFmt(hydro.tpc,3)} t/cm</b></div><div class="box">MCT 1 cm<b>${ballastFmt(hydro.mct)} tm/cm</b></div><div class="box">LCF vanaf achter<b>${ballastFmt(hydro.lcf)} m</b></div></div><h2>${esc(recommendation.mode)}</h2><p>Massawijziging ${recommendation.totalMass>=0?'+':''}${ballastFmt(recommendation.totalMass)} t · trimmoment ${recommendation.trimMoment>=0?'+':''}${ballastFmt(recommendation.trimMoment)} tm · aangrijpingspunt ${ballastFmt(recommendation.targetX)} m vanaf achter.</p><table><thead><tr><th>Actie</th><th>Zone</th><th>x</th><th>Massa</th><th>z</th></tr></thead><tbody>${(recommendation.allocation?.items||[]).map(row=>`<tr><td>${row.mass>=0?'Toevoegen':'Verwijderen'}</td><td>${esc(row.zone.name)}</td><td>${ballastFmt(row.x)} m</td><td>${row.mass>=0?'+':''}${ballastFmt(row.mass)} t</td><td>${ballastFmt(row.zone.z)} m</td></tr>`).join('')||'<tr><td colspan="5">Geen uitvoerbaar advies met de ingevoerde zones.</td></tr>'}</tbody></table>${recommendation.warning?`<p class="warning">${esc(recommendation.warning)}</p>`:''}${heel?`<h2>Zijwaartse indicatie</h2><p>${heel.mass!=null?`${ballastFmt(heel.mass)} t aan ${esc(heel.desiredSide.toLowerCase())}, zone ${esc(heel.zone.zone.name)}.`:esc(heel.warning)}</p>`:''}<h2>Ballastzones</h2><table><thead><tr><th>Zone</th><th>Lengte</th><th>Vorm</th><th>Huidig</th><th>Maximaal</th></tr></thead><tbody>${(profile.zones||[]).map(zone=>{const cap=ballastZoneCapacity(zone);return `<tr><td>${esc(zone.name)}</td><td>${ballastFmt(zone.start)}–${ballastFmt(zone.end)} m</td><td>${esc(ballastShapeLabel(zone.shape))}</td><td>${ballastFmt(zone.currentMass)} t</td><td>${ballastFmt(cap.mass)} t</td></tr>`}).join('')}</tbody></table></body></html>`);win.document.close();
}

function renderSettings(){
  const driveState=driveConnected?'connected':(driveLastError?'error':'');
  const notificationsState=typeof Notification==='undefined'?'niet ondersteund':(notificationsEnabled()?(Notification.permission==='granted'?'ingeschakeld':'toestemming nodig'):'uit');
  $('#view-settings').innerHTML=`<div class="grid dashboard-grid">
    <div class="card drive-card"><div class="section-title"><h3>Google Drive synchronisatie</h3></div>
      <div class="drive-status-line"><span id="driveSettingsDot" class="drive-dot ${driveState}"></span><b id="driveSettingsStatus">${driveConnected?'Google Drive is verbonden.':'Google Drive is niet verbonden.'}</b></div>
      <p class="drive-help">VMMS bewaart één verborgen databasebestand in jouw Google Drive. De app krijgt met deze instelling geen toegang tot je gewone Drive-bestanden.</p>
      <p id="driveLastSync" class="drive-help">${localStorage.getItem(DRIVE_LAST_SYNC_KEY)?'Laatste synchronisatie: '+new Date(localStorage.getItem(DRIVE_LAST_SYNC_KEY)).toLocaleString('nl-NL'):'Nog niet gesynchroniseerd'}</p>
      <div class="drive-actions">
        <button class="btn" id="connectDrive">${driveConnected?'Opnieuw verbinden':'Verbinden met Google Drive'}</button>
        <button class="btn secondary" id="syncDrive" ${driveConnected?'':'disabled'}>Nu synchroniseren</button>
        <button class="btn secondary" id="loadDrive" ${driveConnected?'':'disabled'}>Drive-versie laden</button>
        <button class="btn danger" id="disconnectDrive" ${driveConnected?'':'disabled'}>Drive loskoppelen</button>
      </div>
    </div>
    <div class="card system-card"><div class="section-title"><h3>Systeemcontrole</h3><div class="section-actions"><button class="btn secondary" id="refreshSystemCheck">Vernieuwen</button><button class="btn secondary" id="clearAppCache">Cache vernieuwen</button></div></div>
      ${systemCheckHtml()}
    </div>
  </div>

  <div class="grid dashboard-grid" style="margin-top:16px">
    <div class="card"><div class="section-title"><h3>Waarschuwingsgrenzen</h3></div><form id="settingsForm" class="form-grid">
      <label>Binnenkort datum (dagen)<input type="number" name="soonDays" value="${esc(db.settings.soonDays)}"></label>
      <label>Urgent na te laat (dagen)<input type="number" name="urgentDaysOverdue" value="${esc(db.settings.urgentDaysOverdue)}"></label>
      <label>Binnenkort draaiuren<input type="number" name="soonHours" value="${esc(db.settings.soonHours)}"></label>
      <label>Urgent na te laat (uren)<input type="number" name="urgentHoursOverdue" value="${esc(db.settings.urgentHoursOverdue)}"></label>
      <div class="span-2 form-actions"><button class="btn">Instellingen opslaan</button></div>
    </form></div>
    <div class="card weather-settings-card">
      <div class="section-title"><div><h3>Weerlocatie en klusadvies</h3><small>Standaard ingesteld op de ligplaats in Leeuwarden.</small></div></div>
      <form id="weatherSettingsForm" class="form-grid">
        <label class="span-2">Plaatsnaam<input name="weatherLocation" value="${esc(db.settings.weatherLocationName||'Leeuwarden')}" placeholder="Bijvoorbeeld Leeuwarden"></label>
        <label>Breedtegraad<input value="${esc(db.settings.weatherLatitude||53.2012)}" readonly></label>
        <label>Lengtegraad<input value="${esc(db.settings.weatherLongitude||5.7999)}" readonly></label>
        <div class="span-2 form-actions"><button type="button" class="btn secondary" id="deviceWeatherLocation">Gebruik telefoonlocatie</button><button class="btn" type="submit">Locatie zoeken en opslaan</button></div>
      </form>
      <p class="drive-help">De app gebruikt temperatuur, regen, luchtvochtigheid, wind en windvlagen voor het klusadvies. Hiervoor is internet nodig; de laatste verwachting wordt tijdelijk lokaal bewaard.</p>
    </div>
  </div>

  <div class="card photo-drive-manager" style="margin-top:16px">
    <div class="section-title"><div><h3>Drive-fotoarchief</h3><small>Grote originelen uit GitHub houden en veilig in de verborgen Drive-appmap bewaren.</small></div><span class="status ${photoLibraryStats().drive===photoLibraryStats().total?'goed':'binnenkort'}">${photoLibraryStats().drive}/${photoLibraryStats().total} in Drive</span></div>
    <div class="photo-drive-actions">
      <label class="btn" style="text-align:center">Foto-importpakket kiezen<input id="importPhotoPack" type="file" accept=".vmmsphotos,application/json" hidden></label>
      <button class="btn secondary" id="relinkPhotoLibrary" ${driveConnected?'':'disabled'}>Drive-index herstellen</button>
      <button class="btn secondary" id="openPhotoArchive" type="button">Open fotoarchief</button>
    </div>
    <p id="photoImportProgress" class="drive-help">Download het aparte <b>VMMS 4.1 Foto-importpakket</b>, verbind Drive en kies het bestand hier één keer. Daarna kunnen de grote foto’s uit GitHub worden verwijderd.</p>
  </div>

  <div class="grid dashboard-grid" style="margin-top:16px">
    <div class="card">
      <div class="section-title"><h3>Back-up en herstel</h3><div class="section-actions"><button class="btn secondary" id="driveBackupManager" ${driveConnected?'':'disabled'}>Drive-back-ups</button><button class="btn secondary" id="createRestorePoint">Herstelpunt maken</button></div></div>
      <div class="list">
        <button class="btn" id="exportJson">Volledige back-up downloaden</button>
        <label class="btn secondary" style="text-align:center">Back-up importeren<input id="importJson" type="file" accept=".json" hidden></label>
        <button class="btn secondary" id="exportObjects">Objecten als CSV</button>
        <button class="btn secondary" id="exportMaintenance">Onderhoud als CSV</button>
        <button class="btn danger" id="resetData">Terug naar originele VMMS-data</button>
      </div>
      <div class="section-title" style="margin-top:18px"><h3>Lokale herstelpunten</h3></div>
      <div class="list backup-history">${localBackupsHtml()}</div>
    </div>
    <div class="card">
      <div class="section-title"><h3>Weergave, meldingen en beveiliging</h3></div>
      <div class="list">
        <div class="list-item"><strong>Donkere modus</strong><small>Nieuwe zwarte donkere modus met rustigere kaarten en beter zichtbare achtergrond.</small><div class="row-actions"><button class="btn secondary" id="themeLight">Licht</button><button class="btn" id="themeDark">Zwart donker</button></div></div>
        <div class="list-item"><strong>Meldingen</strong><small>Status: ${esc(notificationsState)}. Je krijgt maximaal één onderhoudssamenvatting per dag.</small><div class="row-actions"><button class="btn secondary" id="enableNotifications">Meldingen aan</button><button class="btn secondary" id="testNotifications">Testmelding</button><button class="btn secondary" id="disableNotifications">Meldingen uit</button></div></div>
        <div class="list-item"><strong>Beveiliging</strong><small>Google-login en pincode blijven actief. De app vergrendelt zichzelf na 15 minuten zonder gebruik.</small><div class="row-actions"><button class="btn secondary" id="settingsGoogleLogin">Google-account opnieuw koppelen</button><button class="btn secondary" id="lockNowFromSettings">Nu vergrendelen</button></div></div>
        <div class="list-item"><strong>Dagelijkse back-up</strong><small>Wordt bij synchronisatie automatisch in de verborgen Drive-appmap gemaakt en 14 dagen bewaard.</small></div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:16px"><h3>Over deze app</h3><p><b>Versie ${esc(VMMS_BUILD)}</b></p><p>Deze update verplaatst grote foto’s naar Google Drive. GitHub bevat alleen de appcode en logo’s; foto’s worden lui geladen en lokaal als lichte miniatuur getoond.</p><p><b>${db.objects.length}</b> objecten · <b>${db.maintenance.length}</b> onderhoudstaken · <b>${db.workOrders.length}</b> werkbonnen</p></div>`;

  $('#settingsTheme')?.remove?.();
  $('#weatherSettingsForm').onsubmit=saveWeatherLocation;
  $('#deviceWeatherLocation').onclick=useDeviceWeatherLocation;
  $('#settingsForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());Object.keys(d).forEach(k=>db.settings[k]=num(d[k]));saveData();toast('Instellingen opgeslagen')};
  $('#connectDrive').onclick=()=>connectGoogleDrive('consent').then(()=>renderSettings());
  $('#syncDrive').onclick=()=>syncNow().then(()=>renderSettings());
  $('#loadDrive').onclick=async()=>{if(!driveAccessToken){toast('Verbind eerst met Google Drive.');return}try{setDriveUi('syncing','Drive-versie laden…');if(!driveFileId)await findDriveFile();if(!driveFileId)throw new Error('Er is nog geen Drive-bestand.');const remote=await downloadDriveDatabase(driveFileId);if(confirm('De lokale gegevens vervangen door de versie uit Google Drive?')){db=remote;localStorage.setItem(STORAGE_KEY,JSON.stringify(db));localStorage.setItem(DRIVE_DIRTY_KEY,'0');localStorage.setItem(DRIVE_LAST_SYNC_KEY,new Date().toISOString());renderSettings();toast('Drive-versie geladen.')}}catch(error){setDriveUi('error',error.message);toast(error.message)}};
  $('#disconnectDrive').onclick=()=>{disconnectGoogleDrive();renderSettings()};
  $('#refreshSystemCheck').onclick=()=>renderSettings();$('#clearAppCache').onclick=clearVmmsCaches;$('#driveBackupManager').onclick=openDriveBackupManager;
  $('#importPhotoPack').onchange=event=>{const file=event.target.files?.[0];if(file)importVmmsPhotoPack(file)};$('#relinkPhotoLibrary').onclick=relinkPhotoLibraryFromDrive;$('#openPhotoArchive').onclick=()=>navTo('photos');
  $('#createRestorePoint').onclick=()=>{createLocalRestorePoint('Handmatig herstelpunt');renderSettings();toast('Herstelpunt opgeslagen')};
  $('#themeLight').onclick=()=>{setTheme('light');renderSettings();};
  $('#themeDark').onclick=()=>{setTheme('dark');renderSettings();};
  $('#enableNotifications').onclick=async()=>{await requestVmmsNotifications();renderSettings();};
  $('#testNotifications').onclick=sendTestNotification;
  $('#disableNotifications').onclick=()=>{setNotificationsEnabled(false);renderSettings();toast('Meldingen uitgeschakeld')};
  $('#settingsGoogleLogin').onclick=()=>connectGoogleDrive('consent');
  $('#lockNowFromSettings').onclick=()=>lockVmms('VMMS is handmatig vergrendeld.');
  $('#exportJson').onclick=()=>download('VMMS_Variatie_Backup_'+todayISO()+'.json',JSON.stringify(db,null,2),'application/json');
  $('#importJson').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const d=JSON.parse(await file.text());if(!d.objects||!d.maintenance)throw Error();createLocalRestorePoint('Automatisch herstelpunt vóór import');db=d;saveData();renderSettings();toast('Back-up geïmporteerd')}catch{toast('Dit is geen geldige VMMS-back-up')}};
  $('#exportObjects').onclick=()=>exportCsv('vmms_objecten.csv',db.objects);
  $('#exportMaintenance').onclick=()=>exportCsv('vmms_onderhoud.csv',db.maintenance.map(m=>({...m,objectName:objectById(m.objectId)?.name,status:maintenanceState(m).status})));
  $('#resetData').onclick=()=>{if(confirm('Alle wijzigingen en werkbonnen verwijderen en opnieuw beginnen?')){createLocalRestorePoint('Automatisch herstelpunt vóór reset');db=structuredClone(window.SEED_DATA);saveData();renderSettings();toast('Originele gegevens hersteld')}};
  $$('.restore-local-backup').forEach(button=>button.onclick=()=>restoreLocalBackupById(button.dataset.id));
  $$('.delete-local-backup').forEach(button=>button.onclick=()=>deleteLocalBackupById(button.dataset.id));
  $$('.export-local-backup').forEach(button=>button.onclick=()=>{const backup=getLocalBackups().find(item=>item.id===button.dataset.id);if(!backup)return;download(`VMMS_Herstelpunt_${slug(backup.label||'backup')}_${String(backup.createdAt||'').slice(0,10)}.json`,JSON.stringify(backup.data,null,2),'application/json')});
  setDriveUi(driveConnected?'connected':(driveLastError?'error':'disconnected'),driveConnected?'Google Drive is verbonden.':(driveLastError||'Alleen lokaal opgeslagen'));
}


function openMobileMoreMenu(){
  openDialog('Meer',`
    <div class="mobile-more-grid">
      <button class="mobile-more-item" data-view="inspections"><b>◉</b><span>Inspecties</span><small>Schade, foto’s en voor-na vergelijking</small></button>
      <button class="mobile-more-item" data-view="settings"><b>⚙</b><span>Instellingen</span><small>Systeemcontrole, Drive, donker thema en back-up</small></button>
      <button class="mobile-more-item" data-view="ship"><b>⚓</b><span>Scheepsgegevens</span><small>Technische gegevens van Variatie</small></button>
      <button class="mobile-more-item" data-view="photos"><b>☷</b><span>Foto's</span><small>Drive-archief, historie en huidige foto's</small></button>
      <button class="mobile-more-item" data-view="inspiration"><b>★</b><span>Inspiratie</span><small>Zwaarden, roef, stuurstand, tuigage en kleur</small></button>
      <button class="mobile-more-item" data-view="paintplan"><b>▨</b><span>Verfplan</span><small>Fotozones, laagopbouw en werkinstructies</small></button>
      <button class="mobile-more-item" data-view="restoration"><b>⚒</b><span>Restauratie</span><small>Planning, taken en dossier</small></button>
      <button class="mobile-more-item" data-view="manuals"><b>▥</b><span>Handleidingen</span><small>Onderhoudsbronnen</small></button>
      <button class="mobile-more-item" data-view="projects"><b>◈</b><span>Projecten</span><small>Voortgang en planning</small></button>
      <button class="mobile-more-item" data-view="ballast"><b>▰</b><span>Ballastplanner</span><small>Trim, inzinking en ballastzones</small></button>
      <button class="mobile-more-item" data-view="victron"><b>⌁</b><span>Victron</span><small>VRM en energiesysteem</small></button>
      <button class="mobile-more-item" data-view="costs"><b>€</b><span>Kosten</span><small>Overzichten en rapportage</small></button>
      <button class="mobile-more-item" data-view="parts"><b>♻</b><span>Restauratie-inkoop</span><small>Tweedehands zoeken en vergelijken</small></button>
      <button class="mobile-more-item" data-view="documents"><b>▤</b><span>Documenten</span><small>Certificaten en bestanden</small></button>
    </div>
    <div class="form-actions"><button type="button" class="btn secondary" id="closeMobileMore">Sluiten</button></div>`);
  $('#closeMobileMore').onclick=closeDialog;
}

function openDialog(title,html){$('#dialogTitle').textContent=title;$('#dialogBody').innerHTML=html;$('#editDialog').showModal()}
function closeDialog(){$('#editDialog').close()}
function download(name,content,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportCsv(name,rows){
  if(!rows.length){toast('Geen gegevens om te exporteren');return}
  const keys=unique(rows.flatMap(x=>Object.keys(x)));
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  download(name,'\ufeff'+[keys.map(q).join(';'),...rows.map(r=>keys.map(k=>q(r[k])).join(';'))].join('\n'),'text/csv;charset=utf-8');
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-view]');
  if(b){
    const insideMore=!!b.closest('.mobile-more-grid');
    navTo(b.dataset.view);
    if(insideMore&&$('#editDialog')?.open)closeDialog();
  }
});
$('#dialogClose').onclick=closeDialog;
$('#mobileMoreBtn').onclick=openMobileMoreMenu;
$('#driveBtn').onclick=()=>driveConnected?syncNow():connectGoogleDrive('consent');
$('#themeBtn').onclick=toggleTheme;$('#reportBtn').onclick=generateVmmsReport;
$('#editDialog').addEventListener('click',e=>{if(e.target===$('#editDialog'))closeDialog()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').hidden=true}};
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('service-worker.js?v=4.1.0-drive-fotoarchief-20260718',{updateViaCache:'none'})
    .then(registration=>registration.update())
    .catch(()=>{});
}
applyStoredTheme();initializeSecurity();
})();
