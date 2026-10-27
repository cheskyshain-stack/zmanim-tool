import { announcementRequest, announcementArticle } from './api.js';
import { renderAnnouncementNotifications } from './notifications.js';
import { wireInstalledSystemBars } from '../ui/system-bars.js';

wireInstalledSystemBars();
const list = document.getElementById('announcements-list'), notice = document.getElementById('announcements-notifications');
async function refreshAnnouncements() {
  try {
    const { posts } = await announcementRequest('/api/posts');
    list.innerHTML = posts.length ? posts.map(announcementArticle).join('') : '<div class="announcement-empty">There are no current announcements.</div>';
    if (!notice.childElementCount && !notice.textContent) await renderAnnouncementNotifications(notice);
    const selected = new URLSearchParams(location.search).get('post');
    if (selected) {
      const message = [...list.querySelectorAll('article')].find(article => article.id === 'message-' + selected);
      if (message) { message.classList.add('is-selected'); message.tabIndex = -1; message.focus({ preventScroll: true }); message.scrollIntoView({ block: 'nearest' }); }
      else list.insertAdjacentHTML('afterbegin', '<p class="announcement-note">That message has expired or been removed. Current announcements are below.</p>');
    }
  } catch (error) {
    list.replaceChildren(); const text = document.createElement('p'); text.className = 'announcement-error'; text.textContent = error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again'; retry.addEventListener('click', refreshAnnouncements); list.append(text, retry);
  }
}
refreshAnnouncements();
