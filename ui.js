// DOM rendering helpers

import { thumbnail } from './youtube.js';

export const $ = selector => document.querySelector(selector);

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === name));
}

export function setHomeStatus(text, isError = false) {
  const status = $('#homeStatus');
  status.textContent = text;
  status.classList.toggle('error', isError);
  if (isError) shake(document.querySelector('.step.active .neon-box'));
}

function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

export function showStep(name) {
  $('#pinStep').classList.toggle('active', name === 'pin');
  $('#nameStep').classList.toggle('active', name === 'name');
}

export function renderPinSlots(value, focused) {
  $('#pinField').classList.toggle('active', focused || value.length > 0);
  $('#pinSlots').querySelectorAll('.slot').forEach((slot, i) => {
    slot.textContent = value[i] || '';
    slot.classList.toggle('filled', i < value.length);
    slot.classList.toggle('current', focused && i === value.length);
  });
}

export function setNameLabel(text, pin) {
  $('#nameLabel').innerHTML = pin ? `${esc(text)} <b>${esc(pin)}</b>` : esc(text);
}

let toastTimer = null;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function openPanel() {
  $('#panel').classList.add('open');
  $('#panel').setAttribute('aria-hidden', 'false');
  $('#panelBackdrop').classList.add('open');
}

export function closePanel() {
  $('#panel').classList.remove('open');
  $('#panel').setAttribute('aria-hidden', 'true');
  $('#panelBackdrop').classList.remove('open');
}

export function setTvShield(on) {
  $('#tvShield').classList.toggle('hidden', !on);
}

export function setStartButton(on) {
  $('#tvStart').classList.toggle('hidden', !on);
}

function queueHtml(queue, canControl) {
  if (!queue.length) return '<li class="empty">Queue is empty</li>';
  return queue.map((item, i) => `
    <li class="q-item">
      <img src="${thumbnail(item.videoId)}" alt="" loading="lazy">
      <div class="q-meta">
        <span class="q-title">${esc(item.title)}</span>
        <span class="muted">added by ${esc(item.addedBy)}</span>
      </div>
      ${canControl ? `
        <div class="q-actions">
          <button class="btn btn-ghost btn-sm" data-action="playQueued" data-index="${i}">Play</button>
          <button class="btn btn-danger btn-sm" data-action="remove" data-index="${i}">Remove</button>
        </div>` : ''}
    </li>`).join('');
}

function playersHtml(players, state, myId, manage) {
  if (!players.length) return '<li class="empty">Nobody here yet</li>';
  return players.map(p => {
    const isOp = state.ops.includes(p.id);
    const badges = [
      p.host ? '<span class="badge host">HOST</span>' : '',
      isOp ? '<span class="badge op">OP</span>' : '',
      p.id === myId ? '<span class="badge">YOU</span>' : '',
    ].join('');
    const actions = manage && !p.host && p.id !== myId ? `
      <div class="p-actions">
        <button class="btn btn-ghost btn-sm" data-action="toggleOp" data-id="${esc(p.id)}">${isOp ? 'Remove OP' : 'Make OP'}</button>
        <button class="btn btn-ghost btn-sm" data-action="kick" data-id="${esc(p.id)}">Kick</button>
        <button class="btn btn-danger btn-sm" data-action="ban" data-id="${esc(p.id)}">Ban</button>
      </div>` : '';
    return `
      <li class="p-item">
        <div class="avatar">${esc((p.name || '?').slice(0, 1).toUpperCase())}</div>
        <span class="p-name">${esc(p.name)}</span>
        ${badges}
        ${actions}
      </li>`;
  }).join('');
}

function bannedHtml(banned) {
  if (!banned.length) return '<li class="empty">Nobody is banned</li>';
  return banned.map(b => `
    <li class="p-item">
      <div class="avatar banned">${esc((b.name || '?').slice(0, 1).toUpperCase())}</div>
      <span class="p-name">${esc(b.name)}</span>
      <div class="p-actions">
        <button class="btn btn-ghost btn-sm" data-action="unban" data-device="${esc(b.deviceId)}">Unban</button>
      </div>
    </li>`).join('');
}

export function setNameError(on) {
  if (on) shake($('#nameForm'));
}

export function renderLobby(state, players, role, myId) {
  if (!state) return;
  const canControl = role !== 'player';

  $('#playerCount').textContent = `${players.length} / ${state.maxPlayers} players`;
  $('#panelBtn').classList.toggle('hidden', !canControl);
  if (!canControl) closePanel();

  $('#panelTitle').textContent = role === 'host' ? 'Host panel' : 'OP panel';
  $('#pinValue').textContent = state.pin;
  $('#maxValue').textContent = state.maxPlayers;
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', role !== 'host'));

  $('#tvEmpty').classList.toggle('hidden', !!state.current);
  $('#nowPlaying').innerHTML = state.current ? `
    <span class="np-label">Now playing</span>
    <span class="np-title">${esc(state.current.title)}</span>
    <span class="muted">added by ${esc(state.current.addedBy)}</span>` : '';

  $('#queueCount').textContent = state.queue.length;
  $('#sideQueue').innerHTML = queueHtml(state.queue, false);
  $('#panelQueue').innerHTML = queueHtml(state.queue, canControl);
  $('#sidePlayers').innerHTML = playersHtml(players, state, myId, false);
  $('#panelPlayers').innerHTML = playersHtml(players, state, myId, role === 'host');
  $('#bannedCount').textContent = state.banned.length;
  $('#panelBanned').innerHTML = bannedHtml(state.banned);
}
