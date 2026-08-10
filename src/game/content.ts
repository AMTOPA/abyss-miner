// ---------- v4 内容数据：流派 / 特殊房间 / 局内模块 / 装备规则特性 ----------
import type { ArchetypeDef, ArchetypeId, ChallengeId, ModuleChoice, ModuleId, RoomId } from "./types";
import type { StageId } from "./config";

// ================= 流派 =================

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  hunter: {
    id: "hunter", name: "矿脉猎人", icon: "🔍",
    desc: "读信号、找高品质、精准收获",
    perkDesc: ["探测精度 +20%", "开局 +1 探测器", "高品质矿石概率 +10%", "丢弃普通矿可提高稀有率"],
    color: "#5fc98f",
    unlockHint: "首次最深达 200m 解锁",
  },
  overdriver: {
    id: "overdriver", name: "超载钻工", icon: "⚡",
    desc: "热量、穿透、损耗换爆发",
    perkDesc: ["超载收益 +20%", "临界过热可范围爆破", "损坏部件提供短时增益"],
    color: "#ff9f43",
    unlockHint: "单局完成 3 次超载钻进解锁",
  },
  scavenger: {
    id: "scavenger", name: "拾荒商人", icon: "🛒",
    desc: "背包、黑市、现金周转",
    perkDesc: ["开局背包格 +2", "黑市售价 +10%", "黑市折扣 +5%", "可赊账一次"],
    color: "#f4c063",
    unlockHint: "黑市累计交易 10 次解锁",
  },
  survivor: {
    id: "survivor", name: "深渊生存者", icon: "🛡️",
    desc: "异常、护盾、撤离保险",
    perkDesc: ["异常抗性 +25%", "异常转化为增益", "可消耗 Combo 保证一次撤离"],
    color: "#c77dff",
    unlockHint: "遭遇 3 次深渊异常后解锁",
  },
};

export const ARCHETYPE_ORDER: ArchetypeId[] = ["hunter", "overdriver", "scavenger", "survivor"];

// ================= 特殊房间（8 个） =================

export type RoomDef = {
  id: RoomId;
  title: string;
  icon: string;
  desc: string;
  options: Array<{ id: string; label: string; desc: string; icon: string; hint?: string }>;
};

export const ROOMS: Record<RoomId, RoomDef> = {
  minecart: {
    id: "minecart", title: "废弃矿车站", icon: "🚋",
    desc: "锈蚀的铁轨通向更深处，轨道上还停着一辆能用的矿车。",
    options: [
      { id: "ride", label: "乘矿车冲一段", desc: "立即前进 20m，但失去中途撤离机会", icon: "🚋", hint: "高风险高回报" },
      { id: "scrap", label: "拆解矿车", desc: "获得维修材料，钻机耐久 +20%", icon: "🔧" },
      { id: "leave", label: "步行离开", desc: "继续沿原路前进", icon: "🚶" },
    ],
  },
  collapsed_warehouse: {
    id: "collapsed_warehouse", title: "坍塌仓库", icon: "🏚️",
    desc: "矿工遗落的补给仓库，一半埋在碎石下。",
    options: [
      { id: "search", label: "搜寻补给", desc: "随机获得消耗品或现金", icon: "🎒", hint: "可能触发塌方" },
      { id: "clear", label: "清理通道", desc: "花费耐久清理，换取现金奖励", icon: "🪨" },
      { id: "leave", label: "离开", desc: "继续前进", icon: "🚶" },
    ],
  },
  bm_backdoor: {
    id: "bm_backdoor", title: "黑市暗门", icon: "🚪",
    desc: "墙上有一扇没有挂牌的铁门，里面传来低语和金币声。",
    options: [
      { id: "trade", label: "秘密交易", desc: "用随身现金按 8 折购买一件随机补给", icon: "🪙", hint: "折扣高于普通黑市" },
      { id: "tip", label: "举报给地面", desc: "获得黑市好感 +1（安全）", icon: "📯" },
      { id: "leave", label: "离开", desc: "不引人注意地走开", icon: "🚶" },
    ],
  },
  geolab: {
    id: "geolab", title: "地质实验舱", icon: "🔬",
    desc: "布满灰尘的研究舱，屏幕上还残留着地层分析数据。",
    options: [
      { id: "analyze", label: "研究岩样", desc: "本局高品质矿石概率 +15%", icon: "🧪" },
      { id: "extract", label: "提取数据", desc: "获得现金奖励（相当于当前背包价值 10%）", icon: "💾" },
      { id: "leave", label: "离开", desc: "继续前进", icon: "🚶" },
    ],
  },
  nest: {
    id: "nest", title: "生物巢穴", icon: "🕸️",
    desc: "岩壁上覆满黏稠的丝网，深处传来细碎的爬动声。",
    options: [
      { id: "steal", label: "悄悄取卵", desc: "可能获得稀有矿物，也可能惊醒巢穴", icon: "🥚", hint: "高收益高风险" },
      { id: "bait", label: "设置诱饵", desc: "接下来 3 层不会遭遇地底生物", icon: "🪤" },
      { id: "leave", label: "绕开", desc: "不要惊动它们", icon: "🚶" },
    ],
  },
  cooling_spring: {
    id: "cooling_spring", title: "冷却泉", icon: "💧",
    desc: "一股清冽的泉水从岩缝涌出，蒸汽在空气中凝结。",
    options: [
      { id: "cool", label: "灌满冷却剂", desc: "热量清零，且本局热量增长 -20%", icon: "❄️" },
      { id: "soak", label: "浸泡检修", desc: "恢复 25% 耐久", icon: "🛠️" },
      { id: "leave", label: "离开", desc: "继续前进", icon: "🚶" },
    ],
  },
  ancient_gate: {
    id: "ancient_gate", title: "古代机械门", icon: "⚙️",
    desc: "一扇刻满符文与齿轮的巨门挡住了去路，似乎可以启动。",
    options: [
      { id: "puzzle", label: "破解机关", desc: "成功则获得丰厚奖励，失败则触发陷阱", icon: "🧩", hint: "三选一：矿物/模块/陷阱" },
      { id: "force", label: "强行破门", desc: "损失 15% 耐久强行通过", icon: "💥" },
      { id: "leave", label: "绕路", desc: "返回主路线", icon: "🚶" },
    ],
  },
  unstable_shaft: {
    id: "unstable_shaft", title: "不稳定撤离井", icon: "🕳️",
    desc: "一口向上延伸的旧通风井，结构很不稳定。",
    options: [
      { id: "escape", label: "立刻撤离", desc: "立即结束本局并结算当前背包", icon: "🛗", hint: "放弃后续层数收益" },
      { id: "reinforce", label: "加固井壁", desc: "本局塌方风险 -25%", icon: "🧱" },
      { id: "leave", label: "无视", desc: "继续深入", icon: "🚶" },
    ],
  },
};

export const ROOM_ORDER: RoomId[] = [
  "minecart", "collapsed_warehouse", "bm_backdoor", "geolab",
  "nest", "cooling_spring", "ancient_gate", "unstable_shaft",
];

// ================= 局内模块（3 选 1 池） =================

export const MODULE_POOL: ModuleChoice[] = [
  { id: "beacon", name: "信标", desc: "下一层信息完全透明", icon: "📡", tags: ["信息"] },
  { id: "overclock", name: "超频芯片", desc: "本局超载收益 +25%，但过热累积 +30%", icon: "⚡", tags: ["收益", "风险"] },
  { id: "coolant", name: "冷却回路", desc: "热量增长 -40%，岩浆层不再额外扣耐久", icon: "❄️", tags: ["生存"] },
  { id: "tractor", name: "牵引束", desc: "满格时自动将最低价值矿石堆压缩合并", icon: "🧲", tags: ["背包"] },
  { id: "scanner", name: "深度扫描", desc: "每层自动揭示矿脉品质", icon: "🔭", tags: ["信息"] },
  { id: "shield", name: "护盾发生器", desc: "抵挡一次灾难（与应急护盾独立）", icon: "🛡️", tags: ["生存"] },
  { id: "gas_engine", name: "废气引擎", desc: "毒气不再扣电，反而每层 +10 电量", icon: "♻️", tags: ["转化"] },
  { id: "compactor", name: "压缩货舱", desc: "同种矿石堆叠上限提升至 999", icon: "📦", tags: ["背包"] },
  { id: "bait", name: "声呐诱饵", desc: "地底生物事件有 50% 概率自动避免", icon: "🐟", tags: ["生存"] },
  { id: "drill_head", name: "聚能钻头", desc: "穿透概率 +10%，穿透上限 +3 层", icon: "🌀", tags: ["收益"] },
  { id: "vent", name: "泄压阀", desc: "超载风险 -40%，超载收益 -10%", icon: "🌬️", tags: ["风险"] },
  { id: "dredge", name: "淘金网", desc: "每次结算额外获得 1-3 个当前层矿石", icon: "🕸️", tags: ["收益"] },
];

export function pickModules(count: number, rnd: () => number, exclude: ModuleId[] = []): ModuleChoice[] {
  const pool = MODULE_POOL.filter((m) => !exclude.includes(m.id));
  const out: ModuleChoice[] = [];
  const used = new Set<number>();
  const n = Math.min(count, pool.length);
  while (out.length < n) {
    const i = Math.floor(rnd() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(pool[i]);
  }
  return out;
}

// ================= 装备规则型特性（12-16 条） =================

export type TraitId =
  | "molten_heart" | "static_coil" | "lure_pouch" | "deep_sight" | "overclock_chip"
  | "pocket_dim" | "gas_convert" | "lucky_pick" | "ice_core" | "echo_lens"
  | "scrap_armor" | "double_dip" | "ghost_bit" | "rich_blood" | "vent_cool" | "magnet";

export const TRAITS: Record<TraitId, { name: string; icon: string; desc: string }> = {
  molten_heart:    { name: "熔炼之心", icon: "🔥", desc: "超载钻进的收益额外 +15%" },
  static_coil:     { name: "静电线圈", icon: "⚡", desc: "岩浆带电量消耗减半" },
  lure_pouch:      { name: "诱饵袋",   icon: "🪤", desc: "地底生物事件有 40% 概率直接驱散" },
  deep_sight:      { name: "深渊之眼", icon: "👁️", desc: "每层自动揭示矿脉品质" },
  overclock_chip:  { name: "超频芯片", icon: "🧠", desc: "超载临界时触发一次范围爆破，不损伤设备" },
  pocket_dim:      { name: "折叠空间", icon: "🌀", desc: "背包格 +1，且特殊物品不再占格" },
  gas_convert:     { name: "废气转化", icon: "♻️", desc: "毒气层改为每层 +15 电量" },
  lucky_pick:      { name: "幸运镐",   icon: "🍀", desc: "矿石品质提升判定额外 +5%" },
  ice_core:        { name: "冰核",     icon: "❄️", desc: "热量累积 -30%" },
  echo_lens:       { name: "回音透镜", icon: "🔊", desc: "探测器可预览下一节点的路线" },
  scrap_armor:     { name: "废料护甲", icon: "🛡️", desc: "损坏部件提供短时增益：耐久越低收益越高" },
  double_dip:      { name: "二次采收", icon: "⛏️", desc: "每层结算后额外获得 1 个该层矿石" },
  ghost_bit:       { name: "幻影钻头", icon: "👻", desc: "穿透不消耗额外电量" },
  rich_blood:      { name: "富矿血脉", icon: "🩸", desc: "携带高品质矿石时不再增加塌方风险" },
  vent_cool:       { name: "泄压阀",   icon: "🌬️", desc: "超载模式风险 -30%" },
  magnet:          { name: "磁力收纳", icon: "🧲", desc: "满格时自动压缩最低价值矿石堆" },
};

export const TRAIT_ORDER: TraitId[] = [
  "molten_heart", "static_coil", "lure_pouch", "deep_sight", "overclock_chip",
  "pocket_dim", "gas_convert", "lucky_pick", "ice_core", "echo_lens",
  "scrap_armor", "double_dip", "ghost_bit", "rich_blood", "vent_cool", "magnet",
];
// ================= 挑战词缀 =================

export const CHALLENGE_DEFS: Record<ChallengeId, {
  name: string;
  icon: string;
  desc: string;
  rewardMult: number;
}> = {
  no_checkpoint: {
    name: "无补给远征",
    icon: "🚫",
    desc: "禁用前进营地：无法建立营地，也没有检查点补给",
    rewardMult: 1.15,
  },
  no_blackmarket: {
    name: "与世隔绝",
    icon: "🚷",
    desc: "本局无法进入黑市，收益全靠矿石硬通货",
    rewardMult: 1.1,
  },
  limited_gear: {
    name: "轻装出发",
    icon: "🎒",
    desc: "最多携带 2 件装备进入矿洞",
    rewardMult: 1.2,
  },
  abyssal_seed: {
    name: "深渊诅咒",
    icon: "🌑",
    desc: "灾难损失比例翻倍，但收益大幅提高",
    rewardMult: 1.3,
  },
};

export const CHALLENGE_ORDER: ChallengeId[] = [
  "no_checkpoint",
  "no_blackmarket",
  "limited_gear",
  "abyssal_seed",
];

// ================= 矿物图鉴 =================

export const CODEX_MINERALS: Record<string, {
  name: string;
  desc: string;
  researchCost: number;
}> = {
  "stone:poor": { name: "劣质石料", desc: "岩层中最常见的填充物，几乎不值钱，但大型施工经常需要它。", researchCost: 5 },
  "stone:normal": { name: "普通石料", desc: "质地均匀的普通岩块，老矿工用它修补巷道地面。", researchCost: 8 },
  "stone:fine": { name: "优良石料", desc: "致密坚硬的上等石料，可加工成建筑构件。", researchCost: 15 },
  "stone:legendary": { name: "传奇石料", desc: "通体温润的罕见玉石，收藏家愿意出高价。", researchCost: 30 },

  "copper:poor": { name: "劣质铜矿", desc: "含铜量很低，只能勉强提炼出少量铜线。", researchCost: 5 },
  "copper:normal": { name: "普通铜矿", desc: "矿区最基础的导电金属，管线与设备的核心材料。", researchCost: 8 },
  "copper:fine": { name: "优良铜矿", desc: "纯度很高的红铜，电气性能出色。", researchCost: 15 },
  "copper:legendary": { name: "传奇铜矿", desc: "自然形成的紫铜结晶，堪比艺术品。", researchCost: 30 },

  "iron:poor": { name: "劣质铁矿", desc: "含铁量偏低，回炉后只能打些铁钉。", researchCost: 5 },
  "iron:normal": { name: "普通铁矿", desc: "坚固的结构钢材来源，升级钻机与支撑架的关键。", researchCost: 8 },
  "iron:fine": { name: "优良铁矿", desc: "韧性极佳的铁矿，锻造钻头齿的首选。", researchCost: 15 },
  "iron:legendary": { name: "传奇铁矿", desc: "传说中的陨铁，硬度与韧性远超凡铁。", researchCost: 30 },

  "silver:poor": { name: "劣质银矿", desc: "含银量稀疏，挑灯细看才能看到几点银星。", researchCost: 5 },
  "silver:normal": { name: "普通银矿", desc: "银光闪烁的贵金属，在旧矿井深处仍有矿脉分布。", researchCost: 8 },
  "silver:fine": { name: "优良银矿", desc: "成色上佳的银矿，打磨后亮得能照出人影。", researchCost: 15 },
  "silver:legendary": { name: "传奇银矿", desc: "天然银晶簇，是地表贵族争相收藏的珍品。", researchCost: 30 },

  "gold:poor": { name: "劣质金矿", desc: "金沙稀少，淘洗半天也凑不出一小撮。", researchCost: 5 },
  "gold:normal": { name: "普通金矿", desc: "高纯度金矿，地下商人们永远愿意收购的硬通货。", researchCost: 8 },
  "gold:fine": { name: "优良金矿", desc: "金光耀眼的高品位金矿，足以换取一整批补给。", researchCost: 15 },
  "gold:legendary": { name: "传奇金矿", desc: "狗头金！老矿工一辈子也难见几次的天然金块。", researchCost: 30 },

  "diamond:poor": { name: "劣质钻石", desc: "带裂纹的小粒钻石，只能做工业磨料。", researchCost: 5 },
  "diamond:normal": { name: "普通钻石", desc: "极硬碳结晶，可打磨成顶级钻头齿，价值不菲。", researchCost: 8 },
  "diamond:fine": { name: "优良钻石", desc: "纯净通透的宝石级钻石，切割后光彩夺目。", researchCost: 15 },
  "diamond:legendary": { name: "传奇钻石", desc: "硕大的无瑕巨钻，足以让整个矿区为之轰动。", researchCost: 30 },

  "crystal:poor": { name: "劣质深渊晶体", desc: "黯淡无光的碎片，似乎还在微微搏动。", researchCost: 5 },
  "crystal:normal": { name: "普通深渊晶体", desc: "深渊独有的能量晶体，发出幽绿微光，科研价值极高。", researchCost: 8 },
  "crystal:fine": { name: "优良深渊晶体", desc: "通体莹亮的高能晶体，摸上去有种奇异的温暖。", researchCost: 15 },
  "crystal:legendary": { name: "传奇深渊晶体", desc: "核心如星核般明亮的深渊结晶，连研究所都在重金悬赏。", researchCost: 30 },

  "unknown:poor": { name: "劣质未知矿物", desc: "现有仪器无法识别的矿物碎屑，散发着诡异的荧光。", researchCost: 5 },
  "unknown:normal": { name: "普通未知矿物", desc: "无法被现有仪器识别的矿物，可能是深渊深处的馈赠。", researchCost: 8 },
  "unknown:fine": { name: "优良未知矿物", desc: "结构前所未见的矿物，每块都值得写一篇论文。", researchCost: 15 },
  "unknown:legendary": { name: "传奇未知矿物", desc: "来自深渊最底层的谜之矿物，蕴含无法估量的能量。", researchCost: 30 },
};

// ================= 制造配方 =================

export const CRAFTING: Record<string, {
  name: string;
  icon: string;
  cost: Array<{ ore: string; quality: string; count: number }>;
  result: { item: string; count: number };
}> = {
  repair_kit: {
    name: "维修套件",
    icon: "🔧",
    cost: [{ ore: "copper", quality: "normal", count: 3 }],
    result: { item: "repair_kit", count: 1 },
  },
  fuel_cell: {
    name: "应急燃料",
    icon: "⛽",
    cost: [
      { ore: "iron", quality: "normal", count: 2 },
      { ore: "copper", quality: "normal", count: 1 },
    ],
    result: { item: "fuel_cell", count: 1 },
  },
  dynamite: {
    name: "震波炸药",
    icon: "💣",
    cost: [
      { ore: "silver", quality: "normal", count: 2 },
      { ore: "gold", quality: "normal", count: 1 },
    ],
    result: { item: "dynamite", count: 1 },
  },
  repair_kit_plus: {
    name: "高级维修套件",
    icon: "🛠️",
    cost: [
      { ore: "gold", quality: "normal", count: 5 },
      { ore: "silver", quality: "fine", count: 2 },
    ],
    result: { item: "repair_kit_plus", count: 1 },
  },
};

// ================= 黑市订单 =================

export type OrderNeed = { ore: string; quality: string; count: number };
export type OrderDef = {
  name: string;
  icon: string;
  desc: string;
  need: OrderNeed[];
  reward: { cash: number; favor?: number };
};

export const ORDERS: Record<string, OrderDef> = {
  copper_wiring: {
    name: "铜线订单",
    icon: "🔌",
    desc: "矿区管委会需要一批铜线用于电网检修。",
    need: [{ ore: "copper", quality: "normal", count: 20 }],
    reward: { cash: 400, favor: 1 },
  },
  rail_repair: {
    name: "轨道修复",
    icon: "🛤️",
    desc: "旧矿井的运输轨道多处断裂，急需铁矿补修。",
    need: [{ ore: "iron", quality: "normal", count: 15 }],
    reward: { cash: 520, favor: 1 },
  },
  silver_sensors: {
    name: "银质传感器",
    icon: "📡",
    desc: "地表实验室定制一批高灵敏度传感器。",
    need: [{ ore: "silver", quality: "fine", count: 6 }],
    reward: { cash: 980, favor: 1 },
  },
  golden_seal: {
    name: "黄金封印",
    icon: "🏵️",
    desc: "神秘客人要求把黄金熔铸成封印纹章。",
    need: [
      { ore: "gold", quality: "normal", count: 5 },
      { ore: "iron", quality: "fine", count: 4 },
    ],
    reward: { cash: 1450, favor: 2 },
  },
  abyssal_resonance: {
    name: "深渊共鸣体",
    icon: "🌀",
    desc: "研究所悬赏深渊晶体样品，用于能量共振实验。",
    need: [
      { ore: "crystal", quality: "fine", count: 3 },
      { ore: "diamond", quality: "normal", count: 2 },
    ],
    reward: { cash: 46000, favor: 2 },
  },
  impossible_specimen: {
    name: "不可能标本",
    icon: "🔬",
    desc: "深渊最深处的不明矿物，博物馆愿意出天价收藏。",
    need: [{ ore: "unknown", quality: "legendary", count: 1 }],
    reward: { cash: 145000, favor: 3 },
  },
};

export const ORDER_IDS = Object.keys(ORDERS);

// v9：每日随机 3 单（同一日期稳定），在仓库交付后结算现金/好感度
function seededRand(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return (h % 10000) / 10000;
  };
}

export function dailyOrders(date: string): string[] {
  const rnd = seededRand("orders_" + date);
  const ids = [...ORDER_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}

export function ensureDailyOrders(saveOrders: { date: string; active: string[]; done: string[] }, today: string): { date: string; active: string[]; done: string[] } {
  if (saveOrders.date === today) return saveOrders;
  return { date: today, active: dailyOrders(today), done: [] };
}


// ================= 区域机制 =================

export const REGION_DEFS: Record<StageId, {
  name: string;
  gimmick: string;
  gimmickDesc: string;
  events: string[];
}> = {
  shallow: {
    name: "浅层矿区",
    gimmick: "新手庇护",
    gimmickDesc: "岩层松软、危险稀少，适合熟悉钻机操作，也是铜铁等基础矿石的主要产地。",
    events: [
      "遇见一队矿工正在交接班，向你点头致意",
      "发现前人留下的木支架，巷道还算结实",
      "岩层里传来轻微的滴水声，环境安静",
      "捡到半包被遗忘的炸药",
      "一位热心老矿工给你指了条近道",
    ],
  },
  oldmine: {
    name: "旧矿井",
    gimmick: "坍塌遗迹",
    gimmickDesc: "废弃矿井结构不稳，容易遇到塌方与遗留设备，银矿与铁矿脉分布密集。",
    events: [
      "头顶传来木材断裂的声响，赶紧加快脚步",
      "废弃的矿车堵住了半条巷道",
      "墙角发现一箱生锈的维修工具",
      "塌方堵住了一段路，只能小心绕行",
      "旧通风管道里透出微弱的亮光",
      "木支架摇摇欲坠，必须压低身子通过",
    ],
  },
  magma: {
    name: "岩浆带",
    gimmick: "高温灼热",
    gimmickDesc: "地热让钻机快速升温，超载钻进的风险显著提高，但金矿脉格外富集。",
    events: [
      "热浪扑面而来，钻机温度明显上升",
      "岩浆在地缝中缓慢流动，映出红光",
      "空气中弥漫着刺鼻的硫磺气味",
      "一块熔岩突然爆裂，碎屑四溅",
      "地热管涌出滚烫蒸汽，看不清前路",
      "高温让探测器屏幕不断闪烁",
    ],
  },
  bio: {
    name: "生物区",
    gimmick: "生物巢穴",
    gimmickDesc: "深渊生物在此筑巢，遭遇怪物的概率大幅上升，钻石矿脉点缀其间。",
    events: [
      "黑暗中传来沙沙的爬行声",
      "岩壁上粘着大片发光的菌丝",
      "一只深渊生物快速掠过视野",
      "地上散落着巨大的不明骨骸",
      "粘液从洞顶缓缓滴落",
      "远处传来低沉的吼叫，回声久久不散",
    ],
  },
  abyss: {
    name: "深渊",
    gimmick: "法则扭曲",
    gimmickDesc: "物理法则在此失效，异常现象频发，收益也最为丰厚，只有最强的钻机能走到这里。",
    events: [
      "重力似乎在这里发生了偏移，脚步变轻",
      "你看到了本不该存在的景象，又转瞬即逝",
      "空间在黑暗中扭曲了一瞬",
      "幽绿色的光从岩缝中渗出",
      "耳边响起无法分辨来源的低语",
      "时间感变得模糊，分不清过了多久",
    ],
  },
};
