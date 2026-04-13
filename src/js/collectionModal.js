import { stateManager, state } from './stateManager.js';
import { apiFetch } from './api.js';
import { attachTagSuggestions } from './utils/tagSuggest.js';
import { getTagColor } from './utils/tagColor.js';
import { esc } from './utils/helpers.js';

let _collectionModal    = null;
let _collectionSuggest  = null;
let _editingCollectionId = null;

// ── Modal DOM builder ──────────────────────────────────────────────
function _createCollectionModal() {
  const modal = document.createElement('div');
  modal.id = 'collection-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div id="collection-modal-backdrop"></div>
    <div id="collection-modal-dialog" role="dialog" aria-modal="true">
      <h3 id="collection-modal-title">New Collection</h3>
      <div class="collection-form-row">
        <input type="text" id="collection-name-input" placeholder="Collection name" maxlength="100" />
      </div>
      <div class="collection-form-row">
        <div class="collection-operator-row">
          <label>Show images matching</label>
          <div class="collection-operator-toggle">
            <button type="button" class="operator-btn active" data-op="OR">Any tag</button>
            <button type="button" class="operator-btn" data-op="AND">All tags</button>
          </div>
        </div>
        <div class="detail-tags-wrap" id="collection-selected-tags"></div>
        <div style="margin-top:6px">
          <input type="text" class="detail-add-tag-input" id="collection-tag-input" placeholder="+ add tag" autocomplete="off" />
        </div>
      </div>
      <p id="collection-match-count" class="collection-match-count"></p>
      <div id="collection-modal-actions">
        <button id="collection-modal-cancel" class="btn">Cancel</button>
        <button id="collection-modal-save" class="btn btn-primary" disabled>Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#collection-modal-backdrop').addEventListener('click', closeCollectionModal);
  modal.querySelector('#collection-modal-cancel').addEventListener('click', closeCollectionModal);
  modal.querySelector('#collection-modal-save').addEventListener('click', saveCollection);
  modal.querySelectorAll('.operator-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.operator-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateCollectionMatchCount();
    });
  });
  modal.querySelector('#collection-name-input').addEventListener('input', updateCollectionSaveBtn);
  modal.querySelector('#collection-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !getCollectionTagNames().includes(val)) {
        addCollectionTagPill(val);
        updateCollectionSaveBtn();
        updateCollectionMatchCount();
      }
      e.target.value = '';
    }
    if (e.key === 'Escape') closeCollectionModal();
  });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCollectionModal();
  });

  return modal;
}

// ── Open / close ───────────────────────────────────────────────────
export function openCollectionModal(mode, col = null) {
  _editingCollectionId = mode === 'edit' ? col.id : null;

  if (!_collectionModal) _collectionModal = _createCollectionModal();

  const isEdit = mode === 'edit';
  _collectionModal.querySelector('#collection-modal-title').textContent = isEdit ? 'Edit Collection' : 'New Collection';
  const saveBtn = _collectionModal.querySelector('#collection-modal-save');
  saveBtn.textContent = isEdit ? 'Save' : 'Create';

  const nameInput = _collectionModal.querySelector('#collection-name-input');
  nameInput.value = isEdit ? col.name : '';

  const selectedTags = _collectionModal.querySelector('#collection-selected-tags');
  selectedTags.innerHTML = '';
  const op = isEdit ? ((col.tag_query?.operator) || 'OR') : 'OR';
  _collectionModal.querySelectorAll('.operator-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.op === op);
  });
  if (isEdit) {
    const tq = col.tag_query || { tags: [] };
    (tq.tags || []).forEach(name => addCollectionTagPill(name));
  }

  _collectionSuggest?.destroy();
  const tagInput = _collectionModal.querySelector('#collection-tag-input');
  tagInput.value = '';
  _collectionSuggest = attachTagSuggestions(tagInput, () => state.tags, name => {
    if (getCollectionTagNames().includes(name)) return;
    addCollectionTagPill(name);
    tagInput.value = '';
    updateCollectionSaveBtn();
    updateCollectionMatchCount();
  });

  _collectionModal.hidden = false;
  updateCollectionSaveBtn();
  updateCollectionMatchCount();
  setTimeout(() => nameInput.focus(), 50);
}

export function closeCollectionModal() {
  if (_collectionModal) _collectionModal.hidden = true;
  _collectionSuggest?.destroy();
  _collectionSuggest = null;
  _editingCollectionId = null;
}

// ── Tag pills ──────────────────────────────────────────────────────
function addCollectionTagPill(name) {
  const wrap = _collectionModal.querySelector('#collection-selected-tags');
  const t = state.tags.find(t => t.name === name);
  const color = t?.color || getTagColor(name);
  const pill = document.createElement('span');
  pill.className = 'detail-tag-pill';
  pill.dataset.tag = name;
  pill.style.background = color;
  pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
  pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
    pill.remove();
    updateCollectionSaveBtn();
    updateCollectionMatchCount();
  });
  wrap.appendChild(pill);
}

function getCollectionTagNames() {
  if (!_collectionModal) return [];
  return [..._collectionModal.querySelectorAll('#collection-selected-tags .detail-tag-pill')].map(p => p.dataset.tag);
}

function updateCollectionSaveBtn() {
  const name = _collectionModal?.querySelector('#collection-name-input')?.value.trim();
  const tags = getCollectionTagNames();
  const btn  = _collectionModal?.querySelector('#collection-modal-save');
  if (btn) btn.disabled = !name || tags.length === 0;
}

async function updateCollectionMatchCount() {
  const names = getCollectionTagNames();
  const el = _collectionModal?.querySelector('#collection-match-count');
  if (!el) return;
  if (names.length === 0) { el.textContent = ''; return; }
  try {
    const operator = _collectionModal.querySelector('.operator-btn.active')?.dataset.op || 'OR';
    const param = operator === 'AND' ? 'tags_and' : 'tags';
    const data = await apiFetch(`/images?${param}=` + encodeURIComponent(names.join(',')) + '&limit=1');
    const count = data.total ?? 0;
    el.textContent = `${count} Got${count !== 1 ? 's' : ''} match`;
  } catch { el.textContent = ''; }
}

// ── Save ───────────────────────────────────────────────────────────
async function saveCollection() {
  const name = _collectionModal.querySelector('#collection-name-input').value.trim();
  const tags = getCollectionTagNames();
  if (!name || tags.length === 0) return;

  const operator = _collectionModal.querySelector('.operator-btn.active')?.dataset.op || 'OR';

  try {
    if (_editingCollectionId) {
      await apiFetch(`/smart-collections/${_editingCollectionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, tag_query: { operator, tags } })
      });
      if (state.activeCollection === _editingCollectionId) await stateManager.loadImages();
    } else {
      await apiFetch('/smart-collections', {
        method: 'POST',
        body: JSON.stringify({ name, tag_query: { operator, tags } })
      });
    }
    closeCollectionModal();
    await stateManager.loadCollections();
  } catch (err) { alert(`Failed to save collection: ${err.message}`); }
}
