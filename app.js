'use strict';

const STORAGE_KEY = 'mangatracker_v1';

// ─── Data ────────────────────────────────────────────────────────

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { series: [] };
  } catch {
    return { series: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Wikipedia API ───────────────────────────────────────────────

async function wikiSearch(query) {
  const url = `https://it.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=6`;
  const r = await fetch(url);
  const j = await r.json();
  return j.query.search;
}

async function wikiSummary(pageTitle) {
  const url = `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Pagina non trovata');
  return r.json();
}

async function fetchVolumeDescriptions(wikiUrl) {
  const m = wikiUrl.match(/wikipedia\.org\/wiki\/(.+?)(?:#.*)?$/);
  if (!m) throw new Error('URL non valido');
  const pageTitle = decodeURIComponent(m[1]);
  const apiUrl = `https://it.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json&origin=*&disableeditsection=1`;
  const r = await fetch(apiUrl);
  const j = await r.json();
  if (j.error) throw new Error(j.error.info);
  const doc = new DOMParser().parseFromString(j.parse.text['*'], 'text/html');
  return parseVolumeDescriptions(doc);
}

function parseVolumeDescriptions(doc) {
  const result = {};
  for (const table of doc.querySelectorAll('table.wikitable')) {
    const rows = Array.from(table.querySelectorAll('tr'));
    for (let i = 0; i < rows.length; i++) {
      const tds = Array.from(rows[i].querySelectorAll('td'));
      if (!tds.length) continue;
      // Volume row: first cell contains only a number
      if (!/^\d+$/.test(tds[0].textContent.trim())) continue;
      const volNum = parseInt(tds[0].textContent.trim());
      // Look ahead up to 4 rows; skip chapter-list rows (contain <li>), take first plain-text single cell
      for (let j = i + 1; j <= Math.min(i + 4, rows.length - 1); j++) {
        const next = Array.from(rows[j].querySelectorAll('td'));
        if (next.length !== 1) continue;
        if (next[0].querySelector('li')) continue; // riga capitoli — salta
        const text = next[0].textContent
          .trim()
          .replace(/\[\d+\]/g, '')
          .replace(/\s+/g, ' ');
        if (text.length > 15) result[volNum] = text;
        break;
      }
    }
  }
  return result;
}

function wikiLargerThumb(url) {
  if (!url) return url;
  // Wikipedia thumbnail URLs have /NNNpx- in path; bump to 400px
  return url.replace(/\/\d+px-/, '/400px-');
}

// ─── State ───────────────────────────────────────────────────────

let currentFilter = 'all';
let currentDetailId = null;
let pendingVolumeDescriptions = {};

// ─── Status helpers ──────────────────────────────────────────────

const STATUS = {
  da_iniziare: 'Da iniziare',
  in_corso: 'In corso',
  finita: 'Finita',
};

// ─── Render ──────────────────────────────────────────────────────

function renderGrid() {
  const data = loadData();
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');

  const filtered = currentFilter === 'all'
    ? data.series
    : data.series.filter(s => s.status === currentFilter);

  document.getElementById('totalCount').textContent = data.series.length;
  document.getElementById('inCorsoCount').textContent = data.series.filter(s => s.status === 'in_corso').length;
  document.getElementById('finitaCount').textContent = data.series.filter(s => s.status === 'finita').length;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  grid.innerHTML = filtered.map(s => cardHTML(s)).join('');
}

function cardHTML(s) {
  const read = s.volumes.filter(v => v.read).length;
  const total = s.volumes.length;
  const pct = total > 0 ? Math.round((read / total) * 100) : 0;

  const cover = s.coverUrl
    ? `<img src="${escHtml(s.coverUrl)}" alt="${escHtml(s.title)}" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="no-cover">漫</div>`;

  return `
    <div class="card" data-id="${s.id}" onclick="openDetail('${s.id}')">
      <div class="card-cover">
        ${cover}
        <span class="status-badge status-${s.status}">${STATUS[s.status]}</span>
      </div>
      <div class="card-info">
        <h3 class="card-title">${escHtml(s.title)}</h3>
        <div class="card-progress">
          <span class="progress-text">${read}/${total} vol.</span>
          <div class="progress-bar-small">
            <div class="progress-fill-small" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    </div>`;
}

// ─── Detail modal ────────────────────────────────────────────────

function openDetail(id) {
  const data = loadData();
  const s = data.series.find(x => x.id === id);
  if (!s) return;

  currentDetailId = id;

  document.getElementById('detailTitle').textContent = s.title;

  const img = document.getElementById('detailCover');
  const placeholder = document.getElementById('detailCoverPlaceholder');
  if (s.coverUrl) {
    img.src = s.coverUrl;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    img.onerror = () => { img.style.display = 'none'; placeholder.style.display = 'flex'; };
  } else {
    img.src = '';
    img.style.display = 'none';
    placeholder.style.display = 'flex';
  }

  document.getElementById('detailSummary').textContent = s.summary || 'Nessun riassunto disponibile.';

  const badge = document.getElementById('detailStatusBadge');
  badge.textContent = STATUS[s.status];
  badge.className = `status-badge status-${s.status}`;

  const read = s.volumes.filter(v => v.read).length;
  const total = s.volumes.length;
  const pct = total > 0 ? Math.round((read / total) * 100) : 0;

  document.getElementById('detailProgressText').textContent = `${read} / ${total} volumi letti`;
  document.getElementById('detailProgressPct').textContent = `${pct}%`;
  document.getElementById('detailProgressFill').style.width = `${pct}%`;

  const volGrid = document.getElementById('detailVolumes');
  volGrid.innerHTML = s.volumes
    .map((v, i) => `
      <div class="volume-item ${v.read ? 'read' : 'unread'}${v.description ? ' has-desc' : ''}"
           data-idx="${i}"
           title="Vol. ${v.number}${v.description ? ' — passa il mouse per la trama' : ''}">
        <span class="vol-number">${v.number}</span>
        <span class="vol-check">${v.read ? '✓' : ''}</span>
      </div>`)
    .join('');

  const descPanel = document.getElementById('volDescPanel');
  const descNum = document.getElementById('volDescNum');
  const descText = document.getElementById('volDescText');
  const readBtn = document.getElementById('volToggleReadBtn');
  descPanel.hidden = s.volumes.length === 0;

  const selectVolume = (idx) => {
    const v = s.volumes[idx];
    if (!v) return;
    volGrid.querySelectorAll('.volume-item').forEach((el, i) =>
      el.classList.toggle('selected', i === idx));
    descNum.textContent = `Volume ${v.number}`;
    descText.textContent = v.description || 'Nessuna descrizione disponibile.';
    descText.classList.toggle('vol-desc-empty', !v.description);
    readBtn.textContent = v.read ? '✓ Letto' : 'Segna letto';
    readBtn.classList.toggle('btn-read', v.read);
    readBtn.dataset.idx = idx;
  };

  volGrid.querySelectorAll('.volume-item').forEach(el => {
    el.addEventListener('click', () => selectVolume(parseInt(el.dataset.idx)));
  });

  selectVolume(0);

  document.getElementById('detailModal').classList.add('active');
}

function toggleVolume(seriesId, idx) {
  const data = loadData();
  const s = data.series.find(x => x.id === seriesId);
  if (!s) return;
  s.volumes[idx].read = !s.volumes[idx].read;
  saveData(data);
  openDetail(seriesId);
  renderGrid();
}

// ─── Add / Edit modal ────────────────────────────────────────────

function openAddModal(editId = null) {
  document.getElementById('seriesForm').reset();
  document.getElementById('editId').value = editId || '';
  document.getElementById('wikiResults').innerHTML = '';
  document.getElementById('wikiSearch').value = '';
  document.getElementById('coverPreviewWrap').style.display = 'none';
  document.getElementById('volLoadStatus').textContent = '';
  document.getElementById('volWikiResults').innerHTML = '';
  document.getElementById('volWikiSearch').value = '';
  document.getElementById('volWikiInput').value = '';
  document.getElementById('volUrlRow').style.display = 'none';
  pendingVolumeDescriptions = {};

  if (editId) {
    const s = loadData().series.find(x => x.id === editId);
    if (s) {
      document.getElementById('modalTitle').textContent = 'Modifica Serie';
      document.getElementById('titleInput').value = s.title;
      document.getElementById('statusInput').value = s.status;
      document.getElementById('volumesInput').value = s.volumes.length;
      document.getElementById('coverInput').value = s.coverUrl || '';
      document.getElementById('summaryInput').value = s.summary || '';
      if (s.volWikiUrl) {
        document.getElementById('volWikiInput').value = s.volWikiUrl;
        document.getElementById('volUrlRow').style.display = 'flex';
        // Pre-popola il campo di ricerca col titolo della serie
        document.getElementById('volWikiSearch').value = s.title;
      }
      if (s.coverUrl) {
        document.getElementById('coverPreview').src = s.coverUrl;
        document.getElementById('coverPreviewWrap').style.display = 'block';
      }
      // Pre-carica le descrizioni esistenti
      s.volumes.forEach(v => { if (v.description) pendingVolumeDescriptions[v.number] = v.description; });
      const loaded = Object.keys(pendingVolumeDescriptions).length;
      if (loaded) setVolLoadStatus(`${loaded} descrizioni già caricate`, 'ok');
    }
  } else {
    document.getElementById('modalTitle').textContent = 'Aggiungi Serie';
  }

  document.getElementById('addModal').classList.add('active');
}

document.getElementById('seriesForm').addEventListener('submit', e => {
  e.preventDefault();

  const data = loadData();
  const editId = document.getElementById('editId').value;
  const title = document.getElementById('titleInput').value.trim();
  const status = document.getElementById('statusInput').value;
  const volCount = Math.max(1, parseInt(document.getElementById('volumesInput').value) || 1);
  const coverUrl = document.getElementById('coverInput').value.trim();
  const summary = document.getElementById('summaryInput').value.trim();
  const volWikiUrl = document.getElementById('volWikiInput').value.trim();

  const buildVolumes = (count, prev = []) =>
    Array.from({ length: count }, (_, i) => {
      const existing = prev.find(v => v.number === i + 1);
      return {
        number: i + 1,
        read: existing ? existing.read : false,
        description: pendingVolumeDescriptions[i + 1] || existing?.description || '',
      };
    });

  if (editId) {
    const s = data.series.find(x => x.id === editId);
    if (s) {
      s.title = title;
      s.status = status;
      s.coverUrl = coverUrl;
      s.summary = summary;
      s.volWikiUrl = volWikiUrl;
      s.volumes = buildVolumes(volCount, s.volumes);
    }
  } else {
    data.series.push({
      id: uid(),
      title,
      status,
      coverUrl,
      summary,
      volWikiUrl,
      volumes: buildVolumes(volCount),
      addedAt: new Date().toISOString(),
    });
  }

  saveData(data);
  document.getElementById('addModal').classList.remove('active');
  renderGrid();
});

// ─── Wikipedia search interactions ──────────────────────────────

document.getElementById('wikiSearchBtn').addEventListener('click', runWikiSearch);
document.getElementById('wikiSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); runWikiSearch(); }
});

async function runWikiSearch() {
  const query = document.getElementById('wikiSearch').value.trim();
  if (!query) return;

  const btn = document.getElementById('wikiSearchBtn');
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const results = await wikiSearch(query);
    const div = document.getElementById('wikiResults');

    if (!results.length) {
      div.innerHTML = '<p class="wiki-no-results">Nessun risultato trovato</p>';
    } else {
      div.innerHTML = results.map(r => `
        <div class="wiki-result" data-title="${escHtml(r.title)}">
          <strong>${escHtml(r.title)}</strong>
          <small>${escHtml(r.snippet.replace(/<[^>]+>/g, ''))}</small>
        </div>`).join('');
      div.querySelectorAll('.wiki-result').forEach(el => {
        el.addEventListener('click', () => pickWikiResult(el.dataset.title));
      });
    }
  } catch {
    document.getElementById('wikiResults').innerHTML = '<p class="wiki-error">Errore di rete. Riprova.</p>';
  }

  btn.textContent = 'Cerca';
  btn.disabled = false;
}

async function pickWikiResult(title) {
  document.getElementById('wikiResults').innerHTML = '<p class="wiki-no-results">Caricamento...</p>';
  try {
    const data = await wikiSummary(title);
    document.getElementById('titleInput').value = data.title || title;
    document.getElementById('summaryInput').value = data.extract || '';

    if (data.thumbnail?.source) {
      const url = wikiLargerThumb(data.thumbnail.source);
      document.getElementById('coverInput').value = url;
      document.getElementById('coverPreview').src = url;
      document.getElementById('coverPreviewWrap').style.display = 'block';
    }

    document.getElementById('wikiResults').innerHTML = '';
    document.getElementById('wikiSearch').value = '';
  } catch {
    document.getElementById('wikiResults').innerHTML = '<p class="wiki-error">Errore nel caricamento della pagina Wikipedia.</p>';
  }
}

// ─── Load volumes from Wikipedia ────────────────────────────────

function setVolLoadStatus(msg, type) {
  const el = document.getElementById('volLoadStatus');
  el.textContent = msg;
  el.className = `form-hint ${type === 'ok' ? 'form-hint-ok' : type === 'err' ? 'form-hint-err' : ''}`;
}

document.getElementById('volWikiSearchBtn').addEventListener('click', runVolWikiSearch);
document.getElementById('volWikiSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); runVolWikiSearch(); }
});

async function runVolWikiSearch() {
  const query = document.getElementById('volWikiSearch').value.trim();
  if (!query) return;

  const btn = document.getElementById('volWikiSearchBtn');
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const results = await wikiSearch(query);
    const div = document.getElementById('volWikiResults');

    if (!results.length) {
      div.innerHTML = '<p class="wiki-no-results">Nessun risultato trovato</p>';
    } else {
      div.innerHTML = results.map(r => `
        <div class="wiki-result" data-title="${escHtml(r.title)}">
          <strong>${escHtml(r.title)}</strong>
          <small>${escHtml(r.snippet.replace(/<[^>]+>/g, ''))}</small>
        </div>`).join('');
      div.querySelectorAll('.wiki-result').forEach(el => {
        el.addEventListener('click', () => pickVolWikiResult(el.dataset.title));
      });
    }
  } catch {
    document.getElementById('volWikiResults').innerHTML = '<p class="wiki-error">Errore di rete. Riprova.</p>';
  }

  btn.textContent = 'Cerca';
  btn.disabled = false;
}

async function pickVolWikiResult(pageTitle) {
  const url = `https://it.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
  document.getElementById('volWikiInput').value = url;
  document.getElementById('volUrlRow').style.display = 'flex';
  document.getElementById('volWikiResults').innerHTML = '';
  document.getElementById('volWikiSearch').value = pageTitle;
  // Avvia subito il caricamento
  document.getElementById('loadVolumesBtn').click();
}

document.getElementById('loadVolumesBtn').addEventListener('click', async () => {
  const url = document.getElementById('volWikiInput').value.trim();
  if (!url) { setVolLoadStatus('Inserisci un URL Wikipedia', 'err'); return; }

  const btn = document.getElementById('loadVolumesBtn');
  btn.textContent = '...';
  btn.disabled = true;
  setVolLoadStatus('Caricamento...', '');

  try {
    pendingVolumeDescriptions = await fetchVolumeDescriptions(url);
    const count = Object.keys(pendingVolumeDescriptions).length;
    if (count === 0) {
      setVolLoadStatus('Nessuna descrizione trovata in questa pagina.', 'err');
    } else {
      const maxVol = Math.max(...Object.keys(pendingVolumeDescriptions).map(Number));
      const currentCount = parseInt(document.getElementById('volumesInput').value) || 1;
      if (maxVol > currentCount) document.getElementById('volumesInput').value = maxVol;
      setVolLoadStatus(`✓ ${count} descrizioni caricate (vol. 1–${maxVol})`, 'ok');
    }
  } catch (err) {
    setVolLoadStatus(`Errore: ${err.message}`, 'err');
  }

  btn.textContent = 'Carica';
  btn.disabled = false;
});

// ─── Cover preview on URL input ─────────────────────────────────

document.getElementById('coverInput').addEventListener('input', e => {
  const url = e.target.value.trim();
  const wrap = document.getElementById('coverPreviewWrap');
  if (url) {
    document.getElementById('coverPreview').src = url;
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
  }
});

// ─── Filters ────────────────────────────────────────────────────

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderGrid();
  });
});

// ─── Detail modal actions ────────────────────────────────────────

document.getElementById('editSeriesBtn').addEventListener('click', () => {
  document.getElementById('detailModal').classList.remove('active');
  openAddModal(currentDetailId);
});

document.getElementById('deleteSeriesBtn').addEventListener('click', () => {
  if (!currentDetailId || !confirm('Eliminare questa serie?')) return;
  const data = loadData();
  data.series = data.series.filter(s => s.id !== currentDetailId);
  saveData(data);
  document.getElementById('detailModal').classList.remove('active');
  renderGrid();
});

document.getElementById('volToggleReadBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  const idx = parseInt(document.getElementById('volToggleReadBtn').dataset.idx);
  if (isNaN(idx)) return;
  const data = loadData();
  const s = data.series.find(x => x.id === currentDetailId);
  if (!s || !s.volumes[idx]) return;
  s.volumes[idx].read = !s.volumes[idx].read;
  saveData(data);
  openDetail(currentDetailId);
  renderGrid();
  // Re-seleziona lo stesso volume dopo il re-render
  document.querySelector(`.volume-item[data-idx="${idx}"]`)?.click();
});

document.getElementById('markAllReadBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  const data = loadData();
  const s = data.series.find(x => x.id === currentDetailId);
  if (s) { s.volumes.forEach(v => v.read = true); saveData(data); openDetail(currentDetailId); renderGrid(); }
});

document.getElementById('markAllUnreadBtn').addEventListener('click', () => {
  if (!currentDetailId) return;
  const data = loadData();
  const s = data.series.find(x => x.id === currentDetailId);
  if (s) { s.volumes.forEach(v => v.read = false); saveData(data); openDetail(currentDetailId); renderGrid(); }
});

// ─── Modal close ────────────────────────────────────────────────

function closeOnOverlay(modalId) {
  document.getElementById(modalId).addEventListener('click', e => {
    if (e.target.id === modalId) document.getElementById(modalId).classList.remove('active');
  });
}
closeOnOverlay('addModal');
closeOnOverlay('detailModal');

document.getElementById('addBtn').addEventListener('click', () => openAddModal());
document.getElementById('closeAddModal').addEventListener('click', () => document.getElementById('addModal').classList.remove('active'));
document.getElementById('cancelAdd').addEventListener('click', () => document.getElementById('addModal').classList.remove('active'));
document.getElementById('closeDetailModal').addEventListener('click', () => document.getElementById('detailModal').classList.remove('active'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

// ─── Export / Import ────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(loadData(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'manga-data.json',
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importInput').click());

document.getElementById('importInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data?.series)) throw new Error();
      saveData(data);
      renderGrid();
      alert('Importazione completata!');
    } catch {
      alert('File JSON non valido.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── Utility ────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ────────────────────────────────────────────────────────

async function init() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    await loadFromRepo({ silent: true });
  }
  renderGrid();
}

async function loadFromRepo({ silent = false } = {}) {
  try {
    const r = await fetch('./data.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data?.series)) throw new Error('Formato non valido');
    saveData(data);
    return data.series.length;
  } catch (err) {
    if (!silent) throw err;
    return null;
  }
}

document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  try {
    const count = await loadFromRepo();
    renderGrid();
    alert(`Dati ricaricati dal repository (${count} serie).`);
  } catch (err) {
    alert(`Impossibile caricare data.json: ${err.message}\nAssicurati che il file esista nel repository.`);
  }
  btn.disabled = false;
});

init();
