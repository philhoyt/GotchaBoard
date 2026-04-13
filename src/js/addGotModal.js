import { stateManager, state } from './stateManager.js';
import { API, apiFetch } from './api.js';
import { attachTagSuggestions } from './utils/tagSuggest.js';
import { getTagColor } from './utils/tagColor.js';
import { esc } from './utils/helpers.js';
import { toast } from './utils/toast.js';

let _addGotSuggest = null;

export function openAddGotModal() {
  const modal  = document.getElementById('add-got-modal');
  const dialog = document.getElementById('add-got-dialog');
  let activeMode = 'url';
  let uploadFile = null;

  dialog.innerHTML = `
    <h2>+ New Got</h2>
    <div class="add-got-tabs">
      <button class="add-got-tab active" data-mode="url">Paste URL</button>
      <button class="add-got-tab" data-mode="upload">Upload File</button>
    </div>

    <div class="add-got-mode active" id="add-got-mode-url">
      <div class="add-got-field">
        <div class="detail-label">Image URL</div>
        <input type="url" id="add-got-url" placeholder="https://..." autocomplete="off">
      </div>
      <div class="add-got-field">
        <div class="detail-label">Page Title (optional)</div>
        <input type="text" id="add-got-page-title" placeholder="Where did you find this?" autocomplete="off">
      </div>
      <div class="add-got-field">
        <div class="detail-label">Page URL (optional)</div>
        <input type="url" id="add-got-page-url" placeholder="https://..." autocomplete="off">
      </div>
    </div>

    <div class="add-got-mode" id="add-got-mode-upload">
      <div class="add-got-dropzone" id="add-got-dropzone">
        <span id="add-got-drop-label">Drop image here or click to browse</span>
        <input type="file" id="add-got-file" accept="image/*" style="display:none">
      </div>
    </div>

    <hr class="add-got-divider">

    <div class="add-got-field">
      <div class="detail-label">Tags</div>
      <div class="detail-tags-wrap" id="add-got-tags-wrap">
        <input type="text" class="detail-add-tag-input" id="add-got-tag-input" placeholder="+ add tag">
      </div>
    </div>

    <div class="add-got-error" id="add-got-error"></div>
    <div class="add-got-actions">
      <button class="btn btn-primary" id="add-got-save">Save Got</button>
      <button class="btn btn-ghost" id="add-got-cancel">Cancel</button>
    </div>
  `;

  modal.style.display = 'flex';
  document.getElementById('add-got-url').focus();

  dialog.querySelectorAll('.add-got-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeMode = tab.dataset.mode;
      dialog.querySelectorAll('.add-got-tab').forEach(t => t.classList.toggle('active', t === tab));
      dialog.querySelectorAll('.add-got-mode').forEach(m => m.classList.toggle('active', m.id === `add-got-mode-${activeMode}`));
      if (activeMode === 'url') document.getElementById('add-got-url').focus();
    });
  });

  const getModalTags = () =>
    [...dialog.querySelectorAll('#add-got-tags-wrap .detail-tag-pill')].map(el => el.dataset.tag);

  const addModalPill = (name) => {
    const wrap  = document.getElementById('add-got-tags-wrap');
    const input = document.getElementById('add-got-tag-input');
    if (getModalTags().includes(name)) return;
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const pill  = document.createElement('span');
    pill.className   = 'detail-tag-pill';
    pill.dataset.tag = name;
    if (color) pill.style.background = color;
    pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
    pill.querySelector('.detail-tag-remove').addEventListener('click', () => pill.remove());
    wrap.insertBefore(pill, input);
  };

  const addGotTagInput = document.getElementById('add-got-tag-input');
  _addGotSuggest?.destroy();
  _addGotSuggest = attachTagSuggestions(addGotTagInput, () => state.tags, (name) => {
    addModalPill(name);
  });

  addGotTagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) { addModalPill(val); e.target.value = ''; }
    }
  });

  document.getElementById('add-got-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
  });

  const dropzone  = document.getElementById('add-got-dropzone');
  const fileInput = document.getElementById('add-got-file');

  const setFile = (file) => {
    const isImage = file && (file.type.startsWith('image/') ||
      /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(file.name));
    if (!isImage) return;
    uploadFile = file;
    const url = URL.createObjectURL(file);
    dropzone.innerHTML = `<img src="${url}" alt="preview"><input type="file" id="add-got-file" accept="image/*" style="display:none">`;
    dropzone.querySelector('#add-got-file').addEventListener('change', e => setFile(e.target.files[0]));
  };

  dropzone.addEventListener('click', () => document.getElementById('add-got-file').click());
  fileInput.addEventListener('change', e => setFile(e.target.files[0]));
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    setFile(e.dataTransfer.files[0]);
  });

  const showError = (msg) => { document.getElementById('add-got-error').textContent = msg; };

  const doSave = async () => {
    showError('');
    const saveBtn = document.getElementById('add-got-save');
    const tags    = getModalTags();

    if (activeMode === 'url') {
      const source_url = document.getElementById('add-got-url').value.trim();
      const page_title = document.getElementById('add-got-page-title').value.trim() || null;
      const page_url   = document.getElementById('add-got-page-url').value.trim() || null;
      if (!source_url) { showError('Image URL is required.'); return; }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      try {
        await apiFetch('/images/save', {
          method: 'POST',
          body: JSON.stringify({ source_url, page_title, page_url, tags }),
        });
        closeAddGotModal();
        await stateManager.loadAll();
        toast('Got saved!');
      } catch (err) {
        showError(err.message);
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Got';
      }
    } else {
      if (!uploadFile) { showError('Please select an image file.'); return; }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      try {
        const formData = new FormData();
        formData.append('image', uploadFile);
        if (tags.length) formData.append('tags', JSON.stringify(tags));

        const res = await fetch(`${API}/images/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        closeAddGotModal();
        await stateManager.loadAll();
        toast('Got saved!');
      } catch (err) {
        showError(err.message);
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Got';
      }
    }
  };

  document.getElementById('add-got-save').addEventListener('click', doSave);
  document.getElementById('add-got-cancel').addEventListener('click', closeAddGotModal);
  document.getElementById('add-got-backdrop').addEventListener('click', closeAddGotModal);
}

export function closeAddGotModal() {
  const modal = document.getElementById('add-got-modal');
  modal.style.display = 'none';
  document.getElementById('add-got-dialog').innerHTML = '';
  _addGotSuggest?.destroy(); _addGotSuggest = null;
}
