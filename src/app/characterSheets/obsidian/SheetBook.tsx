import React, { useEffect, useState, type ReactElement } from 'react';
import type { App, TFile } from 'obsidian';
import { MAX_COIN_NAME, MAX_ITEM_TEXT, MAX_PURSE_ROWS, MAX_TOKEN_VALUE, parsePlayerBookMessage, type BookItem, type BookItemDraft, type PlayerBookMessage, type PurseRow } from '../../online/protocol/index.ts';
import { MAX_BOOK_TITLE } from '../../online/protocol/bookText.ts';
import { activeShelf, onActiveShelf } from '../../online/gm/book/activeShelf.ts';
import { applyBookMessage, type StoredBook } from '../../online/gm/book/bookStore.ts';
import type { BookShelf } from '../../online/gm/book/BookShelf.ts';
import { AssetService } from '../../services/AssetService';
import { showNotice } from '../../ui/notice';
import { TokenStatblockLinkService } from '../../services/TokenStatblockLinkService';
import { SHEET_TEXT } from './sheetText.ts';

/** One book of the character: the collection it was kept in, the token artwork that names it, and the collection's name. */
export interface BookPlace {
  readonly collection: string;
  readonly key: string;
  readonly label: string;
}

/**
 * The books of the character a sheet note is: those kept of each token linked to the note (and of its
 * `image`), in every collection that keeps one, else a new one in the collection of its first token.
 * A book is kept by the collection of the scene it was played in and the token's artwork (`Characters`):
 * the guess is right where the character's token and its scenes share a collection, as Atlas's usually do.
 */
export async function bookPlaces(app: App, file: TFile, shelf: BookShelf): Promise<BookPlace[]> {
  const links = TokenStatblockLinkService.getInstance(app);
  const image: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.image;
  const keys = [...new Set([...(await links.getTokensLinkedToStatblock(file.path)), ...(typeof image === 'string' && image.trim() !== '' ? [image] : [])])];
  const assets = AssetService.getInstance(app);
  const name = async (collection: string): Promise<string> => (await assets.getCollection(collection).catch(() => null))?.name ?? (collection || SHEET_TEXT.book.noCollection);
  const places: BookPlace[] = [];
  for (const key of keys) {
    for (const collection of shelf.collectionsOf(key)) places.push({ collection, key, label: `${await name(collection)} · ${key.split('/').at(-1) ?? key}` });
  }
  if (places.length > 0 || keys.length === 0) return places;
  const first = keys[0]!;
  const collection = (await links.findAssetByAnyPath(first))?.collection ?? '';
  return [{ collection, key: first, label: `${await name(collection)} · ${first.split('/').at(-1) ?? first}` }];
}

/** 96 random bits in hex, as the book's ids are. */
const newId = (): string => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

type Draft = Record<'name' | 'type' | 'rarity' | 'price' | 'description' | 'properties', string>;

const draftOf = (item: BookItem | null): Draft => (item === null
  ? { name: '', type: '', rarity: '', price: '', description: '', properties: '' }
  : { name: item.name, type: item.type ?? '', rarity: item.rarity ?? '', price: item.price ?? '', description: item.description ?? '', properties: item.properties.map((property) => `${property.label} : ${property.value}`).join('\n') });

/** The item a draft writes: its lines, empty ones missing, and its properties, one `label : value` a line. */
function itemOf(id: string, draft: Draft): BookItemDraft {
  const optional = (text: string): string | null => (text.trim() === '' ? null : text);
  const properties = draft.properties.split('\n').flatMap((line) => {
    const colon = line.indexOf(':');
    const label = colon < 0 ? '' : line.slice(0, colon).trim();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    return label !== '' && value !== '' ? [{ label, value }] : [];
  });
  return { id, name: draft.name, type: optional(draft.type), rarity: optional(draft.rarity), price: optional(draft.price), description: optional(draft.description), properties };
}

function ItemForm({ item, onSave, onCancel }: { item: BookItem | null; onSave: (draft: Draft) => void; onCancel: () => void }): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const field = (key: keyof Draft, label: string, long = false): ReactElement => {
    const props = { className: 'atlas-sheet-input', 'aria-label': label, placeholder: label, value: draft[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [key]: event.target.value }) };
    return long ? <textarea {...props} maxLength={MAX_ITEM_TEXT} rows={3} /> : <input {...props} maxLength={MAX_BOOK_TITLE} />;
  };
  return (
    <form className="atlas-sheet-box atlas-sheet-book-form" onSubmit={(event) => {
      event.preventDefault();
      if (draft.name.trim() !== '') onSave(draft);
    }}>
      {field('name', SHEET_TEXT.book.name)}
      {field('type', SHEET_TEXT.book.type)}
      {field('rarity', SHEET_TEXT.book.rarity)}
      {field('price', SHEET_TEXT.book.price)}
      {field('description', SHEET_TEXT.book.description, true)}
      {field('properties', SHEET_TEXT.book.properties, true)}
      <div className="atlas-sheet-book-actions">
        <button type="submit" className="atlas-sheet-add">{SHEET_TEXT.book.save}</button>
        <button type="button" className="atlas-sheet-add" onClick={onCancel}>{SHEET_TEXT.book.cancel}</button>
      </div>
    </form>
  );
}

function Purse({ purse, onSave }: { purse: readonly PurseRow[]; onSave: (purse: PurseRow[]) => void }): ReactElement {
  const [rows, setRows] = useState<PurseRow[]>(() => [...purse]);
  useEffect(() => setRows([...purse]), [purse]);
  const set = (index: number, row: PurseRow): void => setRows(rows.map((old, at) => (at === index ? row : old)));
  return (
    <form className="atlas-sheet-box" onSubmit={(event) => {
      event.preventDefault();
      onSave(rows.map((row) => ({ name: row.name.trim(), amount: Math.max(0, Math.floor(row.amount)) })).filter((row) => row.name !== ''));
    }}>
      <h3 className="atlas-sheet-box__title">{SHEET_TEXT.book.purse}</h3>
      {rows.map((row, index) => (
        <div key={index} className="atlas-sheet-book-coin">
          <input className="atlas-sheet-input" aria-label={`${SHEET_TEXT.book.coin} ${index + 1}`} maxLength={MAX_COIN_NAME} value={row.name} onChange={(event) => set(index, { ...row, name: event.target.value })} />
          <input className="atlas-sheet-input" type="number" min={0} max={MAX_TOKEN_VALUE} step={1} aria-label={`${SHEET_TEXT.book.amount} ${index + 1}`} value={row.amount} onChange={(event) => set(index, { ...row, amount: Number(event.target.value) || 0 })} />
        </div>
      ))}
      <div className="atlas-sheet-book-actions">
        {rows.length < MAX_PURSE_ROWS && <button type="button" className="atlas-sheet-add" onClick={() => setRows([...rows, { name: '', amount: 0 }])}>{SHEET_TEXT.book.addCoin}</button>}
        <button type="submit" className="atlas-sheet-add">{SHEET_TEXT.book.savePurse}</button>
      </div>
    </form>
  );
}

/**
 * The GM's way into the character's book from its sheet: the items and coins its player holds, as the
 * player's page shows them, which the GM may change. What is written reaches the player at once while a
 * table runs (`BookShare` hears of the GM's writes). Needs online play on, which keeps the books.
 */
export function SheetBook({ app, file }: { app: App; file: TFile }): ReactElement {
  const [shelf, setShelf] = useState<BookShelf | null>(() => activeShelf());
  const [places, setPlaces] = useState<BookPlace[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [book, setBook] = useState<StoredBook | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => onActiveShelf(() => setShelf(activeShelf())), []);
  useEffect(() => {
    if (shelf === null) return;
    let live = true;
    const find = (): void => void bookPlaces(app, file, shelf).then((found) => {
      if (live) setPlaces(found);
    });
    find();
    // A book that appears later (the character's first game) is found then.
    const stop = shelf.subscribe(find);
    return () => {
      live = false;
      stop();
    };
  }, [app, file, shelf]);
  const place = places?.[Math.min(chosen, places.length - 1)] ?? null;
  useEffect(() => {
    if (shelf === null || place === null) return;
    setBook(shelf.of(place.collection, place.key));
    return shelf.subscribe((collection, key) => {
      if (collection === place.collection && key === place.key) setBook(shelf.of(collection, key));
    });
  }, [shelf, place?.collection, place?.key]);

  if (shelf === null) return <p className="atlas-sheet-hint">{SHEET_TEXT.book.needsOnline}</p>;
  if (places === null) return <p className="atlas-sheet-hint">{SHEET_TEXT.loading}</p>;
  if (place === null || book === null) return <p className="atlas-sheet-hint">{SHEET_TEXT.book.noToken}</p>;
  // The GM's writes take the player's road: the protocol's parser first, so a book never holds what it could not read back.
  const write = (message: Exclude<PlayerBookMessage, { t: 'book-resource' }>): boolean => {
    const parsed = parsePlayerBookMessage(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
    const written = parsed === null || parsed.t === 'book-resource' ? null : applyBookMessage(shelf.of(place.collection, place.key), parsed, Date.now(), new Set());
    if (written === null) {
      showNotice(parsed === null ? SHEET_TEXT.book.invalid : SHEET_TEXT.book.full);
      return false;
    }
    shelf.keep(place.collection, place.key, written, 'gm');
    return true;
  };
  const equipped = new Set(book.equipped.map((entry) => entry.item));
  return (
    <div className="atlas-sheet-page atlas-sheet-book">
      <p className="atlas-sheet-hint">{SHEET_TEXT.book.hint}</p>
      {places.length > 1 && (
        <select className="atlas-sheet-input" aria-label={SHEET_TEXT.book.which} value={Math.min(chosen, places.length - 1)} onChange={(event) => setChosen(Number(event.target.value))}>
          {places.map((entry, index) => <option key={`${entry.collection}\n${entry.key}`} value={index}>{entry.label}</option>)}
        </select>
      )}
      {editing === 'new'
        ? <ItemForm item={null} onCancel={() => setEditing(null)} onSave={(draft) => {
          if (write({ t: 'book-item-put', item: itemOf(newId(), draft) })) setEditing(null);
        }} />
        : <button type="button" className="atlas-sheet-add" onClick={() => setEditing('new')}>{SHEET_TEXT.book.addItem}</button>}
      {book.items.length === 0 && <p className="atlas-sheet-hint">{SHEET_TEXT.book.noItems}</p>}
      {[...book.items].reverse().map((item) => (editing === item.id
        ? <ItemForm key={item.id} item={item} onCancel={() => setEditing(null)} onSave={(draft) => {
          if (write({ t: 'book-item-put', item: itemOf(item.id, draft) })) setEditing(null);
        }} />
        : (
          <article key={item.id} className="atlas-sheet-box atlas-sheet-book-item">
            <h3 className="atlas-sheet-box__title">{item.name}{equipped.has(item.id) ? ` · ${SHEET_TEXT.book.equipped}` : ''}</h3>
            {[item.type, item.rarity, item.price].some((part) => part) && <p className="atlas-sheet-hint">{[item.type, item.rarity, item.price].filter((part) => part).join(' · ')}</p>}
            {item.description !== null && <p>{item.description}</p>}
            {item.properties.map((property) => <p key={property.label}>{`${property.label} : ${property.value}`}</p>)}
            <div className="atlas-sheet-book-actions">
              <button type="button" className="atlas-sheet-add" onClick={() => setEditing(item.id)}>{SHEET_TEXT.book.edit}</button>
              <button type="button" className="atlas-sheet-add" onClick={() => write({ t: 'book-item-delete', id: item.id })}>{SHEET_TEXT.book.remove}</button>
            </div>
          </article>
        )))}
      <Purse purse={book.purse} onSave={(purse) => write({ t: 'book-purse', purse })} />
    </div>
  );
}
