// ── Field ─────────────────────────────────────

interface FieldProps {
  label: string;
  value: string | number;
  type?: string;
  onChange: (value: string) => void;
}

export function Field({ label, value, type = "text", onChange }: FieldProps) {
  return (
    <label className="field">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
