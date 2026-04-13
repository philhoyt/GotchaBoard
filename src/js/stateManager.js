import { apiFetch } from './api.js';
import { getTagColor } from './utils/tagColor.js';
import { esc } from './utils/helpers.js';

// ── Private badge patcher ──────────────────────────────────────────
// Kept here so onTagsChanged can update badges without external dependencies.
function _patchCardBadges(imageId, tags, stateTags) {
  const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
  if (!card) return;
  const badgeHtml = tags.map(name => {
    const t     = stateTags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="tag-badge" ${style}>${esc(name)}</span>`;
  }).join('');
  let badgesEl = card.querySelector('.card-badges');
  if (badgesEl) {
    badgesEl.innerHTML = badgeHtml;
  } else if (badgeHtml) {
    badgesEl = document.createElement('div');
    badgesEl.className = 'card-badges';
    badgesEl.innerHTML = badgeHtml;
    card.querySelector('.card-meta')?.appendChild(badgesEl);
  }
}

// ── StateManager ───────────────────────────────────────────────────
class StateManager {
  constructor() {
    this.state = {
      images:      [],
      tags:        [],
      collections: [],

      activeTags:       [],
      checkedTags:      [],
      activeCollection: null,
      showUntagged:     false,
      searchQuery:      '',
      sortOrder:        'saved_at_desc',

      detailImageId: null,

      page:        0,
      pageSize:    60,
      totalImages: 0,
      loading:     false,
    };

    this._listeners = new Map();
    this._loadSeq   = 0;
  }

  // ── Event emitter ────────────────────────────────────────────────
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
  }

  emit(event, data) {
    this._listeners.get(event)?.forEach(fn => fn(data));
  }

  // ── Query builder ────────────────────────────────────────────────
  buildImageQuery() {
    const { state } = this;
    const params = new URLSearchParams();
    if (state.showUntagged) {
      params.set('untagged', '1');
    } else if (state.activeCollection) {
      params.set('collection', state.activeCollection);
    } else if (state.activeTags.length === 1) {
      params.set('tag_id', state.activeTags[0]);
    } else if (state.activeTags.length > 1) {
      const names = state.activeTags.map(id => {
        const t = state.tags.find(t => t.id === id);
        return t ? t.name : '';
      }).filter(Boolean);
      params.set('tags', names.join(','));
    }
    if (state.searchQuery) params.set('q', state.searchQuery);
    return params.toString();
  }

  // ── Data loading ─────────────────────────────────────────────────
  async loadImages(append = false) {
    const { state } = this;
    if (state.loading) return;
    state.loading = true;

    const seq = ++this._loadSeq;

    if (!append) {
      state.page = 0;
      const scrollEl = document.getElementById('grid-scroll');
      if (scrollEl) scrollEl.scrollTop = 0;
    }

    try {
      const base   = this.buildImageQuery();
      const params = new URLSearchParams(base);
      params.set('limit',  state.pageSize);
      params.set('offset', state.page);
      const data = await apiFetch('/images?' + params.toString());
      if (seq !== this._loadSeq) return;

      const { images, total } = data;
      if (state.sortOrder === 'saved_at_asc') images.reverse();

      state.totalImages = total;

      if (append) {
        state.images = [...state.images, ...images];
        this.emit('images-appended', images);
      } else {
        state.images = images;
        this.emit('images-loaded');
      }

      state.page += images.length;
      this.updateCounts();
    } finally {
      state.loading = false;
    }
  }

  async loadTags() {
    this.state.tags = await apiFetch('/tags');
    this.emit('tags-loaded');
  }

  async loadCollections() {
    this.state.collections = await apiFetch('/smart-collections');
    this.emit('collections-loaded');
  }

  async loadAll() {
    await Promise.all([this.loadImages(), this.loadTags(), this.loadCollections()]);
  }

  async updateCounts() {
    try {
      const { total, untagged } = await apiFetch('/images/counts');
      document.getElementById('all-images-btn').dataset.count = total;
      const savedEl = document.getElementById('saved-count');
      if (savedEl) savedEl.textContent = `${total} saved`;
      document.getElementById('untagged-btn').dataset.count = untagged;
    } catch { /* counts are best-effort */ }
  }

  // ── Filter match check ───────────────────────────────────────────
  imageMatchesCurrentFilter(tagNames) {
    const { state } = this;
    if (!state.showUntagged && !state.activeCollection && state.activeTags.length === 0 && !state.searchQuery) {
      return true;
    }
    if (state.showUntagged) return tagNames.length === 0;
    if (state.activeCollection || state.searchQuery) return true;
    if (state.activeTags.length > 0) {
      const activeNames = new Set(
        state.activeTags.flatMap(id => {
          const t = state.tags.find(t => t.id === id);
          if (!t) return [];
          const children = state.tags.filter(c => c.parent_id === id).map(c => c.name);
          return [t.name, ...children];
        })
      );
      if (activeNames.size === 0) return false;
      return tagNames.some(name => activeNames.has(name));
    }
    return true;
  }

  // ── Centralized tag-change handler ───────────────────────────────
  // Re-fetches the current filtered view, patches badges for images that
  // stayed, and calls onRemove(removedIds) for images that fell out of
  // the filter so the caller can run sweep animations (which need msnry).
  // Updates state.images, totalImages, then refreshes counts and tag list.
  async onTagsChanged(affectedIds, { onRemove = null } = {}) {
    const { state } = this;
    const patchParams = new URLSearchParams(this.buildImageQuery());
    patchParams.set('limit',  Math.max(state.images.length, 200));
    patchParams.set('offset', 0);
    const { images: fresh } = await apiFetch('/images?' + patchParams.toString());
    const freshIds = new Set(fresh.map(i => i.id));

    const removedIds = affectedIds.filter(id => !freshIds.has(id));
    const stayedIds  = affectedIds.filter(id =>  freshIds.has(id));

    // Update state tags + patch badges for images that stayed
    for (const id of stayedIds) {
      const freshImg = fresh.find(i => i.id === id);
      const stateImg = state.images.find(i => i.id === id);
      if (freshImg && stateImg) stateImg.tags = freshImg.tags;
      if (freshImg) _patchCardBadges(id, freshImg.tags, state.tags);
    }

    // Sweep images that no longer match the filter
    if (removedIds.length > 0) {
      if (onRemove) await onRemove(removedIds);
      const removedSet = new Set(removedIds);
      state.images      = state.images.filter(i => !removedSet.has(i.id));
      state.totalImages = Math.max(0, state.totalImages - removedIds.length);
    }

    this.updateCounts();
    await this.loadTags();
  }
}

export const stateManager = new StateManager();
export const state = stateManager.state;
