import React, { useState, type ReactElement } from 'react';
import { ABILITIES, ALIGNMENTS, DND5E_2024_FIELDS, SKILLS, deriveDnd5e, signed } from './dnd5e2024.ts';
import { DND5E_EDITION_LABELS, DND5E_LABELS as L } from './dnd5eLabels.ts';
import type { SheetRow, SheetValue, SheetValues } from './sheetFields.ts';
import { Check, NumberInput, Roll, RowsTable, TextInput, type RowColumn } from './sheetInputs.tsx';

/** The current hit points, where the sheet's host knows them (the token's own value) and how to change them. */
export interface SheetHitPoints {
  readonly current: number;
  readonly max: number;
  readonly set?: (current: number) => void;
}

export interface CharacterSheetProps {
  readonly values: SheetValues;
  readonly editable: boolean;
  readonly onSet: (key: string, value: SheetValue) => void;
  readonly onRow: (key: string, index: number, row: SheetRow | null) => void;
  /** Rolls a formula for the character, named by what it rolls; absent where nothing rolls (a sheet read away from a table). */
  readonly onRoll?: ((formula: string, label: string) => void) | undefined;
  readonly hitPoints?: SheetHitPoints | undefined;
  /** Shown as a tab of its own after the sheet's (the notes the GM links for the player, or the GM's own linking of them). */
  readonly notes?: ReactElement | undefined;
  /** The character's book (its items and coins), as a tab of its own: the GM's way into it. */
  readonly book?: ReactElement | undefined;
}

type Tab = keyof typeof L.tabs;

const str = (value: SheetValue | undefined): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const num = (value: SheetValue | undefined, fallback = 0): number => (typeof value === 'number' ? value : fallback);
const list = (value: SheetValue | undefined): readonly string[] => (Array.isArray(value) ? (value as readonly unknown[]).filter((entry): entry is string => typeof entry === 'string') : []);
const nums = (value: SheetValue | undefined, length: number): readonly number[] => Array.from({ length }, (_, index) => (Array.isArray(value) && typeof value[index] === 'number' ? (value[index]) : 0));
const rows = (value: SheetValue | undefined): readonly SheetRow[] => (Array.isArray(value) ? (value as readonly SheetRow[]).filter((row) => typeof row === 'object' && row !== null) : []);
const d20 = (bonus: number): string => `1d20${bonus === 0 ? '' : signed(bonus)}`;
/** The dice a text begins with ("1d8+3 piercing" → "1d8+3"), or null where it begins with none. */
export const diceOf = (text: string): string | null => /^\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)/i.exec(text)?.[1]?.replace(/\s+/g, '') ?? null;
/** A to-hit bonus as written ("+5", "5", "-1") as a d20 roll, or null. */
const toHit = (text: string): string | null => (/^\s*[+-]?\d+\s*$/.test(text) ? d20(Number(text)) : null);

const cells = DND5E_2024_FIELDS;
const isTab = (id: string): id is Tab => Object.hasOwn(L.tabs, id);
const rowCells = (key: string): Record<string, RowColumn['spec']> => {
  const spec = cells[key];
  return spec?.kind === 'rows' ? { ...spec.cells } : {};
};

/**
 * A 2024 character sheet as Roll20 lays one out: who the character is above, then the abilities,
 * saving throws and skills beside combat on the first tab, and spells, traits and story on the others,
 * under the 2014 or the 2024 rules (`system`), which name a few things differently. Everything that follows from the sheet is worked out (`deriveDnd5e`), never typed;
 * a modifier, a save, a skill, the initiative and an attack roll when clicked.
 */
export function Dnd5eSheet({ system, values, editable, onSet, onRow, onRoll, hitPoints, notes, book }: CharacterSheetProps & { system: keyof typeof DND5E_EDITION_LABELS }): ReactElement {
  const E = DND5E_EDITION_LABELS[system];
  const [tab, setTab] = useState<Tab>('main');
  const derived = deriveDnd5e(values);
  const stats = nums(values.stats, 6);
  const set = (key: string) => (value: SheetValue): void => onSet(key, value);
  const toggle = (key: string, id: string, on: boolean): void => {
    const current = list(values[key]);
    onSet(key, on ? [...current, id] : current.filter((entry) => entry !== id));
  };
  const tabs = Object.keys(L.tabs).filter(isTab).filter((id) => (id !== 'notes' || notes !== undefined) && (id !== 'book' || book !== undefined));

  return (
    <div className="atlas-sheet" data-system={system}>
      <header className="atlas-sheet-header">
        <TextInput className="atlas-sheet-name" value={str(values.name)} onChange={set('name')} editable={editable} label={L.name} maxLength={120} />
        <div className="atlas-sheet-identity">
          <Labelled label={L.class}><TextInput value={str(values.class)} onChange={set('class')} editable={editable} label={L.class} /></Labelled>
          <Labelled label={L.subclass}><TextInput value={str(values.subclass)} onChange={set('subclass')} editable={editable} label={L.subclass} /></Labelled>
          <Labelled label={L.level}><NumberInput value={num(values.level, 1)} onChange={set('level')} editable={editable} label={L.level} min={1} max={20} /></Labelled>
          <Labelled label={E.species}><TextInput value={str(values.species)} onChange={set('species')} editable={editable} label={E.species} /></Labelled>
          <Labelled label={L.background}><TextInput value={str(values.background)} onChange={set('background')} editable={editable} label={L.background} /></Labelled>
          <Labelled label={L.alignment}>
            <select className="atlas-sheet-input" aria-label={L.alignment} value={str(values.alignment)} disabled={!editable} onChange={(event) => onSet('alignment', event.target.value)}>
              <option value="">{L.none}</option>
              {ALIGNMENTS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Labelled>
          <Labelled label={L.xp}><NumberInput value={num(values.xp)} onChange={set('xp')} editable={editable} label={L.xp} min={0} max={1_000_000} /></Labelled>
        </div>
        <div className="atlas-sheet-badges">
          <Badge label={L.proficiency} value={signed(derived.proficiency)} />
          <label className="atlas-sheet-badge"><span>{E.inspiration}</span><Check value={values.inspiration === true} onChange={set('inspiration')} editable={editable} label={E.inspiration} /></label>
        </div>
      </header>

      <nav className="atlas-sheet-tabs" role="tablist">
        {tabs.map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className="atlas-sheet-tab" onClick={() => setTab(id)}>{L.tabs[id]}</button>)}
      </nav>

      {tab === 'main' && (
        <div className="atlas-sheet-main">
          <section className="atlas-sheet-abilities" aria-label="Caractéristiques">
            {ABILITIES.map((ability, index) => (
              <div key={ability} className="atlas-sheet-ability">
                <span className="atlas-sheet-ability__name">{L.abilities[ability]}</span>
                <Roll className="atlas-sheet-ability__mod" value={signed(derived.modifiers[ability])} label={L.check(L.abilities[ability])} formula={d20(derived.modifiers[ability])} onRoll={onRoll} />
                <NumberInput className="atlas-sheet-ability__score" value={stats[index] ?? 10} editable={editable} label={L.abilities[ability]} min={1} max={30}
                  onChange={(score) => onSet('stats', stats.map((old, at) => (at === index ? score : old)))} />
              </div>
            ))}
          </section>

          <section className="atlas-sheet-column">
            <Box title={L.savesTitle}>
              {ABILITIES.map((ability) => (
                <ProficiencyLine key={ability} label={L.abilities[ability]} value={derived.saves[ability]} rollLabel={L.save(L.abilities[ability])} onRoll={onRoll}
                  proficient={list(values['save-proficiencies']).includes(ability)} onProficient={(on) => toggle('save-proficiencies', ability, on)} editable={editable} />
              ))}
            </Box>
            <Box title={L.skillsTitle}>
              {SKILLS.map(([skill, ability]) => (
                <ProficiencyLine key={skill} label={`${L.skills[skill] ?? skill} (${L.short[ability]})`} value={derived.skills[skill] ?? 0} rollLabel={L.check(L.skills[skill] ?? skill)} onRoll={onRoll}
                  proficient={list(values['skill-proficiencies']).includes(skill)} onProficient={(on) => toggle('skill-proficiencies', skill, on)} editable={editable}
                  expert={list(values['skill-expertise']).includes(skill)} onExpert={(on) => toggle('skill-expertise', skill, on)} />
              ))}
            </Box>
            <Badge label={L.passive} value={String(derived.passivePerception)} />
          </section>

          <section className="atlas-sheet-column">
            <div className="atlas-sheet-combat">
              <Labelled label={L.ac} big><NumberInput value={num(values.ac, 10)} onChange={set('ac')} editable={editable} label={L.ac} min={0} max={50} /></Labelled>
              <Labelled label={L.initiative} big><Roll value={signed(derived.initiative)} label={L.initiative} formula={d20(derived.initiative)} onRoll={onRoll} /></Labelled>
              <Labelled label={L.speed} big><TextInput value={str(values.speed)} onChange={set('speed')} editable={editable} label={L.speed} /></Labelled>
            </div>
            <div className="atlas-sheet-combat">
              {hitPoints !== undefined && (
                <Labelled label={L.hpCurrent} big>
                  <NumberInput value={hitPoints.current} onChange={(current) => hitPoints.set?.(current)} editable={hitPoints.set !== undefined} label={L.hpCurrent} min={0} max={Math.max(0, hitPoints.max)} />
                </Labelled>
              )}
              <Labelled label={L.hpMax} big><NumberInput value={num(values.hp)} onChange={set('hp')} editable={editable} label={L.hpMax} min={0} max={9_999} /></Labelled>
              <Labelled label={L.hpTemp} big><NumberInput value={num(values['hp-temp'])} onChange={set('hp-temp')} editable={editable} label={L.hpTemp} min={0} max={9_999} /></Labelled>
            </div>
            <div className="atlas-sheet-combat">
              <Labelled label={L.hitDice}><TextInput value={str(values['hit-dice'])} onChange={set('hit-dice')} editable={editable} label={L.hitDice} /></Labelled>
              <Labelled label={L.hitDiceSpent}><NumberInput value={num(values['hit-dice-spent'])} onChange={set('hit-dice-spent')} editable={editable} label={`${L.hitDice} ${L.hitDiceSpent}`} min={0} max={40} /></Labelled>
              <Labelled label={L.initiativeBonus}><NumberInput value={num(values['initiative-bonus'])} onChange={set('initiative-bonus')} editable={editable} label={L.initiativeBonus} min={-20} max={20} /></Labelled>
            </div>
            <Box title={L.deathSaves}>
              <Marks label={L.successes} count={num(values['death-successes'])} onChange={set('death-successes')} editable={editable} />
              <Marks label={L.failures} count={num(values['death-failures'])} onChange={set('death-failures')} editable={editable} />
            </Box>
            <Box title={L.attacks}>
              <RowsTable label={L.attacks} rows={rows(values.attacks)} editable={editable} onRow={(index, row) => onRow('attacks', index, row)} addLabel={L.add} removeLabel={L.remove} onRoll={onRoll}
                columns={[
                  { key: 'name', label: L.attackName, spec: rowCells('attacks').name!, width: '1.4fr' },
                  { key: 'bonus', label: L.attackBonus, spec: rowCells('attacks').bonus!, width: '70px', roll: (row) => toHit(String(row.bonus ?? '')) },
                  { key: 'damage', label: L.damage, spec: rowCells('attacks').damage!, width: '1.4fr', roll: (row) => diceOf(String(row.damage ?? '')) },
                ]} />
            </Box>
            <Box title={L.languages}><TextInput value={str(values.languages)} onChange={set('languages')} editable={editable} label={L.languages} multiline maxLength={500} /></Box>
            <Box title={L.proficiencies}><TextInput value={str(values.proficiencies)} onChange={set('proficiencies')} editable={editable} label={L.proficiencies} multiline maxLength={1_000} /></Box>
          </section>
        </div>
      )}

      {tab === 'spells' && (
        <div className="atlas-sheet-page">
          <div className="atlas-sheet-combat">
            <Labelled label={L.spellAbility}>
              <select className="atlas-sheet-input" aria-label={L.spellAbility} value={str(values['spell-ability'])} disabled={!editable} onChange={(event) => onSet('spell-ability', event.target.value)}>
                <option value="">{L.none}</option>
                {(['int', 'wis', 'cha'] as const).map((ability) => <option key={ability} value={ability}>{L.abilities[ability]}</option>)}
              </select>
            </Labelled>
            <Badge label={L.spellDc} value={derived.spellSaveDc === null ? L.none : String(derived.spellSaveDc)} />
            <Labelled label={L.spellAttack} big>
              <Roll value={derived.spellAttack === null ? L.none : signed(derived.spellAttack)} label={L.spellAttack} formula={derived.spellAttack === null ? null : d20(derived.spellAttack)} onRoll={onRoll} />
            </Labelled>
          </div>
          <Box title={L.slots}>
            <div className="atlas-sheet-slots">
              {nums(values['spell-slots'], 9).map((max, index) => {
                const spent = nums(values['spell-slots-spent'], 9);
                return (
                  <div key={index} className="atlas-sheet-slot">
                    <span>{index + 1}</span>
                    <NumberInput value={max} label={`${L.slots} ${index + 1}`} editable={editable} min={0} max={9} onChange={(value) => onSet('spell-slots', nums(values['spell-slots'], 9).map((old, at) => (at === index ? value : old)))} />
                    <NumberInput value={spent[index] ?? 0} label={`${L.slotsSpent} ${index + 1}`} editable={editable} min={0} max={9} onChange={(value) => onSet('spell-slots-spent', spent.map((old, at) => (at === index ? value : old)))} />
                  </div>
                );
              })}
            </div>
          </Box>
          <RowsTable label={L.tabs.spells} rows={rows(values['spell-list'])} editable={editable} onRow={(index, row) => onRow('spell-list', index, row)} addLabel={L.add} removeLabel={L.remove} onRoll={onRoll}
            columns={[
              { key: 'level', label: L.spellLevel, spec: rowCells('spell-list').level!, width: '60px' },
              { key: 'name', label: L.spellName, spec: rowCells('spell-list').name!, width: '1.4fr' },
              { key: 'prepared', label: L.prepared, spec: rowCells('spell-list').prepared!, width: '70px' },
              { key: 'notes', label: L.notes, spec: rowCells('spell-list').notes!, width: '1.6fr', roll: (row) => diceOf(String(row.notes ?? '')) },
            ]} />
        </div>
      )}

      {tab === 'traits' && (
        <div className="atlas-sheet-page">
          <RowsTable label={L.tabs.traits} rows={rows(values.traits)} editable={editable} onRow={(index, row) => onRow('traits', index, row)} addLabel={L.add} removeLabel={L.remove} onRoll={onRoll}
            columns={[
              { key: 'name', label: L.traitName, spec: rowCells('traits').name!, width: '1fr' },
              { key: 'desc', label: L.traitDesc, spec: rowCells('traits').desc!, width: '2.4fr' },
            ]} />
        </div>
      )}

      {tab === 'story' && (
        <div className="atlas-sheet-page atlas-sheet-story">
          {(['personality', 'ideals', 'bonds', 'flaws', 'appearance', 'backstory'] as const).map((key) => (
            <Box key={key} title={L[key]}><TextInput value={str(values[key])} onChange={set(key)} editable={editable} label={L[key]} multiline maxLength={key === 'backstory' ? 4_000 : 1_000} /></Box>
          ))}
        </div>
      )}

      {tab === 'notes' && notes}
      {tab === 'book' && book}
    </div>
  );
}

function Labelled({ label, children, big }: { label: string; children: React.ReactNode; big?: boolean }): ReactElement {
  return <label className={`atlas-sheet-labelled${big ? ' atlas-sheet-labelled--big' : ''}`}><span className="atlas-sheet-label">{label}</span>{children}</label>;
}

function Badge({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="atlas-sheet-badge"><span>{label}</span><strong>{value}</strong></div>;
}

function Box({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return <div className="atlas-sheet-box"><h3 className="atlas-sheet-box__title">{title}</h3>{children}</div>;
}

/** A saving throw or skill: the proficiency box (and expertise), its name, and its bonus, which rolls. */
function ProficiencyLine({ label, value, rollLabel, onRoll, proficient, onProficient, expert, onExpert, editable }: {
  label: string; value: number; rollLabel: string; onRoll: CharacterSheetProps['onRoll']; proficient: boolean; onProficient: (on: boolean) => void;
  expert?: boolean; onExpert?: (on: boolean) => void; editable: boolean;
}): ReactElement {
  return (
    <div className="atlas-sheet-line">
      <Check value={proficient} onChange={onProficient} editable={editable} label={`${L.proficient} ${label}`} />
      {onExpert !== undefined && <Check className="atlas-sheet-expertise" value={expert === true} onChange={onExpert} editable={editable} label={`${L.expertise} ${label}`} />}
      <Roll className="atlas-sheet-line__value" value={signed(value)} label={rollLabel} formula={d20(value)} onRoll={onRoll} />
      <span className="atlas-sheet-line__label">{label}</span>
    </div>
  );
}

/** Three boxes for a count of three (death saves). */
function Marks({ label, count, onChange, editable }: { label: string; count: number; onChange: (count: number) => void; editable: boolean }): ReactElement {
  return (
    <div className="atlas-sheet-marks">
      <span>{label}</span>
      {[1, 2, 3].map((mark) => <Check key={mark} value={count >= mark} editable={editable} label={`${label} ${mark}`} onChange={(on) => onChange(on ? mark : mark - 1)} />)}
    </div>
  );
}
