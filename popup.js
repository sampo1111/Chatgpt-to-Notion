(function () {
  const tokenInput = document.getElementById("token");
  const saveButton = document.getElementById("save");
  const testButton = document.getElementById("test");
  const tokenStatus = document.getElementById("token-status");
  const copyStatus = document.getElementById("copy-status");
  const connectionStatus = document.getElementById("connection-status");
  const enableCopyButtonInput = document.getElementById("enable-copy-button");
  const enableNotionPasteInput = document.getElementById("enable-notion-paste");

  async function boot() {
    await refreshStatus();

    saveButton.addEventListener("click", async () => {
      await saveToken();
    });

    testButton.addEventListener("click", async () => {
      await testConnection();
    });

    enableCopyButtonInput.addEventListener("change", async () => {
      await saveUiSettings();
    });

    enableNotionPasteInput.addEventListener("change", async () => {
      await saveUiSettings();
    });
  }

  async function refreshStatus() {
    const settings = await chrome.runtime.sendMessage({
      type: "getNotionSettings"
    });
    const copySummary = await chrome.runtime.sendMessage({
      type: "getLastCopySummary"
    });

    if (settings?.ok && settings.hasToken) {
      tokenStatus.textContent = `Token: saved (${settings.maskedToken})`;
    } else {
      tokenStatus.textContent = "Token: not saved";
    }

    enableCopyButtonInput.checked = settings?.enableCopyButton !== false;
    enableNotionPasteInput.checked = settings?.enableNotionPaste !== false;

    if (copySummary?.ok && copySummary.hasLastCopy) {
      const copiedAt = new Date(copySummary.copiedAt).toLocaleString();
      copyStatus.textContent = `Last ChatGPT capture: ${copySummary.blockCount} block(s) at ${copiedAt}`;
    } else {
      copyStatus.textContent = "Last ChatGPT capture: none";
    }
  }

  async function saveToken() {
    setBusy(true);
    connectionStatus.textContent = "Connection: saving...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "saveNotionSettings",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not save the token.");
      }

      connectionStatus.textContent = response.hasToken
        ? "Connection: token saved"
        : "Connection: token cleared";

      await refreshStatus();
    } catch (error) {
      connectionStatus.textContent = `Connection: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    connectionStatus.textContent = "Connection: testing...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "testNotionConnection",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Connection test failed.");
      }

      connectionStatus.textContent = `Connection: ok (${response.botName})`;
    } catch (error) {
      connectionStatus.textContent = `Connection: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  async function saveUiSettings() {
    setBusy(true);
    connectionStatus.textContent = "Connection: saving options...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "saveUiSettings",
        settings: {
          enableCopyButton: enableCopyButtonInput.checked,
          enableNotionPaste: enableNotionPasteInput.checked
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not save the options.");
      }

      connectionStatus.textContent = "Connection: options saved";
      await refreshStatus();
    } catch (error) {
      connectionStatus.textContent = `Connection: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  function setBusy(busy) {
    saveButton.disabled = busy;
    testButton.disabled = busy;
    tokenInput.disabled = busy;
    enableCopyButtonInput.disabled = busy;
    enableNotionPasteInput.disabled = busy;
  }

  void boot();
})();
