import React, { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { CompendiumChoice, PickKind, SheetCompendium } from './sheetCompendium.ts';
import { DND5E_LABELS as L } from './dnd5eLabels.ts';

/**
 * The compendium's entries of one kind, over the sheet: a search, the list, and for the GM a button
 * that makes a new entry. Choosing one takes it into the sheet and closes the list.
 */
export function CompendiumPicker({ kind, compendium, onClose }: { kind: PickKind; compendium: SheetCompendium; onClose: () => void }): ReactElement {
  const [choices, setChoices] = useState<readonly CompendiumChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    compendium.choices(kind).then((found) => { if (live) setChoices(found); }, () => { if (live) setFailed(true); });
    input.current?.focus();
    return () => { live = false; };
  }, [compendium, kind]);
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (choices ?? []).filter((choice) => words === '' || choice.name.toLowerCase().includes(words));
  }, [choices, search]);
  const create = compendium.create;

  return (
    <div className="atlas-sheet-picker" role="dialog" aria-label={L.pick.title[kind]} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="atlas-sheet-picker__panel">
        <div className="atlas-sheet-picker__head">
          <strong>{L.pick.title[kind]}</strong>
          <button type="button" className="atlas-sheet-remove" aria-label={L.pick.close} onClick={onClose}>×</button>
        </div>
        <div className="atlas-sheet-picker__search">
          <input ref={input} className="atlas-sheet-input" type="search" aria-label={L.pick.search} placeholder={L.pick.search} value={search} onChange={(event) => setSearch(event.target.value)} />
          {create !== undefined && (
            <button type="button" className="atlas-sheet-add" aria-label={L.pick.create(kind)} onClick={() => { create(kind, search.trim()); onClose(); }}>+</button>
          )}
        </div>
        {choices === null && !failed && <p className="atlas-sheet-hint">{L.pick.loading}</p>}
        {failed && <p className="atlas-sheet-hint">{L.pick.failed}</p>}
        {choices !== null && shown.length === 0 && <p className="atlas-sheet-hint">{choices.length === 0 ? L.pick.none : L.pick.noMatch}</p>}
        <ul className="atlas-sheet-picker__list" role="listbox" aria-label={L.pick.title[kind]}>
          {shown.map((choice) => (
            <li key={choice.id}>
              <button type="button" role="option" aria-selected={false} className="atlas-sheet-picker__choice" onClick={() => { compendium.pick(kind, choice); onClose(); }}>
                <span>{choice.name}</span>
                {choice.detail !== undefined && choice.detail !== '' && <span className="atlas-sheet-picker__detail">{choice.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
