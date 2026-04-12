'use strict';

window.toggleTheme = function () {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('gotcha-theme', next);

  // Update toggle button text everywhere on the page
  document.querySelectorAll('#theme-toggle').forEach(btn => {
    // Icon-only buttons (discover page) get just the glyph
    // Ghost buttons in settings panel get a label too
    if (btn.classList.contains('ghost-btn')) {
      btn.textContent = next === 'dark' ? '☀ Light mode' : '☾ Dark mode';
    } else {
      btn.textContent = next === 'dark' ? '☀' : '☾';
    }
  });
};
