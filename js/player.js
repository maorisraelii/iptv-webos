/**
 * Video Player controller optimized for LG webOS TV
 * Integrates native HTML5 video with Hls.js fallback and auto-recovery
 */
class VideoPlayer {
  constructor(videoElement, callbacks = {}) {
    this.video = videoElement;
    this.callbacks = callbacks; // onStateChange, onError, onChannelLoaded
    this.hls = null;
    this.currentChannel = null;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryTimer = null;
    this.aspectRatios = ['contain', 'cover', 'fill'];
    this.aspectRatioIndex = 0;

    this.initListeners();
  }

  initListeners() {
    this.video.addEventListener('loadstart', () => {
      this.triggerState('loading');
    });

    this.video.addEventListener('waiting', () => {
      this.triggerState('buffering');
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
      this.handlePlaybackError('שגיאת ניגון וידאו מקומית');
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
    this.cleanUp();
    this.triggerState('loading');

    const url = channel.url.trim();
    const isHls = url.includes('.m3u8') || url.includes('/live/') || url.includes('m3u8');

    // Use Hls.js if supported and url looks like HLS
    if (window.Hls && window.Hls.isSupported() && isHls) {
      this.playHls(url);
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl') || !isHls) {
      this.playNative(url);
    } else if (window.Hls && window.Hls.isSupported()) {
      // Try Hls.js anyway as fallback
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
      this.hls = new window.Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30
      });

      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        this.hls.loadSource(url);
      });

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(e => console.warn('Auto-play blocked or delayed:', e));
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        console.warn('HLS.js error:', data.type, data.details, data.fatal);
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Fatal network error encountered, trying to recover...');
              this.hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Fatal media error encountered, trying to recover...');
              this.hls.recoverMediaError();
              break;
            default:
              this.handlePlaybackError('שגיאה בטעינת השידור');
              break;
          }
        }
      });
    } catch (err) {
      console.error('HLS initialization error, fallback to native:', err);
      this.playNative(url);
    }
  }

  playNative(url) {
    this.video.src = url;
    this.video.load();
    const playPromise = this.video.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn('Native play promise error:', err);
      });
    }
  }

  handlePlaybackError(msg) {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`Retrying stream (${this.retryCount}/${this.maxRetries})...`);
      this.triggerState('retrying');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.currentChannel) {
          this.play(this.currentChannel);
        }
      }, 2000);
    } else {
      this.triggerState('error');
      if (this.callbacks.onError) {
        this.callbacks.onError(msg || 'לא ניתן לנגן שידור זה', this.currentChannel);
      }
    }
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play().catch(e => console.warn(e));
      return false; // not paused
    } else {
      this.video.pause();
      return true; // is paused
    }
  }

  rewind(seconds = 30) {
    if (!this.video) return 0;
    try {
      const target = Math.max(0, this.video.currentTime - seconds);
      this.video.currentTime = target;
      return target;
    } catch (e) {
      console.warn('Rewind error:', e);
      return 0;
    }
  }

  fastForward(seconds = 30) {
    if (!this.video) return 0;
    try {
      const target = this.video.currentTime + seconds;
      this.video.currentTime = target;
      return target;
    } catch (e) {
      console.warn('Fast forward error:', e);
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
      console.warn('Start over error:', e);
      if (this.currentChannel) this.play(this.currentChannel);
    }
  }

  stop() {
    this.cleanUp();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.currentChannel = null;
    this.triggerState('stopped');
  }

  cleanUp() {
    clearTimeout(this.retryTimer);
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch (e) {
        console.warn('HLS destroy error:', e);
      }
      this.hls = null;
    }
  }

  cycleAspectRatio() {
    this.aspectRatioIndex = (this.aspectRatioIndex + 1) % this.aspectRatios.length;
    const mode = this.aspectRatios[this.aspectRatioIndex];
    this.video.style.objectFit = mode;
    return mode;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoPlayer;
}
