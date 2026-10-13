import { setupPrintNavigation, previousPrintSetup, printSetupLink, printSetupNote, currentPrintSummary } from './print-setup.js';
import { pageBreakControls } from './page-break-controls.js';

const switchField = (root, key) => root.querySelector(`#${key}-label`)?.closest('.poster-bar-switch')
  || root.querySelector(`#${key}-label`)?.parentElement;
const labelField = (root, key) => root.querySelector(`#${key}`)?.closest('label');
const yearField = (root, key) => root.querySelector(`#${key}`)?.closest('.poster-year');
const relabelSwitch = (root, key, question, labels) => {
  const title = root.querySelector(`#${key}-label`);
  if (title) title.textContent = question;
  for (const [value, text] of Object.entries(labels)) {
    const label = root.querySelector(`label[for="${key}-${value}"]`);
    if (label) label.textContent = text;
  }
};
const otherScreens = () => [
  { label: 'Weeks per page and saved chart layouts', words: 'season summer winter pages page breaks', where: 'Seasonal charts', open: () => { location.hash = '#generate'; } },
  { label: 'Molad and Molad wording', words: 'Hebrew Yiddish', where: 'Saved chart appearance', open: () => { location.hash = '#saved'; } },
  { label: 'Shared header and footer', words: 'letterhead photo logo address', where: 'Schedule settings', open: () => { location.hash = '#settings'; } },
];

export function setupSpecialPrintNavigation(root, redraw) {
  const bar = root.querySelector('.special-controls > .poster-bar');
  if (!bar) return;
  const classic = previousPrintSetup();
  const settings = root.querySelector('.special-print-settings');
  const workflow = root.querySelector('.special-workflow');
  const half = root.querySelector('.special-half-pairs');
  const picker = root.querySelector('#poster-pick');
  const combinedOption = picker?.querySelector('option[value="__combined__"]');
  const copies = switchField(root, 'poster-copies');
  const pages = [switchField(root, 'poster-sheets'), switchField(root, 'poster-set-layout'), copies,
    switchField(root, 'poster-break'), switchField(root, 'poster-orient'), half];
  const ink = switchField(root, 'poster-ink');
  const appearance = [labelField(root, 'poster-asara-shacharis'), ink, settings];
  const schedules = [workflow, switchField(root, 'poster-scope'), yearField(root, 'poster-group'), labelField(root, 'poster-pick'),
    root.querySelector('.special-set-list'), root.querySelector('#poster-own')];
  if (root.querySelector('#poster-own-new')) schedules.push(root.querySelector('#poster-own-new'));
  const navigation = setupPrintNavigation(root, {
    key: 'special', anchor: bar, mount: root.querySelector('.special-controls'),
    context: [yearField(root, 'poster-year')], schedules, pages, appearance,
    actions: [root.querySelector('#print-btn')], onRedraw: redraw,
    defaults: root.querySelector('#poster-workflow-halves')?.checked ? 'pages' : 'schedules',
    summaries: { schedules: 'Choose sheets', pages: 'Size + arrangement', appearance: 'Ink + details' },
    searchLinks: otherScreens(), summary: () => currentPrintSummary(root),
    enhance: setup => {
      relabelSwitch(root, 'poster-workflow', 'Print selection', { single: 'One schedule', set: 'Several schedules', halves: 'Half-page handouts' });
      relabelSwitch(root, 'poster-set-layout', 'Arrange occasions', { original: 'Separate posters', combined: 'One poster per occasion' });
      relabelSwitch(root, 'poster-sheets', 'Printed size', {});
      relabelSwitch(root, 'poster-copies', 'Right half', { one: 'Blank', two: 'Same handout' });
      relabelSwitch(root, 'poster-orient', 'Poster orientation', {});
      if (combinedOption) {
        combinedOption.textContent = 'Whole occasion on one poster';
        combinedOption.hidden = true;
        const arrangement = document.createElement('label');
        arrangement.className = 'print-setup-field';
        arrangement.textContent = 'Occasion arrangement';
        const select = document.createElement('select');
        select.id = 'print-occasion-arrangement';
        select.innerHTML = '<option value="original">Selected poster</option><option value="combined">Whole occasion on one poster</option>';
        select.value = picker.value === '__combined__' ? 'combined' : 'original';
        select.addEventListener('change', () => {
          picker.value = select.value === 'combined' ? '__combined__' : [...picker.options].find(option => option.value !== '__combined__').value;
          picker.dispatchEvent(new Event('change', { bubbles: true }));
        });
        arrangement.append(select);
        setup.querySelector('[data-print-pane="pages"]').prepend(arrangement);
      }
      if (copies) {
        const pairDifferent = document.createElement('button');
        pairDifferent.type = 'button';
        pairDifferent.id = 'print-pair-different';
        pairDifferent.textContent = 'Arrange different handouts';
        pairDifferent.addEventListener('click', () => root.querySelector('#poster-workflow-halves')?.click());
        copies.after(pairDifferent);
      }
      if (half) {
        const addAll = half.querySelector('#half-add-all');
        if (addAll) setup.querySelector('[data-print-pane="schedules"]').prepend(addAll);
        half.querySelectorAll('.special-half-pair').forEach((pair, index) => {
          for (const select of pair.querySelectorAll('select[data-half-shacharis]')) {
            const field = select.closest('label');
            field.firstChild.textContent = `Sheet ${index + 1}, ${select.dataset.halfShacharis} half: Shacharis locations`;
            setup.querySelector('[data-print-pane="appearance"]').prepend(field);
          }
          const right = pair.querySelector('select[data-half-side="right"]');
          const left = pair.querySelector('select[data-half-side="left"]');
          if (right && left) {
            const same = document.createElement('option');
            same.value = '__same__';
            same.textContent = 'Same as left';
            right.options[0].after(same);
            const layout = side => root.querySelector(`#half-${CSS.escape(pair.dataset.id)}-${side}-shacharis`)?.value || 'compact';
            if (right.value && right.value === left.value && layout('left') === layout('right')) right.value = '__same__';
          }
        });
      }
      if (settings) {
        if (yearField(root, 'poster-margin')) settings.querySelector('summary').textContent = 'Margins';
        else settings.remove();
      }
      const own = root.querySelector('.own-editor');
      if (own) { own.querySelector('summary').textContent = 'Edit custom schedule'; own.open = false; }
      setup.querySelector('[data-print-pane="appearance"]').append(printSetupLink('Shared header and footer settings', '#settings'));
      const copy = root.querySelector('#poster-copy-btn');
      if (copy) root.querySelector('.special-preview-tools')?.append(copy);
      bar.hidden = !bar.children.length;
      const oldAction = root.querySelector('.special-print-action');
      if (oldAction) oldAction.hidden = true;
    },
  });
  if (!classic && navigation) root.querySelector('.special-controls').classList.add('has-print-setup');
  return navigation;
}

export function setupSavedChartPrintNavigation(root, { sheet, primary, companion, redraw, apply }) {
  const anchor = root.querySelector('#chart-layout-panel');
  if (!anchor) return;
  const previous = previousPrintSetup();
  const pageBreaks = pageBreakControls(primary, companion, apply);
  const navigation = setupPrintNavigation(root, {
    key: 'saved-chart', anchor, onRedraw: redraw, defaults: 'pages',
    schedules: [printSetupNote(`${primary.season === 'kayitz' ? 'Summer' : primary.season === 'choref' ? 'Winter' : 'Weekday'} chart · ${primary.hebrewYear} · ${primary.weeks.length} weeks`),
      printSetupLink('Open saved layouts', '#saved'), printSetupLink('View automatic seasonal charts', '#charts')],
    pages: [labelField(root, 'chart-print-layout'), pageBreaks, switchField(root, 'chart-dst-headers')],
    appearance: [yearField(root, 'chart-pad-y'), yearField(root, 'chart-pad-x'), switchField(root, 'chart-ink'),
      switchField(root, 'chart-molad'), switchField(root, 'chart-molad-format'),
      printSetupNote('Margins apply to this chart. Ink and Molad apply to your admin chart print copies on this device.'),
      printSetupLink('Shared header and footer settings', '#settings')],
    actions: [root.querySelector('#print-btn')], summary: () => currentPrintSummary(root),
    summaries: { schedules: 'Saved layout', pages: 'Paper + weeks', appearance: 'Margins + Molad' },
    searchLinks: [{ label: 'Molad wording', words: 'Molad format Hebrew Yiddish', where: 'Appearance', open: () => {
      navigation.selectTab('appearance');
      if (!root.querySelector('#chart-molad-on').checked) {
        const field = switchField(root, 'chart-molad');
        if (!field.querySelector('.print-setup-note')) field.append(printSetupNote('Turn Molad on to choose Hebrew or Yiddish wording.'));
        field.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    } }, ...otherScreens().filter(link => !link.words.includes('Hebrew'))],
    enhance: () => { anchor.hidden = true; },
    refresh: () => {
      const field = switchField(root, 'chart-molad-format');
      if (field) field.hidden = !root.querySelector('#chart-molad-on')?.checked;
    },
  });
  if (!previous && navigation) root.querySelector('.sheet-toolbar').classList.add('print-setup-back');
  return navigation;
}

export function setupAutomaticChartPrintNavigation(root, { redraw, customize }) {
  const anchor = root.querySelector('.week-nav-row.week-nav-print-one');
  if (!anchor) return;
  const makeCopy = document.createElement('button');
  makeCopy.type = 'button';
  makeCopy.id = 'print-customize-chart';
  makeCopy.textContent = 'Customise a local print copy';
  makeCopy.addEventListener('click', customize);
  return setupPrintNavigation(root, {
    key: 'automatic-chart', anchor, onRedraw: redraw, defaults: 'pages',
    schedules: [printSetupNote('The current seasonal chart is selected. Use Previous, Today and Next to choose another stretch.'),
      printSetupLink('Open saved layouts', '#saved')],
    pages: [labelField(root, 'chart-print-layout'), makeCopy],
    appearance: [printSetupNote('To adjust margins, ink or Molad, customise a local print copy.'),
      printSetupLink('Shared header and footer settings', '#settings')],
    actions: [root.querySelector('#print-btn'), root.querySelector('#pdf-btn')],
    summary: () => currentPrintSummary(root), summaries: { schedules: 'Current chart', pages: 'Letter / 11×17', appearance: 'Print copy settings' },
    searchLinks: [{ label: 'Weeks per page, margins, ink and Molad', words: 'page breaks allocation Yiddish format', where: 'Local print copy', open: customize }, ...otherScreens()],
    enhance: () => { anchor.hidden = true; },
  });
}

export function setupWeeklyPrintNavigation(root, redraw) {
  const anchor = root.querySelector('.week-print-panel');
  if (!anchor) return;
  const navigation = setupPrintNavigation(root, {
    key: 'weekly', anchor, onRedraw: redraw, defaults: 'pages',
    schedules: [printSetupNote('Use Previous, This week and Next to choose the week.'), root.querySelector('#week-print-rest')],
    pages: [root.querySelector('.week-switches')],
    appearance: [printSetupNote('This weekly layout keeps its established appearance and fits Letter paper automatically.'),
      printSetupLink('Shared header and footer settings', '#settings')],
    actions: [root.querySelector('#print-btn'), root.querySelector('#pdf-btn')],
    summaries: { schedules: 'This week / remaining', pages: 'Separate / together', appearance: 'Shared letterhead' },
    searchLinks: otherScreens(), summary: () => currentPrintSummary(root),
    enhance: () => {
      relabelSwitch(root, 'week-layout', 'Shabbos + weekdays', { charts: 'Separate pages', combined: 'Together on Letter' });
      anchor.hidden = true;
      const copy = root.querySelector('#week-copy-btn');
      if (copy) root.querySelector('.week-nav')?.append(copy);
    },
  });
  return navigation;
}
