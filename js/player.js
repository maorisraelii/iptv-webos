/**
 * High-Performance Video Player Controller for LG webOS TV (webOS 4.64 & 5.0+)
 * - Low-memory Hls.js configuration for fast zapping on older TV CPUs
 * - Automatic fallback to LG Starfish Native Hardware Media Pipeline
 * - Catch-Up / Start-Over playback support (Past & Current programmes)
 */
class VideoPlayer {
  constructor(videoElement, callbacks) {
    this.video = videoElement;
    this.callbacks = callbacks || {};
    this.hls = null;
    this.currentChannel = null;
    this.currentProgramme = null;
    this.retryCount = 0;
    this.maxRetries = 2;
    this.retryTimer = null;
    this.usedNativeFallback = false;
    this.userPaused = false;

    this.initListeners();
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
      this.userPaused = false;
      this.triggerState('playing');
    });

    this.video.addEventListener('pause', () => {
      if (this.userPaused) {
        this.triggerState('paused');
      }
    });

    this.video.addEventListener('error', () => {
      // If a catch-up URL failed (e.g. provider doesn't support timeshift query params), fallback to live URL
      if (this.currentProgramme && this.currentChannel) {
        this.currentProgramme = null;
        this.play(this.currentChannel);
        return;
      }
      this.handlePlaybackError('השידור אינו זמין כעת בערוץ זה');
    });
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

  /**
   * Play a specific past or live programme from its beginning (Start-Over / Catch-Up)
   */
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
      // If already playing this channel, seek back to earliest DVR buffer or restart
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

    // 1. Explicit catchup-source template from M3U
    if (channel.catchupSource) {
      return channel.catchupSource
        .replace(/\$\{start\}|\{utc\}|\{start\}/gi, String(startUnix))
        .replace(/\$\{timestamp\}|\{lutc\}/gi, String(nowUnix))
        .replace(/\$\{duration\}|\{duration\}/gi, String(durationSec))
        .replace(/\$\{offset\}|\{offset\}/gi, String(offsetSec));
    }

    // 2. Flussonic / Catchup shift query parameters if catchupType is specified
    if (channel.catchupType === 'Append' || channel.catchupType === 'shift' || channel.catchupType === 'default' || channel.catchupType === 'flussonic') {
      const sep = channel.url.indexOf('?') === -1 ? '?' : '&';
      return channel.url + sep + 'utc=' + startUnix + '&lutc=' + nowUnix;
    }

    return channel.url;
  }

  playHls(url) {
    try {
      // Tuned for older LG webOS CPUs: low memory footprint + fast startup
      this.hls = new window.Hls({
        enableWorker: false,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        backBufferLength: 20,
        lowLatencyMode: false,
        capLevelToPlayerSize: false,
        manifestLoadingTimeOut: 7000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 7000
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
            this.video.play().then(() => {
              this.video.muted = false;
            }).catch(() => {});
          });
        }
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data && data.fatal) {
          if (!this.usedNativeFallback) {
            this.usedNativeFallback = true;
            this.cleanUp();
            this.playNative(url);
          } else {
            this.handlePlaybackError('שגיאה בטעינת השידור');
          }
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
          this.video.play().then(() => {
            this.video.muted = false;
          }).catch(() => {});
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
