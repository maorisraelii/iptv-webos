/**
 * Smart Adaptive & Per-Channel Learning Anti-Freeze Video Player for LG webOS TV (webOS 4.64 & 5.0+)
 * - Default 'smart' mode:
 *   1. Instant Channel Zapping (liveSyncDurationCount: 2) on healthy channels for fiber connections
 *   2. Silent Background Cushion Builder (imperceptible 0.97x glide with pitch preservation until safety buffer is full)
 *   3. Per-Channel Auto-Learning Memory (zenplay_channel_health_v1): detects stalls on problematic channels,
 *      dynamically boosts buffer for that specific channel on the fly, and remembers problematic channels across sessions!
 * - Manual profiles also available: Fast (15s), Balanced (35s), Deep (65s), Extreme (120s)
 */

const BUFFER_STORAGE_KEY = 'zenplay_iptv_buffer_mode_v3';
const CHANNEL_HEALTH_STORAGE_KEY = 'zenplay_channel_health_v1';

const BUFFER_PROFILES = {
  smart: {
    id: 'smart',
    label: 'אוטומטי חכם (זפזופ מהיר + באפר לומד לפי ערוץ)',
    maxBufferLength: 90,
    maxMaxBufferLength: 180,
    backBufferLength: 60,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 16,
    adaptive: true
  },
  fast: {
    id: 'fast',
    label: 'מהיר קבוע (15 שניות)',
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    backBufferLength: 15,
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 6,
    adaptive: false
  },
  balanced: {
    id: 'balanced',
    label: 'מאוזן קבוע (35 שניות)',
    maxBufferLength: 35,
    maxMaxBufferLength: 70,
    backBufferLength: 30,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    adaptive: false
  },
  deep: {
    id: 'deep',
    label: 'באפר גבוה קבוע (65 שניות)',
    maxBufferLength: 65,
    maxMaxBufferLength: 120,
    backBufferLength: 45,
    liveSyncDurationCount: 7,
    liveMaxLatencyDurationCount: 14,
    adaptive: false
  },
  extreme: {
    id: 'extreme',
    label: 'אקסטרים קבוע (120 שניות)',
    maxBufferLength: 120,
    maxMaxBufferLength: 180,
    backBufferLength: 60,
    liveSyncDurationCount: 10,
    liveMaxLatencyDurationCount: 20,
    adaptive: false
  }
};

// Per-channel adaptive tiers used when bufferMode === 'smart'
const SMART_CHANNEL_TIERS = [
  // Level 0: Healthy channel on fiber -> Instant Zap (2 segments) + 16s background cushion
  { level: 0, label: 'זפזופ מהיר + צבירה ברקע', liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 14, maxBufferLength: 90, targetCushionSec: 16 },
  // Level 1: 1 stall detected -> Boosted cushion (30s) & 5-segment sync
  { level: 1, label: 'באפר מוגבר אוטומטית (דרגה 1)', liveSyncDurationCount: 5, liveMaxLatencyDurationCount: 16, maxBufferLength: 110, targetCushionSec: 30 },
  // Level 2: 2 stalls detected -> Deep per-channel buffer (48s) & 8-segment sync
  { level: 2, label: 'באפר עמוק לערוץ בעייתי (דרגה 2)', liveSyncDurationCount: 8, liveMaxLatencyDurationCount: 18, maxBufferLength: 135, targetCushionSec: 48 },
  // Level 3: 3+ stalls detected -> Maximum anti-freeze shield (65s) & 10-segment sync
  { level: 3, label: 'מגן תקיעות מקסימלי לערוץ (דרגה 3)', liveSyncDurationCount: 10, liveMaxLatencyDurationCount: 22, maxBufferLength: 160, targetCushionSec: 65 }
];

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
    this.lastStallBoostMs = 0;
    this.channelSwitchStartMs = 0;
    this.smoothPlayTicks = 0;

    // Anti-Stall Watchdog & Adaptive Cushion state
    this.watchdogInterval = null;
    this.lastWatchdogTime = -1;
    this.stallTicks = 0;

    this.channelHealthMap = this.loadChannelHealthMap();
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
    return 'smart'; // Default to Smart Adaptive (Fast Zap + Per-Channel Learning Buffer)
  }

  loadChannelHealthMap() {
    try {
      const raw = localStorage.getItem(CHANNEL_HEALTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {};
  }

  saveChannelHealthMap() {
    try {
      localStorage.setItem(CHANNEL_HEALTH_STORAGE_KEY, JSON.stringify(this.channelHealthMap));
    } catch (e) {}
  }

  resetChannelHealthMap() {
    this.channelHealthMap = {};
    try {
      localStorage.removeItem(CHANNEL_HEALTH_STORAGE_KEY);
    } catch (e) {}
  }

  getChannelHealthLevel(channel) {
    const ch = channel || this.currentChannel;
    if (!ch || !ch.id) return 0;
    const entry = this.channelHealthMap[ch.id];
    if (!entry || typeof entry.level !== 'number') return 0;
    return Math.max(0, Math.min(3, entry.level));
  }

  getProblematicChannelsCount() {
    const keys = Object.keys(this.channelHealthMap || {});
    let count = 0;
    for (let i = 0; i < keys.length; i++) {
      if (this.channelHealthMap[keys[i]] && this.channelHealthMap[keys[i]].level > 0) {
        count++;
      }
    }
    return count;
  }

  getEffectiveChannelConfig(channel) {
    const baseProf = this.getBufferProfile();
    if (this.bufferMode !== 'smart') {
      return {
        liveSyncDurationCount: baseProf.liveSyncDurationCount,
        liveMaxLatencyDurationCount: baseProf.liveMaxLatencyDurationCount,
        maxBufferLength: baseProf.maxBufferLength,
        maxMaxBufferLength: baseProf.maxMaxBufferLength,
        backBufferLength: baseProf.backBufferLength,
        targetCushionSec: baseProf.maxBufferLength,
        tierLevel: 0,
        tierLabel: baseProf.label
      };
    }

    const level = this.getChannelHealthLevel(channel);
    const tier = SMART_CHANNEL_TIERS[level] || SMART_CHANNEL_TIERS[0];
    return {
      liveSyncDurationCount: tier.liveSyncDurationCount,
      liveMaxLatencyDurationCount: tier.liveMaxLatencyDurationCount,
      maxBufferLength: tier.maxBufferLength,
      maxMaxBufferLength: 180,
      backBufferLength: 60,
      targetCushionSec: tier.targetCushionSec,
      tierLevel: tier.level,
      tierLabel: tier.label
    };
  }

  setBufferMode(mode) {
    if (!BUFFER_PROFILES[mode]) return;
    this.bufferMode = mode;
    try {
      localStorage.setItem(BUFFER_STORAGE_KEY, mode);
    } catch (e) {}

    // Reset playbackRate if leaving smart mode
    if (mode !== 'smart' && this.video) {
      try {
        this.video.playbackRate = 1.0;
      } catch (e) {}
    }

    this.applyActiveHlsConfig();
  }

  applyActiveHlsConfig() {
    if (!this.hls || !this.hls.config) return;
    const cfg = this.getEffectiveChannelConfig(this.currentChannel);
    this.hls.config.maxBufferLength = cfg.maxBufferLength;
    this.hls.config.maxMaxBufferLength = cfg.maxMaxBufferLength;
    this.hls.config.backBufferLength = cfg.backBufferLength;
    this.hls.config.liveSyncDurationCount = cfg.liveSyncDurationCount;
    this.hls.config.liveMaxLatencyDurationCount = cfg.liveMaxLatencyDurationCount;
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
   * Records a stall on the current channel, upgrades its per-channel buffer tier in localStorage,
   * and immediately expands the live buffer cushion so it stops freezing.
   */
  recordChannelStall(reason) {
    if (!this.currentChannel || !this.currentChannel.id) return null;
    const now = Date.now();
    // Ignore initial 2.2s right after switching channel, and debounce multiple events within 4s
    if (now - this.channelSwitchStartMs < 2200 || now - this.lastStallBoostMs < 4000) {
      return null;
    }
    this.lastStallBoostMs = now;
    this.smoothPlayTicks = 0;

    const id = this.currentChannel.id;
    const prevLevel = this.getChannelHealthLevel(this.currentChannel);
    const nextLevel = Math.min(3, prevLevel + 1);

    this.channelHealthMap[id] = {
      level: nextLevel,
      stalls: ((this.channelHealthMap[id] && this.channelHealthMap[id].stalls) || 0) + 1,
      lastStallAt: now,
      reason: reason || 'stall'
    };
    this.saveChannelHealthMap();

    // Immediately apply upgraded buffer settings to active HLS instance
    this.applyActiveHlsConfig();

    // Gently step back 2.2s into already-buffered data (if available) or glide at 0.95x to build cushion immediately
    if (this.video && !this.userPaused) {
      try {
        const buffered = this.video.buffered;
        const cur = this.video.currentTime || 0;
        if (buffered && buffered.length > 0) {
          const start = buffered.start(buffered.length - 1);
          if (cur - start > 3.0) {
            this.video.currentTime = cur - 2.0;
          }
        }
        if (this.bufferMode === 'smart') {
          this.setPitchPreservedRate(0.95);
        }
      } catch (e) {}
    }

    const eff = this.getEffectiveChannelConfig(this.currentChannel);
    if (this.callbacks.onAdaptiveBoost && nextLevel > prevLevel) {
      this.callbacks.onAdaptiveBoost(this.currentChannel, nextLevel, eff);
    }
    return eff;
  }

  setPitchPreservedRate(rate) {
    if (!this.video) return;
    try {
      if ('preservesPitch' in this.video) this.video.preservesPitch = true;
      if ('webkitPreservesPitch' in this.video) this.video.webkitPreservesPitch = true;
      if (Math.abs((this.video.playbackRate || 1) - rate) > 0.005) {
        this.video.playbackRate = rate;
      }
    } catch (e) {}
  }

  /**
   * Smart Cushion Controller:
   * - Starts channel playback immediately at live edge (fast zap)
   * - While forward buffer < targetCushionSec, glides at an imperceptible 0.97x rate
   *   so the channel silently accumulates a deep anti-freeze buffer in RAM while playing!
   * - Once forward buffer >= targetCushionSec, locks playbackRate back to 1.00x.
   */
  updateAdaptiveCushion() {
    if (!this.video || this.userPaused || this.video.paused) return;
    if (this.bufferMode !== 'smart') {
      this.setPitchPreservedRate(1.0);
      return;
    }

    const forwardSec = this.getForwardBufferSeconds();
    const eff = this.getEffectiveChannelConfig(this.currentChannel);
    const targetSec = eff.targetCushionSec || 16;

    if (forwardSec > 1.2 && forwardSec < targetSec * 0.85) {
      // Gently accumulate cushion in the background (0.97x is imperceptible with pitch preservation)
      const glideRate = eff.tierLevel >= 2 ? 0.955 : 0.97;
      this.setPitchPreservedRate(glideRate);
    } else if (forwardSec >= targetSec) {
      this.setPitchPreservedRate(1.0);
    }
  }

  initListeners() {
    this.video.addEventListener('loadstart', () => {
      this.triggerState('loading');
    });

    this.video.addEventListener('waiting', () => {
      this.triggerState('buffering');
      if (this.bufferMode === 'smart' && Date.now() - this.channelSwitchStartMs > 3500) {
        this.recordChannelStall('waiting');
      }
    });

    this.video.addEventListener('canplay', () => {
      this.triggerState('playing');
    });

    this.video.addEventListener('playing', () => {
      this.retryCount = 0;
      this.stallTicks = 0;
      this.userPaused = false;
      this.triggerState('playing');
      this.updateAdaptiveCushion();
    });

    this.video.addEventListener('pause', () => {
      if (this.userPaused) {
        this.triggerState('paused');
      }
    });

    this.video.addEventListener('stalled', () => {
      if (this.bufferMode === 'smart') {
        this.recordChannelStall('stalled');
      }
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
   * Anti-Freeze Watchdog & Smart Cushion Loop:
   * Checks every 2.5s if playback froze despite having buffered data ahead,
   * updates the progressive background cushion, and heals channel health after long smooth playback.
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
        this.smoothPlayTicks = 0;
        if (this.stallTicks >= 2) {
          if (this.bufferMode === 'smart') {
            this.recordChannelStall('watchdog_freeze');
          }
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
        this.smoothPlayTicks++;
        this.updateAdaptiveCushion();

        // If a previously problematic channel plays smoothly for 5 minutes (120 ticks * 2.5s), heal 1 level
        if (this.smoothPlayTicks >= 120 && this.currentChannel && this.currentChannel.id) {
          this.smoothPlayTicks = 0;
          const curLevel = this.getChannelHealthLevel(this.currentChannel);
          if (curLevel > 0) {
            this.channelHealthMap[this.currentChannel.id].level = curLevel - 1;
            this.saveChannelHealthMap();
            this.applyActiveHlsConfig();
          }
        }
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
    this.smoothPlayTicks = 0;
    this.channelSwitchStartMs = Date.now();
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
      const cfg = this.getEffectiveChannelConfig(this.currentChannel);

      this.hls = new window.Hls({
        enableWorker: false,
        // Smart Adaptive or Manual Buffer Configuration
        maxBufferLength: cfg.maxBufferLength,
        maxMaxBufferLength: cfg.maxMaxBufferLength,
        backBufferLength: cfg.backBufferLength,
        liveSyncDurationCount: cfg.liveSyncDurationCount,
        liveMaxLatencyDurationCount: cfg.liveMaxLatencyDurationCount,
        lowLatencyMode: false,
        // Anti-Freeze & Discontinuity Healing
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 1,
        nudgeOffset: 0.25,
        nudgeMaxRetry: 12,
        maxFragLookUpTolerance: 0.5,
        // Smooth ABR (prevents frequent quality-switch freezes)
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.7,
        // Resilient network retries so temporary IPTV server hiccups never freeze playback
        manifestLoadingTimeOut: 9000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 600,
        levelLoadingTimeOut: 9000,
        levelLoadingMaxRetry: 3,
        fragLoadingTimeOut: 12000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 600
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

        // Handle non-fatal buffer stalls smoothly & trigger Smart Per-Channel Learning Boost!
        if (!data.fatal) {
          if (
            data.details === window.Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
            data.details === window.Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE ||
            data.details === window.Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
          ) {
            if (this.bufferMode === 'smart') {
              this.recordChannelStall(data.details);
            }
            this.nudgeIfBufferedAhead();
          }
          return;
        }

        // Fatal error recovery pipeline
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.bufferMode === 'smart') {
            this.recordChannelStall('network_error');
          }
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
    if (this.video) {
      try {
        this.video.playbackRate = 1.0;
      } catch (e) {}
    }
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
