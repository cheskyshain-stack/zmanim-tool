import { keepPosition } from '../ui/keep-position.js';

export function seatsCreateWorkspace(root, { getMode, onResize }) {
  function refresh() {
    const workspace = root.querySelector('.seats-workspace');
    if (!workspace || getMode() !== 'people' || !matchMedia('(min-width:1000px)').matches) return;
    const top = Math.max(12, workspace.getBoundingClientRect().top);
    root.style.setProperty('--seats-sidebar-height', Math.max(320, innerHeight - top - 16) + 'px');
    const chart = workspace.querySelector('.room-scroll'), footer = workspace.querySelector('.canvas-foot');
    if (chart) root.style.setProperty('--seats-whole-height', Math.max(140, innerHeight - Math.max(12, chart.getBoundingClientRect().top) - (footer?.getBoundingClientRect().height || 0) - 17) + 'px');
  }
  window.addEventListener('resize', () => { keepPosition(root, refresh); onResize(); });
  document.fonts?.ready.then(() => { keepPosition(root, refresh); onResize(); });
  return { refresh };
}
