import { MAX_NOTE_BODY } from '../../../src/app/online/protocol/book.ts';
import { MAX_BOOK_TITLE } from '../../../src/app/online/protocol/bookText.ts';
import type { PageContext } from './bookContext.ts';
import { bound, button, node, randomId } from './bookDom.ts';
import { TEXT } from './text.ts';

/**
 * A list of the player's notes with the form that writes them: the free notes (`quest` undefined) or
 * those on one quest. Editing a note fills the form; what is typed survives a redraw.
 */
export function noteList(context: PageContext, quest: string | undefined): HTMLElement {
  const scope = quest ?? 'free';
  const list = node('div', 'book-notes');
  const editing = context.ui.editing.get(scope);
  const notes = context.book.notes.filter((note) => note.quest === quest);
  const form = node('form', 'book-form');
  const titleKey = `note.${scope}.title`;
  const bodyKey = `note.${scope}.body`;
  const title = bound(context.drafts, titleKey, node('input', 'book-input'), '');
  title.placeholder = TEXT.notes.title;
  title.maxLength = MAX_BOOK_TITLE;
  const body = bound(context.drafts, bodyKey, node('textarea', 'book-input book-area'), '');
  body.placeholder = TEXT.notes.body;
  body.maxLength = MAX_NOTE_BODY;
  const save = node('button', 'book-button book-primary', editing === undefined ? (quest === undefined ? TEXT.notes.add : TEXT.notes.addOnQuest) : TEXT.notes.save);
  save.type = 'submit';
  const reset = (): void => {
    context.drafts.delete(titleKey);
    context.drafts.delete(bodyKey);
    context.ui.editing.delete(scope);
  };
  form.append(title, body, save);
  if (editing !== undefined) form.append(button(TEXT.notes.cancel, () => {
    reset();
    context.redraw();
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (title.value.trim() === '' && body.value.trim() === '') return;
    const id = editing ?? randomId();
    reset();
    context.write({ t: 'book-note', note: { id, title: title.value, body: body.value, ...(quest !== undefined && { quest }) } });
  });
  for (const note of [...notes].reverse()) {
    const card = node('article', 'book-note');
    card.append(node('h4', 'book-item-name', note.title === '' ? TEXT.notes.untitled : note.title), node('p', 'book-text', note.body));
    card.append(button(TEXT.notes.edit, () => {
      context.ui.editing.set(scope, note.id);
      context.drafts.set(titleKey, note.title);
      context.drafts.set(bodyKey, note.body);
      context.redraw();
    }), button(TEXT.notes.remove, () => {
      if (context.ui.editing.get(scope) === note.id) reset();
      context.write({ t: 'book-note-delete', id: note.id });
    }));
    list.append(card);
  }
  list.prepend(form);
  return list;
}

export function notesPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  page.append(noteList(context, undefined));
  return page;
}
