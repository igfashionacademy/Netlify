// Identity: tab id (presence), device id (bans), saved username

function read(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function write(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* storage blocked */ }
}

function loadOrMake(storage, key, make) {
  let value = read(storage, key);
  if (!value) {
    value = make();
    write(storage, key, value);
  }
  return value;
}

export const NAME_MAX = 20;

export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export const me = {
  // Unique per tab so two tabs never collide
  id: loadOrMake(sessionStorage, 'wb-id', () => crypto.randomUUID()),
  // Same for every tab on this browser, used for bans
  deviceId: loadOrMake(localStorage, 'wb-device', () => crypto.randomUUID()),
  name: cleanName(read(localStorage, 'wb-username')),
};

export function setName(name) {
  me.name = cleanName(name);
  write(localStorage, 'wb-username', me.name);
}
