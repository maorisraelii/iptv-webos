/**
 * Polyfills & Bootstrapper for LG webOS TV (webOS 4.64 Chromium 53 & webOS 5.0 Chromium 68+)
 */

(function initWebOSPolyfills() {
  // String.prototype.padStart polyfill for Chromium 53 (webOS 4.x)
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

  // NodeList.prototype.forEach polyfill
  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
})();

(function initOtaLoader() {
  function dismissSplash() {
    var splash = document.getElementById('boot-splash');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 280ms ease-out';
      setTimeout(function() {
        splash.classList.add('hidden');
        if (window.app && typeof window.app.updateVideoSurfacePosition === 'function') {
          window.app.updateVideoSurfacePosition();
        }
      }, 300);
    }

    try {
      window.focus();
      if (document.body) {
        document.body.focus();
      }
    } catch (e) {}
  }

  function checkAndBoot() {
    var remoteUrl = '';
    try {
      remoteUrl = localStorage.getItem('zenplay_iptv_remote_url') || '';
    } catch (e) {}

    if (remoteUrl && remoteUrl.trim() && window.location.href.indexOf(remoteUrl) !== 0) {
      var splashText = document.getElementById('boot-splash-text');
      if (splashText) splashText.textContent = 'טוען גרסה מעודכנת...';

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
      setTimeout(dismissSplash, 150);
    } else {
      window.addEventListener('DOMContentLoaded', function() {
        setTimeout(dismissSplash, 150);
      });
    }
  }

  checkAndBoot();
})();
