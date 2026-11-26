import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen, Circle, CircleX, Dices, DoorClosed, DoorOpen, Eraser, Flame, Flashlight, Footprints, Gem, Hand, KeyRound, Lock, MessageSquare, Package, Pencil, Ruler,
  Skull, Stamp, Swords, Trash2, Triangle, TriangleAlert, Type,
} from 'lucide-react';
import type { AdvantageSide, SharedRollDice } from '../../../src/app/online/protocol/dice.ts';
import { rollsSetDice } from '../../../src/app/tools/diceAdvantage.ts';
import { t } from '../../../src/app/i18n/index.ts';
import { DropdownMenuItem } from '../../../src/app/packages/components/primitives/DropdownMenuItem.tsx';
import { DropdownModeSelector } from '../../../src/app/packages/components/primitives/DropdownModeSelector.tsx';
import { DropdownSliderRow } from '../../../src/app/packages/components/primitives/DropdownSliderRow.tsx';
import { SegmentedControl } from '../../../src/app/packages/components/primitives/SegmentedControl.tsx';
import { DropdownSwatchGrid } from '../../../src/app/packages/components/primitives/DropdownSwatchGrid.tsx';
import { DropdownToggleRow } from '../../../src/app/packages/components/primitives/DropdownToggleRow.tsx';
import { ToolButton } from '../../../src/app/packages/components/primitives/ToolButton.tsx';
import { LabelTooltip, TooltipProvider } from '../../../src/app/packages/components/primitives/tooltip.tsx';
import { ToolGroup, type ToolGroupFace } from '../../../src/app/packages/components/toolbar/ToolGroup.tsx';
import { DiceTray } from '../../../src/app/react/components/dice/DiceTray.tsx';
import type { DiceShelf } from '../../../src/app/react/components/dice/diceShelf.ts';
import type { DicePreset } from '../../../src/app/types/dicePresetTypes.ts';
import { stampIconName } from '../../../src/app/pixi/mapIcons.ts';
import { DRAW_SIZES, type DrawSize } from '../../../src/app/annotations/annotationTypes.ts';
import { setRollText } from '../../../src/app/gameSystems/diceSets.ts';
import { parseFormula } from '../../../src/app/tools/parseFormula.ts';
import { emptyTrayMemory, type DiceTrayMemory } from '../../../src/app/tools/diceTrayMemory.ts';
import { LASER_COLOR_HINT, LASER_COLOR_SWATCHES, LASER_SIZE_MAX, LASER_SIZE_MIN } from '../../../src/app/tools/laserPointerSettings.ts';
import { TEXT } from './text.ts';
import type { PlayerTool, ToolSettingsStore } from './toolSettings.ts';

/** What the toolbar asks of the page. */
export interface ToolbarHost {
  readonly settings: ToolSettingsStore;
  setTool(tool: PlayerTool): void;
  /** Takes back every drawing of the player's in the scene. */
  deleteMyDrawings(): void;
  /** Rolls the tray's formula; false when it cannot (no scene), and the tray keeps it. */
  roll(formula: string, advantage: AdvantageSide | null): boolean;
  /** Rolls a designed roll of the GM's dice row, which the GM's Atlas rolls with its own dice (`PlayerRoll.preset`). */
  rollPreset(preset: DicePreset, advantage: AdvantageSide | null): boolean;
  toggleChat(): void;
  toggleBook(): void;
}

/** What the page tells the toolbar. */
export interface ToolbarState {
  readonly advantage: readonly AdvantageSide[];
  /** The map's dice, which advantage changes; null while the GM names none (an older GM): advantage then goes with any roll. */
  readonly dice: SharedRollDice['dice'] | null;
  readonly book: boolean;
  /** The GM's dice row (`rules.diceRow`); undefined while the GM has the standard dice. */
  readonly shelf?: DiceShelf | undefined;
}

/** The GM's keys for these tools (`MAP_HOTKEYS` defaults), shown as the GM's toolbar shows them. */
const KEYS = { move: 'V', draw: 'B', text: 'T', measure: 'M', dice: 'R' } as const;

/** Stampable map icons, as the GM's draw menu offers them (`DrawToolGroup`). */
const MAP_ICON_OPTIONS = [
  { key: 'door-open', icon: DoorOpen }, { key: 'door-closed', icon: DoorClosed }, { key: 'lock', icon: Lock }, { key: 'key-round', icon: KeyRound },
  { key: 'triangle-alert', icon: TriangleAlert }, { key: 'skull', icon: Skull }, { key: 'flame', icon: Flame }, { key: 'package', icon: Package },
  { key: 'gem', icon: Gem }, { key: 'swords', icon: Swords }, { key: 'footprints', icon: Footprints }, { key: 'circle-x', icon: CircleX },
] as const;

/** The Draw tool's named sizes, as the GM's draw menu offers them. */
const SIZE_OPTIONS = DRAW_SIZES.map((size) => ({ value: size, label: TEXT.toolbar.sizes[size] }));

/** A named size under its label. */
function SizeRow({ label, value, onChange }: { label: string; value: DrawSize; onChange: (size: DrawSize) => void }): ReactElement {
  return (
    <div className="space-y-2">
      <span className="atlas-dropdown-label">{label}</span>
      <SegmentedControl<DrawSize> value={value} options={SIZE_OPTIONS} ariaLabel={label} onChange={onChange} />
    </div>
  );
}

/** Text colours, as the GM's text menu offers them (`TextToolGroup`). */
const TEXT_COLOR_SWATCHES = [
  { value: '#ffffff', label: t('color.white') }, { value: '#000000', label: t('color.black') }, { value: '#e93147', label: t('color.red') }, { value: '#ec7500', label: t('color.orange') },
  { value: '#e0ac00', label: t('color.yellow') }, { value: '#08b94e', label: t('color.green') }, { value: '#086ddd', label: t('color.blue') }, { value: '#7852ee', label: t('color.purple') },
] as const;

type Menu = 'move' | 'draw' | 'text' | 'measure' | 'dice' | null;

function moveFace(tool: PlayerTool): ToolGroupFace & { tool: PlayerTool } {
  const laser = tool === 'laser';
  return { icon: laser ? Flashlight : Hand, label: laser ? t('toolbar.laser') : t('toolbar.moveSelect'), tool: laser ? 'laser' : 'move', isActive: laser || tool === 'move' };
}

function drawFace(tool: PlayerTool): ToolGroupFace & { tool: PlayerTool } {
  if (tool === 'draw-eraser') return { icon: Eraser, label: TEXT.toolbar.drawingEraser, tool, isActive: true };
  if (tool === 'draw-icon') return { icon: Stamp, label: TEXT.toolbar.iconStamp, tool, isActive: true };
  return { icon: Pencil, label: TEXT.toolbar.drawTool, tool: 'draw-pen', isActive: tool === 'draw-pen' };
}

function measureFace(tool: PlayerTool): ToolGroupFace & { tool: PlayerTool } {
  if (tool === 'measure-circle') return { icon: Circle, label: TEXT.toolbar.measureCircle, tool, isActive: true };
  if (tool === 'measure-cone') return { icon: Triangle, label: TEXT.toolbar.measureCone, tool, isActive: true };
  return { icon: Ruler, label: TEXT.toolbar.measureLine, tool: 'measure', isActive: tool === 'measure' };
}

/** The next tool a key gives: the family's first, else the next of the family, as the GM's keys cycle. */
function keyed(key: string, tool: PlayerTool): PlayerTool | 'dice' | null {
  const cycle = (family: readonly PlayerTool[]): PlayerTool => {
    const at = family.indexOf(tool);
    return at < 0 ? family[0]! : family[(at + 1) % family.length]!;
  };
  switch (key) {
    case 'v': return cycle(['move', 'laser']);
    case 'b': return cycle(['draw-pen', 'draw-icon', 'draw-eraser']);
    case 't': return 'text';
    case 'm': return cycle(['measure', 'measure-circle', 'measure-cone']);
    case 'r': return 'dice';
    default: return null;
  }
}

/** Whether a key press belongs to a field or a modifier chord, which the tools leave alone. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]') != null;
}

function PlayerToolbar({ host, state }: { host: ToolbarHost; state: () => ToolbarState; }): ReactElement {
  const settings = useSyncExternalStore(host.settings.subscribe, host.settings.get);
  const shown = useSyncExternalStore(subscribeState, state);
  const [tool, setTool] = useState<PlayerTool>('move');
  const [menu, setMenu] = useState<Menu>(null);
  const [trayMemory, setTrayMemory] = useState<DiceTrayMemory>(emptyTrayMemory);
  const diceRef = useRef<HTMLDivElement>(null);
  const select = (next: PlayerTool): void => {
    setTool(next);
    setMenu(null);
    host.setTool(next);
  };
  const toggle = (which: Exclude<Menu, null>): void => setMenu((open) => (open === which ? null : which));

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (typing(event)) return;
      // Escape closes the open menu, else goes back to moving, as the player page always did.
      if (event.key === 'Escape') {
        if (menu !== null) setMenu(null);
        else if (tool !== 'move') select('move');
        return;
      }
      const next = keyed(event.key.toLowerCase(), tool);
      if (next === null) return;
      event.preventDefault();
      if (next === 'dice') toggle('dice');
      else select(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A press outside the toolbar's menus and the dice tray closes them, as on the GM's bar.
  useEffect(() => {
    if (menu === null) return undefined;
    const onPress = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.atlas-dropdown-menu, .atlas-dice-tray, .player-dice') == null) setMenu(null);
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [menu]);

  const move = moveFace(tool);
  const draw = drawFace(tool);
  const measure = measureFace(tool);
  const textActive = tool === 'text';
  const group = (which: Exclude<Menu, null>) => ({ menuOpen: menu === which, onMenuToggle: () => toggle(which) });

  return (
    <div className="atlas-bottom-toolbar-row player-toolbar-row">
      <div className="atlas-bottom-toolbar-row__start">
        <div className="atlas-vtt-toolbar atlas-online-log-button">
          <ToolButton icon={MessageSquare} label={TEXT.toolbar.chat} shortcut="" isActive={false} onClick={() => host.toggleChat()} />
        </div>
      </div>

      <div className="atlas-vtt-toolbar atlas-main-toolbar player-toolbar">
        <ToolGroup face={move} shortcut={KEYS.move} menuLabel={t('toolbar.moveOptions')} onSelect={() => select(move.tool)} {...group('move')}>
          <div className="atlas-dropdown-section">
            <DropdownMenuItem icon={Hand} label={t('toolbar.moveSelect')} shortcut={KEYS.move} isActive={tool === 'move'} onClick={() => select('move')} />
            <DropdownMenuItem icon={Flashlight} label={t('toolbar.laser')} shortcut={KEYS.move} isActive={tool === 'laser'} onClick={() => select('laser')} />
          </div>
          <div className="atlas-dropdown-section">
            <DropdownSwatchGrid label={t('toolbar.laserColour')} swatches={LASER_COLOR_SWATCHES} value={settings.laser.color} onChange={(color) => host.settings.update('laser', { color })} hint={LASER_COLOR_HINT} />
            <DropdownSliderRow label={t('toolbar.laserSize')} value={settings.laser.size} min={LASER_SIZE_MIN} max={LASER_SIZE_MAX} onChange={(size) => host.settings.update('laser', { size })} />
          </div>
        </ToolGroup>

        <ToolGroup face={draw} shortcut={KEYS.draw} menuLabel={TEXT.toolbar.drawOptions} onSelect={() => select(draw.tool)} {...group('draw')}>
          <div className="atlas-dropdown-section">
            <DropdownMenuItem icon={Pencil} label={TEXT.toolbar.pen} shortcut={KEYS.draw} isActive={tool === 'draw-pen'} onClick={() => select('draw-pen')} />
            <DropdownMenuItem icon={Stamp} label={TEXT.toolbar.iconStamp} shortcut={KEYS.draw} isActive={tool === 'draw-icon'} onClick={() => select('draw-icon')} />
            <DropdownMenuItem icon={Eraser} label={TEXT.toolbar.drawingEraser} shortcut={KEYS.draw} isActive={tool === 'draw-eraser'} onClick={() => select('draw-eraser')} />
          </div>
          <div className="atlas-dropdown-section">
            <div className="space-y-2">
              <span className="atlas-dropdown-label">{TEXT.toolbar.icons}</span>
              <div className="atlas-icon-grid">
                {MAP_ICON_OPTIONS.map(({ key, icon: Icon }) => {
                  const chosen = tool === 'draw-icon' && settings.draw.icon === key;
                  return (
                    <LabelTooltip key={key} label={stampIconName(key) ?? key}>
                      <button type="button" aria-pressed={chosen} className={`atlas-icon-grid__item${chosen ? ' atlas-icon-grid__item--active' : ''}`} onClick={() => { host.settings.update('draw', { icon: key }); select('draw-icon'); }}>
                        <Icon className="h-4 w-4" />
                      </button>
                    </LabelTooltip>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="atlas-dropdown-section">
            <div className="space-y-3">
              <DropdownModeSelector
                label={TEXT.toolbar.ink}
                value={settings.draw.color}
                options={[{ value: '#ffffff' as const, icon: Circle, label: t('color.white') }, { value: '#000000' as const, icon: Circle, label: t('color.black') }]}
                onChange={(color) => host.settings.update('draw', { color })}
              />
              <SizeRow label={TEXT.toolbar.penSize} value={settings.draw.size} onChange={(size) => host.settings.update('draw', { size })} />
              <SizeRow label={TEXT.toolbar.eraserSize} value={settings.draw.eraserSize} onChange={(eraserSize) => host.settings.update('draw', { eraserSize })} />
            </div>
          </div>
          <div className="atlas-dropdown-section">
            <DropdownMenuItem icon={Trash2} label={TEXT.toolbar.deleteMine} destructive onClick={() => { host.deleteMyDrawings(); setMenu(null); }} />
          </div>
        </ToolGroup>

        <ToolGroup face={{ icon: Type, label: TEXT.toolbar.textTool, isActive: textActive }} shortcut={KEYS.text} menuLabel={TEXT.toolbar.textOptions} onSelect={() => select('text')} {...group('text')}>
          <div className="atlas-dropdown-section">
            <DropdownSwatchGrid label={t('toolbar.colour')} swatches={TEXT_COLOR_SWATCHES} value={settings.text.color} onChange={(color) => host.settings.update('text', { color })} />
          </div>
          <div className="atlas-dropdown-section">
            <div className="space-y-3">
              <SizeRow label={TEXT.toolbar.textSize} value={settings.text.size} onChange={(size) => host.settings.update('text', { size })} />
              <DropdownToggleRow label={TEXT.toolbar.bold} value={settings.text.bold} onChange={() => host.settings.update('text', { bold: !settings.text.bold })} />
            </div>
          </div>
        </ToolGroup>

        <ToolGroup face={measure} shortcut={KEYS.measure} menuLabel={t('toolbar.measureOptions')} onSelect={() => select(measure.tool)} {...group('measure')}>
          <div className="atlas-dropdown-section">
            <DropdownMenuItem icon={Ruler} label={TEXT.toolbar.line} isActive={tool === 'measure'} onClick={() => select('measure')} />
            <DropdownMenuItem icon={Circle} label={t('toolbar.circle')} isActive={tool === 'measure-circle'} onClick={() => select('measure-circle')} />
            <DropdownMenuItem icon={Triangle} label={t('toolbar.cone')} isActive={tool === 'measure-cone'} onClick={() => select('measure-cone')} />
          </div>
          <div className="atlas-dropdown-separator"></div>
          <div className="atlas-dropdown-section">
            <DropdownToggleRow label={TEXT.toolbar.persist} value={settings.measure.persist} onChange={() => host.settings.update('measure', { persist: !settings.measure.persist })} />
          </div>
        </ToolGroup>

        <div ref={diceRef} className="relative flex items-center player-dice">
          <ToolButton icon={Dices} label={t('toolbar.rollDice')} shortcut={KEYS.dice} isActive={menu === 'dice'} onClick={() => toggle('dice')} />
          {menu === 'dice' && (
            <div className="atlas-dice-tray">
              <div className="atlas-dice-panel">
                <DiceTray
                  memory={trayMemory}
                  onRemember={setTrayMemory}
                  // The page checks what it can read; the GM's Atlas checks the roll again with the map's rules.
                  check={(formula) => {
                    const parsed = parseFormula(formula);
                    return 'code' in parsed ? parsed : null;
                  }}
                  onRoll={({ formula, advantage: side }) => {
                    if (!host.roll(formula, side)) return false;
                    setMenu(null);
                    return true;
                  }}
                  // The GM keeps the table's rolls in the log; the tray holds no history of its own here.
                  history={[]}
                  onRepeat={() => false}
                  historyOpen={false}
                  onHistoryOpen={() => undefined}
                  onClose={() => setMenu(null)}
                  shelf={shown.shelf}
                  onRollPreset={(preset, side) => {
                    if (host.rollPreset(preset, side)) setMenu(null);
                  }}
                  advantage={shown.advantage.length > 0 ? {
                    sides: shown.advantage,
                    applies: (formula) => shown.dice === null || rollsSetDice(formula, { dice: shown.dice }),
                    dice: shown.dice === null ? 'd20' : setRollText(shown.dice),
                  } : undefined}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="atlas-bottom-toolbar-row__end">
        {shown.book && (
          <div className="atlas-vtt-toolbar">
            <ToolButton icon={BookOpen} label={TEXT.book.open} shortcut="" isActive={false} onClick={() => host.toggleBook()} />
          </div>
        )}
      </div>
    </div>
  );
}

const stateListeners = new Set<() => void>();
function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => void stateListeners.delete(listener);
}

/** The player's toolbar at the bottom of the page: the GM's toolbar's groups, the dice tray, and the log and book on either side. */
export function mountToolbar(host: HTMLElement, toolbar: ToolbarHost): { update(change: Partial<ToolbarState>): void } {
  let state: ToolbarState = { advantage: [], dice: null, book: false };
  const root = document.createElement('div');
  // The plugin's styles reach what lies inside its root class; a press here leaves the log open.
  root.className = 'atlas-vtt-plugin player-toolbar-root';
  root.dataset.keepsLogOpen = '';
  host.append(root);
  // As the GM's MainToolbar: one tooltip provider for the bar, with its delay.
  createRoot(root).render(<TooltipProvider delayDuration={300}><PlayerToolbar host={toolbar} state={() => state} /></TooltipProvider>);
  return {
    update(change) {
      state = { ...state, ...change };
      for (const listener of stateListeners) listener();
    },
  };
}
