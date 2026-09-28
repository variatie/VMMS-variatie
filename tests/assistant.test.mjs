import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const root = new URL('../', import.meta.url);
const db = {
  objects: [{id:'OBJ-1',name:'Bilgepomp',system:'Vuilwater',status:'Actief'}],
  maintenance: [], workOrders: [], inspections: [], documents: [], certificates: [],
  manuals: [], projects: [], parts: [],
  assistantDocuments: [{id:'ADOC-1',title:'Pomphandleiding',text:'De bilgepomp staat in de machinekamer. Controleer de vlotterschakelaar. <script>alert(1)</script>',updatedAt:'2026-09-28T10:00:00Z'}]
};
const storage = new Map();
const context = {
  window: {
    __VMMS_TEST__: true,
    VMMS_ASSISTANT_BRIDGE: {getDb: () => db},
    VMMS_ASSISTANT_KNOWLEDGE: [{id:'SCHEMA-ELEKTRA',type:'Schema',title:'Schema 24 V en 230 V',status:'Concept',tags:['stroom'],text:'Walstroom en accu'}]
  },
  document: {readyState:'loading',addEventListener(){}},
  localStorage: {getItem: key => storage.get(key) ?? null},
  sessionStorage: {getItem: key => storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value)},
  console
};
runInNewContext(readFileSync(new URL('assistant-diagrams.js',root),'utf8'),context);
runInNewContext(readFileSync(new URL('assistant.js',root),'utf8'),context);
const assistant = context.window.VMMS_ASSISTANT_TEST;

test('de drie conceptschema’s worden herkend', () => {
  assert.equal(assistant.diagramKind('Toon schema 24 V en 230 V'),'electric');
  assert.equal(assistant.diagramKind('Hoe werkt Sola 15 met Mar-IX?'),'climate');
  assert.equal(assistant.diagramKind('Hoe loopt het vuilwater?'),'water');
  assert.match(assistant.diagramHtml('climate'),/Geen extra buffervat/);
});

test('zelf toegevoegde documenttekst is vindbaar en HTML wordt ontsmet', () => {
  const result = assistant.answer('Waar staat de bilgepomp?');
  assert.match(result,/ADOC-1/);
  assert.match(result,/28-9-2026/);
  assert.doesNotMatch(result,/<script>/);
});

test('een inhoudelijk document gaat voor een objectnaam bij een inhoudelijke vraag', () => {
  const result = assistant.answer('Waar staat de bilgepomp en wat moet ik controleren?');
  assert.match(result,/^<p>De bilgepomp staat in de machinekamer/);
});

test('korte vervolgvragen nemen het vorige onderwerp mee', () => {
  const history = [{role:'user',content:'Hoe werkt het vuilwater van de douche?'}];
  assert.equal(assistant.contextualQuery('En de pomp?',history),'Hoe werkt het vuilwater van de douche? En de pomp?');
  assert.equal(assistant.contextualQuery('Hoe werkt de generator?',history),'Hoe werkt de generator?');
});

test('een schema-antwoord bevat een concepttekening en bron', () => {
  const result = assistant.answer('Toon het schema van 24 V en 230 V');
  assert.match(result,/assistant-diagram/);
  assert.match(result,/SCHEMA-ELEKTRA/);
});
