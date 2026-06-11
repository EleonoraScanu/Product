/* ============================================================
   Persistenza su localStorage: schede, notifiche, ruolo corrente.
   ============================================================ */

const STORE_KEY = 'rdcontent_db_v1';

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function nowISO() {
  return new Date().toISOString();
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* db corrotto: si riparte dal seed */ }
  const db = seedDB();
  saveDB(db);
  return db;
}

function saveDB(db) {
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
}

function schedaVuota(creataDa, ruolo) {
  return {
    id: uid(),
    stato: 'bozza',
    contenuto: { nome: '', tipo: '', novita: '' },
    business: { targetCliente: [], targetUtente: [], tipoProblema: [], descrizioneProblema: '', colture: '', geografie: [] },
    tecnica: { input: '', output: '', affidabilita: '', frequenza: '', retrocompatibilita: '' },
    rischi: [],
    gates: { g1: {}, g2: {}, g3: {} },
    decisione: null,
    integrazione: null,
    owner: creataDa,
    creataDa: creataDa,
    ruoloCreatore: ruolo,
    dataCreazione: nowISO(),
    dataSottoscrizione: null,
    sottoscrittaDa: null,
    ultimoAggiornamento: nowISO(),
    audit: [],
  };
}

/* Scheda dimostrativa precaricata al primo avvio */
function seedDB() {
  const s = schedaVuota(RUOLI.rd.utente, 'rd');
  s.contenuto = { nome: 'Indice di stress idrico vigneto', tipo: 'Algoritmo', novita: 'Nuovo' };
  s.business = {
    targetCliente: ['Azienda agricola', 'Consorzio'],
    targetUtente: ['Agronomo', 'Imprenditore agricolo'],
    tipoProblema: ['Agronomico', 'Operativo'],
    descrizioneProblema: 'Le aziende vitivinicole non dispongono di un indicatore sintetico dello stress idrico a livello di appezzamento; le decisioni di irrigazione sono basate su osservazioni empiriche, con sprechi idrici e perdite di resa.',
    colture: 'Vite da vino',
    geografie: ['Italia', 'Europa'],
  };
  s.tecnica = {
    input: 'Dati meteo orari (precipitazioni, temperatura, ET0), indici satellitari NDVI/NDMI, caratteristiche del suolo da mappa pedologica.',
    output: 'Indice di stress idrico 0-100 per appezzamento, con soglia di allerta e suggerimento di intervento irriguo.',
    affidabilita: 'Media',
    frequenza: 'Giornaliera',
    retrocompatibilita: '',
  };
  s.rischi = [
    {
      tipo: 'Dati mancanti',
      descrizione: 'Le mappe pedologiche non coprono tutte le aree target con sufficiente risoluzione.',
      gestione: 'Mitigato',
      owner: 'Utente R&D',
      azione: 'Definire un profilo suolo di default per area climatica come fallback.',
      deadline: '2026-07-31',
    },
  ];
  s.audit.push({
    utente: RUOLI.rd.utente,
    ruolo: 'rd',
    data: s.dataCreazione,
    azione: 'Creazione scheda',
    prima: null,
    dopo: 'Bozza',
  });
  return {
    schede: [s],
    notifiche: [],
  };
}
