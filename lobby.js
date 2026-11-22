// Realtime lobby logic (Supabase Realtime: presence + broadcast)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY,
  DEFAULT_MAX_PLAYERS, MIN_PLAYERS, MAX_PLAYERS_LIMIT,
} from './config.js';
import { me, cleanName } from './identity.js';
import { isValidId } from './youtube.js';

let supabase = null;

// Creates the client on first use so a bad config shows a clear error
function client() {
  if (supabase) return supabase;
  const url = String(SUPABASE_URL || '').trim().replace(/\/(rest|realtime|auth)\/v1.*$/, '').replace(/\/+$/, '');
  const key = String(SUPABASE_ANON_KEY || '').trim();
  if (!url || !key || url.includes('YOUR-PROJECT') || key.includes('YOUR-')) {
    throw new Error('Add your Supabase Project URL and public key in config.js');
  }
  if (!/^https:\/\/.+/.test(url)) {
    throw new Error('Your Supabase URL in config.js must start with https://');
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error('That is the secret key. Use the publishable (public) key in config.js');
  }
  try {
    supabase = createClient(url, key);
  } catch {
    throw new Error('Your Supabase URL or key in config.js looks wrong');
  }
  return supabase;
}

const HOST_ONLY = ['kick', 'ban', 'unban', 'toggleOp', 'setMax'];
const wait = ms => new Promise(r => setTimeout(r, ms));

function randomPin() {
  return String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
}

// Keeps only safe fields from a video item sent by another client
function cleanItem(item) {
  if (!item || !isValidId(item.videoId)) return null;
  return {
    uid: String(item.uid || crypto.randomUUID()).slice(0, 64),
    videoId: item.videoId,
    title: String(item.title || item.videoId).slice(0, 200),
    addedBy: String(item.addedBy || 'Someone').slice(0, 40),
  };
}

export class Lobby extends EventTarget {
  constructor(pin, isHost) {
    super();
    this.pin = pin;
    this.isHost = isHost;
    this.channel = null;
    this.players = [];
    this.state = null;
    this.lastSync = null;
    this.hostSeen = false;
    this.closed = false;
    this.kicking = new Set();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  role() {
    if (this.isHost) return 'host';
    return this.state?.ops?.includes(me.id) ? 'op' : 'player';
  }

  async connect() {
    const ch = client().channel(`watchbox-lobby-${this.pin}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });
    this.channel = ch;

    ch.on('presence', { event: 'sync' }, () => this.onPresence());
    ch.on('broadcast', { event: 'state' }, ({ payload }) => this.onRemoteState(payload));
    ch.on('broadcast', { event: 'sync' }, ({ payload }) => {
      this.lastSync = payload;
      this.emit('sync', payload);
    });
    ch.on('broadcast', { event: 'kick' }, ({ payload }) => {
      if (payload.id === me.id) this.close(payload.reason);
    });
    ch.on('broadcast', { event: 'closed' }, () => {
      if (!this.isHost) this.close('The host closed the lobby');
    });
    ch.on('broadcast', { event: 'hello' }, () => {
      if (this.isHost && this.state) {
        this.publishState();
        this.emit('needSync');
      }
    });
    ch.on('broadcast', { event: 'cmd' }, ({ payload }) => {
      if (this.isHost && this.state) this.apply(payload.from, payload.action, payload.data || {});
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not connect. Check your Supabase settings.')), 8000);
      ch.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          reject(new Error('Could not connect to Supabase. Check your key and that Realtime allows public channels.'));
        }
      });
    });

    const tracked = ch.track({ id: me.id, deviceId: me.deviceId, name: cleanName(me.name) || 'Guest', host: this.isHost, joinedAt: Date.now() });
    const result = await Promise.race([tracked, wait(6000).then(() => 'timed out')]);
    if (result !== 'ok') throw new Error('Connection timed out. Try again.');
  }

  onPresence() {
    if (!this.channel) return;
    const raw = this.channel.presenceState();
    this.players = Object.values(raw)
      .map(metas => metas[0])
      .filter(Boolean)
      .sort((a, b) => a.joinedAt - b.joinedAt);

    if (this.isHost) {
      this.enforce();
    } else {
      const hostHere = this.players.some(p => p.host);
      if (hostHere) this.hostSeen = true;
      else if (this.hostSeen) return this.close('The host left the lobby');
    }
    this.emit('players', this.players);
  }

  // Host only: bans, player limit, clean up ops who left
  enforce() {
    if (!this.state) return;
    const present = new Set(this.players.map(p => p.id));

    for (const id of this.kicking) if (!present.has(id)) this.kicking.delete(id);

    const opsBefore = this.state.ops.length;
    this.state.ops = this.state.ops.filter(id => present.has(id));

    let slots = this.state.maxPlayers - 1;
    for (const p of this.players) {
      if (p.id === me.id || this.kicking.has(p.id)) continue;
      if (this.isBanned(p)) this.kick(p.id, 'You are banned from this lobby');
      else if (slots > 0) slots--;
      else this.kick(p.id, 'This lobby is full');
    }

    if (this.state.ops.length !== opsBefore) this.publishState();
  }

  isBanned(p) {
    return p.deviceId !== me.deviceId && this.state.banned.some(b => b.deviceId === p.deviceId);
  }

  kick(id, reason) {
    this.kicking.add(id);
    this.send('kick', { id, reason });
  }

  send(event, payload) {
    if (!this.channel) return;
    return this.channel.send({ type: 'broadcast', event, payload });
  }

  publishState() {
    this.send('state', this.state);
    this.emit('state', this.state);
  }

  sendSync(sync) {
    this.send('sync', { ...sync, sentAt: Date.now() });
  }

  onRemoteState(state) {
    if (this.isHost) return;
    this.state = state;
    this.emit('state', state);
  }

  // Host applies directly, everyone else asks the host
  command(action, data = {}) {
    if (this.isHost) this.apply(me.id, action, data);
    else this.send('cmd', { from: me.id, action, data });
  }

  apply(from, action, data) {
    const s = this.state;
    const fromHost = from === me.id;
    const fromOp = s.ops.includes(from);
    if (!fromHost && (!fromOp || HOST_ONLY.includes(action))) return;

    switch (action) {
      case 'play': {
        const item = cleanItem(data.item);
        if (!item) return;
        s.current = item;
        break;
      }
      case 'enqueue': {
        const item = cleanItem(data.item);
        if (!item) return;
        if (s.current) s.queue.push(item);
        else s.current = item;
        break;
      }
      case 'skip':
        s.current = s.queue.shift() || null;
        break;
      case 'remove':
        s.queue.splice(Number(data.index), 1);
        break;
      case 'playQueued': {
        const [item] = s.queue.splice(Number(data.index), 1);
        if (!item) return;
        s.current = item;
        break;
      }
      case 'kick': {
        const target = this.players.find(p => p.id === data.id);
        if (!target || target.host) return;
        s.ops = s.ops.filter(id => id !== target.id);
        this.kick(target.id, 'You were kicked from this lobby');
        break;
      }
      case 'ban': {
        const target = this.players.find(p => p.id === data.id);
        if (!target || target.host || target.deviceId === me.deviceId) return;
        if (!s.banned.some(b => b.deviceId === target.deviceId)) {
          s.banned.push({ deviceId: target.deviceId, name: target.name });
        }
        // Remove every tab from that device
        for (const p of this.players) {
          if (p.deviceId === target.deviceId) {
            s.ops = s.ops.filter(id => id !== p.id);
            this.kick(p.id, 'You are banned from this lobby');
          }
        }
        break;
      }
      case 'unban':
        s.banned = s.banned.filter(b => b.deviceId !== data.deviceId);
        break;
      case 'toggleOp':
        if (data.id === me.id) return;
        s.ops = s.ops.includes(data.id) ? s.ops.filter(id => id !== data.id) : [...s.ops, data.id];
        break;
      case 'setMax':
        s.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS_LIMIT, Number(data.value) || DEFAULT_MAX_PLAYERS));
        this.enforce();
        break;
      default:
        return;
    }
    this.publishState();
  }

  close(reason) {
    if (this.closed) return;
    this.leave();
    this.emit('closed', reason);
  }

  async leave() {
    this.closed = true;
    const ch = this.channel;
    if (!ch) return;
    this.channel = null;
    try {
      if (this.isHost) await ch.send({ type: 'broadcast', event: 'closed', payload: {} });
      await ch.untrack();
    } catch {
      // Connection already gone
    }
    try { client().removeChannel(ch); } catch { /* ignore */ }
  }
}

async function connectOrClean(lobby) {
  try {
    await lobby.connect();
  } catch (err) {
    await lobby.leave();
    throw err;
  }
}

export async function createLobby() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const lobby = new Lobby(randomPin(), true);
    await connectOrClean(lobby);
    await wait(1200);

    // PIN already used by another host, try a new one
    if (lobby.closed || lobby.players.some(p => p.host && p.id !== me.id)) {
      await lobby.leave();
      continue;
    }

    lobby.state = {
      pin: lobby.pin,
      hostId: me.id,
      maxPlayers: DEFAULT_MAX_PLAYERS,
      ops: [],
      banned: [],
      queue: [],
      current: null,
    };
    lobby.enforce();
    return lobby;
  }
  throw new Error('Could not create a lobby. Try again.');
}

export async function joinLobby(pin) {
  const lobby = new Lobby(pin, false);
  await connectOrClean(lobby);

  const result = await new Promise(resolve => {
    const done = value => {
      clearTimeout(timer);
      lobby.removeEventListener('state', onState);
      lobby.removeEventListener('closed', onClosed);
      resolve(value);
    };
    const onState = () => done(true);
    const onClosed = e => done(e.detail || 'Could not join');
    const timer = setTimeout(() => done(false), 4000);

    lobby.addEventListener('state', onState);
    lobby.addEventListener('closed', onClosed);
    lobby.send('hello', {});
  });

  if (result === true) return lobby;
  await lobby.leave();
  throw new Error(typeof result === 'string' ? result : 'No lobby found with that PIN');
}
