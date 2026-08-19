// The "download the program" page. The same boards and the same numbers as this site, as a
// program that runs on its own with no browser and nothing to install.
//
// The files are Release assets on the repository rather than files served from this site.
// Two reasons: a 40MB program per platform does not belong in a repository that GitHub Pages
// serves, and the `latest` link means a new build reaches people without this page being
// edited. The names are fixed for the same reason.

const RELEASES = 'https://github.com/cheskyshain-stack/zmanim-tool/releases';
const LATEST = `${RELEASES}/latest/download`;
// The browser copy, built by build-offline.py and zipped by the release workflow.
const OFFLINE_FILE = 'Zmanim-offline.zip';

const DOWNLOADS = [
  {
    key: 'windows',
    file: 'Zmanim.exe',
    label: 'Windows',
    detail: 'Any Windows 10 or 11 computer, 64 bit.',
  },
  {
    key: 'mac-apple',
    file: 'Zmanim-mac-apple.zip',
    label: 'Mac, Apple silicon',
    detail: 'A Mac from late 2020 onwards: M1, M2, M3, M4.',
  },
  {
    key: 'mac-intel',
    file: 'Zmanim-mac-intel.zip',
    label: 'Mac, Intel',
    detail: 'An older Mac, before Apple silicon.',
  },
];

/** Which of the three to put first.
 *
 *  Windows and Mac are told apart reliably. Which *kind* of Mac is not: every browser on an
 *  Apple silicon Mac still reports "Intel Mac OS X" for compatibility, so guessing would send
 *  half of them to a build that cannot run. A Mac gets both, and is told where to look.
 *
 *  A phone is detected so it can be told plainly that there is nothing here for it, rather
 *  than being handed a Windows program it will download and be unable to open.
 */
export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  if (/Android/i.test(ua)) return 'phone';
  // An iPad in its default mode reports the same user agent as a Mac. The touch points are
  // what separate them: a Mac reports 0.
  if (/iPhone|iPod|iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return 'phone';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other';
}

function downloadRow(item, isLead) {
  return `
    <a class="dl-row ${isLead ? 'is-lead' : ''}" href="${LATEST}/${item.file}" download>
      <span class="dl-what">
        <strong>${item.label}</strong>
        <span class="hint">${item.detail}</span>
      </span>
      <span class="dl-go">Download</span>
    </a>`;
}

export function renderProgram(container, platform = detectPlatform()) {
  // A Mac leads with both of its own, in the order most Macs now are.
  const order = {
    windows: ['windows', 'mac-apple', 'mac-intel'],
    mac: ['mac-apple', 'mac-intel', 'windows'],
    phone: ['windows', 'mac-apple', 'mac-intel'],
    other: ['windows', 'mac-apple', 'mac-intel'],
  }[platform];
  const leads = platform === 'mac' ? 2 : platform === 'windows' ? 1 : 0;
  const rows = order
    .map((key) => DOWNLOADS.find((d) => d.key === key))
    .map((item, i) => downloadRow(item, i < leads))
    .join('');

  const phoneNote =
    platform === 'phone'
      ? `<p class="dl-warn"><strong>You are on a phone or tablet.</strong> Everything here is meant for a computer: the programs below cannot run on a phone at all, and tapping a link downloads a file it can do little with. Open this page on the computer you want it on.</p>`
      : '';

  container.innerHTML = `
    <h2>Get the program</h2>
    <p class="hint">The same boards, to keep on a computer of your own.</p>

    <div class="guide-lede">
      <!-- Each Hebrew name in its own bdi. Written plainly, the comma between the two is a
           neutral character, so it is swallowed into one right to left run and the pair comes
           out reversed: measured, חורף landed at x=865 and קיץ at x=944, the wrong way round. -->
      <p>Everything on this site, to keep on a computer of your own: the same <bdi>שבת קיץ</bdi>, <bdi>שבת חורף</bdi> and Weekday charts, the same week cards, the same rules and the same numbers, worked out by the same calculations.</p>
      <p>Both ways below need <strong>no internet and nothing installed</strong>, and both carry the whole thing on a USB stick. Worth having for a computer where this site is blocked, and for making a board somewhere with no signal.</p>
    </div>

    ${phoneNote}

    <h3 class="dl-heading dl-heading-first">Opens in a browser</h3>
    <p class="hint">A folder you open in whatever browser is already on the computer. The simplest of the two: nothing to get past on the first run, a quarter of the size, and it works on any computer at all, including one with no build of its own below and one where you are not allowed to run a program you downloaded.</p>
    <div class="dl-list">
      <a class="dl-row" href="${LATEST}/${OFFLINE_FILE}" download>
        <span class="dl-what">
          <strong>Any computer, in a browser</strong>
          <span class="hint">About 260 KB. Unzip it, then open <code>index.html</code>.</span>
        </span>
        <span class="dl-go">Download</span>
      </a>
    </div>
    <p class="hint">It is the whole thing, not a cut down one: generating, typing over cells, rules, printing, backups. It keeps its work in the browser it is opened in, so the same folder on the same stick opens with your boards on the computer you last used it on and empty on a new one. Move work between them with <strong>Settings, Backup, Export</strong>. Publishing to the congregation's page needs the internet, so it does not work with none.</p>

    <h3 class="dl-heading">Or the program, which needs no browser either</h3>
    <p class="hint">A single file that opens on its own, like any other program on the computer. Built for one kind of machine at a time, so take the one that matches. It keeps its boards beside itself, which is what lets a stick carry your work from one computer to the next.</p>
    <div class="dl-list">${rows}</div>

    <p class="hint">Not sure which Mac: <strong>Apple menu, then About This Mac</strong>. If it names an M1, M2, M3 or M4, take the Apple silicon one. An Apple silicon Mac will also run the Intel build, but an Intel Mac cannot run the Apple silicon one.</p>

    <details class="panel" ${platform === 'windows' || platform === 'mac' ? 'open' : ''}>
      <summary>The program will refuse to open the first time. Here is why, and what to press</summary>
      <div class="panel-body">
        <p>None of the three programs is signed with a paid developer certificate, so the computer does not recognise who made it and says so the first time. Nothing is wrong with the file. It is <strong>once per computer</strong>, not every time. The browser copy has nothing to get past.</p>
        <p><strong>Windows.</strong> A blue box says "Windows protected your PC". Press <strong>More info</strong>, then <strong>Run anyway</strong>. If it will not start at all, right click the file, choose Properties, tick <strong>Unblock</strong>, then OK.</p>
        <p><strong>Mac.</strong> Unzip it, then open <code>Zmanim.app</code>. macOS refuses the first time. Go to <strong>System Settings</strong>, then <strong>Privacy &amp; Security</strong>, scroll down to the line naming Zmanim, and press <strong>Open Anyway</strong>. Then open it again.</p>
        <p>Antivirus software sometimes flags programs packed this way. It may need allowing through.</p>
      </div>
    </details>

    <details class="panel">
      <summary>On a USB stick, and where your work is kept</summary>
      <div class="panel-body">
        <p><strong>The program</strong> keeps its boards, rules and settings on the stick, beside itself, so the same stick opens with all your work on any computer you carry it to. Otherwise it keeps them in the usual per-user place on that computer.</p>
        <p><strong>The browser copy</strong> does not. A browser keeps its storage per computer, so carrying that folder carries the program but not the boards: it opens with your work on the computer you last used it on, and empty on a new one. That is the one real difference between the two.</p>
        <p>Its backup file is the same one this site's <strong>Settings, Backup, Export</strong> writes, so work moves either way: a backup made here opens there, and one made there opens here.</p>
        <p>Emailing the program does not work. Gmail refuses <code>.exe</code> attachments and looks inside zips, and most other mail does the same. Use the stick, or a shared link.</p>
      </div>
    </details>

    <details class="panel">
      <summary>What it can do, and what it cannot</summary>
      <div class="panel-body">
        <p>Everything this site does: generate a season, type over any cell, rules, undo and redo, the week's two cards, printing and saving a PDF, backups, and publishing to the congregation's page. It publishes to the same place this site does, so the two can be used side by side.</p>
        <p>It is checked hard before it is handed over. Every build runs the full test suite on the machine that builds it, against the reference output of this site's own engine, and then <strong>starts the program it just made</strong> and has it draw a board, write a PDF and write its save file. A build that cannot do that is not offered here.</p>
        <p>What it does not have: this site is what the congregation sees, and it is the one that stays up to date by itself.</p>
      </div>
    </details>

    <p class="hint"><a href="${RELEASES}" target="_blank" rel="noopener">Every version, with what changed</a>. The links above always fetch the newest.</p>
  `;
}
