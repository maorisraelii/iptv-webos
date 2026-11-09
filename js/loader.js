/**
 * Over-The-Air (OTA) Bootstrapper & Auto-Updater for LG webOS TV
 * Checks for live cloud version and loads it seamlessly on startup.
 */

(function initOtaLoader() {
  const STORAGE_REMOTE_KEY = 'zenplay_iptv_remote_url';

  async function checkAndBoot() {
    const splash = document.getElementById('boot-splash');
    const splashText = document.getElementById('boot-splash-text');

    let remoteUrl = localStorage.getItem(STORAGE_REMOTE_KEY) || '';

    // If not in localStorage, check app-config.json
    if (!remoteUrl) {
      try {
        const configRes = await fetch('app-config.json');
        if (configRes.ok) {
          const config = await configRes.json();
          if (config && config.remoteAppUrl) {
            remoteUrl = config.remoteAppUrl.trim();
          }
        }
      } catch (e) {
        console.warn('Could not read app-config.json:', e);
      }
    }

    // If already running directly from the remote URL, do not redirect!
    if (remoteUrl && window.location.href.startsWith(remoteUrl)) {
      console.log('Currently running directly from remote URL.');
      dismissSplash();
      return;
    }

    if (remoteUrl) {
      if (splash && splashText) {
        splash.classList.remove('hidden');
        splashText.textContent = 'בודק עדכונים מקוונים...';
      }

      const isAvailable = await checkRemoteAvailability(remoteUrl, 2500);
      if (isAvailable) {
        if (splashText) splashText.textContent = 'מעלה גרסה עדכנית...';
        // Transfer to cloud hosted version
        setTimeout(() => {
          window.location.replace(remoteUrl);
        }, 300);
        return;
      } else {
        console.log('Remote server unreachable, falling back to local bundled version.');
        if (splashText) splashText.textContent = 'מפעיל גרסה מקומית...';
        setTimeout(() => {
          dismissSplash();
        }, 500);
        return;
      }
    }

    // No remote URL configured -> run local app immediately
    dismissSplash();
  }

  function checkRemoteAvailability(url, timeoutMs) {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, timeoutMs);

      fetch(url, {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal
      })
      .then((res) => {
        clearTimeout(timer);
        resolve(res.ok || res.status < 400);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  function dismissSplash() {
    const splash = document.getElementById('boot-splash');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 350ms ease-out';
      setTimeout(() => {
        splash.classList.add('hidden');
      }, 360);
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndBoot);
  } else {
    checkAndBoot();
  }
})();
