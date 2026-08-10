"use client";

import { useState } from "react";
import { ARCHETYPES, ARCHETYPE_ORDER, CHALLENGE_DEFS, CHALLENGE_ORDER } from "@/game/content";
import { CHECKPOINTS, checkpointCost, fmt, persistSave, type SaveData } from "@/game/config";
import { dailyDateUTC } from "@/game/daily";
import type { AuthUser } from "@/lib/api";
import type { ArchetypeId, ChallengeId, DisasterMode, RunConfig } from "@/game/types";
import {
  BUFF_DEFS, BUFF_ORDER, BUFF_RANDOM_PRICE, type BuffId,
  CONSUMABLES,
  DIFFICULTY_DEFS, DIFFICULTY_ORDER, type Difficulty,
  EQUIPMENT_DEFS, EQUIPMENT_SLOT_NAMES, type EquipmentSlot,
  type EquipmentStats, mergeEquipStats,
} from "@/game/items";
import AchievementsPanel from "./AchievementsPanel";
import CodexPanel from "./CodexPanel";
import ForgePanel from "./ForgePanel";
import LoadoutPanel from "./LoadoutPanel";
import ShopPanel from "./ShopPanel";
import WarehousePanel from "./WarehousePanel";
import Tip from "./Tip";

export type LobbyTab = "deploy" | "warehouse" | "shop" | "loadout" | "forge" | "codex" | "leaderboard" | "achievements" | "settings";
export type LobbyProps = {
  save: SaveData;
  user: AuthUser | null;
  muted: boolean;
  volume: number;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onStart: (startDepth: number, config: RunConfig, cost: number) => void;
  onDailyChallenge: () => void; // v11?????
  // v9：断局续玩
  resumeRun: { depth: number; pocket: number } | null;
  onResume: () => void;
  onAbandonResume: () => void;
  onUpgrades: () => void;
  onLeaderboard: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onSave: (next: SaveData) => void;
};

type SeedMode = "random" | "daily" | "abyss";
type ChallengeDef = { id: ChallengeId; name: string; desc: string; icon: string };

const TABS: Array<{ id: LobbyTab; name: string; icon: string }> = [
  { id: "deploy", name: "出矿", icon: "⛏️" },
  { id: "warehouse", name: "仓库", icon: "🏦" },
  { id: "shop", name: "商店", icon: "🛒" },
  { id: "loadout", name: "装备", icon: "🎒" },
  { id: "forge", name: "锻造", icon: "🔨" },
  { id: "codex", name: "图鉴", icon: "📖" },
  { id: "leaderboard", name: "排行榜", icon: "🏆" },
  { id: "achievements", name: "成就", icon: "??" },
  { id: "settings", name: "设置", icon: "⚙️" },
];
const EQUIP_SLOTS: EquipmentSlot[] = ["drill", "pack", "armor", "detector", "charm"];
// v7：词缀名称/描述以 content.ts 正式定义为单一数据源，避免规则漂移
const CHALLENGES: ChallengeDef[] = CHALLENGE_ORDER.map((id) => {
  const def = CHALLENGE_DEFS[id];
  return { id, name: def.name, desc: def.desc, icon: def.icon };
});

function statLines(stats: EquipmentStats): string[] {
  const out: string[] = [];
  if (stats.qualityBonus) out.push(`高品质 +${stats.qualityBonus}%`);
  if (stats.slotBonus) out.push(`背包格 +${stats.slotBonus}`);
  if (stats.wearReduce) out.push(`损耗 -${stats.wearReduce}%`);
  if (stats.detectorBonus) out.push(`探测器 +${stats.detectorBonus}`);
  if (stats.accuracyBonus) out.push(`精度 +${stats.accuracyBonus}%`);
  if (stats.pierceBonus) out.push(`穿透 +${stats.pierceBonus}%`);
  if (stats.banditReduce) out.push(`强盗损失 -${stats.banditReduce}%`);
  if (stats.valueBonus) out.push(`价值 +${stats.valueBonus}%`);
  if (stats.anomalyResist) out.push(`异常抗性 +${stats.anomalyResist}%`);
  return out;
}

// 流派解锁严格读取统计数据，避免依赖并行开发中的迁移字段。
function isArchetypeUnlocked(id: ArchetypeId, save: SaveData): boolean {
  if (id === "hunter") return save.stats.bestDepth >= 200;
  if (id === "overdriver") return save.stats.overloadDrills >= 3;
  if (id === "scavenger") return save.stats.bmTrades >= 10;
  return save.stats.anomaliesSeen >= 3;
}

function defaultArchetype(save: SaveData): ArchetypeId | null {
  return ARCHETYPE_ORDER.find((id) => isArchetypeUnlocked(id, save)) ?? null;
}

// 流派解锁进度文案（用于锁定卡片提示）
function archetypeProgress(id: ArchetypeId, save: SaveData): string {
  const s = save.stats;
  switch (id) {
    case "hunter": return "当前最深 " + s.bestDepth + "/200m";
    case "overdriver": return "当前超载 " + s.overloadDrills + "/3 次";
    case "scavenger": return "当前黑市交易 " + s.bmTrades + "/10 次";
    case "survivor": return "当前异常遭遇 " + s.anomaliesSeen + "/3 次";
    default: return "";
  }
}

function randomSeed(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function localDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeSeed(mode: SeedMode): string {
  if (mode === "daily") return `daily_${localDateKey()}`;
  if (mode === "abyss") return "fixed_abyss";
  return randomSeed();
}

export default function LobbyScreen(props: LobbyProps) {
  const { save, user, muted, onSave } = props;
  const [tab, setTab] = useState<LobbyTab>("deploy");
  // v10??????????????????????
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const yestStr = (() => {
    const d = new Date(Date.now() - 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const claimedToday = save.checkin.date === todayStr;
  const nextStreak = save.checkin.date === yestStr ? save.checkin.streak + 1 : 1;
  const checkinReward = Math.min(500, 50 + (nextStreak - 1) * 25);
  const doCheckin = () => {
    const next: SaveData = {
      ...save,
      cash: save.cash + checkinReward,
      checkin: { date: todayStr, streak: nextStreak, total: save.checkin.total + 1 },
    };
    persistSave(next);
    onSave(next);
  };
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [depth, setDepth] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [pocket, setPocket] = useState(0);
  const [buffs, setBuffs] = useState<BuffId[]>([]);
  const [drawFlags, setDrawFlags] = useState<Record<string, boolean>>({});
  const [carried, setCarried] = useState<string[]>([]);
  const [archetype, setArchetype] = useState<ArchetypeId | null>(() => defaultArchetype(save));
  const [challenge, setChallenge] = useState<ChallengeId[]>([]);
  const [seedMode, setSeedMode] = useState<SeedMode>("random");
  const [disasterMode, setDisasterMode] = useState<DisasterMode>("gauge");

  const maxPocket = Math.min(5000, Math.max(0, save.cash));
  const pocketShown = Math.max(0, Math.min(pocket, maxPocket));
  const hardcoreUnlocked = save.stats.bestDepth >= 300;
  const cpCost = depth === 0 ? 0 : checkpointCost(depth);
  const buffCost = buffs.reduce((sum, id) => sum + (drawFlags[id] ? BUFF_RANDOM_PRICE : BUFF_DEFS[id].price), 0);
  const totalCost = cpCost + buffCost;
  const canAfford = save.cash >= totalCost + pocketShown;
  const pocketCan = maxPocket > 0;
  const equippedList = save.warehouseEquipment.filter((item) => save.equipped[item.slot] === item.uid);
  // v7：摘要读取装备实例实际属性（tier 缩放后），不再读取定义基准值
  const equipStats = mergeEquipStats(...equippedList.map((item) => item.stats));
  const equipLines = statLines(equipStats);
  const recommendedArchetype = defaultArchetype(save);

  const setPocketClamped = (value: number) => setPocket(Math.max(0, Math.min(maxPocket, Math.round(value / 50) * 50)));
  const pocketStep = (delta: number) => setPocketClamped(pocketShown + delta);

  const toggleBuff = (id: BuffId) => {
    setBuffs((current) => {
      if (!current.includes(id)) return [...current, id];
      setDrawFlags((flags) => ({ ...flags, [id]: false }));
      return current.filter((buff) => buff !== id);
    });
  };
  const drawBuff = () => {
    setBuffs((current) => {
      const pool = BUFF_ORDER.filter((id) => !current.includes(id));
      if (pool.length === 0) return current;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setDrawFlags((flags) => ({ ...flags, [pick]: true }));
      return [...current, pick];
    });
  };
  const toggleCarried = (id: string) => {
    setCarried((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current);
  };
  const toggleChallenge = (id: ChallengeId) => {
    setChallenge((current) => {
      const enabled = current.includes(id);
      if (id === "abyssal_seed" && !enabled) setSeedMode("abyss");
      return enabled ? current.filter((item) => item !== id) : [...current, id];
    });
  };

  // 所有出发路径共用同一资产扣除流程，避免快速出发与高级配置行为漂移。
  const launch = (startDepth: number, config: RunConfig, cost: number, items: string[]) => {
    const requiredCash = cost + config.pocket;
    if (save.cash < requiredCash) return;
    const warehouseItems = { ...save.warehouseItems };
    const validItems = items.filter((id) => (warehouseItems[id] ?? 0) > 0);
    for (const id of validItems) {
      const count = warehouseItems[id] ?? 0;
      if (count > 1) warehouseItems[id] = count - 1;
      else delete warehouseItems[id];
    }
    const next: SaveData = { ...save, cash: save.cash - requiredCash, warehouseItems };
    persistSave(next);
    onSave(next);
    props.onStart(startDepth, { ...config, items: validItems }, cost);
  };

  const quickStart = () => {
    const quickPocket = 0; // v6：默认不自动携带现金
    launch(0, {
      difficulty: "normal",
      pocket: quickPocket,
      buffs: [],
      equipment: equippedList,
      items: [],
      archetype: recommendedArchetype,
      seed: randomSeed(),
      challenge: [],
      disasterMode: "gauge",
    }, 0, []);
  };

  const deploy = () => {
    if (!canAfford) return;
    launch(depth, {
      difficulty,
      pocket: pocketShown,
      buffs,
      // v7：挑战「轻装出发」最多携带 2 件装备
      equipment: challenge.includes("limited_gear") ? equippedList.slice(0, 2) : equippedList,
      items: carried,
      archetype,
      seed: makeSeed(seedMode),
      challenge,
      disasterMode,
    }, totalCost, carried);
  };

  const renderDeploy = () => (
    <div className="deploy-page-v4">
      <div className="daily-challenge-card">
        <div className="daily-challenge-copy">
          <span className="daily-challenge-kicker">?? 每日挑战</span>
          <strong>当日固定种子 · 普通难度 · 无装备/道具/流派 · 初始现金 0</strong>
          <span>今日种子?{dailyDateUTC()}</span>
          <span className="daily-challenge-hint">成绩进入每日榜（UTC 日期）??????????</span>
        </div>
        <button type="button" className="btn btn-primary btn-big daily-challenge-btn" onClick={props.onDailyChallenge}>? 开始挑战</button>
      </div>
      <div className="quickstart-bar">
        <div className="quickstart-copy">
          <span className="quickstart-kicker">推荐配置</span>
          <strong>普通难度 · 地面出发 · 携带 0 现金</strong>
          <span>无增益 / 无道具 · 当前装备 · {recommendedArchetype ? `${ARCHETYPES[recommendedArchetype].icon} ${ARCHETYPES[recommendedArchetype].name}` : "自由矿工"}</span>
        </div>
        <button type="button" className="btn btn-primary btn-big quickstart-button" onClick={quickStart}>⚡ 快速出发</button>
        <button type="button" className="btn btn-secondary advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? "收起高级配置" : "高级配置"} {advancedOpen ? "▴" : "▾"}</button>
      </div>

      {advancedOpen && <div className="advanced-config">
        <section className="deploy-section archetype-section">
          <h3 className="deploy-section-title"><span className="sec-num">1</span> 流派选择</h3>
          <button type="button" className={`archetype-card archetype-none ${archetype === null ? "on" : ""}`} onClick={() => setArchetype(null)}><span className="archetype-icon">⛏️</span><span className="archetype-name">自由矿工</span><span className="archetype-desc">不携带流派特性，使用经典规则。</span></button>
          <div className="archetype-grid">{ARCHETYPE_ORDER.map((id) => {
            const def = ARCHETYPES[id];
            const unlocked = isArchetypeUnlocked(id, save);
            return <button key={id} type="button" className={`archetype-card ${archetype === id ? "on" : ""} ${!unlocked ? "locked" : ""}`} disabled={!unlocked} style={{ borderColor: unlocked && archetype === id ? def.color : undefined }} onClick={() => setArchetype(id)}><span className="archetype-icon">{def.icon}</span><span className="archetype-name" style={{ color: unlocked ? def.color : undefined }}>{def.name}</span><span className="archetype-desc">{def.desc}</span><span className="archetype-perks">{unlocked ? def.perkDesc.map((perk) => <small key={perk}>· {perk}</small>) : <small className="archetype-unlock-hint">🔒 {def.unlockHint}（{archetypeProgress(id, save)}）</small>}</span></button>;
          })}</div>
        </section>

        <section className="deploy-section challenge-section">
          <h3 className="deploy-section-title"><span className="sec-num">2</span> 挑战词缀</h3>
          <div className="challenge-list">{CHALLENGES.map((item) => <button key={item.id} type="button" className={`challenge-chip ${challenge.includes(item.id) ? "on" : ""}`} aria-pressed={challenge.includes(item.id)} onClick={() => toggleChallenge(item.id)}><span className="challenge-icon">{item.icon}</span><span className="challenge-copy"><strong>{item.name}</strong><small>{item.desc}</small></span></button>)}</div>
          <p className="modal-hint">可多选。挑战会显著改变局内资源与节点规则。</p>
        </section>

        <section className="deploy-section seed-section">
          <h3 className="deploy-section-title"><span className="sec-num">3</span> 地图种子</h3>
          <div className="seed-mode-list">
            <button type="button" className={`seed-mode ${seedMode === "random" ? "on" : ""}`} onClick={() => setSeedMode("random")}>🎲 随机 UUID</button>
            <button type="button" className={`seed-mode ${seedMode === "daily" ? "on" : ""}`} onClick={() => setSeedMode("daily")}>📅 daily_{localDateKey()}</button>
            <button type="button" className={`seed-mode ${seedMode === "abyss" ? "on" : ""}`} onClick={() => setSeedMode("abyss")}>🌀 fixed_abyss</button>
          </div>
        </section>

        <div className="deploy-grid">
          <div className="deploy-col">
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">4</span> 出发检查点</h3>
              <div className="checkpoint-grid">{CHECKPOINTS.map((checkpoint) => {
                const unlocked = save.unlockedCheckpoints.includes(checkpoint);
                const cost = checkpoint === 0 ? 0 : checkpointCost(checkpoint);
                return <button key={checkpoint} type="button" className={`checkpoint-item ${depth === checkpoint ? "cp-selected" : ""} ${!unlocked ? "cp-locked" : ""}`} disabled={!unlocked} onClick={() => setDepth(checkpoint)}><span className="cp-name">{checkpoint === 0 ? "地面 0m" : `${checkpoint}m 检查点`}</span><span className="cp-cost">{unlocked ? cost === 0 ? "免费" : `${fmt(cost)} 💰` : "未解锁"}</span></button>;
              })}</div>
            </section>
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">5</span> 难度选择</h3>
              <div className="diff-grid">{DIFFICULTY_ORDER.map((id) => {
                const def = DIFFICULTY_DEFS[id];
                const locked = id === "hardcore" && !hardcoreUnlocked;
                return <button key={id} type="button" className={`diff-card ${difficulty === id ? "on" : ""} ${id}`} disabled={locked} onClick={() => setDifficulty(id)}><span className="diff-icon">{def.icon}</span><span className="diff-name">{def.name}</span><span className="diff-desc">{locked ? "未解锁 · 需最深 300m" : def.desc}</span><span className="diff-reward">收益 ×{def.incomeMult}</span></button>;
              })}</div>
            </section>
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">5.5</span> 灾难模式</h3>
              <div className="diff-grid">
                <button type="button" className={`diff-card ${disasterMode === "gauge" ? "on" : ""} gauge`} onClick={() => setDisasterMode("gauge")}><span className="diff-icon">🌡️</span><span className="diff-name">累计值</span><span className="diff-desc">默认 · 岩压随深度累积，满 100 触发灾难；可用「岩压稳定剂」等压条</span><span className="diff-reward">可控</span></button>
                <button type="button" className={`diff-card ${disasterMode === "random" ? "on" : ""} random`} onClick={() => setDisasterMode("random")}><span className="diff-icon">🎲</span><span className="diff-name">随机概率</span><span className="diff-desc">旧模式 · 每层按风险随机判定灾难，无法预判</span><span className="diff-reward">随机</span></button>
              </div>
            </section>
          </div>

          <div className="deploy-col">
            <section className="deploy-section pocket-card">
              <h3 className="deploy-section-title"><span className="sec-num">6</span> 随身现金</h3>
              <div className="pocket-display"><span className="pocket-display-label">本次携带</span><span className="pocket-display-value">💰 {fmt(pocketShown)}</span></div>
              <input type="range" className="pocket-slider" min={0} max={Math.max(1, maxPocket)} step={50} value={pocketShown} disabled={!pocketCan} onChange={(event) => setPocketClamped(Number(event.target.value))} />
              <div className="pocket-actions"><button type="button" className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(-500)}>−500</button><button type="button" className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(-100)}>−100</button><input type="number" className="pocket-num" min={0} max={maxPocket} step={50} value={pocketShown} disabled={!pocketCan} onChange={(event) => setPocketClamped(Number(event.target.value))} /><button type="button" className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(100)}>+100</button><button type="button" className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(500)}>+500</button><button type="button" className="pocket-step pocket-max" disabled={!pocketCan} onClick={() => setPocket(maxPocket)}>全部 {fmt(maxPocket)}</button></div>
              <div className="pocket-quick">{[500, 1000, 2000, 5000].filter((amount) => amount <= maxPocket).map((amount) => <button key={amount} type="button" className="pocket-quick-btn" disabled={!pocketCan} onClick={() => setPocket(amount)}>{fmt(amount)}</button>)}{!pocketCan && <span className="modal-hint">仓库现金为 0，先去卖矿或做任务赚点钱吧。</span>}</div>
              <p className="modal-hint">黑市交易 / 维修 / 强盗勒索使用，剩余自动带回仓库。上限 {fmt(maxPocket)}。</p>
            </section>
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">7</span> 一次性增益（仅本局）</h3>
              <div className="buff-grid">{BUFF_ORDER.map((id) => { const def = BUFF_DEFS[id]; const on = buffs.includes(id); return <button key={id} type="button" className={`buff-card ${on ? "on" : ""}`} onClick={() => toggleBuff(id)}><span className="buff-icon">{def.icon}</span><span className="buff-name">{def.name}</span><span className="buff-price">{drawFlags[id] ? "随机获得" : `${fmt(def.price)} 💰`}</span><span className="buff-desc">{def.desc}</span></button>; })}</div>
              <div className="deploy-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={buffs.length >= BUFF_ORDER.length} onClick={drawBuff}>随机抽取 {fmt(BUFF_RANDOM_PRICE)} 💰</button><span className="deploy-cost">增益小计：{fmt(buffCost)} 💰</span></div>
            </section>
          </div>

          <div className="deploy-col">
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">8</span> 携带道具（最多 4 件）</h3>
              {Object.keys(save.warehouseItems).length === 0 ? <p className="modal-hint">仓库暂无消耗品，可在商店购买或下矿获取。</p> : <div className="carry-grid">{Object.entries(save.warehouseItems).map(([id, count]) => { const def = CONSUMABLES[id]; if (!def || count <= 0) return null; const on = carried.includes(id); return <Tip key={id} label={<><strong>{def.name}</strong><span className="tip-sub">{def.desc}</span></>}><button type="button" className={`carry-chip ${on ? "on" : ""}`} disabled={!on && carried.length >= 4} onClick={() => toggleCarried(id)}><span>{def.icon} {def.name} ×{count}</span><span>{on ? "已携带 ✓" : "点击携带"}</span></button></Tip>; })}</div>}
            </section>
            <section className="deploy-section">
              <h3 className="deploy-section-title"><span className="sec-num">9</span> 出战装备</h3>
              <div className="loadout-summary">{EQUIP_SLOTS.map((slot) => { const uid = save.equipped[slot]; const instance = uid ? save.warehouseEquipment.find((item) => item.uid === uid) : null; const def = instance ? EQUIPMENT_DEFS[instance.id] : null; return <div key={slot} className="equip-slot-row"><span className="slot-label">{EQUIPMENT_SLOT_NAMES[slot]}</span><span>{def ? `${def.icon} ${def.name}` : "—"}</span></div>; })}</div>
              {equipLines.length > 0 && <p className="modal-hint">加成：{equipLines.join(" · ")}</p>}
            </section>
            <section className="deploy-section summary-card">
              <h3 className="deploy-section-title"><span className="sec-num">10</span> 出发确认</h3>
              <div className="summary-grid"><div className="stat-card"><span className="stat-label">总花费</span><span className="stat-value gold">{fmt(totalCost)}</span></div><div className="stat-card"><span className="stat-label">携带现金</span><span className="stat-value">{fmt(pocketShown)}</span></div><div className="stat-card"><span className="stat-label">收益倍率</span><span className="stat-value cyan">×{DIFFICULTY_DEFS[difficulty].incomeMult}</span></div><div className="stat-card"><span className="stat-label">挑战词缀</span><span className="stat-value">{challenge.length || "无"}</span></div></div>
              <button type="button" className="btn btn-big btn-primary" disabled={!canAfford} onClick={deploy}>出发！{totalCost > 0 ? `（${fmt(totalCost)} 💰）` : "（免费）"}</button>
              {!canAfford && <p className="modal-hint">现金不足：配置与随身现金合计需要 {fmt(totalCost + pocketShown)}，当前 {fmt(save.cash)}</p>}
            </section>
          </div>
        </div>
      </div>}
    </div>
  );

  const renderLeaderboard = () => <div className="deploy-layout"><section className="deploy-section deploy-actions"><h3 className="deploy-section-title">深渊排行榜</h3><p className="modal-hint">按「单次下矿最高入库价值」排名，登录后成绩自动上榜。</p><button type="button" className="btn btn-big btn-primary" onClick={props.onLeaderboard}>🏆 打开排行榜</button></section></div>;
const renderSettings = () => (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">声音</h3>
        <div className="settings-row">
          <button type="button" className="btn btn-secondary" onClick={props.onToggleMute}>{muted ? "🔇 开启音效" : "🔊 静音"}</button>
        </div>
        <div className="settings-row">
          <span className="settings-label">主音量</span>
          <input className="settings-range" type="range" min={0} max={100} value={Math.round(props.volume * 100)} onChange={(e) => props.onVolume(Number(e.target.value) / 100)} />
          <span className="settings-value">{Math.round(props.volume * 100)}%</span>
        </div>
      </section>
      <section className="deploy-section">
        <h3 className="deploy-section-title">显示</h3>
        <div className="settings-row">
          <span className="settings-label">减少动态</span>
          <button type="button" className={save.settings.reduceMotion ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => props.onSave({ ...save, settings: { ...save.settings, reduceMotion: !save.settings.reduceMotion } })}>{save.settings.reduceMotion ? "已开启" : "已关闭"}</button>
          <span className="settings-hint">降低震屏、闪光与粒子密度</span>
        <div className="settings-row">
          <span className="settings-label">震屏</span>
          <button type="button" className={save.settings.shakeEnabled ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => props.onSave({ ...save, settings: { ...save.settings, shakeEnabled: !save.settings.shakeEnabled } })}>{save.settings.shakeEnabled ? "已开启" : "已关闭"}</button>
          <span className="settings-hint">钻机震动与爆炸震屏</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">文本大小</span>
          {[1, 1.1, 1.25].map((s) => (
            <button key={s} type="button" className={save.settings.textScale === s ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => props.onSave({ ...save, settings: { ...save.settings, textScale: s } })}>{s === 1 ? "标准" : s === 1.1 ? "大" : "特大"}</button>
          ))}
          <span className="settings-hint">缩放大厅界面文字与卡片</span>
        </div>
        </div>
      </section>
      <section className="deploy-section">
        <h3 className="deploy-section-title">账号</h3>
        {user ? <div className="user-chip"><span className="user-name">{user.username}</span><button type="button" className="btn btn-danger btn-sm" onClick={props.onLogout}>退出登录</button></div> : <div className="user-chip"><button type="button" className="btn btn-primary btn-sm" onClick={props.onLogin}>登录</button><button type="button" className="btn btn-secondary btn-sm" onClick={props.onRegister}>注册</button></div>}
      </section>
      <section className="deploy-section">
        <h3 className="deploy-section-title">成长</h3>
        <button type="button" className="btn btn-secondary" onClick={props.onUpgrades}>🔧 升级车间</button>
      </section>
    </div>
  );

  return (
    <div className="lobby-screen" style={{ zoom: save.settings.textScale }}>
      <div className="lobby-bg" />
      <header className="lobby-header"><div className="lobby-brand"><span className="brand-ore">💎</span><span>深渊矿工</span></div><div className="lobby-top-right"><div className="lobby-cash">💰 {fmt(save.cash)}</div>{user ? <div className="user-chip"><span className="user-name">{user.username}</span><button type="button" className="btn btn-ghost btn-sm" onClick={props.onLogout}>退出</button></div> : <div className="user-chip"><button type="button" className="btn btn-ghost btn-sm" onClick={props.onLogin}>登录</button><button type="button" className="btn btn-primary btn-sm" onClick={props.onRegister}>注册</button></div>}<button type="button" className="btn btn-ghost btn-sm" onClick={props.onToggleMute} title={muted ? "开启音效" : "静音"}>{muted ? "🔇" : "🔊"}</button></div></header>
      {props.resumeRun && (
        <div className="resume-banner">
          <span className="resume-banner-icon">🔄</span>
          <span className="resume-banner-text">检测到未完成的远征（深度 <strong>{props.resumeRun.depth}m</strong> · 随身现金 {fmt(props.resumeRun.pocket)}）。断局续玩可保留当前进度，但该局成绩不上排行榜。</span>
          <span className="resume-banner-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={props.onResume}>继续远征</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onAbandonResume}>放弃</button>
          </span>
        </div>
      )}
      <div className="checkin-strip">
        <span className="checkin-info">?? 连续签到 <strong>{save.checkin.streak}</strong> 天 · 累计 {save.checkin.total} 天</span>
        {claimedToday ? (
          <span className="checkin-done">? 今日已签到</span>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={doCheckin}>签到领 {fmt(checkinReward)} ??</button>
        )}
      </div>
      <nav className="lobby-tabs">{TABS.map((item) => <button key={item.id} type="button" className={`lobby-tab ${tab === item.id ? "on" : ""}`} onClick={() => setTab(item.id)}>{item.icon} {item.name}</button>)}</nav>
      <div className="lobby-panel">
        {tab === "deploy" && renderDeploy()}
        {tab === "warehouse" && <WarehousePanel save={save} onSave={onSave} onGoLoadout={() => setTab("loadout")} />}
        {tab === "shop" && <ShopPanel save={save} onSave={onSave} />}
        {tab === "loadout" && <LoadoutPanel save={save} onSave={onSave} />}
        {tab === "forge" && <ForgePanel save={save} onSave={onSave} />}
        {tab === "codex" && <CodexPanel save={save} onSave={onSave} />}
        {tab === "leaderboard" && renderLeaderboard()}
        {tab === "achievements" && <AchievementsPanel save={save} onSave={onSave} />}
        {tab === "settings" && renderSettings()}
      </div>
    </div>
  );
}
