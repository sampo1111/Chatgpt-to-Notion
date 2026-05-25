(function () {
  const DEFAULT_BUTTON_THEME = Object.freeze({
    copy: Object.freeze({
      start: "#fffef5",
      end: "#fff7dd",
      text: "#7c2d12"
    }),
    paste: Object.freeze({
      start: "#effcf6",
      end: "#d9fbe8",
      text: "#166534"
    }),
    selection: Object.freeze({
      start: "#fff8e1",
      end: "#ffe9b5",
      text: "#9a3412"
    }),
    toggle: Object.freeze({
      start: "#eefcf4",
      end: "#d8f7e5",
      text: "#166534"
    })
  });

  const DEFAULT_THEME_EFFECTS = Object.freeze({
    copy: Object.freeze({
      hoverStart: "#fff8db",
      hoverEnd: "#ffedba",
      shadowRgb: "124, 45, 18",
      borderRgb: "15, 23, 42"
    }),
    paste: Object.freeze({
      hoverStart: "#dff7e8",
      hoverEnd: "#c4f1d6",
      shadowRgb: "22, 101, 52",
      borderRgb: "15, 23, 42"
    }),
    selection: Object.freeze({
      hoverStart: "#fff2c9",
      hoverEnd: "#ffde95",
      shadowRgb: "146, 64, 14",
      borderRgb: "15, 23, 42"
    }),
    toggle: Object.freeze({
      hoverStart: "#e0f8e8",
      hoverEnd: "#caefd9",
      shadowRgb: "22, 101, 52",
      borderRgb: "22, 101, 52"
    })
  });

  function cloneButtonTheme(theme = DEFAULT_BUTTON_THEME) {
    return {
      copy: { ...theme.copy },
      paste: { ...theme.paste },
      selection: { ...theme.selection },
      toggle: { ...theme.toggle }
    };
  }

  function normalizeHexColor(value, fallback) {
    const text = String(value || "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
      return fallback;
    }

    return text.toLowerCase();
  }

  function normalizeThemeSection(section, fallback) {
    const source = section && typeof section === "object" ? section : {};

    return {
      start: normalizeHexColor(source.start, fallback.start),
      end: normalizeHexColor(source.end, fallback.end),
      text: normalizeHexColor(source.text, fallback.text)
    };
  }

  function normalizeThemeSettings(rawTheme) {
    const theme = rawTheme && typeof rawTheme === "object" ? rawTheme : {};

    return {
      copy: normalizeThemeSection(theme.copy, DEFAULT_BUTTON_THEME.copy),
      paste: normalizeThemeSection(theme.paste, DEFAULT_BUTTON_THEME.paste),
      selection: normalizeThemeSection(theme.selection, DEFAULT_BUTTON_THEME.selection),
      toggle: normalizeThemeSection(theme.toggle, DEFAULT_BUTTON_THEME.toggle)
    };
  }

  function applyButtonThemeVariables(rawTheme, root = document.documentElement) {
    if (!root?.style) {
      return;
    }

    const theme = normalizeThemeSettings(rawTheme);
    applyThemeSection(root.style, "copy", theme.copy, DEFAULT_BUTTON_THEME.copy, DEFAULT_THEME_EFFECTS.copy);
    applyThemeSection(root.style, "paste", theme.paste, DEFAULT_BUTTON_THEME.paste, DEFAULT_THEME_EFFECTS.paste);
    applyThemeSection(
      root.style,
      "selection",
      theme.selection,
      DEFAULT_BUTTON_THEME.selection,
      DEFAULT_THEME_EFFECTS.selection
    );
    applyThemeSection(root.style, "toggle", theme.toggle, DEFAULT_BUTTON_THEME.toggle, DEFAULT_THEME_EFFECTS.toggle);
  }

  function applyThemeSection(style, prefix, theme, defaults, effects) {
    const isDefaultTheme =
      theme.start === defaults.start && theme.end === defaults.end && theme.text === defaults.text;

    const hoverStart = isDefaultTheme ? effects.hoverStart : mixHex(theme.start, "#000000", 0.05);
    const hoverEnd = isDefaultTheme ? effects.hoverEnd : mixHex(theme.end, "#000000", 0.08);
    const shadowRgb = isDefaultTheme
      ? effects.shadowRgb
      : hexToRgbString(mixHex(theme.end, theme.text, 0.35));
    const borderRgb = isDefaultTheme ? effects.borderRgb : hexToRgbString(theme.text);

    style.setProperty(`--ai-to-notion-${prefix}-start`, theme.start);
    style.setProperty(`--ai-to-notion-${prefix}-end`, theme.end);
    style.setProperty(`--ai-to-notion-${prefix}-text`, theme.text);
    style.setProperty(`--ai-to-notion-${prefix}-hover-start`, hoverStart);
    style.setProperty(`--ai-to-notion-${prefix}-hover-end`, hoverEnd);
    style.setProperty(`--ai-to-notion-${prefix}-shadow-rgb`, shadowRgb);
    style.setProperty(`--ai-to-notion-${prefix}-border-rgb`, borderRgb);
  }

  function mixHex(startHex, endHex, amount) {
    const startRgb = hexToRgb(startHex);
    const endRgb = hexToRgb(endHex);
    const weight = clamp(Number(amount) || 0, 0, 1);

    return rgbToHex({
      r: Math.round(startRgb.r + (endRgb.r - startRgb.r) * weight),
      g: Math.round(startRgb.g + (endRgb.g - startRgb.g) * weight),
      b: Math.round(startRgb.b + (endRgb.b - startRgb.b) * weight)
    });
  }

  function hexToRgbString(hex) {
    const rgb = hexToRgb(hex);
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex, "#000000");
    return {
      r: Number.parseInt(normalized.slice(1, 3), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      b: Number.parseInt(normalized.slice(5, 7), 16)
    };
  }

  function rgbToHex(rgb) {
    const r = clampChannel(rgb.r);
    const g = clampChannel(rgb.g);
    const b = clampChannel(rgb.b);
    return `#${r}${g}${b}`;
  }

  function clampChannel(value) {
    return clamp(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, "0");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.AIToNotionButtonTheme = {
    DEFAULT_BUTTON_THEME: cloneButtonTheme(),
    cloneButtonTheme,
    normalizeThemeSettings,
    applyButtonThemeVariables
  };
})();
