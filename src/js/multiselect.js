'use strict';

export class SelectionManager extends EventTarget {
  constructor() {
    super();
    this._selected  = new Set();
    this._lastIndex = null;
  }

  get size() { return this._selected.size; }
  get ids()  { return [...this._selected]; }
  has(id)    { return this._selected.has(id); }

  toggle(id, index) {
    if (this._selected.has(id)) {
      this._selected.delete(id);
    } else {
      this._selected.add(id);
    }
    this._lastIndex = index;
    this._emit();
  }

  rangeSelect(ids, fromIndex, toIndex) {
    const lo = Math.min(fromIndex, toIndex);
    const hi = Math.max(fromIndex, toIndex);
    for (let i = lo; i <= hi; i++) {
      if (ids[i]) this._selected.add(ids[i]);
    }
    this._lastIndex = toIndex;
    this._emit();
  }

  selectAll(ids) {
    ids.forEach(id => this._selected.add(id));
    this._emit();
  }

  clear() {
    if (this._selected.size === 0) return;
    this._selected.clear();
    this._lastIndex = null;
    this._emit();
  }

  remove(id) {
    this._selected.delete(id);
    this._emit();
  }

  get lastIndex() { return this._lastIndex; }

  _emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: { ids: this.ids, size: this.size } }));
  }
}
