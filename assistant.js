(() => {
  'use strict';

  const STORAGE_KEY = 'vmms_variatie_data_v1';
  const DRIVE_LAST_SYNC_KEY = 'vmms_drive_last_sync_v1';
  const HISTORY_KEY = 'vmms_assistant_history_v1';
  const MAX_HISTORY = 16;
  const STOP_WORDS = new Set('de het een en van voor met op in is zijn was wat hoe waar wanneer welke dat die dit mijn jouw onze aan als bij om te er of naar uit ik je kan kun moet graag over alle ook nog dan'.split(' '));
  const SYNONYMS = {
    stroom: ['elektra','elektriciteit','24v','230v','victron','omvormer'],
    water: ['drinkwater','vuilwater','pomp','tank','afvoer'],
    douche: ['bad','opvangtank','warm water','sola'],
    kachel: ['verwarming','sola','mar-ix','warmte'],
    storing: ['defect','alarm','uitval','overload','probleem'],
    generator: ['westerbeke','aggregaat'],
    motor: ['daewoo','hoofdmotor','l136'],
    onderhoud: ['taak','service','inspectie','controleren'],
    schema: ['leiding','route','installatie','overzicht'],
    handleiding: ['handboek','manual','document'],
    werkbon: ['werkorder','klus','opdracht']
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const asArray = value => Array.isArray(value) ? value : [];
  const normalize = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d+)\s*v\b/g, '$1v').replace(/[^a-z0-9]+/g, ' ').trim();

  function getDb() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return window.SEED_DATA || {};
  }

  function safeText(value, depth = 0) {
    if (depth > 3 || value == null) return '';
    if (typeof value === 'string') {
      if (value.length > 1800 || /^data:/i.test(value)) return '';
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(item => safeText(item, depth + 1)).join(' ');
    if (typeof value === 'object') {
      return Object.entries(value).filter(([key]) => !/photo|image|base64|thumbnail|blob/i.test(key)).slice(0, 50).map(([, item]) => safeText(item, depth + 1)).join(' ');
    }
    return '';
  }

  function objectName(db, id) {
    return asArray(db.objects).find(item => item.id === id)?.name || id || '';
  }

  function record(type, view, item, titleFields, detailFields) {
    const title = titleFields.map(key => item?.[key]).find(Boolean) || item?.id || type;
    const detail = detailFields.map(key => item?.[key]).filter(Boolean).join(' · ');
    return {
      id: item?.id || `${type}-${title}`,
      type,
      view,
      title: String(title),
      detail,
      text: `${title} ${detail} ${safeText(item)}`,
      raw: item
    };
  }

  function buildCorpus(db) {
    const rows = [];
    asArray(db.objects).forEach(item => rows.push(record('Object', 'objects', item, ['name'], ['system','type','location','brand','model','status','note'])));
    asArray(db.maintenance).forEach(item => rows.push({
      ...record('Onderhoud', 'maintenance', item, ['task','name'], ['basis','confidence','note','lastDate','lastMeter']),
      detail: `${objectName(db, item.objectId)}${item.intervalHours ? ` · elke ${item.intervalHours} uur` : ''}${item.intervalMonths ? ` · elke ${item.intervalMonths} maanden` : ''}${item.intervalDays ? ` · elke ${item.intervalDays} dagen` : ''}`
    }));
    asArray(db.workOrders).forEach(item => rows.push(record('Werkbon', 'logbook', item, ['title','description','number','id'], ['status','date','objectName','note','result','performedBy'])));
    asArray(db.inspections).forEach(item => rows.push(record('Inspectie/storing', 'inspections', item, ['title','description','issue','id'], ['status','severity','zone','date','temporarySolution','note'])));
    asArray(db.documents).forEach(item => rows.push(record('Document', 'documents', item, ['name','title'], ['category','status','date','note','link'])));
    asArray(db.certificates).forEach(item => rows.push(record('Certificaat', 'documents', item, ['name'], ['category','issuedDate','expiryDate','note'])));
    asArray(db.manuals).forEach(item => rows.push(record('Handleiding', 'manuals', item, ['title','name'], ['manufacturer','model','status','kind','note'])));
    asArray(db.projects).forEach(item => rows.push(record('Project', 'projects', item, ['name','title'], ['status','description','note','budget'])));
    asArray(db.parts).forEach(item => rows.push(record('Onderdeel', 'parts', item, ['name'], ['supplier','location','stock','minimum','note'])));
    asArray(window.VMMS_ASSISTANT_KNOWLEDGE).forEach(item => rows.push({
      id: item.id, type: item.type, view: item.type === 'Schema' ? 'assistant' : 'manuals', title: item.title,
      detail: item.status, text: `${item.title} ${item.status} ${asArray(item.tags).join(' ')} ${item.text}`, raw: item
    }));
    return rows;
  }

  function queryTerms(query) {
    const base = normalize(query).split(' ').filter(term => term.length > 1 && !STOP_WORDS.has(term));
    const expanded = [...base];
    base.forEach(term => asArray(SYNONYMS[term]).forEach(extra => expanded.push(...normalize(extra).split(' '))));
    return [...new Set(expanded)];
  }

  function search(corpus, query, limit = 8) {
    const baseTerms = normalize(query).split(' ').filter(term => term.length > 1 && !STOP_WORDS.has(term));
    const baseSet = new Set(baseTerms);
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const scored = corpus.map(item => {
      const title = normalize(item.title);
      const detail = normalize(item.detail);
      const body = normalize(item.text);
      let score = 0;
      terms.forEach(term => {
        const weight = baseSet.has(term) ? 1 : .3;
        if (title.includes(term)) score += 8 * weight;
        if (detail.includes(term)) score += 4 * weight;
        if (body.includes(term)) score += 1 * weight;
      });
      if (normalize(query).includes(title) && title.length > 3) score += 12;
      return {...item, score};
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'nl'));
    const minimum = scored[0]?.score >= 12 ? scored[0].score * .18 : .9;
    return scored.filter(item => item.score >= minimum).slice(0, limit);
  }

  function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + Number(months || 0));
    return result;
  }

  function maintenanceDue(db) {
    const today = new Date();
    today.setHours(0,0,0,0);
    return asArray(db.maintenance).map(item => {
      const obj = asArray(db.objects).find(entry => entry.id === item.objectId);
      let dueDate = null;
      if (item.lastDate && item.intervalDays) {
        dueDate = new Date(item.lastDate); dueDate.setDate(dueDate.getDate() + Number(item.intervalDays));
      } else if (item.lastDate && item.intervalMonths) dueDate = addMonths(item.lastDate, item.intervalMonths);
      const dueMeter = Number(item.intervalHours) > 0 && Number.isFinite(Number(item.lastMeter)) ? Number(item.lastMeter) + Number(item.intervalHours) : null;
      const meterOver = dueMeter != null && Number.isFinite(Number(obj?.meter)) && Number(obj.meter) >= dueMeter;
      const dateOver = dueDate && dueDate < today;
      return {item, obj, dueDate, dueMeter, overdue: Boolean(dateOver || meterOver)};
    }).filter(entry => entry.overdue).sort((a,b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0));
  }

  function sourceCard(item) {
    const statusClass = /storing|veilig|defect|kritisch/i.test(item.detail) ? 'warn' : '';
    const summary = item.raw?.text || item.detail || 'Open de bron voor meer informatie.';
    return `<article class="assistant-source ${statusClass}">
      <div class="assistant-source-head"><span>${esc(item.type)}</span><b>${esc(item.title)}</b></div>
      <p>${esc(String(summary).slice(0, 520))}${String(summary).length > 520 ? '…' : ''}</p>
      <div class="assistant-source-foot"><small>${esc(item.detail || item.id)}</small>${item.view && item.view !== 'assistant' ? `<button type="button" data-assistant-open="${esc(item.view)}">Open ${esc(item.view)}</button>` : ''}</div>
    </article>`;
  }

  function inventoryAnswer(db) {
    const sync = localStorage.getItem(DRIVE_LAST_SYNC_KEY);
    const lastSync = sync ? new Date(sync).toLocaleString('nl-NL') : 'nog niet geregistreerd op dit apparaat';
    return `<p>Ik gebruik de VMMS-database die nu op dit apparaat staat. Als Google Drive is gesynchroniseerd, is dit dezelfde dataset die uit Drive is geladen.</p>
      <div class="assistant-facts">
        <span><b>${asArray(db.objects).length}</b> objecten</span><span><b>${asArray(db.maintenance).length}</b> onderhoudstaken</span>
        <span><b>${asArray(db.workOrders).length}</b> werkbonnen</span><span><b>${asArray(db.inspections).length}</b> inspecties/storingen</span>
      </div><p class="assistant-note">Laatste bekende Drive-sync: ${esc(lastSync)}.</p>`;
  }

  function answer(query) {
    const db = getDb();
    const corpus = buildCorpus(db);
    const normalized = normalize(query);
    if (/wat weet|bronnen|gegevens|drive|context/.test(normalized)) return inventoryAnswer(db);
    if (/achterstallig|te laat|verlopen|vandaag doen|urgent onderhoud/.test(normalized)) {
      const due = maintenanceDue(db).slice(0, 12);
      if (!due.length) return '<p>Ik zie geen berekenbaar achterstallig onderhoud. Taken zonder laatste datum of tellerstand kunnen hierbij buiten beeld blijven; controleer daarom ook de lijst <b>Nog invullen</b>.</p><button type="button" class="assistant-link" data-assistant-open="maintenance">Open onderhoud</button>';
      return `<p>Ik vind <b>${due.length}</b> onderhoudstaken die op basis van datum of tellerstand over de grens zijn. Dit is een berekende samenvatting; niet ingevulde datums en standen vragen aparte controle.</p><ol class="assistant-due">${due.map(entry => `<li><b>${esc(entry.item.task || entry.item.name)}</b><small>${esc(entry.obj?.name || entry.item.objectId || '')}${entry.dueDate ? ` · gepland ${esc(entry.dueDate.toLocaleDateString('nl-NL'))}` : ''}${entry.dueMeter != null ? ` · grens ${esc(entry.dueMeter)} uur` : ''}</small></li>`).join('')}</ol><button type="button" class="assistant-link" data-assistant-open="maintenance">Open onderhoud</button>`;
    }
    if (/samenvatting|overzicht/.test(normalized) && /storing|inspectie/.test(normalized)) {
      const open = asArray(db.inspections).filter(item => !/afgerond|gesloten|opgelost/i.test(item.status || '')).slice(0, 10);
      return open.length ? `<p>Ik zie <b>${open.length}</b> open of niet-afgesloten inspecties/storingen.</p>${open.map(item => sourceCard(record('Inspectie/storing','inspections',item,['title','description','issue','id'],['status','severity','zone','date','note']))).join('')}` : '<p>Ik zie geen open inspecties of storingen met een herkenbare status. Controleer de inspectielijst als statussen nog niet zijn ingevuld.</p>';
    }
    const matches = search(corpus, query);
    if (!matches.length) return '<p>Ik kan hierover nog geen betrouwbare informatie in het handboek of de huidige VMMS-data vinden.</p><p class="assistant-note">Probeer een objectnaam, systeem, foutcode of taak. Voor nieuwe kennis kun je een document of notitie aan VMMS/Drive toevoegen en daarna opnieuw synchroniseren.</p>';
    const top = matches[0];
    const lead = top.raw?.text ? `<p>${esc(top.raw.text)}</p>` : `<p>Het beste passende resultaat is <b>${esc(top.title)}</b>. Open de bron voor de volledige registratie.</p>`;
    const warning = /historisch|verifieren|veiligheidskritisch|concept|onvolledig|storing/i.test(top.detail || '') ? '<p class="assistant-warning"><b>Let op:</b> deze informatie bevat een onzekerheid, historische situatie of veiligheidswaarschuwing. Controleer de actuele installatie en fabrikantgegevens.</p>' : '';
    return `${lead}${warning}<h4>Gevonden bronnen</h4>${matches.slice(0,6).map(sourceCard).join('')}`;
  }

  function loadHistory() {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) { return []; }
  }

  function saveHistory(history) {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  }

  function messagesHtml(history) {
    if (!history.length) return `<div class="assistant-welcome"><span>✦</span><div><h3>Waarmee kan ik helpen?</h3><p>Ik zoek in het handboek, objecten, onderhoud, werkbonnen, inspecties, documenten, schema's en de laatst gesynchroniseerde VMMS-data.</p></div></div>`;
    return history.map(item => `<div class="assistant-message ${item.role}"><div class="assistant-avatar">${item.role === 'user' ? 'Jij' : '✦'}</div><div class="assistant-bubble">${item.role === 'user' ? `<p>${esc(item.content)}</p>` : item.content}</div></div>`).join('');
  }

  function render() {
    const root = document.querySelector('#view-assistant');
    if (!root) return;
    const db = getDb();
    const history = loadHistory();
    root.innerHTML = `<div class="assistant-shell">
      <div class="assistant-header"><div><span class="assistant-kicker">VMMS Assistent</span><h2>Vraag het aan je scheepsdossier</h2><p>Antwoorden blijven op dit apparaat en tonen hun VMMS-bronnen.</p></div><div class="assistant-status"><span></span>${localStorage.getItem(DRIVE_LAST_SYNC_KEY) ? 'Drive-data beschikbaar' : 'Lokale VMMS-data'}</div></div>
      <div class="assistant-suggestions">
        <button type="button" data-assistant-question="Welk onderhoud is achterstallig?">Achterstallig onderhoud</button>
        <button type="button" data-assistant-question="Wat zegt het handboek over stroomuitval?">Stroomuitval</button>
        <button type="button" data-assistant-question="Toon het schema van 24 V en 230 V">24 V en 230 V</button>
        <button type="button" data-assistant-question="Hoe loopt het vuilwater van douche, wc en keuken?">Water en vuilwater</button>
        <button type="button" data-assistant-question="Welke context en Drive-data gebruik je?">Gebruikte bronnen</button>
      </div>
      <div id="assistantMessages" class="assistant-messages" aria-live="polite">${messagesHtml(history)}</div>
      <form id="assistantForm" class="assistant-form"><label class="sr-only" for="assistantInput">Vraag aan VMMS Assistent</label><textarea id="assistantInput" rows="2" placeholder="Bijvoorbeeld: wat moet ik controleren als de generator draait maar niet laadt?" required></textarea><button type="submit">Vraag</button></form>
      <div class="assistant-footer"><span>Geen internet of externe AI nodig</span><button type="button" id="assistantClear">Gesprek wissen</button></div>
    </div>`;
    bind(root);
    requestAnimationFrame(() => { const messages = root.querySelector('#assistantMessages'); if (messages) messages.scrollTop = messages.scrollHeight; });
    document.querySelector('#pageTitle').textContent = 'Assistent';
    root.dataset.ready = '1';
    root.dataset.counts = `${asArray(db.objects).length}-${asArray(db.maintenance).length}`;
  }

  function ask(question) {
    const clean = String(question || '').trim();
    if (!clean) return;
    const history = loadHistory();
    history.push({role:'user', content:clean}, {role:'assistant', content:answer(clean)});
    saveHistory(history);
    render();
  }

  function openView(view) {
    const target = [...document.querySelectorAll(`[data-view="${view}"]`)].find(button => !button.closest('#view-assistant'));
    if (target) target.click();
  }

  function bind(root) {
    root.querySelector('#assistantForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = root.querySelector('#assistantInput');
      ask(input?.value);
    });
    root.querySelectorAll('[data-assistant-question]').forEach(button => button.addEventListener('click', () => ask(button.dataset.assistantQuestion)));
    root.querySelectorAll('[data-assistant-open]').forEach(button => button.addEventListener('click', () => openView(button.dataset.assistantOpen)));
    root.querySelector('#assistantClear')?.addEventListener('click', () => { sessionStorage.removeItem(HISTORY_KEY); render(); });
  }

  function init() {
    document.querySelector('#assistantQuickButton')?.addEventListener('click', () => openView('assistant'));
    document.querySelectorAll('[data-view="assistant"]').forEach(button => button.addEventListener('click', () => setTimeout(render, 0)));
    if (document.querySelector('#view-assistant.active')) render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
