// Wrapper around the YouTube IFrame Player API

let apiPromise = null;

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise(resolve => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return apiPromise;
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export class TvPlayer {
  constructor(holderId, { controls = false, onEnded, onStateChange } = {}) {
    this.holderId = holderId;
    this.controls = controls;
    this.onEnded = onEnded;
    this.onStateChange = onStateChange;
    this.player = null;
    this.ready = false;
    this.currentUid = null;
    this.currentId = null;
    this.loadedAt = 0;
  }

  async init() {
    const YT = await loadApi();

    // Fresh mount point every time a lobby is entered
    const holder = document.getElementById(this.holderId);
    holder.innerHTML = '<div id="ytMount"></div>';

    await new Promise(resolve => {
      this.player = new YT.Player('ytMount', {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          controls: this.controls ? 1 : 0,
          disablekb: this.controls ? 0 : 1,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
        },
        events: {
          onReady: () => { this.ready = true; resolve(); },
          onStateChange: e => {
            if (e.data === STATE.ENDED) this.onEnded?.();
            this.onStateChange?.(e.data);
          },
        },
      });
    });
  }

  load(item, startSeconds = 0, autoplay = true) {
    if (!this.ready) return;
    this.currentUid = item.uid;
    this.currentId = item.videoId;
    this.loadedAt = Date.now();
    const opts = { videoId: item.videoId, startSeconds: Math.max(0, startSeconds) };
    if (autoplay) this.player.loadVideoById(opts);
    else this.player.cueVideoById(opts);
  }

  stop() {
    this.currentUid = null;
    this.currentId = null;
    if (this.ready) this.player.stopVideo();
  }

  state() {
    return this.ready ? this.player.getPlayerState() : STATE.UNSTARTED;
  }

  isPlaying() {
    return this.state() === STATE.PLAYING;
  }

  // Playing, buffering, or just loaded and about to start
  isPlayingish() {
    const s = this.state();
    if (s === STATE.PLAYING || s === STATE.BUFFERING) return true;
    const fresh = Date.now() - this.loadedAt < 3000;
    return fresh && (s === STATE.UNSTARTED || s === STATE.CUED);
  }

  time() {
    return this.ready ? this.player.getCurrentTime() || 0 : 0;
  }

  play() { if (this.ready) this.player.playVideo(); }
  pause() { if (this.ready) this.player.pauseVideo(); }
  seek(t) { if (this.ready) this.player.seekTo(Math.max(0, t), true); }

  destroy() {
    try { this.player?.destroy(); } catch { /* already gone */ }
    this.player = null;
    this.ready = false;
    const holder = document.getElementById(this.holderId);
    if (holder) holder.innerHTML = '';
  }
}
