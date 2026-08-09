// ---------- 引擎 <-> UI 契约（v4：信息分层 / 节点地图 / 房间 / 流派 / 模块） ----------
import type { SaveData, StageId } from "./config";
import type {
  OreQuality, Difficulty, BuffId, EquipmentInstance, BmStockItem, Rating,
} from "./items";

export type RunPhase =
  | "idle" | "descending" | "observe" | "drilling" | "result"
  | "hazard" | "anomaly" | "bandit" | "blackmarket" | "gameover" | "surfaced"
  // v4 新增阶段
  | "route"          // 节点分岔选择
  | "room"           // 特殊房间
  | "module"         // 局内 3 选 1 模块
  | "base"           // 前进营地（检查点改造）
  | "boss";          // 区域 Boss 事件

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
  danger?: number;      // v4：携带副作用（每堆增加的塌方风险/吸引生物等 0..0.3）
};

export type RunConfig = {
  difficulty: Difficulty;
  pocket: number;               // 携带的随身现金
  buffs: BuffId[];
  equipment: EquipmentInstance[]; // 本次携带的装备实例
  items: string[];              // 本次携带的消耗品 itemId（从仓库扣除）
  // v4
  archetype: ArchetypeId | null;  // 流派（未解锁/未选为 null）
  seed: string;                  // 本局种子（每日挑战/固定种子用）
  challenge: ChallengeId[];      // 挑战词缀
};

// ================= v4：流派 =================

export type ArchetypeId = "hunter" | "overdriver" | "scavenger" | "survivor";

export type ArchetypeDef = {
  id: ArchetypeId;
  name: string;
  icon: string;
  desc: string;            // 一句话定位
  perkDesc: string[];      // 初始增益描述
  color: string;
  unlockHint: string;      // 解锁条件描述
};

// ================= v4：挑战词缀 =================

export type ChallengeId = "no_checkpoint" | "no_blackmarket" | "limited_gear" | "abyssal_seed";

// ================= v4：节点地图与路线 =================

export type RouteId = "rich" | "facility" | "safe";

export type RouteChoice = {
  id: RouteId;
  name: string;
  desc: string;
  riskLabel: string;    // 风险描述（模糊）
  rewardLabel: string;  // 收益描述
  icon: string;
  qualityShift?: number;   // 对层品质的偏移
  riskShift?: number;      // 对塌方风险的偏移
  roomBoost?: number;      // 特殊房间出现概率加成（设施路线）
};

// ================= v4：特殊房间 =================

export type RoomId =
  | "minecart" | "collapsed_warehouse" | "bm_backdoor" | "geolab"
  | "nest" | "cooling_spring" | "ancient_gate" | "unstable_shaft";

export type RoomOption = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  hint?: string;   // 灰色小字提示
};

export type RoomView = {
  id: RoomId;
  title: string;
  desc: string;
  options: RoomOption[];
  visited?: boolean; // 已探索过（房间只完整结算一次）
};

// ================= v4：局内模块（3 选 1） =================

export type ModuleId =
  | "beacon" | "overclock" | "coolant" | "tractor" | "scanner" | "shield"
  | "gas_engine" | "compactor" | "bait" | "drill_head" | "vent" | "dredge";

export type ModuleChoice = {
  id: ModuleId;
  name: string;
  desc: string;
  icon: string;
  tags: string[];   // ["收益","风险"] 等分类标签
};

// ================= v4：前进营地（检查点） =================

export type BaseOption = { id: string; label: string; desc: string; icon: string };

export type ForwardBaseView = {
  depth: number;
  built: boolean;         // 是否已建成（首次需交付材料）
  needOre: { id: string; quality: OreQuality; count: number } | null;
  options: BaseOption[];  // 建成后可选的补给方向
};

// ================= v4：区域 Boss =================

export type BossView = {
  id: string;
  name: string;
  desc: string;
  hp: number;
  maxHp: number;
  actions: BossAction[];
};

export type BossAction = { id: string; label: string; desc: string; icon: string };

// ================= v4：信息分层 =================

export type RevealLevel = "none" | "basic" | "full";

// ================= v4：风险与撤离信息 =================

export type RiskRange = { min: number; max: number; label: string; color: string };

export type EvacInfo = {
  saveNow: number;           // 现在撤离可保全价值
  expectedLossPct: number;   // 灾难预计损失比例（受安全升级/异常修正）
  expectedLossValue: number;
  nextMilestone: { depth: number; name: string } | null;
  taskSummary: string[];
  bagDanger: number;         // 背包携带副作用导致的额外风险
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
  // v4
  archetype: ArchetypeId | null;
  challenge: ChallengeId[];
  revealLevel: RevealLevel;
  routes: RouteChoice[] | null;       // 分岔选择（phase === "route" 时非空）
  room: RoomView | null;              // 特殊房间（phase === "room" 时非空）
  moduleChoice: ModuleChoice[] | null; // 3 选 1（phase === "module" 时非空）
  base: ForwardBaseView | null;        // 前进营地（phase === "base" 时非空）
  boss: BossView | null;               // 区域 Boss（phase === "boss" 时非空）
  evac: EvacInfo | null;
  riskRange: RiskRange | null;         // 当前层修正后风险区间
  retreatBlocked: number;              // 撤退封锁剩余层数
  cautiousCooldown: number;            // 稳妥模式冷却（剩余层数）
  layer: {
    signals: string[];
    hardnessText: string;
    qualityText: string;
    hazardText: string | null;
    collapseRiskLabel: string;
    revealed: RevealLevel;
    anomalyEffect: string | null;
    milkingAvailable: boolean;
    milkCount: number;
    stage: StageId;
    nodePreview: Array<{ name: string; riskLabel: string; rewardLabel: string }>;
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
  log: LogEntry[];
  drilling: { progress: number; mode: "cautious" | "standard" | "overload"; hardness: number; heat: number; canStop: boolean } | null;
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
