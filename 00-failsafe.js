// FAILSAFE: force-remove the startup splash after 15s no matter what happens
      // elsewhere (slow/blocked CDN, unexpected error, etc.) so the app can never
      // hang forever on this screen.
      setTimeout(function () {
        var splash = document.getElementById('sync-splash-screen');
        if (splash) splash.remove();
      }, 15000);
