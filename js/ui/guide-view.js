/** Help for the current automatic schedule workflow. */
export function renderGuide(container, onOpenTab) {
  container.innerHTML = `
    <h2>Help &amp; instructions</h2>
    <p class="hint">Find schedules, prepare printed charts, and manage your local copies.</p>
    <details class="panel" open>
      <summary>Automatic schedules</summary>
      <div class="panel-body">
        <p>The congregation website generates its seasonal charts automatically. There is no seasonal sending or publishing step.</p>
        <p><strong>Weekly schedules</strong> shows one week at a time. <strong>Seasonal charts → View charts</strong> shows the full chart, with Previous, Today, and Next controls.</p>
        <p>Each season uses three Shabbos pages and three matching weekday pages. Times are recalculated from the schedule formulas; old saved cell edits are not carried onto the public site.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Find print settings</summary>
      <div class="panel-body">
        <p>Weekly schedules, seasonal charts and special schedules share a <strong>Print setup</strong> panel. <strong>Schedules</strong> chooses what to print, <strong>Pages</strong> sets paper and arrangement, and <strong>Appearance</strong> contains margins, ink and other details available for that format.</p>
        <p>Use <strong>Find a setting</strong> to jump to an option. The print bar shows the sheet count and paper size. Keep the matching paper and orientation in your printer's dialog.</p>
        <p><strong>Use previous print setup</strong> returns to the earlier menus. Switching menus keeps your saved schedules and print choices. The choice is remembered on this device.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Print a chart with your own page splits</summary>
      <div class="panel-body">
        <ol>
          <li>Open <strong>Seasonal charts → View charts</strong> and choose the chart.</li>
          <li>In <strong>Print setup → Pages</strong>, choose <strong>Customise a local print copy</strong>.</li>
          <li>Open <strong>Adjust weeks per page</strong>, choose the page count and weeks, then apply the page breaks.</li>
          <li>Use <strong>Print / Save as PDF</strong>.</li>
        </ol>
        <p>Your print layout is saved on this device. Chart cells are read-only. You can also begin with <strong>Seasonal charts → Print layouts</strong> to select a season and Hebrew year.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Printing and PDFs</summary>
      <div class="panel-body">
        <p>Use <strong>Print / Save as PDF</strong>, then choose your printer or Save as PDF. Seasonal charts offer separate Letter pages, Shabbos and weekdays together on landscape Letter, or together on landscape 11 × 17 paper (Ledger / Tabloid). Enable background graphics.</p>
        <p>Separate pages print Shabbos first in each pair, followed by the matching weekday page. Padding changes the space around a saved chart. Black and white applies to all chart pages, while the building picture stays in colour.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Saved copies</summary>
      <div class="panel-body">
        <p>Open <strong>Seasonal charts → Saved copies</strong> to reopen a chart you prepared. A Shabbos chart and its weekday chart share one entry.</p>
        <p>You can adjust print layouts, print, organise copies into folders, or lock a copy against deletion. These copies are kept in this browser on this device.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Special schedules and messages</summary>
      <div class="panel-body">
        <p><strong>Special schedules</strong> contains the Yom Tov and fast day posters, plus the option to write a sheet of your own.</p>
        <p><strong>Schedule messages</strong> opens the separate page for preparing and copying schedule messages.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Shul View and the website</summary>
      <div class="panel-body">
        <p><strong>Shul View controls</strong> manages announcements, Parnes Hayom, and screen settings. Use its calendar to preview a date, or choose <strong>Open Shul View</strong> to see the live screen.</p>
        <p><strong>Website schedule status</strong> shows which schedules appear on the website and when they change. <strong>Site statistics</strong> shows website traffic and admin activity for your selected dates.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Settings and backups</summary>
      <div class="panel-body">
        <p><strong>Schedule settings</strong> contains the shul details, location, calculation preferences, rules, and backups. Local settings affect the admin previews and print copies; changing them does not automatically update the public site's shared settings.</p>
        <p>Phone and computer copies do not sync. Clearing browser data can erase local work. Use <strong>Schedule settings → Backup</strong> to export a backup or import one on another device.</p>
        <p>Turn on <strong>Explain times</strong>, then click a schedule time to see its calculation and rounding.</p>
      </div>
    </details>
    <div class="actions">
      <button type="button" id="guide-start" class="btn-primary">Open seasonal charts</button>
      <button type="button" id="guide-program">Offline program</button>
    </div>
  `;
  container.querySelector('#guide-start').addEventListener('click', () => onOpenTab('charts'));
  container.querySelector('#guide-program').addEventListener('click', () => onOpenTab('program'));
}
