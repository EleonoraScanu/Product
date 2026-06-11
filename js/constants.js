/* ============================================================
   Costanti di dominio: ruoli, stati, liste valori, criteri gate,
   matrice permessi.
   ============================================================ */

const RUOLI = {
  rd:       { label: 'Team R&D',       utente: 'Utente R&D' },
  prodotto: { label: 'Team Prodotto',  utente: 'Utente Prodotto' },
  coo:      { label: 'COO',            utente: 'COO' },
  dir:      { label: 'Direttore R&D',  utente: 'Direttore R&D' },
};

const STATI = {
  bozza:          'Bozza',
  sottoscritta:   'Sottoscritta da R&D',
  in_valutazione: 'In valutazione',
  integrazione:   'In richiesta integrazione',
  valutata:       'Valutata',
  decisione:      'Decisione finale presa',
  chiusa:         'Chiusa',
};

const DECISIONI = {
  ingegnerizzazione:   { label: 'Ingegnerizzazione',   desc: 'Il contenuto è pronto per essere trasformato in prodotto/software' },
  business_validation: { label: 'Business Validation', desc: 'Il contenuto è interessante, ma richiede validazione di mercato/business' },
  rd_validation:       { label: 'R&D Validation',      desc: 'Il contenuto richiede ulteriore validazione tecnica, scientifica o agronomica' },
  no_go:               { label: 'No go',               desc: 'Il contenuto non deve proseguire' },
};

/* ---- Liste valori dei campi scheda ---- */

const LV = {
  tipoContenuto: ['Algoritmo', 'Dati'],
  novita: ['Nuovo', 'Evoluzione esistente'],
  targetCliente: ['Azienda agricola', 'Banca', 'Assicurazione', 'Capo filiera', 'Consorzio', 'Cooperativa', 'CAA', 'Altro'],
  targetUtente: ['Imprenditore agricolo', 'Addetto qualità', 'Agronomo', 'Altro'],
  tipoProblema: ['Agronomico', 'Operativo', 'Normativo', 'Gestionale'],
  geografie: ['Italia', 'Europa', 'Mondo'],
  affidabilita: ['Alta', 'Media', 'Bassa'],
  frequenzaSuggerimenti: ['Tempo reale', 'Giornaliera', 'Settimanale', 'Mensile', 'Stagionale', 'Annuale'],
  retrocompatibilita: ['Sì', 'No', 'Non applicabile'],
  tipoRischio: ['Dati mancanti', 'Performance', 'Use case non chiaro', 'Retrocompatibilità', 'Altro'],
  gestioneRischio: ['Accettato', 'Mitigato', 'Trasferito', 'Eliminato'],
};

/* ---- Sezioni della scheda (usate per le richieste di integrazione) ---- */

const SEZIONI = {
  contenuto: 'Contenuto',
  business: 'Business case',
  tecnica: 'Caratteristiche tecniche',
  rischi: 'Rischi',
};

/* ---- Gate decisionali e criteri ---- */

const GATES = {
  g1: {
    nome: 'Gate 1 — Business Fit e Usability',
    criteri: {
      standard:   'Prodotto standard, utilizzabile da più clienti',
      target:     'Target chiaro',
      problema:   'Problema concreto e rilevante risolto',
      ricavi:     'Leva per nuovi ricavi',
      retention:  'Elemento di retention',
      fruibilita: 'Contenuti fruibili dal target',
    },
  },
  g2: {
    nome: 'Gate 2 — Validità agronomica e scientifica',
    criteri: {
      teoria:      'Teoria scientifica chiara e documentata',
      validazione: 'Validazione minima effettuata',
      fonti:       'Fonti dati note e reperibili',
      algoritmo:   'Algoritmo codificato',
      output:      'Output atteso codificato',
      dataset:     'Set dati completo',
    },
  },
  g3: {
    nome: 'Gate 3 — Fattibilità tecnica ingegnerizzazione',
    criteri: {
      inputAuto:   'Input reperibili in modo automatizzato',
      outputAuto:  'Output elaborabile in modo automatizzato',
      retro:       'Integrazione retrocompatibile',
      performance: 'Performance stimate in linea con standard di prodotto',
      frequenza:   'Frequenza di aggiornamento chiara e sostenibile',
      errori:      'Gestione errori chiara',
      security:    'Nessun issue di security & privacy',
      costi:       'Costi infrastrutturali sostenibili',
    },
  },
};

const RISPOSTE_GATE = { si: 'Sì', no: 'No', na: 'Non applicabile' };

/* ---- Matrice permessi ----
   Il Team Prodotto ha gli stessi permessi di COO e Direttore R&D
   (unione dei permessi dei due ruoli). */

const PERMESSI = {
  creaScheda:           ['rd', 'prodotto', 'dir'],
  modificaBozza:        ['rd', 'prodotto', 'dir'],
  sottoscrivi:          ['rd', 'prodotto', 'dir'],
  gate1:                ['prodotto', 'coo', 'dir'],
  gate2:                ['rd', 'prodotto', 'coo', 'dir'],
  gate3:                ['rd', 'prodotto', 'coo', 'dir'],
  decisioneFinale:      ['prodotto', 'coo', 'dir'],
  approvaChiusura:      ['prodotto', 'coo', 'dir'],
  richiediIntegrazione: ['prodotto', 'coo', 'dir'],
  integraScheda:        ['rd', 'prodotto', 'dir'],
};

function can(role, perm) {
  return (PERMESSI[perm] || []).includes(role);
}

const GATE_PERM = { g1: 'gate1', g2: 'gate2', g3: 'gate3' };

/* Stati in cui i gate sono compilabili (sezione 7 dei requisiti) */
const STATI_GATE_EDITABILI = ['sottoscritta', 'in_valutazione'];

/* Stati in cui la decisione finale è registrabile: le risposte dei gate
   (anche mancanti, "No" o "N/A") non bloccano mai il passaggio allo step
   successivo — vengono solo evidenziate. */
const STATI_DECISIONE_REGISTRABILE = ['sottoscritta', 'in_valutazione', 'valutata'];

/* Ruoli abilitati ad approvare la chiusura: il processo si chiude con
   almeno due approvazioni distinte (doppia approvazione). */
const RUOLI_APPROVATORI = ['prodotto', 'coo', 'dir'];
const APPROVAZIONI_RICHIESTE = 2;

function approvazioniSufficienti(appr) {
  return RUOLI_APPROVATORI.filter(r => appr && appr[r]).length >= APPROVAZIONI_RICHIESTE;
}

/* Stati in cui è possibile richiedere integrazione */
const STATI_INTEGRAZIONE_RICHIEDIBILE = ['sottoscritta', 'in_valutazione', 'valutata'];
