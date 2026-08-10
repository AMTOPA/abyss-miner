// ---------- v9：图鉴研究（纯逻辑，UI 与测试共用） ----------
// 消耗仓库矿石提升矿物研究等级，获得永久加成：
//  - 对应矿石价值 +2%/级（引擎 oreUnitValue 读取）
//  - 总研究等级提升探测精度（引擎 currentAccuracy 读取）
//  - 总研究等级提升堆叠上限（引擎 startRun 读取，最高 +40）
import type { SaveData } from "./config";
import { CODEX_MINERALS } from "./content";

export const RESEARCH_MAX_LEVEL = 10;
export const RESEARCH_VALUE_PCT = 2;   // 每级价值加成 %
export const RESEARCH_ACCURACY_MAX = 0.12;  // 探测精度最高 +12%
export const RESEARCH_STACK_MAX = 40;       // 堆叠上限最高 +40

// 升级到下一级所需消耗的同种矿石数量 = 基础成本 × 2.2^当前等级
export function researchCost(key: string, level: number): number {
  const def = CODEX_MINERALS[key];
  if (!def) return 0;
  return Math.max(1, Math.round(def.researchCost * Math.pow(2.2, Math.min(RESEARCH_MAX_LEVEL, Math.max(0, level)))));
}

// 仓库中该矿石键的总持有量（可分散在多堆）
export function warehouseOreCount(save: SaveData, key: string): number {
  let total = 0;
  for (const st of save.warehouseStacks) if (st.key === key) total += st.count;
  return total;
}

export function researchLevel(save: SaveData, key: string): number {
  return Math.min(RESEARCH_MAX_LEVEL, Math.max(0, save.codex.research[key] ?? 0));
}

export function totalResearchLevels(save: SaveData): number {
  let sum = 0;
  for (const v of Object.values(save.codex.research)) sum += Math.min(RESEARCH_MAX_LEVEL, Math.max(0, v));
  return sum;
}

// 可否研究：图鉴已发现 + 等级未满 + 仓库持有足够
export function canResearch(save: SaveData, key: string): boolean {
  const def = CODEX_MINERALS[key];
  if (!def) return false;
  const level = researchLevel(save, key);
  if (level >= RESEARCH_MAX_LEVEL) return false;
  if ((save.codex.minerals[key] ?? 0) <= 0) return false;
  return warehouseOreCount(save, key) >= researchCost(key, level);
}

// 消耗仓库矿石升级，返回新存档；不满足条件时原样返回
export function applyResearch(save: SaveData, key: string): SaveData {
  if (!canResearch(save, key)) return save;
  const level = researchLevel(save, key);
  const cost = researchCost(key, level);
  let need = cost;
  const stacks: SaveData["warehouseStacks"] = [];
  for (const st of save.warehouseStacks) {
    if (st.key !== key || need <= 0) { stacks.push(st); continue; }
    const take = Math.min(st.count, need);
    need -= take;
    if (st.count - take > 0) stacks.push({ ...st, count: st.count - take });
  }
  return {
    ...save,
    warehouseStacks: stacks,
    codex: { ...save.codex, research: { ...save.codex.research, [key]: level + 1 } },
  };
}

// 研究收益文本（图鉴页展示）
export function researchBenefitText(key: string, level: number): string {
  const mult = 100 + level * RESEARCH_VALUE_PCT;
  return `该矿石价值 +${level * RESEARCH_VALUE_PCT}%（当前 ${mult}%）；研究提升全局探测精度与堆叠上限`;
}
