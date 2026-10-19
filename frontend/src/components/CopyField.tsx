import { useState } from "react";

export function CopyField({ label, value, mono = true, big }: { label: string; value: string; mono?: boolean; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <span className={`flex-1 select-all break-all ${mono ? "font-mono" : ""} ${big ? "text-2xl tracking-[0.3em]" : "text-base"}`}>
          {value}
        </span>
        <button className="btn-ghost shrink-0 px-2 py-1" onClick={copy}>
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
    </div>
  );
}
