import { seatsSharedApply, seatsSharedPlan } from '../../js/seats/shared-model.js';
import { seatsDescribeChanges, seatsRecordMetadata } from '../../js/seats/activity.js';
import { seatsNormalizeNameFile } from '../../js/seats/name-files.js';
import { seatsTrashAvailable, seatsTrashExpiry } from '../../js/seats/trash.js';

const SEATS_SHARED_SESSION_MS = 24 * 60 * 60 * 1000;
const SEATS_SHARED_LIMIT = 2 * 1024 * 1024;
const seatsWorkerHash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const seatsWorkerJson = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const seatsWorkerId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const seatsHistoryKey = (id, revision) => 'history:' + id + ':' + String(revision).padStart(12, '0');
const seatsLegacyHistory = record => ({ revision: record.revision, at: record.updatedAt, by: record.updatedBy, details: ['Last saved change before change history was enabled. Earlier changes were not recorded.'] });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin'), allowed = env.ALLOWED_ORIGIN || 'https://baismedrashoflakewoodcommons.org';
    if (origin !== allowed) return seatsWorkerJson({ error: 'Open shared plans from the Seats website.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Vary': 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const response = await env.SEATS_WORKSPACE.get(env.SEATS_WORKSPACE.idFromName('lakewood-commons')).fetch(request);
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(JSON.stringify({ error: 'Shared plans are temporarily unavailable. Your local copy is kept.' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  },
};

export class SeatsWorkspace {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.authTimers = new Map(); }
  async body(request) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('Use a JSON request.');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Enter a shared update.');
    const chunks = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > SEATS_SHARED_LIMIT) { await reader.cancel(); throw new Error('This plan is too large to share.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.ctx.storage.get('session:' + await seatsWorkerHash(token));
    return session?.expires > Date.now() ? session : null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/live' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ authenticated: false, connected: Date.now() });
      this.authTimers.set(pair[1], setTimeout(() => { this.authTimers.delete(pair[1]); if (!pair[1].deserializeAttachment()?.authenticated) pair[1].close(1008, 'Sign in to shared plans.'); }, 10000));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/api/session' && request.method === 'POST') {
      try {
        const body = await this.body(request), ip = request.headers.get('CF-Connecting-IP') || 'local';
        return await this.ctx.blockConcurrencyWhile(async () => {
          const key = 'attempt:' + await seatsWorkerHash(ip), now = Date.now();
          const saved = await this.ctx.storage.get(key), attempts = saved?.until > now ? saved : { count: 0, until: now + 15 * 60 * 1000 };
          if (attempts.count >= 10) return seatsWorkerJson({ error: 'Too many PIN attempts. Try again in 15 minutes.' }, 429);
          const valid = typeof body.pin === 'string' && /^\d{4}$/.test(body.pin) && await seatsWorkerHash(body.pin + 'lakewood-commons/seats/v1') === 'c5eebef6b017a917b05502fb6016a9dadfd75f31b2e48aa445175a5827a6cc55';
          if (!valid) { attempts.count++; await this.ctx.storage.put(key, attempts); return seatsWorkerJson({ error: 'That PIN did not match.' }, 401); }
          const name = String(body.name || 'Organizer').trim().slice(0, 60) || 'Organizer';
          const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const session = { name, expires: now + SEATS_SHARED_SESSION_MS };
          await this.ctx.storage.put('session:' + await seatsWorkerHash(token), session);
          await this.ctx.storage.delete(key);
          await this.ctx.storage.setAlarm(now + SEATS_SHARED_SESSION_MS);
          return seatsWorkerJson({ ...session, token });
        });
      } catch { return seatsWorkerJson({ error: 'Enter your name and the Seats PIN.' }, 400); }
    }
    const session = await this.session(request.headers.get('Authorization')?.replace(/^Bearer /, ''));
    if (!session) return seatsWorkerJson({ error: 'Enter the Seats PIN to open shared plans.' }, 401);
    if (url.pathname === '/api/info' && request.method === 'GET') return seatsWorkerJson({ chartDates: true, changeHistory: true, sharedNameFiles: true, deleteFiles: true, editNameFiles: true, trash60Days: true });
    if (url.pathname === '/api/trash' && request.method === 'GET') {
      const files = [];
      for (const [prefix, type] of [['plan:', 'chart'], ['names:', 'names']]) {
        const records = await this.ctx.storage.list({ prefix });
        for (const record of records.values()) if (seatsTrashAvailable(record)) files.push({ type, id: type === 'chart' ? record.plan.id : record.id,
          name: type === 'chart' ? record.plan.name : record.name, deletedAt: record.deletedAt, deletedBy: record.deletedBy, expiresAt: seatsTrashExpiry(record) });
      }
      return seatsWorkerJson({ files: files.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) });
    }
    const restore = /^\/api\/(plans|name-lists)\/([A-Za-z0-9_-]{8,100})\/restore$/.exec(url.pathname);
    if (restore && request.method === 'POST') {
      try {
        const body = await this.body(request);
        if (typeof body.deletedAt !== 'string' || !Number.isFinite(Date.parse(body.deletedAt))) throw new Error('Reopen Trash before restoring this file.');
        return await this.ctx.blockConcurrencyWhile(async () => {
          const chart = restore[1] === 'plans', prefix = chart ? 'plan:' : 'names:', key = prefix + restore[2], record = await this.ctx.storage.get(key);
          if (!record) return seatsWorkerJson({ error: 'That file was not found in Trash.' }, 404);
          if (!record.deletedAt) return record.lastRestoredDeletion === body.deletedAt ? seatsWorkerJson(record) : seatsWorkerJson({ error: 'That file is already available. Refresh the saved list.' }, 409);
          if (record.deletedAt !== body.deletedAt) return seatsWorkerJson({ error: 'This file was deleted again. Refresh Trash before restoring it.' }, 409);
          if (!seatsTrashAvailable(record)) return seatsWorkerJson({ error: 'The 60-day recovery period for this file has ended.' }, 410);
          const records = await this.ctx.storage.list({ prefix }), limit = chart ? 30 : 50;
          if ([...records.values()].filter(value => !value.deletedAt).length >= limit) return seatsWorkerJson({ error: 'The saved folder is full. Move another file to Trash before restoring this one.' }, 409);
          const now = new Date().toISOString(), next = { ...record, revision: (record.revision || 1) + 1, updatedAt: now, updatedBy: session.name, lastRestoredDeletion: record.deletedAt };
          delete next.deletedAt; delete next.deletedBy;
          if (chart) {
            next.historyFromRevision ||= record.revision;
            await this.ctx.storage.put({ [key]: next, ...(!record.historyFromRevision ? { [seatsHistoryKey(restore[2], record.revision)]: seatsLegacyHistory(record) } : {}),
              [seatsHistoryKey(restore[2], next.revision)]: { revision: next.revision, at: now, by: session.name, details: ['Restored chart from Trash'] } });
          } else await this.ctx.storage.put(key, next);
          this.broadcast({ type: chart ? 'plans-changed' : 'name-lists-changed' });
          return seatsWorkerJson(next);
        });
      } catch (error) { return seatsWorkerJson({ error: error.message }, 400); }
    }
    if (url.pathname === '/api/name-lists' && request.method === 'GET') {
      const records = await this.ctx.storage.list({ prefix: 'names:' });
      return seatsWorkerJson({ files: [...records.values()].filter(record => !record.deletedAt).map(record => ({ id: record.id, name: record.name, count: record.names.length, createdAt: record.createdAt, createdBy: record.createdBy,
        revision: record.revision || 1, updatedAt: record.updatedAt || record.createdAt, updatedBy: record.updatedBy || record.createdBy })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    if (url.pathname === '/api/name-lists' && request.method === 'POST') {
      try {
        const body = await this.body(request); if (!seatsWorkerId(body.id)) throw new Error('Invalid file ID.');
        const contents = seatsNormalizeNameFile(body);
        return await this.ctx.blockConcurrencyWhile(async () => {
          const key = 'names:' + body.id, existing = await this.ctx.storage.get(key);
          if (existing) return existing.deletedAt ? seatsWorkerJson({ error: 'That name file was deleted.' }, 410) : seatsWorkerJson(existing);
          const records = await this.ctx.storage.list({ prefix: 'names:' });
          if ([...records.values()].filter(record => !record.deletedAt).length >= 50) return seatsWorkerJson({ error: 'There are already 50 name files. Delete an older file before uploading another.' }, 409);
          const now = new Date().toISOString();
          const record = { id: body.id, ...contents, revision: 1, createdAt: now, createdBy: session.name, updatedAt: now, updatedBy: session.name };
          await this.ctx.storage.put(key, record); this.broadcast({ type: 'name-lists-changed' });
          return seatsWorkerJson(record, 201);
        });
      } catch (error) { return seatsWorkerJson({ error: error.message }, 400); }
    }
    const nameFile = /^\/api\/name-lists\/([A-Za-z0-9_-]{8,100})$/.exec(url.pathname);
    if (nameFile && request.method === 'POST') {
      try {
        const body = await this.body(request), contents = seatsNormalizeNameFile(body);
        if (!Number.isSafeInteger(body.revision) || body.revision < 1 || !seatsWorkerId(body.operationId)) throw new Error('Reopen the name file before saving.');
        return await this.ctx.blockConcurrencyWhile(async () => {
          const key = 'names:' + nameFile[1], record = await this.ctx.storage.get(key);
          if (!record) return seatsWorkerJson({ error: 'That name file was not found.' }, 404);
          if (record.deletedAt) return seatsWorkerJson({ error: 'That name file was deleted. Your draft is kept on this device.' }, 410);
          if (record.operationId === body.operationId) return seatsWorkerJson(record);
          if ((record.revision || 1) !== body.revision) return seatsWorkerJson({ error: 'Someone saved a newer version. Your draft is kept. Load the latest version before making further changes.' }, 409);
          const updated = { ...record, ...contents, revision: (record.revision || 1) + 1, operationId: body.operationId, updatedAt: new Date().toISOString(), updatedBy: session.name };
          await this.ctx.storage.put(key, updated); this.broadcast({ type: 'name-lists-changed' });
          return seatsWorkerJson(updated);
        });
      } catch (error) { return seatsWorkerJson({ error: error.message }, 400); }
    }
    if (nameFile && ['GET', 'DELETE'].includes(request.method)) {
      return this.ctx.blockConcurrencyWhile(async () => {
        const key = 'names:' + nameFile[1], record = await this.ctx.storage.get(key);
        if (!record) return seatsWorkerJson({ error: 'That name file was not found.' }, 404);
        if (request.method === 'GET') return record.deletedAt ? seatsWorkerJson({ error: 'That name file was deleted.' }, 410) : seatsWorkerJson(record);
        if (!record.deletedAt) { await this.ctx.storage.put(key, { ...record, deletedAt: new Date().toISOString(), deletedBy: session.name }); await this.ctx.storage.setAlarm(Date.now() + SEATS_SHARED_SESSION_MS); this.broadcast({ type: 'name-lists-changed' }); }
        return seatsWorkerJson({ deleted: true });
      });
    }
    if (url.pathname === '/api/plans' && request.method === 'GET') {
      const records = await this.ctx.storage.list({ prefix: 'plan:' });
      return seatsWorkerJson({ plans: [...records.values()].filter(record => !record.deletedAt).map(record => ({ id: record.plan.id, name: record.plan.name, revision: record.revision, ...seatsRecordMetadata(record) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (url.pathname === '/api/plans' && request.method === 'POST') {
      try {
        const body = await this.body(request);
        if (!seatsWorkerId(body.id)) throw new Error('Invalid plan ID.');
        const plan = seatsSharedPlan({ ...body.plan, id: body.id });
        return await this.ctx.blockConcurrencyWhile(async () => {
          const key = 'plan:' + plan.id, existing = await this.ctx.storage.get(key);
          if (existing) return existing.deletedAt ? seatsWorkerJson({ error: 'That chart was deleted.' }, 410) : seatsWorkerJson(existing);
          const plans = await this.ctx.storage.list({ prefix: 'plan:' });
          if ([...plans.values()].filter(record => !record.deletedAt).length >= 30) return seatsWorkerJson({ error: 'There are already 30 shared charts. Delete an older chart before saving another.' }, 409);
          const now = new Date().toISOString();
          const record = { plan, revision: 1, createdAt: now, createdBy: session.name, updatedAt: now, updatedBy: session.name, operations: [], historyFromRevision: 1 };
          await this.ctx.storage.put({ [key]: record, [seatsHistoryKey(plan.id, 1)]: { revision: 1, at: now, by: session.name, details: ['Saved chart to the site'] } });
          this.broadcast({ type: 'plans-changed' });
          return seatsWorkerJson(record, 201);
        });
      } catch (error) { return seatsWorkerJson({ error: error.message }, 400); }
    }
    const history = /^\/api\/plans\/([A-Za-z0-9_-]{8,100})\/history$/.exec(url.pathname);
    if (history && request.method === 'GET') {
      const record = await this.ctx.storage.get('plan:' + history[1]);
      if (!record || record.deletedAt) return seatsWorkerJson({ error: 'That shared chart was not found.' }, 404);
      const rawBefore = url.searchParams.get('before'), before = rawBefore === null ? null : Number(rawBefore);
      if (before !== null && (!Number.isSafeInteger(before) || before < 1)) return seatsWorkerJson({ error: 'Invalid history page.' }, 400);
      const prefix = 'history:' + history[1] + ':';
      const rows = await this.ctx.storage.list({ prefix, reverse: true, limit: 51, ...(before === null ? {} : { end: seatsHistoryKey(history[1], before) }) });
      const entries = [...rows.values()];
      if (!record.historyFromRevision && !entries.length && (before === null || record.revision < before)) entries.push(seatsLegacyHistory(record));
      return seatsWorkerJson({ entries: entries.slice(0, 50), nextBefore: entries.length > 50 ? entries[49].revision : null, ...seatsRecordMetadata(record) });
    }
    const match = /^\/api\/plans\/([A-Za-z0-9_-]{8,100})$/.exec(url.pathname);
    if (match && request.method === 'GET') {
      const record = await this.ctx.storage.get('plan:' + match[1]);
      if (!record) return seatsWorkerJson({ error: 'That shared chart was not found.' }, 404);
      return record.deletedAt ? seatsWorkerJson({ error: 'That shared chart was deleted.' }, 410) : seatsWorkerJson({ ...record, ...seatsRecordMetadata(record) });
    }
    if (match && request.method === 'DELETE') {
      return this.ctx.blockConcurrencyWhile(async () => {
        const key = 'plan:' + match[1], record = await this.ctx.storage.get(key);
        if (!record) return seatsWorkerJson({ error: 'That shared chart was not found.' }, 404);
        if (!record.deletedAt) {
          const now = new Date().toISOString(), next = { ...record, ...seatsRecordMetadata(record), deletedAt: now, deletedBy: session.name, revision: record.revision + 1, updatedAt: now, updatedBy: session.name, historyFromRevision: record.historyFromRevision || record.revision };
          await this.ctx.storage.put({ [key]: next, ...(!record.historyFromRevision ? { [seatsHistoryKey(match[1], record.revision)]: seatsLegacyHistory(record) } : {}), [seatsHistoryKey(match[1], next.revision)]: { revision: next.revision, at: now, by: session.name, details: ['Deleted chart from the website'] } });
          await this.ctx.storage.setAlarm(Date.now() + SEATS_SHARED_SESSION_MS);
          this.broadcast({ type: 'plan-deleted', id: match[1] }); this.broadcast({ type: 'plans-changed' });
        }
        return seatsWorkerJson({ deleted: true });
      });
    }
    return seatsWorkerJson({ error: 'Not found.' }, 404);
  }
  send(socket, message) { try { socket.send(JSON.stringify(message)); } catch { /* A disconnected organizer will reconnect. */ } }
  peers() {
    return this.ctx.getWebSockets().map(socket => ({ socket, ...socket.deserializeAttachment() })).filter(peer => peer.socket.readyState === WebSocket.OPEN && peer.authenticated && peer.expires > Date.now());
  }
  broadcast(message) { for (const peer of this.peers()) this.send(peer.socket, message); }
  presence() { this.broadcast({ type: 'presence', peers: this.peers().map(({ clientId, name, planId, seat }) => ({ clientId, name, planId, seat })) }); }
  async webSocketMessage(socket, raw) {
    try {
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > SEATS_SHARED_LIMIT) throw new Error('This shared update is too large.');
      const message = JSON.parse(raw), meta = socket.deserializeAttachment();
      if (message.type === 'auth') {
        const session = await this.session(message.token);
        if (!session || !seatsWorkerId(message.clientId)) { socket.close(1008, 'Sign in again.'); return; }
        clearTimeout(this.authTimers.get(socket)); this.authTimers.delete(socket);
        socket.serializeAttachment({ ...session, authenticated: true, clientId: message.clientId, planId: null, seat: null });
        this.send(socket, { type: 'ready' }); this.presence(); return;
      }
      if (!meta?.authenticated || meta.expires <= Date.now()) { socket.close(1008, 'Sign in again.'); return; }
      if (message.type === 'ping') { this.send(socket, { type: 'pong' }); return; }
      if (message.type === 'watch') {
        if (!Array.isArray(message.ids) || message.ids.length > 30) throw new Error('Invalid plan list.');
        for (const id of message.ids) {
          if (!seatsWorkerId(id)) continue;
          const record = await this.ctx.storage.get('plan:' + id);
          if (record?.deletedAt) this.send(socket, { type: 'plan-deleted', id });
          else if (record) this.send(socket, { type: 'snapshot', ...record });
        }
        return;
      }
      if (message.type === 'presence') {
        const planId = seatsWorkerId(message.planId) ? message.planId : null;
        const seat = typeof message.seat === 'string' && message.seat.length <= 120 ? message.seat : null;
        const busy = planId && seat && this.peers().find(peer => peer.socket !== socket && peer.planId === planId && peer.seat === seat);
        socket.serializeAttachment({ ...meta, planId, seat: busy ? null : seat });
        if (busy) this.send(socket, { type: 'busy', seat, name: busy.name });
        this.presence(); return;
      }
      if (message.type !== 'patch' || !seatsWorkerId(message.planId) || !seatsWorkerId(message.operationId)) throw new Error('Invalid shared update.');
      await this.ctx.blockConcurrencyWhile(async () => {
        const key = 'plan:' + message.planId, record = await this.ctx.storage.get(key);
        if (!record) throw new Error('That shared plan was not found.');
        if (record.deletedAt) { this.send(socket, { type: 'plan-deleted', id: message.planId }); return; }
        if (record.operations.includes(message.operationId)) { this.send(socket, { type: 'snapshot', ...record, operationId: message.operationId, clientId: meta.clientId }); return; }
        try {
          for (const change of message.changes || []) {
            if (change.group === 'people') {
              const seated = [...record.plan.tables, ...record.plan.objects.filter(object => object.type === 'rav')].find(table => table.seats.includes(change.id));
              const busy = seated && this.peers().find(peer => peer.socket !== socket && peer.planId === message.planId && peer.seat === seated.id + ':' + seated.seats.indexOf(change.id));
              if (busy) throw new Error(busy.name + ' is editing that seat.');
            }
            if (!['tables', 'objects'].includes(change.group) || !['seats', 'count', undefined].includes(change.key)) continue;
            const busy = this.peers().find(peer => peer.socket !== socket && peer.planId === message.planId && peer.seat && (change.index === undefined ? peer.seat.startsWith(change.id + ':') : peer.seat === change.id + ':' + change.index));
            if (busy) throw new Error(busy.name + ' is editing that seat.');
          }
          const plan = seatsSharedApply(record.plan, message.changes);
          if (JSON.stringify(plan) === JSON.stringify(record.plan)) { this.send(socket, { type: 'snapshot', ...record, operationId: message.operationId, clientId: meta.clientId }); return; }
          const now = new Date().toISOString();
          const next = { ...record, ...seatsRecordMetadata(record), plan, revision: record.revision + 1, updatedAt: now, updatedBy: meta.name, operations: [...record.operations, message.operationId].slice(-200), historyFromRevision: record.historyFromRevision || record.revision };
          await this.ctx.storage.put({ [key]: next, ...(!record.historyFromRevision ? { [seatsHistoryKey(plan.id, record.revision)]: seatsLegacyHistory(record) } : {}),
            [seatsHistoryKey(plan.id, next.revision)]: { revision: next.revision, at: now, by: meta.name, details: seatsDescribeChanges(record.plan, plan, message.changes) } });
          this.broadcast({ type: 'snapshot', ...next, operationId: message.operationId, clientId: meta.clientId });
        } catch (error) {
          this.send(socket, { type: 'conflict', ...record, operationId: message.operationId, error: error.message });
        }
      });
    } catch (error) { this.send(socket, { type: 'error', error: error.message }); }
  }
  webSocketClose(socket) { clearTimeout(this.authTimers.get(socket)); this.authTimers.delete(socket); try { socket.close(); } catch { /* Already closed. */ } this.presence(); }
  webSocketError(socket) { try { socket.close(1011, 'Reconnect to shared plans.'); } catch { /* Already closed. */ } this.presence(); }
  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
    const now = Date.now();
    for (const prefix of ['session:', 'attempt:']) {
      const records = await this.ctx.storage.list({ prefix });
      const expired = [...records].filter(([, value]) => (value.expires || value.until) <= now).map(([key]) => key);
      for (let index = 0; index < expired.length; index += 100) await this.ctx.storage.delete(expired.slice(index, index + 100));
    }
    let pendingTrash = false;
    for (const prefix of ['plan:', 'names:']) {
      const records = await this.ctx.storage.list({ prefix });
      for (const [key, record] of records) {
        if (!record.deletedAt || record.purgedAt) continue;
        const expiry = seatsTrashExpiry(record);
        if (!expiry || Date.parse(expiry) > now) { pendingTrash = true; continue; }
        // Keep the deletion marker so an old offline upload cannot recreate an expired file.
        await this.ctx.storage.put(key, { deletedAt: record.deletedAt, deletedBy: record.deletedBy, purgedAt: new Date(now).toISOString() });
        if (prefix === 'plan:') {
          const history = await this.ctx.storage.list({ prefix: 'history:' + key.slice(prefix.length) + ':' }), keys = [...history.keys()];
          for (let index = 0; index < keys.length; index += 100) await this.ctx.storage.delete(keys.slice(index, index + 100));
        }
      }
    }
    if (pendingTrash || (await this.ctx.storage.list({ prefix: 'session:', limit: 1 })).size) await this.ctx.storage.setAlarm(now + SEATS_SHARED_SESSION_MS);
    });
  }
}
