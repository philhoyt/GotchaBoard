import { stateManager, state } from './stateManager.js';
import { apiFetch } from './api.js';
import { attachTagSuggestions } from './utils/tagSuggest.js';
import { getTagColor } from './utils/tagColor.js';
import { esc } from './utils/helpers.js';
import { toast } from './utils/toast.js';

let _detailSuggest = null;
let _sweepCards    = null; // set by initDetailPanel

// ── Open / close ───────────────────────────────────────────────────
export async function openDetail(imageId) {
  state.detailImageId = imageId;
  const image = await apiFetch(`/images/${imageId}`);

  const panel   = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const content = document.getElementById('detail-content');

  content.innerHTML = buildDetailHTML(image);
  panel.classList.add('open');
  overlay.classList.add('open');
  bindDetailEvents(image);
}

export function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('open');
  state.detailImageId = null;
  _detailSuggest?.destroy(); _detailSuggest = null;
}

// ── HTML builder ───────────────────────────────────────────────────
function buildDetailHTML(image) {
  const saved   = new Date(image.saved_at).toLocaleString();
  const imgSrc  = image.filename ? `/images/${image.filename}` : null;
  const imageTags = image.tags || [];

  const tagPills = imageTags.map(name => {
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="detail-tag-pill" data-tag="${esc(name)}" ${style}>${esc(name)}<button class="detail-tag-remove" title="Remove tag">&times;</button></span>`;
  }).join('');

  return `
    <div class="detail-image-wrap">
      ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(image.page_title || '')}">` : '<div style="height:120px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:12px;color:#9ca3af">No preview</div>'}
    </div>
    <div class="detail-field">
      <div class="detail-label">Source</div>
      <div class="detail-value-url"><a href="${esc(image.source_url)}" target="_blank" rel="noopener" title="${esc(image.source_url)}">${esc(image.source_url)}</a></div>
    </div>
    <div class="detail-field">
      <div class="detail-label">Title</div>
      <input type="text" class="detail-title-input" id="detail-title-input"
             value="${esc(image.page_title || '')}" placeholder="Add a title…">
    </div>
    ${image.page_url   ? `<div class="detail-field"><div class="detail-label">Page URL</div><div class="detail-value-url"><a href="${esc(image.page_url)}" target="_blank" rel="noopener" title="${esc(image.page_url)}">${esc(image.page_url)}</a></div></div>` : ''}
    ${image.pin_url    ? `<div class="detail-field"><div class="detail-label">Pinterest Pin</div><div class="detail-value-url"><a href="${esc(image.pin_url)}" target="_blank" rel="noopener" title="${esc(image.pin_url)}">${esc(image.pin_url)}</a></div></div>` : ''}
    <div class="detail-field"><div class="detail-label">Saved</div><div class="detail-value">${esc(saved)}</div></div>
    <div class="detail-field">
      <div class="detail-label">Tags</div>
      <div class="detail-tags-wrap" id="detail-tags-wrap">
        ${tagPills}
        <input type="text" class="detail-add-tag-input" id="detail-add-tag" placeholder="+ add tag" />
      </div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-ghost" id="detail-open-source">Open Source</button>
      <button class="btn btn-danger" id="detail-delete">Delete</button>
    </div>
  `;
}

// ── Tag helpers ────────────────────────────────────────────────────
function getDetailTags() {
  return [...document.querySelectorAll('#detail-tags-wrap .detail-tag-pill')]
    .map(el => el.dataset.tag);
}

function addDetailTagPill(name, imageId) {
  const wrap  = document.getElementById('detail-tags-wrap');
  const input = document.getElementById('detail-add-tag');
  const t     = state.tags.find(t => t.name === name);
  const color = t?.color || getTagColor(name);

  const pill = document.createElement('span');
  pill.className = 'detail-tag-pill';
  pill.dataset.tag = name;
  if (color) pill.style.background = color;
  pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove tag">&times;</button>`;
  pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
    pill.remove();
    saveDetailTags(imageId);
  });

  wrap.insertBefore(pill, input);
}

// ── Save ───────────────────────────────────────────────────────────
async function saveDetailTitle(image, newTitle) {
  const trimmed = newTitle.trim();
  if (trimmed === (image.page_title || '')) return;
  try {
    await apiFetch(`/images/${image.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ page_title: trimmed || null }),
    });
    image.page_title = trimmed || null;
    const card = document.querySelector(`.image-card[data-id="${image.id}"]`);
    if (card) {
      const titleEl = card.querySelector('.card-title');
      if (titleEl) titleEl.textContent = trimmed || '';
    }
  } catch (err) {
    console.error('Failed to update title:', err);
  }
}

async function saveDetailTags(imageId) {
  const tags = getDetailTags();
  try {
    await apiFetch(`/images/${imageId}`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    await stateManager.onTagsChanged([imageId], {
      onRemove: async (removedIds) => {
        closeDetail();
        if (_sweepCards) await _sweepCards(removedIds);
      }
    });
  } catch {
    toast('Failed to save tags');
  }
}

// ── Event binding ──────────────────────────────────────────────────
function bindDetailEvents(image) {
  const titleInput = document.getElementById('detail-title-input');
  titleInput.addEventListener('blur', () => saveDetailTitle(image, titleInput.value));
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    if (e.key === 'Escape') { titleInput.value = image.page_title || ''; titleInput.blur(); }
  });

  document.querySelectorAll('.detail-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.detail-tag-pill').remove();
      saveDetailTags(image.id);
    });
  });

  const addInput = document.getElementById('detail-add-tag');

  const commitDetailTag = (name) => {
    if (!name || getDetailTags().includes(name)) return;
    addDetailTagPill(name, image.id);
    saveDetailTags(image.id);
  };

  _detailSuggest?.destroy();
  _detailSuggest = attachTagSuggestions(addInput, () => state.tags, (name) => {
    commitDetailTag(name);
  });

  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = addInput.value.trim();
      if (!val) return;
      commitDetailTag(val);
      addInput.value = '';
    }
    if (e.key === 'Escape') addInput.blur();
  });

  document.getElementById('detail-open-source').addEventListener('click', () => window.open(image.source_url, '_blank', 'noopener'));

  document.getElementById('detail-delete').addEventListener('click', async () => {
    if (!confirm('Delete this Got? This cannot be undone.')) return;
    try {
      await apiFetch(`/images/${image.id}`, { method: 'DELETE' });
      closeDetail();
      if (_sweepCards) await _sweepCards([image.id]);
      state.images      = state.images.filter(i => i.id !== image.id);
      state.totalImages = Math.max(0, state.totalImages - 1);
      stateManager.updateCounts();
      await stateManager.loadTags();
    } catch (err) { alert(`Failed to delete: ${err.message}`); }
  });
}

// ── Init ───────────────────────────────────────────────────────────
export function initDetailPanel({ sweepCards }) {
  _sweepCards = sweepCards;
}
