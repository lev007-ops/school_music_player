import { useEffect, useRef, useState } from "react";
import { formatDate, parseDate } from "../lib/format";

/** Text date field in "дд.мм.гггг" format; `value`/`onChange` use ISO "гггг-мм-дд" ("" while incomplete). */
export function DateInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [text, setText] = useState(() => (value ? formatDate(value) : ""));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((parseDate(text) ?? "") !== value) setText(value ? formatDate(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    ref.current?.setCustomValidity(text && !parseDate(text) ? "Введите дату в формате дд.мм.гггг" : "");
  }, [text]);

  return (
    <input
      ref={ref}
      className="input"
      inputMode="numeric"
      placeholder="дд.мм.гггг"
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
        const masked = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
        setText(masked);
        onChange(parseDate(masked) ?? "");
      }}
      required
    />
  );
}
