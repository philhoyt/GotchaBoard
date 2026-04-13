export function toast(msg, duration = 2800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-message">${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  if (duration > 0) {
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }
  return el;
}
