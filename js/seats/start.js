const seatsStartArrow = '<svg class="seats-start-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>';
const seatsStartChart = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M9 5h22l8 8v30H9Z"/><path d="M31 5v8h8M16 21h16M16 28h16M16 35h10"/></svg>';
const seatsStartFolder = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M5 16V9h15l4 6h19v25H5Z"/><path d="M5 20h38"/></svg>';
const seatsStartLogout = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><path d="M10 5H5v14h5M9 12h12m-4-4 4 4-4 4"/></svg>';

export function seatsStartMarkup() {
  return `<section class="seats-start no-print" aria-labelledby="seats-start-title">
    <header class="seats-start-heading"><div><p class="seats-start-kicker">SEATING PLANNER</p><h1 id="seats-start-title">Seats</h1><p class="seats-start-intro">Open a saved chart or create a new one.</p></div><button type="button" class="seats-start-logout" data-action="logout">${seatsStartLogout}<span>Log out</span></button></header>
    <div class="seats-start-options">
      <button type="button" class="seats-start-card seats-start-primary" data-action="start-saved" aria-label="View saved charts" aria-describedby="seats-start-saved-help"><span class="seats-start-icon">${seatsStartFolder}</span><span class="seats-start-card-copy"><strong>View saved charts</strong><span id="seats-start-saved-help">Continue editing a saved chart.</span></span>${seatsStartArrow}</button>
      <button type="button" class="seats-start-card" data-action="start-create" aria-label="Create new chart" aria-describedby="seats-start-create-help"><span class="seats-start-icon">${seatsStartChart}</span><span class="seats-start-card-copy"><strong>Create new chart</strong><span id="seats-start-create-help">Start with an empty chart.</span></span>${seatsStartArrow}</button>
    </div>
  </section>`;
}
