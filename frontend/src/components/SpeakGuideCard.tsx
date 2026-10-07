import { useState } from "react";

// Accounts whose last 4 digits are unique — saying those 4 gets the balance directly.
// (Full list of 25 incl. shared endings: docs/WHAT_TO_SPEAK.md §5.)
const DEMO_ACCOUNTS = [
  { number: "1234567890", name: "ರಾಮೇಶ್ · Ramesh", balance: "₹45,230.50" },
  { number: "9876543210", name: "ಅನಿತಾ · Anita", balance: "₹12,500.00" },
  { number: "2222333344", name: "ಲಕ್ಷ್ಮಿ · Lakshmi", balance: "₹67,890.25" },
  { number: "3456789012", name: "ವಿಜಯ್ · Vijay", balance: "₹8,750.00" },
  { number: "4567890123", name: "ಕವಿತಾ · Kavitha", balance: "₹1,25,000.00" },
  { number: "6789012345", name: "ಮೋಹನ್ · Mohan", balance: "₹32,400.75" },
];

interface SpeakGuideCardProps {
  compact?: boolean;
}

function preferGuideOpen(compact: boolean): boolean {
  if (compact) return false;
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 720px) and (min-height: 700px)").matches;
}

/**
 * How to talk to the kiosk agent — shown before/during conversation.
 */
export function SpeakGuideCard({ compact = false }: SpeakGuideCardProps) {
  const [open, setOpen] = useState(() => preferGuideOpen(compact));

  return (
    <section
      className={`speak-guide ${compact ? "speak-guide--compact" : ""}`}
      aria-label="Speaking guidelines"
    >
      <button
        type="button"
        className="speak-guide-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="speak-guide-title kn">ಹೇಗೆ ಮಾತನಾಡುವುದು · How to speak</span>
        <span className="speak-guide-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="speak-guide-body">
          <ol className="speak-guide-steps">
            <li>
              <strong>ಕಾಯಿರಿ · Wait</strong>
              <span>
                Speak only when the big status turns green “ಈಗ ಮಾತನಾಡಿ · Speak now”. While it says
                “Please wait” or “Listen”, do not talk yet.
              </span>
            </li>
            <li>
              <strong>ಕನ್ನಡದಲ್ಲಿ ಸ್ಪಷ್ಟವಾಗಿ · Clear Kannada</strong>
              <span>One short request at a time. Pause briefly between account digits.</span>
            </li>
            <li>
              <strong>ಬ್ಯಾಲೆನ್ಸ್ · Balance</strong>
              <span>
                Say “ಖಾತೆ ಬ್ಯಾಲೆನ್ಸ್”, then the <em>last 4</em> digits of the account (e.g.
                seven-eight-nine-zero). If asked, say the last 6.
              </span>
            </li>
            <li>
              <strong>ಅರ್ಜಿ · Forms</strong>
              <span>Follow each question. Confirm with “ಹೌದು”, correct with “ಮತ್ತೆ ಹೇಳಿ” / “ಇಲ್ಲ”.</span>
            </li>
            <li>
              <strong>ಮುಗಿಸು · End</strong>
              <span>Say “ಮುಗಿಸು” or “goodbye” when finished.</span>
            </li>
          </ol>

          <div className="speak-guide-examples">
            <p className="speak-guide-examples-title">Try saying</p>
            <ul>
              <li>“ನನ್ನ ಖಾತೆ ಬ್ಯಾಲೆನ್ಸ್ ಹೇಳಿ”</li>
              <li>“ಸೇವಿಂಗ್ಸ್ ಅಕೌಂಟ್ ತೆರೆಯುವುದು ಹೇಗೆ”</li>
              <li>“ಚೆಕ್‌ಬುಕ್ ಅರ್ಜಿ”</li>
            </ul>
          </div>

          <div className="speak-guide-accounts">
            <p className="speak-guide-examples-title">Demo accounts (say the last 4 digits)</p>
            <ul className="speak-guide-account-list">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.number}>
                  <code>
                    {a.number.slice(0, -4)}
                    <strong>{a.number.slice(-4)}</strong>
                  </code>
                  <span>{a.name}</span>
                  <span className="speak-guide-bal">{a.balance}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
