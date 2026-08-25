window.__sfQ = window.__sfQ || [];

window.sendToPlugin = function (msg) {
  try {
    if (window.ipc && window.ipc.postMessage) {
      window.ipc.postMessage(JSON.stringify(msg));
      return;
    }
  } catch (e) {}
  try {
    if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
      window.chrome.webview.postMessage(JSON.stringify(msg));
    }
  } catch (e) {}
};

window.onPluginMessage = function (msg) {
  window.__sfQ.push(msg);
};

window.onPluginMessageInternal = function (msg) {
  try {
    var json = typeof msg === "string" ? JSON.parse(msg) : msg;
    window.onPluginMessage && window.onPluginMessage(json);
  } catch (e) {}
};

try {
  document.documentElement.dataset.live = "1";
} catch (e) {}

document.addEventListener(
  "keydown",
  function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);
