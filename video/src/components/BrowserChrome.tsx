import React from "react";

// Faked macOS browser window. Renders the child (a captured page screenshot)
// inside a rounded, shadowed container with three traffic dots and a URL
// bar — so the comp reads as a real product demo instead of a slide deck.
//
// The component owns its OWN border-radius + shadow; pass a fully-shaped
// child (an <Img> or a Ken-Burns wrapper) inside the body area.
export const CHROME_HEADER_HEIGHT = 60;
export const CHROME_BORDER_RADIUS = 16;

export const BrowserChrome: React.FC<{
  url: string;
  children: React.ReactNode;
  width: number;
  height: number;
}> = ({ url, children, width, height }) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: CHROME_BORDER_RADIUS,
        background: "#171717",
        boxShadow:
          "0 60px 120px rgba(0, 0, 0, 0.55), 0 25px 50px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          height: CHROME_HEADER_HEIGHT,
          background: "linear-gradient(180deg, #1f1f1f 0%, #161616 100%)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          display: "flex",
          alignItems: "center",
          paddingLeft: 22,
          paddingRight: 22,
          gap: 18,
          flexShrink: 0,
        }}
      >
        {/* Traffic lights */}
        <div style={{ display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div
              key={c}
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: c,
                boxShadow: "inset 0 -1px 0 rgba(0, 0, 0, 0.15)",
              }}
            />
          ))}
        </div>
        {/* URL bar */}
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: 8,
              padding: "7px 22px",
              minWidth: 380,
              maxWidth: 540,
              color: "#a3a3a3",
              fontSize: 14,
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 400,
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              letterSpacing: 0.1,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M9 5V3.5a3 3 0 0 0-6 0V5M3 5h6a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
                stroke="#f97316"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </svg>
            <span>{url}</span>
          </div>
        </div>
        {/* Right-side spacer to balance traffic lights */}
        <div style={{ width: 66 }} />
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
