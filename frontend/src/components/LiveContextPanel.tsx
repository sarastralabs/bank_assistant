import type { FormField } from "../api/client";
import { displayFieldValue } from "../utils/formSummary";

interface FormDigitSlotsProps {
  value: string;
  maxSlots?: number;
  label?: string;
}

export function FormDigitSlots({ value, maxSlots = 10, label }: FormDigitSlotsProps) {
  const digits = (value || "").replace(/\D/g, "").split("");
  const slots = Math.max(maxSlots, digits.length);

  return (
    <div className="live-digit-slots" aria-label={label || "Account digits"}>
      <div className="live-digit-row">
        {Array.from({ length: slots }, (_, i) => {
          const filled = i < digits.length;
          return (
            <span
              key={i}
              className={`live-digit-slot${filled ? " is-filled" : ""}`}
              aria-hidden
            >
              {filled ? digits[i] : ""}
            </span>
          );
        })}
      </div>
      {value && (
        <p className="live-digit-mask">{displayFieldValue("account_number", "digits", value)}</p>
      )}
    </div>
  );
}

interface FormFilledChipsProps {
  fields: FormField[];
  values: Record<string, string>;
  currentFieldId?: string;
}

export function FormFilledChips({ fields, values, currentFieldId }: FormFilledChipsProps) {
  const filled = fields.filter((f) => {
    const v = values[f.id];
    return v !== undefined && v !== "";
  });

  if (filled.length === 0) return null;

  return (
    <div className="live-filled-chips" aria-label="Filled fields">
      {filled.map((f) => {
        const v = values[f.id] || "";
        const done = f.id !== currentFieldId;
        return (
          <span key={f.id} className={`live-chip${done ? " is-done" : " is-active"}`}>
            {done ? "✓ " : "○ "}
            {f.label_kn}: {displayFieldValue(f.id, f.type, v)}
          </span>
        );
      })}
    </div>
  );
}

export interface BalanceResultView {
  found: boolean;
  account_number: string;
  balance_inr?: number;
  holder_name_kn?: string;
  message_kn: string;
  message_en: string;
}

interface BalanceResultCardProps {
  result: BalanceResultView;
}

export function BalanceResultCard({ result }: BalanceResultCardProps) {
  const maskedAcct = displayFieldValue("account_number", "digits", result.account_number);
  const balanceText =
    result.found && result.balance_inr !== undefined
      ? `₹ ${result.balance_inr.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
      : null;

  return (
    <section className="balance-result-card panel" aria-live="polite">
      <h3 className="balance-result-title">ಖಾತೆಯ ಶಿಲ್ಕು · Balance</h3>
      {result.found ? (
        <>
          {result.holder_name_kn && (
            <p className="balance-result-name kn">{result.holder_name_kn}</p>
          )}
          <p className="balance-result-acct">
            <span className="balance-result-label">ಖಾತೆ</span> {maskedAcct}
          </p>
          {balanceText && <p className="balance-result-amount">{balanceText}</p>}
        </>
      ) : null}
      <p className="balance-result-msg kn">{result.message_kn}</p>
      {result.message_en && <p className="balance-result-msg-en muted">{result.message_en}</p>}
    </section>
  );
}

export interface FormSummaryLineView {
  field_id: string;
  label_kn: string;
  display_kn: string;
  speak_kn: string;
}

interface FormSummaryPanelProps {
  lines: FormSummaryLineView[];
  activeIndex?: number;
}

export function FormSummaryPanel({ lines, activeIndex = -1 }: FormSummaryPanelProps) {
  if (!lines.length) return null;
  return (
    <div className="live-summary-panel">
      <h3 className="live-summary-title">ಅರ್ಜಿಯ ಸಾರಾಂಶ</h3>
      <ul className="live-summary-list">
        {lines.map((line, i) => (
          <li
            key={line.field_id}
            className={`live-summary-line${i === activeIndex ? " is-active" : ""}`}
          >
            <span className="live-summary-label">{line.label_kn}</span>
            <strong className="live-summary-value">{line.display_kn}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LiveValueCardProps {
  label: string;
  value: string;
  fieldType?: string;
  fieldId?: string;
}

export function LiveValueCard({ label, value, fieldType = "text", fieldId = "" }: LiveValueCardProps) {
  if (!value) return null;
  const display = displayFieldValue(fieldId, fieldType, value);
  const showSlots = fieldType === "digits" && value.replace(/\D/g, "").length > 0;

  return (
    <div className="live-value-card">
      <p className="live-value-label">{label}</p>
      {showSlots ? (
        <FormDigitSlots value={value} label={label} />
      ) : (
        <p className="live-value-text">{display}</p>
      )}
    </div>
  );
}
