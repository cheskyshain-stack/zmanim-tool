import { announcementRequest, announcementEscape as e, announcementDate, announcementArticle } from './api.js';
import { websiteLocalFields, websitePreviewInstant } from '../website-clock.js';
import { keepPosition } from '../ui/keep-position.js';
import { wireInstalledSystemBars } from '../ui/system-bars.js';

wireInstalledSystemBars();
const host = document.getElementById('announcements-manage');
const sessionKey = 'shul-announcements-editor-session';
const fragment = new URLSearchParams(location.hash.slice(1));
let setupToken = fragment.get('setup'), inviteToken = fragment.get('invite');
if (setupToken || inviteToken) history.replaceState(null, '', location.pathname);
let token = '', user = null, posts = [], selected = null, loaded = false;
try { token = sessionStorage.getItem(sessionKey) || ''; } catch { /* Sign-in remains available. */ }
const status = (text, error = false) => {
  const node = host.querySelector('#announcement-editor-status'); if (!node) return;
  node.className = 'announcement-status ' + (error ? 'announcement-error' : 'announcement-success'); node.textContent = text;
};
const api = (path, options = {}) => announcementRequest(path, { ...options, token });
const run = async (button, task) => {
  const disabled = [...host.querySelectorAll('button')].map(node => [node, node.disabled]);
  disabled.forEach(([node]) => node.disabled = true);
  try { await task(); } catch (error) { status(error.message, true); }
  finally { disabled.forEach(([node, wasDisabled]) => { if (node.isConnected) node.disabled = wasDisabled; }); }
};
const remember = session => {
  token = session.token; user = session.user;
  setupToken = null; inviteToken = null;
  try { sessionStorage.setItem(sessionKey, token); } catch { /* This session stays in memory. */ }
};

function signIn(error = '') {
  user = null; token = ''; try { sessionStorage.removeItem(sessionKey); } catch { /* No remembered session. */ }
  const creating = setupToken || inviteToken;
  host.innerHTML = `<h1>${setupToken ? 'Set up announcement access' : inviteToken ? 'Set your posting password' : 'Post announcements'}</h1>
    <p class="announcement-lead">${setupToken ? 'Create your owner account. You can then add or remove announcement editors.' : inviteToken ? 'This account can post and edit shul announcements.' : 'Sign in with your announcement posting account.'}</p>
    <section class="announcement-panel"><form class="announcement-form" id="announcement-signin">
      ${setupToken ? '<label>Your name<input name="name" autocomplete="name" maxlength="60" required></label>' : ''}
      ${!inviteToken ? '<label>Email<input name="email" type="email" autocomplete="username" required></label>' : ''}
      <label>Password<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="12" maxlength="200" required></label>
      ${creating ? '<p class="announcement-note">Use at least 12 characters. Save this password so you can sign in again.</p>' : ''}
      <div class="announcement-actions"><button type="submit" class="primary">${creating ? 'Create account' : 'Sign in'}</button></div>
    </form><p id="announcement-editor-status" role="status" class="announcement-status announcement-error">${e(error)}</p></section>`;
  host.querySelector('form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget, fields = Object.fromEntries(new FormData(form));
    run(event.submitter, async () => {
      const session = await announcementRequest(setupToken ? '/api/setup' : inviteToken ? '/api/invitations/claim' : '/api/session', { method: 'POST', body: { ...fields, ...(setupToken ? { setupToken } : {}), ...(inviteToken ? { token: inviteToken } : {}) } });
      remember(session); await loadEditor();
    });
  });
}

function compose(post = null) {
  selected = post ? { ...post } : { id: crypto.randomUUID(), revision: 0, status: 'draft' };
  const form = host.querySelector('#announcement-compose');
  form.elements.title.value = post?.title || ''; form.elements.body.value = post?.body || '';
  form.elements.expires.value = post?.expiresAt ? websiteLocalFields(new Date(Date.parse(post.expiresAt) - 60000), 'America/New_York').date : '';
  const published = !!post?.publishedAt;
  form.querySelector('[value=published]').textContent = published ? 'Save changes' : 'Publish and notify';
  form.querySelector('[value=draft]').hidden = published;
  host.querySelector('#announcement-compose-heading').textContent = post ? 'Edit message' : 'New message';
  host.querySelector('#announcement-edit-note').textContent = published ? 'Saving changes to a published message does not send another phone notification.' : 'Publish makes the message visible on the site and alerts people who enabled notifications.';
  host.querySelector('#announcement-message-preview').hidden = true;
}

function listPosts() {
  const list = host.querySelector('#announcement-editor-list');
  list.innerHTML = posts.length ? posts.map(post => `<div class="announcement-list-row"><div><h3 dir="auto">${e(post.title)}</h3><p class="announcement-meta">${e(post.status === 'draft' ? 'Draft' : post.expiresAt && Date.parse(post.expiresAt) <= Date.now() ? 'Expired' : 'Published')} · ${e(announcementDate(post.updatedAt))}</p></div><div class="announcement-actions"><button type="button" data-edit="${e(post.id)}">Edit</button><button type="button" class="danger" data-remove="${e(post.id)}">Remove</button></div></div>`).join('') : '<p class="announcement-note">No messages yet. Start with a draft above.</p>';
  list.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
    compose(posts.find(post => post.id === button.dataset.edit));
    const field = host.querySelector('[name=title]'); field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }));
  list.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    const post = posts.find(post => post.id === button.dataset.remove);
    if (!confirm('Remove “' + post.title + '” from the site?')) return;
    run(button, async () => {
      await api('/api/manage/posts/' + post.id, { method: 'DELETE', body: { revision: post.revision } });
      posts = posts.filter(value => value.id !== post.id);
      keepPosition(host, () => { listPosts(); if (selected.id === post.id) compose(); status('Message removed.'); });
    });
  }));
}

async function accessList() {
  const { users } = await api('/api/access'), list = host.querySelector('#announcement-people');
  list.innerHTML = users.filter(person => person.active).map(person => `<div class="announcement-list-row"><div><h3>${e(person.name)}</h3><p class="announcement-meta">${e(person.email)} · ${e(person.role === 'owner' ? 'Owner' : person.pending ? 'Editor, invitation not used yet' : 'Announcement editor')}</p></div>${person.id !== user.id ? `<button type="button" class="danger" data-revoke="${e(person.id)}">Remove access</button>` : ''}</div>`).join('');
  list.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', () => {
    if (!confirm('Remove this person’s announcement posting access?')) return;
    run(button, async () => { await api('/api/access/' + button.dataset.revoke, { method: 'DELETE' }); await accessList(); status('Posting access removed.'); });
  }));
}

async function loadEditor() {
  const [account, data] = await Promise.all([api('/api/session'), api('/api/manage/posts')]);
  user = account.user; posts = data.posts;
  host.innerHTML = `<h1>Post announcements</h1><p class="announcement-lead">Write messages for the shul and notify people who subscribed.</p>
    <div class="announcement-session"><span>${e(user.name)} · ${user.role === 'owner' ? 'Owner' : 'Announcement editor'}</span><button type="button" id="announcement-signout">Sign out</button></div>
    <p id="announcement-editor-status" class="announcement-status" role="status"></p>
    <section class="announcement-panel"><h2 id="announcement-compose-heading">New message</h2>
    <form class="announcement-form" id="announcement-compose">
      <label>Title<input name="title" maxlength="120" required dir="auto"></label>
      <label>Message<textarea name="body" maxlength="5000" required dir="auto"></textarea></label>
      <label>Remove after (optional)<input name="expires" type="date"></label>
      <p class="announcement-note" id="announcement-edit-note"></p>
      <div class="announcement-actions"><button type="button" id="announcement-preview">Preview</button><button type="submit" value="draft">Save draft</button><button type="submit" value="published" class="primary">Publish and notify</button><button type="button" id="announcement-new">New message</button></div>
    </form><div id="announcement-message-preview" hidden></div></section>
    <section class="announcement-panel"><h2>Messages</h2><div id="announcement-editor-list"></div></section>
    ${user.role === 'owner' ? `<section class="announcement-panel announcement-access"><h2>Posting access</h2><p class="announcement-note">Editors can manage announcements. They cannot add other editors or change the schedule settings.</p>
      <form class="announcement-form" id="announcement-access-form"><label>Name<input name="name" maxlength="60" required autocomplete="off"></label><label>Email<input name="email" type="email" required autocomplete="off"></label><div class="announcement-actions"><button type="submit">Create posting link</button><button type="button" id="announcement-test-person">Use a test person</button></div></form>
      <div id="announcement-invitation" hidden class="announcement-form"><p class="announcement-note">Share this one-use link privately. It expires in 7 days. The person will choose their own password.</p><label>Posting link<textarea class="announcement-link" readonly></textarea></label><button type="button" id="announcement-copy-invite">Copy link</button></div>
      <div id="announcement-people"></div></section>` : ''}`;
  compose(); listPosts(); loaded = true;
  const form = host.querySelector('#announcement-compose');
  host.querySelector('#announcement-signout').addEventListener('click', event => run(event.currentTarget, async () => { await api('/api/session', { method: 'DELETE' }); signIn(); }));
  host.querySelector('#announcement-new').addEventListener('click', () => {
    if ((form.elements.title.value || form.elements.body.value) && !confirm('Start a new message? Unsaved typing will be cleared.')) return;
    keepPosition(host, () => { compose(); status(''); });
  });
  host.querySelector('#announcement-preview').addEventListener('click', () => {
    if (!form.reportValidity()) return;
    keepPosition(host, () => { const preview = host.querySelector('#announcement-message-preview'); preview.hidden = false; preview.innerHTML = announcementArticle({ id: 'preview', title: form.elements.title.value, body: form.elements.body.value, publishedAt: new Date().toISOString() }); });
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); const publish = event.submitter?.value === 'published';
    run(event.submitter, async () => {
      const alreadyPublished = !!selected.publishedAt;
      const expiry = form.elements.expires.value;
      const expiresAt = expiry ? new Date(websitePreviewInstant(expiry, '23:59', 'America/New_York').instant.getTime() + 60000).toISOString() : '';
      const { post } = await api('/api/manage/posts/' + selected.id, { method: 'PUT', body: { revision: selected.revision, title: form.elements.title.value, body: form.elements.body.value, expiresAt, status: publish ? 'published' : 'draft' } });
      posts = [post, ...posts.filter(value => value.id !== post.id)];
      keepPosition(host, () => { compose(post); listPosts(); status(publish ? alreadyPublished ? 'Changes saved.' : 'Message published.' : 'Draft saved.'); });
    });
  });
  if (user.role === 'owner') {
    await accessList();
    const access = host.querySelector('#announcement-access-form');
    host.querySelector('#announcement-test-person').addEventListener('click', () => { access.elements.name.value = 'Test poster'; access.elements.email.value = 'test-poster@example.test'; });
    access.addEventListener('submit', event => {
      event.preventDefault();
      run(event.submitter, async () => {
        const result = await api('/api/access', { method: 'POST', body: Object.fromEntries(new FormData(access)) });
        const url = new URL('/announcements/manage/', location.origin); url.hash = new URLSearchParams({ invite: result.token }).toString();
        const panel = host.querySelector('#announcement-invitation'); panel.hidden = false; panel.querySelector('textarea').value = url.href;
        await accessList(); status('Posting link created.');
      });
    });
    host.querySelector('#announcement-copy-invite').addEventListener('click', async () => {
      const field = host.querySelector('#announcement-invitation textarea');
      try { await navigator.clipboard.writeText(field.value); status('Posting link copied.'); }
      catch { field.focus(); field.select(); status('Select and copy the posting link.'); }
    });
  }
}

window.addEventListener('beforeunload', event => {
  if (!loaded || !host.querySelector('#announcement-compose')) return;
  const form = host.querySelector('#announcement-compose');
  if (form.elements.title.value !== (selected?.title || '') || form.elements.body.value !== (selected?.body || '')) { event.preventDefault(); event.returnValue = ''; }
});
(async () => {
  try {
    if (setupToken || inviteToken) return signIn();
    if (token) return await loadEditor();
    signIn();
  } catch (error) { signIn(error.status === 401 ? 'Your session has ended. Sign in again.' : error.message); }
})();
