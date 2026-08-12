// The "what is this and how do I use it" page, written for someone opening the site for
// the first time with no idea what it does. Lives inside the app rather than in a README
// so it travels with the offline/USB copy and is there at the moment it's needed.

/** @param {(tab: string) => void} onOpenTab  jumps to another screen from a link here. */
export function renderGuide(container, onOpenTab) {
  container.innerHTML = `
    <h2>Guide</h2>
    <p class="hint">What this site is, and how to get a printed board out of it.</p>

    <div class="guide-lede">
      <p>This generates the printed <strong>zmanim boards</strong> for קהל לב מנחם — the שבת קיץ and שבת חורף charts and the matching Weekday chart. Every time in them is calculated for the shul's exact location, so a new year's board takes a minute instead of an afternoon of editing last year's.</p>
      <p>Everything happens in this browser. There's no login and nothing to install, and no one else sees what you do here.</p>
    </div>

    <details class="panel" open>
      <summary>Make your first board — 3 steps</summary>
      <div class="panel-body">
        <ol class="guide-steps">
          <li>
            <strong>Generate → pick the season and year.</strong>
            <span class="hint">שבת קיץ runs Pesach → Sukkos, שבת חורף runs Sukkos → Pesach. The year and season start on whichever one is coming up next, so usually you can just press Continue. The app works out which Shabbosim belong to that season by itself, skipping the ones with no parsha.</span>
          </li>
          <li>
            <strong>Choose how the weeks split across pages.</strong>
            <span class="hint">It tells you how many weeks the season has and suggests an even split. Change the number on any page and the rest adjust. A Weekday chart is generated alongside, covering the same weeks.</span>
          </li>
          <li>
            <strong>Press Generate.</strong>
            <span class="hint">The finished board opens straight away, and is saved automatically — you never have to remember to save.</span>
          </li>
        </ol>
      </div>
    </details>

    <details class="panel">
      <summary>Working on a board</summary>
      <div class="panel-body">
        <p><strong>Any cell can be edited.</strong> Click it and type. Typing <code>300</code> becomes <code>3:00</code> — you can enter a whole row of times as bare numbers and let it space them out. Edits stick to that one board and never touch next year's.</p>
        <p><strong>Formatting.</strong> Select text inside a cell, then use the buttons in the toolbar: <u>U</u> underlines (that's how the board marks a minyan that's downstairs), A+ and A− change its size. Keyboard: <kbd>Ctrl</kbd>+<kbd>U</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>&gt;</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>&lt;</kbd>.</p>
        <p><strong>Undo / Redo</strong> covers cell edits, for as long as the board stays open.</p>
        <p><strong>Layout &amp; style</strong> changes the font, the text size, the logo size and the heading colour for the whole board.</p>
        <p><strong>Side by side</strong> shows the Shabbos and Weekday charts next to each other, shrunk, to compare them. <strong>Fit to screen</strong> scales a page down until it fits across the screen — it turns itself on automatically on a phone, where a full-width page otherwise can't be seen at all.</p>
      </div>
    </details>

    <details class="panel">
      <summary>Printing and PDFs</summary>
      <div class="panel-body">
        <p><strong>Print / Save as PDF</strong> opens your browser's print dialog. Saving a PDF is the same button — choose "Save as PDF" as the destination instead of a printer.</p>
        <p>Set the paper to <strong>Letter, landscape</strong>, and turn on <strong>background graphics</strong> so the shaded header row prints.</p>
        <p>The Shabbos and Weekday pages come out interleaved — שבת, its Weekday chart, שבת, its Weekday chart — so the pair for a run of weeks stays together.</p>
        <p>Under <strong>Which pages to print or save</strong> you can untick individual pages. Unticked pages stay on screen, dimmed, and are left out of the print.</p>
      </div>
    </details>

    <details class="panel">
      <summary>Rules — the difference between a one-off and every year</summary>
      <div class="panel-body">
        <p>Editing a cell changes <em>that board</em>. A <strong>rule</strong> changes <em>every board you generate from now on</em>, which is what you want for something that comes back every year.</p>
        <p>Three are built in: שבת הגדול and שבת שובה add "דרשה" to the Mincha column, and ט באב marks the Shabbos when the fast starts מוצאי שבת. A rule can match on a special-Shabbos name (שובה, הגדול), a parsha name, a Hebrew date (recurring every year), or every week.</p>
        <p>One rule can cover both charts at once — tick the matching column on קיץ and on חורף. Rules can be switched off without deleting them, and <strong>Duplicate</strong> starts a new one from an existing one.</p>
        <p>Cells a rule has touched show a light yellow background on the board.</p>
      </div>
    </details>

    <details class="panel">
      <summary>Saved sheets</summary>
      <div class="panel-body">
        <p>Every board you generate is saved here automatically. A Shabbos board and the Weekday chart made with it are one entry — open either from the same row.</p>
        <p><strong>Lock</strong> protects a board from being deleted until you unlock it. <strong>Folders</strong> are for keeping the list tidy: a folder appears as soon as you put something in it and disappears when the last thing leaves.</p>
      </div>
    </details>

    <details class="panel">
      <summary>Settings</summary>
      <div class="panel-body">
        <p>The shul's location, elevation, timezone and the offsets the calculations use (candle lighting, the various Tzais and Plag opinions), plus the shul name, the rabbi's line and the daily שחרית schedule printed on the Weekday chart. It's already set up for 44 Coles Way — you shouldn't need to touch it unless something moves.</p>
      </div>
    </details>

    <details class="panel">
      <summary>Where your work is kept — read this one</summary>
      <div class="panel-body">
        <p>Boards, rules and settings are stored <strong>in this browser on this device</strong>. That means:</p>
        <ul>
          <li>Your phone and your computer each have their own boards. They don't sync.</li>
          <li>Clearing the browser's site data erases them.</li>
          <li>Nobody else visiting the site sees your work, and you don't see theirs.</li>
        </ul>
        <p>To move everything between devices, or to keep a backup: <strong>Settings → Backup → Export</strong> writes one file, and <strong>Import</strong> reads it back on the other device.</p>
        <p><strong>Offline:</strong> the site also ships as a folder you can copy to a USB stick and open on a computer with no internet — open <code>index.html</code> inside it and it behaves exactly the same.</p>
      </div>
    </details>

    <div class="actions"><button type="button" id="guide-start" class="btn-primary">Make a board →</button></div>
  `;

  container.querySelector('#guide-start').addEventListener('click', () => onOpenTab('generate'));
}
