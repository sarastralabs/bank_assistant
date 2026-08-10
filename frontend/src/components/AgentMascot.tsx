import { useMemo } from "react";

export type MascotMood =
  | "waiting"
  | "ready"
  | "greeting"
  | "listening"
  | "thinking"
  | "speaking";

interface AgentMascotProps {
  mood?: MascotMood;
  className?: string;
}

/**
 * Lobby voice agent mascot — playful + professional, mood-driven motion.
 */
export function AgentMascot({ mood = "waiting", className = "" }: AgentMascotProps) {
  const label = useMemo(() => {
    switch (mood) {
      case "greeting":
        return "ನಮಸ್ಕಾರ!";
      case "listening":
        return "ಕೇಳುತ್ತಿದ್ದೇನೆ…";
      case "thinking":
        return "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…";
      case "speaking":
        return "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…";
      case "ready":
        return "ಸಿದ್ಧ!";
      default:
        return "ಕಾಯುತ್ತಿದ್ದೇನೆ…";
    }
  }, [mood]);

  return (
    <div className={`agent-mascot agent-mascot-${mood} ${className}`} aria-hidden>
      <div className="agent-mascot-glow" />
      <div className="agent-mascot-rings" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="agent-mascot-stage">
        <svg
          className="agent-mascot-svg"
          viewBox="0 0 200 240"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
        >
          <title>Kannada banking assistant bot</title>
          <ellipse className="mascot-shadow" cx="100" cy="222" rx="52" ry="9" fill="rgba(0,0,0,0.28)" />

          <g className="mascot-body-group">
            <g className="mascot-antenna">
              <line x1="100" y1="28" x2="100" y2="48" stroke="#8ec5f0" strokeWidth="3" strokeLinecap="round" />
              <circle className="mascot-antenna-dot" cx="100" cy="22" r="7" fill="#f0c14a" />
            </g>

            <rect x="48" y="48" width="104" height="88" rx="28" fill="#1a6fb5" stroke="#d7ebff" strokeWidth="3" />
            <rect x="58" y="62" width="84" height="58" rx="18" fill="#0d3a66" />

            <g className="mascot-eyes">
              <ellipse className="mascot-eye mascot-eye-l" cx="82" cy="88" rx="12" ry="14" fill="#e8f4ff" />
              <ellipse className="mascot-eye mascot-eye-r" cx="118" cy="88" rx="12" ry="14" fill="#e8f4ff" />
              <circle className="mascot-pupil" cx="84" cy="90" r="5" fill="#12324f" />
              <circle className="mascot-pupil" cx="120" cy="90" r="5" fill="#12324f" />
              <circle cx="86" cy="87" r="1.6" fill="#fff" />
              <circle cx="122" cy="87" r="1.6" fill="#fff" />
            </g>

            {/* mouth — shape changes via CSS per mood */}
            <g className="mascot-mouth">
              <path
                className="mascot-smile"
                d="M78 112 Q100 128 122 112"
                fill="none"
                stroke="#7dd3a7"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <ellipse className="mascot-mouth-open" cx="100" cy="114" rx="10" ry="7" fill="#7dd3a7" opacity="0" />
            </g>

            <circle cx="68" cy="104" r="5" fill="rgba(255,160,140,0.35)" />
            <circle cx="132" cy="104" r="5" fill="rgba(255,160,140,0.35)" />

            <rect x="62" y="142" width="76" height="48" rx="16" fill="#2180d0" stroke="#d7ebff" strokeWidth="2.5" />
            <circle cx="100" cy="164" r="11" fill="#f0c14a" />
            <text
              x="100"
              y="168"
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#1a2a3a"
              fontFamily="Sora, sans-serif"
            >
              ಕ
            </text>

            <g className="mascot-arm mascot-arm-l">
              <rect x="34" y="148" width="28" height="14" rx="7" fill="#1a6fb5" />
              <circle cx="34" cy="155" r="9" fill="#8ec5f0" />
            </g>
            <g className="mascot-arm mascot-arm-r">
              <rect x="138" y="148" width="28" height="14" rx="7" fill="#1a6fb5" />
              <circle cx="166" cy="155" r="9" fill="#8ec5f0" />
            </g>
          </g>

          {/* voice equalizer under feet */}
          <g className="mascot-eq" transform="translate(58 200)">
            <rect className="eq-bar" x="0" y="8" width="8" height="16" rx="3" fill="#7dd3a7" />
            <rect className="eq-bar" x="16" y="4" width="8" height="20" rx="3" fill="#8ec5f0" />
            <rect className="eq-bar" x="32" y="0" width="8" height="24" rx="3" fill="#f0c14a" />
            <rect className="eq-bar" x="48" y="4" width="8" height="20" rx="3" fill="#8ec5f0" />
            <rect className="eq-bar" x="64" y="8" width="8" height="16" rx="3" fill="#7dd3a7" />
            <rect className="eq-bar" x="80" y="6" width="8" height="18" rx="3" fill="#9ec5ef" />
          </g>
        </svg>

        <p className="agent-mascot-bubble">{label}</p>
      </div>
    </div>
  );
}
