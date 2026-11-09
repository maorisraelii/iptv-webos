/**
 * Anti-Freeze Video Player Controller for LG webOS TV (webOS 4.64 & 5.0+)
 * - Configurable Deep Buffer Profiles (15s / 35s / 65s / 120s) to eliminate micro-stutters
 * - Automatic HLS Media Error recovery, hole-jumping (maxBufferHole), and Stall Watchdog
 * - Automatic fallback to LG Starfish Native Hardware Media Pipeline
 * - Catch-Up / Start-Over playback support (Past & Current programmes)
 */

const BUFFER_STORAGE_KEY = 'zenplay_iptv_buffer_mode_v2';

const BUFFER_PROFILES = {
  fast: {
    id: 'fast',
    label: 'מהיר (15 שניות)',
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    backBufferLength: 15,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6
  },
  balanced: {
    id: 'balanced',
    label: 'מאוזן - מומלץ (35 שניות)',
    maxBufferLength: 35,
    maxMaxBufferLength: 70,
    backBufferLength: 30,
    liveSyncDurationCount: 5,
    liveMaxLatencyDurationCount: 10
  },
  deep: {
    id: 'deep',
    label: 'באפר גבוה נגד תקיעות (65 שניות)',
    maxBufferLength: 65,
    maxMaxBufferLength: 120,
    backBufferLength: 45,
    liveSyncDurationCount: 7,
    liveMaxLatencyDurationCount: 14
  },
  extreme: {
    id: 'extreme',
    label: 'אקסטרים - יציבות מקסימלית (120 שניות)',
    maxBufferLength: 120,
    maxMaxBufferLength: 180,
    backBufferLength: 60,
    liveSyncDurationCount: 10,
    liveMaxLatencyDurationCount: 20
  }
};

class VideoPlayer {
  constructor(videoElement, callbacks) {
    this.video = videoElement;
    this.callbacks = callbacks || {};
    this.hls = null;
    this.currentChannel = null;
    this.currentProgramme = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryTimer = null;
    this.usedNativeFallback = false;
    this.userPaused = false;
    this.lastMediaRecoveryMs = 0;

    // Anti-Stall Watchdog state
    this.watchdogInterval = null;
    this.lastWatchdogTime = -1;
    this.stallTicks = 0;

    this.bufferMode = this.loadBufferMode();
    this.initListeners();
    this.startStallWatchdog();
  }

  loadBufferMode() {
    try {
      const saved = localStorage.getItem(BUFFER_STORAGE_KEY);
      if (saved && BUFFER_PROFILES[saved]) {
        return saved;
      }
    } catch (e) {}
    return 'deep'; // Default to Deep Anti-Freeze Buffer (65s) per user preference against stutters
  }

  setBufferMode(mode) {
    if (!BUFFER_PROFILES[mode]) return;
    this.bufferMode = mode;
    try {
      localStorage.setItem(BUFFER_STORAGE_KEY, mode);
    } catch (e) {}

    // Apply dynamically if HLS is currently active
    if (this.hls && this.hls.config) {
      const prof = BUFFER_PROFILES[mode];
      this.hls.config.maxBufferLength = prof.maxBufferLength;
      this.hls.config.maxMaxBufferLength = prof.maxMaxBufferLength;
      this.hls.config.backBufferLength = prof.backBufferLength;
      this.hls.config.liveSyncDurationCount = prof.liveSyncDurationCount;
      this.hls.config.liveMaxLatencyDurationCount = prof.liveMaxLatencyDurationCount;
    }
  }

  getBufferProfile() {
    return BUFFER_PROFILES[this.bufferMode] || BUFFER_PROFILES.deep;
  }

  initListeners() {
    this.video.addEventListener('loadstart', () => {
      this.triggerState('loading');
    });

    this.video.addEventListener('waiting', () => {
      this.triggerState('buffering');
    });

    this.video.addEventListener('canplay', () => {
      this.triggerState('playing');
    });

    this.video.addEventListener('playing', () => {
      this.retryCount = 0;
      this.stallTicks = 0;
      this.userPaused = false;
      this.triggerState('playing');
    });

    this.video.addEventListener('pause', () => {
      if (this.userPaused) {
        this.triggerState('paused');
      }
    });

    this.video.addEventListener('stalled', () => {
      this.nudgeIfBufferedAhead();
    });

    this.video.addEventListener('error', () => {
      if (this.currentProgramme && this.currentChannel) {
        this.currentProgramme = null;
        this.play(this.currentChannel);
        return;
      }
      this.handlePlaybackError('השידור אינו זמין כעת בערוץ זה');
    });
  }

  /**
   * Anti-Freeze Watchdog: checks every 2.5s if playback froze despite having buffered data ahead,
   * and gently nudges over micro timestamp gaps without reloading the channel.
   */
  startStallWatchdog() {
    clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.video || !this.currentChannel || this.userPaused || this.video.paused) {
        this.stallTicks = 0;
        return;
      }

      const ct = this.video.currentTime || 0;
      if (ct > 0 && Math.abs(ct - this.lastWatchdogTime) < 0.05) {
        this.stallTicks++;
        if (this.stallTicks >= 2) {
          this.nudgeIfBufferedAhead();
          if (this.hls) {
            try {
              this.hls.startLoad();
            } catch (e) {}
          }
          this.stallTicks = 0;
        }
      } else {
        this.stallTicks = 0;
      }
      this.lastWatchdogTime = ct;
    }, 2500);
  }

  nudgeIfBufferedAhead() {
    if (!this.video || this.userPaused) return;
    try {
      const buffered = this.video.buffered;
      const cur = this.video.currentTime || 0;
      if (buffered && buffered.length > 0) {
        for (let i = 0; i < buffered.length; i++) {
          const start = buffered.start(i);
          const end = buffered.end(i);
          // If there's a small gap/hole just ahead of currentTime, jump into the next buffered range
          if (start > cur && start - cur < 4.5 && end > start + 0.5) {
            this.video.currentTime = start + 0.15;
            const p = this.video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return;
          }
        }
      }
    } catch (e) {}
  }

  triggerState(state) {
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(state, this.currentChannel);
    }
  }

  play(channel, customStreamUrl) {
    if (!channel || !channel.url) return;
    this.currentChannel = channel;
    if (!customStreamUrl) {
      this.currentProgramme = null;
    }
    this.usedNativeFallback = false;
    this.userPaused = false;
    this.stallTicks = 0;
    this.cleanUp();
    this.triggerState('loading');

    const url = (customStreamUrl || channel.url).trim();
    const isHls = url.indexOf('.m3u8') !== -1 || url.indexOf('m3u8') !== -1;

    if (window.Hls && window.Hls.isSupported() && isHls) {
      this.playHls(url);
    } else {
      this.playNative(url);
    }

    if (this.callbacks.onChannelLoaded) {
      this.callbacks.onChannelLoaded(channel);
    }
  }

  playProgrammeStartOver(channel, programme) {
    if (!channel) return;
    if (!programme) {
      this.startOver();
      return;
    }

    this.currentProgramme = programme;
    const catchupUrl = this.buildCatchupUrl(channel, programme);

    if (catchupUrl && catchupUrl !== channel.url) {
      this.play(channel, catchupUrl);
    } else {
      if (this.currentChannel && this.currentChannel.id === channel.id && this.video) {
        this.startOver();
      } else {
        this.play(channel);
      }
    }
  }

  buildCatchupUrl(channel, programme) {
    if (!channel || !channel.url || !programme || !programme.startMs) {
      return channel ? channel.url : '';
    }

    const startUnix = Math.floor(programme.startMs / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    const durationSec = Math.max(60, Math.floor(((programme.stopMs || Date.now()) - programme.startMs) / 1000));
    const offsetSec = Math.max(0, nowUnix - startUnix);

    if (channel.catchupSource) {
      return channel.catchupSource
        .replace(/\$\{start\}|\{utc\}|\{start\}/gi, String(startUnix))
        .replace(/\$\{timestamp\}|\{lutc\}/gi, String(nowUnix))
        .replace(/\$\{duration\}|\{duration\}/gi, String(durationSec))
        .replace(/\$\{offset\}|\{offset\}/gi, String(offsetSec));
    }

    if (
      channel.catchupType === 'append' ||
      channel.catchupType === 'shift' ||
      channel.catchupType === 'default' ||
      channel.catchupType === 'flussonic'
    ) {
      const sep = channel.url.indexOf('?') === -1 ? '?' : '&';
      return channel.url + sep + 'utc=' + startUnix + '&lutc=' + nowUnix;
    }

    return channel.url;
  }

  playHls(url) {
    try {
      const prof = this.getBufferProfile();

      this.hls = new window.Hls({
        enableWorker: false,
        // Deep Anti-Stutter Buffer Configuration
        maxBufferLength: prof.maxBufferLength,
        maxMaxBufferLength: prof.maxMaxBufferLength,
        backBufferLength: prof.backBufferLength,
        liveSyncDurationCount: prof.liveSyncDurationCount,
        liveMaxLatencyDurationCount: prof.liveMaxLatencyDurationCount,
        lowLatencyMode: false,
        // Anti-Freeze & Discontinuity Healing
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.25,
        nudgeMaxRetry: 12,
        maxFragLookUpTolerance: 0.5,
        // Smooth ABR (prevents frequent quality-switch freezes)
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.65,
        // Resilient network retries so temporary IPTV server hiccups never freeze playback
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 800,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 3,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 800
      });

      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        if (this.hls) this.hls.loadSource(url);
      });

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            this.video.muted = true;
            this.video
              .play()
              .then(() => {
                this.video.muted = false;
              })
              .catch(() => {});
          });
        }
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data) return;

        // Handle non-fatal buffer stalls smoothly
        if (!data.fatal) {
          if (
            data.details === window.Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
            data.details === window.Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE
          ) {
            this.nudgeIfBufferedAhead();
          }
          return;
        }

        // Fatal error recovery pipeline
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.retryCount < this.maxRetries && this.hls) {
            this.retryCount++;
            this.hls.startLoad();
            return;
          }
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          const now = Date.now();
          if (now - this.lastMediaRecoveryMs > 3000 && this.hls) {
            this.lastMediaRecoveryMs = now;
            this.hls.recoverMediaError();
            return;
          }
        }

        if (!this.usedNativeFallback) {
          this.usedNativeFallback = true;
          this.cleanUp();
          this.playNative(url);
        } else {
          this.handlePlaybackError('שגיאה בטעינת השידור');
        }
      });
    } catch (err) {
      this.playNative(url);
    }
  }

  playNative(url) {
    try {
      this.video.src = url;
      this.video.load();
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this.video.muted = true;
          this.video
            .play()
            .then(() => {
              this.video.muted = false;
            })
            .catch(() => {});
        });
      }
    } catch (e) {
      this.handlePlaybackError('שגיאה בהפעלת הנגן');
    }
  }

  handlePlaybackError() {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      this.triggerState('retrying');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.currentChannel) {
          this.playNative(this.currentChannel.url.trim());
        }
      }, 1500);
    } else {
      this.triggerState('error');
    }
  }

  togglePlayPause() {
    if (!this.video) return false;
    if (this.video.paused) {
      this.userPaused = false;
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      this.triggerState('playing');
      return false;
    } else {
      this.userPaused = true;
      this.video.pause();
      this.triggerState('paused');
      return true;
    }
  }

  isPaused() {
    return this.video ? Boolean(this.video.paused) : false;
  }

  rewind(seconds) {
    const sec = seconds || 30;
    if (!this.video) return 0;
    try {
      const target = Math.max(0, (this.video.currentTime || 0) - sec);
      this.video.currentTime = target;
      return target;
    } catch (e) {
      return 0;
    }
  }

  fastForward(seconds) {
    const sec = seconds || 30;
    if (!this.video) return 0;
    try {
      const target = (this.video.currentTime || 0) + sec;
      this.video.currentTime = target;
      return target;
    } catch (e) {
      return 0;
    }
  }

  startOver() {
    if (!this.video) return;
    try {
      if (this.video.seekable && this.video.seekable.length > 0) {
        this.video.currentTime = this.video.seekable.start(0);
        if (this.video.paused) {
          this.userPaused = false;
          const p = this.video.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } else if (this.currentChannel) {
        this.play(this.currentChannel);
      }
    } catch (e) {
      if (this.currentChannel) this.play(this.currentChannel);
    }
  }

  stop() {
    this.cleanUp();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  cleanUp() {
    clearTimeout(this.retryTimer);
    if (this.hls) {
      try {
        this.hls.stopLoad();
        this.hls.detachMedia();
        this.hls.destroy();
      } catch (e) {}
      this.hls = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoPlayer;
}
