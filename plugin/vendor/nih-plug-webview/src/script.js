window.sendToPlugin = function (msg) {
  try {
    window.ipc.postMessage(JSON.stringify(msg));
  } catch (e) {}
};

window.onPluginMessage = function () {};

window.onPluginMessageInternal = function (msg) {
  try {
    var json = JSON.parse(msg);
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
