/**
 * Progressive Quality Ramp-Up (Smart ABR) & Anti-Freeze Video Player for LG webOS TV (webOS 4.64 & 5.0+)
 * - Default 'smart' mode (Progressive Quality Ramp-Up):
 *   1. Starts channel playback immediately on the fastest-loading quality level (startLevel: 0)
 *      so channels open quickly and fill the initial buffer in a fraction of a second.
 *   2. As forward buffer accumulates (6s -> 12s+), smoothly ramps up quality to Full HD (1080p)
 *      on segment boundaries without ever touching playbackRate, seeking, or flushing the decoder.
 *   3. If buffer drops low (< 3.5s) on a congested server, silently steps down quality so segments
 *      download faster without freezing, then ramps back up to 1080p once buffer recovers.
 *   4. Zero annoying toast popups — 100% silent, smooth hardware-friendly operation.
 */

const BUFFER_STORAGE_KEY = 'zenplay_iptv_buffer_mode_v4';

const BUFFER_PROFILES = {
  smart: {
    id: 'smart',
    label: 'אוטומטי חכם — איכות מדורגת לפי באפר (מומלץ)',
    maxBufferLength: 65,
    maxMaxBufferLength: 120,
    backBufferLength: 45,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    progressiveQuality: true
  },
  fast: {
    id: 'fast',
    label: 'מהיר (15 שניות)',
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    backBufferLength: 15,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    progressiveQuality: false
  },
  balanced: {
    id: 'balanced',
    label: 'מאוזן (35 שניות)',
    maxBufferLength: 35,
    maxMaxBufferLength: 70,
    backBufferLength: 30,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 9,
    progressiveQuality: false
  },
  deep: {
    id: 'deep',
    label: 'באפר גבוה נגד תקיעות (65 שניות)',
    maxBufferLength: 65,
    maxMaxBufferLength: 120,
    backBufferLength: 45,
    liveSyncDurationCount: 5,
    liveMaxLatencyDurationCount: 12,
    progressiveQuality: false
  },
  extreme: {
    id: 'extreme',
    label: 'אקסטרים (120 שניות)',
    maxBufferLength: 120,
    maxMaxBufferLength: 180,
    backBufferLength: 60,
    liveSyncDurationCount: 7,
    liveMaxLatencyDurationCount: 16,
    progressiveQuality: false
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
    this.currentQualityTier = 'auto';

    // Watchdog & Progressive Quality Ramp-Up timer
    this.watchdogInterval = null;
    this.lastWatchdogTime = -1;
    this.stallTicks = 0;

    this.bufferMode = this.loadBufferMode();
    this.initListeners();
    this.startWatchdogAndQualityRamp();
  }

  loadBufferMode() {
    try {
      const saved = localStorage.getItem(BUFFER_STORAGE_KEY);
      if (saved && BUFFER_PROFILES[saved]) {
        return saved;
      }
    } catch (e) {}
    return 'smart';
  }

  setBufferMode(mode) {
    if (!BUFFER_PROFILES[mode]) return;
    this.bufferMode = mode;
    try {
      localStorage.setItem(BUFFER_STORAGE_KEY, mode);
    } catch (e) {}

    if (this.hls && this.hls.config) {
      const prof = BUFFER_PROFILES[mode];
      this.hls.config.maxBufferLength = prof.maxBufferLength;
      this.hls.config.maxMaxBufferLength = prof.maxMaxBufferLength;
      this.hls.config.backBufferLength = prof.backBufferLength;
      this.hls.config.liveSyncDurationCount = prof.liveSyncDurationCount;
      this.hls.config.liveMaxLatencyDurationCount = prof.liveMaxLatencyDurationCount;
      if (!prof.progressiveQuality) {
        this.hls.autoLevelCapping = -1;
      } else {
        this.updateProgressiveQualityByBuffer();
      }
    }
  }

  getBufferProfile() {
    return BUFFER_PROFILES[this.bufferMode] || BUFFER_PROFILES.smart;
  }

  /**
   * Returns how many seconds of video are currently buffered ahead of currentTime
   */
  getForwardBufferSeconds() {
    if (!this.video) return 0;
    try {
      const buffered = this.video.buffered;
      const cur = this.video.currentTime || 0;
      if (!buffered || buffered.length === 0) return 0;
      for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i);
        const end = buffered.end(i);
        if (cur >= start - 0.5 && cur <= end + 0.5) {
          return Math.max(0, end - cur);
        }
      }
    } catch (e) {}
    return 0;
  }

  /**
   * Progressive Quality Ramp-Up (Smart ABR):
   * - Starts channel playback on the lightest/fastest level so the channel opens immediately
   *   and builds initial buffer rapidly.
   * - As forward buffer grows:
   *   * < 4s buffer: cap to lower/medium quality so segments download 3x faster and prevent stalls
   *   * 4s - 9s buffer: allow up to medium-high quality
   *   * >= 9s buffer: uncap completely (-1 = Full HD 1080p / highest quality)
   * - Never touches playbackRate or seeks currentTime, so zero decoder freezes occur.
   */
  updateProgressiveQualityByBuffer() {
    if (!this.hls || !this.hls.levels || this.hls.levels.length <= 1) {
      this.currentQualityTier = 'full';
      return;
    }

    const prof = this.getBufferProfile();
    if (!prof.progressiveQuality) {
      this.hls.autoLevelCapping = -1;
      this.currentQualityTier = 'full';
      return;
    }

    const totalLevels = this.hls.levels.length;
    const maxLevelIdx = totalLevels - 1;
    const midLevelIdx = Math.max(1, Math.ceil(maxLevelIdx / 2));
    const forwardSec = this.getForwardBufferSeconds();

    if (forwardSec < 3.5) {
      // Low buffer: cap to fastest/lightest level (0) so buffer refills rapidly without stalling
      this.hls.autoLevelCapping = 0;
      this.currentQualityTier = 'low-fast';
    } else if (forwardSec < 8.5) {
      // Medium buffer: step up to intermediate quality while continuing to accumulate buffer
      this.hls.autoLevelCapping = midLevelIdx;
      this.currentQualityTier = 'ramping-up';
    } else {
      // Healthy buffer (>= 8.5s): uncap completely so hls.js plays highest Full HD quality!
      this.hls.autoLevelCapping = -1;
      this.currentQualityTier = 'max-hd';
    }
  }

  initListeners() {
    this.video.addEventListener('loadstart', () => {
      this.triggerState('loading');
    });

    this.video.addEventListener('waiting', () => {
      this.triggerState('buffering');
      // If buffer runs low during playback, immediately allow faster lower-bitrate segment fetch
      this.updateProgressiveQualityByBuffer();
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
      this.updateProgressiveQualityByBuffer();
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
   * Periodic loop (every 2s):
   * 1. Adjusts Progressive Quality Ramp-Up (Smart ABR) based on accumulated buffer
   * 2. Gently heals genuine TS timestamp discontinuities only if playback has been completely
   *    stationary for >= 6 seconds despite buffered video ahead.
   */
  startWatchdogAndQualityRamp() {
    clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.video || !this.currentChannel || this.userPaused || this.video.paused) {
        this.stallTicks = 0;
        return;
      }

      // Smoothly ramp quality up/down as buffer accumulates
      this.updateProgressiveQualityByBuffer();

      // Hardware Audio Watchdog: prevent silent muted drop or volume attenuation
      if (this.video && !this.userPaused) {
        if (this.video.muted) {
          this.video.muted = false;
        }
        if (this.video.volume < 1.0) {
          this.video.volume = 1.0;
        }
      }

      const ct = this.video.currentTime || 0;
      if (ct > 0 && Math.abs(ct - this.lastWatchdogTime) < 0.01) {
        this.stallTicks++;
        if (this.stallTicks >= 3) {
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
    }, 2000);
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
          // Only jump if there is an actual unbuffered hole directly ahead of currentTime
          if (start > cur + 0.1 && start - cur < 4.5 && end > start + 0.5) {
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

    if (this.video) {
      this.video.muted = false;
      this.video.volume = 1.0;
    }

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
        // Progressive Quality Ramp-Up: start on level 0 for instant channel start, then ramp up as buffer fills
        startLevel: prof.progressiveQuality ? 0 : -1,
        capLevelToPlayerSize: false,
        // Audio Synchronization & Codec Support
        maxAudioFramesDrift: 1,
        forceKeyFrameOnDiscontinuity: true,
        // Buffer Configuration
        maxBufferLength: prof.maxBufferLength,
        maxMaxBufferLength: prof.maxMaxBufferLength,
        backBufferLength: prof.backBufferLength,
        liveSyncDurationCount: prof.liveSyncDurationCount,
        liveMaxLatencyDurationCount: prof.liveMaxLatencyDurationCount,
        lowLatencyMode: false,
        // Discontinuity & Hole Healing
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 10,
        maxFragLookUpTolerance: 0.5,
        // Progressive ABR Tuning
        abrEwmaFastLive: 2.5,
        abrEwmaSlowLive: 6.0,
        abrEwmaDefaultEstimate: 2500000,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.7,
        // Resilient network retries
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 700,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 3,
        fragLoadingTimeOut: 14000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 700
      });

      this.hls.attachMedia(this.video);
      this.hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        if (this.hls) this.hls.loadSource(url);
      });

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        // Initialize progressive quality cap based on initial empty buffer so first segments load fast
        this.updateProgressiveQualityByBuffer();

        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            this.video.muted = true;
            this.video
              .play()
              .then(() => {
                setTimeout(() => {
                  if (this.video && !this.userPaused) {
                    this.video.muted = false;
                    this.video.volume = 1.0;
                  }
                }, 100);
              })
              .catch(() => {});
          });
        }
      });

      // Ensure audio track is always active and unmuted
      this.hls.on(window.Hls.Events.AUDIO_TRACK_LOADED, () => {
        if (this.video && !this.userPaused) {
          this.video.muted = false;
          this.video.volume = 1.0;
        }
      });

      this.hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, () => {
        if (this.video && !this.userPaused) {
          this.video.muted = false;
          this.video.volume = 1.0;
        }
      });

      this.hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
        // Every time a segment finishes buffering, re-evaluate if we have enough buffer to step up quality!
        this.updateProgressiveQualityByBuffer();
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data) return;

        if (!data.fatal) {
          if (data.details === window.Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            this.updateProgressiveQualityByBuffer();
          } else if (data.details === window.Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE) {
            this.nudgeIfBufferedAhead();
          } else if (
            data.details === window.Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
            data.details === window.Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT
          ) {
            console.warn('Audio track load error, falling back to primary audio track...');
            if (this.hls && this.hls.audioTracks && this.hls.audioTracks.length > 0) {
              this.hls.audioTrack = 0;
            }
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
          if (now - this.lastMediaRecoveryMs > 2000 && this.hls) {
            this.lastMediaRecoveryMs = now;
            console.warn('Media/Audio decode error, recovering media pipeline...');
            this.hls.recoverMediaError();
            if (this.video) {
              this.video.muted = false;
              this.video.volume = 1.0;
            }
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
      this.video.muted = false;
      this.video.volume = 1.0;
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          this.video.muted = true;
          this.video
            .play()
            .then(() => {
              setTimeout(() => {
                if (this.video && !this.userPaused) {
                  this.video.muted = false;
                  this.video.volume = 1.0;
                }
              }, 100);
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
    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        if (this.video.srcObject) this.video.srcObject = null;
        this.video.load(); // Forces webOS to release ALSA hardware audio decoder pipeline!
        this.video.muted = false;
        this.video.volume = 1.0;
      } catch (e) {}
    }
  }

  /**
   * Recovers audio pipeline on webOS if audio was dropped by sleep, standby,
   * HDMI input switch, or browser autoplay policy lock.
   */
  recoverAudioSink() {
    if (!this.video) return;
    try {
      this.video.muted = false;
      this.video.volume = 1.0;
      if (this.hls) {
        try {
          this.hls.recoverMediaError();
        } catch (e) {}
      }
      if (!this.userPaused && this.currentChannel) {
        const p = this.video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            this.video.muted = false;
            this.video.volume = 1.0;
            this.video.play().catch(() => {});
          });
        }
      }
    } catch (e) {
      console.warn('recoverAudioSink notice:', e);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoPlayer;
}
