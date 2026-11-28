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
const PLAYER_AV_PREFS_KEY = 'zenplay_av_prefs_v1';
const PLAYER_LOUDNESS_KEY = 'zenplay_channel_loudness_v1';
const PLAYER_LOUDNESS_MAX_LEARNED = 250;
const PLAYER_ZAP_FADE_MS = 280;
const PLAYER_ZAP_FADE_START = 0.15;
const PLAYER_LOUDNESS_SAMPLE_MS = 300;

const PLAYER_DEFAULT_AV_PREFS = {
  audioNormMode: 'off',
  audioVoiceBoost: false,
  audioZapFade: true,
  videoQualityMode: 'smart',
  streamLatencyMode: 'standard',
  memorySaverMode: 'auto'
};

const PLAYER_AUDIO_NORM_CURVES = {
  off: { threshold: 0, ratio: 1, knee: 0, attack: 0.003, release: 0.25, targetDb: -18, makeup: 1.0 },
  gentle: { threshold: -20, ratio: 3, knee: 18, attack: 0.01, release: 0.25, targetDb: -18, makeup: 1.05 },
  broadcast: { threshold: -26, ratio: 6, knee: 14, attack: 0.005, release: 0.22, targetDb: -16, makeup: 1.15 },
  night: { threshold: -34, ratio: 10, knee: 10, attack: 0.003, release: 0.18, targetDb: -22, makeup: 1.3 }
};

const PLAYER_QUALITY_MODES = { smart: true, max: true, hd1080: true, hd720: true };
const PLAYER_LATENCY_MODES = { standard: true, low: true };
const PLAYER_MEMORY_MODES = { auto: true, aggressive: true, off: true };

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
    this.catchupOriginStartMs = 0;
    this._streamCatchupOriginMs = 0;
    this._pendingCatchupTargetMs = 0;
    this._catchupSeekDebounceTimer = null;
    this._lastBoundaryCheckMs = 0;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryTimer = null;
    this._networkRetryTimer = null;
    this._unmuteTimer = null;
    this.usedNativeFallback = false;
    this._isNativePlayback = false;
    this._enteringNative = false;
    this._isCleaningUp = false;
    this._isPlaying = false;
    this.userPaused = false;
    this.lastMediaRecoveryMs = 0;
    this._mediaRecoveryAttempts = 0;
    this._hlsIsCatchup = false;
    this._hlsReused = false;
    this._currentUrl = '';
    this.currentQualityTier = 'auto';

    // Watchdog & Progressive Quality Ramp-Up timer
    this.watchdogInterval = null;
    this.lastWatchdogTime = -1;
    this.stallTicks = 0;
    this._stallRecoveryAttempts = 0;
    this._lastStallRecoveryMs = 0;
    this._lastPreconnectOrigin = '';
    this._preconnectLinkEl = null;

    // AV Audio & Quality Engine runtime state
    this._avPrefs = null;
    this._loudnessData = null;
    this._zapFadeFactor = 1.0;
    this._zapFadeTimer = null;
    this._zapFadeRaf = null;
    this._zapFadeStartMs = 0;
    this._audioCtx = null;
    this._mediaSourceNode = null;
    this._mediaSourceVideo = null;
    this._highPassFilter = null;
    this._voiceBoostFilter = null;
    this._rmsAutoGainNode = null;
    this._compressorNode = null;
    this._makeupGainNode = null;
    this._analyserNode = null;
    this._analyserFloatBuf = typeof Float32Array === 'function' ? new Float32Array(512) : null;
    this._analyserByteBuf = null;
    this._webAudioGraphReady = false;
    this._loudnessSampleTimer = null;
    this._isPowerSaveMode = false;
    this._currentRmsGain = 1.0;
    this._lastSampledDb = null;
    this._lastLoudnessPersistMs = 0;
    this._lastPersistedLoudnessChId = '';
    this._lastPersistedGain = 1.0;

    this.bufferMode = this.loadBufferMode();
    this._ensureAvRuntimeState();
    this.initListeners();
    this.startWatchdogAndQualityRamp();
  }

  _ensureAvRuntimeState() {
    if (!this._avPrefs) {
      this._avPrefs = this.loadAvPrefs();
    }
    if (!this._loudnessData) {
      this._loudnessData = this.loadLoudnessData();
    }
    if (!this._analyserFloatBuf && typeof Float32Array === 'function') {
      this._analyserFloatBuf = new Float32Array(512);
    }
    if (typeof this._isPowerSaveMode !== 'boolean') {
      this._isPowerSaveMode = false;
    }
    if (typeof this._stallRecoveryAttempts !== 'number') {
      this._stallRecoveryAttempts = 0;
    }
    if (typeof this._lastStallRecoveryMs !== 'number') {
      this._lastStallRecoveryMs = 0;
    }
    if (typeof this._lastPreconnectOrigin !== 'string') {
      this._lastPreconnectOrigin = '';
    }
    if (typeof this._zapFadeFactor !== 'number' || !isFinite(this._zapFadeFactor)) {
      this._zapFadeFactor = 1.0;
    }
    if (typeof this._currentRmsGain !== 'number' || !isFinite(this._currentRmsGain)) {
      this._currentRmsGain = 1.0;
    }
    if (typeof this._webAudioGraphReady !== 'boolean') {
      this._webAudioGraphReady = false;
    }
  }

  _sanitizeAvPrefs(raw, base) {
    const fallback = base || PLAYER_DEFAULT_AV_PREFS;
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      audioNormMode: PLAYER_AUDIO_NORM_CURVES[src.audioNormMode] ? src.audioNormMode : fallback.audioNormMode,
      audioVoiceBoost: typeof src.audioVoiceBoost === 'boolean' ? src.audioVoiceBoost : Boolean(fallback.audioVoiceBoost),
      audioZapFade: typeof src.audioZapFade === 'boolean' ? src.audioZapFade : Boolean(fallback.audioZapFade),
      videoQualityMode: PLAYER_QUALITY_MODES[src.videoQualityMode] ? src.videoQualityMode : fallback.videoQualityMode,
      streamLatencyMode: PLAYER_LATENCY_MODES[src.streamLatencyMode] ? src.streamLatencyMode : fallback.streamLatencyMode,
      memorySaverMode: PLAYER_MEMORY_MODES[src.memorySaverMode] ? src.memorySaverMode : fallback.memorySaverMode
    };
  }

  loadAvPrefs() {
    let parsed = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(PLAYER_AV_PREFS_KEY);
        if (raw) parsed = JSON.parse(raw);
      }
    } catch (e) {}
    return this._sanitizeAvPrefs(parsed, PLAYER_DEFAULT_AV_PREFS);
  }

  getAvPrefs() {
    this._ensureAvRuntimeState();
    return {
      audioNormMode: this._avPrefs.audioNormMode,
      audioVoiceBoost: this._avPrefs.audioVoiceBoost,
      audioZapFade: this._avPrefs.audioZapFade,
      videoQualityMode: this._avPrefs.videoQualityMode,
      streamLatencyMode: this._avPrefs.streamLatencyMode,
      memorySaverMode: this._avPrefs.memorySaverMode
    };
  }

  setAvPrefs(prefs) {
    this._ensureAvRuntimeState();
    const prev = this._avPrefs;
    const next = this._sanitizeAvPrefs(prefs, prev);
    this._avPrefs = next;

    try {
      if (typeof localStorage !== 'undefined') {
        const merged = {};
        const existingRaw = localStorage.getItem(PLAYER_AV_PREFS_KEY);
        if (existingRaw) {
          try {
            const existingObj = JSON.parse(existingRaw);
            if (existingObj && typeof existingObj === 'object') {
              const keys = Object.keys(existingObj);
              for (let i = 0; i < keys.length; i++) {
                merged[keys[i]] = existingObj[keys[i]];
              }
            }
          } catch (e) {}
        }
        merged.audioNormMode = next.audioNormMode;
        merged.audioVoiceBoost = next.audioVoiceBoost;
        merged.audioZapFade = next.audioZapFade;
        merged.videoQualityMode = next.videoQualityMode;
        merged.streamLatencyMode = next.streamLatencyMode;
        merged.memorySaverMode = next.memorySaverMode;
        localStorage.setItem(PLAYER_AV_PREFS_KEY, JSON.stringify(merged));
      }
    } catch (e) {}

    if (next.audioNormMode === 'off') {
      this._currentRmsGain = 1.0;
      this._stopLoudnessSampler();
    } else if (prev.audioNormMode === 'off') {
      const chId = this._getCurrentChannelId();
      const learned = chId && this._loudnessData && this._loudnessData.learned ? this._loudnessData.learned[chId] : null;
      if (learned && typeof learned.gain === 'number' && isFinite(learned.gain)) {
        this._currentRmsGain = Math.max(0.35, Math.min(2.4, learned.gain));
      } else {
        this._currentRmsGain = 1.0;
      }
    }

    if (!next.audioZapFade) {
      this._cancelZapFade();
      this._zapFadeFactor = 1.0;
    }

    if (next.audioNormMode !== 'off' || next.audioVoiceBoost) {
      if (this.hls && !this._isNativePlayback) {
        this.ensureWebAudioPipeline();
      }
    }
    if (this._webAudioGraphReady) {
      this._updateWebAudioParams();
    }
    this._syncLoudnessSamplerState();
    this.applyEffectiveVolume();

    if (this.hls) {
      this._applyHlsConfigTuning(this._hlsIsCatchup);
    }
    this.applyVideoQualityMode();

    return this.getAvPrefs();
  }

  _getChannelLoudnessId(channelOrId) {
    if (typeof channelOrId === 'string') return channelOrId.trim();
    if (typeof channelOrId === 'number' && isFinite(channelOrId)) return String(channelOrId);
    if (channelOrId && typeof channelOrId === 'object') {
      const id = channelOrId.id || channelOrId.uid || channelOrId.url || '';
      return id ? String(id) : '';
    }
    return '';
  }

  _getCurrentChannelId() {
    return this._getChannelLoudnessId(this.currentChannel);
  }

  _pruneLoudnessLru(learnedMap) {
    if (!learnedMap || typeof learnedMap !== 'object') return;
    const keys = Object.keys(learnedMap);
    if (keys.length <= PLAYER_LOUDNESS_MAX_LEARNED) return;
    keys.sort((a, b) => {
      const ta = learnedMap[a] && typeof learnedMap[a].ts === 'number' ? learnedMap[a].ts : 0;
      const tb = learnedMap[b] && typeof learnedMap[b].ts === 'number' ? learnedMap[b].ts : 0;
      return ta - tb;
    });
    const toRemove = keys.length - PLAYER_LOUDNESS_MAX_LEARNED;
    for (let i = 0; i < toRemove; i++) {
      delete learnedMap[keys[i]];
    }
  }

  loadLoudnessData() {
    const empty = { trim: {}, learned: {} };
    try {
      if (typeof localStorage === 'undefined') return empty;
      const raw = localStorage.getItem(PLAYER_LOUDNESS_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return empty;
      const trim = parsed.trim && typeof parsed.trim === 'object' ? parsed.trim : {};
      const learned = parsed.learned && typeof parsed.learned === 'object' ? parsed.learned : {};
      this._pruneLoudnessLru(learned);
      return { trim: trim, learned: learned };
    } catch (e) {
      return empty;
    }
  }

  _saveLoudnessData() {
    this._ensureAvRuntimeState();
    this._pruneLoudnessLru(this._loudnessData.learned);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PLAYER_LOUDNESS_KEY, JSON.stringify(this._loudnessData));
      }
    } catch (e) {}
  }

  setChannelVolumeTrim(channelId, trimDb) {
    this._ensureAvRuntimeState();
    const chId = (channelId === null || channelId === undefined)
      ? this._getCurrentChannelId()
      : this._getChannelLoudnessId(channelId);
    if (!chId) return 0;
    const num = Number(trimDb);
    if (!isFinite(num)) return this.getChannelVolumeTrim(chId);
    const clamped = Math.max(-6, Math.min(6, Math.round(num)));
    if (clamped === 0) {
      delete this._loudnessData.trim[chId];
    } else {
      this._loudnessData.trim[chId] = clamped;
    }
    this._saveLoudnessData();
    if (this._webAudioGraphReady) {
      this._updateWebAudioParams();
    }
    this.applyEffectiveVolume();
    return clamped;
  }

  getChannelVolumeTrim(channelId) {
    this._ensureAvRuntimeState();
    const chId = (channelId === null || channelId === undefined)
      ? this._getCurrentChannelId()
      : this._getChannelLoudnessId(channelId);
    if (!chId || !this._loudnessData || !this._loudnessData.trim) return 0;
    const val = this._loudnessData.trim[chId];
    return typeof val === 'number' && isFinite(val) ? Math.max(-6, Math.min(6, val)) : 0;
  }

  resetLoudnessMemory() {
    this._ensureAvRuntimeState();
    this._loudnessData = { trim: {}, learned: {} };
    this._currentRmsGain = 1.0;
    this._lastSampledDb = null;
    this._lastLoudnessPersistMs = 0;
    this._lastPersistedLoudnessChId = '';
    this._lastPersistedGain = 1.0;
    this._saveLoudnessData();
    if (this._webAudioGraphReady) {
      this._updateWebAudioParams();
    }
    this.applyEffectiveVolume();
  }

  _getChannelLearnedGain(channelId) {
    this._ensureAvRuntimeState();
    if (!channelId || !this._loudnessData || !this._loudnessData.learned) return 1.0;
    const entry = this._loudnessData.learned[channelId];
    if (entry && typeof entry.gain === 'number' && isFinite(entry.gain)) {
      return Math.max(0.35, Math.min(2.4, entry.gain));
    }
    return 1.0;
  }

  _getAppliedNormGainLinear() {
    this._ensureAvRuntimeState();
    if (this._avPrefs.audioNormMode === 'off') return 1.0;
    if (this._webAudioGraphReady) {
      return Math.max(0.35, Math.min(2.4, this._currentRmsGain));
    }
    return this._getChannelLearnedGain(this._getCurrentChannelId());
  }

  applyEffectiveVolume() {
    this._ensureAvRuntimeState();
    const chId = this._getCurrentChannelId();
    const trimDb = chId ? this.getChannelVolumeTrim(chId) : 0;
    const trimLinear = Math.pow(10, trimDb / 20);
    const learnedGain = this._avPrefs.audioNormMode !== 'off' ? this._getChannelLearnedGain(chId) : 1.0;
    const fadeFactor = Math.max(0.15, Math.min(1.0, this._zapFadeFactor));

    let effectiveGain;
    if (this._webAudioGraphReady) {
      // Positive trim & RMS normalization live inside Web Audio nodes to prevent double-applying gain
      effectiveGain = trimDb < 0 ? trimLinear : 1.0;
    } else {
      effectiveGain = trimLinear * learnedGain;
    }

    const targetVol = Math.max(0.05, Math.min(1.0, effectiveGain * fadeFactor));
    if (this.video) {
      try {
        if (typeof this.video.volume !== 'number' || Math.abs(this.video.volume - targetVol) > 0.0005) {
          this.video.volume = targetVol;
        }
      } catch (e) {}
    }
    return targetVol;
  }

  _cancelZapFade() {
    if (this._zapFadeTimer) {
      clearTimeout(this._zapFadeTimer);
      this._zapFadeTimer = null;
    }
    if (this._zapFadeRaf && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      try {
        window.cancelAnimationFrame(this._zapFadeRaf);
      } catch (e) {}
      this._zapFadeRaf = null;
    }
  }

  startSoftZapFade() {
    this._ensureAvRuntimeState();
    this._cancelZapFade();

    if (!this._avPrefs.audioZapFade) {
      this._zapFadeFactor = 1.0;
      this.applyEffectiveVolume();
      return;
    }

    this._zapFadeFactor = PLAYER_ZAP_FADE_START;
    this._zapFadeStartMs = Date.now();
    this.applyEffectiveVolume();

    const stepFade = () => {
      this._zapFadeTimer = null;
      this._zapFadeRaf = null;
      if (this._isCleaningUp || !this._avPrefs || !this._avPrefs.audioZapFade) {
        this._zapFadeFactor = 1.0;
        this.applyEffectiveVolume();
        return;
      }
      const elapsed = Math.max(0, Date.now() - this._zapFadeStartMs);
      const progress = Math.min(1, elapsed / PLAYER_ZAP_FADE_MS);
      this._zapFadeFactor = PLAYER_ZAP_FADE_START + (1.0 - PLAYER_ZAP_FADE_START) * progress;
      this.applyEffectiveVolume();
      if (progress < 1) {
        this._zapFadeTimer = setTimeout(stepFade, 18);
      }
    };

    this._zapFadeTimer = setTimeout(stepFade, 18);
  }

  _setAudioParam(param, value, timeConstant) {
    if (!param) return;
    try {
      const ctx = this._audioCtx;
      const now = ctx && typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
      if (timeConstant && timeConstant > 0 && typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(value, now, timeConstant);
      } else if (typeof param.setValueAtTime === 'function') {
        param.setValueAtTime(value, now);
      } else {
        param.value = value;
      }
    } catch (e) {
      try {
        param.value = value;
      } catch (e2) {}
    }
  }

  _updateWebAudioParams() {
    if (!this._webAudioGraphReady) return;
    const prefs = this._avPrefs || PLAYER_DEFAULT_AV_PREFS;
    const normMode = prefs.audioNormMode || 'off';
    const curve = PLAYER_AUDIO_NORM_CURVES[normMode] || PLAYER_AUDIO_NORM_CURVES.off;
    const voiceBoost = Boolean(prefs.audioVoiceBoost);
    const trimDb = this.getChannelVolumeTrim();
    const posTrimGain = trimDb > 0 ? Math.pow(10, trimDb / 20) : 1.0;

    if (this._highPassFilter) {
      this._setAudioParam(this._highPassFilter.frequency, voiceBoost ? 90 : 20, 0.04);
    }
    if (this._voiceBoostFilter) {
      this._setAudioParam(this._voiceBoostFilter.gain, voiceBoost ? 3.5 : 0, 0.04);
    }
    if (this._rmsAutoGainNode) {
      this._setAudioParam(this._rmsAutoGainNode.gain, normMode === 'off' ? 1.0 : this._currentRmsGain, 0.08);
    }
    if (this._compressorNode) {
      this._setAudioParam(this._compressorNode.threshold, curve.threshold, 0);
      this._setAudioParam(this._compressorNode.ratio, curve.ratio, 0);
      this._setAudioParam(this._compressorNode.knee, curve.knee, 0);
      this._setAudioParam(this._compressorNode.attack, curve.attack, 0);
      this._setAudioParam(this._compressorNode.release, curve.release, 0);
    }
    if (this._makeupGainNode) {
      this._setAudioParam(this._makeupGainNode.gain, curve.makeup * posTrimGain, 0.05);
    }
  }

  ensureWebAudioPipeline() {
    this._ensureAvRuntimeState();
    const prefs = this._avPrefs;

    // AUDIO SAFETY: Never touch createMediaElementSource on native/cross-origin streams or when both features are off
    if (!this.video || !this.hls || this._isNativePlayback) {
      return false;
    }
    if (prefs.audioNormMode === 'off' && !prefs.audioVoiceBoost) {
      if (this._webAudioGraphReady) {
        this._updateWebAudioParams();
      }
      this._stopLoudnessSampler();
      return false;
    }

    const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AudioCtx) {
      return false;
    }

    if (!this._audioCtx) {
      try {
        this._audioCtx = new AudioCtx();
      } catch (e) {
        return false;
      }
    }

    // AUDIO SAFETY: Never attach createMediaElementSource while AudioContext is suspended (prevents cold-boot mute)
    if (!this._audioCtx || this._audioCtx.state !== 'running') {
      return false;
    }

    if (this._webAudioGraphReady && this._mediaSourceVideo === this.video) {
      this._updateWebAudioParams();
      this._syncLoudnessSamplerState();
      return true;
    }

    try {
      const ctx = this._audioCtx;
      if (!this._mediaSourceNode || this._mediaSourceVideo !== this.video) {
        this._mediaSourceNode = ctx.createMediaElementSource(this.video);
        this._mediaSourceVideo = this.video;
      }

      this._highPassFilter = ctx.createBiquadFilter();
      this._highPassFilter.type = 'highpass';
      this._setAudioParam(this._highPassFilter.Q, 0.7, 0);

      this._voiceBoostFilter = ctx.createBiquadFilter();
      this._voiceBoostFilter.type = 'peaking';
      this._setAudioParam(this._voiceBoostFilter.frequency, 2400, 0);
      this._setAudioParam(this._voiceBoostFilter.Q, 1.1, 0);

      this._rmsAutoGainNode = ctx.createGain();
      this._compressorNode = ctx.createDynamicsCompressor();
      this._makeupGainNode = ctx.createGain();
      this._analyserNode = ctx.createAnalyser();
      this._analyserNode.fftSize = 512;

      const chId = this._getCurrentChannelId();
      if (prefs.audioNormMode !== 'off' && chId) {
        this._currentRmsGain = this._getChannelLearnedGain(chId);
      } else {
        this._currentRmsGain = 1.0;
      }

      this._mediaSourceNode.connect(this._highPassFilter);
      this._highPassFilter.connect(this._voiceBoostFilter);
      this._voiceBoostFilter.connect(this._rmsAutoGainNode);
      this._rmsAutoGainNode.connect(this._compressorNode);
      this._compressorNode.connect(this._makeupGainNode);
      this._makeupGainNode.connect(this._analyserNode);
      this._analyserNode.connect(ctx.destination);

      this._webAudioGraphReady = true;
      this._updateWebAudioParams();
      this.applyEffectiveVolume();
      this._syncLoudnessSamplerState();
      return true;
    } catch (e) {
      this._webAudioGraphReady = false;
      return false;
    }
  }

  resumeAudioPipeline() {
    this._ensureAvRuntimeState();
    const prefs = this._avPrefs;
    const hasPromise = typeof Promise === 'function';

    if (prefs.audioNormMode === 'off' && !prefs.audioVoiceBoost && !this._webAudioGraphReady) {
      return hasPromise ? Promise.resolve(false) : false;
    }

    const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AudioCtx) {
      return hasPromise ? Promise.resolve(false) : false;
    }

    if (!this._audioCtx) {
      try {
        this._audioCtx = new AudioCtx();
      } catch (e) {
        return hasPromise ? Promise.resolve(false) : false;
      }
    }

    if (this._audioCtx.state === 'running') {
      const ok = this.ensureWebAudioPipeline();
      return hasPromise ? Promise.resolve(ok) : ok;
    }

    if (typeof this._audioCtx.resume === 'function') {
      try {
        return this._audioCtx.resume().then(
          () => {
            if (this._audioCtx && this._audioCtx.state === 'running') {
              return this.ensureWebAudioPipeline();
            }
            return false;
          },
          () => false
        );
      } catch (e) {
        return hasPromise ? Promise.resolve(false) : false;
      }
    }

    return hasPromise ? Promise.resolve(false) : false;
  }

  _isPowerSaveActive() {
    if (this._isPowerSaveMode) return true;
    if (typeof window !== 'undefined' && window.app && window.app.isPowerSaveMode) return true;
    if (typeof document !== 'undefined' && document.hidden) return true;
    return false;
  }

  setPowerSaveMode(active) {
    this._ensureAvRuntimeState();
    this._isPowerSaveMode = Boolean(active);
    if (this._isPowerSaveMode) {
      this._stopLoudnessSampler();
    } else {
      this._syncLoudnessSamplerState();
    }
  }

  _stopLoudnessSampler() {
    if (this._loudnessSampleTimer) {
      clearInterval(this._loudnessSampleTimer);
      this._loudnessSampleTimer = null;
    }
  }

  _syncLoudnessSamplerState() {
    this._ensureAvRuntimeState();
    const shouldRun = Boolean(
      this._webAudioGraphReady &&
      this._audioCtx &&
      this._audioCtx.state === 'running' &&
      this._analyserNode &&
      this.hls &&
      !this._isNativePlayback &&
      !this._isCleaningUp &&
      !this._isPowerSaveActive() &&
      this.video &&
      !this.video.paused &&
      !this.video.muted &&
      this.video.volume > 0 &&
      !this.userPaused &&
      this._avPrefs.audioNormMode !== 'off'
    );

    if (!shouldRun) {
      this._stopLoudnessSampler();
      return;
    }

    if (!this._loudnessSampleTimer) {
      this._loudnessSampleTimer = setInterval(() => {
        this.sampleChannelLoudness();
      }, PLAYER_LOUDNESS_SAMPLE_MS);
    }
  }

  sampleChannelLoudness() {
    this._ensureAvRuntimeState();
    if (
      !this._webAudioGraphReady ||
      !this._audioCtx ||
      this._audioCtx.state !== 'running' ||
      !this._analyserNode ||
      !this.hls ||
      this._isNativePlayback ||
      this._isCleaningUp ||
      this._isPowerSaveActive() ||
      this._avPrefs.audioNormMode === 'off' ||
      (this.video && (this.video.paused || this.video.muted || this.video.volume === 0 || this.userPaused))
    ) {
      this._stopLoudnessSampler();
      return null;
    }

    const analyser = this._analyserNode;
    const len = analyser.fftSize || 512;
    let sumSq = 0;

    try {
      if (typeof analyser.getFloatTimeDomainData === 'function' && typeof Float32Array === 'function') {
        if (!this._analyserFloatBuf || this._analyserFloatBuf.length !== len) {
          this._analyserFloatBuf = new Float32Array(len);
        }
        analyser.getFloatTimeDomainData(this._analyserFloatBuf);
        for (let i = 0; i < len; i++) {
          const s = this._analyserFloatBuf[i];
          sumSq += s * s;
        }
      } else if (typeof analyser.getByteTimeDomainData === 'function' && typeof Uint8Array === 'function') {
        if (!this._analyserByteBuf || this._analyserByteBuf.length !== len) {
          this._analyserByteBuf = new Uint8Array(len);
        }
        analyser.getByteTimeDomainData(this._analyserByteBuf);
        for (let i = 0; i < len; i++) {
          const s = (this._analyserByteBuf[i] - 128) / 128;
          sumSq += s * s;
        }
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }

    const rms = Math.sqrt(sumSq / len);
    const dbfs = rms > 1e-6 ? (20 * Math.log(rms)) / Math.LN10 : -100;

    // Ignore silence / dead air so we never boost background noise during channel loads
    if (dbfs <= -55) {
      return { dbfs: dbfs, rms: rms, gain: this._currentRmsGain, skipped: true };
    }

    const curve = PLAYER_AUDIO_NORM_CURVES[this._avPrefs.audioNormMode] || PLAYER_AUDIO_NORM_CURVES.gentle;
    const targetDb = curve.targetDb;
    const deltaDb = Math.max(-12, Math.min(12, targetDb - dbfs));
    const idealGain = this._currentRmsGain * Math.pow(10, deltaDb / 20);
    const nextGain = Math.max(0.35, Math.min(2.4, this._currentRmsGain + (idealGain - this._currentRmsGain) * 0.25));

    this._currentRmsGain = nextGain;
    this._lastSampledDb = dbfs;
    if (this._rmsAutoGainNode) {
      this._setAudioParam(this._rmsAutoGainNode.gain, nextGain, 0.12);
    }

    const chId = this._getCurrentChannelId();
    if (chId) {
      const now = Date.now();
      const roundedDb = Math.round(dbfs * 10) / 10;
      const roundedGain = Math.round(nextGain * 1000) / 1000;
      this._loudnessData.learned[chId] = {
        db: roundedDb,
        gain: roundedGain,
        ts: now
      };
      if (
        !this._lastLoudnessPersistMs ||
        this._lastPersistedLoudnessChId !== chId ||
        now - this._lastLoudnessPersistMs >= 1200 ||
        Math.abs(roundedGain - (this._lastPersistedGain || 1.0)) >= 0.03
      ) {
        this._lastLoudnessPersistMs = now;
        this._lastPersistedLoudnessChId = chId;
        this._lastPersistedGain = roundedGain;
        this._saveLoudnessData();
      }
    }

    return { dbfs: dbfs, rms: rms, gain: nextGain, skipped: false };
  }

  isAndroidTvWebView() {
    if (typeof window === 'undefined') return false;
    try {
      return (
        Boolean(window.__IPTV_ANDROID_TV) ||
        Boolean(window.__IPTV_IS_ANDROID_TV) ||
        (window.location && window.location.hostname === 'appassets.androidplatform.net') ||
        Boolean(window.AndroidTvHost)
      );
    } catch (e) {
      return false;
    }
  }

  isTvPlatform() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.__IPTV_IS_TV === true || window.__IPTV_IS_WEBOS === true) return true;
      if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
        if (document.documentElement.classList.contains('tv-platform')) return true;
      }
      if (this.isAndroidTvWebView()) return true;
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      return Boolean(window.webOS || window.webOSSystem || window.PalmSystem) || /Web0S|webOS|LG NetCast/i.test(ua);
    } catch (e) {
      return false;
    }
  }

  loadBufferMode() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(BUFFER_STORAGE_KEY);
        if (saved && BUFFER_PROFILES[saved]) {
          return saved;
        }
      }
    } catch (e) {}
    return 'smart';
  }

  _getEffectiveHlsTuning(isCatchup) {
    this._ensureAvRuntimeState();
    const prof = this.getBufferProfile();
    const av = this._avPrefs;
    const isAndroidTv = this.isAndroidTvWebView();
    const isTv = this.isTvPlatform();

    let maxBufferLength = prof.maxBufferLength;
    let maxMaxBufferLength = prof.maxMaxBufferLength;
    let backBufferLength = prof.backBufferLength;
    let maxBufferSize = 60 * 1000 * 1000;

    if (av.memorySaverMode === 'aggressive') {
      maxBufferLength = Math.min(prof.maxBufferLength, 20);
      maxMaxBufferLength = Math.min(prof.maxMaxBufferLength, 35);
      backBufferLength = Math.min(prof.backBufferLength, 10);
      maxBufferSize = 20 * 1000 * 1000;
    } else if (av.memorySaverMode !== 'off' && isAndroidTv) {
      maxBufferLength = Math.min(prof.maxBufferLength, 24);
      maxMaxBufferLength = Math.min(prof.maxMaxBufferLength, 45);
      backBufferLength = Math.min(prof.backBufferLength, 15);
      maxBufferSize = 30 * 1000 * 1000;
    } else if (av.memorySaverMode !== 'off' && isTv) {
      maxBufferLength = Math.min(prof.maxBufferLength, 32);
      maxMaxBufferLength = Math.min(prof.maxMaxBufferLength, 60);
      backBufferLength = Math.min(prof.backBufferLength, 20);
      maxBufferSize = 40 * 1000 * 1000;
    }

    if (isCatchup && (av.memorySaverMode !== 'off' || isTv)) {
      backBufferLength = Math.min(backBufferLength, 15);
    }

    const isLowLatency = av.streamLatencyMode === 'low';
    const liveSyncDurationCount = isCatchup ? 99999 : (isLowLatency ? 2 : prof.liveSyncDurationCount);
    const liveMaxLatencyDurationCount = isCatchup ? Infinity : (isLowLatency ? 5 : prof.liveMaxLatencyDurationCount);
    const abrEwmaFastLive = isLowLatency ? 1.8 : 2.5;
    const isMaxQuality = av.videoQualityMode === 'max';
    const isSmartQuality = av.videoQualityMode === 'smart';
    const startLevel = isSmartQuality ? 0 : -1;
    const abrEwmaDefaultEstimate = isMaxQuality ? 12000000 : 2500000;

    return {
      maxBufferLength: maxBufferLength,
      maxMaxBufferLength: maxMaxBufferLength,
      backBufferLength: backBufferLength,
      maxBufferSize: maxBufferSize,
      liveSyncDurationCount: liveSyncDurationCount,
      liveMaxLatencyDurationCount: liveMaxLatencyDurationCount,
      abrEwmaFastLive: abrEwmaFastLive,
      startLevel: startLevel,
      abrEwmaDefaultEstimate: abrEwmaDefaultEstimate
    };
  }

  _applyHlsConfigTuning(isCatchup) {
    if (!this.hls) return;
    const tuning = this._getEffectiveHlsTuning(Boolean(isCatchup));
    if (this.hls.config) {
      this.hls.config.maxBufferLength = tuning.maxBufferLength;
      this.hls.config.maxMaxBufferLength = tuning.maxMaxBufferLength;
      this.hls.config.backBufferLength = tuning.backBufferLength;
      this.hls.config.maxBufferSize = tuning.maxBufferSize;
      this.hls.config.liveSyncDurationCount = tuning.liveSyncDurationCount;
      this.hls.config.liveMaxLatencyDurationCount = tuning.liveMaxLatencyDurationCount;
      this.hls.config.abrEwmaFastLive = tuning.abrEwmaFastLive;
      this.hls.config.startLevel = tuning.startLevel;
      this.hls.config.abrEwmaDefaultEstimate = tuning.abrEwmaDefaultEstimate;
    }
    this.hls.startLevel = tuning.startLevel;
  }

  setBufferMode(mode) {
    if (!BUFFER_PROFILES[mode]) return;
    this.bufferMode = mode;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BUFFER_STORAGE_KEY, mode);
      }
    } catch (e) {}

    if (this.hls) {
      this._applyHlsConfigTuning(this._hlsIsCatchup);
    }
    this.applyVideoQualityMode();
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
   * Applies video quality mode ('smart' | 'max' | 'hd1080' | 'hd720') to active HLS levels.
   */
  applyVideoQualityMode() {
    this._ensureAvRuntimeState();
    const qMode = this._avPrefs.videoQualityMode || 'smart';

    if (!this.hls) {
      this.currentQualityTier = qMode === 'smart' ? 'auto' : qMode;
      return;
    }

    const levels = this.hls.levels || [];

    if (qMode === 'max') {
      this.hls.startLevel = -1;
      if (this.hls.config) {
        this.hls.config.startLevel = -1;
        this.hls.config.abrEwmaDefaultEstimate = 12000000;
      }
      this.hls.autoLevelCapping = -1;
      if (levels.length > 0) {
        let maxIdx = levels.length - 1;
        let bestBr = -1;
        for (let i = 0; i < levels.length; i++) {
          const lvl = levels[i] || {};
          const br = typeof lvl.bitrate === 'number' ? lvl.bitrate : 0;
          if (br >= bestBr) {
            bestBr = br;
            maxIdx = i;
          }
        }
        this.hls.nextLevel = maxIdx;
      }
      this.currentQualityTier = 'max-hd';
      return;
    }

    if (qMode === 'hd1080' || qMode === 'hd720') {
      const maxH = qMode === 'hd720' ? 720 : 1080;
      if (levels.length === 0) {
        this.hls.autoLevelCapping = -1;
        this.currentQualityTier = qMode;
        return;
      }
      let capIdx = -1;
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        if (lvl && (!lvl.height || lvl.height <= maxH)) {
          capIdx = i;
        }
      }
      if (capIdx === -1) {
        capIdx = 0;
      }
      this.hls.autoLevelCapping = capIdx;
      if (typeof this.hls.nextLevel === 'number' && this.hls.nextLevel > capIdx) {
        this.hls.nextLevel = -1;
      }
      if (typeof this.hls.currentLevel === 'number' && this.hls.currentLevel > capIdx) {
        this.hls.currentLevel = -1;
      }
      this.currentQualityTier = qMode;
      return;
    }

    // 'smart' Progressive Quality Ramp-Up
    if (levels.length <= 1) {
      this.hls.autoLevelCapping = -1;
      this.currentQualityTier = 'full';
      return;
    }

    const totalLevels = levels.length;
    const maxLevelIdx = totalLevels - 1;
    const midLevelIdx = Math.max(1, Math.ceil(maxLevelIdx / 2));
    const forwardSec = this.getForwardBufferSeconds();

    if (forwardSec < 3.5) {
      // Low buffer: cap to fastest/lightest level (0) so buffer refills rapidly without stalling
      if (this.hls.config) this.hls.config.startLevel = 0;
      this.hls.startLevel = 0;
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

  /**
   * Progressive Quality Ramp-Up (Smart ABR):
   * - Starts channel playback on the lightest/fastest level so the channel opens immediately
   *   and builds initial buffer rapidly.
   * - As forward buffer grows:
   *   * < 3.5s buffer: cap to lower/medium quality so segments download faster and prevent stalls
   *   * 3.5s - 8.5s buffer: allow up to medium-high quality
   *   * >= 8.5s buffer: uncap completely (-1 = Full HD 1080p / highest quality)
   * - Respects explicit videoQualityMode caps ('max', 'hd1080', 'hd720').
   */
  updateProgressiveQualityByBuffer() {
    this.applyVideoQualityMode();
  }

  getStreamStats() {
    this._ensureAvRuntimeState();
    let width = 0;
    let height = 0;
    let bitrateKbps = 0;

    if (this.video) {
      if (typeof this.video.videoWidth === 'number' && this.video.videoWidth > 0) {
        width = this.video.videoWidth;
      }
      if (typeof this.video.videoHeight === 'number' && this.video.videoHeight > 0) {
        height = this.video.videoHeight;
      }
    }

    if (this.hls && this.hls.levels && this.hls.levels.length > 0) {
      let lvlIdx = typeof this.hls.currentLevel === 'number' && this.hls.currentLevel >= 0
        ? this.hls.currentLevel
        : (typeof this.hls.loadLevel === 'number' && this.hls.loadLevel >= 0
          ? this.hls.loadLevel
          : (typeof this.hls.nextLevel === 'number' && this.hls.nextLevel >= 0 ? this.hls.nextLevel : -1));
      const lvl = lvlIdx >= 0 ? this.hls.levels[lvlIdx] : null;
      if (lvl) {
        if (!width && typeof lvl.width === 'number' && lvl.width > 0) width = lvl.width;
        if (!height && typeof lvl.height === 'number' && lvl.height > 0) height = lvl.height;
        if (typeof lvl.bitrate === 'number' && lvl.bitrate > 0) {
          bitrateKbps = Math.round(lvl.bitrate / 1000);
        }
      }
    }

    const bufferSec = Math.round(this.getForwardBufferSeconds() * 10) / 10;
    const normGain = this._getAppliedNormGainLinear();
    let appliedGainDb = Math.round(((20 * Math.log(Math.max(0.01, normGain))) / Math.LN10) * 10) / 10;
    if (appliedGainDb === 0) appliedGainDb = 0;

    return {
      width: width,
      height: height,
      bitrateKbps: bitrateKbps,
      bufferSec: bufferSec,
      qualityTier: this.currentQualityTier || 'auto',
      audioNormMode: this._avPrefs.audioNormMode || 'off',
      appliedGainDb: appliedGainDb,
      channelTrimDb: this.getChannelVolumeTrim(),
      isNative: Boolean(this._isNativePlayback),
      isPaused: this.isPaused()
    };
  }

  initListeners() {
    if (!this.video || typeof this.video.addEventListener !== 'function') return;

    this.video.addEventListener('loadstart', () => {
      this._isPlaying = false;
      this.triggerState('loading');
    });

    this.video.addEventListener('waiting', () => {
      this._isPlaying = false;
      this.triggerState('buffering');
      // If buffer runs low during playback, immediately allow faster lower-bitrate segment fetch
      this.updateProgressiveQualityByBuffer();
    });

    this.video.addEventListener('playing', () => {
      this.retryCount = 0;
      this._mediaRecoveryAttempts = 0;
      this._stallRecoveryAttempts = 0;
      this.stallTicks = 0;
      this.userPaused = false;
      this._isPlaying = true;
      this.applyEffectiveVolume();
      this._syncLoudnessSamplerState();
      this.triggerState('playing');
    });

    this.video.addEventListener('timeupdate', () => {
      if (this.video && this.video.currentTime > 0 && !this.video.paused) {
        this._stallRecoveryAttempts = 0;
        if (!this._isPlaying) {
          this.retryCount = 0;
          this._mediaRecoveryAttempts = 0;
          this.stallTicks = 0;
          this.userPaused = false;
          this._isPlaying = true;
          this._syncLoudnessSamplerState();
          this.triggerState('playing');
        }
      }
    });

    this.video.addEventListener('volumechange', () => {
      if (!this.video) return;
      if (this.video.muted || this.video.volume === 0) {
        this._stopLoudnessSampler();
      } else {
        this._syncLoudnessSamplerState();
      }
    });

    this.video.addEventListener('pause', () => {
      this._isPlaying = false;
      this._stopLoudnessSampler();
      if (this.userPaused) {
        this.triggerState('paused');
      }
    });

    this.video.addEventListener('stalled', () => {
      this.updateProgressiveQualityByBuffer();
      this.nudgeIfBufferedAhead();
    });

    this.video.addEventListener('ended', () => {
      this._stopLoudnessSampler();
      if (this.currentProgramme) {
        this.handleCatchupStreamBoundary(true);
      }
    });

    this.video.addEventListener('error', () => {
      this._stopLoudnessSampler();
      if (this._isCleaningUp || !this.currentChannel) return;
      this._isPlaying = false;
      if (this.currentProgramme && this.currentChannel) {
        this.currentProgramme = null;
        this.catchupOriginStartMs = 0;
        this._streamCatchupOriginMs = 0;
        this._pendingCatchupTargetMs = 0;
        this.play(this.currentChannel);
        return;
      }
      this.handlePlaybackError('השידור אינו זמין כעת בערוץ זה');
    });
  }

  isCatchupActive() {
    return Boolean(this.currentProgramme);
  }

  getCurrentCatchupBroadcastMs() {
    if (this._catchupSeekDebounceTimer && this._pendingCatchupTargetMs > 0) {
      return this._pendingCatchupTargetMs;
    }
    const origin =
      this._streamCatchupOriginMs ||
      this.catchupOriginStartMs ||
      (this.currentProgramme && this.currentProgramme.startMs) ||
      Date.now();
    const curSec = this.video && isFinite(this.video.currentTime) ? this.video.currentTime : 0;
    return origin + Math.max(0, Math.floor(curSec * 1000));
  }

  /**
   * Handles catchup stream termination or programme boundary crossing:
   * - Reloads archive stream if a live Start-Over hit an early archive ENDLIST mid-show
   * - Advances to the next programme seamlessly when the current catchup show ends
   * - Exits cleanly back to live once catchup reaches real-time broadcast
   */
  handleCatchupStreamBoundary(streamEnded) {
    if (!this.currentProgramme || !this.currentChannel) return;
    const now = Date.now();
    if (now - (this._lastBoundaryCheckMs || 0) < 2500) return;
    this._lastBoundaryCheckMs = now;

    const reachedMs = this.getCurrentCatchupBroadcastMs();

    // Case A: Mid-programme live archive continuation
    if (
      streamEnded &&
      this.currentProgramme.stopMs &&
      reachedMs < this.currentProgramme.stopMs - 4000 &&
      reachedMs < Date.now() - 4000
    ) {
      this.playProgrammeStartOver(this.currentChannel, this.currentProgramme, reachedMs);
      return;
    }

    // Case B: Transition to Next Programme when current programme finishes
    const afterMs = Math.max(reachedMs, this.currentProgramme.stopMs || reachedMs);
    const nextProg = this.callbacks.getNextProgramme
      ? this.callbacks.getNextProgramme(this.currentChannel, this.currentProgramme, afterMs)
      : null;

    const isDifferentProg = Boolean(
      nextProg &&
        (nextProg.id && this.currentProgramme.id
          ? nextProg.id !== this.currentProgramme.id
          : nextProg.startMs !== this.currentProgramme.startMs)
    );

    if (isDifferentProg && nextProg.startMs <= Date.now() - 2000) {
      this.currentProgramme = nextProg;
      const nearEnd = Boolean(
        streamEnded ||
          (this.video &&
            (this.video.ended ||
              (isFinite(this.video.duration) &&
                this.video.duration > 0 &&
                this.video.duration - this.video.currentTime <= 2.5)))
      );
      if (nearEnd) {
        this.playProgrammeStartOver(this.currentChannel, nextProg, nextProg.startMs);
      }
      if (this.callbacks.onProgrammeChanged) {
        this.callbacks.onProgrammeChanged(this.currentChannel, nextProg);
      }
    } else if (reachedMs >= Date.now() - 4000) {
      // Catchup caught up to live!
      this.exitStartOverToLive();
      if (this.callbacks.onProgrammeChanged) {
        this.callbacks.onProgrammeChanged(this.currentChannel, null);
      }
    }
  }

  /**
   * Periodic loop (every 2s):
   * 1. Adjusts Progressive Quality Ramp-Up (Smart ABR) based on accumulated buffer
   * 2. Fast stall-recovery watchdog: currentTime nudge -> recoverMediaError with exponential backoff -> clean reload
   */
  startWatchdogAndQualityRamp() {
    clearInterval(this.watchdogInterval);
    this.watchdogInterval = setInterval(() => {
      if (!this.video || !this.currentChannel || this.userPaused || this._isPowerSaveActive()) {
        this.stallTicks = 0;
        this._stopLoudnessSampler();
        return;
      }

      if (this.video.paused) {
        if (this.currentProgramme && this.video.ended) {
          this.handleCatchupStreamBoundary(true);
        }
        this.stallTicks = 0;
        this._stopLoudnessSampler();
        return;
      }

      // Smoothly ramp quality up/down as buffer accumulates
      this.updateProgressiveQualityByBuffer();

      // Hardware Audio Watchdog: prevent silent muted drop without clobbering trim or zap fade
      if (this.video && !this.userPaused) {
        if (this.video.muted) {
          this.video.muted = false;
        }
        this.applyEffectiveVolume();
      }

      const ct = this.video.currentTime || 0;
      if (Math.abs(ct - this.lastWatchdogTime) < 0.01) {
        this.stallTicks++;
      } else {
        this.stallTicks = 0;
        this._stallRecoveryAttempts = 0;
      }
      this.lastWatchdogTime = ct;

      if (this.currentProgramme && !this.userPaused) {
        const broadcastMs = this.getCurrentCatchupBroadcastMs();
        if (this.currentProgramme.stopMs && broadcastMs >= this.currentProgramme.stopMs) {
          this.handleCatchupStreamBoundary(false);
        } else if (
          this.video &&
          isFinite(this.video.duration) &&
          this.video.duration > 10 &&
          this.video.duration - ct <= 1.8 &&
          this.stallTicks >= 1
        ) {
          this.handleCatchupStreamBoundary(true);
        }
      }

      if (this.stallTicks === 2) {
        this.nudgeIfBufferedAhead(true);
      } else if (this.stallTicks >= 3) {
        const nudged = this.nudgeIfBufferedAhead(true);
        if (this.hls) {
          const now = Date.now();
          const attempt = this._stallRecoveryAttempts || 0;
          const backoffMs = Math.min(12000, 1500 * Math.pow(2, attempt));
          if (!nudged && now - (this._lastStallRecoveryMs || 0) >= backoffMs) {
            this._lastStallRecoveryMs = now;
            if (attempt < 2) {
              this._stallRecoveryAttempts = attempt + 1;
              try {
                if (attempt === 1 && typeof this.hls.swapAudioCodec === 'function') {
                  this.hls.swapAudioCodec();
                }
                this.hls.recoverMediaError();
                this.hls.startLoad();
              } catch (e) {}
            } else {
              this._stallRecoveryAttempts = 0;
              const activeUrl = (this._currentUrl || (this.currentChannel && this.currentChannel.url) || '').trim();
              if (activeUrl && !this._isNativePlayback) {
                this.cleanUp();
                this.playHls(activeUrl, false);
              }
            }
          } else {
            try {
              this.hls.startLoad();
            } catch (e) {}
          }
        }
        this.stallTicks = 0;
      }
    }, 2000);
  }

  nudgeIfBufferedAhead(allowIntraRangeNudge) {
    if (!this.video || this.userPaused) return false;
    try {
      const buffered = this.video.buffered;
      const cur = this.video.currentTime || 0;
      if (buffered && buffered.length > 0) {
        for (let i = 0; i < buffered.length; i++) {
          const start = buffered.start(i);
          const end = buffered.end(i);
          // Jump over an unbuffered hole directly ahead of currentTime
          if (start > cur + 0.1 && start - cur < 4.5 && end > start + 0.5) {
            this.video.currentTime = start + 0.15;
            this.video.muted = false;
            this.applyEffectiveVolume();
            const p = this.video.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return true;
          }
          // Skip a corrupt/stalled keyframe inside an active buffered range
          if (allowIntraRangeNudge && cur >= start - 0.1 && end - cur >= 0.75) {
            this.video.currentTime = cur + 0.25;
            const p2 = this.video.play();
            if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  triggerState(state) {
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(state, this.currentChannel);
    }
  }

  clearTimers() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    clearTimeout(this._networkRetryTimer);
    this._networkRetryTimer = null;
    clearTimeout(this._unmuteTimer);
    this._unmuteTimer = null;
    clearTimeout(this._catchupSeekDebounceTimer);
    this._catchupSeekDebounceTimer = null;
    this._pendingCatchupTargetMs = 0;
    this._cancelZapFade();
    this._zapFadeFactor = 1.0;
  }

  safePlayWithUnmute() {
    if (!this.video) return;
    const playPromise = this.video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (!this.video || this.userPaused) return;
        this.video.muted = true;
        this.video
          .play()
          .then(() => {
            clearTimeout(this._unmuteTimer);
            this._unmuteTimer = setTimeout(() => {
              this._unmuteTimer = null;
              if (this.video && !this.userPaused) {
                this.video.muted = false;
                this.applyEffectiveVolume();
              }
            }, 100);
          })
          .catch(() => {
            if (this.video && !this.userPaused) {
              this.video.muted = false;
              this.applyEffectiveVolume();
            }
          });
      });
    }
  }

  /**
   * Injects/reuses a single lightweight <link rel="preconnect"> hint for the active stream origin
   * to shave TCP/TLS handshake latency across channel switches without accumulating DOM nodes.
   */
  preconnectStreamOrigin(streamUrl) {
    if (typeof document === 'undefined' || !document.head || !streamUrl || typeof streamUrl !== 'string') {
      return '';
    }
    const m = streamUrl.match(/^(https?:\/\/[^\/?#]+)/i);
    if (!m || !m[1]) return '';
    const origin = m[1];
    if (origin.indexOf('appassets.androidplatform.net') !== -1) return '';
    if (this._lastPreconnectOrigin === origin) return origin;
    this._lastPreconnectOrigin = origin;

    try {
      let link = this._preconnectLinkEl || document.getElementById('zenplay-stream-preconnect');
      if (!link) {
        link = document.createElement('link');
        link.id = 'zenplay-stream-preconnect';
        link.rel = 'preconnect';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      }
      this._preconnectLinkEl = link;
      if (link.href !== origin) {
        link.href = origin;
      }
    } catch (e) {}
    return origin;
  }

  play(channel, customStreamUrl) {
    if (!channel || !channel.url) return;
    this._ensureAvRuntimeState();
    this._stopLoudnessSampler();

    this.currentChannel = channel;
    if (!customStreamUrl) {
      this.currentProgramme = null;
      this.catchupOriginStartMs = 0;
      this._streamCatchupOriginMs = 0;
      this._pendingCatchupTargetMs = 0;
    }
    this.usedNativeFallback = false;
    this._isNativePlayback = false;
    this._isPlaying = false;
    this.userPaused = false;
    this.retryCount = 0;
    this._mediaRecoveryAttempts = 0;
    this._stallRecoveryAttempts = 0;
    this._lastStallRecoveryMs = 0;
    this.stallTicks = 0;
    this.lastWatchdogTime = -1;

    const chId = this._getChannelLoudnessId(channel);
    if (this._avPrefs.audioNormMode !== 'off' && chId) {
      this._currentRmsGain = this._getChannelLearnedGain(chId);
      const learnedEntry = this._loudnessData && this._loudnessData.learned ? this._loudnessData.learned[chId] : null;
      if (learnedEntry) {
        learnedEntry.ts = Date.now();
      }
    } else {
      this._currentRmsGain = 1.0;
    }

    const url = (customStreamUrl || channel.url).trim();
    this._currentUrl = url;
    this.preconnectStreamOrigin(url);
    const isHls = url.indexOf('.m3u8') !== -1 || url.indexOf('m3u8') !== -1;
    const isCatchup = Boolean(customStreamUrl && this.currentProgramme) || url.indexOf('utc=') !== -1;
    const hasHlsLib = typeof window !== 'undefined' && Boolean(window.Hls && window.Hls.isSupported());
    const canReuseHls = Boolean(
      isHls &&
      hasHlsLib &&
      this.hls &&
      this._hlsIsCatchup === isCatchup
    );

    if (canReuseHls) {
      // Fast zap: reuse existing Hls + MediaSource instance without tearing down ALSA/MSE
      this.clearTimers();
    } else {
      this.cleanUp();
    }

    if (this._webAudioGraphReady) {
      this._updateWebAudioParams();
    }

    if (this.video) {
      this.video.muted = false;
    }
    this.startSoftZapFade();

    this.triggerState('loading');

    if (hasHlsLib && isHls) {
      this.playHls(url, canReuseHls);
    } else {
      this.playNative(url);
    }

    if (this.callbacks.onChannelLoaded) {
      this.callbacks.onChannelLoaded(channel);
    }
  }

  playProgrammeStartOver(channel, programme, customStartMs) {
    if (!channel) return;
    if (!programme) {
      this.startOver();
      return;
    }

    const originStartMs =
      typeof customStartMs === 'number' && customStartMs > 0
        ? customStartMs
        : programme && programme.startMs
        ? programme.startMs
        : Date.now();

    this.currentProgramme = programme;
    this.catchupOriginStartMs = originStartMs;
    this._streamCatchupOriginMs = originStartMs;
    this._pendingCatchupTargetMs = 0;

    const catchupUrl = this.buildCatchupUrl(channel, programme, originStartMs);

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

  buildCatchupUrl(channel, programme, customStartMs) {
    if (!channel || !channel.url || !programme || !programme.startMs) {
      return channel ? channel.url : '';
    }

    const effectiveStartMs =
      typeof customStartMs === 'number' && customStartMs > 0 ? customStartMs : programme.startMs;
    const startUnix = Math.floor(effectiveStartMs / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    const progStopUnix = programme.stopMs ? Math.floor(programme.stopMs / 1000) : startUnix + 7200;
    const stopUnix = Math.max(startUnix + 60, progStopUnix);
    const lutcUnix = Math.max(nowUnix, stopUnix);
    const durationSec = Math.max(60, stopUnix - startUnix);
    const offsetSec = Math.max(0, nowUnix - startUnix);

    if (channel.catchupSource) {
      return channel.catchupSource
        .replace(/\$\{start\}|\{utc\}|\{start\}/gi, String(startUnix))
        .replace(/\$\{stop\}/gi, String(stopUnix))
        .replace(/\{lutc\}|\{timestamp\}|\$\{now\}|\{now\}/gi, String(lutcUnix))
        .replace(/\$\{duration\}|\{duration\}/gi, String(durationSec))
        .replace(/\$\{offset\}|\{offset\}/gi, String(offsetSec));
    }

    const sep = channel.url.indexOf('?') === -1 ? '?' : '&';
    return channel.url + sep + 'utc=' + startUnix + '&lutc=' + lutcUnix;
  }

  playHls(url, reuseExisting) {
    try {
      this._ensureAvRuntimeState();
      const isCatchup = Boolean(this.currentProgramme || (url && url.indexOf('utc=') !== -1));
      this._hlsIsCatchup = isCatchup;

      if (reuseExisting && this.hls) {
        this._hlsReused = true;
        this.hls.stopLoad();
        this._applyHlsConfigTuning(isCatchup);
        this.applyVideoQualityMode();
        if (this._audioCtx && this._audioCtx.state === 'running' && (this._avPrefs.audioNormMode !== 'off' || this._avPrefs.audioVoiceBoost)) {
          this.ensureWebAudioPipeline();
        }
        this.hls.loadSource(url);
        return;
      }

      this._hlsReused = false;
      const tuning = this._getEffectiveHlsTuning(isCatchup);
      const hlsConfig = {
        enableWorker: false,
        // For Start-Over / Catch-up, begin playback from the start of the event
        startPosition: isCatchup ? 0 : -1,
        // Progressive Quality Ramp-Up / Quality Mode start level
        startLevel: tuning.startLevel,
        capLevelToPlayerSize: false,
        // Audio Synchronization & Codec Support
        maxAudioFramesDrift: 1,
        forceKeyFrameOnDiscontinuity: true,
        // Buffer & Memory Configuration
        maxBufferLength: tuning.maxBufferLength,
        maxMaxBufferLength: tuning.maxMaxBufferLength,
        backBufferLength: tuning.backBufferLength,
        maxBufferSize: tuning.maxBufferSize,
        liveSyncDurationCount: tuning.liveSyncDurationCount,
        liveMaxLatencyDurationCount: tuning.liveMaxLatencyDurationCount,
        lowLatencyMode: false,
        // Discontinuity & Hole Healing
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 10,
        maxFragLookUpTolerance: 0.5,
        // Progressive ABR Tuning
        abrEwmaFastLive: tuning.abrEwmaFastLive,
        abrEwmaSlowLive: 6.0,
        abrEwmaDefaultEstimate: tuning.abrEwmaDefaultEstimate,
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
      };
      this.hls = new window.Hls(hlsConfig);

      const hlsInstance = this.hls;
      hlsInstance.attachMedia(this.video);
      hlsInstance.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        if (this.hls === hlsInstance && this._currentUrl) {
          hlsInstance.loadSource(this._currentUrl);
        }
      });

      hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (this.hls !== hlsInstance) return;
        if (this._hlsIsCatchup && this.video) {
          try {
            this.video.currentTime = 0;
          } catch (e) {}
        }
        // Initialize quality mode / progressive cap
        this.applyVideoQualityMode();
        if (this._audioCtx && this._audioCtx.state === 'running' && (this._avPrefs.audioNormMode !== 'off' || this._avPrefs.audioVoiceBoost)) {
          this.ensureWebAudioPipeline();
        }
        this.safePlayWithUnmute();
      });

      // Ensure audio track is always active and unmuted without clobbering trim/fade
      hlsInstance.on(window.Hls.Events.AUDIO_TRACK_LOADED, () => {
        if (this.hls !== hlsInstance) return;
        if (this.video && !this.userPaused) {
          this.video.muted = false;
          this.applyEffectiveVolume();
        }
      });

      hlsInstance.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, () => {
        if (this.hls !== hlsInstance) return;
        if (this.video && !this.userPaused) {
          this.video.muted = false;
          this.applyEffectiveVolume();
        }
      });

      hlsInstance.on(window.Hls.Events.FRAG_BUFFERED, () => {
        if (this.hls !== hlsInstance) return;
        this.retryCount = 0;
        // Every time a segment finishes buffering, re-evaluate if we have enough buffer to step up quality!
        this.updateProgressiveQualityByBuffer();
      });

      hlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data || this.hls !== hlsInstance) return;

        if (!data.fatal) {
          if (data.details === window.Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            this.updateProgressiveQualityByBuffer();
            this.nudgeIfBufferedAhead(true);
          } else if (data.details === window.Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE) {
            this.nudgeIfBufferedAhead(false);
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

        const activeUrl = this._currentUrl || url;

        // Fatal error recovery pipeline
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.retryCount < this.maxRetries && this.hls) {
            const attempt = this.retryCount++;
            const delay = attempt === 0 ? 0 : Math.min(4800, 600 * Math.pow(2, attempt - 1));
            clearTimeout(this._networkRetryTimer);
            if (delay === 0) {
              this.hls.startLoad();
            } else {
              this._networkRetryTimer = setTimeout(() => {
                if (this.hls === hlsInstance) this.hls.startLoad();
              }, delay);
            }
            return;
          }
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          const now = Date.now();
          if (this.hls && this._mediaRecoveryAttempts < 2) {
            const mediaBackoffMs = 1500 * Math.pow(2, this._mediaRecoveryAttempts);
            if (now - this.lastMediaRecoveryMs < mediaBackoffMs) {
              // Recovery was just triggered; avoid tearing down HLS prematurely
              return;
            }
            this.lastMediaRecoveryMs = now;
            this._mediaRecoveryAttempts++;
            console.warn('Media/Audio decode error, recovering media pipeline (attempt ' + this._mediaRecoveryAttempts + ')...');
            if (this._mediaRecoveryAttempts === 2 && typeof this.hls.swapAudioCodec === 'function') {
              this.hls.swapAudioCodec();
            }
            this.hls.recoverMediaError();
            if (this.video && !this.userPaused) {
              this.video.muted = false;
              this.applyEffectiveVolume();
            }
            return;
          }
        }

        // If a reused HLS instance hit an unrecoverable codec/MSE error, retry once with a fresh Hls instance
        if (this._hlsReused && !this.usedNativeFallback && !this._isNativePlayback) {
          this._hlsReused = false;
          this.retryCount = 0;
          this._mediaRecoveryAttempts = 0;
          this.cleanUp();
          this.playHls(activeUrl, false);
          return;
        }

        if (!this.usedNativeFallback && !this._isNativePlayback) {
          this.usedNativeFallback = true;
          this.cleanUp();
          this.playNative(activeUrl);
        } else {
          this.handlePlaybackError('שגיאה בטעינת השידור');
        }
      });
    } catch (err) {
      if (!this.usedNativeFallback && !this._isNativePlayback) {
        this.usedNativeFallback = true;
        this.cleanUp();
        this.playNative(this._currentUrl || url);
      } else {
        this.handlePlaybackError('שגיאה בטעינת השידור');
      }
    }
  }

  playNative(url) {
    if (this._enteringNative) return;
    if (!url) {
      this.handlePlaybackError('שגיאה בהפעלת הנגן');
      return;
    }
    this._enteringNative = true;
    try {
      this._isNativePlayback = true;
      this._isPlaying = false;
      this._stopLoudnessSampler();
      this.video.src = url;
      this.video.load();
      this.video.muted = false;
      this.applyEffectiveVolume();
      this.safePlayWithUnmute();
    } catch (e) {
      this.handlePlaybackError('שגיאה בהפעלת הנגן');
    } finally {
      this._enteringNative = false;
    }
  }

  handlePlaybackError() {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      this.triggerState('retrying');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (this.currentChannel) {
          const targetUrl = (this._currentUrl || this.currentChannel.url || '').trim();
          const isHls = targetUrl.indexOf('.m3u8') !== -1 || targetUrl.indexOf('m3u8') !== -1;
          const hasHlsLib = typeof window !== 'undefined' && Boolean(window.Hls && window.Hls.isSupported());
          if (isHls && hasHlsLib && !this.usedNativeFallback) {
            this.cleanUp();
            this.playHls(targetUrl, false);
          } else {
            this.playNative(targetUrl);
          }
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
      this.applyEffectiveVolume();
      this.resumeAudioPipeline();
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      this._syncLoudnessSamplerState();
      this.triggerState('playing');
      return false;
    } else {
      this.userPaused = true;
      this._stopLoudnessSampler();
      this.video.pause();
      this.triggerState('paused');
      return true;
    }
  }

  isPaused() {
    return this.video ? Boolean(this.video.paused) : false;
  }

  seekCatchup(deltaSeconds) {
    if (!this.currentProgramme || !this.currentChannel) return 0;
    const streamOrigin =
      this._streamCatchupOriginMs ||
      this.catchupOriginStartMs ||
      this.currentProgramme.startMs ||
      Date.now();
    if (!this._streamCatchupOriginMs) {
      this._streamCatchupOriginMs = streamOrigin;
    }

    const curBroadcastMs = this.getCurrentCatchupBroadcastMs();
    const minMs = this.currentProgramme.startMs || streamOrigin;
    const maxMs = Math.max(
      minMs,
      Math.min(this.currentProgramme.stopMs || Date.now(), Date.now() - 3000)
    );
    const targetBroadcastMs = Math.max(
      minMs,
      Math.min(maxMs, curBroadcastMs + deltaSeconds * 1000)
    );
    const targetOffsetSec = (targetBroadcastMs - streamOrigin) / 1000;

    let maxSeek = 0;
    try {
      if (this.video && this.video.seekable && this.video.seekable.length > 0) {
        const end = this.video.seekable.end(this.video.seekable.length - 1);
        if (isFinite(end) && end > 0) {
          maxSeek = end;
        }
      }
    } catch (e) {}

    if (targetOffsetSec >= 0 && (maxSeek <= 0 || targetOffsetSec <= maxSeek - 0.5)) {
      clearTimeout(this._catchupSeekDebounceTimer);
      this._catchupSeekDebounceTimer = null;
      this._pendingCatchupTargetMs = 0;
      this.catchupOriginStartMs = streamOrigin;
      if (this.video) {
        this.video.currentTime = targetOffsetSec;
      }
      return targetOffsetSec;
    }

    this.catchupOriginStartMs = targetBroadcastMs;
    this._pendingCatchupTargetMs = targetBroadcastMs;
    clearTimeout(this._catchupSeekDebounceTimer);
    this._catchupSeekDebounceTimer = setTimeout(() => {
      this._catchupSeekDebounceTimer = null;
      this._pendingCatchupTargetMs = 0;
      if (this.currentChannel && this.currentProgramme) {
        this.playProgrammeStartOver(this.currentChannel, this.currentProgramme, targetBroadcastMs);
      }
    }, 220);

    return targetOffsetSec;
  }

  rewind(seconds) {
    const sec = Math.abs(seconds || 30);
    if (!this.video) return 0;
    try {
      if (this.currentProgramme) {
        return this.seekCatchup(-sec);
      }
      const target = Math.max(0, (this.video.currentTime || 0) - sec);
      this.video.currentTime = target;
      return target;
    } catch (e) {
      return 0;
    }
  }

  fastForward(seconds) {
    const sec = Math.abs(seconds || 30);
    if (!this.video) return 0;
    try {
      if (this.currentProgramme) {
        return this.seekCatchup(sec);
      }
      let target = (this.video.currentTime || 0) + sec;
      if (this.video.seekable && this.video.seekable.length > 0) {
        const maxSeek = this.video.seekable.end(this.video.seekable.length - 1);
        if (isFinite(maxSeek) && maxSeek > 0) {
          target = Math.min(target, Math.max(0, maxSeek - 1));
        }
      }
      this.video.currentTime = target;
      return target;
    } catch (e) {
      return 0;
    }
  }

  getPlaybackInfo() {
    if (this.currentProgramme) {
      const broadcastMs = this.getCurrentCatchupBroadcastMs();
      const startMs =
        this.currentProgramme.startMs ||
        (this.currentProgramme.start ? new Date(this.currentProgramme.start).getTime() : 0) ||
        this.catchupOriginStartMs ||
        0;
      const stopMs =
        this.currentProgramme.stopMs ||
        (this.currentProgramme.stop ? new Date(this.currentProgramme.stop).getTime() : 0) ||
        (startMs + 3600000);
      const currentTime = Math.max(0, (broadcastMs - startMs) / 1000);
      const duration = Math.max(1, (stopMs - startMs) / 1000);
      return {
        currentTime,
        duration,
        broadcastMs,
        isCatchup: true,
        programme: this.currentProgramme,
        isPaused: Boolean(this.video && this.video.paused)
      };
    }

    const currentTime = this.video && isFinite(this.video.currentTime) ? this.video.currentTime : 0;
    let duration = 0;
    if (this.video && isFinite(this.video.duration) && this.video.duration > 0) {
      duration = this.video.duration;
    }
    return {
      currentTime,
      duration,
      broadcastMs: Date.now(),
      isCatchup: false,
      programme: null,
      isPaused: Boolean(this.video && this.video.paused)
    };
  }

  exitStartOverToLive() {
    if (!this.currentChannel) return false;
    this.currentProgramme = null;
    this.catchupOriginStartMs = 0;
    this._streamCatchupOriginMs = 0;
    this._pendingCatchupTargetMs = 0;
    this.play(this.currentChannel);
    return true;
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
    this._isCleaningUp = true;
    try {
      this._stopLoudnessSampler();
      this.clearTimers();
      this._hlsReused = false;
      this._hlsIsCatchup = false;
      this._isNativePlayback = false;
      this._isPlaying = false;
      const hadHls = Boolean(this.hls);
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
          const hadMediaAttached = Boolean(
            hadHls ||
              this.video.currentSrc ||
              this.video.src ||
              (typeof this.video.getAttribute === 'function' && this.video.getAttribute('src')) ||
              this.video.srcObject
          );
          if (hadMediaAttached) {
            this.video.pause();
            this.video.removeAttribute('src');
            if (this.video.srcObject) this.video.srcObject = null;
            this.video.load(); // Forces webOS/Android TV to release hardware decoder pipeline only when media was attached
          }
          this.video.muted = false;
          this.applyEffectiveVolume();
        } catch (e) {}
      }
    } finally {
      this._isCleaningUp = false;
    }
  }

  destroy() {
    clearInterval(this.watchdogInterval);
    this.watchdogInterval = null;
    this._stopLoudnessSampler();
    this.cleanUp();
    if (this._audioCtx) {
      try {
        if (typeof this._audioCtx.close === 'function' && this._audioCtx.state !== 'closed') {
          const p = this._audioCtx.close();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) {}
    }
    this._audioCtx = null;
    this._mediaSourceNode = null;
    this._mediaSourceVideo = null;
    this._highPassFilter = null;
    this._voiceBoostFilter = null;
    this._rmsAutoGainNode = null;
    this._compressorNode = null;
    this._makeupGainNode = null;
    this._analyserNode = null;
    this._analyserFloatBuf = null;
    this._analyserByteBuf = null;
    this._webAudioGraphReady = false;
    this.currentChannel = null;
    this.currentProgramme = null;
    this.catchupOriginStartMs = 0;
    this._streamCatchupOriginMs = 0;
    this._pendingCatchupTargetMs = 0;
  }

  /**
   * Recovers audio pipeline on webOS if audio was dropped by sleep, standby,
   * HDMI input switch, or browser autoplay policy lock.
   */
  recoverAudioSink() {
    if (!this.video) return;
    try {
      this.video.muted = false;
      this.applyEffectiveVolume();
      if (this._audioCtx && this._audioCtx.state === 'suspended') {
        this.resumeAudioPipeline();
      }
      // Only trigger HLS media recovery when the pipeline is actually errored or stalled,
      // avoiding unnecessary MSE SourceBuffer flushes on normal focus/visibility changes.
      if (this.hls && (this.video.error || this.video.readyState < 2 || this.stallTicks >= 2)) {
        try {
          this.hls.recoverMediaError();
        } catch (e) {}
      }
      if (!this.userPaused && this.currentChannel && this.video.paused) {
        const p = this.video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (!this.video || this.userPaused) return;
            this.video.muted = false;
            this.applyEffectiveVolume();
            this.video.play().catch(() => {});
          });
        }
      }
      this._syncLoudnessSamplerState();
    } catch (e) {
      console.warn('recoverAudioSink notice:', e);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoPlayer;
}
