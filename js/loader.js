/**
 * Ultra-Fast Polyfills & Zero-Delay Bootstrapper for LG webOS TV (webOS 4.64 Chromium 53 & webOS 5.0 Chromium 68+)
 */

(function initWebOSPolyfills() {
  if (!String.prototype.padStart) {
    String.prototype.padStart = function padStart(targetLength, padString) {
      targetLength = targetLength >> 0;
      padString = String(typeof padString !== 'undefined' ? padString : ' ');
      if (this.length > targetLength) {
        return String(this);
      } else {
        targetLength = targetLength - this.length;
        if (targetLength > padString.length) {
          padString += padString.repeat(targetLength / padString.length);
        }
        return padString.slice(0, targetLength) + String(this);
      }
    };
  }

  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
})();

(function initFastBoot() {
  function dismissSplash() {
    var splash = document.getElementById('boot-splash');
    if (splash) {
      splash.classList.add('hidden');
    }
    if (window.app && typeof window.app.updateVideoSurfacePosition === 'function') {
      window.app.updateVideoSurfacePosition();
    }
    try {
      window.focus();
      if (document.body) document.body.focus();
    } catch (e) {}
  }

  function checkAndBoot() {
    var remoteUrl = '';
    try {
      remoteUrl = localStorage.getItem('zenplay_iptv_remote_url') || '';
      if (remoteUrl.indexOf('maorisraelii.github.io') !== -1) {
        localStorage.removeItem('zenplay_iptv_remote_url');
        remoteUrl = '';
      }
    } catch (e) {}

    if (remoteUrl && remoteUrl.trim() && window.location.href.indexOf(remoteUrl) !== 0) {
      fetch(remoteUrl, { method: 'HEAD', cache: 'no-cache' })
        .then(function(res) {
          if (res.ok || res.status < 400) {
            window.location.replace(remoteUrl);
          } else {
            dismissSplash();
          }
        })
        .catch(function() {
          dismissSplash();
        });
      return;
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      dismissSplash();
    } else {
      window.addEventListener('DOMContentLoaded', dismissSplash);
    }
  }

  checkAndBoot();
})();
