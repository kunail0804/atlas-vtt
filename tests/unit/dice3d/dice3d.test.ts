import { describe, expect, it } from 'vitest';
import { dieGeometry, faceIndexForValue, faceQuaternion, lyingHeight, restingQuaternion, type DieSides } from '../../../src/app/dice3d/dieGeometry';
import { qRotate, vDot, vLength, vSub, qAngle } from '../../../src/app/dice3d/vectorMath';
import { beginRoll, makeDie, stepDie, type DieAnim } from '../../../src/app/dice3d/dieMotion';
import { restHeight, STAGE_X, STAGE_Z } from '../../../src/app/dice3d/dieTour';
import { throwRandom } from '../../../src/app/dice3d/throwSeed';
import { faceMarks } from '../../../src/app/dice3d/faceMarks';
import { faceOutline } from '../../../src/app/dice3d/faceFrame';
import { fitNumeral } from '../../../src/app/dice3d/numeralFit';
import { sceneFromRolls } from '../../../src/app/dice3d/diceScene';
import { beginThrow, burstOf } from '../../../src/app/dice3d/throwChain';

const ALL: DieSides[] = [4, 6, 8, 10, 12, 20];

/** A die without chance: the same throw every time. */
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return (): number => values[i++ % values.length]!;
}

/** Runs the die in 16 ms steps until it rests. */
function runUntilRest(die: DieAnim, rng: () => number, maxSeconds = 8): number {
  let t = 0;
  while (die.phase !== 'rest' && t < maxSeconds) {
    stepDie(die, 1 / 60, rng);
    t += 1 / 60;
  }
  return t;
}

const CELL = 256;

const d6 = (value: number, more: object = {}): { max: number; value: number } => ({ max: 6, value, ...more });

it('die bodies', () => {
  // every die has exactly as many faces as sides
  {
    for (const sides of ALL) {
      expect(dieGeometry(sides).faces).toHaveLength(sides);
    }
  }

  // every die carries every number exactly once
  {
    for (const sides of ALL) {
      const { values } = dieGeometry(sides);
      expect([...values].sort((a, b) => a - b)).toEqual(
        Array.from({ length: sides }, (_, i) => i + 1),
      );
    }
  }

  // all normals of every die point outwards
  {
    for (const sides of ALL) {
      const { normals, centers } = dieGeometry(sides);
      for (let i = 0; i < normals.length; i++) {
        expect(vDot(normals[i]!, centers[i]!)).toBeGreaterThan(0);
      }
    }
  }

  // all vertices of a face lie in one plane, on every die
  {
    for (const sides of ALL) {
      const { faces, vertices, normals, centers } = dieGeometry(sides);
      for (let i = 0; i < faces.length; i++) {
        for (const v of faces[i]!) {
          expect(Math.abs(vDot(vSub(vertices[v]!, centers[i]!), normals[i]!))).toBeLessThan(1e-6);
        }
      }
    }
  }

  // the numeral up of every die is perpendicular to the normal
  {
    for (const sides of ALL) {
      const { ups, normals } = dieGeometry(sides);
      for (let i = 0; i < ups.length; i++) {
        expect(Math.abs(vDot(ups[i]!, normals[i]!))).toBeLessThan(1e-9);
        expect(vLength(ups[i]!)).toBeCloseTo(1, 9);
      }
    }
  }

  // opposite faces add up to n+1 on the dice that have them
  {
    for (const sides of [6, 8, 10, 12, 20] as DieSides[]) {
        const { normals, values } = dieGeometry(sides);
        for (let i = 0; i < normals.length; i++) {
          const opposite = normals.findIndex((n, j) => j !== i && vDot(normals[i]!, n) < -0.999);
          expect(opposite).toBeGreaterThanOrEqual(0);
          expect(values[i]! + values[opposite]!).toBe(sides + 1);
        }
      }
  }
});

it('target orientation', () => {
  // puts the target face of every die on top, numeral readable
  {
    for (const sides of ALL) {
      const geometry = dieGeometry(sides);
      for (let value = 1; value <= sides; value++) {
        const face = faceIndexForValue(geometry, value);
        const q = faceQuaternion(geometry, face);
        const normal = qRotate(q, geometry.normals[face]!);
        const up = qRotate(q, geometry.ups[face]!);

        // Seen from above: the face is on top and the numeral's head points to
        // −Z, up on screen.
        expect(normal[1]).toBeCloseTo(1, 9);
        expect(up[2]).toBeCloseTo(-1, 9);
      }
    }
  }

  // every die comes to rest lying on a face
  {
    for (const sides of ALL) {
      const geometry = dieGeometry(sides);
      for (let face = 0; face < sides; face++) {
        for (const yaw of [0, 0.3, -0.3]) {
          const q = restingQuaternion(geometry, face, yaw);
          const heights = geometry.vertices.map((v) => qRotate(q, v)[1]);
          const lowest = Math.min(...heights);
          expect(heights.filter((y) => y - lowest < 1e-6).length).toBeGreaterThanOrEqual(3);
          expect(-lowest).toBeCloseTo(lyingHeight(geometry), 6);
        }
      }
    }
  }

  // the rolled face of every resting die is the one on top
  {
    for (const sides of [6, 8, 10, 12, 20] as DieSides[]) {
      const geometry = dieGeometry(sides);
      for (let face = 0; face < sides; face++) {
        expect(qRotate(restingQuaternion(geometry, face, 0.2), geometry.normals[face]!)[1]).toBeCloseTo(1, 9);
      }
    }
  }

  // a resting d4 lies on its rolled face, one face turned to the viewer
  {
    const geometry = dieGeometry(4);
    for (let face = 0; face < 4; face++) {
      const q = restingQuaternion(geometry, face);
      expect(qRotate(q, geometry.normals[face]!)[1]).toBeCloseTo(-1, 9);
      const front = geometry.normals.map((n) => qRotate(q, n)).sort((a, b) => b[2] - a[2])[0]!;
      expect(front[0]).toBeCloseTo(0, 9);
      expect(front[2]).toBeGreaterThan(0.9);
    }
  }

  // finds the face of every number
  {
    const geometry = dieGeometry(20);
    for (let value = 1; value <= 20; value++) {
      expect(geometry.values[faceIndexForValue(geometry, value)]).toBe(value);
    }
  }
});

it('the throw', () => {
  // lies ready and only shoots off at launch
  {
    const rng = fixedRng(0.3, 0.6, 0.2, 0.8);
    const die = makeDie(rng);
    // Before the throw the die lies visibly on its spot, no flight in from
    // outside.
    expect(die.phase).toBe('rest');
    expect(die.p[1]).toBeCloseTo(restHeight(die.radius), 6);
    expect(vLength(die.w)).toBe(0);

    beginRoll(die, die.q, 0, rng);
    // The launch: a hop upwards, a wild spin.
    expect(die.phase).toBe('throw');
    expect(die.v[1]).toBeGreaterThan(1);
    expect(vLength(die.w)).toBeGreaterThan(20);
  }

  // travels across the table but stays in frame
  {
    const rng = fixedRng(0.37, 0.81, 0.12, 0.66, 0.49, 0.93);
    const home: [number, number] = [0.8, 0.3];
    const die = makeDie(rng, home, 0.62);
    beginRoll(die, die.q, 0, rng);

    let farthest = 0;
    for (let i = 0; i < 600 && die.phase === 'throw'; i++) {
      stepDie(die, 1 / 60, rng);
      // No body ever hangs half off the stage (bound minus its own radius).
      expect(Math.abs(die.p[0])).toBeLessThanOrEqual(STAGE_X - die.radius + 1e-6);
      expect(Math.abs(die.p[2])).toBeLessThanOrEqual(STAGE_Z - die.radius + 1e-6);
      farthest = Math.max(farthest, Math.abs(die.p[0] - home[0]));
    }
    // It really travelled, further than a hand's width.
    expect(farthest).toBeGreaterThan(1);
    // And it still whirled: more than one bounce.
    expect(die.bounces).toBeGreaterThan(1);
  }

  // ends exactly on its spot without anything pulling it there
  {
    for (let n = 0; n < 60; n++) {
      const rng = throwRandom('motion-arrival', n);
      const home: [number, number] = [(rng() - 0.5) * 2.4, (rng() - 0.5) * 1.4];
      const die = makeDie(rng, home, 0.7);
      beginRoll(die, die.q, 0, rng);

      let arrival = 0;
      let fastest = 0;
      for (let i = 0; i < 400 && die.phase === 'throw'; i++) {
        stepDie(die, 1 / 60, rng);
        arrival = Math.hypot(die.v[0], die.v[2]);
        fastest = Math.max(fastest, arrival);
      }

      // It arrived on the point it flew off from.
      expect(die.p[0]).toBeCloseTo(home[0], 6);
      expect(die.p[2]).toBeCloseTo(home[1], 6);
      // And it **rolled out**, it was not stopped: measured against its own
      // top speed, whatever the pace of the throw.
      expect(arrival).toBeLessThan(fastest * 0.06);
    }
  }

  // bangs into the walls on its way, and at the wall
  {
    for (let n = 0; n < 40; n++) {
      const rng = throwRandom('motion-wall', n);
      const die = makeDie(rng, [0, 0], 0.92);
      beginRoll(die, die.q, 0, rng);

      let hits = 0;
      for (let i = 0; i < 400 && die.phase === 'throw'; i++) {
        stepDie(die, 1 / 60, rng);
        if (die.impact?.kind !== 'wall') continue;
        hits++;
        // **The contact point is reported**: on the stage edge itself, a radius
        // outside the centre, even though the hit is noticed a frame late.
        const axis = die.impact.normal[0] !== 0 ? 0 : 2;
        const edge = axis === 0 ? STAGE_X : STAGE_Z;
        expect(Math.abs(die.impact.at[axis])).toBeCloseTo(edge, 9);
        // **At the wall it really was at.** A wrong side was once reported
        // whenever the die flew backwards on this axis. At the moment of the
        // hit the centre is on the same side as the contact point.
        expect(Math.sign(die.impact.at[axis])).toBe(Math.sign(die.p[axis]));
        // The body stands *at* the wall: within its own length of where its
        // centre touches the wall.
        expect(edge - die.radius - Math.abs(die.p[axis])).toBeLessThan(die.radius);
      }
      // Three is the least that looks like pinball (see `WALL_PAIRS`).
      expect(hits).toBeGreaterThanOrEqual(3);
      expect(die.wallHits).toBe(hits);
    }
  }

  // reports every impact for exactly one frame
  {
    const rng = throwRandom('motion-impact', 0);
    const die = makeDie(rng);
    beginRoll(die, die.q, 0, rng);

    let reported = 0;
    for (let i = 0; i < 300 && die.phase !== 'rest'; i++) {
      stepDie(die, 1 / 60, rng);
      if (die.impact === null) continue;
      reported++;
      // Reading it again next frame would play the sound twice.
      const impact = die.impact;
      stepDie(die, 1 / 600, rng);
      if (die.impact !== null) expect(die.impact).not.toBe(impact);
    }
    expect(reported).toBeGreaterThan(3);
  }

  // spins until the last frame and stops without starting again, for every seed
  {
    for (const seed of [2954, 3862, 9006, ...Array.from({ length: 40 }, (_, seed) => seed)]) {
      const geometry = dieGeometry(20);
      const rng = throwRandom('motion-regression', seed);
      const die = makeDie(rng);
      const target = restingQuaternion(geometry, faceIndexForValue(geometry, 1 + (seed % 20)));
      beginRoll(die, target, 0, rng);

      const steps: number[] = [];
      // The pose in the last frame still in flight: whatever is missing here
      // would have to be turned in later.
      let lastCollision = -1;
      let before = die.q;
      let last = die.q;
      for (let i = 0; i < 400 && die.phase !== 'rest'; i++) {
        last = die.q;
        stepDie(die, 1 / 60, rng);
        if (die.impact?.kind === 'wall' || die.impact?.kind === 'floor') lastCollision = steps.length;
        steps.push(qAngle(before, die.q));
        before = die.q;
      }

      // **Nothing is left over.** Before the last step the die already shows
      // its number; resting only fixes it.
      expect(qAngle(last, die.target)).toBeLessThan(0.02);

      const peak = Math.max(...steps);
      // The last step is a run-out, not a new start.
      expect(steps[steps.length - 1]!).toBeLessThan(peak * 0.03);
      // And it spins until the end rather than waiting half a second for its cue.
      expect(steps[steps.length - 6]!).toBeGreaterThan(0);
      // **No second start.** Once below a tenth of its peak nothing follows.
      // Collisions can briefly slow or reverse a tumbling die. The final
      // run-out starts after the last collision, not at an earlier speed dip.
      const ranOut = steps.findIndex((w, index) => index > lastCollision && w < peak * 0.1);
      expect(ranOut).toBeGreaterThan(0);
      for (const step of steps.slice(ranOut)) {
        expect(step).toBeLessThan(peak * 0.2);
      }
    }
  }

  // comes to rest exactly on the rolled number
  {
    const geometry = dieGeometry(20);
    const rng = fixedRng(0.17, 0.83, 0.41, 0.62, 0.29, 0.95);

    for (const value of [1, 7, 13, 20]) {
      const die = makeDie(rng);
      const target = faceQuaternion(geometry, faceIndexForValue(geometry, value));
      beginRoll(die, target, 0, rng);
      runUntilRest(die, rng);

      expect(die.phase).toBe('rest');
      // The face on top is the one the throw promised.
      const facing = geometry.normals
        .map((n, i) => ({ i, y: qRotate(die.q, n)[1] }))
        .sort((a, b) => b.y - a.y)[0]!;
      expect(geometry.values[facing.i]).toBe(value);
    }
  }

  // loses spin while it whirls and bounces
  {
    const rng = fixedRng(0.5, 0.2, 0.7, 0.35);
    const die = makeDie(rng);
    beginRoll(die, die.q, 0, rng);
    const start = vLength(die.w);
    for (let i = 0; i < 90; i++) stepDie(die, 1 / 60, rng);
    expect(vLength(die.w)).toBeLessThan(start);
  }

  // hits the table and bounces back
  {
    const rng = fixedRng(0.41, 0.67, 0.23, 0.88, 0.15);
    const die = makeDie(rng);
    beginRoll(die, die.q, 0, rng);

    let bounced = false;
    for (let i = 0; i < 600 && !bounced; i++) {
      const falling = die.v[1] < 0;
      stepDie(die, 1 / 60, rng);
      if (falling && die.v[1] > 0) bounced = true;
    }
    expect(bounced).toBe(true);
  }

  // ends lying on its face, and lying down is no impact
  {
    const geometry = dieGeometry(4);
    const lie = lyingHeight(geometry);
    expect(lie).toBeCloseTo(1 / 3, 6);

    const throwOf = (share?: number): DieAnim => {
      const rng = fixedRng(0.19, 0.71, 0.44, 0.36, 0.83, 0.27);
      const die = makeDie(rng, [0, 0], 0.92, [STAGE_X, STAGE_Z], share);
      beginRoll(die, restingQuaternion(geometry, 0), 0, rng);
      return die;
    };
    const lying = throwOf(lie);
    const tumbling = throwOf();
    const rng = fixedRng(0.5);
    let floorHits = 0;
    while (lying.phase !== 'rest') {
      stepDie(lying, 1 / 60, rng);
      stepDie(tumbling, 1 / 60, rng);
      if (lying.impact?.kind === 'floor') floorHits += 1;
      expect(lying.p[1]).toBeGreaterThanOrEqual(restHeight(lying.radius, lie) - 1e-6);
    }
    expect(lying.p[1]).toBeCloseTo(restHeight(lying.radius, lie), 6);
    // The same throw with the table at one height bounces exactly as often.
    expect(floorHits).toBe(tumbling.bounces);
    expect(lying.bounces).toBe(tumbling.bounces);
  }

  // never falls through the table
  {
    const geometry = dieGeometry(20);
    const rng = fixedRng(0.19, 0.71, 0.44, 0.36, 0.83, 0.27);
    const die = makeDie(rng);
    beginRoll(die, faceQuaternion(geometry, 0), 0, rng);

    const floor = restHeight(die.radius);
    for (let i = 0; i < 600; i++) {
      stepDie(die, 1 / 60, rng);
      expect(die.p[1]).toBeGreaterThanOrEqual(floor - 1e-6);
    }
  }

  // rests after a good second, but not at once
  {
    const geometry = dieGeometry(20);
    const rng = fixedRng(0.11, 0.73, 0.52, 0.28, 0.91, 0.46);
    const die = makeDie(rng);
    beginRoll(die, faceQuaternion(geometry, 0), 0, rng);

    const seconds = runUntilRest(die, rng);
    expect(seconds).toBeGreaterThan(0.8);
    expect(seconds).toBeLessThan(3);
  }

  // waits out its delay before flying off
  {
    const rng = fixedRng(0.4, 0.6, 0.25);
    const die = makeDie(rng);
    beginRoll(die, die.q, 0.2, rng);
    const height = die.p[1];

    stepDie(die, 1 / 60, rng);
    expect(die.p[1]).toBe(height);
    expect(die.phase).toBe('throw');
  }

  // counts the time since resting for the highlight
  {
    const rng = fixedRng(0.5);
    const die = makeDie(rng);
    die.phase = 'rest';
    stepDie(die, 0.25, rng);
    expect(die.restFor).toBeCloseTo(0.25, 6);
  }
});

describe('faceMarks', () => {
  it('gives each face of every die its own number, centred and upright', () => {
    for (const sides of [6, 8, 10, 12, 20] as DieSides[]) {
      const geometry = dieGeometry(sides);
      for (let face = 0; face < sides; face++) {
        expect(faceMarks(geometry, face, CELL)).toEqual([
          { value: geometry.values[face], at: [0, 0], up: [0, 1], room: faceOutline(geometry, face, CELL) },
        ]);
      }
    }
  });

  it('on the d4', () => {
    const geometry = dieGeometry(4);

    // writes at each corner the number of the face that lies down when that corner is the tip
    {
      for (let face = 0; face < 4; face++) {
        const marks = faceMarks(geometry, face, CELL);
        expect(marks).toHaveLength(3);
        geometry.faces[face]!.forEach((vertex, i) => {
          const lyingDown = geometry.faces.findIndex((corners) => !corners.includes(vertex));
          expect(marks[i]!.value).toBe(geometry.values[lyingDown]);
        });
      }
    }

    // turns each number head first to its corner
    {
      for (let face = 0; face < 4; face++) {
        const outline = faceOutline(geometry, face, CELL);
        faceMarks(geometry, face, CELL).forEach((mark, i) => {
          const [cx, cy] = outline[i]!;
          const reach = Math.hypot(cx, cy);
          expect(mark.up[0]).toBeCloseTo(cx / reach, 9);
          expect(mark.up[1]).toBeCloseTo(cy / reach, 9);
          // Between the centre and the corner.
          expect(Math.hypot(...mark.at)).toBeLessThan(reach);
          expect(mark.at[0] * cx + mark.at[1] * cy).toBeGreaterThan(0);
        });
      }
    }

    // leaves each number room of its own
    {
      for (const mark of faceMarks(geometry, 0, CELL)) {
        // A numeral a sixth of the cell high still fits its corner of the face.
        expect(fitNumeral(mark.room, CELL * 0.11, CELL * 0.16)).toBe(1);
        // The corner itself lies straight above the numeral, in its own frame.
        const top = mark.room.reduce((a, b) => (b[1] > a[1] ? b : a));
        expect(top[0]).toBeCloseTo(0, 9);
      }
    }
  });
});

it('a throw with exploding dice', () => {
  const scene = sceneFromRolls([d6(6), d6(6, { exploded: true }), d6(2, { exploded: true }), d6(3)])!;

  const geometry = dieGeometry(6);

  const targets = scene.faces.map((face) => restingQuaternion(geometry, faceIndexForValue(geometry, face)));

  // throws the dice of the roll at once and each extra die after the die before it has landed
  {
    const anims = scene.plan.map((_, i) => makeDie(throwRandom('roll', -1 - i)));
    beginThrow(anims, scene.plan, targets, (i) => throwRandom('roll', i));

    const [first, second, third, beside] = anims as [DieAnim, DieAnim, DieAnim, DieAnim];
    // The two dice of the roll leave together, a beat apart; the extra dice wait.
    expect(first.delay).toBe(0);
    expect(beside.delay).toBeGreaterThan(0);
    expect(beside.delay).toBeLessThan(0.2);
    expect(second.delay).toBeGreaterThan(first.tour.duration);
    expect(third.delay).toBeGreaterThan(second.delay + second.tour.duration);

    // Run the throw: no extra die moves before its die lies.
    const rng = throwRandom('roll', 99);
    for (let frame = 0; frame < 60 * 30 && anims.some((anim) => anim.phase !== 'rest'); frame++) {
      const restingBefore = anims.map((anim) => anim.phase === 'rest');
      for (const anim of anims) stepDie(anim, 1 / 60, rng);
      if (second.delay <= 0) expect(restingBefore[0]).toBe(true);
      if (third.delay <= 0) expect(restingBefore[1]).toBe(true);
    }
    expect(anims.every((anim) => anim.phase === 'rest')).toBe(true);
  }

  // bursts where a die exploded: as a success upwards, as a failure downwards
  {
    expect(scene.plan.map((_, i) => burstOf(scene.plan, i))).toEqual(['high', 'high', null, null]);
    const fumble = sceneFromRolls([{ max: 10, value: 1 }, { max: 10, value: 7, exploded: true, negative: true }])!;
    expect(fumble.plan.map((_, i) => burstOf(fumble.plan, i))).toEqual(['low', null]);
  }
});
