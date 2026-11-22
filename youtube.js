// Helpers for YouTube links, titles and thumbnails

const ID_RE = /^[\w-]{11}$/;

function validId(id) {
  const clean = (id || '').slice(0, 11);
  return ID_RE.test(clean) ? clean : null;
}

export function parseVideoId(input) {
  const text = (input || '').trim();
  if (ID_RE.test(text)) return text;

  try {
    const url = new URL(text.startsWith('http') ? text : 'https://' + text);
    const host = url.hostname.replace(/^(www|m|music)\./, '');

    if (host === 'youtu.be') return validId(url.pathname.slice(1));

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v) return validId(v);
      const match = url.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{11})/);
      if (match) return match[2];
    }
  } catch {
    // Not a URL
  }
  return null;
}

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export async function fetchTitle(videoId) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    return data.title || videoId;
  } catch {
    return videoId;
  }
}

export function thumbnail(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
