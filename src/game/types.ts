// ---------- 引擎 <-> UI 契约（v2） ----------
import type { SaveData, StageId } from "./config";
import type {
  OreQuality, Difficulty, BuffId, EquipmentInstance, BmStockItem, Rating,
} from "./items";

export type RunPhase =
  | "idle" | "descending" | "observe" | "drilling" | "result"
  | "hazard" | "anomaly" | "bandit" | "blackmarket" | "gameover" | "surfaced";

export type LogEntry = { text: string; kind: "info" | "good" | "bad" | "warn" };

export type BagSlot = {
  key: string;          // ore: `${oreId}:${quality}`  item: `item:${itemId}`
  kind: "ore" | "item";
  id: string;
  quality?: OreQuality;
  count: number;        // 矿石 1..99，道具 1
  name: string;
  color: string;
  icon?: string;
  value: number;        // 该堆总价值
  unitValue: number;    // 单价（矿石）
};

export type RunConfig = {
  difficulty: Difficulty;
  pocket: number;               // 携带的随身现金
  buffs: BuffId[];
  equipment: EquipmentInstance[]; // 本次携带的装备实例
  items: string[];              // 本次携带的消耗品 itemId（从仓库扣除）
};

export type DailyTaskView = {
  id: string;
  desc: string;
  progress: number;
  target: number;
  claimed: boolean;
  reward: string;
};

export type BlackMarketView = {
  sellRatio: number;
  buyDiscount: number;
  stock: BmStockItem[];
  repairCost: number;
  repairPct: number;
  favor: number;
  tasks: DailyTaskView[];
  pocket: number;
  slots: number;
  usedSlots: number;
  bag: BagSlot[];
  depth: number;
};

export type UiSnapshot = {
  phase: RunPhase;
  depth: number;
  stageName: string;
  power: number; maxPower: number;
  durability: number; maxDurability: number;
  overheat: number;
  combo: number;
  supports: number;
  detectors: number;
  slots: number;                // 总格子数
  usedSlots: number;            // 已用格子
  bag: BagSlot[];
  load: number;                 // 背包总价值
  pocket: number;               // 随身现金
  difficulty: Difficulty;
  wearPenalty: number;          // 0..0.3 损耗惩罚
  buffs: BuffId[];
  canBlackMarket: boolean;
  blackmarket: BlackMarketView | null;
  layer: {
    signals: string[];
    hardnessText: string;
    qualityText: string;
    hazardText: string | null;
    collapseRiskLabel: string;
    revealed: boolean;
    anomalyEffect: string | null;
    milkingAvailable: boolean;
    milkCount: number;
    stage: StageId;
  } | null;
  result: {
    ores: BagSlot[];
    value: number;
    comboDelta: number;
    events: string[];
    canMilk: boolean;
    milkRewardMult: number | null;
    layers: number;
    canBlackMarket: boolean;
    droppedItem: { name: string; icon: string } | null;
  } | null;
  hazard: { type: "creature"; severity: number } | null;
  anomaly: { text: string } | null;
  bandit: { severity: number; pocket: number } | null;
  gameover: { reason: string; lost: number; saved: number; depth: number; best: boolean; pocketLost: number } | null;
  surfaced: {
    banked: number; depth: number; totalBanked: number; best: boolean;
    rating: Rating | null; bonusCash: number; pocketReturn: number;
  } | null;
  retreatBlocked: boolean;
  log: LogEntry[];
  drilling: { progress: number; mode: "cautious" | "standard" | "overload"; hardness: number } | null;
  canDrill: boolean;
};

export type RunResult = {
  kind: "surfaced" | "disaster";
  banked: number;
  depth: number;
  best: boolean;
  rating: Rating | null;
  bonus: number;
  save: SaveData;
};

export type EngineCallbacks = { onUi: (snap: UiSnapshot) => void; onRunEnd: (result: RunResult) => void };

