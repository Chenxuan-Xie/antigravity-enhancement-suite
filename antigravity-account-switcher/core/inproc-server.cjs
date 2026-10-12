"use strict";
const path = require("path");
const { pathToFileURL } = require("url");

globalThis.__AGY_INPROC_SWITCHER__ = true;

function startInprocServer() {
  try {
    const daemonUrl = pathToFileURL(path.join(__dirname, "daemon.mjs")).href;
    import(daemonUrl)
      .then((mod) => {
        if (mod && typeof mod.ensureLocalSwitcherServer === "function") {
          mod.ensureLocalSwitcherServer();
        }
      })
      .catch(() => {});
  } catch (_) {}
}

startInprocServer();

module.exports = { startInprocServer };
