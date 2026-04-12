'use strict';

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('gotcha-theme', next);

  document.querySelectorAll('#theme-toggle').forEach(btn => {
    if (btn.classList.contains('ghost-btn')) {
      btn.textContent = next === 'dark' ? '☀ Light mode' : '☾ Dark mode';
    } else {
      btn.textContent = next === 'dark' ? '☀' : '☾';
    }
  });
}
