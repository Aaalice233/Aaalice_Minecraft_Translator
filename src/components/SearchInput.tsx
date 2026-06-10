import { Search, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  debounceMs = 200,
  className,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebouncedValue(localValue, debounceMs);

  useEffect(() => {
    onChange(debouncedValue);
  }, [debouncedValue]);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className={`app-search-input ${className || ""}`}>
      <Search size={17} />
      <input
        type="text"
        className="app-search-input-field"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
      />
      {localValue && (
        <button
          className="app-search-input-clear"
          onClick={() => setLocalValue("")}
          type="button"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
