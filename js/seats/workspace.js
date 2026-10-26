import { keepPosition } from '../ui/keep-position.js';

export function seatsCreateWorkspace(root, { getMode, onResize }) {
  function refresh() {
    const workspace = root.querySelector('.seats-workspace');
    if (!workspace || getMode() !== 'people' || !matchMedia('(min-width:1000px)').matches) return;
    const top = Math.max(12, workspace.getBoundingClientRect().top);
    root.style.setProperty('--seats-workspace-height', Math.max(320, innerHeight - top - 16) + 'px');
  }
  window.addEventListener('resize', () => { keepPosition(root, refresh); onResize(); });
  document.fonts?.ready.then(() => { keepPosition(root, refresh); onResize(); });
  return { refresh };
}
