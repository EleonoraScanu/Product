/* ============================================================
   Applicazione: routing, rendering, logica di processo.
   ============================================================ */

let DB = loadDB();

const ui = {
  view: 'list',           // 'list' | 'form' | 'detail'
  schedaId: null,
  tab: 'scheda',          // tab attiva nel dettaglio
  role: localStorage.getItem('rdcontent_role') || 'rd',
  filtri: { stato: '', tipo: '', targetCliente: '', decisione: '', owner: '', dataCreazione: '', rischiAperti: false },
  integrazioneMode: false, // form aperto in modalità integrazione
  showIntegrazionePanel: false,
  draft: null,             // copia di lavoro della scheda nel form (scartata con "Annulla")
};

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

/* ------------------------------------------------------------
   Utility
   ------------------------------------------------------------ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtData(iso, conOra = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const data = d.toLocaleDateString('it-IT');
  return conOra && iso.includes('T') ? data + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : data;
}

function utenteCorrente() {
  return RUOLI[ui.role].utente;
}

function getScheda(id) {
  return DB.schede.find(s => s.id === id);
}

function touch(scheda) {
  scheda.ultimoAggiornamento = nowISO();
  saveDB(DB);
}

/* ------------------------------------------------------------
   Audit trail e notifiche
   ------------------------------------------------------------ */

function logAudit(scheda, azione, prima = null, dopo = null) {
  scheda.audit.push({
    utente: utenteCorrente(),
    ruolo: ui.role,
    data: nowISO(),
    azione,
    prima,
    dopo,
  });
}

function notifica(destinatari, messaggio, scheda) {
  DB.notifiche.unshift({
    id: uid(),
    data: nowISO(),
    schedaId: scheda.id,
    schedaNome: scheda.contenuto.nome || '(senza nome)',
    messaggio,
    destinatari,
    letti: [],
  });
}

function notificheRuolo() {
  return DB.notifiche.filter(n => n.destinatari.includes(ui.role));
}

function notificheNonLette() {
  return notificheRuolo().filter(n => !n.letti.includes(ui.role));
}

/* ------------------------------------------------------------
   Validazione campi obbligatori (alla sottoscrizione)
   ------------------------------------------------------------ */

function validaScheda(s) {
  const errori = [];
  const c = s.contenuto, b = s.business, t = s.tecnica;

  if (!c.nome.trim()) errori.push('Contenuto: "Nome contenuto" è obbligatorio.');
  if (!c.tipo) errori.push('Contenuto: "Tipo contenuto" è obbligatorio.');
  if (!c.novita) errori.push('Contenuto: "Nuovo / Evoluzione esistente" è obbligatorio.');

  if (!b.targetCliente.length) errori.push('Business case: selezionare almeno un "Target cliente".');
  if (!b.targetUtente.length) errori.push('Business case: selezionare almeno un "Target utente".');
  if (!b.tipoProblema.length) errori.push('Business case: selezionare almeno un "Tipo problema risolto".');
  if (!b.descrizioneProblema.trim()) errori.push('Business case: "Descrizione problema risolto" è obbligatoria.');
  if (!b.geografie.length) errori.push('Business case: selezionare almeno una "Geografia".');

  if (!t.input.trim()) errori.push('Caratteristiche tecniche: "Input" è obbligatorio.');
  if (!t.output.trim()) errori.push('Caratteristiche tecniche: "Output" è obbligatorio.');
  if (!t.affidabilita) errori.push('Caratteristiche tecniche: "Affidabilità algoritmo" è obbligatoria.');
  if (!t.frequenza.trim()) errori.push('Caratteristiche tecniche: "Frequenza aggiornamento dati" è obbligatoria.');
  if (c.novita === 'Evoluzione esistente' && !t.retrocompatibilita) {
    errori.push('Caratteristiche tecniche: "Retrocompatibilità" è obbligatoria per le evoluzioni di contenuti esistenti.');
  }

  s.rischi.forEach((r, i) => {
    const n = i + 1;
    if (!r.tipo) errori.push(`Rischio ${n}: "Tipo rischio" è obbligatorio.`);
    if (!r.descrizione.trim()) errori.push(`Rischio ${n}: "Descrizione rischio" è obbligatoria.`);
    if (!r.gestione) errori.push(`Rischio ${n}: "Gestione rischio" è obbligatoria.`);
    if (!r.owner.trim()) errori.push(`Rischio ${n}: "Owner" è obbligatorio.`);
    if (r.gestione === 'Mitigato' && !r.azione.trim()) errori.push(`Rischio ${n}: "Azione" è obbligatoria per i rischi mitigati.`);
  });

  return errori;
}

/* Un rischio è "aperto" se la gestione richiede ancora azioni (mitigato/trasferito) */
function haRischiAperti(s) {
  return s.rischi.some(r => r.gestione === 'Mitigato' || r.gestione === 'Trasferito');
}

/* ------------------------------------------------------------
   Stato gate / valutazione
   ------------------------------------------------------------ */

function gateCompleto(s, gid) {
  return Object.keys(GATES[gid].criteri).every(k => s.gates[gid][k] && s.gates[gid][k].risposta);
}

function tuttiGateCompleti(s) {
  return Object.keys(GATES).every(gid => gateCompleto(s, gid));
}

function criterioCritico(val) {
  return val && (val.risposta === 'no' || val.risposta === 'na');
}

function notaMancante(val) {
  return criterioCritico(val) && !(val.note || '').trim();
}

function conteggioGate(s, gid) {
  const keys = Object.keys(GATES[gid].criteri);
  const compilati = keys.filter(k => s.gates[gid][k] && s.gates[gid][k].risposta).length;
  return { compilati, totale: keys.length };
}

/* ============================================================
   RENDERING
   ============================================================ */

function render() {
  const app = document.getElementById('app');
  if (ui.view === 'list') app.innerHTML = renderList();
  else if (ui.view === 'form') app.innerHTML = renderForm();
  else if (ui.view === 'detail') app.innerHTML = renderDetail();
  renderNotifiche();
  window.scrollTo(0, 0);
}

function renderNotifiche() {
  const badge = document.getElementById('notif-badge');
  const panel = document.getElementById('notif-panel');
  const nonLette = notificheNonLette().length;
  badge.textContent = nonLette;
  badge.classList.toggle('hidden', nonLette === 0);

  const liste = notificheRuolo().slice(0, 30);
  panel.innerHTML = liste.length
    ? liste.map(n => `
        <div class="notif-item ${n.letti.includes(ui.role) ? '' : 'unread'}" onclick="App.apriNotifica('${n.id}')">
          <div class="notif-msg">${esc(n.messaggio)}</div>
          <div class="notif-meta">${esc(n.schedaNome)} · ${fmtData(n.data)}</div>
        </div>`).join('')
    : '<div class="notif-empty">Nessuna notifica per questo ruolo.</div>';
}

/* ---------------- Badge helpers ---------------- */

function badgeStato(stato) {
  return `<span class="badge stato-${stato}">${esc(STATI[stato])}</span>`;
}

function badgeDecisione(dec) {
  if (!dec) return '<span class="muted">—</span>';
  return `<span class="badge dec-${dec}">${esc(DECISIONI[dec].label)}</span>`;
}

/* ---------------- Vista elenco ---------------- */

function renderList() {
  const f = ui.filtri;
  let schede = DB.schede.slice();

  if (f.stato) schede = schede.filter(s => s.stato === f.stato);
  if (f.tipo) schede = schede.filter(s => s.contenuto.tipo === f.tipo);
  if (f.targetCliente) schede = schede.filter(s => s.business.targetCliente.includes(f.targetCliente));
  if (f.decisione) schede = schede.filter(s => s.decisione && s.decisione.scelta === f.decisione);
  if (f.owner) schede = schede.filter(s => s.owner.toLowerCase().includes(f.owner.toLowerCase()));
  if (f.dataCreazione) schede = schede.filter(s => s.dataCreazione.slice(0, 10) === f.dataCreazione);
  if (f.rischiAperti) schede = schede.filter(haRischiAperti);

  schede.sort((a, b) => b.ultimoAggiornamento.localeCompare(a.ultimoAggiornamento));

  const righe = schede.map(s => `
    <tr onclick="App.apriScheda('${s.id}')">
      <td><strong>${esc(s.contenuto.nome) || '<em>(senza nome)</em>'}</strong></td>
      <td>${esc(s.contenuto.tipo) || '—'}</td>
      <td>${esc(s.contenuto.novita) || '—'}</td>
      <td class="small">${esc(s.business.targetCliente.join(', ')) || '—'}</td>
      <td>${badgeStato(s.stato)}</td>
      <td>${badgeDecisione(s.decisione && s.decisione.scelta)}</td>
      <td>${esc(s.owner)}</td>
      <td class="small">${fmtData(s.dataCreazione, false)}</td>
      <td class="small">${fmtData(s.dataSottoscrizione, false)}</td>
      <td class="small">${fmtData(s.ultimoAggiornamento)}</td>
    </tr>`).join('');

  return `
    <div class="page-head">
      <h2>Elenco Schede Contenuto</h2>
      ${can(ui.role, 'creaScheda') ? `<button class="btn primary" onclick="App.nuovaScheda()">+ Nuova Scheda Contenuto</button>` : ''}
    </div>

    <div class="filters card">
      <div class="filter-grid">
        <label>Stato
          <select onchange="App.setFiltro('stato', this.value)">
            <option value="">Tutti</option>
            ${Object.entries(STATI).map(([k, v]) => `<option value="${k}" ${f.stato === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Tipo contenuto
          <select onchange="App.setFiltro('tipo', this.value)">
            <option value="">Tutti</option>
            ${LV.tipoContenuto.map(v => `<option ${f.tipo === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Target cliente
          <select onchange="App.setFiltro('targetCliente', this.value)">
            <option value="">Tutti</option>
            ${LV.targetCliente.map(v => `<option ${f.targetCliente === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Decisione finale
          <select onchange="App.setFiltro('decisione', this.value)">
            <option value="">Tutte</option>
            ${Object.entries(DECISIONI).map(([k, v]) => `<option value="${k}" ${f.decisione === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </label>
        <label>Owner
          <input type="text" value="${esc(f.owner)}" placeholder="Cerca owner…" onchange="App.setFiltro('owner', this.value)">
        </label>
        <label>Data creazione
          <input type="date" value="${esc(f.dataCreazione)}" onchange="App.setFiltro('dataCreazione', this.value)">
        </label>
        <label class="check-inline">
          <input type="checkbox" ${f.rischiAperti ? 'checked' : ''} onchange="App.setFiltro('rischiAperti', this.checked)">
          Solo contenuti con rischi aperti
        </label>
      </div>
    </div>

    <div class="card table-wrap">
      <table class="lista">
        <thead>
          <tr>
            <th>Nome contenuto</th><th>Tipo</th><th>Nuovo / Evoluzione</th><th>Target cliente</th>
            <th>Stato</th><th>Decisione finale</th><th>Owner</th>
            <th>Creazione</th><th>Sottoscrizione</th><th>Ultimo agg.</th>
          </tr>
        </thead>
        <tbody>${righe || '<tr><td colspan="10" class="empty">Nessuna scheda corrisponde ai filtri.</td></tr>'}</tbody>
      </table>
    </div>`;
}

/* ---------------- Form scheda (bozza o integrazione) ---------------- */

function sezioneEditabile(s, sez) {
  if (!ui.integrazioneMode) return true;
  return s.integrazione && s.integrazione.attiva && s.integrazione.sezioni.includes(sez);
}

function multiselect(name, opzioni, selezionati, disabled) {
  return `<div class="checks ${disabled ? 'disabled' : ''}">` + opzioni.map(o => `
    <label class="check-inline"><input type="checkbox" name="${name}" value="${esc(o)}"
      ${selezionati.includes(o) ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${esc(o)}</label>`).join('') + '</div>';
}

function renderForm() {
  const s = ui.draft;
  if (!s) return '<div class="card">Scheda non trovata.</div>';
  const integ = ui.integrazioneMode;
  const c = s.contenuto, b = s.business, t = s.tecnica;

  const editC = sezioneEditabile(s, 'contenuto');
  const editB = sezioneEditabile(s, 'business');
  const editT = sezioneEditabile(s, 'tecnica');
  const editR = sezioneEditabile(s, 'rischi');
  const dis = ok => ok ? '' : 'disabled';

  const bannerInteg = integ ? `
    <div class="alert warning">
      <strong>Modalità integrazione.</strong> Richiesta da ${esc(s.integrazione.richiestaDa)} il ${fmtData(s.integrazione.data)}.<br>
      Sezioni da integrare: <strong>${s.integrazione.sezioni.map(z => SEZIONI[z]).join(', ')}</strong>.<br>
      Nota: <em>${esc(s.integrazione.nota)}</em><br>
      Sono modificabili solo le sezioni richieste; al termine usa "Salva e reinvia in valutazione".
    </div>` : '';

  return `
    <div class="page-head">
      <h2>${integ ? 'Integrazione Scheda Contenuto' : (ui.schedaId ? 'Modifica Scheda Contenuto' : 'Nuova Scheda Contenuto')}</h2>
      <button class="btn" onclick="App.annullaForm()">← Annulla</button>
    </div>
    ${bannerInteg}
    <form id="scheda-form" onsubmit="return false;">

      <fieldset class="card ${editC ? '' : 'sezione-bloccata'}">
        <legend>Contenuto ${editC ? '' : '🔒'}</legend>
        <div class="form-grid">
          <label>Nome contenuto <span class="req">*</span>
            <input type="text" name="nome" value="${esc(c.nome)}" ${dis(editC)}>
          </label>
          <label>Tipo contenuto <span class="req">*</span>
            <select name="tipo" ${dis(editC)}>
              <option value="">— Seleziona —</option>
              ${LV.tipoContenuto.map(v => `<option ${c.tipo === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label>Nuovo / Evoluzione esistente <span class="req">*</span>
            <select name="novita" ${dis(editC)} onchange="App.toggleRetro(this.value)">
              <option value="">— Seleziona —</option>
              ${LV.novita.map(v => `<option ${c.novita === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset class="card ${editB ? '' : 'sezione-bloccata'}">
        <legend>Business case ${editB ? '' : '🔒'}</legend>
        <div class="form-grid">
          <label class="full">Target cliente <span class="req">*</span>
            ${multiselect('targetCliente', LV.targetCliente, b.targetCliente, !editB)}
          </label>
          <label class="full">Target utente <span class="req">*</span>
            ${multiselect('targetUtente', LV.targetUtente, b.targetUtente, !editB)}
          </label>
          <label class="full">Tipo problema risolto <span class="req">*</span>
            ${multiselect('tipoProblema', LV.tipoProblema, b.tipoProblema, !editB)}
          </label>
          <label class="full">Descrizione problema risolto <span class="req">*</span>
            <textarea name="descrizioneProblema" rows="4" ${dis(editB)}>${esc(b.descrizioneProblema)}</textarea>
          </label>
          <label>Colture <span class="opt">(facoltativo)</span>
            <input type="text" name="colture" value="${esc(b.colture)}" placeholder="es. Vite, Mais, Pomodoro…" ${dis(editB)}>
          </label>
          <label class="full">Geografie <span class="req">*</span>
            ${multiselect('geografie', LV.geografie, b.geografie, !editB)}
          </label>
        </div>
      </fieldset>

      <fieldset class="card ${editT ? '' : 'sezione-bloccata'}">
        <legend>Caratteristiche tecniche ${editT ? '' : '🔒'}</legend>
        <div class="form-grid">
          <label class="full">Input <span class="req">*</span>
            <textarea name="input" rows="3" ${dis(editT)}>${esc(t.input)}</textarea>
          </label>
          <label class="full">Output <span class="req">*</span>
            <textarea name="output" rows="3" ${dis(editT)}>${esc(t.output)}</textarea>
          </label>
          <label>Affidabilità algoritmo <span class="req">*</span>
            <select name="affidabilita" ${dis(editT)}>
              <option value="">— Seleziona —</option>
              ${LV.affidabilita.map(v => `<option ${t.affidabilita === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
          <label>Frequenza aggiornamento dati <span class="req">*</span>
            <input type="text" name="frequenza" value="${esc(t.frequenza)}" list="freq-list" ${dis(editT)}>
            <datalist id="freq-list">${LV.frequenzaSuggerimenti.map(v => `<option value="${v}">`).join('')}</datalist>
          </label>
          <label id="retro-field" class="${c.novita === 'Evoluzione esistente' ? '' : 'hidden'}">
            Retrocompatibilità <span class="req">*</span> <span class="opt">(per evoluzioni)</span>
            <select name="retrocompatibilita" ${dis(editT)}>
              <option value="">— Seleziona —</option>
              ${LV.retrocompatibilita.map(v => `<option ${t.retrocompatibilita === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset class="card ${editR ? '' : 'sezione-bloccata'}">
        <legend>Rischi ${editR ? '' : '🔒'}</legend>
        <div id="rischi-rows">
          ${s.rischi.map((r, i) => rischioRow(r, i, editR)).join('')}
        </div>
        ${editR ? `<button type="button" class="btn small-btn" onclick="App.aggiungiRischio()">+ Aggiungi rischio</button>` : ''}
        ${!s.rischi.length ? '<p class="muted">Nessun rischio inserito.</p>' : ''}
      </fieldset>

      <div class="form-actions">
        ${integ
          ? `<button class="btn primary" onclick="App.salvaIntegrazione()">Salva e reinvia in valutazione</button>`
          : `<button class="btn primary" onclick="App.salvaBozza()">Salva bozza</button>
             <button class="btn success" onclick="App.sottoscrivi()">Sottoscrivi scheda</button>`}
        <button class="btn" onclick="App.annullaForm()">Annulla</button>
      </div>
    </form>`;
}

function rischioRow(r, i, editable) {
  const dis = editable ? '' : 'disabled';
  return `
    <div class="rischio-row" data-idx="${i}">
      <div class="rischio-head">
        <strong>Rischio ${i + 1}</strong>
        ${editable ? `<button type="button" class="btn danger small-btn" onclick="App.rimuoviRischio(${i})">Rimuovi</button>` : ''}
      </div>
      <div class="form-grid">
        <label>Tipo rischio <span class="req">*</span>
          <select name="r-tipo-${i}" ${dis}>
            <option value="">— Seleziona —</option>
            ${LV.tipoRischio.map(v => `<option ${r.tipo === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Gestione rischio <span class="req">*</span>
          <select name="r-gestione-${i}" ${dis}>
            <option value="">— Seleziona —</option>
            ${LV.gestioneRischio.map(v => `<option ${r.gestione === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label class="full">Descrizione rischio <span class="req">*</span>
          <textarea name="r-descrizione-${i}" rows="2" ${dis}>${esc(r.descrizione)}</textarea>
        </label>
        <label>Owner <span class="req">*</span>
          <input type="text" name="r-owner-${i}" value="${esc(r.owner)}" ${dis}>
        </label>
        <label>Deadline <span class="opt">(facoltativa)</span>
          <input type="date" name="r-deadline-${i}" value="${esc(r.deadline)}" ${dis}>
        </label>
        <label class="full">Azione <span class="opt">(obbligatoria se rischio mitigato)</span>
          <textarea name="r-azione-${i}" rows="2" ${dis}>${esc(r.azione)}</textarea>
        </label>
      </div>
    </div>`;
}

/* Raccoglie i valori del form dentro la scheda (solo sezioni editabili) */
function leggiForm(s) {
  const form = document.getElementById('scheda-form');
  const val = name => { const e = form.querySelector(`[name="${name}"]`); return e ? e.value : ''; };
  const checks = name => [...form.querySelectorAll(`[name="${name}"]:checked`)].map(e => e.value);

  if (sezioneEditabile(s, 'contenuto')) {
    s.contenuto = { nome: val('nome').trim(), tipo: val('tipo'), novita: val('novita') };
  }
  if (sezioneEditabile(s, 'business')) {
    s.business = {
      targetCliente: checks('targetCliente'),
      targetUtente: checks('targetUtente'),
      tipoProblema: checks('tipoProblema'),
      descrizioneProblema: val('descrizioneProblema'),
      colture: val('colture'),
      geografie: checks('geografie'),
    };
  }
  if (sezioneEditabile(s, 'tecnica')) {
    s.tecnica = {
      input: val('input'),
      output: val('output'),
      affidabilita: val('affidabilita'),
      frequenza: val('frequenza'),
      retrocompatibilita: val('retrocompatibilita'),
    };
  }
  if (sezioneEditabile(s, 'rischi')) {
    const rows = [...form.querySelectorAll('.rischio-row')];
    s.rischi = rows.map((row, i) => ({
      tipo: val(`r-tipo-${i}`),
      descrizione: val(`r-descrizione-${i}`),
      gestione: val(`r-gestione-${i}`),
      owner: val(`r-owner-${i}`),
      azione: val(`r-azione-${i}`),
      deadline: val(`r-deadline-${i}`),
    }));
  }
}

/* Confronto semplice per l'audit: elenco campi modificati */
function diffScheda(prima, dopo) {
  const flat = s => ({
    'Nome contenuto': s.contenuto.nome, 'Tipo contenuto': s.contenuto.tipo, 'Nuovo/Evoluzione': s.contenuto.novita,
    'Target cliente': s.business.targetCliente.join(', '), 'Target utente': s.business.targetUtente.join(', '),
    'Tipo problema': s.business.tipoProblema.join(', '), 'Descrizione problema': s.business.descrizioneProblema,
    'Colture': s.business.colture, 'Geografie': s.business.geografie.join(', '),
    'Input': s.tecnica.input, 'Output': s.tecnica.output, 'Affidabilità': s.tecnica.affidabilita,
    'Frequenza aggiornamento': s.tecnica.frequenza, 'Retrocompatibilità': s.tecnica.retrocompatibilita,
    'Numero rischi': String(s.rischi.length),
  });
  const a = flat(prima), b = flat(dopo);
  return Object.keys(a)
    .filter(k => a[k] !== b[k])
    .map(k => ({ campo: k, prima: a[k], dopo: b[k] }));
}

/* ---------------- Dettaglio scheda ---------------- */

function renderDetail() {
  const s = getScheda(ui.schedaId);
  if (!s) return '<div class="card">Scheda non trovata.</div>';

  const tabs = [
    ['scheda', 'Scheda'],
    ['valutazione', 'Gate decisionali'],
    ['decisione', 'Decisione finale'],
    ['audit', 'Audit trail'],
  ];

  let corpo = '';
  if (ui.tab === 'scheda') corpo = tabScheda(s);
  else if (ui.tab === 'valutazione') corpo = tabValutazione(s);
  else if (ui.tab === 'decisione') corpo = tabDecisione(s);
  else corpo = tabAudit(s);

  return `
    <div class="page-head">
      <div>
        <button class="btn" onclick="App.tornaElenco()">← Elenco</button>
      </div>
      <div class="head-actions">${azioniScheda(s)}</div>
    </div>

    <div class="card detail-head">
      <div>
        <h2>${esc(s.contenuto.nome) || '<em>(senza nome)</em>'}</h2>
        <div class="head-badges">
          ${badgeStato(s.stato)}
          ${s.contenuto.tipo ? `<span class="badge neutro">${esc(s.contenuto.tipo)}</span>` : ''}
          ${s.contenuto.novita ? `<span class="badge neutro">${esc(s.contenuto.novita)}</span>` : ''}
          ${s.decisione ? badgeDecisione(s.decisione.scelta) : ''}
          ${haRischiAperti(s) ? '<span class="badge warn">⚠ Rischi aperti</span>' : ''}
        </div>
      </div>
      <div class="head-meta">
        <div><span class="muted">Owner:</span> ${esc(s.owner)}</div>
        <div><span class="muted">Creata:</span> ${fmtData(s.dataCreazione)} da ${esc(s.creataDa)}</div>
        <div><span class="muted">Sottoscritta:</span> ${s.dataSottoscrizione ? fmtData(s.dataSottoscrizione) + ' da ' + esc(s.sottoscrittaDa) : '—'}</div>
        <div><span class="muted">Ultimo aggiornamento:</span> ${fmtData(s.ultimoAggiornamento)}</div>
      </div>
    </div>

    ${pannelloIntegrazione(s)}

    <nav class="tabs">
      ${tabs.map(([k, v]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" onclick="App.setTab('${k}')">${v}</button>`).join('')}
    </nav>

    ${corpo}`;
}

function azioniScheda(s) {
  const out = [];
  if (s.stato === 'bozza' && can(ui.role, 'modificaBozza')) {
    out.push(`<button class="btn primary" onclick="App.modificaScheda()">✏️ Modifica bozza</button>`);
  }
  if (s.stato === 'integrazione' && can(ui.role, 'integraScheda')) {
    out.push(`<button class="btn primary" onclick="App.apriIntegrazione()">✏️ Integra scheda</button>`);
  }
  if (STATI_INTEGRAZIONE_RICHIEDIBILE.includes(s.stato) && can(ui.role, 'richiediIntegrazione')) {
    out.push(`<button class="btn warning-btn" onclick="App.toggleIntegrazionePanel()">Richiedi integrazione</button>`);
  }
  return out.join(' ');
}

function pannelloIntegrazione(s) {
  let html = '';
  if (s.stato === 'integrazione' && s.integrazione && s.integrazione.attiva) {
    html += `
      <div class="alert warning">
        <strong>Richiesta di integrazione in corso</strong> — da ${esc(s.integrazione.richiestaDa)} il ${fmtData(s.integrazione.data)}.<br>
        Sezioni da integrare: <strong>${s.integrazione.sezioni.map(z => SEZIONI[z]).join(', ')}</strong><br>
        Nota: <em>${esc(s.integrazione.nota)}</em>
      </div>`;
  }
  if (ui.showIntegrazionePanel) {
    html += `
      <div class="card integ-panel">
        <h3>Richiedi integrazione a R&amp;D</h3>
        <p class="muted">La scheda tornerà modificabile da R&amp;D solo nelle sezioni indicate.</p>
        <div class="checks">
          ${Object.entries(SEZIONI).map(([k, v]) => `
            <label class="check-inline"><input type="checkbox" name="integ-sez" value="${k}"> ${v}</label>`).join('')}
        </div>
        <label class="full">Nota per R&amp;D <span class="req">*</span>
          <textarea id="integ-nota" rows="3" placeholder="Indica cosa va chiarito o integrato…"></textarea>
        </label>
        <div class="form-actions">
          <button class="btn warning-btn" onclick="App.inviaRichiestaIntegrazione()">Invia richiesta</button>
          <button class="btn" onclick="App.toggleIntegrazionePanel()">Annulla</button>
        </div>
      </div>`;
  }
  return html;
}

/* ---- Tab "Scheda" (sola lettura) ---- */

function rigaVal(label, valore) {
  return `<div class="ro-row"><div class="ro-label">${label}</div><div class="ro-val">${valore || '<span class="muted">—</span>'}</div></div>`;
}

function tabScheda(s) {
  const b = s.business, t = s.tecnica;
  const rischiTab = s.rischi.length ? `
    <table class="lista compact">
      <thead><tr><th>Tipo</th><th>Descrizione</th><th>Gestione</th><th>Owner</th><th>Azione</th><th>Deadline</th></tr></thead>
      <tbody>
        ${s.rischi.map(r => `
          <tr>
            <td>${esc(r.tipo)}</td>
            <td>${esc(r.descrizione)}</td>
            <td><span class="badge rischio-${(r.gestione || '').toLowerCase()}">${esc(r.gestione) || '—'}</span></td>
            <td>${esc(r.owner)}</td>
            <td>${esc(r.azione) || '—'}</td>
            <td>${fmtData(r.deadline, false)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p class="muted">Nessun rischio inserito.</p>';

  return `
    <div class="card">
      <h3>Contenuto</h3>
      ${rigaVal('Nome contenuto', esc(s.contenuto.nome))}
      ${rigaVal('Tipo contenuto', esc(s.contenuto.tipo))}
      ${rigaVal('Nuovo / Evoluzione esistente', esc(s.contenuto.novita))}
    </div>
    <div class="card">
      <h3>Business case</h3>
      ${rigaVal('Target cliente', esc(b.targetCliente.join(', ')))}
      ${rigaVal('Target utente', esc(b.targetUtente.join(', ')))}
      ${rigaVal('Tipo problema risolto', esc(b.tipoProblema.join(', ')))}
      ${rigaVal('Descrizione problema risolto', esc(b.descrizioneProblema))}
      ${rigaVal('Colture', esc(b.colture))}
      ${rigaVal('Geografie', esc(b.geografie.join(', ')))}
    </div>
    <div class="card">
      <h3>Caratteristiche tecniche</h3>
      ${rigaVal('Input', esc(t.input))}
      ${rigaVal('Output', esc(t.output))}
      ${rigaVal('Affidabilità algoritmo', esc(t.affidabilita))}
      ${rigaVal('Frequenza aggiornamento dati', esc(t.frequenza))}
      ${s.contenuto.novita === 'Evoluzione esistente' ? rigaVal('Retrocompatibilità', esc(t.retrocompatibilita)) : ''}
    </div>
    <div class="card">
      <h3>Rischi</h3>
      ${rischiTab}
    </div>`;
}

/* ---- Tab "Gate decisionali" ---- */

function tabValutazione(s) {
  if (s.stato === 'bozza') {
    return '<div class="card"><p class="muted">I gate decisionali saranno disponibili dopo la sottoscrizione della scheda da parte di R&amp;D.</p></div>';
  }
  return Object.keys(GATES).map(gid => renderGate(s, gid)).join('');
}

function renderGate(s, gid) {
  const gate = GATES[gid];
  const editabile = can(ui.role, GATE_PERM[gid]) && STATI_GATE_EDITABILI.includes(s.stato);
  const { compilati, totale } = conteggioGate(s, gid);
  const completo = compilati === totale;

  const righe = Object.entries(gate.criteri).map(([cid, label]) => {
    const val = s.gates[gid][cid] || {};
    const classi = ['criterio'];
    if (!val.risposta) classi.push('non-compilato');
    else if (val.risposta === 'no') classi.push('risposta-no');
    else if (val.risposta === 'na') classi.push('risposta-na');
    if (notaMancante(val)) classi.push('nota-mancante');

    const radios = Object.entries(RISPOSTE_GATE).map(([k, v]) => `
      <label class="radio-inline">
        <input type="radio" name="${gid}-${cid}" value="${k}" ${val.risposta === k ? 'checked' : ''} ${editabile ? '' : 'disabled'}> ${v}
      </label>`).join('');

    return `
      <div class="${classi.join(' ')}">
        <div class="criterio-label">
          ${esc(label)}
          ${!val.risposta ? '<span class="flag flag-empty">non compilato</span>' : ''}
          ${val.risposta === 'no' ? '<span class="flag flag-no">No</span>' : ''}
          ${val.risposta === 'na' ? '<span class="flag flag-na">N/A</span>' : ''}
          ${notaMancante(val) ? '<span class="flag flag-warn">⚠ nota mancante</span>' : ''}
        </div>
        <div class="criterio-radios">${radios}</div>
        <textarea class="criterio-note" name="${gid}-${cid}-note" rows="1"
          placeholder="Note / motivazione…" ${editabile ? '' : 'disabled'}>${esc(val.note || '')}</textarea>
        ${val.utente ? `<div class="criterio-meta">Compilato da ${esc(val.utente)} il ${fmtData(val.data)}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="card gate" id="gate-${gid}">
      <div class="gate-head">
        <h3>${gate.nome}</h3>
        <span class="badge ${completo ? 'gate-ok' : 'gate-pending'}">${compilati}/${totale} criteri</span>
      </div>
      ${!can(ui.role, GATE_PERM[gid]) ? `<p class="muted">Il tuo ruolo (${RUOLI[ui.role].label}) non è abilitato alla compilazione di questo gate.</p>` : ''}
      ${can(ui.role, GATE_PERM[gid]) && !STATI_GATE_EDITABILI.includes(s.stato) ? `<p class="muted">Gate non modificabile nello stato attuale (${STATI[s.stato]}).</p>` : ''}
      ${righe}
      ${editabile ? `<div class="form-actions"><button class="btn primary" onclick="App.salvaGate('${gid}')">Salva ${gate.nome.split(' — ')[0]}</button></div>` : ''}
    </div>`;
}

/* ---- Tab "Decisione finale" ---- */

function tabDecisione(s) {
  if (!['valutata', 'decisione', 'chiusa'].includes(s.stato)) {
    return `<div class="card"><p class="muted">La decisione finale sarà disponibile quando tutti i criteri dei tre gate saranno stati compilati (stato "Valutata"). Stato attuale: <strong>${STATI[s.stato]}</strong>.</p></div>`;
  }

  /* Riepilogo esiti gate */
  const riepilogo = Object.keys(GATES).map(gid => {
    const vals = Object.keys(GATES[gid].criteri).map(cid => s.gates[gid][cid] || {});
    const no = vals.filter(v => v.risposta === 'no').length;
    const na = vals.filter(v => v.risposta === 'na').length;
    return `<div class="ro-row"><div class="ro-label">${GATES[gid].nome}</div>
      <div class="ro-val">${vals.filter(v => v.risposta === 'si').length} Sì · <strong class="${no ? 'txt-no' : ''}">${no} No</strong> · ${na} N/A</div></div>`;
  }).join('');

  /* Decisione già registrata */
  if (s.decisione) {
    const d = s.decisione;
    const appr = d.approvazioni;
    const ruoloPuoApprovare = can(ui.role, 'approvaChiusura') && !appr[ui.role] && s.stato === 'decisione';
    return `
      <div class="card"><h3>Riepilogo gate</h3>${riepilogo}</div>
      <div class="card">
        <h3>Decisione finale</h3>
        ${rigaVal('Decisione', badgeDecisione(d.scelta) + ` <span class="muted">${DECISIONI[d.scelta].desc}</span>`)}
        ${rigaVal('Motivazione', esc(d.motivazione))}
        ${rigaVal('Owner prossimo step', esc(d.owner))}
        ${rigaVal('Azione successiva', esc(d.azione))}
        ${rigaVal('Deadline', fmtData(d.deadline, false))}
        ${rigaVal('Registrata da', esc(d.registrataDa) + ' il ' + fmtData(d.data))}
      </div>
      <div class="card">
        <h3>Approvazione chiusura</h3>
        <p class="muted">La chiusura del processo richiede l'approvazione di COO e Direttore R&amp;D.</p>
        <div class="ro-row"><div class="ro-label">COO</div><div class="ro-val">${appr.coo ? '✅ Approvata il ' + fmtData(appr.coo) : '⏳ In attesa'}</div></div>
        <div class="ro-row"><div class="ro-label">Direttore R&amp;D</div><div class="ro-val">${appr.dir ? '✅ Approvata il ' + fmtData(appr.dir) : '⏳ In attesa'}</div></div>
        ${ruoloPuoApprovare ? `<div class="form-actions"><button class="btn success" onclick="App.approvaChiusura()">Approva chiusura</button></div>` : ''}
        ${s.stato === 'chiusa' ? '<div class="alert success-alert"><strong>Processo chiuso.</strong> La scheda non è più modificabile.</div>' : ''}
      </div>`;
  }

  /* Form decisione */
  if (!can(ui.role, 'decisioneFinale')) {
    return `<div class="card"><h3>Riepilogo gate</h3>${riepilogo}</div>
      <div class="card"><p class="muted">Il tuo ruolo (${RUOLI[ui.role].label}) non è abilitato alla registrazione della decisione finale.</p></div>`;
  }

  return `
    <div class="card"><h3>Riepilogo gate</h3>${riepilogo}</div>
    <div class="card">
      <h3>Registra decisione finale</h3>
      <div class="form-grid">
        <label class="full">Decisione <span class="req">*</span>
          <select id="dec-scelta">
            <option value="">— Seleziona —</option>
            ${Object.entries(DECISIONI).map(([k, v]) => `<option value="${k}">${v.label} — ${v.desc}</option>`).join('')}
          </select>
        </label>
        <label class="full">Motivazione <span class="req">*</span>
          <textarea id="dec-motivazione" rows="3"></textarea>
        </label>
        <label>Owner prossimo step <span class="req">*</span>
          <input type="text" id="dec-owner">
        </label>
        <label>Deadline <span class="opt">(facoltativa)</span>
          <input type="date" id="dec-deadline">
        </label>
        <label class="full">Azione successiva <span class="req">*</span>
          <textarea id="dec-azione" rows="2"></textarea>
        </label>
      </div>
      <div class="form-actions">
        <button class="btn primary" onclick="App.registraDecisione()">Registra decisione finale</button>
      </div>
    </div>`;
}

/* ---- Tab "Audit trail" ---- */

function tabAudit(s) {
  const righe = s.audit.slice().reverse().map(a => `
    <tr>
      <td class="small">${fmtData(a.data)}</td>
      <td>${esc(a.utente)} <span class="muted">(${RUOLI[a.ruolo] ? RUOLI[a.ruolo].label : a.ruolo})</span></td>
      <td>${esc(a.azione)}</td>
      <td class="small">${a.prima != null ? esc(a.prima) : '—'}</td>
      <td class="small">${a.dopo != null ? esc(a.dopo) : '—'}</td>
    </tr>`).join('');
  return `
    <div class="card table-wrap">
      <table class="lista compact">
        <thead><tr><th>Data e ora</th><th>Utente</th><th>Azione</th><th>Valore precedente</th><th>Nuovo valore</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="5" class="empty">Nessun evento registrato.</td></tr>'}</tbody>
      </table>
    </div>`;
}

/* ============================================================
   AZIONI
   ============================================================ */

const App = {

  /* ---- navigazione ---- */

  setFiltro(k, v) { ui.filtri[k] = v; render(); },
  setTab(t) { ui.tab = t; ui.showIntegrazionePanel = false; render(); },
  tornaElenco() { ui.view = 'list'; ui.schedaId = null; ui.draft = null; ui.showIntegrazionePanel = false; render(); },
  apriScheda(id) { ui.view = 'detail'; ui.schedaId = id; ui.tab = 'scheda'; ui.draft = null; ui.showIntegrazionePanel = false; render(); },

  apriNotifica(nid) {
    const n = DB.notifiche.find(x => x.id === nid);
    if (!n) return;
    if (!n.letti.includes(ui.role)) n.letti.push(ui.role);
    saveDB(DB);
    document.getElementById('notif-panel').classList.add('hidden');
    if (getScheda(n.schedaId)) this.apriScheda(n.schedaId);
    else render();
  },

  /* ---- creazione / modifica bozza ---- */

  nuovaScheda() {
    if (!can(ui.role, 'creaScheda')) return alert('Il tuo ruolo non può creare schede.');
    ui.draft = schedaVuota(utenteCorrente(), ui.role);
    ui.schedaId = null;
    ui.view = 'form';
    ui.integrazioneMode = false;
    render();
  },

  modificaScheda() {
    const s = getScheda(ui.schedaId);
    if (!s || s.stato !== 'bozza' || !can(ui.role, 'modificaBozza')) return;
    ui.draft = deepCopy(s);
    ui.view = 'form';
    ui.integrazioneMode = false;
    render();
  },

  annullaForm() {
    ui.draft = null;
    ui.integrazioneMode = false;
    if (ui.schedaId) this.apriScheda(ui.schedaId);
    else this.tornaElenco();
  },

  toggleRetro(novita) {
    const f = document.getElementById('retro-field');
    if (f) f.classList.toggle('hidden', novita !== 'Evoluzione esistente');
  },

  aggiungiRischio() {
    leggiForm(ui.draft); // preserva quanto già digitato
    ui.draft.rischi.push({ tipo: '', descrizione: '', gestione: '', owner: utenteCorrente(), azione: '', deadline: '' });
    render();
  },

  rimuoviRischio(i) {
    leggiForm(ui.draft);
    ui.draft.rischi.splice(i, 1);
    render();
  },

  /* Riversa la bozza nella scheda persistita (creandola se nuova) e registra l'audit */
  _commitDraft() {
    const d = ui.draft;
    let s = ui.schedaId ? getScheda(ui.schedaId) : null;
    if (!s) {
      s = d;
      logAudit(s, 'Creazione scheda', null, 'Bozza');
      DB.schede.push(s);
    } else {
      const prefisso = ui.integrazioneMode ? 'Integrazione — modifica campo' : 'Modifica campo';
      diffScheda(s, d).forEach(x => logAudit(s, `${prefisso} "${x.campo}"`, x.prima || '(vuoto)', x.dopo || '(vuoto)'));
      s.contenuto = d.contenuto;
      s.business = d.business;
      s.tecnica = d.tecnica;
      s.rischi = d.rischi;
    }
    return s;
  },

  salvaBozza() {
    leggiForm(ui.draft);
    if (!ui.draft.contenuto.nome.trim()) return alert('Inserisci almeno il nome del contenuto per salvare la bozza.');
    const s = this._commitDraft();
    touch(s);
    ui.draft = null;
    this.apriScheda(s.id);
  },

  /* ---- sottoscrizione ---- */

  sottoscrivi() {
    if (!can(ui.role, 'sottoscrivi')) return alert('Il tuo ruolo non può sottoscrivere schede.');
    leggiForm(ui.draft);
    const errori = validaScheda(ui.draft);
    if (errori.length) {
      alert('La scheda non può essere sottoscritta. Campi obbligatori mancanti:\n\n• ' + errori.join('\n• '));
      return;
    }
    if (!confirm('Confermi la sottoscrizione? La scheda non sarà più modificabile da R&D e verrà inviata in valutazione.')) return;

    const s = this._commitDraft();
    s.stato = 'sottoscritta';
    s.dataSottoscrizione = nowISO();
    s.sottoscrittaDa = utenteCorrente();
    logAudit(s, 'Sottoscrizione scheda R&D', 'Bozza', 'Sottoscritta da R&D');
    notifica(['prodotto', 'coo', 'dir'], `Scheda sottoscritta da R&D: pronta per la valutazione dei gate.`, s);
    touch(s);
    ui.integrazioneMode = false;
    this.apriScheda(s.id);
  },

  /* ---- gate decisionali ---- */

  salvaGate(gid) {
    const s = getScheda(ui.schedaId);
    if (!can(ui.role, GATE_PERM[gid]) || !STATI_GATE_EDITABILI.includes(s.stato)) return;

    const eraCompleto = gateCompleto(s, gid);

    Object.keys(GATES[gid].criteri).forEach(cid => {
      const sel = document.querySelector(`input[name="${gid}-${cid}"]:checked`);
      const note = document.querySelector(`textarea[name="${gid}-${cid}-note"]`).value;
      const prev = s.gates[gid][cid] || {};
      const risposta = sel ? sel.value : prev.risposta || '';
      if (risposta !== (prev.risposta || '') || note !== (prev.note || '')) {
        if (risposta !== (prev.risposta || '')) {
          logAudit(s, `${GATES[gid].nome} — criterio "${GATES[gid].criteri[cid]}"`,
            prev.risposta ? RISPOSTE_GATE[prev.risposta] : '(non compilato)',
            risposta ? RISPOSTE_GATE[risposta] : '(non compilato)');
        }
        s.gates[gid][cid] = { risposta, note, utente: utenteCorrente(), data: nowISO() };
      }
    });

    if (s.stato === 'sottoscritta') {
      logAudit(s, 'Avvio valutazione gate', 'Sottoscritta da R&D', 'In valutazione');
      s.stato = 'in_valutazione';
    }

    if (!eraCompleto && gateCompleto(s, gid)) {
      notifica(PERMESSI[GATE_PERM[gid]], `${GATES[gid].nome}: tutti i criteri sono stati compilati.`, s);
    }

    if (tuttiGateCompleti(s) && s.stato === 'in_valutazione') {
      logAudit(s, 'Valutazione completata: tutti i gate compilati', 'In valutazione', 'Valutata');
      s.stato = 'valutata';
      notifica(['rd', 'prodotto', 'coo', 'dir'], 'Tutti i gate sono stati compilati: la scheda è "Valutata" e pronta per la decisione finale.', s);
    }

    touch(s);
    render();
  },

  /* ---- richiesta integrazione ---- */

  toggleIntegrazionePanel() {
    ui.showIntegrazionePanel = !ui.showIntegrazionePanel;
    render();
  },

  inviaRichiestaIntegrazione() {
    const s = getScheda(ui.schedaId);
    if (!can(ui.role, 'richiediIntegrazione')) return;
    const sezioni = [...document.querySelectorAll('input[name="integ-sez"]:checked')].map(e => e.value);
    const nota = document.getElementById('integ-nota').value.trim();
    if (!sezioni.length) return alert('Seleziona almeno una sezione da integrare.');
    if (!nota) return alert('La nota per R&D è obbligatoria.');

    const statoPrec = s.stato;
    s.integrazione = { sezioni, nota, richiestaDa: utenteCorrente(), data: nowISO(), attiva: true, statoPrecedente: statoPrec };
    s.stato = 'integrazione';
    logAudit(s, `Richiesta integrazione (sezioni: ${sezioni.map(z => SEZIONI[z]).join(', ')}) — ${nota}`, STATI[statoPrec], STATI.integrazione);
    notifica(['rd'], `Richiesta di integrazione su: ${sezioni.map(z => SEZIONI[z]).join(', ')}.`, s);
    touch(s);
    ui.showIntegrazionePanel = false;
    render();
  },

  apriIntegrazione() {
    const s = getScheda(ui.schedaId);
    if (s.stato !== 'integrazione' || !can(ui.role, 'integraScheda')) return;
    ui.draft = deepCopy(s);
    ui.view = 'form';
    ui.integrazioneMode = true;
    render();
  },

  salvaIntegrazione() {
    leggiForm(ui.draft);
    const errori = validaScheda(ui.draft);
    if (errori.length) {
      alert('Prima di reinviare la scheda in valutazione, completa i campi obbligatori:\n\n• ' + errori.join('\n• '));
      return;
    }
    const s = this._commitDraft();
    s.integrazione.attiva = false;
    s.stato = 'in_valutazione';
    logAudit(s, 'Integrazione completata: scheda reinviata in valutazione', STATI.integrazione, STATI.in_valutazione);
    notifica(['prodotto', 'coo', 'dir'], 'Integrazione completata da R&D: la scheda è di nuovo in valutazione.', s);

    /* se i gate erano già tutti completi, la scheda torna direttamente "Valutata" */
    if (tuttiGateCompleti(s)) {
      logAudit(s, 'Valutazione completata: tutti i gate compilati', STATI.in_valutazione, STATI.valutata);
      s.stato = 'valutata';
    }

    touch(s);
    ui.integrazioneMode = false;
    this.apriScheda(s.id);
  },

  /* ---- decisione finale e chiusura ---- */

  registraDecisione() {
    const s = getScheda(ui.schedaId);
    if (s.stato !== 'valutata' || !can(ui.role, 'decisioneFinale')) return;

    const scelta = document.getElementById('dec-scelta').value;
    const motivazione = document.getElementById('dec-motivazione').value.trim();
    const owner = document.getElementById('dec-owner').value.trim();
    const azione = document.getElementById('dec-azione').value.trim();
    const deadline = document.getElementById('dec-deadline').value;

    const errori = [];
    if (!scelta) errori.push('Seleziona la decisione.');
    if (!motivazione) errori.push('La motivazione è obbligatoria.');
    if (!owner) errori.push("Indica l'owner del prossimo step.");
    if (!azione) errori.push("Indica l'azione successiva.");
    if (errori.length) return alert(errori.join('\n'));

    s.decisione = {
      scelta, motivazione, owner, azione, deadline,
      registrataDa: utenteCorrente(),
      data: nowISO(),
      approvazioni: { coo: null, dir: null },
    };
    s.stato = 'decisione';
    logAudit(s, `Decisione finale registrata: ${DECISIONI[scelta].label}`, STATI.valutata, STATI.decisione);
    notifica(['rd', 'prodotto', 'coo', 'dir'], `Decisione finale registrata: ${DECISIONI[scelta].label}.`, s);
    touch(s);
    render();
  },

  approvaChiusura() {
    const s = getScheda(ui.schedaId);
    if (s.stato !== 'decisione' || !can(ui.role, 'approvaChiusura')) return;
    if (s.decisione.approvazioni[ui.role]) return;

    s.decisione.approvazioni[ui.role] = nowISO();
    logAudit(s, `Approvazione chiusura (${RUOLI[ui.role].label})`, null, 'Approvata');

    const a = s.decisione.approvazioni;
    if (a.coo && a.dir) {
      s.stato = 'chiusa';
      logAudit(s, 'Chiusura processo: scheda non più modificabile', STATI.decisione, STATI.chiusa);
      notifica(['rd', 'prodotto', 'coo', 'dir'], 'Processo concluso: la scheda è stata chiusa.', s);
    }
    touch(s);
    render();
  },
};

/* ============================================================
   Inizializzazione
   ============================================================ */

function init() {
  const sel = document.getElementById('role-select');
  sel.innerHTML = Object.entries(RUOLI).map(([k, v]) => `<option value="${k}" ${ui.role === k ? 'selected' : ''}>${v.label}</option>`).join('');
  sel.addEventListener('change', () => {
    ui.role = sel.value;
    localStorage.setItem('rdcontent_role', ui.role);
    ui.showIntegrazionePanel = false;
    ui.integrazioneMode = false;
    if (ui.view === 'form') { // evita form aperti con permessi diversi
      ui.draft = null;
      ui.view = ui.schedaId ? 'detail' : 'list';
    }
    render();
  });

  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden');
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);
