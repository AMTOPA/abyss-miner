// ---------- v11????? ----------
import type { SaveData } from "./config";
import { totalResearchLevels } from "./research";

export type AchievementDef = {
  id: string;
  name: string;
  desc: string;
  icon: string;
  reward: number;                 // ???????????
  target: number;                 // ???????????
  progress: (save: SaveData) => number;  // ????
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_run", name: "初次下矿", desc: "完成任一次正常下矿并回到地面", icon: "??", reward: 100, target: 1, progress: (s) => s.stats.runs },
  { id: "depth_100", name: "浅层下流", desc: "单次到达 100m", icon: "???", reward: 200, target: 100, progress: (s) => s.stats.bestDepth },
  { id: "depth_300", name: "旧矿探索者", desc: "单次到达 300m", icon: "??", reward: 300, target: 300, progress: (s) => s.stats.bestDepth },
  { id: "depth_600", name: "岩浆边缘", desc: "单次到达 600m", icon: "??", reward: 500, target: 600, progress: (s) => s.stats.bestDepth },
  { id: "depth_1000", name: "深渊探先", desc: "单次到达 1000m", icon: "??", reward: 800, target: 1000, progress: (s) => s.stats.bestDepth },
  { id: "income_10k", name: "第一桶金", desc: "累计入库价值 10,000", icon: "??", reward: 300, target: 10000, progress: (s) => s.stats.totalBanked },
  { id: "income_100k", name: "矿业新晗", desc: "累计入库价值 100,000", icon: "??", reward: 800, target: 100000, progress: (s) => s.stats.totalBanked },
  { id: "income_1m", name: "矿业巨头", desc: "累计入库价值 1,000,000", icon: "??", reward: 2000, target: 1000000, progress: (s) => s.stats.totalBanked },
  { id: "runs_10", name: "老马识途", desc: "完成 10 次下矿", icon: "???", reward: 200, target: 10, progress: (s) => s.stats.runs },
  { id: "runs_50", name: "深渊老手", desc: "完成 50 次下矿", icon: "??", reward: 500, target: 50, progress: (s) => s.stats.runs },
  { id: "bm_20", name: "黑市常客", desc: "黑市累计交易 20 次", icon: "??", reward: 300, target: 20, progress: (s) => s.stats.bmTrades },
  { id: "anomaly_5", name: "异常见证者", desc: "遇到 5 次深渊异常", icon: "??", reward: 400, target: 5, progress: (s) => s.stats.anomaliesSeen },
  { id: "overload_10", name: "超载狂魔", desc: "超载钻进累计 10 次", icon: "??", reward: 300, target: 10, progress: (s) => s.stats.overloadDrills },
  { id: "research_10", name: "矿石学家", desc: "图鉴研究总级达到 10 级", icon: "??", reward: 500, target: 10, progress: (s) => totalResearchLevels(s) },
  { id: "checkin_7", name: "持之以恒", desc: "签到累计 7 天", icon: "??", reward: 300, target: 7, progress: (s) => s.checkin.total },
  { id: "gear_10", name: "装备家", desc: "拥有 10 件装备", icon: "??", reward: 400, target: 10, progress: (s) => s.warehouseEquipment.length },
];

// ???????????
export function completedUnclaimed(save: SaveData): AchievementDef[] {
  const claimed = new Set(save.achievements ?? []);
  return ACHIEVEMENTS.filter((a) => !claimed.has(a.id) && a.progress(save) >= a.target);
}

// ??????????? / ?????????
export function claimAchievement(save: SaveData, id: string): SaveData {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return save;
  const claimed = new Set(save.achievements ?? []);
  if (claimed.has(id) || def.progress(save) < def.target) return save;
  return {
    ...save,
    cash: save.cash + def.reward,
    achievements: [...(save.achievements ?? []), id],
  };
}

export function achievementProgress(save: SaveData, def: AchievementDef): number {
  return Math.min(def.target, Math.max(0, def.progress(save)));
}
