import { stateManager, state } from './stateManager.js';
import { apiFetch } from './api.js';
import { getTagColor } from './utils/tagColor.js';
import { esc } from './utils/helpers.js';
import { buildFilterChip } from './components/filterChip.js';

// ── Tag list rendering ─────────────────────────────────────────────
export function renderTagList() {
  const list = document.getElementById('tags-list');
  list.innerHTML = '';

  const parents  = state.tags.filter(t => !t.parent_id);
  const children = state.tags.filter(t => t.parent_id);

  const childrenByParent = {};
  children.forEach(c => { (childrenByParent[c.parent_id] ||= []).push(c); });

  for (const parent of parents) {
    list.appendChild(buildTagItem(parent, false));
    const kids = childrenByParent[parent.id] || [];
    for (const child of kids) list.appendChild(buildTagItem(child, true));
  }

  const clearBtn = document.getElementById('clear-tags-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !(state.checkedTags && state.checkedTags.length > 0));
}

function buildTagItem(tag, isChild) {
  const li = document.createElement('li');
  li.className = 'tag-item' + (isChild ? ' child-tag' : '');

  const isChecked = state.checkedTags?.includes(tag.id);
  const isSingle  = state.activeTags.length === 1 && state.activeTags[0] === tag.id && !isChecked;
  if (isSingle)  li.classList.add('active');
  if (isChecked) li.classList.add('multi-active');
  li.dataset.tagId = tag.id;

  const tagColor = tag.color || getTagColor(tag.name);
  if (tagColor && !isSingle && !isChecked) li.style.background = tagColor;

  li.innerHTML = `
    <input type="checkbox" class="tag-check" ${isChecked ? 'checked' : ''} />
    <span class="tag-name">${esc(tag.name)}</span>
    <span class="tag-count">${tag.count || 0}</span>
    <span class="tag-actions">
      <button class="tag-action-btn delete" title="Delete">✕</button>
    </span>
  `;

  li.querySelector('.tag-check').addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    if (!state.checkedTags) state.checkedTags = [];
    const wasChecked = state.checkedTags.includes(tag.id);
    if (wasChecked) {
      state.checkedTags = state.checkedTags.filter(id => id !== tag.id);
    } else {
      state.checkedTags = [...state.checkedTags, tag.id];
    }
    state.activeTags       = [...state.checkedTags];
    state.showUntagged     = false;
    state.activeCollection = null;
    document.getElementById('all-images-btn').classList.toggle('active', state.activeTags.length === 0);
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    stateManager.loadImages();
  });

  li.addEventListener('click', e => {
    if (e.target.closest('.tag-actions')) return;
    if (e.target.closest('.tag-check')) return;
    state.checkedTags = [];
    if (state.activeTags.length === 1 && state.activeTags[0] === tag.id) {
      state.activeTags = [];
    } else {
      state.activeTags = [tag.id];
    }
    state.showUntagged     = false;
    state.activeCollection = null;
    document.getElementById('all-images-btn').classList.toggle('active', state.activeTags.length === 0);
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    stateManager.loadImages();
  });

  li.querySelector('.delete').addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteTag(tag);
  });

  return li;
}

// ── Collections rendering ──────────────────────────────────────────
export function renderCollections() {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';

  if (state.collections.length === 0) {
    list.innerHTML = '<li style="padding:4px 10px;font-size:11px;color:var(--text-muted)">No collections yet</li>';
    return;
  }

  for (const col of state.collections) {
    const li = document.createElement('li');
    li.className = 'collection-item' + (state.activeCollection === col.id ? ' active' : '');
    li.dataset.id = col.id;
    li.innerHTML = `
      <span class="collection-icon">◎</span>
      <span class="collection-name">${esc(col.name)}</span>
      <span class="collection-actions">
        <button class="collection-edit" title="Edit">✎</button>
        <button class="collection-delete" title="Delete">✕</button>
      </span>
    `;

    li.querySelector('.collection-name').addEventListener('click', () => {
      state.activeCollection = state.activeCollection === col.id ? null : col.id;
      state.activeTags       = [];
      state.checkedTags      = [];
      state.showUntagged     = false;
      document.getElementById('all-images-btn').classList.toggle('active', !state.activeCollection);
      document.getElementById('untagged-btn').classList.remove('active');
      renderCollections();
      renderTagList();
      stateManager.loadImages();
    });

    li.querySelector('.collection-edit').addEventListener('click', e => {
      e.stopPropagation();
      // openCollectionModal is wired in app.js via the 'new-collection-btn' listener;
      // for collection-edit we dispatch a custom event so sidebar doesn't import collectionModal
      document.dispatchEvent(new CustomEvent('open-collection-modal', { detail: { mode: 'edit', col } }));
    });

    li.querySelector('.collection-delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete collection "${col.name}"?`)) return;
      try {
        await apiFetch(`/smart-collections/${col.id}`, { method: 'DELETE' });
        if (state.activeCollection === col.id) { state.activeCollection = null; stateManager.loadImages(); }
        await stateManager.loadCollections();
      } catch (err) { alert(err.message); }
    });

    list.appendChild(li);
  }
}

// ── Active filters display ─────────────────────────────────────────
export function renderActiveFilters() {
  const container = document.getElementById('active-filters');
  container.innerHTML = '';

  if (state.activeTags.length > 0) {
    state.activeTags.forEach(tagId => {
      const t = state.tags.find(t => t.id === tagId);
      if (!t) return;
      container.appendChild(buildFilterChip(`#${t.name}`, () => {
        state.activeTags  = state.activeTags.filter(id => id !== tagId);
        state.checkedTags = (state.checkedTags || []).filter(id => id !== tagId);
        if (state.activeTags.length === 0) document.getElementById('all-images-btn').classList.add('active');
        renderTagList();
        stateManager.loadImages();
      }));
    });
  }

  if (state.activeCollection) {
    const col = state.collections.find(c => c.id === state.activeCollection);
    if (col) {
      container.appendChild(buildFilterChip(`◎ ${col.name}`, () => {
        state.activeCollection = null;
        document.getElementById('all-images-btn').classList.add('active');
        renderCollections();
        stateManager.loadImages();
      }));
    }
  }

  if (state.showUntagged) {
    container.appendChild(buildFilterChip('Untagged', () => {
      state.showUntagged = false;
      document.getElementById('all-images-btn').classList.add('active');
      document.getElementById('untagged-btn').classList.remove('active');
      stateManager.loadImages();
    }));
  }

  if (state.searchQuery) {
    container.appendChild(buildFilterChip(`"${state.searchQuery}"`, () => {
      state.searchQuery = '';
      document.getElementById('search-input').value = '';
      stateManager.loadImages();
    }));
  }
}


// ── Tag management ─────────────────────────────────────────────────
async function confirmDeleteTag(tag) {
  if (!confirm(`Delete tag "${tag.name}"? It will be removed from all Gots.`)) return;
  try {
    await apiFetch(`/tags/${tag.id}`, { method: 'DELETE' });
    state.activeTags  = state.activeTags.filter(id => id !== tag.id);
    state.checkedTags = (state.checkedTags || []).filter(id => id !== tag.id);
    await Promise.all([stateManager.loadImages(), stateManager.loadTags()]);
  } catch (err) { alert(`Failed to delete tag: ${err.message}`); }
}

export async function createTag(name) {
  try {
    await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name }) });
    await stateManager.loadTags();
  } catch (err) { alert(`Failed to create tag: ${err.message}`); }
}

// ── Init ───────────────────────────────────────────────────────────
export function initSidebar() {
  stateManager.on('tags-loaded',        renderTagList);
  stateManager.on('collections-loaded', renderCollections);
}
