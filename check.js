// Shows a clear message when the app cannot start
(function () {
  function show(text) {
    var el = document.getElementById('homeStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'status error';
  }

  if (location.protocol === 'file:') {
    show('Open the site through a web server or your hosting link, not by double clicking index.html.');
    return;
  }

  setTimeout(function () {
    if (!window.__appLoaded) show('The app failed to load. Check your internet connection and config.js.');
  }, 6000);
})();
