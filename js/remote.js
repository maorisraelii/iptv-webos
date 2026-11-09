/**
 * Remote Control and Spatial Navigation Manager for LG webOS TV
 * Supports D-Pad, OK, Back (461), Color Buttons, Numbers, Channel Up/Down
 * Also compatible with standard desktop keyboard & Magic Remote pointer.
 */
class RemoteController {
  constructor(app) {
    this.app = app;
    this.numberBuffer = '';
    this.numberTimer = null;

    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Handle LG WebOS hardware back key event if present
    document.addEventListener('webOSLaunch', () => {
      console.log('webOS launch event received');
    });
  }

  handleKeyDown(e) {
    const keyCode = e.keyCode || e.which;

    // Prevent default browser actions for TV navigation keys
    if ([37, 38, 39, 40, 13, 33, 34, 461, 403, 404, 405, 406].includes(keyCode)) {
      e.preventDefault();
    }

    // Number keys (0-9): 48-57 (top row) or 96-105 (numpad)
    if ((keyCode >= 48 && keyCode <= 57) || (keyCode >= 96 && keyCode <= 105)) {
      const num = keyCode >= 96 ? (keyCode - 96).toString() : (keyCode - 48).toString();
      this.handleNumberKey(num);
      return;
    }

    switch (keyCode) {
      // D-Pad Arrows
      case 37: // Left
        this.app.navigate('left');
        break;
      case 38: // Up
        this.app.navigate('up');
        break;
      case 39: // Right
        this.app.navigate('right');
        break;
      case 40: // Down
        this.app.navigate('down');
        break;

      // Select / OK / Enter
      case 13: // Enter
        this.app.selectCurrent();
        break;

      // Back key (461 on LG webOS, 27 on Esc, 8 on Backspace)
      case 461:
      case 27:
        this.app.handleBack();
        break;
      case 8:
        // Only treat backspace as Back if not typing inside an active input element
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
          return;
        }
        e.preventDefault();
        this.app.handleBack();
        break;

      // Channel Up / Down
      case 33: // Channel Up / Page Up
        this.app.changeChannelByOffset(-1);
        break;
      case 34: // Channel Down / Page Down
        this.app.changeChannelByOffset(1);
        break;

      // Color keys (LG Magic Remote / Standard TV remote)
      case 403: // Red
        this.app.onRedButton();
        break;
      case 404: // Green
        this.app.onGreenButton();
        break;
      case 405: // Yellow
        this.app.onYellowButton();
        break;
      case 406: // Blue
        this.app.onBlueButton();
        break;

      // Media keys
      case 415: // Play
      case 19:  // Pause
        this.app.togglePlayPause();
        break;
      case 413: // Stop
        this.app.stopPlayback();
        break;

      default:
        break;
    }
  }

  handleNumberKey(digit) {
    // If settings or search modal is open, let normal keyboard handle it
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
