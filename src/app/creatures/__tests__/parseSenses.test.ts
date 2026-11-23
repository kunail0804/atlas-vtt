import { describe, expect, it } from 'vitest';
import { GENERIC_SENSES } from '../../gameSystems/senses';
import type { SenseDefinition } from '../../types/senseTypes';
import { parseSenses } from '../parseSenses';
import { SENSES_FIXTURES, type FixtureSystem } from './sensesFixtures';
import { SENSES_REGRESSIONS } from './sensesRegressions';
import { DND, FEET, METRES, OSE, PATHFINDER, SHADOWDARK, SQUARES, SYSTEMS, read } from './sensesTestHelpers';

describe('parseSenses on published creatures', () => {
  it('has at least 25 lines, each from a named creature and source', () => {
    expect(SENSES_FIXTURES.length).toBeGreaterThanOrEqual(25);
    for (const fixture of SENSES_FIXTURES) {
      expect(fixture.creature).not.toBe('');
      expect(fixture.source).not.toBe('');
    }
  });

  for (const system of Object.keys(SYSTEMS) as FixtureSystem[]) {
    describe(`in a ${system} collection`, () => {
      it("reads every fixture's senses line", () => {
        for (const [_label, fixture] of SENSES_FIXTURES.map((fixture) => [`${fixture.creature} (${fixture.source})`, fixture] as const)) {
          expect(read(fixture.text, SYSTEMS[system])).toEqual(fixture[system]);
        }
      });
    });
  }
});

it('parseSenses on lines it once read wrong', () => {
  // reads every line it once read wrong as it should
  {
    for (const [_label, line] of SENSES_REGRESSIONS.map((line) => [`${line.creature} (${line.source})`, line] as const)) {
      const { senses, unknown, blindBeyond } = line;
      expect(read(line.text, SYSTEMS[line.system])).toEqual({ senses, unknown, ...(blindBeyond !== undefined && { blindBeyond }) });
    }
  }

  // gives every creature whose bracket once became a distance the sense without one
  {
    const bracketed = SENSES_REGRESSIONS.filter((line) => /; \(\d+ [^)]*\) (?:greater )?(?:darkvision|low-light vision)/.test(line.text));
    expect(bracketed.length).toBeGreaterThanOrEqual(23);
    for (const line of bracketed) {
      const first = parseSenses(line.text, SYSTEMS[line.system], FEET, 'en').senses[0]!;
      expect(first, line.creature).not.toHaveProperty('range');
    }
  }
});

it('parseSenses grammar', () => {
  // separates senses at commas and semicolons, not inside brackets or numbers
  {
    expect(read('darkvision 60 ft.; blindsight 10 ft., truesight 30 ft.', DND).senses)
      .toEqual([['Darkvision', 60], ['Blindsight', 10], ['Truesight', 30]]);
    expect(read('blindsight 30 ft. (hearing, smell; blind beyond this radius)', DND)).toEqual({ senses: [['Blindsight', 30]], unknown: [], blindBeyond: 30 });
    expect(read('tremorsense (imprecise) 1,000 feet', PATHFINDER).senses).toEqual([['Tremorsense', 1000]]);
  }

  // reads a sense without a distance as one that takes none
  {
    expect(parseSenses('darkvision, low-light vision', PATHFINDER, FEET).senses.every((sense) => !('range' in sense))).toBe(true);
    expect(read('darkvision', DND).senses).toEqual([['Darkvision']]);
  }

  // finds the distance before the name, in brackets, or after a colon
  {
    expect(read('60 ft. darkvision', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('120-foot darkvision', DND).senses).toEqual([['Darkvision', 120]]);
    expect(read('darkvision (60 ft.)', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('Darkvision: 60 ft.', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('Senses darkvision 60 ft.', DND).senses).toEqual([['Darkvision', 60]]);
  }

  // knows the names statblocks use for a sense, whatever their case and spacing
  {
    for (const phrase of ['Darkvision 60 ft.', 'DARK VISION 60 ft.', 'superior darkvision 60 ft.', 'infravision 60 ft.']) {
      expect(read(phrase, DND).senses).toEqual([['Darkvision', 60]]);
    }
    expect(read('blindsense 30 ft.', DND).senses).toEqual([['Blindsight', 30]]);
    expect(read('blind sight 30 ft.', DND).senses).toEqual([['Blindsight', 30]]);
    expect(read('tremor sense 60 ft.', DND).senses).toEqual([['Tremorsense', 60]]);
    expect(read('true sight 120 ft.', DND).senses).toEqual([['Truesight', 120]]);
    expect(read('true seeing', GENERIC_SENSES).senses).toEqual([['Truesight']]);
    expect(read('Devil’s Sight 120 ft.', DND).senses).toEqual([['Devil\'s Sight', 120]]);
    expect(read('devils sight', DND).senses).toEqual([['Devil\'s Sight']]);
    expect(read('Low-Light Vision', PATHFINDER).senses).toEqual([['Low-light vision']]);
    expect(read('lowlight vision', GENERIC_SENSES).senses).toEqual([['Low-light vision']]);
    expect(read('wavesense (imprecise) 30 feet, life sense 10 feet, hearing 60 feet', PATHFINDER).senses)
      .toEqual([['Wavesense', 30], ['Lifesense', 10], ['Hearing', 60]]);
  }

  // finds the collection's modifier that lets the eyes see invisible creatures, whatever it is called
  {
    for (const phrase of ['see invisibility', 'See the Unseen', 'sees invisible', 'see invisible']) {
      expect(read(phrase, DND).senses).toEqual([['See Invisibility']]);
      expect(read(phrase, PATHFINDER).senses).toEqual([['See the Unseen']]);
      expect(read(phrase, GENERIC_SENSES).senses).toEqual([['See invisible']]);
      expect(read(phrase, OSE)).toEqual({ senses: [], unknown: [phrase] });
    }
    const secondSight: SenseDefinition = { ...GENERIC_SENSES.find((sense) => sense.grants === 'see-invisible')!, id: 'made-up', name: 'Second sight' };
    expect(read('see invisibility, second sight', [secondSight]).senses).toEqual([['Second sight']]);
  }

  // gives a modifier no distance
  {
    expect(parseSenses('darkvision 60 ft., see invisibility 120 ft.', DND, FEET).senses.map((sense) => 'range' in sense)).toEqual([true, false]);
  }

  // matches a sense the collection defines itself by its name
  {
    const thermal: SenseDefinition = { ...GENERIC_SENSES[0]!, id: 'made-up', name: 'Thermal vision' };
    delete thermal.role;
    expect(read('thermal vision 30 ft., darkvision 60 ft.', [thermal])).toEqual({ senses: [['Thermal vision', 30]], unknown: ['darkvision 60 ft.'] });
    expect(read('Darkness-adapted', SHADOWDARK).senses).toEqual([['Darkness-adapted']]);
  }

  // gives the closest sense of the collection: greater darkvision is darkvision where there is no greater one
  {
    expect(read('greater darkvision', PATHFINDER).senses).toEqual([['Greater darkvision']]);
    expect(read('greater darkvision', GENERIC_SENSES).senses).toEqual([['Darkvision']]);
    expect(read('darkvision 60 ft.', SHADOWDARK)).toEqual({ senses: [], unknown: ['darkvision 60 ft.'] });
  }

  // never maps a phrase onto a sense only the generic set has
  {
    expect(read('blindsight 30 ft.', PATHFINDER)).toEqual({ senses: [], unknown: ['blindsight 30 ft.'] });
    expect(read('darkvision 60 ft.', [])).toEqual({ senses: [], unknown: ['darkvision 60 ft.'] });
  }

  // lists a sense once, with the first distance given
  {
    expect(read('darkvision 60 ft., superior darkvision 120 ft.', DND).senses).toEqual([['Darkvision', 60]]);
  }

  // reports what names no sense of the collection as it is written, without links
  {
    expect(read('[[Rules/Senses#Darkvision|darkvision]] 60 ft., [thoughtsense](rules.md) (imprecise) 60 feet', DND))
      .toEqual({ senses: [['Darkvision', 60]], unknown: ['thoughtsense (imprecise) 60 feet'] });
    expect(read('<STATBLOCK-WIKI-LINK>Senses/Scent|scent<STATBLOCK-WIKI-LINK> (imprecise) 30 feet', PATHFINDER).senses).toEqual([['Scent', 30]]);
    expect(read('  keen   smell ,, ', DND)).toEqual({ senses: [], unknown: ['keen smell'] });
  }

  // has nothing to say about an empty line or a placeholder
  {
    for (const text of ['', '   ', '-', '—', 'none', 'None.']) {
      expect(parseSenses(text, DND, FEET)).toEqual({ senses: [], unknown: [] });
    }
  }
});

it('parseSenses units', () => {
  // keeps feet in a collection that measures in feet
  {
    expect(read('darkvision 60 ft., blindsight 30 feet, tremorsense 60\'', DND, FEET).senses)
      .toEqual([['Darkvision', 60], ['Blindsight', 30], ['Tremorsense', 60]]);
  }

  // converts feet to a collection that measures in metres, and metres back
  {
    expect(read('darkvision 60 ft., blindsight 10 ft.', DND, METRES).senses).toEqual([['Darkvision', 18], ['Blindsight', 3]]);
    expect(read('darkvision 18 m, blindsight 3 Meter', DND, METRES).senses).toEqual([['Darkvision', 18], ['Blindsight', 3]]);
    expect(read('darkvision 18 m', DND, FEET).senses).toEqual([['Darkvision', 60]]);
  }

  // counts squares by the collection's grid
  {
    expect(read('darkvision 12 squares', DND, FEET).senses).toEqual([['Darkvision', 60]]);
    expect(read('darkvision 12 squares', DND, METRES).senses).toEqual([['Darkvision', 18]]);
    expect(read('darkvision 60 ft.', DND, SQUARES).senses).toEqual([['Darkvision', 12]]);
  }

  // takes a number without a unit as the collection's own
  {
    expect(read('darkvision 60', DND, FEET).senses).toEqual([['Darkvision', 60]]);
    expect(read('darkvision 18', DND, METRES).senses).toEqual([['Darkvision', 18]]);
  }

  // converts the radius a creature is blind beyond
  {
    expect(read('blindsight 60 ft. (blind beyond this radius)', DND, METRES)).toEqual({ senses: [['Blindsight', 18]], unknown: [], blindBeyond: 18 });
  }
});

it('parseSenses blind beyond', () => {
  // is unset for a creature that sees
  {
    const parsed = parseSenses('darkvision 60 ft., passive Perception 9', DND, FEET);
    expect(parsed.blindBeyond).toBeUndefined();
    expect(parsed.blindBeyondRange).toBeUndefined();
  }

  // is the largest radius where several senses say so
  {
    expect(read('blindsight 30 ft. (blind beyond this radius), truesight 60 ft. (blind beyond this radius)', DND).blindBeyond).toBe(60);
  }

  // has no radius after a sense that shows no map: the creature has no sight at all
  {
    expect(read('tremorsense 60 ft. (blind beyond this radius), passive Perception 11', DND))
      .toEqual({ senses: [['Tremorsense', 60]], unknown: ['passive Perception 11'], blindBeyond: true });
    expect(read('blindsight 30 ft. (blind beyond this radius), tremorsense 60 ft. (blind beyond this radius)', DND).blindBeyond).toBe(30);
  }

  // keeps the radius after such a sense where the creature has eyes to see with
  {
    expect(read('darkvision 60 ft., tremorsense 120 ft. (blind beyond this radius), passive Perception 13', DND).blindBeyond).toBe(120);
  }

  // is the radius of the sense an "or" clause belongs to
  {
    expect(read('blindsight 30 ft., or 10 ft. while deafened (blind beyond this radius), passive Perception 14', DND))
      .toEqual({ senses: [['Blindsight', 30]], unknown: ['or 10 ft. while deafened (blind beyond this radius)', 'passive Perception 14'], blindBeyond: 30 });
    expect(read('blindsight 60\' or 20\' while deafened (blind beyond), passive Perception 17', DND))
      .toEqual({ senses: [['Blindsight', 60]], unknown: ['or 20\' while deafened (blind beyond)', 'passive Perception 17'], blindBeyond: 60 });
  }

  // reads "can't sense beyond this radius" alike, also after a sense the collection lacks
  {
    expect(read('keensense 60 ft. (can\'t sense beyond this radius)', DND))
      .toEqual({ senses: [], unknown: ['keensense 60 ft. (can\'t sense beyond this radius)'], blindBeyond: 60 });
    expect(read('blindsight 30 ft. (can’t sense beyond this radius)', DND)).toEqual({ senses: [['Blindsight', 30]], unknown: [], blindBeyond: 30 });
    expect(read('sight 20 ft. (blind beyond the radius of its own light), passive Perception 10', DND).blindBeyond).toBe(20);
  }

  // takes the usual distance of a sense that gives none
  {
    expect(read('blindsight (blind beyond this radius)', DND).blindBeyond).toBe(60);
  }

  // has no radius for a creature without vision at all
  {
    expect(read('no vision', PATHFINDER)).toEqual({ senses: [], unknown: [], blindBeyond: true });
    expect(read('tremorsense (imprecise) 60 feet, no vision', PATHFINDER)).toEqual({ senses: [['Tremorsense', 60]], unknown: [], blindBeyond: true });
  }
});

it('parseSenses brackets', () => {
  // never takes a bare number in a bracket for a distance
  {
    expect(read('Perception +33; (35 to Sense Motive) darkvision, scent (imprecise) 60 feet', PATHFINDER))
      .toEqual({ senses: [['Darkvision'], ['Scent', 60]], unknown: ['Perception +33 (35 to Sense Motive)'] });
    expect(read('(35 to Sense Motive) darkvision', PATHFINDER)).toEqual({ senses: [['Darkvision']], unknown: ['(35 to Sense Motive)'] });
    expect(read('darkvision (penetrates magical darkness of 4th rank)', PATHFINDER)).toEqual({ senses: [['Darkvision']], unknown: [] });
    expect(read('truesight (10 minutes)', DND)).toEqual({ senses: [['Truesight']], unknown: [] });
    expect(read('darkvision (60)', DND)).toEqual({ senses: [['Darkvision']], unknown: [] });
  }

  // takes a bracketed distance that has a unit and follows the name
  {
    expect(read('darkvision (60 ft.)', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('darkvision (60 ft.', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('scent (imprecise 30 feet)', PATHFINDER).senses).toEqual([['Scent', 30]]);
    expect(read('scent (30 feet)', PATHFINDER).senses).toEqual([['Scent', 30]]);
    expect(read('(60 ft.) darkvision', DND)).toEqual({ senses: [['Darkvision']], unknown: ['(60 ft.)'] });
  }

  // prefers the distance beside the name to one in a bracket
  {
    expect(read('darkvision 60 feet (120 feet in dim light)', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('wavesense 120 feet (imprecise)', PATHFINDER).senses).toEqual([['Wavesense', 120]]);
  }

  // keeps a bracket no sense follows with what stands after it
  {
    expect(read('Perception +20; (21 initiative) detect magic, greater darkvision', PATHFINDER))
      .toEqual({ senses: [['Greater darkvision']], unknown: ['Perception +20', '(21 initiative) detect magic'] });
    expect(read('Perception +11; (13 to Seek creatures using hearing), low-light vision', PATHFINDER))
      .toEqual({ senses: [['Low-light vision']], unknown: ['Perception +11 (13 to Seek creatures using hearing)'] });
  }
});

it('parseSenses on lines that run together', () => {
  // reads senses joined by "and"
  {
    expect(read('Darkvision 60 ft. and Tremorsense 30 ft.', DND)).toEqual({ senses: [['Darkvision', 60], ['Tremorsense', 30]], unknown: [] });
    expect(read('darkvision and tremorsense', DND)).toEqual({ senses: [['Darkvision'], ['Tremorsense']], unknown: [] });
    expect(read('darkvision & tremorsense 60 ft., passive Perception 10', DND))
      .toEqual({ senses: [['Darkvision'], ['Tremorsense', 60]], unknown: ['passive Perception 10'] });
  }

  // reads senses with the comma between them missing
  {
    expect(read('blindsight 10 ft. darkvision 60 ft., passive Perception 14', DND))
      .toEqual({ senses: [['Blindsight', 10], ['Darkvision', 60]], unknown: ['passive Perception 14'] });
    expect(read('keensense 30 ft. darkvision 60 ft.', DND)).toEqual({ senses: [['Darkvision', 60]], unknown: ['keensense 30 ft.'] });
  }

  // reports what follows a sense and is none itself
  {
    expect(read('darkvision 60 ft. passive Perception 12', DND)).toEqual({ senses: [['Darkvision', 60]], unknown: ['passive Perception 12'] });
    expect(read('blindsight 10 ft. or 60 ft. while deafened', DND)).toEqual({ senses: [['Blindsight', 10]], unknown: ['or 60 ft. while deafened'] });
    expect(read('tremorsense (imprecise) within their entire bound home', PATHFINDER))
      .toEqual({ senses: [['Tremorsense']], unknown: ['within their entire bound home'] });
  }

  // leaves a phrase whole that names no sense anywhere
  {
    expect(read('hears and smells well', DND)).toEqual({ senses: [], unknown: ['hears and smells well'] });
    expect(read('hears heartbeats (imprecise) 60 feet', PATHFINDER)).toEqual({ senses: [], unknown: ['hears heartbeats (imprecise) 60 feet'] });
    expect(read('PASSIVE PERCEPTION 12.', DND)).toEqual({ senses: [], unknown: ['PASSIVE PERCEPTION 12.'] });
  }

  // ignores stray punctuation after a sense
  {
    expect(read('darkvision 60 ft..', DND)).toEqual({ senses: [['Darkvision', 60]], unknown: [] });
    expect(read('darkvision 60 ft.) , blindsight 10 ft.', DND)).toEqual({ senses: [['Darkvision', 60], ['Blindsight', 10]], unknown: [] });
  }

  // reads no sense from a distance of nothing, or one it cannot tell
  {
    expect(read('darkvision 0 ft.', DND)).toEqual({ senses: [], unknown: ['darkvision 0 ft.'] });
    expect(read('darkvision 1.000 ft.', DND)).toEqual({ senses: [], unknown: ['darkvision 1.000 ft.'] });
    expect(read('darkvision 1.000 ft.', DND, FEET, 'de').senses).toEqual([['Darkvision', 1000]]);
  }
});

it('parseSenses names from other rulebooks', () => {
  // reads ultravision as the collection's darkvision
  {
    expect(read('ultravision 60 ft.', DND).senses).toEqual([['Darkvision', 60]]);
    expect(read('Ultravision 90\'', OSE).senses).toEqual([['Infravision', 90]]);
    expect(read('ultravision 60 ft.', SHADOWDARK)).toEqual({ senses: [], unknown: ['ultravision 60 ft.'] });
  }

  // reads "devil sight" as Devil's Sight
  {
    expect(read('Devil sight 120ft, passive Perception 18', DND)).toEqual({ senses: [['Devil\'s Sight', 120]], unknown: ['passive Perception 18'] });
  }

  // leaves senses no collection defines unknown
  {
    expect(read('keensense 30 ft.', DND)).toEqual({ senses: [], unknown: ['keensense 30 ft.'] });
    expect(read('blood sense 90 ft., darkvision 60 ft.', DND)).toEqual({ senses: [['Darkvision', 60]], unknown: ['blood sense 90 ft.'] });
    expect(read('impaired sight 30 ft.', DND)).toEqual({ senses: [], unknown: ['impaired sight 30 ft.'] });
  }
});
