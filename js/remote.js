/**
 * Remote Control and Spatial Navigation Manager for LG webOS TV
 * Supports D-Pad, OK, Back (461), Color Buttons, Numbers, Channel Up/Down, Media Keys
 * Compatible with webOS 4.64, 5.0+, 6.0+, webOS OSE, and Magic Remote pointer.
 */
class RemoteController {
  constructor(app) {
    this.app = app;
    this.numberBuffer = '';
    this.numberTimer = null;

    this.bindEvents();
    this.ensureFocus();
  }

  ensureFocus() {
    try {
      window.focus();
      if (document.body) {
        document.body.focus();
      }
    } catch (e) {
      console.warn('Focus error:', e);
    }
  }

  bindEvents() {
    const onKey = (e) => this.handleKeyEvent(e);

    // Register on both window and document with capturing to ensure events are never lost
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('keydown', onKey, true);

    // Some webOS firmware fires Back key (461) on keyup
    window.addEventListener('keyup', (e) => this.handleKeyUp(e), true);
    document.addEventListener('keyup', (e) => this.handleKeyUp(e), true);

    // Keep window focused on webOS
    window.addEventListener('blur', () => {
      setTimeout(() => this.ensureFocus(), 100);
    });

    document.addEventListener('webOSLaunch', () => {
      this.ensureFocus();
    });
  }

  handleKeyUp(e) {
    const code = e.keyCode || e.which || 0;
    const key = e.key || '';

    // Handle Back on keyup if not handled on keydown
    if (code === 461 || key === 'Back' || key === 'GoBack') {
      e.preventDefault();
      // Back is handled on keydown; prevent default bubble
    }
  }

  handleKeyEvent(e) {
    const code = e.keyCode || e.which || 0;
    const key = e.key || '';

    // Prevent default browser behavior for TV remote keys
    if (this.isTvControlKey(code, key)) {
      e.preventDefault();
    }

    // Number keys (0-9): 48-57 (top row) or 96-105 (numpad)
    if ((code >= 48 && code <= 57) || (code >= 96 && code <= 105)) {
      const num = code >= 96 ? (code - 96).toString() : (code - 48).toString();
      this.handleNumberKey(num);
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

    // Select / OK / Enter
    if (code === 13 || key === 'Enter' || key === 'Select' || key === 'Accept') {
      this.app.selectCurrent();
      return;
    }

    // Back key (webOS 461, Escape 27, Backspace 8)
    if (code === 461 || code === 27 || key === 'Back' || key === 'GoBack' || key === 'Escape' || key === 'XF86Back') {
      this.app.handleBack();
      return;
    }
    if (code === 8 || key === 'Backspace') {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        return; // Allow typing in input fields
      }
      this.app.handleBack();
      return;
    }

    // Channel Up / Down (33/34 and LG 427/428)
    if (code === 33 || code === 427 || key === 'ChannelUp' || key === 'PageUp') {
      this.app.changeChannelByOffset(-1);
      return;
    }
    if (code === 34 || code === 428 || key === 'ChannelDown' || key === 'PageDown') {
      this.app.changeChannelByOffset(1);
      return;
    }

    // Info key (LG 457)
    if (code === 457 || key === 'Info') {
      this.app.showOSD();
      return;
    }

    // Color keys
    if (code === 403 || key === 'Red' || key === 'ColorF0Red') {
      this.app.onRedButton();
      return;
    }
    if (code === 404 || key === 'Green' || key === 'ColorF1Green') {
      this.app.onGreenButton();
      return;
    }
    if (code === 405 || key === 'Yellow' || key === 'ColorF2Yellow') {
      this.app.onYellowButton();
      return;
    }
    if (code === 406 || key === 'Blue' || key === 'ColorF3Blue') {
      this.app.onBlueButton();
      return;
    }

    // Media keys
    if (code === 415 || code === 19 || code === 179 || key === 'Play' || key === 'Pause' || key === 'MediaPlayPause') {
      this.app.onYellowButton(); // Play / Pause toggle
      return;
    }
    if (code === 412 || key === 'Rewind' || key === 'MediaRewind' || key === 'MediaTrackPrevious') {
      this.app.onGreenButton(); // Rewind 30s
      return;
    }
    if (code === 417 || key === 'FastForward' || key === 'MediaFastForward' || key === 'MediaTrackNext') {
      this.app.onBlueButton(); // Fast forward 30s
      return;
    }
    if (code === 413 || key === 'Stop' || key === 'MediaStop') {
      this.app.stopPlayback();
      return;
    }
  }

  isTvControlKey(code, key) {
    const tvKeyCodes = [13, 27, 33, 34, 37, 38, 39, 40, 403, 404, 405, 406, 412, 413, 415, 417, 427, 428, 457, 461];
    if (tvKeyCodes.indexOf(code) !== -1) return true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Back', 'GoBack', 'Escape'].indexOf(key) !== -1) return true;
    return false;
  }

  handleNumberKey(digit) {
    if (this.app.isModalOpen()) return;

    this.numberBuffer += digit;
    this.app.showNumberInputOverlay(this.numberBuffer);

    clearTimeout(this.numberTimer);
    this.numberTimer = setTimeout(() => {
      const channelNum = parseInt(this.numberBuffer, 10);
      this.numberBuffer = '';
      if (!isNaN(channelNum)) {
        this.app.jumpToChannelNumber(channelNum);
      }
    }, 1200);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RemoteController;
}
