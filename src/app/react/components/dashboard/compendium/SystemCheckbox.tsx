import React, { useEffect, useRef } from 'react';

interface SystemCheckboxProps {
  selection: 'all' | 'some' | 'none';
  label: string;
  disabled: boolean;
  onToggle: () => void;
}

/** A game system's box: ticked when all its books are, half-ticked when some are. */
export function SystemCheckbox({ selection, label, disabled, onToggle }: SystemCheckboxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selection === 'some';
  }, [selection]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={selection === 'all'}
      disabled={disabled}
      onChange={onToggle}
    />
  );
}
