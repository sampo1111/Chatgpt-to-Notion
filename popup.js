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
      tokenStatus.textContent = `토큰: 저장됨 (${settings.maskedToken})`;
    } else {
      tokenStatus.textContent = "토큰: 저장되지 않음";
    }

    enableCopyButtonInput.checked = settings?.enableCopyButton !== false;
    enableNotionPasteInput.checked = settings?.enableNotionPaste !== false;

    if (copySummary?.ok && copySummary.hasLastCopy) {
      const copiedAt = new Date(copySummary.copiedAt).toLocaleString();
      const sourceLabel = copySummary.sourceLabel || "AI";
      copyStatus.textContent = `최근 캡처: ${sourceLabel} ${copySummary.blockCount}개 블록 (${copiedAt})`;
    } else {
      copyStatus.textContent = "최근 캡처: 없음";
    }
  }

  async function saveToken() {
    setBusy(true);
    connectionStatus.textContent = "상태: 저장 중...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "saveNotionSettings",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "토큰을 저장하지 못했습니다.");
      }

      connectionStatus.textContent = response.hasToken
        ? "상태: 토큰 저장됨"
        : "상태: 토큰 삭제됨";

      await refreshStatus();
    } catch (error) {
      connectionStatus.textContent = `상태: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    connectionStatus.textContent = "상태: 연결 테스트 중...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "testNotionConnection",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "연결 테스트에 실패했습니다.");
      }

      connectionStatus.textContent = `상태: 연결됨 (${response.botName})`;
    } catch (error) {
      connectionStatus.textContent = `상태: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  async function saveUiSettings() {
    setBusy(true);
    connectionStatus.textContent = "상태: 옵션 저장 중...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "saveUiSettings",
        settings: {
          enableCopyButton: enableCopyButtonInput.checked,
          enableNotionPaste: enableNotionPasteInput.checked
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "옵션을 저장하지 못했습니다.");
      }

      connectionStatus.textContent = "상태: 옵션 저장됨";
      await refreshStatus();
    } catch (error) {
      connectionStatus.textContent = `상태: ${error instanceof Error ? error.message : String(error)}`;
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
