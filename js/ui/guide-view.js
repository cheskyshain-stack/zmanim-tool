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
      <summary>Print a chart with your own page splits</summary>
      <div class="panel-body">
        <ol>
          <li>Open <strong>Seasonal charts → Print layouts</strong>.</li>
          <li>Choose the season and Hebrew year, then continue.</li>
          <li>Adjust the number of weeks on each page and open the charts.</li>
          <li>Use <strong>Print / Save as PDF</strong>.</li>
        </ol>
        <p>Your page splits and cell edits are saved on this device. They do not change the automatic public charts.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Printing and PDFs</summary>
      <div class="panel-body">
        <p>Use <strong>Print / Save as PDF</strong>, then choose your printer or Save as PDF. For season charts, use Letter paper in landscape and enable background graphics.</p>
        <p>Shabbos pages print first in each pair, followed by the matching weekday page. Padding changes the space around the chart. Black and white applies to all chart pages, while the building picture stays in colour.</p>
      </div>
    </details>
    <details class="panel">
      <summary>Saved copies</summary>
      <div class="panel-body">
        <p>Open <strong>Seasonal charts → Saved copies</strong> to reopen a chart you prepared. A Shabbos chart and its weekday chart share one entry.</p>
        <p>You can edit cells, print, organise copies into folders, or lock a copy against deletion. These copies are kept in this browser on this device.</p>
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
        <p>Turn on <strong>Explain times</strong>, then click a schedule time to see its calculation and rounding. Turn it off to edit times.</p>
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
