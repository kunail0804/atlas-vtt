import type { DefaultSlot } from '../../../src/app/online/protocol/bookSlots.ts';
import type { PinKind, QuestState } from '../../../src/app/online/protocol/bookMap.ts';
import type { RollRefusal } from '../../../src/app/online/protocol/dice.ts';

/** The page's own words (the plugin's panels bring theirs), in one place for every language the page speaks. */
export const TEXT = {
  book: {
    open: 'Mon livre',
    close: 'Fermer',
    coming: 'Ton livre arrive…',
    tabs: { character: 'Personnage', items: 'Objets', equipment: 'Équipement', notes: 'Notes', quests: 'Quêtes', purse: 'Bourse', map: 'Carte' },
    noCharacter: 'Le MJ ne t\'a pas encore donné de personnage.',
    noItems: 'Aucun objet pour l\'instant.',
    noQuests: 'Aucune quête pour l\'instant.',
    noMap: 'Le MJ n\'a pas partagé de carte du monde.',
    newItem: (name: string): string => `Nouvel objet : ${name}`,
    equippedIn: (slot: string): string => `Équipé : ${slot}`,
    full: 'Ton livre ne peut pas en contenir plus.',
    tooLong: 'Ce texte est trop long pour être envoyé.',
    refused: 'Le MJ n\'a pas accepté cette modification.',
  },
  notes: { title: 'Titre', body: 'Ta note…', add: 'Ajouter la note', save: 'Enregistrer', cancel: 'Annuler', edit: 'Modifier', remove: 'Supprimer', untitled: 'Sans titre', onQuest: 'Mes notes sur cette quête', addOnQuest: 'Ajouter une note' },
  quests: {
    main: 'Principale', side: 'Secondaire',
    states: { active: 'En cours', open: 'Proposée', done: 'Accomplie', failed: 'Échouée' } satisfies Record<QuestState, string>,
    rewards: 'Récompenses',
    showOnMap: 'Voir sur la carte',
    open: 'Ouvrir la quête',
  },
  purse: { save: 'Enregistrer la bourse', addRow: 'Ajouter une monnaie', coin: 'Monnaie', defaultCoin: 'Or' },
  equipment: {
    empty: '— vide —',
    manage: 'Emplacements',
    show: 'Afficher', hide: 'Masquer',
    addSlot: 'Ajouter un emplacement',
    slotName: 'Nom de l\'emplacement',
    remove: 'Supprimer',
    slots: {
      'main-hand': 'Main principale', 'off-hand': 'Main secondaire', ammunition: 'Munitions', armour: 'Armure', head: 'Tête', neck: 'Cou', cloak: 'Cape',
      body: 'Corps', hands: 'Mains', belt: 'Ceinture', feet: 'Pieds', 'ring-1': 'Anneau I', 'ring-2': 'Anneau II',
    } satisfies Record<DefaultSlot, string>,
  },
  map: {
    world: 'Carte du monde',
    back: 'Retour à la carte du monde',
    addPin: 'Ajouter une épingle',
    placing: 'Touche la carte pour placer l\'épingle',
    cancel: 'Annuler',
    enter: 'Entrer',
    kind: 'Type',
    title: 'Titre',
    body: 'Description',
    save: 'Enregistrer l\'épingle',
    remove: 'Supprimer l\'épingle',
    kinds: { treasure: 'Trésor', danger: 'Danger', dungeon: 'Donjon', person: 'Personnage', note: 'Note' } satisfies Record<PinKind, string>,
  },
  reader: { close: 'Fermer' },
  rolls: {
    noScene: 'Le MJ ne partage aucune scène : les jets attendent qu\'il en montre une.',
    refused: {
      formula: 'Ce jet n\'est pas une formule de dés valable.',
      rate: 'Trop de jets d\'un coup : attends un instant.',
      scene: 'Le MJ a changé de scène : relance ton jet.',
      unavailable: 'Le MJ ne peut pas lancer de dés pour l\'instant.',
    } satisfies Record<RollRefusal, string>,
  },
} as const;
