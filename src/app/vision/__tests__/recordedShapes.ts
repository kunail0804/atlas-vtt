import { exploredShapes, type ExploredShapes } from '../exploredShapes';

/**
 * What explored memory records, without the points its star-shaped polygons are drawn from (`fans`,
 * tested apart), in a scene whose players reveal it unless `scene` names who does.
 */
export function recorded(...[sight, scene, lights]: Parameters<typeof exploredShapes>): Omit<ExploredShapes, 'fans'> | null {
  const shapes = exploredShapes(sight, { exploredBy: 'players', ...scene }, lights);
  if (!shapes) return null;
  const rest: ExploredShapes = { ...shapes };
  delete rest.fans;
  return rest;
}
