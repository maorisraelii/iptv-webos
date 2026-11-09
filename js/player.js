/**
 * Video Player controller optimized for LG webOS TV (webOS 4.64 & 5.0+)
 * Dual-engine: Hls.js (with worker disabled for file:// compatibility) + automatic Native Starfish Hardware fallback
 */
class VideoPlayer {
  constructor(videoElement, callbacks) {
    this.video = videoElement;
    this.callbacks = callbacks || {};
    this.hls = null;
    this.currentChannel = null;
    this.retryCount = 0;
    this.maxRetries = 2;
    this.retryTimer = null;
    this.usedNativeFallback = false;

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
      this.triggerState('playing');
    });

    this.video.addEventListener('pause', () => {
      this.triggerState('paused');
    });

    this.video.addEventListener('error', (e) => {
      console.warn('Native video error:', e);
      this.handlePlaybackError('השידור אינו זמין כעת בערוץ זה');
    });
  }

  triggerState(state) {
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(state, this.currentChannel);
    }
  }

  play(channel) {
    if (!channel || !channel.url) return;
    this.currentChannel = channel;
    this.usedNativeFallback = false;
    this.cleanUp();
    this.triggerState('loading');

    const url = channel.url.trim();
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

  playHls(url) {
    try {
      // IMPORTANT: enableWorker: false is required on webOS file:// protocol!
      this.hls = new window.Hls({
        enableWorker: false,
        maxBufferLength: 25,
        maxMaxBufferLength: 50,
        lowLatencyMode: false,
        backBufferLength: 30,
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 8000
      });

      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        this.hls.loadSource(url);
      });

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((e) => {
            console.warn('Autoplay warning, retrying muted then unmuting:', e);
            this.video.muted = true;
            this.video.play().then(() => {
              this.video.muted = false;
            }).catch(() => {});
          });
        }
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data && data.fatal) {
          console.warn('Fatal HLS.js error:', data.type, data.details);
          if (!this.usedNativeFallback) {
            console.log('Falling back to LG webOS Native Hardware Player for:', url);
            this.usedNativeFallback = true;
            this.cleanUp();
            this.playNative(url);
          } else {
            this.handlePlaybackError('שגיאה בטעינת השידור');
          }
        }
      });
    } catch (err) {
      console.error('HLS init error, using native player:', err);
      this.playNative(url);
    }
  }

  playNative(url) {
    try {
      this.video.src = url;
      this.video.load();
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.warn('Native play promise warning:', err);
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

  handlePlaybackError(msg) {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      this.triggerState('retrying');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.currentChannel) {
          this.playNative(this.currentChannel.url.trim());
        }
      }, 1800);
    } else {
      this.triggerState('error');
    }
  }

  togglePlayPause() {
    if (!this.video) return false;
    if (this.video.paused) {
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return false;
    } else {
      this.video.pause();
      return true;
    }
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
        this.hls.destroy();
      } catch (e) {}
      this.hls = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoPlayer;
}
