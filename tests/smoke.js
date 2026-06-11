/* Smoke test della logica di dominio, eseguibile senza browser:
       node tests/smoke.js
   Carica constants/store/app con stub minimi di DOM e localStorage
   e verifica validazioni, permessi e regole di avanzamento. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  console,
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  },
  window: { scrollTo() {} },
  alert() {},
  confirm() { return true; },
  Date, JSON, Math, Object, Array, String, Number, isNaN,
};
vm.createContext(sandbox);

for (const f of ['js/constants.js', 'js/store.js', 'js/app.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
}

let passed = 0, failed = 0;
function check(nome, cond) {
  if (cond) { passed++; console.log('  ✓ ' + nome); }
  else { failed++; console.error('  ✗ ' + nome); }
}

/* le dichiarazioni let/const non diventano proprietà del sandbox: si recuperano dal contesto */
const S = vm.runInContext(
  '({ DB, GATES, schedaVuota, validaScheda, can, tuttiGateCompleti, notaMancante, haRischiAperti, nowISO, ' +
  'STATI_DECISIONE_REGISTRABILE, approvazioniSufficienti })',
  sandbox);

console.log('\nSeed e store');
check('il DB seed contiene una scheda dimostrativa', S.DB.schede.length === 1);
check('la scheda seed è in stato bozza', S.DB.schede[0].stato === 'bozza');
check('la creazione è registrata in audit', S.DB.schede[0].audit.some(a => a.azione === 'Creazione scheda'));

console.log('\nValidazione scheda');
const vuota = S.schedaVuota('Tester', 'rd');
const erroriVuota = S.validaScheda(vuota);
check('una scheda vuota produce errori di validazione', erroriVuota.length >= 10);
check('la scheda seed (completa) passa la validazione', S.validaScheda(S.DB.schede[0]).length === 0);

const evoluzione = JSON.parse(JSON.stringify(S.DB.schede[0]));
evoluzione.contenuto.novita = 'Evoluzione esistente';
evoluzione.tecnica.retrocompatibilita = '';
check('retrocompatibilità obbligatoria per le evoluzioni',
  S.validaScheda(evoluzione).some(e => e.includes('Retrocompatibilità')));

const conRischio = JSON.parse(JSON.stringify(S.DB.schede[0]));
conRischio.rischi[0].azione = '';
check('azione obbligatoria se rischio mitigato',
  S.validaScheda(conRischio).some(e => e.includes('mitigati')));

console.log('\nMatrice permessi (Prodotto allineato a COO e Direttore R&D)');
check('R&D non compila il Gate Business', !S.can('rd', 'gate1'));
check('Prodotto compila il Gate Business', S.can('prodotto', 'gate1'));
check('Prodotto compila il Gate R&D come COO e Direttore',
  S.can('prodotto', 'gate2') && S.can('coo', 'gate2') && S.can('dir', 'gate2'));
check('R&D compila il Gate R&D', S.can('rd', 'gate2'));
check('tutti i ruoli compilano il Gate Tecnico',
  ['rd', 'prodotto', 'coo', 'dir'].every(r => S.can(r, 'gate3')));
check('Prodotto, COO e Direttore approvano la chiusura; R&D no',
  S.can('prodotto', 'approvaChiusura') && S.can('coo', 'approvaChiusura') &&
  S.can('dir', 'approvaChiusura') && !S.can('rd', 'approvaChiusura'));
check('Prodotto crea e sottoscrive schede come il Direttore R&D',
  S.can('prodotto', 'creaScheda') && S.can('prodotto', 'sottoscrivi') && S.can('dir', 'creaScheda'));
check('COO non crea schede (come da matrice originale)', !S.can('coo', 'creaScheda'));

console.log('\nDecisione finale non bloccata dai gate');
check('la decisione è registrabile già in stato "Sottoscritta da R&D"',
  S.STATI_DECISIONE_REGISTRABILE.includes('sottoscritta'));
check('la decisione è registrabile in "In valutazione" (gate incompleti)',
  S.STATI_DECISIONE_REGISTRABILE.includes('in_valutazione'));
check('la decisione è registrabile in "Valutata"',
  S.STATI_DECISIONE_REGISTRABILE.includes('valutata'));

console.log('\nApprovazione chiusura (doppia approvazione tra i tre ruoli)');
check('una sola approvazione non chiude il processo',
  !S.approvazioniSufficienti({ prodotto: null, coo: '2026-06-11', dir: null }));
check('COO + Direttore chiudono il processo',
  S.approvazioniSufficienti({ prodotto: null, coo: '2026-06-11', dir: '2026-06-11' }));
check('Prodotto + COO chiudono il processo',
  S.approvazioniSufficienti({ prodotto: '2026-06-11', coo: '2026-06-11', dir: null }));
check('compatibile con decisioni esistenti senza chiave prodotto',
  S.approvazioniSufficienti({ coo: '2026-06-11', dir: '2026-06-11' }));

console.log('\nRegole di avanzamento gate');
const s = S.DB.schede[0];
check('nessun gate completo a scheda nuova', !S.tuttiGateCompleti(s));
for (const gid of Object.keys(S.GATES)) {
  for (const cid of Object.keys(S.GATES[gid].criteri)) {
    s.gates[gid][cid] = { risposta: 'si', note: '', utente: 'Tester', data: S.nowISO() };
  }
}
check('tutti i gate completi dopo la compilazione', S.tuttiGateCompleti(s));
s.gates.g1.standard = { risposta: 'no', note: '' };
check('criterio "No" senza nota segnalato come nota mancante', S.notaMancante(s.gates.g1.standard));
s.gates.g1.standard.note = 'Motivazione presente';
check('criterio "No" con nota non segnalato', !S.notaMancante(s.gates.g1.standard));

console.log('\nRischi aperti');
check('rischio mitigato conta come aperto', S.haRischiAperti(s));
s.rischi[0].gestione = 'Eliminato';
check('rischio eliminato non conta come aperto', !S.haRischiAperti(s));

console.log(`\nEsito: ${passed} ok, ${failed} falliti\n`);
process.exit(failed ? 1 : 0);
