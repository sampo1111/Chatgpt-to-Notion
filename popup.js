(function () {
  const tokenInput = document.getElementById("token");
  const saveButton = document.getElementById("save");
  const testButton = document.getElementById("test");
  const tokenStatus = document.getElementById("token-status");
  const copyStatus = document.getElementById("copy-status");
  const connectionStatus = document.getElementById("connection-status");
  const undoStatus = document.getElementById("undo-status");
  const undoButton = document.getElementById("undo-last-paste");
  const enableCopyButtonInput = document.getElementById("enable-copy-button");
  const enablePasteButtonInput = document.getElementById("enable-paste-button");
  const enableFeatureInput = document.getElementById("enable-feature");
  const buttonSizeInput = document.getElementById("button-size");
  const buttonSizeValue = document.getElementById("button-size-value");
  const resetButtonThemeButton = document.getElementById("reset-button-theme");
  const defaultButtonTheme = window.AIToNotionButtonTheme?.normalizeThemeSettings?.() || {
    copy: { start: "#fffef5", end: "#fff7dd", text: "#7c2d12" },
    paste: { start: "#effcf6", end: "#d9fbe8", text: "#166534" },
    selection: { start: "#fff8e1", end: "#ffe9b5", text: "#9a3412" },
    toggle: { start: "#eefcf4", end: "#d8f7e5", text: "#166534" }
  };
  const buttonThemeInputs = {
    copy: {
      start: document.getElementById("copy-button-start-color"),
      end: document.getElementById("copy-button-end-color"),
      text: document.getElementById("copy-button-text-color")
    },
    paste: {
      start: document.getElementById("paste-button-start-color"),
      end: document.getElementById("paste-button-end-color"),
      text: document.getElementById("paste-button-text-color")
    },
    selection: {
      start: document.getElementById("selection-button-start-color"),
      end: document.getElementById("selection-button-end-color"),
      text: document.getElementById("selection-button-text-color")
    },
    toggle: {
      start: document.getElementById("toggle-button-start-color"),
      end: document.getElementById("toggle-button-end-color"),
      text: document.getElementById("toggle-button-text-color")
    }
  };
  let isBusy = false;
  let hasUndoAvailable = false;

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

    enablePasteButtonInput.addEventListener("change", async () => {
      await saveUiSettings();
    });

    enableFeatureInput.addEventListener("change", async () => {
      syncFeatureDependentControls();
      await saveUiSettings();
    });

    buttonSizeInput.addEventListener("input", () => {
      updateButtonSizeLabel();
    });

    buttonSizeInput.addEventListener("change", async () => {
      await saveUiSettings();
    });

    for (const group of Object.values(buttonThemeInputs)) {
      for (const input of Object.values(group)) {
        input.addEventListener("change", async () => {
          await saveUiSettings();
        });
      }
    }

    resetButtonThemeButton.addEventListener("click", async () => {
      applyButtonThemeToInputs(defaultButtonTheme);
      await saveUiSettings();
    });

    undoButton.addEventListener("click", async () => {
      await undoLastPaste();
    });
  }

  async function refreshStatus() {
    const settings = await chrome.runtime.sendMessage({
      type: "getNotionSettings"
    });
    const copySummary = await chrome.runtime.sendMessage({
      type: "getLastCopySummary"
    });
    const undoSummary = await chrome.runtime.sendMessage({
      type: "getLastUndoSummary"
    });

    if (settings?.ok && settings.hasToken) {
      tokenStatus.textContent = `토큰: 저장됨 (${settings.maskedToken})`;
    } else {
      tokenStatus.textContent = "토큰: 저장되지 않음";
    }

    enableCopyButtonInput.checked = settings?.enableCopyButton !== false;
    enablePasteButtonInput.checked = settings?.enablePasteButton !== false;
    enableFeatureInput.checked = settings?.enableFeature !== false;
    buttonSizeInput.value = String(Math.round((Number(settings?.buttonScale) || 1) * 100));
    applyButtonThemeToInputs(
      window.AIToNotionButtonTheme?.normalizeThemeSettings?.(settings?.buttonTheme) || defaultButtonTheme
    );
    updateButtonSizeLabel();
    syncFeatureDependentControls();

    if (copySummary?.ok && copySummary.hasLastCopy) {
      const copiedAt = new Date(copySummary.copiedAt).toLocaleString();
      const sourceLabel = copySummary.sourceLabel || "AI";
      copyStatus.textContent = `최근 캡처: ${sourceLabel} ${copySummary.blockCount}개 블록 (${copiedAt})`;
    } else {
      copyStatus.textContent = "최근 캡처: 없음";
    }

    if (undoSummary?.ok && undoSummary.hasUndo) {
      const pastedAt = new Date(undoSummary.updatedAt).toLocaleString();
      undoStatus.textContent = `마지막 붙여넣기: ${undoSummary.blockCount}개 블록 (${pastedAt})`;
    } else {
      undoStatus.textContent = "마지막 붙여넣기: 없음";
    }

    syncUndoButton(undoSummary, settings);
  }

  async function saveToken() {
    await withBusy("상태: 저장 중...", async () => {
      const response = await chrome.runtime.sendMessage({
        type: "saveNotionSettings",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "토큰을 저장하지 못했습니다.");
      }

      connectionStatus.textContent = response.hasToken ? "상태: 토큰 저장됨" : "상태: 토큰 제거됨";
      await refreshStatus();
    });
  }

  async function testConnection() {
    await withBusy("상태: 연결 테스트 중...", async () => {
      const response = await chrome.runtime.sendMessage({
        type: "testNotionConnection",
        token: tokenInput.value
      });

      if (!response?.ok) {
        throw new Error(response?.error || "연결 테스트에 실패했습니다.");
      }

      connectionStatus.textContent = `상태: 연결됨 (${response.botName})`;
    });
  }

  async function saveUiSettings() {
    await withBusy("상태: 옵션 저장 중...", async () => {
      const response = await chrome.runtime.sendMessage({
        type: "saveUiSettings",
        settings: {
          enableCopyButton: enableCopyButtonInput.checked,
          enablePasteButton: enablePasteButtonInput.checked,
          enableFeature: enableFeatureInput.checked,
          buttonScale: Number(buttonSizeInput.value) / 100,
          buttonTheme: readButtonThemeFromInputs()
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "옵션을 저장하지 못했습니다.");
      }

      connectionStatus.textContent = "상태: 옵션 저장됨";
      await refreshStatus();
    });
  }

  async function withBusy(message, task) {
    setBusy(true);
    connectionStatus.textContent = message;

    try {
      await task();
    } catch (error) {
      connectionStatus.textContent = `상태: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  function updateButtonSizeLabel() {
    buttonSizeValue.textContent = `${buttonSizeInput.value}%`;
  }

  function readButtonThemeFromInputs() {
    const theme = {
      copy: readButtonThemeSection("copy"),
      paste: readButtonThemeSection("paste"),
      selection: readButtonThemeSection("selection"),
      toggle: readButtonThemeSection("toggle")
    };

    return window.AIToNotionButtonTheme?.normalizeThemeSettings?.(theme) || theme;
  }

  function readButtonThemeSection(sectionName) {
    const section = buttonThemeInputs[sectionName];
    return {
      start: section.start.value,
      end: section.end.value,
      text: section.text.value
    };
  }

  function applyButtonThemeToInputs(rawTheme) {
    const theme = window.AIToNotionButtonTheme?.normalizeThemeSettings?.(rawTheme) || defaultButtonTheme;

    for (const [sectionName, sectionTheme] of Object.entries(theme)) {
      const sectionInputs = buttonThemeInputs[sectionName];
      if (!sectionInputs) {
        continue;
      }

      sectionInputs.start.value = sectionTheme.start;
      sectionInputs.end.value = sectionTheme.end;
      sectionInputs.text.value = sectionTheme.text;
    }
  }

  function syncFeatureDependentControls() {
    const featureEnabled = enableFeatureInput.checked;
    const dependentControls = [enableCopyButtonInput, enablePasteButtonInput, buttonSizeInput];

    for (const control of dependentControls) {
      control.disabled = isBusy || !featureEnabled;
    }

    toggleDisabledState(enableCopyButtonInput, !featureEnabled);
    toggleDisabledState(enablePasteButtonInput, !featureEnabled);
    toggleDisabledState(buttonSizeInput, !featureEnabled);
  }

  function syncUndoButton(summary, settings) {
    hasUndoAvailable = Boolean(summary?.ok && summary.hasUndo && settings?.hasToken);
    undoButton.disabled = isBusy || !hasUndoAvailable;
  }

  function toggleDisabledState(control, disabled) {
    const row = control.closest(".toggle-row, .range-field");
    if (!row) {
      return;
    }

    row.classList.toggle("is-disabled", disabled);
  }

  function setBusy(busy) {
    isBusy = busy;
    saveButton.disabled = busy;
    testButton.disabled = busy;
    undoButton.disabled = busy || !hasUndoAvailable;
    tokenInput.disabled = busy;
    enableFeatureInput.disabled = busy;
    resetButtonThemeButton.disabled = busy;

    for (const group of Object.values(buttonThemeInputs)) {
      for (const input of Object.values(group)) {
        input.disabled = busy;
      }
    }

    syncFeatureDependentControls();
  }

  async function undoLastPaste() {
    await withBusy("상태: Undo 실행 중...", async () => {
      const response = await chrome.runtime.sendMessage({
        type: "undoLastStoredPaste"
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Undo를 실행하지 못했습니다.");
      }

      connectionStatus.textContent =
        response.undoneBlocks > 0
          ? `상태: ${response.undoneBlocks}개 블록을 되돌렸습니다`
          : "상태: 되돌릴 블록이 없었습니다";
      await refreshStatus();
    });
  }

  void boot();
})();
