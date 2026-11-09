/**
 * Over-The-Air (OTA) Bootstrapper & Auto-Updater for LG webOS TV
 * Ensures local high-performance runtime with remote control integrity.
 */

(function initOtaLoader() {
  function dismissSplash() {
    var splash = document.getElementById('boot-splash');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 300ms ease-out';
      setTimeout(function() {
        splash.classList.add('hidden');
      }, 320);
    }

    // Force focus to document body for immediate webOS remote responsiveness
    window.focus();
    if (document.body) {
      document.body.focus();
    }
  }

  function checkAndBoot() {
    var remoteUrl = localStorage.getItem('zenplay_iptv_remote_url');

    // Only redirect if the user explicitly saved a custom remote URL in settings
    if (remoteUrl && remoteUrl.trim() && !window.location.href.startsWith(remoteUrl)) {
      var splashText = document.getElementById('boot-splash-text');
      if (splashText) splashText.textContent = 'טוען גרסה מותאמת אישית...';

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

    // Native local execution (best for webOS TV remote and decoder performance)
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
