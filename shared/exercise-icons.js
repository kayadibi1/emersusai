// SVG icon strings for exercise types.
// Usage: element.innerHTML = ICONS.resistance;
// All icons are 18x18 viewBox, stroke-based, no fill.

const ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  resistance: `<svg ${ATTRS} stroke="currentColor">
    <line x1="2" y1="12" x2="6" y2="12"/><rect x="6" y="8" width="3" height="8" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/><rect x="15" y="8" width="3" height="8" rx="1"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
  </svg>`,

  cardio: `<svg ${ATTRS} stroke="currentColor">
    <path d="M12 6C12 6 8.5 2 5 4.5S2.5 11 12 20c9.5-9 9-12.5 5.5-15.5S12 6 12 6z"/>
    <polyline points="4,13 9,13 10.5,10 13.5,16 15,13 20,13"/>
  </svg>`,

  bodyweight: `<svg ${ATTRS} stroke="currentColor">
    <circle cx="12" cy="5" r="2.5"/><line x1="12" y1="7.5" x2="12" y2="16"/>
    <line x1="8" y1="11" x2="16" y2="11"/>
    <line x1="12" y1="16" x2="8.5" y2="22"/><line x1="12" y1="16" x2="15.5" y2="22"/>
  </svg>`,

  trophy: `<svg ${ATTRS} stroke="currentColor">
    <path d="M8 2h8v10a4 4 0 0 1-8 0V2z"/>
    <path d="M8 4H5a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4"/>
    <path d="M16 4h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4"/>
    <line x1="12" y1="14" x2="12" y2="18"/><line x1="8" y1="18" x2="16" y2="18"/>
  </svg>`,
};

// Background color classes per category
export const ICON_COLORS = {
  resistance: { bg: "rgba(109,159,255,0.13)", color: "var(--primary)" },
  cardio:     { bg: "rgba(159,251,0,0.10)",   color: "var(--secondary)" },
  bodyweight: { bg: "rgba(255,255,255,0.06)",  color: "var(--muted)" },
};

// Type dot color
export const DOT_COLORS = {
  resistance: "var(--primary)",
  cardio:     "var(--secondary)",
  bodyweight: "var(--muted)",
  mixed:      "var(--primary-dim)",
};
