import { isQuestDone, type BookQuest, type QuestState } from '../../../src/app/online/protocol/bookMap.ts';
import type { PageContext } from './bookContext.ts';
import { button, node } from './bookDom.ts';
import { noteList } from './bookNotes.ts';
import { readableText } from './documentView.ts';
import { TEXT } from './text.ts';

/** Quests in the order a player looks for them: what is under way, what is offered, then what is behind. */
const STATE_ORDER: readonly QuestState[] = ['active', 'open', 'done', 'failed'];

function questCard(context: PageContext, quest: BookQuest): HTMLElement {
  const card = node('article', 'book-quest');
  card.dataset.state = quest.state;
  card.dataset.quest = quest.id;
  const meta = [quest.kind === 'main' ? TEXT.quests.main : TEXT.quests.side, TEXT.quests.states[quest.state], ...(quest.xp > 0 ? [`${quest.xp} XP`] : [])].join(' · ');
  card.append(node('h3', 'book-item-name', quest.title), node('p', 'book-item-meta', meta), readableText(context.assets, quest));
  if (quest.rewards.length > 0) {
    card.append(node('h4', 'book-subtitle', TEXT.quests.rewards));
    const rewards = node('ul', 'book-rewards');
    for (const reward of quest.rewards) rewards.append(node('li', '', reward));
    card.append(rewards);
  }
  if (quest.place !== null && context.book.worldMap !== null) card.append(button(TEXT.quests.showOnMap, () => {
    context.ui.tab = 'map';
    context.ui.mapId = null;
    context.ui.selected = { kind: 'quest', id: quest.id };
    context.redraw();
  }));
  if (!isQuestDone(quest) || context.book.notes.some((note) => note.quest === quest.id)) {
    card.append(node('h4', 'book-subtitle', TEXT.notes.onQuest), noteList(context, quest.id));
  }
  return card;
}

export function questsPage(context: PageContext): HTMLElement {
  const page = node('div', 'book-page');
  const quests = context.book.quests;
  if (quests.length === 0) page.append(node('p', 'book-empty', TEXT.book.noQuests));
  for (const state of STATE_ORDER) {
    const group = quests.filter((quest) => quest.state === state);
    if (group.length === 0) continue;
    page.append(node('h3', 'book-group', TEXT.quests.states[state]));
    for (const quest of group) page.append(questCard(context, quest));
  }
  return page;
}
