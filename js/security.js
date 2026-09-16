import { richTextPurifier } from './security-purify.js';
import { DEFAULT_SETTINGS } from './settings.js';

/** Saved cells allow text formatting, never executable markup, links or media. */
export function sanitizeRichText(value) {
  const clean = richTextPurifier.sanitize(String(value ?? ''), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'br', 'div', 'p', 'span', 'sub', 'sup', 'bdi'],
    ALLOWED_ATTR: ['class', 'dir'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  // Only the editor's size class is meaningful in saved content. Arbitrary site
  // classes could disguise imported content as an app control.
  for (const node of clean.querySelectorAll('*')) {
    if (node.hasAttribute('class')) {
      if (node.classList.contains('big')) node.setAttribute('class', 'big');
      else node.removeAttribute('class');
    }
    if (node.hasAttribute('dir') && !['ltr', 'rtl', 'auto'].includes(node.getAttribute('dir'))) node.removeAttribute('dir');
  }
  const host = document.createElement('div');
  host.append(clean);
  return host.innerHTML;
}

/** The cropper saves raster data URLs. No remote URLs or SVG from a backup. */
export function safeHeaderImage(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(value)
    ? value : '/assets/logo-building-icon.png';
}

function backupObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function backupError() {
  throw new Error('This backup has invalid settings or schedule data. Your current data has not been replaced.');
}

function checkBackupTree(value, depth = 0) {
  if (depth > 30) backupError();
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) backupError();
    checkBackupTree(entry, depth + 1);
  }
}

export function prepareSavedSheet(sheet) {
  if (!backupObject(sheet) || !Array.isArray(sheet.weeks)) backupError();
  checkBackupTree(sheet);
  if (sheet.weeks.some(w => !backupObject(w) || !Number.isFinite(w.serial))) backupError();
  if (sheet.columnWidths != null) {
    if (!backupObject(sheet.columnWidths)) backupError();
    for (const width of Object.values(sheet.columnWidths)) if (!Number.isFinite(width) || width < 0) backupError();
  }
  if (sheet.overrides != null) {
    if (!backupObject(sheet.overrides)) backupError();
    for (const cells of Object.values(sheet.overrides)) {
      if (!backupObject(cells)) backupError();
      for (const [key, value] of Object.entries(cells)) {
        if (typeof value !== 'string') backupError();
        cells[key] = sanitizeRichText(value);
      }
    }
  }
  return sheet;
}

/** Validate before the caller replaces any state. Also used for old local copies. */
export function prepareBackup(parsed) {
  if (!backupObject(parsed) || !backupObject(parsed.settings) || !Array.isArray(parsed.sheets)) backupError();
  checkBackupTree(parsed);
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const value = parsed.settings[key];
    if (value === undefined || fallback === null || typeof fallback === 'object') continue;
    if (typeof value !== typeof fallback || (typeof value === 'number' && !Number.isFinite(value))) backupError();
  }
  if (parsed.settings.headerIconImage != null) {
    const image = safeHeaderImage(parsed.settings.headerIconImage);
    parsed.settings.headerIconImage = image.startsWith('data:') ? image : null;
  }
  for (const sheet of parsed.sheets) prepareSavedSheet(sheet);
  if (parsed.rules != null) {
    if (!Array.isArray(parsed.rules)) backupError();
    for (const rule of parsed.rules) {
      if (!backupObject(rule)) backupError();
      for (const key of ['id', 'name', 'value']) if (typeof rule[key] !== 'string') backupError();
      if (rule.columnKeys != null && (!Array.isArray(rule.columnKeys) || rule.columnKeys.some(k => typeof k !== 'string'))) backupError();
      if (rule.condition != null) {
        if (!backupObject(rule.condition)) backupError();
        for (const key of ['parsha', 'specialParsha', 'dateISO', 'hebrewDate']) {
          const value = rule.condition[key];
          if (value != null && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) backupError();
        }
      }
    }
  }
  if (parsed.own != null && !Array.isArray(parsed.own)) backupError();
  if (parsed.seeded != null && !backupObject(parsed.seeded)) backupError();
  return parsed;
}
