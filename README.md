# Schede Contenuto R&D — Gate Decisionali

Web app per la gestione delle **Schede Contenuto R&D**: il team R&D propone nuovi contenuti
(o evoluzioni di contenuti esistenti) compilando una scheda strutturata; il team Prodotto,
il COO e il Direttore R&D li valutano attraverso tre **gate decisionali** fino alla
**decisione finale** e alla chiusura del processo.

## Avvio

L'app è statica, senza dipendenze e senza build step:

```bash
# opzione 1: aprire direttamente il file
open index.html

# opzione 2: servire la cartella
python3 -m http.server 8000
# poi aprire http://localhost:8000
```

I dati sono persistiti nel `localStorage` del browser. Al primo avvio viene caricata una
scheda dimostrativa. Per ripartire da zero: `localStorage.removeItem('rdcontent_db_v1')`
nella console del browser.

## Simulazione dei ruoli

In alto a destra un selettore permette di impersonare i quattro attori: **Team R&D**,
**Team Prodotto**, **COO**, **Direttore R&D**. Il **Team Prodotto ha gli stessi permessi
di COO e Direttore R&D** (unione dei permessi dei due ruoli):

| Funzione | R&D | Prodotto | COO | Direttore R&D |
|---|---|---|---|---|
| Creare / modificare / sottoscrivere scheda | ✅ | ✅ | — | ✅ |
| Gate 1 — Business Fit e Usability | — | ✅ | ✅ | ✅ |
| Gate 2 — Validità agronomica e scientifica | ✅ | ✅ | ✅ | ✅ |
| Gate 3 — Fattibilità tecnica | ✅ | ✅ | ✅ | ✅ |
| Richiedere integrazione | — | ✅ | ✅ | ✅ |
| Registrare decisione finale | — | ✅ | ✅ | ✅ |
| Approvare chiusura | — | ✅ | ✅ | ✅ |

## Flusso di processo

```
Bozza ──sottoscrizione──▶ Sottoscritta da R&D ──compilazione gate──▶ In valutazione
                                   │                                      │
                                   └────────── In richiesta ◀─────────────┘
                                               integrazione ──reinvio──▶ In valutazione
                                                                          │
                                              tutti i criteri compilati  ▼
        Chiusa ◀── 2 approvazioni tra ──────── Decisione finale ◀──── Valutata
                   Prodotto / COO / Dir R&D    presa            (o direttamente da
                                                                "Sottoscritta" /
                                                                "In valutazione")
```

- **Sottoscrizione**: valida tutti i campi obbligatori (inclusa la retrocompatibilità
  per le evoluzioni e l'azione per i rischi mitigati), blocca la scheda, registra data/ora/
  utente e notifica gli altri ruoli.
- **Gate decisionali — mai bloccanti**: ogni criterio accetta Sì / No / Non applicabile più
  una nota. Le risposte (anche "No", "N/A" o mancanti) **non bloccano mai il passaggio allo
  step successivo**: la decisione finale è registrabile in qualunque momento dagli stati
  *Sottoscritta da R&D*, *In valutazione* o *Valutata*. Il sistema evidenzia comunque i
  criteri non compilati, le risposte critiche e le note mancanti, e mostra un avviso non
  bloccante se si registra la decisione con criteri incompleti. Lo stato *Valutata* viene
  comunque raggiunto automaticamente quando tutti i criteri sono compilati.
- **Richiesta integrazione** (Prodotto/COO/Dir R&D): indica le sezioni da integrare con nota
  obbligatoria; chi integra può modificare **solo** le sezioni richieste e reinvia la scheda
  in valutazione.
- **Decisione finale**: scelta tra *Ingegnerizzazione*, *Business Validation*, *R&D
  Validation*, *No go*, con motivazione, owner del prossimo step, azione successiva e
  deadline opzionale.
- **Chiusura**: richiede **2 approvazioni distinte** tra i tre ruoli autorizzati (Team
  Prodotto, COO, Direttore R&D); alla seconda approvazione la scheda passa a *Chiusa* e
  diventa immodificabile. (Con i permessi originali equivaleva a COO + Direttore R&D; la
  regola "2 su 3" estende la parità al Team Prodotto mantenendo la doppia approvazione.)

## Funzionalità trasversali

- **Audit trail** per scheda: creazione, modifiche campo per campo (valore precedente →
  nuovo valore), sottoscrizione, compilazione gate, richieste di integrazione, decisione
  finale, approvazioni e chiusura — con utente, ruolo, data e ora.
- **Notifiche** in-app per ruolo (campanella) per tutti gli eventi previsti; cliccando una
  notifica si apre la scheda relativa.
- **Vista elenco** con filtri espliciti (applicati con "Cerca", azzerati con "Reimposta"),
  esportazione CSV del set filtrato, colonna azione "Apri" per riga, paginazione sticky
  ("Pagina X di Y | N elementi", 10 righe per pagina) e stato vuoto "Nessun risultato".

## Design system

L'interfaccia segue le linee guida UI del progetto (P0–P2):

- **Layout cardless** in stile Linear: sezioni con separatori sottili, gerarchia calma,
  pochi colori, un solo accento; le superfici "card" restano solo dove la card è
  l'interazione (tabella risultati, righe rischio).
- **Gerarchia bottoni**: un solo `solid primary` per pagina (l'azione che completa il task:
  *Sottoscrivi scheda*, *Cerca*, *Registra decisione finale*); secondarie `outlined`;
  *Nuova scheda* nella toolbar tabella è di tipo `success`; *Apri* di riga è `outlined info`
  con freccia.
- **Vista tabella (P1)**: titolo → area filtri con label visibili → riga azioni filtri
  allineata a sinistra (Cerca primaria) → toolbar tabella (sinistra: Esporta CSV; destra:
  Nuova scheda) → tabella → footer di paginazione sticky.
- **Form (P2)**: breadcrumb, titolo con modalità (Nuova / Modifica / Integrazione), sezioni
  per significato, action bar **sticky in fondo** con azioni allineate a destra e la
  primaria all'estrema destra; label sempre visibili, niente placeholder, dettagli come
  info-text sotto i campi.
- **Semantica colore**: primary = importanza, success = conferma, danger = rischio,
  warning = attenzione; il colore non è mai l'unico indicatore di stato (i criteri critici
  hanno anche flag testuali).

Decisioni documentate (fallback rule): i pulsanti di salvataggio dei singoli gate sono
`outlined primary` (più gate sulla stessa pagina, nessuno deve dominare); la chiusura usa
la regola "2 approvazioni su 3" descritta sopra.

## Struttura del progetto

```
index.html        — shell dell'applicazione (topbar, notifiche, selettore ruolo)
css/style.css     — stile (design system cardless)
js/constants.js   — ruoli, stati, liste valori, criteri dei gate, matrice permessi
js/store.js       — persistenza localStorage e dato dimostrativo iniziale
js/app.js         — rendering, validazioni, transizioni di stato, audit, notifiche
tests/smoke.js    — smoke test della logica di dominio (node tests/smoke.js)
```

## Note di implementazione

Questa è una demo single-user che simula i ruoli lato client: in un deployment reale
autenticazione, autorizzazione, persistenza e notifiche andrebbero spostate su un backend.
La logica di dominio (stati, permessi, validazioni, criteri dei gate) è isolata in
`constants.js` ed è pensata per essere portata su un'API senza modifiche concettuali.
