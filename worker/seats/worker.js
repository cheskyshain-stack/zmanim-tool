import { seatsSharedApply, seatsSharedPlan } from '../../js/seats/shared-model.js';

const SEATS_SHARED_SESSION_MS = 24 * 60 * 60 * 1000;
const SEATS_SHARED_LIMIT = 2 * 1024 * 1024;
const seatsWorkerHash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const seatsWorkerJson = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const seatsWorkerId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin'), allowed = env.ALLOWED_ORIGIN || 'https://baismedrashoflakewoodcommons.org';
    if (origin !== allowed) return seatsWorkerJson({ error: 'Open shared plans from the Seats website.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Vary': 'Origin' };
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
    if (url.pathname === '/api/plans' && request.method === 'GET') {
      const records = await this.ctx.storage.list({ prefix: 'plan:' });
      return seatsWorkerJson({ plans: [...records.values()].map(record => ({ id: record.plan.id, name: record.plan.name, revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    if (url.pathname === '/api/plans' && request.method === 'POST') {
      try {
        const body = await this.body(request);
        if (!seatsWorkerId(body.id)) throw new Error('Invalid plan ID.');
        const plan = seatsSharedPlan({ ...body.plan, id: body.id });
        return await this.ctx.blockConcurrencyWhile(async () => {
          const key = 'plan:' + plan.id, existing = await this.ctx.storage.get(key);
          if (existing) return seatsWorkerJson(existing);
          const plans = await this.ctx.storage.list({ prefix: 'plan:' });
          if (plans.size >= 30) return seatsWorkerJson({ error: 'There are already 30 shared plans.' }, 409);
          const record = { plan, revision: 1, updatedAt: new Date().toISOString(), updatedBy: session.name, operations: [] };
          await this.ctx.storage.put(key, record);
          this.broadcast({ type: 'plans-changed' });
          return seatsWorkerJson(record, 201);
        });
      } catch (error) { return seatsWorkerJson({ error: error.message }, 400); }
    }
    const match = /^\/api\/plans\/([A-Za-z0-9_-]{8,100})$/.exec(url.pathname);
    if (match && request.method === 'GET') {
      const record = await this.ctx.storage.get('plan:' + match[1]);
      return record ? seatsWorkerJson(record) : seatsWorkerJson({ error: 'That shared plan was not found.' }, 404);
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
          if (record) this.send(socket, { type: 'snapshot', ...record });
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
          const next = { plan, revision: record.revision + 1, updatedAt: new Date().toISOString(), updatedBy: meta.name, operations: [...record.operations, message.operationId].slice(-200) };
          await this.ctx.storage.put(key, next);
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
    const now = Date.now();
    for (const prefix of ['session:', 'attempt:']) {
      const records = await this.ctx.storage.list({ prefix });
      const expired = [...records].filter(([, value]) => (value.expires || value.until) <= now).map(([key]) => key);
      for (let index = 0; index < expired.length; index += 100) await this.ctx.storage.delete(expired.slice(index, index + 100));
    }
    if ((await this.ctx.storage.list({ prefix: 'session:', limit: 1 })).size) await this.ctx.storage.setAlarm(now + SEATS_SHARED_SESSION_MS);
  }
}
