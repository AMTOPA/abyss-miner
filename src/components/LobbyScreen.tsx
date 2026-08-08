"use client";

import { useState } from "react";
import { SaveData, CHECKPOINTS, checkpointCost, fmt, persistSave } from "@/game/config";
import { AuthUser } from "@/lib/api";
import type { RunConfig } from "@/game/types";
import {
  BUFF_DEFS, BUFF_ORDER, BUFF_RANDOM_PRICE, BuffId,
  CONSUMABLES,
  DIFFICULTY_DEFS, DIFFICULTY_ORDER, Difficulty,
  EQUIPMENT_DEFS, EQUIPMENT_SLOT_NAMES, EquipmentSlot,
  EquipmentStats, mergeEquipStats,
} from "@/game/items";
import WarehousePanel from "./WarehousePanel";
import ShopPanel from "./ShopPanel";
import LoadoutPanel from "./LoadoutPanel";

export type LobbyTab = "deploy" | "warehouse" | "shop" | "loadout" | "leaderboard" | "settings";

export type LobbyProps = {
  save: SaveData;
  user: AuthUser | null;
  muted: boolean;
  onToggleMute: () => void;
  onStart: (startDepth: number, config: RunConfig, cost: number) => void;
  onUpgrades: () => void;
  onLeaderboard: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  onSave: (next: SaveData) => void;
};

const TABS: Array<{ id: LobbyTab; name: string; icon: string }> = [
  { id: "deploy", name: "出矿", icon: "⛏️" },
  { id: "warehouse", name: "仓库", icon: "🏦" },
  { id: "shop", name: "商店", icon: "🛒" },
  { id: "loadout", name: "装备", icon: "🎒" },
  { id: "leaderboard", name: "排行榜", icon: "🏆" },
  { id: "settings", name: "设置", icon: "⚙️" },
];

const EQUIP_SLOTS: EquipmentSlot[] = ["drill", "pack", "armor", "detector", "charm"];

// 装备加成 -> 文案列表
function statLines(s: EquipmentStats): string[] {
  const out: string[] = [];
  if (s.qualityBonus) out.push("高品质 +" + s.qualityBonus + "%");
  if (s.slotBonus) out.push("背包格 +" + s.slotBonus);
  if (s.wearReduce) out.push("损耗 -" + s.wearReduce + "%");
  if (s.detectorBonus) out.push("探测器 +" + s.detectorBonus);
  if (s.accuracyBonus) out.push("精度 +" + s.accuracyBonus + "%");
  if (s.pierceBonus) out.push("穿透 +" + s.pierceBonus + "%");
  if (s.banditReduce) out.push("强盗损失 -" + s.banditReduce + "%");
  if (s.valueBonus) out.push("价值 +" + s.valueBonus + "%");
  if (s.anomalyResist) out.push("异常抗性 +" + s.anomalyResist + "%");
  return out;
}

export default function LobbyScreen(props: LobbyProps) {
  const { save, user, muted, onSave } = props;
  const [tab, setTab] = useState<LobbyTab>("deploy");
  const [depth, setDepth] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  // 默认携带 1000（不超过仓库现金，且为 50 的整数倍）
  const [pocket, setPocket] = useState(() => Math.min(1000, Math.floor(Math.max(0, save.cash) / 50) * 50));
  const [buffs, setBuffs] = useState<BuffId[]>([]);
  // 记录哪些增益来自「随机抽取」：其花费为 BUFF_RANDOM_PRICE 而非自身标价
  const [drawFlags, setDrawFlags] = useState<Record<string, boolean>>({});
  const [carried, setCarried] = useState<string[]>([]);

  const maxPocket = Math.min(5000, Math.max(0, save.cash));
  const pocketShown = Math.max(0, Math.min(pocket, maxPocket));
  const hardcoreUnlocked = save.stats.bestDepth >= 300;

  // 花费：检查点 + 一次性增益（出发时才从仓库现金扣除）
  const cpCost = depth === 0 ? 0 : checkpointCost(depth);
  const buffCost = buffs.reduce((s, b) => s + (drawFlags[b] ? BUFF_RANDOM_PRICE : BUFF_DEFS[b].price), 0);
  const totalCost = cpCost + buffCost;
  const canAfford = save.cash >= totalCost;
  const pocketCan = maxPocket > 0;

  // 已装备实例（出战装备）
  const equippedList = save.warehouseEquipment.filter((e) => save.equipped[e.slot] === e.uid);
  const equipStats = mergeEquipStats(...equippedList.map((e) => EQUIPMENT_DEFS[e.id].stats));
  const equipLines = statLines(equipStats);

  const setPocketClamped = (v: number) => {
    const clamped = Math.max(0, Math.min(maxPocket, Math.round(v / 50) * 50));
    setPocket(clamped);
  };
  const pocketStep = (d: number) => setPocketClamped(pocketShown + d);

  const toggleBuff = (id: BuffId) => {
    setBuffs((prev) => {
      if (prev.includes(id)) {
        // 取消选择：清除随机抽取标记，恢复按自身标价计费
        setDrawFlags((f) => ({ ...f, [id]: false }));
        return prev.filter((b) => b !== id);
      }
      return [...prev, id];
    });
  };

  // 随机抽取一个尚未选择的增益
  const drawBuff = () => {
    setBuffs((prev) => {
      const pool = BUFF_ORDER.filter((b) => !prev.includes(b));
      if (pool.length === 0) return prev;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setDrawFlags((f) => ({ ...f, [pick]: true }));
      return [...prev, pick];
    });
  };

  // 携带道具：最多 4 件，重复点击取消
  const toggleCarried = (id: string) => {
    setCarried((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  // 出发：扣除检查点 + 增益费用（持久化现金），携带道具从仓库扣除；增益本身不入存档
  const deploy = () => {
    if (!canAfford) return;
    const warehouseItems = { ...save.warehouseItems };
    for (const id of carried) {
      const cur = warehouseItems[id] ?? 0;
      if (cur > 1) warehouseItems[id] = cur - 1;
      else delete warehouseItems[id];
    }
    const next: SaveData = { ...save, cash: save.cash - totalCost, warehouseItems };
    persistSave(next);
    onSave(next);
    props.onStart(
      depth,
      { difficulty, pocket: pocketShown, buffs, equipment: equippedList, items: carried },
      totalCost
    );
  };

  // ---------- 出矿页 ----------
  const renderDeploy = () => (
    <div className="deploy-grid">
      {/* 左列：路线 + 难度 */}
      <div className="deploy-col">
        <section className="deploy-section">
          <h3 className="deploy-section-title"><span className="sec-num">1</span> 出发检查点</h3>
          <div className="checkpoint-grid">
            {CHECKPOINTS.map((cp) => {
              const unlocked = save.unlockedCheckpoints.includes(cp);
              const cost = cp === 0 ? 0 : checkpointCost(cp);
              return (
                <button
                  key={cp}
                  className={`checkpoint-item ${depth === cp ? "cp-selected" : ""} ${!unlocked ? "cp-locked" : ""}`}
                  disabled={!unlocked}
                  onClick={() => setDepth(cp)}
                >
                  <span className="cp-name">{cp === 0 ? "地面 0m" : cp + "m 检查点"}</span>
                  <span className="cp-cost">{unlocked ? (cost === 0 ? "免费" : fmt(cost) + " 💰") : "未解锁"}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="deploy-section">
          <h3 className="deploy-section-title"><span className="sec-num">2</span> 难度选择</h3>
          <div className="diff-grid">
            {DIFFICULTY_ORDER.map((d) => {
              const def = DIFFICULTY_DEFS[d];
              const locked = d === "hardcore" && !hardcoreUnlocked;
              return (
                <button
                  key={d}
                  className={`diff-card ${difficulty === d ? "on" : ""} ${d}`}
                  disabled={locked}
                  onClick={() => setDifficulty(d)}
                >
                  <span className="diff-icon">{def.icon}</span>
                  <span className="diff-name">{def.name}</span>
                  <span className="diff-desc">{locked ? "未解锁 · 需最深 300m" : def.desc}</span>
                  <span className="diff-reward">收益 ×{def.incomeMult}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* 中列：随身现金 + 增益 */}
      <div className="deploy-col">
        <section className="deploy-section pocket-card">
          <h3 className="deploy-section-title"><span className="sec-num">3</span> 随身现金</h3>
          <div className="pocket-display">
            <span className="pocket-display-label">本次携带</span>
            <span className="pocket-display-value">💰 {fmt(pocketShown)}</span>
          </div>
          <input
            type="range"
            className="pocket-slider"
            min={0}
            max={Math.max(1, maxPocket)}
            step={50}
            value={pocketShown}
            disabled={!pocketCan}
            onChange={(e) => setPocketClamped(Number(e.target.value))}
          />
          <div className="pocket-actions">
            <button className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(-500)}>−500</button>
            <button className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(-100)}>−100</button>
            <input
              type="number"
              className="pocket-num"
              min={0}
              max={maxPocket}
              step={50}
              value={pocketShown}
              disabled={!pocketCan}
              onChange={(e) => setPocketClamped(Number(e.target.value))}
            />
            <button className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(100)}>+100</button>
            <button className="pocket-step" disabled={!pocketCan} onClick={() => pocketStep(500)}>+500</button>
            <button className="pocket-step pocket-max" disabled={!pocketCan} onClick={() => setPocket(maxPocket)}>
              全部 {fmt(maxPocket)}
            </button>
          </div>
          <div className="pocket-quick">
            {[500, 1000, 2000, 5000]
              .filter((q) => q <= maxPocket)
              .map((q) => (
                <button key={q} className="pocket-quick-btn" disabled={!pocketCan} onClick={() => setPocket(q)}>
                  {fmt(q)}
                </button>
              ))}
            {!pocketCan && <span className="modal-hint">仓库现金为 0，先去卖矿或做任务赚点钱吧。</span>}
          </div>
          <p className="modal-hint">
            带入局内的现金：黑市交易 / 维修 / 强盗勒索使用，剩余自动带回仓库。上限 {fmt(maxPocket)}。
          </p>
        </section>

        <section className="deploy-section">
          <h3 className="deploy-section-title"><span className="sec-num">4</span> 一次性增益（仅本局）</h3>
          <div className="buff-grid">
            {BUFF_ORDER.map((id) => {
              const def = BUFF_DEFS[id];
              const on = buffs.includes(id);
              return (
                <button key={id} className={`buff-card ${on ? "on" : ""}`} onClick={() => toggleBuff(id)}>
                  <span className="buff-icon">{def.icon}</span>
                  <span className="buff-name">{def.name}</span>
                  <span className="buff-price">{drawFlags[id] ? "随机获得" : fmt(def.price) + " 💰"}</span>
                  <span className="buff-desc">{def.desc}</span>
                </button>
              );
            })}
          </div>
          <div className="deploy-actions">
            <button
              className="btn btn-secondary btn-sm"
              disabled={buffs.length >= BUFF_ORDER.length}
              onClick={drawBuff}
            >
              随机抽取 {fmt(BUFF_RANDOM_PRICE)} 💰
            </button>
            <span className="deploy-cost">增益小计：{fmt(buffCost)} 💰</span>
          </div>
        </section>
      </div>

      {/* 右列：道具 + 装备 + 出发 */}
      <div className="deploy-col">
        <section className="deploy-section">
          <h3 className="deploy-section-title"><span className="sec-num">5</span> 携带道具（最多 4 件）</h3>
          {Object.keys(save.warehouseItems).length === 0 ? (
            <p className="modal-hint">仓库暂无消耗品，可在商店购买或下矿获取。</p>
          ) : (
            <div className="carry-grid">
              {Object.entries(save.warehouseItems).map(([id, count]) => {
                const def = CONSUMABLES[id];
                if (!def || count <= 0) return null;
                const on = carried.includes(id);
                const full = !on && carried.length >= 4;
                return (
                  <button
                    key={id}
                    className={`carry-chip ${on ? "on" : ""}`}
                    disabled={full}
                    onClick={() => toggleCarried(id)}
                  >
                    <span>{def.icon} {def.name} ×{count}</span>
                    <span>{on ? "已携带 ✓" : "点击携带"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="deploy-section">
          <h3 className="deploy-section-title"><span className="sec-num">6</span> 出战装备</h3>
          <div className="loadout-summary">
            {EQUIP_SLOTS.map((slot) => {
              const uid = save.equipped[slot];
              const inst = uid ? save.warehouseEquipment.find((e) => e.uid === uid) : null;
              const def = inst ? EQUIPMENT_DEFS[inst.id] : null;
              return (
                <div key={slot} className="equip-slot-row">
                  <span className="slot-label">{EQUIPMENT_SLOT_NAMES[slot]}</span>
                  <span>{def ? def.icon + " " + def.name : "—"}</span>
                </div>
              );
            })}
          </div>
          {equipLines.length > 0 && <p className="modal-hint">加成：{equipLines.join(" · ")}</p>}
        </section>

        <section className="deploy-section summary-card">
          <h3 className="deploy-section-title"><span className="sec-num">7</span> 出发确认</h3>
          <div className="summary-grid">
            <div className="stat-card">
              <span className="stat-label">总花费</span>
              <span className="stat-value gold">{fmt(totalCost)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">携带现金</span>
              <span className="stat-value">{fmt(pocketShown)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">收益倍率</span>
              <span className="stat-value cyan">×{DIFFICULTY_DEFS[difficulty].incomeMult}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">装备加成</span>
              <span className="stat-value">{equipLines.length ? equipLines.join(" · ") : "无"}</span>
            </div>
          </div>
          <button className="btn btn-big btn-primary" disabled={!canAfford} onClick={deploy}>
            出发！{totalCost > 0 ? "（" + fmt(totalCost) + " 💰）" : "（免费）"}
          </button>
          {!canAfford && <p className="modal-hint">现金不足：需要 {fmt(totalCost)}，当前 {fmt(save.cash)}</p>}
        </section>
      </div>
    </div>
  );

  // ---------- 排行榜页 ----------
  const renderLeaderboard = () => (
    <div className="deploy-layout">
      <section className="deploy-section deploy-actions">
        <h3 className="deploy-section-title">深渊排行榜</h3>
        <p className="modal-hint">按「单次下矿最高入库价值」排名，登录后成绩自动上榜。</p>
        <button className="btn btn-big btn-primary" onClick={props.onLeaderboard}>
          🏆 打开排行榜
        </button>
      </section>
    </div>
  );

  // ---------- 设置页 ----------
  const renderSettings = () => (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">声音</h3>
        <button className="btn btn-secondary" onClick={props.onToggleMute}>
          {muted ? "🔇 开启音效" : "🔊 静音"}
        </button>
      </section>
      <section className="deploy-section">
        <h3 className="deploy-section-title">账号</h3>
        {user ? (
          <div className="user-chip">
            <span className="user-name">{user.username}</span>
            <button className="btn btn-danger btn-sm" onClick={props.onLogout}>退出登录</button>
          </div>
        ) : (
          <div className="user-chip">
            <button className="btn btn-primary btn-sm" onClick={props.onLogin}>登录</button>
            <button className="btn btn-secondary btn-sm" onClick={props.onRegister}>注册</button>
          </div>
        )}
      </section>
      <section className="deploy-section">
        <h3 className="deploy-section-title">成长</h3>
        <button className="btn btn-secondary" onClick={props.onUpgrades}>🔧 升级车间</button>
      </section>
    </div>
  );

  return (
    <div className="lobby-screen">
      <div className="lobby-bg" />

      <header className="lobby-header">
        <div className="lobby-brand">
          <span className="brand-ore">💎</span>
          <span>深渊矿工</span>
        </div>
        <div className="lobby-top-right">
          <div className="lobby-cash">💰 {fmt(save.cash)}</div>
          {user ? (
            <div className="user-chip">
              <span className="user-name">{user.username}</span>
              <button className="btn btn-ghost btn-sm" onClick={props.onLogout}>退出</button>
            </div>
          ) : (
            <div className="user-chip">
              <button className="btn btn-ghost btn-sm" onClick={props.onLogin}>登录</button>
              <button className="btn btn-primary btn-sm" onClick={props.onRegister}>注册</button>
            </div>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={props.onToggleMute}
            title={muted ? "开启音效" : "静音"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      <nav className="lobby-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`lobby-tab ${tab === t.id ? "on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.name}
          </button>
        ))}
      </nav>

      <div className="lobby-panel">
        {tab === "deploy" && renderDeploy()}
        {tab === "warehouse" && <WarehousePanel save={save} onSave={onSave} />}
        {tab === "shop" && <ShopPanel save={save} onSave={onSave} />}
        {tab === "loadout" && <LoadoutPanel save={save} onSave={onSave} />}
        {tab === "leaderboard" && renderLeaderboard()}
        {tab === "settings" && renderSettings()}
      </div>
    </div>
  );
}
