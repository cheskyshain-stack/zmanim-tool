const seatsStartArrow = '<svg class="seats-start-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>';
const seatsStartChart = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M9 5h22l8 8v30H9Z"/><path d="M31 5v8h8M16 21h16M16 28h16M16 35h10"/></svg>';
const seatsStartFolder = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M5 16V9h15l4 6h19v25H5Z"/><path d="M5 20h38"/></svg>';
const seatsStartRoom = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path d="M5 13V5h38v38H5V27M11 12h10v5H11ZM27 12h10v5H27ZM11 25h10v5H11ZM27 25h10v5H27ZM13 20h2m2 0h2m10 0h2m2 0h2M13 33h2m2 0h2m10 0h2m2 0h2"/></svg>';

export function seatsStartMarkup(screen) {
  if (screen === 'home') return `<section class="seats-start no-print" aria-labelledby="seats-start-title">
    <header class="seats-start-heading"><div><div class="title-line"><h1 id="seats-start-title">Seats</h1><span class="tool-badge">SEATING PLANNER</span></div><p>Set up a new seating chart or open one you’ve saved.</p></div><button type="button" class="seats-start-lock" data-action="lock">Lock</button></header>
    <div class="seats-start-options">
      <button type="button" class="seats-start-card" data-action="start-create" aria-label="Create new chart" aria-describedby="seats-start-create-help"><span class="seats-start-icon">${seatsStartChart}</span><span class="seats-start-card-copy"><strong>Create new chart</strong><span id="seats-start-create-help">Choose a room and start with an empty layout.</span></span>${seatsStartArrow}</button>
      <button type="button" class="seats-start-card" data-action="start-saved" aria-label="View saved charts" aria-describedby="seats-start-saved-help"><span class="seats-start-icon">${seatsStartFolder}</span><span class="seats-start-card-copy"><strong>View saved charts</strong><span id="seats-start-saved-help">Open a setup and continue where you left off.</span></span>${seatsStartArrow}</button>
    </div>
  </section>`;
  const creating = screen === 'create';
  return `<section class="seats-start no-print" aria-labelledby="seats-start-title">
    <button type="button" class="seats-start-back" data-action="home"><span aria-hidden="true">←</span> Seats home</button>
    <header class="seats-start-heading"><div><p class="seats-start-eyebrow">Seats</p><h1 id="seats-start-title">${creating ? 'Create new chart' : 'View saved charts'}</h1><p>Choose a room.</p></div></header>
    <div class="seats-start-options seats-start-rooms">
      <button type="button" class="seats-start-card" data-action="choose-room" aria-label="7:30 minyan" aria-describedby="seats-start-room-help"><span class="seats-start-icon">${seatsStartRoom}</span><span class="seats-start-card-copy"><strong>7:30 minyan</strong><span id="seats-start-room-help">${creating ? 'Start a new chart for this room.' : 'Open saved setups for this room.'}</span></span>${seatsStartArrow}</button>
      <button type="button" class="seats-start-card seats-start-unavailable" disabled aria-label="Main BM" aria-describedby="seats-main-bm-status"><span class="seats-start-icon">${seatsStartRoom}</span><span class="seats-start-card-copy"><strong>Main BM</strong><span id="seats-main-bm-status" class="seats-start-coming">Coming soon</span></span></button>
    </div>
  </section>`;
}
