/**
 * tokenHelper.js — Token Helper tab
 */
import { addTrackedListener, debounce, truncated } from './utils.js';
import { createDebugLogger } from '../debugMode.js';
import OBR from "@owlbear-rodeo/sdk";

const logger = createDebugLogger('tokenHelper');

let _cache = [];
let _meId  = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function initTokenHelperUI() {
  const search    = document.getElementById('tokensSearch');
  const filter    = document.getElementById('tokensFilter');
  const refreshBtn = document.getElementById('tokensRefresh');

  if (search)     addTrackedListener(search,     'input',  debounce(() => _applyAndRender(), 220));
  if (filter)     addTrackedListener(filter,     'change', () => _applyAndRender());
  if (refreshBtn) addTrackedListener(refreshBtn, 'click',  () => refresh());
}

export async function refresh() {
  const statusEl  = document.getElementById('tokensStatus');
  const refreshBtn = document.getElementById('tokensRefresh');
  try {
    if (refreshBtn) refreshBtn.disabled = true;
    if (statusEl)   statusEl.textContent = 'Fetching scene items…';
    _meId  = await _getCurrentUserId();
    _cache = await _fetchItems();
    _applyAndRender();
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Failed to fetch items.';
    logger.error('[TOKEN_HELPER] refresh failed:', err);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _getCurrentUserId() {
  if (_meId) return _meId;
  try { if (OBR?.player?.id) return OBR.player.id; } catch { /* ignore */ }
  return null;
}

async function _fetchItems() {
  try {
    if (OBR?.scene?.items?.getItems) return await OBR.scene.items.getItems();
    if (OBR?.scene?.getItems)        return await OBR.scene.getItems();
    throw new Error('No compatible OBR scene item API');
  } catch (err) {
    logger.error('[TOKEN_HELPER] fetchItems failed:', err);
    return [];
  }
}

async function _applyAndRender() {
  try {
    const q      = (document.getElementById('tokensSearch')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('tokensFilter')?.value || 'all';
    const statusEl = document.getElementById('tokensStatus');

    if (filter === 'me' && !_meId) {
      _meId = await _getCurrentUserId();
      if (!_meId) {
        const c = document.getElementById('tokensList');
        if (c) c.innerHTML = '<div style="color:#ffb86b;">Could not detect current user ID.</div>';
        if (statusEl) statusEl.textContent = 'Could not detect current user ID';
        return;
      }
    }

    let items = [..._cache];
    if (filter === 'me' && _meId) {
      items = items.filter(i => {
        const cid = i.createdUserId || i.createdBy || i.ownerId || null;
        return cid && String(cid).trim() === String(_meId).trim();
      });
    }
    if (q) {
      items = items.filter(i => {
        const text = i.text ? (i.text.plainText || '') : '';
        return `${i.name || ''} ${i.id || ''} ${i.type || ''} ${text}`.toLowerCase().includes(q);
      });
    }

    _renderList(items);
  } catch (err) {
    logger.error('[TOKEN_HELPER] filter/render failed:', err);
  }
}

function _renderList(items) {
  const container = document.getElementById('tokensList');
  const statusEl  = document.getElementById('tokensStatus');
  if (!container) return;
  container.textContent = '';

  if (!items || items.length === 0) {
    container.innerHTML = '<div style="color:#666">No items found in the scene.</div>';
    if (statusEl) statusEl.textContent = '';
    return;
  }

  const groups = {};
  items.forEach(it => {
    const layer = it.layer || 'UNKNOWN';
    if (!groups[layer]) groups[layer] = [];
    groups[layer].push(it);
  });

  Object.keys(groups).sort().forEach(layer => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'page-item';
    groupDiv.style.marginBottom = '10px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    header.innerHTML = `<strong style="color:#c8adff">${layer} — ${groups[layer].length} items </strong>
      <div style="display:flex;gap:8px;">
        <button type="button" class="btn-small" data-action="expandAll">Expand all</button>
        <button type="button" class="btn-small" data-action="collapseAll">Collapse all</button>
      </div>`;
    header.querySelector('[data-action="expandAll"]').onclick   = () => toggleFns.forEach(fn => fn(true));
    header.querySelector('[data-action="collapseAll"]').onclick = () => toggleFns.forEach(fn => fn(false));
    groupDiv.appendChild(header);

    const frag = document.createDocumentFragment();
    const toggleFns = [];
    groups[layer].forEach(it => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'variable-item token-item';
      itemDiv.style.cssText = 'cursor:pointer;flex-direction:column;';

      const summary = document.createElement('div');
      summary.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;';

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;gap:12px;align-items:center;flex:1;overflow:hidden;';

      const badge = document.createElement('span');
      badge.className = 'layout-item-type';
      badge.textContent = it.type || '?';
      left.appendChild(badge);

      const nameText = it.name || (it.text?.plainText) || it.id || '';
      const nameEl = document.createElement('span');
      nameEl.innerHTML = `<strong>${truncated(nameText, 36)}</strong>`;
      nameEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      left.appendChild(nameEl);

      const meta = document.createElement('span');
      meta.style.cssText = 'color:#bbb;font-size:0.9em;white-space:nowrap;';
      meta.textContent = `${it.layer || ''} • ${it.visible ? 'visible' : 'hidden'}`;
      left.appendChild(meta);
      summary.appendChild(left);

      const right = document.createElement('div');
      right.style.cssText = 'display:flex;gap:8px;align-items:center;';

      const idCode = document.createElement('code');
      idCode.style.fontSize = '0.8em';
      idCode.textContent = truncated(it.id, 20);
      idCode.title = it.id;
      right.appendChild(idCode);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-small';
      copyBtn.textContent = 'Copy ID';
      copyBtn.onclick = async e => {
        e.preventDefault(); e.stopPropagation();
        try {
          await _copyToClipboard(`${it.id}`);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy ID'; }, 1200);
        } catch { /* ignore */ }
      };
      right.appendChild(copyBtn);
      summary.appendChild(right);
      itemDiv.appendChild(summary);

      const details = document.createElement('div');
      details.style.display = 'none';
      details.style.marginTop = '8px';
      details.dataset.populated = 'false';
      itemDiv.appendChild(details);

      summary.onclick = () => toggle();

      const toggle = (forceExpand) => {
        const shouldExpand = forceExpand !== undefined ? forceExpand : details.style.display === 'none';
        if (shouldExpand) {
          if (details.dataset.populated !== 'true') {
            const pre = document.createElement('pre');
            pre.style.cssText = 'white-space:pre-wrap;font-family:monospace;font-size:0.85em;margin:0;';
            pre.textContent = JSON.stringify(it, null, 2);
            details.appendChild(pre);
            details.dataset.populated = 'true';
          }
          details.style.display = 'block';
          itemDiv.classList.add('expanded');
        } else {
          details.style.display = 'none';
          itemDiv.classList.remove('expanded');
        }
      };
      toggleFns.push(toggle);

      frag.appendChild(itemDiv);
    });
    groupDiv.appendChild(frag);
    container.appendChild(groupDiv);
  });

  if (statusEl) statusEl.textContent = `Loaded ${items.length} items`;
}

async function _copyToClipboard(text) {
  try {
    const perm = await navigator.permissions?.query({ name: 'clipboard-write' }).catch(() => ({ state: 'prompt' }));
    if (perm.state === 'granted' || perm.state === 'prompt') {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fallback */ }
  // execCommand fallback
  const ta = Object.assign(document.createElement('textarea'), {
    value: text, style: 'position:fixed;left:-9999px;top:0;'
  });
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}
