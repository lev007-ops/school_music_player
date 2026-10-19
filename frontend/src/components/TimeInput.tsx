import { useEffect, useRef } from "react";

/** Text time field in 24-hour "ЧЧ:ММ" format (native time inputs show AM/PM in some locales). */
export function TimeInput({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.setCustomValidity(value && !parseTime(value) ? "Введите время в формате ЧЧ:ММ" : "");
  }, [value]);

  return (
    <input
      ref={ref}
      className={`input py-1.5 tabular-nums ${value && !parseTime(value) ? "border-rose-300" : ""}`}
      inputMode="numeric"
      placeholder="ЧЧ:ММ"
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
        onChange(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
      }}
      onBlur={() => {
        // "9:30" / "930" → "09:30"
        const digits = value.replace(/\D/g, "");
        if (digits.length === 3) onChange(`0${digits[0]}:${digits.slice(1)}`);
      }}
    />
  );
}

export function parseTime(text: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}
