"use client";

import { useState } from "react";
import { fmt } from "@/game/config";
import type { SaveData } from "@/game/config";
import { EQUIPMENT_SLOT_NAMES, TIER_NAMES } from "@/game/items";
import {
  CONSUMABLE_RECIPES, EQUIP_RECIPES,
  countOre, canForge, forgeRecipe, oreLabel,
  type ForgeRecipe,
} from "@/game/forge";

type Props = {
  save: SaveData;
  onSave: (next: SaveData) => void;
};

function RecipeCard({ recipe, save, onForge }: { recipe: ForgeRecipe; save: SaveData; onForge: (r: ForgeRecipe) => void }) {
  const ok = canForge(save, recipe);
  const costNodes = recipe.cost.map((c) => {
    const have = countOre(save.warehouseStacks, c.ore, c.quality);
    const enough = have >= c.count;
    return (
      <span key={recipe.id + "-" + c.ore + c.quality} className={"forge-cost" + (enough ? "" : " poor")}>
        {c.count}× {oreLabel(c.ore, c.quality)}
        <em className={"forge-have" + (enough ? "" : " poor")}>（持有 {have}）</em>
      </span>
    );
  });
  const resultText =
    recipe.kind === "equipment" && recipe.resultSlot
      ? `${EQUIPMENT_SLOT_NAMES[recipe.resultSlot]} · ${TIER_NAMES[recipe.tierRange[0]]}~${TIER_NAMES[recipe.tierRange[1]]}`
      : "消耗品 ×1";
  return (
    <div className={"forge-card" + (ok ? "" : " locked")}>
      <div className="forge-head">
        <span className="forge-icon">{recipe.icon}</span>
        <span className="forge-name">{recipe.name}</span>
        <span className="forge-result">{resultText}</span>
      </div>
      <p className="forge-desc">{recipe.desc}</p>
      <div className="forge-costs">{costNodes}{recipe.cash > 0 && <span className={"forge-cost" + (save.cash >= recipe.cash ? "" : " poor")}>{fmt(recipe.cash)} 现金</span>}</div>
      <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={() => onForge(recipe)}>
        {recipe.kind === "equipment" ? "锻造" : "制造"}
      </button>
    </div>
  );
}

export default function ForgePanel({ save, onSave }: Props) {
  const [notice, setNotice] = useState<string | null>(null);

  const handleForge = (recipe: ForgeRecipe) => {
    const next = forgeRecipe(save, recipe);
    if (!next) return;
    onSave(next);
    setNotice(
      recipe.kind === "equipment"
        ? `🔨 锻造完成！${recipe.name} 已放入装备库，可到「装备」页签穿戴。`
        : `🔧 制造完成！${recipe.name} 已放入仓库消耗品。`
    );
    window.setTimeout(() => setNotice(null), 2600);
  };

  return (
    <div className="deploy-layout">
      <section className="deploy-section">
        <h3 className="deploy-section-title">🔨 装备锻造（矿石 + 现金）</h3>
        <p className="modal-hint">消耗仓库矿石与现金，随机锻制对应槽位的装备；品质越高所需矿石越好。锻造完成后到「装备」页签穿戴。</p>
        <div className="forge-grid">
          {EQUIP_RECIPES.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} save={save} onForge={handleForge} />
          ))}
        </div>
      </section>

      <section className="deploy-section">
        <h3 className="deploy-section-title">🔧 消耗品制造（矿石）</h3>
        <p className="modal-hint">把仓库里的矿石加工成下矿用得上的消耗品。</p>
        <div className="forge-grid">
          {CONSUMABLE_RECIPES.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} save={save} onForge={handleForge} />
          ))}
        </div>
      </section>

      {notice && <div className="forge-notice">{notice}</div>}
    </div>
  );
}
