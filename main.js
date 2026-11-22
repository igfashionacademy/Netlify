// App entry: wires the UI to the lobby and the TV player

import { createLobby, joinLobby } from './lobby.js';
import { me, setName, cleanName } from './identity.js';
import { TvPlayer } from './player.js';
import { parseVideoId, fetchTitle } from './youtube.js';
import { SYNC_INTERVAL_MS, DRIFT_TOLERANCE_S } from './config.js';
import * as ui from './ui.js';

let lobby = null;
let tv = null;
let syncTimer = null;
let autoplayTimer = null;
let busy = false;

/* ---------- Home ---------- */

const pinInput = ui.$('#pinInput');
const pinSend = ui.$('#pinSend');
const nameInput = ui.$('#nameInput');
const nameSend = ui.$('#nameSend');
let pending = null;

function refreshSlots() {
  ui.renderPinSlots(pinInput.value, document.activeElement === pinInput);
}

pinInput.addEventListener('input', () => {
  pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6);
  pinSend.disabled = pinInput.value.length !== 6;
  refreshSlots();
  if (pinInput.value.length === 6) askName({ type: 'join', pin: pinInput.value });
});
pinInput.addEventListener('focus', refreshSlots);
pinInput.addEventListener('blur', refreshSlots);

ui.$('#pinForm').addEventListener('submit', e => {
  e.preventDefault();
  if (pinInput.value.length === 6) askName({ type: 'join', pin: pinInput.value });
});

ui.$('#createBtn').addEventListener('click', () => askName({ type: 'create' }));

// Swaps the PIN box for the name box
function askName(action) {
  if (busy) return;
  pending = action;
  ui.setHomeStatus('');
  if (action.type === 'join') ui.setNameLabel('Joining lobby', action.pin);
  else ui.setNameLabel('Creating a new lobby');
  nameInput.value = me.name;
  nameSend.disabled = !cleanName(nameInput.value);
  ui.showStep('name');
  setTimeout(() => { nameInput.focus(); nameInput.select(); }, 30);
}

function backToPin(message) {
  pending = null;
  pinInput.value = '';
  pinSend.disabled = true;
  ui.showStep('pin');
  refreshSlots();
  ui.setHomeStatus(message || '', !!message);
}

ui.$('#backBtn').addEventListener('click', () => {
  if (!busy) backToPin();
});

nameInput.addEventListener('input', () => {
  nameSend.disabled = !cleanName(nameInput.value);
});

ui.$('#nameForm').addEventListener('submit', e => {
  e.preventDefault();
  if (busy) return;
  setName(nameInput.value);
  nameInput.value = me.name;
  if (!me.name) {
    ui.setNameError(true);
    ui.setHomeStatus('Enter a name first', true);
    return;
  }
  run(pending);
});

async function run(action) {
  if (!action) return backToPin();
  busy = true;
  nameSend.disabled = true;
  ui.setHomeStatus(action.type === 'create' ? 'Creating lobby...' : 'Joining...');
  try {
    const newLobby = action.type === 'create' ? await createLobby() : await joinLobby(action.pin);
    await enterLobby(newLobby);
  } catch (err) {
    console.error(err);
    if (action.type === 'join') backToPin(err.message);
    else ui.setHomeStatus(err.message, true);
  } finally {
    busy = false;
    nameSend.disabled = !cleanName(nameInput.value);
  }
}

/* ---------- Lobby lifecycle ---------- */

async function enterLobby(newLobby) {
  lobby = newLobby;
  backToPin();

  lobby.addEventListener('state', render);
  lobby.addEventListener('players', render);
  lobby.addEventListener('sync', e => applySync(e.detail));
  lobby.addEventListener('needSync', pushSync);
  lobby.addEventListener('closed', e => exitLobby(e.detail));

  ui.showScreen('lobby');
  ui.setTvShield(!lobby.isHost);
  render();

  tv = new TvPlayer('ytHolder', {
    controls: lobby.isHost,
    onEnded: () => { if (lobby?.isHost) lobby.command('skip'); },
    onStateChange: () => {
      if (lobby?.isHost) pushSync();
      else if (tv?.isPlaying()) ui.setStartButton(false);
    },
  });
  await tv.init();
  if (!lobby) return;

  if (lobby.isHost) {
    syncTimer = setInterval(pushSync, SYNC_INTERVAL_MS);
    render();
  } else if (lobby.lastSync) {
    applySync(lobby.lastSync);
  }
}

function exitLobby(reason) {
  clearInterval(syncTimer);
  clearTimeout(autoplayTimer);
  syncTimer = null;
  if (lobby) lobby.leave();
  lobby = null;
  tv?.destroy();
  tv = null;
  ui.closePanel();
  ui.setStartButton(false);
  ui.showScreen('home');
  if (reason) ui.toast(reason);
}

ui.$('#leaveBtn').addEventListener('click', () => exitLobby());

window.addEventListener('beforeunload', () => {
  if (lobby?.isHost) lobby.send('closed', {});
});

/* ---------- Rendering + host video control ---------- */

function render() {
  if (!lobby?.state) return;
  ui.renderLobby(lobby.state, lobby.players, lobby.role(), me.id);

  if (lobby.isHost && tv?.ready) {
    const current = lobby.state.current;
    if (!current && tv.currentUid) {
      tv.stop();
      pushSync();
    } else if (current && current.uid !== tv.currentUid) {
      tv.load(current, 0, true);
      pushSync();
    }
  }
}

/* ---------- Sync ---------- */

function pushSync() {
  if (!lobby?.isHost || !tv?.ready) return;
  lobby.sendSync({
    uid: tv.currentUid,
    videoId: tv.currentId,
    time: tv.time(),
    playing: tv.isPlayingish(),
  });
}

function applySync(sync) {
  if (!lobby || lobby.isHost || !tv?.ready) return;

  if (!sync.uid) {
    if (tv.currentUid) tv.stop();
    ui.setStartButton(false);
    return;
  }

  const latency = Math.min(2, Math.max(0, (Date.now() - sync.sentAt) / 1000));
  const target = sync.time + (sync.playing ? latency : 0);

  if (tv.currentUid !== sync.uid) {
    tv.load({ uid: sync.uid, videoId: sync.videoId }, target, sync.playing);
    if (sync.playing) watchAutoplay();
    return;
  }

  if (Math.abs(tv.time() - target) > DRIFT_TOLERANCE_S) tv.seek(target);
  if (sync.playing && !tv.isPlayingish()) tv.play();
  if (!sync.playing && tv.isPlaying()) tv.pause();
}

// Shows a button if the browser blocked autoplay
function watchAutoplay() {
  clearTimeout(autoplayTimer);
  autoplayTimer = setTimeout(() => {
    if (tv && lobby?.lastSync?.playing && !tv.isPlaying()) ui.setStartButton(true);
  }, 3500);
}

ui.$('#tvStart').addEventListener('click', () => {
  ui.setStartButton(false);
  tv?.play();
  if (lobby?.lastSync) applySync(lobby.lastSync);
});

/* ---------- Panel ---------- */

ui.$('#panelBtn').addEventListener('click', ui.openPanel);
ui.$('#panelClose').addEventListener('click', ui.closePanel);
ui.$('#panelBackdrop').addEventListener('click', ui.closePanel);

ui.$('#copyPin').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lobby?.state?.pin || '');
    ui.toast('PIN copied');
  } catch {
    ui.toast('Could not copy');
  }
});

async function readVideoInput() {
  const input = ui.$('#videoInput');
  const videoId = parseVideoId(input.value);
  if (!videoId) {
    ui.toast('That is not a valid YouTube link');
    return null;
  }
  input.value = '';
  const title = await fetchTitle(videoId);
  return { uid: crypto.randomUUID(), videoId, title, addedBy: me.name };
}

ui.$('#playNowBtn').addEventListener('click', async () => {
  const item = await readVideoInput();
  if (item) lobby?.command('play', { item });
});

ui.$('#queueBtn').addEventListener('click', async () => {
  const item = await readVideoInput();
  if (item) {
    lobby?.command('enqueue', { item });
    ui.toast('Added to queue');
  }
});

ui.$('#videoInput').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const item = await readVideoInput();
  if (item) lobby?.command('play', { item });
});

ui.$('#skipBtn').addEventListener('click', () => lobby?.command('skip'));

ui.$('#maxMinus').addEventListener('click', () => {
  if (lobby?.state) lobby.command('setMax', { value: lobby.state.maxPlayers - 1 });
});
ui.$('#maxPlus').addEventListener('click', () => {
  if (lobby?.state) lobby.command('setMax', { value: lobby.state.maxPlayers + 1 });
});

// Buttons inside the queue and player lists
ui.$('#panel').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !lobby) return;
  const { action, index, id, device } = btn.dataset;
  if (action === 'playQueued' || action === 'remove') lobby.command(action, { index: Number(index) });
  if (action === 'toggleOp' || action === 'kick' || action === 'ban') lobby.command(action, { id });
  if (action === 'unban') lobby.command('unban', { deviceId: device });
});

window.__appLoaded = true;
