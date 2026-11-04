import { describe, expect, it } from 'vitest';

import {
  dieGeometry,
  faceIndexForValue,
  faceQuaternion,
  lyingHeight,
  restingQuaternion,
  type DieSides,
} from '../../../src/app/dice3d/dieGeometry';
import { qRotate, vDot, vLength, vSub } from '../../../src/app/dice3d/vectorMath';

const ALL: DieSides[] = [4, 6, 8, 10, 12, 20];

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
