// ---------- 存档加载 / 迁移 / 校验 / 持久化（v3） ----------
// 独立于 config.ts，以同时引用 items.ts 的装备定义，避免循环依赖
import {
  SAVE_BACKUP_KEY, SAVE_KEY, defaultSave,
  ORES, baseOreValue,
} from "./config";

// 本地存档最后修改时间戳（用于云存档跨设备合并比较）
export const SAVE_UPDATED_KEY = "abyss_miner_save_updated_at_v4";
export const MUTED_KEY = "abyss_miner_muted";
import type { OreId, SaveData, UpgradeId } from "./config";
import type { ArchetypeId } from "./types";
import {
  EQUIPMENT_DEFS, scaleStats,
} from "./items";
import type { Difficulty, EquipmentInstance } from "./items";

// 迁移专用常量：v2 矿石 record -> v3 堆（一次性锁定 100m 基准价）
const MIGRATE_QUALITY_MULT: Record<string, number> = { poor: 0.6, normal: 1, fine: 1.8, legendary: 4 };

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function sanitizeRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const num = Number(n);
      if (Number.isFinite(num) && num > 0) out[k] = Math.floor(num);
    }
  }
  return out;
}

// 装备实例归一化：v2 存档没有 stats 时，用该 id 的基准属性 × tier 倍率补齐
function normalizeEquipment(e: unknown): EquipmentInstance {
  const raw = (e ?? {}) as Record<string, unknown>;
  const uid = typeof raw.uid === "string" && raw.uid ? (raw.uid as string) : "eq_" + Math.random().toString(36).slice(2, 10);
  const id = typeof raw.id === "string" ? (raw.id as string) : "drill_bit_1";
  const slot = (["drill", "pack", "armor", "detector", "charm"].includes(raw.slot as string) ? raw.slot : "drill") as EquipmentInstance["slot"];
  const tier = (raw.tier === 2 || raw.tier === 3 ? raw.tier : 1) as 1 | 2 | 3;
  let stats: Partial<Record<string, number>> = {};
  if (raw.stats && typeof raw.stats === "object") {
    const s = raw.stats as Record<string, unknown>;
    for (const k of ["qualityBonus", "slotBonus", "wearReduce", "detectorBonus", "accuracyBonus", "pierceBonus", "banditReduce", "valueBonus", "anomalyResist"] as const) {
      const n = Number(s[k]);
      if (Number.isFinite(n) && n !== 0) (stats as Record<string, number>)[k] = Math.round(n);
    }
  } else {
    stats = scaleStats(EQUIPMENT_DEFS[id]?.stats ?? {}, tier);
  }
  return { uid, id, slot, tier, stats };
}

// 把任意输入归一化为合法 SaveData：未知字段合并默认值、数值钳制、异常时返回可恢复存档
export function normalizeSave(raw: unknown): SaveData {
  const base = defaultSave();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const upgrades = { ...base.upgrades };
  if (r.upgrades && typeof r.upgrades === "object") {
    for (const k of Object.keys(base.upgrades) as Array<UpgradeId>) {
      const n = Number((r.upgrades as Record<string, unknown>)[k]);
      if (Number.isFinite(n)) upgrades[k] = Math.max(0, Math.min(12, Math.floor(n)));
    }
  }
  const stats = { ...base.stats };
  if (r.stats && typeof r.stats === "object") {
    for (const k of Object.keys(base.stats) as Array<keyof SaveData["stats"]>) {
      const n = Number((r.stats as Record<string, unknown>)[k]);
      if (Number.isFinite(n)) (stats as Record<string, number>)[k] = Math.max(0, Math.floor(n));
    }
  }
  // 矿石：v3 堆列表 或 v2 的 record（一次性锁定 100m 基准价）
  let stacks: SaveData["warehouseStacks"] = [];
  if (Array.isArray(r.warehouseStacks)) {
    for (const s of r.warehouseStacks as unknown[]) {
      const row = (s ?? {}) as Record<string, unknown>;
      if (typeof row.key !== "string" || !row.key) continue;
      const count = Math.floor(Number(row.count) || 0);
      if (count <= 0) continue;
      stacks.push({ key: row.key, count, unitValue: Math.max(1, Math.round(Number(row.unitValue) || 0)) });
    }
  } else if (r.warehouseOres && typeof r.warehouseOres === "object") {
    for (const [key, countRaw] of Object.entries(r.warehouseOres as Record<string, unknown>)) {
      const idx = key.indexOf(":");
      if (idx <= 0) continue;
      const id = key.slice(0, idx) as OreId;
      const quality = key.slice(idx + 1);
      const qm = MIGRATE_QUALITY_MULT[quality];
      const om = ORES[id]?.mult;
      const count = Math.floor(Number(countRaw) || 0);
      if (!qm || !om || count <= 0) continue;
      stacks.push({ key, count, unitValue: Math.max(1, Math.round(baseOreValue(100) * om * qm)) });
    }
  }
  const equipment = Array.isArray(r.warehouseEquipment) ? (r.warehouseEquipment as unknown[]).map(normalizeEquipment) : [];
  const equipped: SaveData["equipped"] = {};
  if (r.equipped && typeof r.equipped === "object") {
    for (const [slot, uid] of Object.entries(r.equipped as Record<string, unknown>)) {
      if (["drill", "pack", "armor", "detector", "charm"].includes(slot) && typeof uid === "string") {
        equipped[slot as keyof SaveData["equipped"]] = uid;
      }
    }
  }
  const archetypesUnlocked = Array.isArray(r.archetypesUnlocked)
    ? (r.archetypesUnlocked as unknown[]).filter((a) => ["hunter", "overdriver", "scavenger", "survivor"].includes(a as string)) as ArchetypeId[]
    : base.archetypesUnlocked;
  const codexRaw = (r.codex && typeof r.codex === "object" ? r.codex : {}) as Record<string, unknown>;
  return {
    version: 4,
    cash: clampNum(r.cash, 0, 1e12, 0),
    upgrades,
    unlockedCheckpoints: Array.isArray(r.unlockedCheckpoints)
      ? [...new Set((r.unlockedCheckpoints as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
      : [0],
    warehouseStacks: stacks,
    warehouseItems: sanitizeRecord(r.warehouseItems),
    warehouseEquipment: equipment,
    equipped,
    shop: (r.shop && typeof r.shop === "object" ? r.shop : { date: "", stock: [] }) as SaveData["shop"],
    favor: clampNum(r.favor, 0, 5, 0),
    difficultyUnlocked: Array.isArray(r.difficultyUnlocked)
      ? (r.difficultyUnlocked as unknown[]).filter((d) => ["mild", "normal", "hardcore"].includes(d as string)) as Difficulty[]
      : base.difficultyUnlocked,
    archetypesUnlocked,
    codex: {
      minerals: sanitizeRecord(codexRaw.minerals),
      rooms: Array.isArray(codexRaw.rooms) ? (codexRaw.rooms as unknown[]).filter((x) => typeof x === "string") as string[] : [],
      creatures: clampNum(codexRaw.creatures, 0, 1e9, 0),
      anomalies: Array.isArray(codexRaw.anomalies) ? (codexRaw.anomalies as unknown[]).filter((x) => typeof x === "string") as string[] : [],
      modules: Array.isArray(codexRaw.modules) ? (codexRaw.modules as unknown[]).filter((x) => typeof x === "string") as string[] : [],
      research: sanitizeRecord(codexRaw.research),
    },
    daily: (r.daily && typeof r.daily === "object" ? r.daily : { date: "", tasks: {}, claimed: {} }) as SaveData["daily"],
    stats,
    settings: { muted: !!((r.settings ?? {}) as Record<string, unknown>).muted, reduceMotion: !!((r.settings ?? {}) as Record<string, unknown>).reduceMotion },
  };
}

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      // v1 / v2 旧档迁移
      const legacy = window.localStorage.getItem("abyss_miner_save_v2") ?? window.localStorage.getItem("abyss_miner_save_v1");
      if (legacy) {
        const migrated = normalizeSave(JSON.parse(legacy));
        persistSave(migrated);
        return migrated;
      }
      return defaultSave();
    }
    const parsed = JSON.parse(raw);
    window.localStorage.setItem(SAVE_BACKUP_KEY, raw);
    return normalizeSave(parsed);
  } catch {
    // 存档损坏：尝试备份恢复，否则回退默认值（不静默清空玩家数据）
    try {
      const backup = window.localStorage.getItem(SAVE_BACKUP_KEY);
      if (backup) return normalizeSave(JSON.parse(backup));
    } catch {
      /* ignore */
    }
    return defaultSave();
  }
}

export function persistSave(save: SaveData): void {
  if (typeof window === "undefined") return;
  try {
    const json = JSON.stringify(save);
    window.localStorage.setItem(SAVE_KEY, json);
    window.localStorage.setItem(SAVE_BACKUP_KEY, json);
    window.localStorage.setItem(SAVE_UPDATED_KEY, String(Date.now()));
  } catch {
    /* ignore quota errors */
  }
}

// 覆盖本地存档（云同步拉取后使用），并刷新修改时间戳
export function replaceSave(save: SaveData): void {
  if (typeof window === "undefined") return;
  try {
    const json = JSON.stringify(save);
    window.localStorage.setItem(SAVE_KEY, json);
    window.localStorage.setItem(SAVE_BACKUP_KEY, json);
    window.localStorage.setItem(SAVE_UPDATED_KEY, String(Date.now()));
  } catch {
    /* ignore quota errors */
  }
}

// 读取本地存档最后修改时间（毫秒时间戳；无记录返回 0）
export function getLocalSaveUpdatedAt(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(window.localStorage.getItem(SAVE_UPDATED_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}
