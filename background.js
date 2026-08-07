// PRISM background event page.
// Hosts: extension-level storage, badge state, install/update hooks.
// The content bridge forwards everything else; this page stays dormant
// unless messaging wakes it (event-page model = zero idle CPU).

const VERSION = browser.runtime.getManifest().version;

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.storage.local.set({ prism: { installedAt: Date.now(), version: VERSION } });
    browser.action.setBadgeText({ text: "NEW" });
    browser.action.setBadgeBackgroundColor({ color: "#ff3d7f" });
  } else if (details.reason === "update") {
    browser.storage.local.set({ prism: { updatedFrom: details.previousVersion, updatedAt: Date.now(), version: VERSION } });
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message && message.type) {
    case "prism:ping":
      sendResponse({ ok: true, version: VERSION, platform: "firefox-mv3" });
      return false;
    case "prism:storage:get": {
      browser.storage.local.get(message.key).then((v) => sendResponse({ ok: true, value: v }));
      return true;
    }
    case "prism:storage:set": {
      browser.storage.local.set({ [message.key]: message.value }).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: String(err) })
      );
      return true;
    }
    case "prism:storage:remove": {
      browser.storage.local.remove(message.key).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: String(err) })
      );
      return true;
    }
    default:
      return false;
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    browser.action.setBadgeText({ text: "", tabId });
  }
});
