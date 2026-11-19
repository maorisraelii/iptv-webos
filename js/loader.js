/**
 * Ultra-Fast Polyfills & Zero-Delay Bootstrapper for LG webOS TV (webOS 4.64 Chromium 53 & webOS 5.0+) & Android TV
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
  var splashDismissed = false;
  var safetyTimer = null;

  function applyTvViewportScale() {
    try {
      var docEl = document.documentElement;
      if (!docEl) return;
      var w = window.innerWidth || docEl.clientWidth || 0;
      if (w > 0 && w < 1800) {
        docEl.style.zoom = String(w / 1920);
      } else if (w >= 1800) {
        docEl.style.zoom = '';
      }
    } catch (e) {}
  }

  window.applyTvViewportScale = applyTvViewportScale;
  applyTvViewportScale();
  window.addEventListener('load', applyTvViewportScale);
  window.addEventListener('resize', applyTvViewportScale);

  function dismissBootSplash() {
    if (splashDismissed) return;
    splashDismissed = true;
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    var splash = document.getElementById('boot-splash');
    if (splash) {
      splash.classList.add('fade-out');
      splash.classList.add('hidden');
    }
    if (window.app && typeof window.app.updateVideoSurfacePosition === 'function') {
      try {
        window.app.updateVideoSurfacePosition(true);
      } catch (e) {}
    }
    if (window.AndroidTvHost && typeof window.AndroidTvHost.notifyAppReady === 'function') {
      try {
        window.AndroidTvHost.notifyAppReady();
      } catch (e) {}
    }
    try {
      window.focus();
      if (document.body) document.body.focus();
    } catch (e) {}
  }

  window.dismissBootSplash = dismissBootSplash;

  function checkAndBoot() {
    safetyTimer = setTimeout(function() {
      dismissBootSplash();
    }, 3500);

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
          }
        })
        .catch(function() {});
    }
  }

  checkAndBoot();
})();
