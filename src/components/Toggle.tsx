// ── Toggle (CSS sliding switch) ───────────────

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <span
        className={`toggle-track${checked ? " active" : ""}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
      >
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}
