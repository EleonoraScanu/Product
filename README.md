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

In alto a destra un selettore permette di impersonare i quattro attori previsti:
**Team R&D**, **Team Prodotto**, **COO**, **Direttore R&D**. Permessi, notifiche e azioni
disponibili cambiano di conseguenza, secondo la matrice dei requisiti (sez. 13):

| Funzione | R&D | Prodotto | COO | Direttore R&D |
|---|---|---|---|---|
| Creare / modificare / sottoscrivere scheda | ✅ | — | — | ✅ |
| Gate 1 — Business Fit e Usability | — | ✅ | ✅ | ✅ |
| Gate 2 — Validità agronomica e scientifica | ✅ | — | ✅ | ✅ |
| Gate 3 — Fattibilità tecnica | ✅ | ✅ | ✅ | ✅ |
| Richiedere integrazione | — | ✅ | ✅ | ✅ |
| Registrare decisione finale | — | ✅ | ✅ | ✅ |
| Approvare chiusura | — | — | ✅ | ✅ |

## Flusso di processo

```
Bozza ──sottoscrizione──▶ Sottoscritta da R&D ──compilazione gate──▶ In valutazione
                                   │                                      │
                                   └────────── In richiesta ◀─────────────┘
                                               integrazione ──reinvio──▶ In valutazione
                                                                          │
                                              tutti i criteri compilati  ▼
        Chiusa ◀──approvazione COO + Dir R&D── Decisione finale ◀──── Valutata
                                               presa
```

- **Sottoscrizione** (R&D): valida tutti i campi obbligatori (inclusa la retrocompatibilità
  per le evoluzioni e l'azione per i rischi mitigati), blocca la scheda, registra data/ora/
  utente e notifica Prodotto, COO e Direttore R&D.
- **Gate decisionali**: compilabili solo negli stati *Sottoscritta da R&D* e *In valutazione*,
  ciascuno dal ruolo abilitato. Ogni criterio accetta Sì / No / Non applicabile più una nota.
  Il sistema evidenzia i criteri non compilati, le risposte "No" e "N/A" e le note mancanti
  sui criteri critici (risposte No / N/A senza motivazione).
- **Valutata**: raggiunta automaticamente quando tutti i criteri dei tre gate sono compilati.
- **Richiesta integrazione** (Prodotto/COO/Dir R&D): indica le sezioni da integrare con nota
  obbligatoria; R&D può modificare **solo** le sezioni richieste e reinvia la scheda in
  valutazione (notifica ai valutatori).
- **Decisione finale** (Prodotto/COO/Dir R&D): scelta tra *Ingegnerizzazione*, *Business
  Validation*, *R&D Validation*, *No go*, con motivazione, owner del prossimo step, azione
  successiva e deadline opzionale.
- **Chiusura**: richiede l'approvazione sia del COO sia del Direttore R&D; alla seconda
  approvazione la scheda passa a *Chiusa* e diventa immodificabile.

## Funzionalità trasversali

- **Audit trail** per scheda: creazione, modifiche campo per campo (valore precedente →
  nuovo valore), sottoscrizione, compilazione gate, richieste di integrazione, decisione
  finale, approvazioni e chiusura — con utente, ruolo, data e ora.
- **Notifiche** in-app per ruolo (campanella in alto a destra) per tutti gli eventi previsti
  dai requisiti (sez. 11); cliccando una notifica si apre la scheda relativa.
- **Vista elenco** con tutte le colonne richieste e filtri per stato, tipo contenuto,
  target cliente, decisione finale, owner, data creazione e "contenuti con rischi aperti"
  (rischi con gestione *Mitigato* o *Trasferito*, che richiedono ancora azioni).

## Struttura del progetto

```
index.html        — shell dell'applicazione (topbar, notifiche, selettore ruolo)
css/style.css     — stile
js/constants.js   — ruoli, stati, liste valori, criteri dei gate, matrice permessi
js/store.js       — persistenza localStorage e dato dimostrativo iniziale
js/app.js         — rendering, validazioni, transizioni di stato, audit, notifiche
```

## Note di implementazione

Questa è una demo single-user che simula i ruoli lato client: in un deployment reale
autenticazione, autorizzazione, persistenza e notifiche andrebbero spostate su un backend.
La logica di dominio (stati, permessi, validazioni, criteri dei gate) è isolata in
`constants.js` ed è pensata per essere portata su un'API senza modifiche concettuali.
