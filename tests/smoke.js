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
  '({ DB, GATES, schedaVuota, validaScheda, can, tuttiGateCompleti, notaMancante, haRischiAperti, nowISO })',
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

console.log('\nMatrice permessi');
check('R&D non compila il Gate Business', !S.can('rd', 'gate1'));
check('Prodotto compila il Gate Business', S.can('prodotto', 'gate1'));
check('Prodotto non compila il Gate R&D', !S.can('prodotto', 'gate2'));
check('R&D compila il Gate R&D', S.can('rd', 'gate2'));
check('tutti i ruoli compilano il Gate Tecnico',
  ['rd', 'prodotto', 'coo', 'dir'].every(r => S.can(r, 'gate3')));
check('solo COO e Direttore approvano la chiusura',
  S.can('coo', 'approvaChiusura') && S.can('dir', 'approvaChiusura') &&
  !S.can('rd', 'approvaChiusura') && !S.can('prodotto', 'approvaChiusura'));
check('Prodotto non crea schede, il Direttore R&D sì',
  !S.can('prodotto', 'creaScheda') && S.can('dir', 'creaScheda'));

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
