import { Container } from 'pixi.js';

/**
 * Stand-ins for the parts of `LightingRenderer` that draw: the engine and the explored memory.
 * A suite that holds what the view works out on the CPU (its sight, what it hands the memory to
 * record) mocks both modules with them, so it needs no graphics device.
 */

/** An engine that draws nothing; `takeRestored` says whether the graphics context came back since it was last asked. */
export function stubLightingEngine(takeRestored: () => boolean = () => false): new () => object {
  return class {
    readonly layer = new Container();
    readonly failed = false;
    takeRestored(): boolean { return takeRestored(); }
    renderFrame<T>(_frame: unknown, render: () => T): T { return render(); }
    hasWorld(): boolean { return false; }
    busy(): boolean { return false; }
    animate(): boolean { return false; }
    setEnabled(): void {}
    setCoverage(): void {}
    setExplored(): void {}
    setMode(): void {}
    setView(): void {}
    setGrid(): void {}
    update(): void {}
    flush(): void {}
    fail(): void {}
    destroy(): void {}
  };
}

/** A memory that keeps nothing; `record` hears what the view hands it to record. */
export function stubExploredMemory(record: (shapes: unknown) => void = () => undefined): new () => object {
  return class {
    sync(): void {}
    record(shapes: unknown): void { record(shapes); }
    stampDue(): boolean { return false; }
    reload(): void {}
    reset(): void {}
    edit(): boolean { return false; }
    forgetEdits(): void {}
    holdSaves(): void {}
    cancelSaves(): void {}
    beforeMapUnload(): void {}
    destroy(): void {}
  };
}
