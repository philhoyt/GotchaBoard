'use strict';

// DragStack — whimsical drag-and-drop with animated card pile
class DragStack {
  constructor({ selection, onDrop, getDropTargets }) {
    this.selection = selection;
    this.onDrop    = onDrop;
    this.getDropTargets = getDropTargets;

    this._stackEl    = null;
    this._bobAnim    = null;
    this._active     = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragThreshold = 6; // px before drag is confirmed

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);
  }

  // Call this on mousedown on a selected card
  prime(event, sourceCard, allCards) {
    if (event.button !== 0) return;
    this._primed    = true;
    this._dragStartX = event.clientX;
    this._dragStartY = event.clientY;
    this._sourceCard = sourceCard;
    this._allCards   = allCards;

    // Attach move/up listeners globally to catch fast movements
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup',   this._onMouseUp);
  }

  _onMouseMove(e) {
    if (!this._primed) return;

    const dx = Math.abs(e.clientX - this._dragStartX);
    const dy = Math.abs(e.clientY - this._dragStartY);

    if (!this._active && (dx > this._dragThreshold || dy > this._dragThreshold)) {
      this._active = true;
      this._startDrag(e);
    }

    if (this._active) {
      this._moveStack(e.clientX, e.clientY);
      this._highlightTarget(e);
    }
  }

  _onMouseUp(e) {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup',   this._onMouseUp);

    if (!this._active) {
      this._primed = false;
      return;
    }

    const target = this._findDropTarget(e);
    if (target) {
      const tagId = target.dataset.tagId;
      this._animateDrop(e.clientX, e.clientY, target);
      this.onDrop(tagId, this.selection.ids);
    } else {
      this._animateCancel();
    }

    this._active = false;
    this._primed = false;
    this._clearTargetHighlights();
  }

  _startDrag(e) {
    document.body.classList.add('is-dragging');

    const selectedIds = this.selection.ids;
    const count = selectedIds.size || selectedIds.length;

    // Show drop zone in sidebar
    const dropZone = document.getElementById('tag-drop-zone');
    if (dropZone) dropZone.style.display = '';

    // Build the visual stack
    this._stackEl = document.createElement('div');
    this._stackEl.className = 'drag-stack';
    this._stackEl.style.cssText = `
      position: fixed; pointer-events: none; z-index: 9999;
      width: 120px; height: 90px;
      transform-origin: center center;
    `;
    document.body.appendChild(this._stackEl);

    // Get card thumbnails for the preview (up to 5)
    const previewCards = [...this._allCards]
      .filter(c => this.selection.has(c.dataset.id))
      .slice(0, 5);

    previewCards.forEach((card, i) => {
      const img = card.querySelector('img');
      const mini = document.createElement('div');
      mini.className = 'stack-mini-card';
      const rot = (Math.random() - 0.5) * 24;
      const zOff = i * 2;
      mini.style.cssText = `
        position: absolute; inset: 0;
        border-radius: 8px; overflow: hidden;
        box-shadow: 0 ${2 + zOff}px ${8 + zOff}px rgba(0,0,0,0.2);
        transform: rotate(${rot}deg);
        background: #e5e7eb;
        z-index: ${previewCards.length - i};
      `;
      if (img) {
        const clone = img.cloneNode();
        clone.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        mini.appendChild(clone);
      }
      this._stackEl.appendChild(mini);

      // Fly each subsequent card in from its original position with a stagger
      if (i > 0) {
        const cardRect  = card.getBoundingClientRect();
        const stackRect = this._stackEl.getBoundingClientRect();
        const startX = cardRect.left - e.clientX;
        const startY = cardRect.top  - e.clientY;
        mini.animate([
          { transform: `translate(${startX}px, ${startY}px) rotate(0deg) scale(0.7)`, opacity: 0 },
          { transform: `rotate(${rot}deg) scale(1)`, opacity: 1 }
        ], { duration: 300 + i * 50, delay: i * 40, easing: Animations.SPRING_EASING, fill: 'forwards' });
      }
    });

    // Count badge
    const badge = document.createElement('div');
    badge.className = 'stack-badge';
    badge.textContent = `${selectedIds.length || selectedIds.size} Gots`;
    badge.style.cssText = `
      position: absolute; bottom: -10px; right: -10px;
      background: var(--primary); color: #fff;
      font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 12px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      z-index: 100;
    `;
    this._stackEl.appendChild(badge);

    // Start float bob
    this._bobAnim = Animations.floatBob(this._stackEl);
    this._moveStack(e.clientX, e.clientY);

    // Spring pop on arrival
    this._stackEl.animate([
      { transform: `translate(-50%, -50%) scale(0.6)` },
      { transform: `translate(-50%, -50%) scale(1.05)` },
      { transform: `translate(-50%, -50%) scale(1)` }
    ], { duration: 280, easing: Animations.SPRING_EASING });
  }

  _moveStack(x, y) {
    if (!this._stackEl) return;
    this._stackEl.style.left = `${x}px`;
    this._stackEl.style.top  = `${y}px`;
    this._stackEl.style.transform = 'translate(-50%, -50%)';
  }

  _highlightTarget(e) {
    this._clearTargetHighlights();
    const target = this._findDropTarget(e);
    if (target) target.classList.add('drop-target-hover');
  }

  _findDropTarget(e) {
    this._stackEl && (this._stackEl.style.pointerEvents = 'none');
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this._stackEl && (this._stackEl.style.pointerEvents = '');
    if (!el) return null;
    return el.closest('[data-tag-id]') || null;
  }

  _clearTargetHighlights() {
    document.querySelectorAll('.drop-target-hover').forEach(el => el.classList.remove('drop-target-hover'));
  }

  _animateDrop(x, y, targetEl) {
    if (this._bobAnim) this._bobAnim.cancel();

    const count = (this.selection.ids.length || this.selection.ids.size || 0);
    const minis = this._stackEl.querySelectorAll('.stack-mini-card');

    minis.forEach((mini, i) => {
      const angle = (i / Math.max(minis.length - 1, 1)) * 360 + Math.random() * 30;
      Animations.burst(mini, angle, 60 + Math.random() * 40);
    });

    // Tag bounce
    if (targetEl) Animations.tagReceive(targetEl);

    setTimeout(() => {
      this._destroyStack();
      document.body.classList.remove('is-dragging');
      const dropZone = document.getElementById('tag-drop-zone');
      if (dropZone) dropZone.style.display = 'none';
    }, 500);
  }

  _animateCancel() {
    if (!this._stackEl) return;
    if (this._bobAnim) this._bobAnim.cancel();

    Animations.shake(this._stackEl).finished.then(() => {
      this._destroyStack();
      document.body.classList.remove('is-dragging');
      const dropZone = document.getElementById('tag-drop-zone');
      if (dropZone) dropZone.style.display = 'none';
    });
  }

  _destroyStack() {
    this._stackEl?.remove();
    this._stackEl = null;
    this._bobAnim = null;
  }
}

window.DragStack = DragStack;
