// ON-SCREEN ERROR LOG (for debugging on devices without DevTools, e.g. iPad)
      // Shows a small red box at the bottom of the screen listing any JS errors
      // that happen, with a copy button, instead of requiring F12.
      (function () {
        var errors = [];
        function renderBox() {
          var box = document.getElementById('debug-error-box');
          if (!box) {
            box = document.createElement('div');
            box.id = 'debug-error-box';
            box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999999;background:#7f1d1d;color:#fff;font:11px/1.4 monospace;max-height:40vh;overflow:auto;padding:8px;white-space:pre-wrap;word-break:break-all;';
            document.body ? document.body.appendChild(box) : document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(box); });
          }
          box.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">⚠️ พบข้อผิดพลาด ' + errors.length + ' รายการ (แตะค้างเพื่อคัดลอกข้อความ)</div>' +
            errors.map(function (e, i) { return (i + 1) + '. ' + e; }).join('\n\n');
        }
        window.addEventListener('error', function (e) {
          errors.push((e.message || 'Unknown error') + ' — ' + (e.filename || '') + ':' + (e.lineno || ''));
          renderBox();
        });
        window.addEventListener('unhandledrejection', function (e) {
          var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
          errors.push('Promise error: ' + reason);
          renderBox();
        });
      })();
