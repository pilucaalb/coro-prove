'use strict';

/* Prove del coro — app web per ascoltare le basi per voce, con il testo che scorre.
   Nessuna dipendenza esterna: basta pubblicare la cartella su un sito statico. */

const VOCI = [
  { id: 'soprano',   nome: 'Soprani',   singolare: 'Soprano',   lettera: 'S', colore: '#c2410c' },
  { id: 'contralto', nome: 'Contralti', singolare: 'Contralto', lettera: 'C', colore: '#7c3aed' },
  { id: 'tenore',    nome: 'Tenori',    singolare: 'Tenore',    lettera: 'T', colore: '#0369a1' },
  { id: 'basso',     nome: 'Bassi',     singolare: 'Basso',     lettera: 'B', colore: '#15803d' },
];
const VERSIONI = [
  { id: 'suonata', nome: 'Solo musica' },
  { id: 'cantata', nome: 'Con voce guida' },
];
const VELOCITA = [0.7, 0.85, 1];
const ANTICIPO_TESTO = 0.4;          // secondi: la riga si illumina poco prima, per avere il tempo di leggerla
const CACHE_AUDIO = 'coro-audio-v1';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const audio = $('#audio');

const pref = {
  get(k, predefinito) {
    try { const v = localStorage.getItem('coro.' + k); return v === null ? predefinito : JSON.parse(v); }
    catch { return predefinito; }
  },
  set(k, v) { try { localStorage.setItem('coro.' + k, JSON.stringify(v)); } catch { /* memoria non disponibile */ } },
};

const st = {
  catalogo: null,
  brano: null,
  voce: pref.get('voce', null),
  versione: 'suonata',
  urls: {},
  urlTemporanei: [],
  righe: [],
  rigaAttiva: -1,
  ripetiDa: null,
  ripetiA: null,
  trascinando: false,
  wakeLock: null,
  installa: null,
};

/* ---------- Utilità ---------- */

function h(tag, attrs = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat()) if (f !== null && f !== undefined && f !== false) el.append(f);
  return el;
}

const voceDa = id => VOCI.find(v => v.id === id);
const versioneDa = id => VERSIONI.find(v => v.id === id);

function minuti(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function percorso(brano, file) { return file ? `${brano.cartella}/${file}` : null; }

async function cacheAudio() {
  if (!('caches' in window)) return null;
  try { return await caches.open(CACHE_AUDIO); } catch { return null; }
}

/* Legge un file di testo dalla rete; se non c'è rete, dalla copia salvata sul telefono. */
async function leggiTesto(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.text();
  } catch (e) {
    const c = await cacheAudio();
    const r = c && await c.match(url);
    if (r) return await r.text();
    throw e;
  }
}

/* Se l'audio è stato salvato sul telefono lo si suona da lì, altrimenti dalla rete. */
async function urlAudio(url) {
  const c = await cacheAudio();
  const r = c && await c.match(url);
  if (!r) return url;
  const u = URL.createObjectURL(await r.blob());
  st.urlTemporanei.push(u);
  return u;
}

function liberaUrlTemporanei() {
  st.urlTemporanei.forEach(u => URL.revokeObjectURL(u));
  st.urlTemporanei = [];
}

/* ---------- Testo (formato LRC) ----------
   [ti:Titolo]                → titolo
   [nota:Testo]                → riga informativa sotto il titolo (tonalità, autore…)
   [00:12.50]Parole della riga → riga con il momento in cui inizia
   Parole senza tempo          → riga senza evidenziazione
   Parole della riga //        → // alla fine = respiro
   # Strofa 1                  → titoletto di sezione
   ; commento                  → ignorato
   riga vuota                  → separa le strofe

   Se nella cartella del brano c'è tempi.json, i tempi delle righe vengono da lì,
   uno per ogni registrazione (le versioni hanno durate e introduzioni diverse).   */

function leggiLrc(testo) {
  const righe = [], note = [];
  let titolo = null, staccoPrima = false;
  for (const grezza of testo.replace(/\r/g, '').split('\n')) {
    const riga = grezza.trim();
    if (!riga) { staccoPrima = righe.length > 0; continue; }
    if (riga.startsWith(';')) continue;
    const tag = riga.match(/^\[(ti|nota|ar|al|by|au|length|offset|re|ve):(.*)\]$/i);
    if (tag) {
      const nome = tag[1].toLowerCase(), valore = tag[2].trim();
      if (nome === 'ti') titolo = valore;
      else if (nome === 'nota' || nome === 'ar') note.push(valore);
      continue;
    }
    if (riga.startsWith('#')) {
      righe.push({ tipo: 'sezione', testo: riga.replace(/^#+\s*/, ''), t: null, stacco: staccoPrima });
      staccoPrima = false; continue;
    }
    const m = riga.match(/^\[(\d{1,2}):(\d{1,2}(?:[.,]\d{1,3})?)\]\s*/);
    const t = m ? parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(',', '.')) : null;
    let parole = m ? riga.slice(m[0].length) : riga;
    const respiro = /\s*\/\/\s*$/.test(parole);
    if (respiro) parole = parole.replace(/\s*\/\/\s*$/, '');
    righe.push({ tipo: 'riga', testo: parole, t, respiro, stacco: staccoPrima });
    staccoPrima = false;
  }
  return { titolo, note, righe };
}

/* Raggruppa le righe per sezione (# Strofa 1, # Strofa 2…). */
function gruppi(righe) {
  const g = [];
  for (const r of righe) {
    if (r.tipo === 'sezione' || !g.length) g.push({ titolo: r.tipo === 'sezione' ? r.testo : null, righe: [] });
    if (r.tipo === 'riga') g[g.length - 1].righe.push(r);
  }
  return g.filter(x => x.righe.length);
}

function fileCorrente() { return st.brano?.parti[st.voce]?.[st.versione] ?? null; }

/* Tempi delle frasi per la registrazione che sta suonando: [inizio frase 1, …, fine]. */
function tempiCorrenti() {
  const a = st.tempi?.[fileCorrente()];
  return Array.isArray(a) && a.length > 1 ? a : null;
}

/* Porta un istante da una registrazione all'altra: stessa frase, stesso punto della frase. */
function mappaTempo(t, da, a) {
  if (!da || !a || da.length !== a.length) return t;
  if (t <= da[0]) return Math.max(0, a[0] - (da[0] - t));
  for (let i = 0; i < da.length - 1; i++) {
    if (t < da[i + 1]) return a[i] + (t - da[i]) / (da[i + 1] - da[i]) * (a[i + 1] - a[i]);
  }
  return a[a.length - 1] + (t - da[da.length - 1]);
}

/* ---------- Navigazione ---------- */

function vai(hash) { if (location.hash !== hash) location.hash = hash; else mostra(); }

async function mostra() {
  const m = location.hash.match(/^#\/brano\/(.+)$/);
  if (m) {
    const brano = st.catalogo?.brani.find(b => b.id === decodeURIComponent(m[1]));
    if (brano) return paginaBrano(brano);
  }
  lasciaBrano();
  paginaIniziale();
}

/* ---------- Pagina iniziale ---------- */

function sceltaVoce(alScegliere) {
  return h('div', { class: 'scelta-voci' },
    VOCI.map(v => h('button', {
      vars: { '--c': v.colore },
      onclick: () => { st.voce = v.id; pref.set('voce', v.id); alScegliere(); },
    }, h('span', { class: 'lettera' }, v.lettera), v.nome)));
}

async function paginaIniziale() {
  document.title = 'Prove del coro';
  document.documentElement.style.setProperty('--voce', 'var(--accento)');
  const voce = voceDa(st.voce);

  if (!voce) {
    app.replaceChildren(
      h('h1', {}, 'Prove del coro'),
      h('p', {}, 'Per cominciare: che voce canti?'),
      sceltaVoce(paginaIniziale),
      h('p', { class: 'nota' }, 'Potrai cambiarla in qualsiasi momento.'));
    return;
  }
  document.documentElement.style.setProperty('--voce', voce.colore);

  const elenco = h('ul', { class: 'elenco-brani' });
  const brani = st.catalogo?.brani ?? [];
  for (const b of brani) {
    const segno = h('span', { class: 'offline' });
    elenco.append(h('li', {}, h('button', { onclick: () => vai('#/brano/' + encodeURIComponent(b.id)) },
      h('span', {}, b.titolo), segno, h('span', { class: 'freccia', 'aria-hidden': 'true' }, '›'))));
    salvatoOffline(b, st.voce).then(ok => { if (ok) segno.textContent = '✓ anche senza internet'; });
  }

  app.replaceChildren(...[
    h('h1', {}, 'Prove del coro'),
    h('div', { class: 'mia-voce' },
      h('span', {}, 'La mia voce: ', h('strong', {}, voce.nome)),
      h('button', { onclick: () => {
        app.replaceChildren(h('h1', {}, 'Che voce canti?'), sceltaVoce(paginaIniziale));
      } }, 'Cambia')),
    h('h2', {}, 'Brani'),
    brani.length ? elenco : h('p', { class: 'nota' }, 'Non ci sono ancora brani.'),
    st.catalogo?.aggiornato ? h('p', { class: 'nota' }, 'Elenco aggiornato il ' + st.catalogo.aggiornato) : null,
    suggerimentoInstallazione(),
  ].filter(Boolean));
}

function suggerimentoInstallazione() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || pref.get('nascondiInstalla', false)) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const chiudi = h('button', { onclick: e => { pref.set('nascondiInstalla', true); e.target.closest('.installa').remove(); } }, 'Non mostrare più');
  if (st.installa) {
    return h('div', { class: 'installa' },
      h('div', {}, 'Puoi mettere l\'app sulla schermata del telefono, come le altre app.'),
      h('div', { class: 'azioni-brano' },
        h('button', { onclick: async () => { st.installa.prompt(); await st.installa.userChoice; st.installa = null; paginaIniziale(); } }, 'Installa l\'app'),
        chiudi));
  }
  if (ios) {
    return h('div', { class: 'installa' },
      h('div', {}, 'Per averla sulla schermata del telefono: tocca il pulsante Condividi ',
        h('span', { 'aria-hidden': 'true' }, '⬆︎'), ' in basso e poi «Aggiungi alla schermata Home».'),
      chiudi);
  }
  return null;
}

/* ---------- Pagina del brano ---------- */

let barra = null;

async function paginaBrano(brano) {
  const nuovo = st.brano !== brano;
  st.brano = brano;
  document.title = brano.titolo + ' — Prove del coro';

  const disponibili = VOCI.filter(v => brano.parti[v.id]);
  if (!brano.parti[st.voce]) st.voce = disponibili[0]?.id ?? null;
  if (nuovo) {
    st.versione = 'suonata'; st.ripetiDa = st.ripetiA = null; st.strofa = 0; st.testo = null; st.tempi = null;
    pref.set('velocitaSessione', 1);
  }

  const testoBox = h('div', { class: 'testo' }, h('p', { class: 'caricamento' }, 'Caricamento del testo…'));
  const noteBox = h('div', { class: 'note-brano' });
  st.testoBox = testoBox; st.noteBox = noteBox;
  const haPartiture = !!(brano.partiture && Object.keys(brano.partiture).length);
  const immagine = h('img', { alt: 'Partitura', class: 'immagine-partitura' });
  const originale = h('a', { class: 'link-originale', target: '_blank', rel: 'noopener' }, 'Originale scritto a mano');
  const sovrapposta = h('div', { class: 'partitura-sovrapposta', hidden: !st.mostraPartitura }, immagine, originale);
  const testata = h('div', { class: 'testata-brano' + (st.mostraPartitura ? ' con-partitura' : '') },
    h('h1', {}, brano.titolo), noteBox, sovrapposta);
  st.partituraUI = { immagine, originale, sovrapposta, testata };
  const tastoPartitura = haPartiture ? h('button', {
    class: 'tasto-partitura', 'aria-pressed': String(!!st.mostraPartitura),
    onclick: e => {
      st.mostraPartitura = !st.mostraPartitura;
      sovrapposta.hidden = !st.mostraPartitura;
      testata.classList.toggle('con-partitura', st.mostraPartitura);
      e.currentTarget.setAttribute('aria-pressed', String(st.mostraPartitura));
      e.currentTarget.textContent = st.mostraPartitura ? '♫ Nascondi partitura' : '♫ Partitura';
      aggiornaPartitura();
    },
  }, st.mostraPartitura ? '♫ Nascondi partitura' : '♫ Partitura') : null;

  app.replaceChildren(
    h('button', { class: 'indietro', onclick: () => vai('#/') }, '‹ Tutti i brani'),
    testata,
    h('div', { class: 'schede-voci', role: 'group', 'aria-label': 'Voce' },
      VOCI.map(v => h('button', {
        vars: { '--c': v.colore },
        'aria-pressed': String(v.id === st.voce),
        disabled: !brano.parti[v.id],
        onclick: () => cambiaVoce(v.id),
      }, h('span', { class: 'lettera' }, v.lettera), v.nome))),
    h('div', { class: 'versioni', role: 'group', 'aria-label': 'Versione' },
      VERSIONI.map(v => h('button', {
        'aria-pressed': String(v.id === st.versione),
        disabled: !brano.parti[st.voce]?.[v.id],
        onclick: () => cambiaVersione(v.id),
      }, v.nome))),
    h('div', { class: 'azioni-brano' },
      tastoIcona(),
      tastoPartitura,
      brano.spartito ? h('a', { class: 'bottone', href: percorso(brano, brano.spartito), target: '_blank', rel: 'noopener' }, 'Apri lo spartito') : null,
      h('span', { class: 'gruppo' },
        h('button', { 'aria-label': 'Testo più piccolo', onclick: () => grandezzaTesto(-0.2) }, 'A−'),
        h('button', { 'aria-label': 'Testo più grande', onclick: () => grandezzaTesto(+0.2) }, 'A+'))),
    testoBox);

  aggiornaPartitura();
  mostraBarra();
  impostaColoreVoce();
  grandezzaTesto(0);

  if (nuovo || !st.urls[st.versione]) await preparaAudio({ mantieniTempo: !nuovo });

  try {
    if (!st.testo) {
      const lrc = brano.testo ? await leggiTesto(percorso(brano, brano.testo)) : '';
      st.testo = leggiLrc(lrc);
      if (brano.tempi) {
        try { st.tempi = JSON.parse(await leggiTesto(percorso(brano, brano.tempi))); } catch { st.tempi = null; }
      }
    }
    if (st.brano !== brano) return;
    noteBox.replaceChildren(...st.testo.note.map(n => h('div', {}, n)));
    disegnaTesto();
  } catch {
    testoBox.replaceChildren(h('p', { class: 'errore' }, 'Testo non disponibile (serve la connessione la prima volta).'));
  }
}

function disegnaTesto() {
  const box = st.testoBox;
  if (!box || !st.testo) return;
  st.rigaAttiva = -1;
  const tutte = st.testo.righe;
  if (!tutte.length) { box.replaceChildren(h('p', { class: 'nota' }, 'Testo non ancora inserito.')); return; }

  // Con tempi.json: le basi contengono una strofa; si sceglie quale strofa leggere
  const tempi = tempiCorrenti();
  const strofe = tempi ? gruppi(tutte).filter(g => g.righe.length === tempi.length - 1) : [];
  let scelta = null;
  if (strofe.length) {
    st.strofa = Math.min(st.strofa ?? 0, strofe.length - 1);
    const g = strofe[st.strofa];
    st.righe = [
      ...(g.titolo ? [{ tipo: 'sezione', testo: g.titolo, t: null }] : []),
      ...g.righe.map((r, i) => ({ ...r, t: tempi[i], stacco: false })),
    ];
    if (strofe.length > 1) {
      scelta = h('div', { class: 'scelta-strofa' },
        h('div', { class: 'schede-strofa', role: 'group', 'aria-label': 'Strofa' },
          strofe.map((x, i) => h('button', {
            'aria-pressed': String(i === st.strofa),
            onclick: () => { st.strofa = i; disegnaTesto(); },
          }, x.titolo || `Strofa ${i + 1}`))),
        h('label', { class: 'di-seguito' },
          h('input', { type: 'checkbox', checked: pref.get('strofeDiSeguito', true),
            onchange: e => pref.set('strofeDiSeguito', e.target.checked) }),
          ' Alla fine riparti con la strofa successiva'));
    }
  } else {
    st.righe = tutte;
  }

  const sincronizzato = st.righe.some(r => r.t !== null);
  const vuote = st.righe.filter(r => r.tipo === 'riga' && /^\(.*\)$/.test(r.testo)).length;
  box.replaceChildren(...[
    scelta,
    ...st.righe.flatMap((r, i) => {
      const el = r.tipo === 'sezione'
        ? h('div', { class: 'titolo-sezione' }, r.testo)
        : h('div', {
            class: 'riga' + (r.t !== null ? ' temporizzata' : '') + (/^\(.*\)$/.test(r.testo) ? ' da-scrivere' : ''),
            'data-i': i,
            title: r.t !== null ? 'Tocca per ripartire da qui' : null,
            onclick: r.t !== null ? () => { audio.currentTime = Math.max(0, r.t - 0.3); suona(); } : null,
          }, r.testo || ' ',
          r.respiro ? h('span', { class: 'respiro', title: 'Respiro', 'aria-label': 'respiro' }, '’') : null);
      return r.stacco ? [h('div', { class: 'strofa' }), el] : [el];
    }),
    sincronizzato ? null : h('p', { class: 'nota' }, 'Il testo non è ancora sincronizzato con la musica: scorrilo a mano.'),
    vuote ? h('p', { class: 'nota' }, 'Le righe tra parentesi sono ancora da scrivere nel file testo.lrc.') : null,
  ].filter(Boolean));
  aggiornaPartitura();
  evidenziaRiga(true);
}

/* Partitura della voce scelta per la strofa scelta (se manca, quella della strofa 1). */
function partituraCorrente() {
  const p = st.brano?.partiture?.[st.voce];
  if (!p) return null;
  return p[String((st.strofa ?? 0) + 1)] || p['1'] || null;
}

function aggiornaPartitura() {
  const ui = st.partituraUI, p = partituraCorrente();
  if (!ui) return;
  if (!p) { ui.immagine.removeAttribute('src'); ui.originale.hidden = true; return; }
  const src = percorso(st.brano, p.stampa || p.originale);
  if (ui.immagine.getAttribute('src') !== src) ui.immagine.src = src;
  ui.originale.hidden = !p.originale || !p.stampa;
  if (p.originale) ui.originale.href = percorso(st.brano, p.originale);
}

/* «Crea icona sullo smartphone»: installa l'app (Chrome) o spiega come fare. */
function installata() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function tastoIcona() {
  if (installata()) return null;
  const aiuto = h('div', { class: 'aiuto-icona', hidden: true });
  const tasto = h('button', { onclick: async () => {
    if (st.installa) {
      st.installa.prompt();
      const { outcome } = await st.installa.userChoice;
      st.installa = null;
      if (outcome === 'accepted') tasto.remove();
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    aiuto.replaceChildren(ios
      ? 'Apri questa pagina con Safari, tocca Condividi (il quadrato con la freccia) e poi «Aggiungi alla schermata Home».'
      : 'Apri questa pagina con Google Chrome, tocca il menu ⋮ in alto a destra e poi «Aggiungi a schermata Home» → «Installa».');
    aiuto.hidden = !aiuto.hidden;
  } }, 'Crea icona');
  return h('span', { class: 'gruppo-icona' }, tasto, aiuto);
}

function grandezzaTesto(delta) {
  const v = Math.min(2.8, Math.max(1, Math.round((pref.get('testo', 1.45) + delta) * 100) / 100));
  pref.set('testo', v);
  document.documentElement.style.setProperty('--testo', v + 'rem');
}

function impostaColoreVoce() {
  document.documentElement.style.setProperty('--voce', voceDa(st.voce)?.colore ?? 'var(--accento)');
}

/* ---------- Audio ---------- */

async function preparaAudio({ mantieniTempo = true, tempiPrima = null } = {}) {
  const brano = st.brano, parte = brano.parti[st.voce] || {};
  if (!parte[st.versione]) st.versione = VERSIONI.find(v => parte[v.id])?.id ?? 'suonata';

  const tempo = mantieniTempo ? spostaRipeti(audio.currentTime, tempiPrima, tempiCorrenti()) : 0;
  const stavaSuonando = mantieniTempo && !audio.paused;
  audio.pause();
  liberaUrlTemporanei();
  st.urls = {};
  for (const v of VERSIONI) if (parte[v.id]) st.urls[v.id] = await urlAudio(percorso(brano, parte[v.id]));
  if (st.brano !== brano) return;
  caricaSorgente(tempo, stavaSuonando);
}

function caricaSorgente(tempo, riparti) {
  const url = st.urls[st.versione];
  if (!url) { audio.removeAttribute('src'); audio.load(); aggiornaBarra(); return; }
  audio.src = url;
  audio.load();
  const velocita = pref.get('velocitaSessione', 1);
  audio.defaultPlaybackRate = audio.playbackRate = velocita;
  audio.preservesPitch = audio.webkitPreservesPitch = audio.mozPreservesPitch = true;
  audio.addEventListener('loadedmetadata', () => {
    if (tempo > 0) audio.currentTime = Math.min(tempo, audio.duration || tempo);
    audio.playbackRate = velocita;
    if (riparti) suona();
    aggiornaBarra();
  }, { once: true });
  aggiornaMetadati();
  aggiornaBarra();
}

async function cambiaVoce(id) {
  if (id === st.voce) return;
  const tempiPrima = tempiCorrenti();
  st.voce = id;
  pref.set('voce', id);
  await preparaAudio({ mantieniTempo: true, tempiPrima });
  paginaBrano(st.brano);
}

function cambiaVersione(id) {
  if (id === st.versione || !st.urls[id]) return;
  const tempiPrima = tempiCorrenti(), stavaSuonando = !audio.paused;
  st.versione = id;
  const tempo = spostaRipeti(audio.currentTime, tempiPrima, tempiCorrenti());
  audio.pause();
  caricaSorgente(tempo, stavaSuonando);
  document.querySelectorAll('.versioni button').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(VERSIONI[i].id === id)));
  disegnaTesto();
}

/* Cambiando registrazione, porta nello stesso punto del canto anche il pezzo da ripetere. */
function spostaRipeti(tempo, da, a) {
  if (!da || !a) return tempo;
  if (st.ripetiDa !== null) st.ripetiDa = mappaTempo(st.ripetiDa, da, a);
  if (st.ripetiA !== null) st.ripetiA = mappaTempo(st.ripetiA, da, a);
  aggiornaRipeti();
  return mappaTempo(tempo, da, a);
}

function suona() {
  const p = audio.play();
  if (p && p.catch) p.catch(() => aggiornaBarra());
}

function lasciaBrano() {
  audio.pause();
  st.brano = null;
  st.righe = [];
  if (barra) { barra.remove(); barra = null; document.body.style.setProperty('--barra', '0px'); }
}

function aggiornaMetadati() {
  if (!('mediaSession' in navigator) || !st.brano) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.brano.titolo,
      artist: `${voceDa(st.voce)?.nome ?? ''} · ${versioneDa(st.versione)?.nome ?? ''}`,
      album: 'Prove del coro',
      artwork: [{ src: 'icone/icona-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('play', suona);
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => salta(-5));
    navigator.mediaSession.setActionHandler('seekforward', () => salta(5));
  } catch { /* non supportato */ }
}

function salta(sec) {
  audio.currentTime = Math.max(0, Math.min((audio.duration || 0) - 0.1, audio.currentTime + sec));
  evidenziaRiga(true);
  aggiornaBarra();
}

/* ---------- Barra del lettore ---------- */

function mostraBarra() {
  if (barra) { barra.remove(); }
  barra = h('div', { class: 'lettore', role: 'region', 'aria-label': 'Lettore' },
    h('div', { class: 'dentro' },
      h('div', { class: 'riga-lettore' },
        h('button', { id: 'suona', class: 'suona', 'aria-label': 'Suona', onclick: () => audio.paused ? suona() : audio.pause() }, '▶'),
        h('div', { class: 'avanzamento' },
          h('span', { id: 'tempo-ora' }, '0:00'),
          h('input', {
            id: 'cursore', type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Posizione',
            oninput: e => { st.trascinando = true; $('#tempo-ora').textContent = minuti(+e.target.value); },
            onchange: e => { st.trascinando = false; audio.currentTime = +e.target.value; evidenziaRiga(true); },
          }),
          h('span', { id: 'tempo-tot' }, '0:00'))),
      h('div', { class: 'extra' },
        h('span', { class: 'gruppo', role: 'group', 'aria-label': 'Velocità' },
          VELOCITA.map(v => h('button', {
            class: 'velocita', 'data-v': v,
            'aria-pressed': String(v === pref.get('velocitaSessione', 1)),
            onclick: () => impostaVelocita(v),
          }, Math.round(v * 100) + '%'))),
        h('button', { id: 'ripeti', onclick: tastoRipeti }, 'Ripeti un pezzo'),
        h('button', { id: 'salta-intro', hidden: true, onclick: saltaPresentazione }, 'Salta l\'inizio ⏭')),
      h('div', { class: 'info-ripeti', id: 'info-ripeti' })));
  document.body.append(barra);
  new ResizeObserver(() => document.body.style.setProperty('--barra', barra ? barra.offsetHeight + 'px' : '0px')).observe(barra);
  aggiornaRipeti();
  aggiornaBarra();
}

function inizioCanto() {
  const tempi = tempiCorrenti();
  if (tempi) return tempi[0];
  const prima = st.righe.find(r => r.t !== null);
  return prima ? prima.t : null;
}

function saltaPresentazione() {
  const t = inizioCanto();
  if (t !== null) { audio.currentTime = Math.max(0, t - 1.5); if (audio.paused) suona(); }
}

function impostaVelocita(v) {
  pref.set('velocitaSessione', v);
  audio.defaultPlaybackRate = audio.playbackRate = v;
  document.querySelectorAll('.velocita').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === v)));
}

function tastoRipeti() {
  if (st.ripetiDa === null) { st.ripetiDa = audio.currentTime; }
  else if (st.ripetiA === null) {
    if (audio.currentTime > st.ripetiDa + 0.5) { st.ripetiA = audio.currentTime; audio.currentTime = st.ripetiDa; suona(); }
    else { st.ripetiDa = null; }
  } else { st.ripetiDa = st.ripetiA = null; }
  aggiornaRipeti();
}

function aggiornaRipeti() {
  const b = $('#ripeti'), info = $('#info-ripeti');
  if (!b) return;
  b.className = '';
  if (st.ripetiDa === null) { b.textContent = 'Ripeti un pezzo'; info.textContent = ''; }
  else if (st.ripetiA === null) {
    b.textContent = 'Fine del pezzo'; b.className = 'ripeti-attesa';
    info.textContent = `Inizio fissato a ${minuti(st.ripetiDa)}: tocca «Fine del pezzo» dove vuoi che torni indietro.`;
  } else {
    b.textContent = 'Togli ripetizione'; b.className = 'ripeti-attivo';
    info.textContent = `Ripete da ${minuti(st.ripetiDa)} a ${minuti(st.ripetiA)}`;
  }
}

function aggiornaBarra() {
  if (!barra) return;
  const dur = isFinite(audio.duration) ? audio.duration : 0;
  const cursore = $('#cursore');
  cursore.max = dur || 1;
  if (!st.trascinando) { cursore.value = audio.currentTime; $('#tempo-ora').textContent = minuti(audio.currentTime); }
  $('#tempo-tot').textContent = minuti(dur);
  const tasto = $('#suona');
  tasto.textContent = audio.paused ? '▶' : '❚❚';
  tasto.setAttribute('aria-label', audio.paused ? 'Suona' : 'Pausa');
  tasto.disabled = !audio.getAttribute('src');
  const nv = $('#nome-versione'); if (nv) nv.textContent = versioneDa(st.versione)?.nome ?? '';
  const si = $('#salta-intro'), ic = inizioCanto();
  if (si) si.hidden = !(ic !== null && ic > 4 && audio.currentTime < ic - 2);
}

function evidenziaRiga(forza = false) {
  if (!st.righe.length) return;
  const t = audio.currentTime + ANTICIPO_TESTO;
  let attiva = -1;
  st.righe.forEach((r, i) => { if (r.t !== null && r.t <= t) attiva = i; });
  if (attiva === st.rigaAttiva && !forza) return;
  st.rigaAttiva = attiva;
  document.querySelectorAll('.testo .riga').forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle('attiva', i === attiva);
    el.classList.toggle('passata', attiva >= 0 && i < attiva && st.righe[i].t !== null);
  });
  const el = document.querySelector(`.testo .riga[data-i="${attiva}"]`);
  if (el) {
    const r = el.getBoundingClientRect();
    const basso = window.innerHeight - (barra?.offsetHeight ?? 0);
    // se la partitura è aperta resta ferma in alto: il testo scorre nello spazio sotto
    const sopra = st.mostraPartitura && st.partituraUI
      ? Math.max(0, st.partituraUI.testata.getBoundingClientRect().bottom) : 0;
    const spazio = basso - sopra;
    if (r.top < sopra + spazio * 0.1 || r.bottom > sopra + spazio * 0.7) {
      window.scrollTo({ top: window.scrollY + r.top - (sopra + spazio * 0.25), behavior: 'smooth' });
    }
  }
}

function ciclo() {
  if (st.ripetiA !== null && audio.currentTime >= st.ripetiA) audio.currentTime = st.ripetiDa;
  evidenziaRiga();
  aggiornaBarra();
  if (!audio.paused) requestAnimationFrame(ciclo);
}

audio.addEventListener('play', () => { aggiornaBarra(); requestAnimationFrame(ciclo); tieniSchermoAcceso(true); salvaInSilenzio(); });
audio.addEventListener('pause', () => { aggiornaBarra(); tieniSchermoAcceso(false); });
audio.addEventListener('ended', () => {
  if (st.ripetiA !== null) { audio.currentTime = st.ripetiDa; suona(); return; }
  const n = document.querySelectorAll('.schede-strofa button').length, tempi = tempiCorrenti();
  if (n > 1 && tempi && st.strofa < n - 1 && pref.get('strofeDiSeguito', true)) {
    st.strofa++; disegnaTesto();
    audio.currentTime = Math.max(0, tempi[0] - 1.5); suona(); return;
  }
  aggiornaBarra(); tieniSchermoAcceso(false);
});
audio.addEventListener('durationchange', aggiornaBarra);
audio.addEventListener('seeked', () => { evidenziaRiga(true); aggiornaBarra(); });
audio.addEventListener('error', () => {
  if (!barra || !audio.getAttribute('src')) return;
  $('#info-ripeti').textContent = 'Non riesco a caricare l\'audio. Controlla la connessione.';
});

/* Durante l'ascolto lo schermo resta acceso, così si può leggere il testo. */
async function tieniSchermoAcceso(si) {
  try {
    if (si && 'wakeLock' in navigator && !st.wakeLock) {
      st.wakeLock = await navigator.wakeLock.request('screen');
      st.wakeLock.addEventListener('release', () => { st.wakeLock = null; });
    } else if (!si && st.wakeLock) { await st.wakeLock.release(); st.wakeLock = null; }
  } catch { /* non supportato o negato */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !audio.paused) tieniSchermoAcceso(true);
});

/* ---------- Salvataggio sul telefono (per provare senza internet) ---------- */

function fileDellaVoce(brano, voce) {
  const parte = brano.parti[voce] || {};
  const partiture = Object.values(brano.partiture?.[voce] || {}).map(p => p.stampa || p.originale);
  return [brano.testo, brano.tempi, ...VERSIONI.map(v => parte[v.id]), ...partiture]
    .filter(Boolean).map(f => percorso(brano, f));
}

async function salvatoOffline(brano, voce) {
  const c = await cacheAudio();
  if (!c || !brano.parti[voce]) return false;
  for (const f of fileDellaVoce(brano, voce)) if (!(await c.match(f))) return false;
  return true;
}

/* Appena si ascolta una voce, i suoi file restano sul telefono: la volta dopo funziona anche senza rete. */
async function salvaInSilenzio() {
  const brano = st.brano, voce = st.voce;
  const c = await cacheAudio();
  if (!c || !brano || st.salvando) return;
  st.salvando = true;
  try {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    for (const f of fileDellaVoce(brano, voce)) {
      if (await c.match(f)) continue;
      const r = await fetch(f);
      if (r.ok) await c.put(f, r);
    }
  } catch { /* senza rete: si riproverà */ }
  st.salvando = false;
}

/* ---------- Avvio ---------- */

async function caricaCatalogo() {
  try {
    st.catalogo = JSON.parse(await leggiTesto('brani/catalogo.json'));
  } catch {
    st.catalogo = null;
  }
  // Teniamo una copia del catalogo per usarlo senza rete
  try {
    const c = await cacheAudio();
    if (c && st.catalogo) await c.put('brani/catalogo.json', new Response(JSON.stringify(st.catalogo), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* pazienza */ }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  st.installa = e;
  if (!st.brano && st.voce) paginaIniziale();
});
window.addEventListener('hashchange', mostra);

(async function avvio() {
  if ('serviceWorker' in navigator) {
    // Quando arriva una versione nuova dell'app, la pagina si ricarica da sola una volta
    const cera = !!navigator.serviceWorker.controller;
    let ricaricata = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (cera && !ricaricata) { ricaricata = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  grandezzaTesto(0);
  pref.set('velocitaSessione', 1);
  await caricaCatalogo();
  if (!st.catalogo) {
    app.replaceChildren(h('h1', {}, 'Prove del coro'),
      h('p', { class: 'errore' }, 'Non riesco a caricare l\'elenco dei brani. Controlla la connessione e riprova.'),
      h('button', { onclick: () => location.reload() }, 'Riprova'));
    return;
  }
  mostra();
})();
