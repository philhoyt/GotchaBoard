'use strict';

window.toggleTheme = function () {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('gotcha-theme', next);

  // Update toggle button glyph everywhere on the page
  document.querySelectorAll('#theme-toggle').forEach(btn => {
    btn.textContent = next === 'dark' ? '☀' : '☾';
  });
};
