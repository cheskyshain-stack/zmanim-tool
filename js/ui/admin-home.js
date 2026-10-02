/** Shared task names keep the home page and navigation consistent. */
export const ADMIN_TAB_LABELS = {
  home: 'Admin home', week: 'Weekly schedules', charts: 'Seasonal charts',
  generate: 'Print layouts', saved: 'Saved copies', posters: 'Special schedules',
  status: 'Website schedule status', traffic: 'Site statistics',
  settings: 'Schedule settings', calc: 'Calculation guide',
  guide: 'Help & instructions', program: 'Offline program',
};

export const ADMIN_NAV_SECTIONS = [
  { title: 'Schedules', description: 'View times and prepare charts for printing.', items: [
    { tab: 'week', icon: 'week', description: 'Browse the weekday and Shabbos schedules, one week at a time.' },
    { tab: 'charts', icon: 'generate', description: 'View seasonal charts, adjust print layouts, and reopen saved copies.' },
    { tab: 'posters', icon: 'posters', description: 'View and print Yom Tov, fast day, and other special schedules.' },
  ] },
  { title: 'Website & screen', description: 'Manage what people see and read.', items: [
    { href: '/admin/display/', label: 'Shul View controls', icon: 'screen', description: 'Edit announcements, Parnes Hayom, screen settings, and date previews.' },
    { href: '/texts/', label: 'Schedule messages', icon: 'texts', description: 'Prepare and copy schedule messages to share.' },
    { tab: 'status', icon: 'status', description: 'Check which schedules are showing on the website and when they change.' },
    { tab: 'traffic', icon: 'traffic', description: 'Review website views, visits, traffic sources, and admin activity for the same date range.' },
  ] },
  { title: 'Settings & help', description: 'Adjust schedules and find instructions.', items: [
    { tab: 'settings', icon: 'settings', description: 'Change local schedule rules and print preferences, or save a backup.' },
    { tab: 'calc', icon: 'calc', description: 'See how the schedule times are calculated.' },
    { tab: 'guide', icon: 'guide', description: 'Find printing instructions, saved-copy help, and the offline program.' },
  ] },
];

/** No live status is inferred here. Each task opens its own source of information. */
export function renderAdminHome(container, onOpenTab) {
  const admHomeLink = (item) => `<a class="admin-home-task" href="${item.tab ? `#${item.tab}` : item.href}"${item.tab ? ` data-admin-tab="${item.tab}"` : ''}>
    <span class="admin-home-task-title">${item.tab ? ADMIN_TAB_LABELS[item.tab] : item.label}<span aria-hidden="true">&rarr;</span></span>
    <span class="admin-home-task-description">${item.description}</span>
  </a>`;
  container.innerHTML = `<div class="admin-home">
    <header class="admin-home-heading">
      <p class="admin-home-eyebrow">Bais Medrash of Lakewood Commons</p>
      <h2>Admin home</h2>
      <p>Schedules, announcements, and the tools that keep the shul informed.</p>
      <div class="admin-home-quick-links">
        <a class="admin-home-primary" href="/admin/display/">Shul View controls <span aria-hidden="true">&rarr;</span></a>
        <a href="/tv/" target="_blank" rel="noopener">Open Shul View <span class="admin-home-new-tab">(new tab)</span></a>
        <a href="/" target="_blank" rel="noopener">Open website <span class="admin-home-new-tab">(new tab)</span></a>
      </div>
    </header>
    <div class="admin-home-grid">${ADMIN_NAV_SECTIONS.map((section) => `<section class="admin-home-section">
      <header><h3>${section.title}</h3><p>${section.description}</p></header>
      ${section.items.map(admHomeLink).join('')}
      ${section.title === 'Schedules' ? '<div class="admin-home-secondary"><a href="#generate" data-admin-tab="generate">Print layouts</a><a href="#saved" data-admin-tab="saved">Saved copies</a></div>' : ''}
    </section>`).join('')}</div>
    <p class="admin-home-note">Saved copies and schedule settings are kept in this browser. Use Schedule settings to export a backup. Screen announcements are managed separately in Shul View controls.</p>
  </div>`;
  container.querySelectorAll('[data-admin-tab]').forEach((link) => link.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenTab(link.dataset.adminTab);
  }));
}
