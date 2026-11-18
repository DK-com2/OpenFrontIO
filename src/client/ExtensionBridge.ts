import type { GameView, PlayerView } from "./view";

export interface BridgePlayerInfo {
  id: string;
  smallID: number;
  name: string;
  displayName: string;
  team: string | null;
  type: string;
  isAlive: boolean;
  gold: number;
  troops: number;
  numTilesOwned: number;
  allies: number[];
}

export interface BridgeUnitInfo {
  id: number;
  type: string;
  x: number;
  y: number;
  ownerSmallID: number;
  troops: number;
  isActive: boolean;
}

export interface BridgeTileInfo {
  x: number;
  y: number;
  terrainType: number;
  isLand: boolean;
  isWater: boolean;
  hasFallout: boolean;
  ownerSmallID: number | null;
}

export interface BridgeOwnerGrid {
  width: number;
  height: number;
  step: number;
  owners: number[];
  terrain: number[];
}

export interface BridgeStateSnapshot {
  tick: number;
  elapsedSeconds: number;
  gameOver: boolean;
  inSpawnPhase: boolean;
  map: {
    width: number;
    height: number;
  };
  myPlayer: BridgePlayerInfo | null;
  players: BridgePlayerInfo[];
  units: BridgeUnitInfo[];
}

export interface OpenFrontExtensionBridge {
  version: number;
  isReady: () => boolean;
  getState: () => BridgeStateSnapshot | null;
  getTileInfo: (x: number, y: number) => BridgeTileInfo | null;
  getOwnerGrid: (step?: number) => BridgeOwnerGrid | null;
}

let activeGameView: GameView | null = null;

function serializePlayer(p: PlayerView): BridgePlayerInfo {
  return {
    id: String(p.id()),
    smallID: p.smallID(),
    name: p.name(),
    displayName: p.displayName(),
    team: p.team() !== null ? String(p.team()) : null,
    type: String(p.type()),
    isAlive: p.isAlive(),
    gold: Number(p.gold()),
    troops: p.troops(),
    numTilesOwned: p.numTilesOwned(),
    allies: p.allies().map((a) => a.smallID()),
  };
}

function buildBridge(): OpenFrontExtensionBridge {
  return {
    version: 1,
    isReady: () => activeGameView !== null,
    getState: () => {
      const gv = activeGameView;
      if (!gv) return null;
      const myP = gv.myPlayer();
      return {
        tick: gv.ticks(),
        elapsedSeconds: gv.elapsedGameSeconds(),
        gameOver: gv.gameOver(),
        inSpawnPhase: gv.inSpawnPhase(),
        map: {
          width: gv.width(),
          height: gv.height(),
        },
        myPlayer: myP ? serializePlayer(myP) : null,
        players: gv.players().map(serializePlayer),
        units: gv.units().map((u) => {
          const tile = u.tile();
          return {
            id: u.id(),
            type: String(u.type()),
            x: gv.x(tile),
            y: gv.y(tile),
            ownerSmallID: u.owner()?.smallID?.() ?? 0,
            troops: u.troops(),
            isActive: u.isActive(),
          };
        }),
      };
    },
    getTileInfo: (x: number, y: number) => {
      const gv = activeGameView;
      if (!gv) return null;
      const w = gv.width();
      const h = gv.height();
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const ref = gv.ref(Math.floor(x), Math.floor(y));
      const owner = gv.owner(ref);
      return {
        x: Math.floor(x),
        y: Math.floor(y),
        terrainType: gv.terrainType(ref),
        isLand: gv.isLand(ref),
        isWater: gv.isWater(ref),
        hasFallout: gv.hasFallout(ref),
        ownerSmallID: owner.isPlayer() ? owner.smallID() : null,
      };
    },
    getOwnerGrid: (step = 4) => {
      const gv = activeGameView;
      if (!gv) return null;
      const s = Math.max(1, Math.floor(step));
      const w = gv.width();
      const h = gv.height();
      const gw = Math.ceil(w / s);
      const gh = Math.ceil(h / s);
      const owners: number[] = new Array(gw * gh);
      const terrain: number[] = new Array(gw * gh);
      let idx = 0;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const ref = gv.ref(x, y);
          const owner = gv.owner(ref);
          owners[idx] = owner.isPlayer() ? owner.smallID() : 0;
          terrain[idx] = gv.terrainType(ref);
          idx++;
        }
      }
      return { width: gw, height: gh, step: s, owners, terrain };
    },
  };
}

/**
 * Registers a read-only Pull-based bridge on window.__openfrontBridge.
 * Zero runtime and network overhead when no extension reads from it.
 */
export function registerExtensionBridge(gameView: GameView): void {
  activeGameView = gameView;
  const win = window as unknown as {
    __openfrontBridge?: OpenFrontExtensionBridge;
  };
  win.__openfrontBridge ??= buildBridge();
}

export function unregisterExtensionBridge(): void {
  activeGameView = null;
}
