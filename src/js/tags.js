import '@fontsource/syne/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '../styles/tags.scss';

import { toggleTheme } from './utils/theme.js';
import { getTagColor } from './utils/tagColor.js';

'use strict';

const API = window.location.origin + '/api';

// ── State ──────────────────────────────────────────────────────────
let allTags      = [];
let filterQuery  = '';
let showEmpty    = true;
let editingTagId = null;
let mergingTag   = null;

// ── API helpers ────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Server error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove());
  }, 2800);
}

// ── Load & render ──────────────────────────────────────────────────
async function loadTags() {
  allTags = await apiFetch('/tags');
  renderTree();
}

function visibleTags() {
  let tags = allTags;
  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    tags = tags.filter(t => t.name.toLowerCase().includes(q));
  }
  if (!showEmpty) {
    tags = tags.filter(t => t.count > 0 || allTags.some(c => c.parent_id === t.id && c.count > 0));
  }
  return tags;
}

function renderTree() {
  const tree  = document.getElementById('tags-tree');
  const empty = document.getElementById('tags-empty');
  const tags  = visibleTags();

  const topLevel = tags.filter(t => !t.parent_id);
  const childMap = {};
  for (const t of tags) {
    if (t.parent_id) {
      if (!childMap[t.parent_id]) childMap[t.parent_id] = [];
      childMap[t.parent_id].push(t);
    }
  }

  if (topLevel.length === 0) {
    tree.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tree.innerHTML = '';
  for (const tag of topLevel) {
    const children = childMap[tag.id] || [];
    tree.appendChild(buildTagRow(tag, children));
  }

  populateParentSelects();
}

function buildTagRow(tag, children = []) {
  const li = document.createElement('li');
  li.className = 'tag-row';
  li.dataset.tagId = tag.id;

  li.innerHTML = `
    <div class="tag-row-inner">
      <span class="tag-swatch" style="background:${tag.color || getTagColor(tag.name)}"></span>
      <span class="tag-name">${escHtml(tag.name)}</span>
      <span class="tag-count">${tag.count} Got${tag.count !== 1 ? 's' : ''}</span>
      <div class="tag-actions">
        <button class="tag-action-btn" data-act="edit"   data-id="${tag.id}" title="Edit">Edit</button>
        <button class="tag-action-btn" data-act="merge"  data-id="${tag.id}" title="Merge into another tag">Merge</button>
        <button class="tag-action-btn danger" data-act="delete" data-id="${tag.id}" title="Delete tag">Delete</button>
      </div>
    </div>
  `;

  if (children.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'tag-children';
    for (const child of children) {
      const cli = document.createElement('li');
      cli.className = 'tag-row tag-child-row';
      cli.dataset.tagId = child.id;
      cli.innerHTML = `
        <div class="tag-row-inner">
          <span class="tag-swatch" style="background:${child.color || getTagColor(child.name)}"></span>
          <span class="tag-name">${escHtml(child.name)}</span>
          <span class="tag-count">${child.count} Got${child.count !== 1 ? 's' : ''}</span>
          <div class="tag-actions">
            <button class="tag-action-btn" data-act="edit"   data-id="${child.id}" title="Edit">Edit</button>
            <button class="tag-action-btn" data-act="merge"  data-id="${child.id}" title="Merge into another tag">Merge</button>
            <button class="tag-action-btn danger" data-act="delete" data-id="${child.id}" title="Delete tag">Delete</button>
          </div>
        </div>
      `;
      ul.appendChild(cli);
    }
    li.appendChild(ul);
  }

  return li;
}

function populateParentSelects(excludeId = null) {
  const topLevel = allTags.filter(t => !t.parent_id && t.id !== excludeId);
  ['new-tag-parent', 'edit-tag-parent'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    while (sel.options.length > 1) sel.remove(1);
    for (const t of topLevel) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  });
}

function showNewTagForm() {
  const form = document.getElementById('new-tag-form');
  form.style.display = '';
  document.getElementById('new-tag-name').value  = '';
  document.getElementById('new-tag-color').value = '#FFE566';
  document.getElementById('new-tag-parent').value = '';
  populateParentSelects();
  document.getElementById('new-tag-name').focus();
}

function hideNewTagForm() {
  document.getElementById('new-tag-form').style.display = 'none';
}

async function createTag() {
  const name      = document.getElementById('new-tag-name').value.trim();
  if (!name) return;
  const color     = document.getElementById('new-tag-color').value;
  const parent_id = document.getElementById('new-tag-parent').value || null;

  try {
    await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name, color, parent_id }) });
    hideNewTagForm();
    await loadTags();
    toast(`Tag "${name}" created`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditModal(tagId) {
  const tag = allTags.find(t => t.id === tagId);
  if (!tag) return;
  editingTagId = tagId;

  document.getElementById('edit-tag-name').value  = tag.name;
  document.getElementById('edit-tag-color').value = tag.color || '#FFE566';

  const childIds = allTags.filter(t => t.parent_id === tagId).map(t => t.id);
  const topLevel = allTags.filter(t => !t.parent_id && t.id !== tagId && !childIds.includes(t.id));
  const sel = document.getElementById('edit-tag-parent');
  while (sel.options.length > 1) sel.remove(1);
  for (const t of topLevel) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  sel.value = tag.parent_id || '';

  document.getElementById('edit-modal').style.display = '';
  document.getElementById('edit-tag-name').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingTagId = null;
}

async function saveEditModal() {
  if (!editingTagId) return;
  const name      = document.getElementById('edit-tag-name').value.trim();
  const color     = document.getElementById('edit-tag-color').value;
  const parent_id = document.getElementById('edit-tag-parent').value || null;
  if (!name) return;

  try {
    await apiFetch(`/tags/${editingTagId}`, { method: 'PATCH', body: JSON.stringify({ name, color, parent_id }) });
    closeEditModal();
    await loadTags();
    toast(`Tag updated`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openMergeModal(tagId) {
  const tag = allTags.find(t => t.id === tagId);
  if (!tag) return;

  document.getElementById('merge-modal-desc').textContent =
    `Merge "${tag.name}" into another tag. All ${tag.count} Got${tag.count !== 1 ? 's' : ''} will be reassigned and "${tag.name}" will be deleted.`;

  const sel = document.getElementById('merge-target-select');
  sel.innerHTML = '';
  const others = allTags.filter(t => t.id !== tagId);
  for (const t of others) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.parent_id
      ? `${allTags.find(p => p.id === t.parent_id)?.name || '?'} › ${t.name}`
      : t.name;
    sel.appendChild(opt);
  }

  document.getElementById('merge-modal').style.display = '';
  mergingTag = tag;
}

function closeMergeModal() {
  document.getElementById('merge-modal').style.display = 'none';
  mergingTag = null;
}

async function confirmMerge() {
  if (!mergingTag) return;
  const targetId  = document.getElementById('merge-target-select').value;
  if (!targetId) return;
  const targetTag = allTags.find(t => t.id === targetId);

  try {
    await apiFetch(`/tags/${mergingTag.id}/merge`, { method: 'POST', body: JSON.stringify({ target_id: targetId }) });
    closeMergeModal();
    await loadTags();
    toast(`"${mergingTag.name}" merged into "${targetTag?.name || 'tag'}"`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteTag(tagId) {
  const tag = allTags.find(t => t.id === tagId);
  if (!tag) return;

  const hasGots     = tag.count > 0;
  const hasChildren = allTags.some(t => t.parent_id === tagId);
  let msg = `Delete tag "${tag.name}"?`;
  if (hasGots)     msg += ` It is used by ${tag.count} Got${tag.count !== 1 ? 's' : ''} (those Gots won't be deleted).`;
  if (hasChildren) msg += ` Its child tags will become top-level.`;

  if (!confirm(msg)) return;

  try {
    await apiFetch(`/tags/${tagId}`, { method: 'DELETE' });
    await loadTags();
    toast(`"${tag.name}" deleted`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteUnused() {
  const unused = allTags.filter(t => t.count === 0);
  if (unused.length === 0) { toast('No unused tags to delete'); return; }
  if (!confirm(`Delete ${unused.length} unused tag${unused.length !== 1 ? 's' : ''}?`)) return;

  let deleted = 0;
  for (const tag of unused) {
    try { await apiFetch(`/tags/${tag.id}`, { method: 'DELETE' }); deleted++; } catch (_) {}
  }
  await loadTags();
  toast(`Deleted ${deleted} unused tag${deleted !== 1 ? 's' : ''}`);
}

function initDragToMerge() {
  const tree = document.getElementById('tags-tree');
  tree.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.tag-row-inner');
    if (!row) return;
    if (e.target.closest('.tag-actions')) return;
    const li = row.closest('[data-tag-id]');
    if (!li) return;
  });
  window.addEventListener('mouseup', () => {});
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bindEvents() {
  document.getElementById('new-tag-btn').addEventListener('click', showNewTagForm);
  document.getElementById('new-tag-cancel').addEventListener('click', hideNewTagForm);
  document.getElementById('new-tag-save').addEventListener('click', createTag);
  document.getElementById('new-tag-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createTag();
    if (e.key === 'Escape') hideNewTagForm();
  });

  document.getElementById('tags-search').addEventListener('input', e => {
    filterQuery = e.target.value.trim();
    renderTree();
  });

  document.getElementById('show-empty-toggle').addEventListener('change', e => {
    showEmpty = e.target.checked;
    renderTree();
  });

  document.getElementById('delete-unused-btn').addEventListener('click', deleteUnused);

  document.getElementById('tags-tree').addEventListener('click', e => {
    const btn = e.target.closest('.tag-action-btn');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'edit')   openEditModal(id);
    if (act === 'merge')  openMergeModal(id);
    if (act === 'delete') deleteTag(id);
  });

  document.getElementById('edit-modal-backdrop').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-save').addEventListener('click', saveEditModal);
  document.getElementById('edit-tag-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEditModal();
    if (e.key === 'Escape') closeEditModal();
  });

  document.getElementById('merge-modal-backdrop').addEventListener('click', closeMergeModal);
  document.getElementById('merge-modal-cancel').addEventListener('click', closeMergeModal);
  document.getElementById('merge-modal-confirm').addEventListener('click', confirmMerge);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('edit-modal').style.display !== 'none') closeEditModal();
    if (document.getElementById('merge-modal').style.display !== 'none') closeMergeModal();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Theme toggle (replaces onclick="toggleTheme()")
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  // Sync icon
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
  }

  bindEvents();
  initDragToMerge();
  try {
    await loadTags();
  } catch (err) {
    document.getElementById('tags-tree').innerHTML =
      `<li style="padding:40px;text-align:center;color:#dc2626">Could not connect to GotchaBoard server.<br><small>Start it with: <code>npm start</code></small></li>`;
  }
});
