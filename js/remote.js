/**
 * High-Performance Remote Control Manager for LG webOS TV
 * - Single-listener capture architecture (prevents double-jump)
 * - Center Button (OK / Enter) = Play/Pause in Fullscreen, Confirm/Select in menus
 * - Yellow Button (405) = Open 7-Day Channel Program Guide
 */
class RemoteController {
  constructor(app) {
    this.app = app;
    this.numberBuffer = '';
    this.numberTimer = null;

    this.lastKeyCode = 0;
    this.lastKeySig = null;
    this.lastKeyTime = 0;
    this.lastBackTime = 0;

    this._heldSeekKey = null;
    this._seekRepeatTimer = null;
    this._okDownTime = 0;
    this._okLongPressTimer = null;
    this._okLongPressFired = false;

    this.bindEvents();
    this.exposeAndroidTVBridge();
    this.ensureFocus();
  }

  ensureFocus() {
    try {
      window.focus();
      if (
        document.body &&
        document.activeElement !== document.body &&
        (!document.activeElement || document.activeElement.tagName !== 'INPUT')
      ) {
        document.body.focus();
      }
    } catch (e) {}
  }

  exposeAndroidTVBridge() {
    if (typeof window === 'undefined') return;
    window.AndroidTVBridge = {
      dispatchKey: (action) => this.dispatchAndroidAction(action)
    };
  }

  dispatchAndroidAction(action) {
    if (!this.app || !action) return false;
    const act = String(action).toLowerCase();

    if (/^[0-9]$/.test(act)) {
      this.unlockAudioOnGesture();
      this.handleNumberKey(act);
      return true;
    }

    switch (act) {
      case 'up':
        this.unlockAudioOnGesture();
        this.app.navigate('up');
        return true;
      case 'down':
        this.unlockAudioOnGesture();
        this.app.navigate('down');
        return true;
      case 'left':
        this.unlockAudioOnGesture();
        this.app.navigate('left');
        return true;
      case 'right':
        this.unlockAudioOnGesture();
        this.app.navigate('right');
        return true;
      case 'ok':
        this.unlockAudioOnGesture();
        this.confirmOrSelectOk();
        return true;
      case 'back':
        this.app.handleBack();
        return true;
      case 'red':
        this.unlockAudioOnGesture();
        this.app.onRedButton();
        return true;
      case 'green':
      case 'rewind':
        this.unlockAudioOnGesture();
        this.app.onGreenButton();
        return true;
      case 'yellow':
        this.app.onYellowButton();
        return true;
      case 'blue':
      case 'fast_forward':
        this.unlockAudioOnGesture();
        this.app.onBlueButton();
        return true;
      case 'play_pause':
        this.unlockAudioOnGesture();
        this.app.togglePlayPause();
        return true;
      case 'ch_up':
        this.unlockAudioOnGesture();
        this.app.changeChannelByOffset(1);
        return true;
      case 'ch_down':
        this.unlockAudioOnGesture();
        this.app.changeChannelByOffset(-1);
        return true;
      case 'info':
        this.app.showOSD();
        return true;
      case 'end_seek':
        this.clearSeekHold();
        return true;
      default:
        return false;
    }
  }

  unlockAudioOnGesture() {
    if (this.app && this.app.player && this.app.player.video) {
      if (this.app.player.video.muted && !this.app.player.userPaused) {
        this.app.player.video.muted = false;
      }
      if (this.app.player.video.volume < 1.0) {
        this.app.player.video.volume = 1.0;
      }
    }
  }

  clearSeekHold() {
    clearTimeout(this._seekRepeatTimer);
    this._seekRepeatTimer = null;
    this._heldSeekKey = null;
    if (this.app && typeof this.app.endSeekHold === 'function') {
      this.app.endSeekHold();
    }
  }

  clearAllHoldStates() {
    this.clearSeekHold();
    if (this._okLongPressTimer) {
      clearTimeout(this._okLongPressTimer);
      this._okLongPressTimer = null;
    }
    this._okLongPressFired = false;
    this._okDownTime = 0;
  }

  confirmOrSelectOk() {
    if (this.numberBuffer && this.numberBuffer.length > 0 && !this.app.isModalOpen()) {
      clearTimeout(this.numberTimer);
      const channelNum = parseInt(this.numberBuffer, 10);
      this.numberBuffer = '';
      const overlay = document.getElementById('channel-number-jump');
      if (overlay) overlay.classList.add('hidden');
      if (!isNaN(channelNum)) {
        this.app.jumpToChannelNumber(channelNum);
      }
      return;
    }
    this.app.selectCurrent();
  }

  getSeekKeyInfo(code, key) {
    const isFullscreen = Boolean(this.app && this.app.mode === 'FULLSCREEN');
    if (code === 37 || key === 'ArrowLeft' || key === 'Left') {
      return isFullscreen ? { id: 'left', run: () => this.app.navigate('left') } : null;
    }
    if (code === 39 || key === 'ArrowRight' || key === 'Right') {
      return isFullscreen ? { id: 'right', run: () => this.app.navigate('right') } : null;
    }
    if (
      code === 404 || key === 'Green' || key === 'ColorF1Green' ||
      code === 412 || key === 'Rewind' || key === 'MediaRewind' || key === 'MediaTrackPrevious'
    ) {
      return { id: 'rewind', run: () => this.app.onGreenButton() };
    }
    if (
      code === 406 || key === 'Blue' || key === 'ColorF3Blue' ||
      code === 417 || key === 'FastForward' || key === 'MediaFastForward' || key === 'MediaTrackNext'
    ) {
      return { id: 'ff', run: () => this.app.onBlueButton() };
    }
    return null;
  }

  triggerSeekWithRepeat(seekInfo, isRepeatEvent) {
    clearTimeout(this._seekRepeatTimer);
    this._seekRepeatTimer = null;
    this._heldSeekKey = seekInfo.id;

    seekInfo.run();

    const scheduleFallback = (delayMs) => {
      clearTimeout(this._seekRepeatTimer);
      this._seekRepeatTimer = setTimeout(() => {
        if (this._heldSeekKey !== seekInfo.id) return;
        this.lastKeyTime = Date.now();
        seekInfo.run();
        scheduleFallback(135);
      }, delayMs);
    };

    scheduleFallback(isRepeatEvent ? 160 : 240);
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => this.handleKeyEvent(e), true);
    window.addEventListener('keyup', (e) => this.handleKeyUp(e), true);

    window.addEventListener('blur', () => {
      this.clearAllHoldStates();
      setTimeout(() => this.ensureFocus(), 80);
    });

    document.addEventListener('webOSLaunch', () => {
      this.ensureFocus();
    });
  }

  handleKeyUp(e) {
    const code = e.keyCode || e.which || 0;
    const key = e.key || '';

    if (code === 461 || key === 'Back' || key === 'GoBack' || key === 'XF86Back') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      const now = Date.now();
      if (now - this.lastBackTime > 350) {
        this.lastBackTime = now;
        this.app.handleBack();
      }
      return;
    }

    const isOkKey =
      code === 13 || key === 'Enter' || key === 'Select' || key === 'Accept' || key === 'DPAD_CENTER';
    if (isOkKey) {
      if (this._okLongPressTimer || this._okLongPressFired) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        clearTimeout(this._okLongPressTimer);
        this._okLongPressTimer = null;
        const alreadyFired = this._okLongPressFired;
        this._okLongPressFired = false;
        this._okDownTime = 0;
        this.lastKeySig = null;
        if (!alreadyFired && this.app) {
          this.app.selectCurrent();
        }
      }
      return;
    }

    const isSeekUpKey =
      code === 37 || key === 'ArrowLeft' || key === 'Left' ||
      code === 39 || key === 'ArrowRight' || key === 'Right' ||
      code === 404 || key === 'Green' || key === 'ColorF1Green' ||
      code === 406 || key === 'Blue' || key === 'ColorF3Blue' ||
      code === 412 || key === 'Rewind' || key === 'MediaRewind' || key === 'MediaTrackPrevious' ||
      code === 417 || key === 'FastForward' || key === 'MediaFastForward' || key === 'MediaTrackNext';

    if (isSeekUpKey && (this._heldSeekKey || (this.app && this.app.mode === 'FULLSCREEN'))) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      this.lastKeySig = null;
      this.clearSeekHold();
    }
  }

  handleKeyEvent(e) {
    const code = e.keyCode || e.which || 0;
    const key = e.key || '';
    const now = Date.now();

    if (this.isTvControlKey(code, key)) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    const seekInfo = this.getSeekKeyInfo(code, key);
    if (!seekInfo && this._heldSeekKey) {
      this.clearSeekHold();
    }

    // Deduplication guard: 110ms for held seek keys, 75ms for arrow keys, 140ms for OK/Back/Color buttons
    const isArrow =
      (code >= 37 && code <= 40) ||
      key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
      key === 'Up' || key === 'Down' || key === 'Left' || key === 'Right';
    const minGap = seekInfo ? 110 : (isArrow ? 75 : 140);
    const keySig = code !== 0 ? code : key;

    if (keySig && keySig === this.lastKeySig && (now - this.lastKeyTime) < minGap) {
      return;
    }
    this.lastKeyCode = code;
    this.lastKeySig = keySig;
    this.lastKeyTime = now;

    // Unmute & unlock hardware audio on user gesture (fixes webOS silent autoplay policy bug)
    this.unlockAudioOnGesture();

    // Laptop / Desktop browser keyboard shortcuts (guarded against inputs & open modals)
    const activeEl = document.activeElement;
    const activeTag = activeEl && activeEl.tagName ? activeEl.tagName.toUpperCase() : '';
    const isTextInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const isInteractiveBtn = activeTag === 'BUTTON' || activeTag === 'A';
    if (!isTextInput && !e.ctrlKey && !e.altKey && !e.metaKey && this.app && !this.app.isModalOpen()) {
      if ((code === 32 || key === ' ') && (this.app.mode === 'FULLSCREEN' || !isInteractiveBtn)) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        this.app.togglePlayPause();
        return;
      }
      if (code === 70 || key === 'f' || key === 'F') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (this.app.mode === 'FULLSCREEN') {
          this.app.exitFullscreen();
        } else {
          this.app.enterFullscreen();
        }
        return;
      }
      if (code === 77 || key === 'm' || key === 'M') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (this.app.player && this.app.player.video) {
          const v = this.app.player.video;
          v.muted = !v.muted;
          if (typeof this.app.showToast === 'function') {
            this.app.showToast(v.muted ? 'שמע הושתק' : 'שמע הופעל');
          }
        }
        return;
      }
    }

    // Number keys (0-9): 48-57 or 96-105
    if ((code >= 48 && code <= 57) || (code >= 96 && code <= 105)) {
      const num = code >= 96 ? (code - 96).toString() : (code - 48).toString();
      this.handleNumberKey(num);
      return;
    }

    // Active Seek keys (ArrowLeft/ArrowRight in Fullscreen, Green/Blue, MediaRewind/MediaFastForward)
    if (seekInfo) {
      const isRepeatEvent = Boolean(e.repeat || this._heldSeekKey === seekInfo.id);
      this.triggerSeekWithRepeat(seekInfo, isRepeatEvent);
      return;
    }

    // D-Pad Navigation
    if (code === 37 || key === 'ArrowLeft' || key === 'Left') {
      this.app.navigate('left');
      return;
    }
    if (code === 38 || key === 'ArrowUp' || key === 'Up') {
      this.app.navigate('up');
      return;
    }
    if (code === 39 || key === 'ArrowRight' || key === 'Right') {
      this.app.navigate('right');
      return;
    }
    if (code === 40 || key === 'ArrowDown' || key === 'Down') {
      this.app.navigate('down');
      return;
    }

    // Center Button: OK / Enter (Long-press in Fullscreen toggles Start-Over; Short press opens OSD / Play-Pause)
    if (code === 13 || key === 'Enter' || key === 'Select' || key === 'Accept' || key === 'DPAD_CENTER') {
      const isFullscreenNormalOk =
        this.app &&
        this.app.mode === 'FULLSCREEN' &&
        !this.app.isSurfing &&
        !(this.numberBuffer && this.numberBuffer.length > 0);

      if (isFullscreenNormalOk) {
        if (e.repeat || this._okLongPressTimer || this._okLongPressFired) {
          return;
        }
        this._okDownTime = now;
        this._okLongPressFired = false;
        this._okLongPressTimer = setTimeout(() => {
          this._okLongPressFired = true;
          this._okLongPressTimer = null;
          if (this.app) {
            this.app.onRedButton();
          }
        }, 550);
        return;
      }

      this.confirmOrSelectOk();
      return;
    }

    // Back key (webOS 461, Escape 27, Backspace 8)
    if (code === 461 || code === 27 || key === 'Back' || key === 'GoBack' || key === 'Escape' || key === 'XF86Back') {
      this.lastBackTime = now;
      this.app.handleBack();
      return;
    }
    if (code === 8 || key === 'Backspace') {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        return;
      }
      this.lastBackTime = now;
      this.app.handleBack();
      return;
    }

    // Channel Up / Down Rocker (CH+ = +1 Next Channel, CH- = -1 Previous Channel)
    if (code === 33 || code === 427 || key === 'ChannelUp' || key === 'PageUp') {
      this.app.changeChannelByOffset(1);
      return;
    }
    if (code === 34 || code === 428 || key === 'ChannelDown' || key === 'PageDown') {
      this.app.changeChannelByOffset(-1);
      return;
    }

    // Info / Guide keys (LG 457 Info, 458 Guide)
    if (code === 457 || key === 'Info') {
      this.app.showOSD();
      return;
    }
    if (code === 458 || key === 'Guide') {
      this.app.onYellowButton();
      return;
    }

    // Color keys
    // Red (403): Start Over / Exit Start Over
    if (code === 403 || key === 'Red' || key === 'ColorF0Red') {
      this.app.onRedButton();
      return;
    }
    // Green (404): Rewind 30s
    if (code === 404 || key === 'Green' || key === 'ColorF1Green') {
      this.app.onGreenButton();
      return;
    }
    // Yellow (405): Channel Program Guide (7 Days)
    if (code === 405 || key === 'Yellow' || key === 'ColorF2Yellow') {
      this.app.onYellowButton();
      return;
    }
    // Blue (406): Fast-Forward 30s
    if (code === 406 || key === 'Blue' || key === 'ColorF3Blue') {
      this.app.onBlueButton();
      return;
    }

    // Dedicated Hardware Media keys
    if (code === 415 || code === 19 || code === 179 || key === 'Play' || key === 'Pause' || key === 'MediaPlayPause') {
      this.app.togglePlayPause();
      return;
    }
    if (code === 412 || key === 'Rewind' || key === 'MediaRewind' || key === 'MediaTrackPrevious') {
      this.app.onGreenButton();
      return;
    }
    if (code === 417 || key === 'FastForward' || key === 'MediaFastForward' || key === 'MediaTrackNext') {
      this.app.onBlueButton();
      return;
    }
    if (code === 413 || key === 'Stop' || key === 'MediaStop') {
      this.app.stopPlayback();
      return;
    }
  }

  isTvControlKey(code, key) {
    const tvKeyCodes = [13, 19, 27, 33, 34, 37, 38, 39, 40, 179, 403, 404, 405, 406, 412, 413, 415, 417, 427, 428, 457, 458, 461];
    if (tvKeyCodes.indexOf(code) !== -1) return true;
    if ([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Up', 'Down', 'Left', 'Right',
      'Enter', 'Select', 'Accept', 'DPAD_CENTER',
      'Back', 'GoBack', 'Escape', 'XF86Back',
      'Red', 'ColorF0Red', 'Green', 'ColorF1Green', 'Yellow', 'ColorF2Yellow', 'Blue', 'ColorF3Blue',
      'Rewind', 'MediaRewind', 'MediaTrackPrevious', 'FastForward', 'MediaFastForward', 'MediaTrackNext',
      'Play', 'Pause', 'MediaPlayPause', 'Stop', 'MediaStop',
      'ChannelUp', 'ChannelDown', 'Info', 'Guide'
    ].indexOf(key) !== -1) return true;
    return false;
  }

  handleNumberKey(digit) {
    if (this.app.isModalOpen()) {
      this.app.handleModalNumberKey(digit);
      return;
    }

    this.numberBuffer += digit;
    this.app.showNumberInputOverlay(this.numberBuffer);

    clearTimeout(this.numberTimer);
    this.numberTimer = setTimeout(() => {
      const channelNum = parseInt(this.numberBuffer, 10);
      this.numberBuffer = '';
      if (!isNaN(channelNum)) {
        this.app.jumpToChannelNumber(channelNum);
      }
    }, 1350);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RemoteController;
}
