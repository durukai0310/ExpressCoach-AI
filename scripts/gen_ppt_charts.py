# -*- coding: utf-8 -*-
"""
生成答辩 PPT 所需图表（MUJI 配色 + 中文）
1. fig-4dim-radar.png  四维敏感度雷达图（核心创新①可视化）
2. fig-7dim-radar.png  七维竞品雷达图（5领先+2落后 诚实口径）
3. fig-hybrid-bar.png  混合架构验证柱状图（78.9 / 88.9 / 92.6）
"""
import json
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

# ── 中文字体 ──────────────────────────────────────
for fname in ["Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "PingFang SC"]:
    try:
        font_manager.findfont(fname, fallback_to_default=False)
        plt.rcParams["font.sans-serif"] = [fname]
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

# ── MUJI 配色（与网页/初赛PPT一致）────────────────
BROWN = "#4A4238"      # 主文字
TAPE = "#9B8C78"       # 主强调
SAGE = "#8A9A7F"       # 辅助绿
WARM = "#A8907A"       # 暖棕
STONE = "#8A8890"      # 石灰
BG = "#FAF9F6"         # 卡片底
GRID = "#E5E0D8"       # 网格
MUTED = "#8C8276"      # 次要文字

OUT = os.path.join(os.path.dirname(__file__), "..", "实验数据与报告", "图表数据")
os.makedirs(OUT, exist_ok=True)


def radar_factory(num_vars, frame="circle"):
    theta = np.linspace(0, 2 * np.pi, num_vars, endpoint=False)
    return theta


# ═══════════════════════════════════════════════════
# 图1: 四维敏感度雷达图 —— 核心创新①
# 展示两个真实场景的四维得分对比（高敏感 vs 低敏感）
# ═══════════════════════════════════════════════════
def fig_4dim_radar():
    labels = ["亲密度 I\n(0.35)", "权力 P\n(0.30)", "利益 E\n(0.25)", "语境 C\n(0.10)"]
    # 真实实测: "我想拒绝朋友借钱但不想伤感情" I=2 P=2.5 E=3 C=1 → S=2.30
    A = [2, 2.5, 3, 1]
    # 亲密+平等+纯情感+无冲突 → S = 0.35+0.30+0.25+0.00 = 0.90
    B = [1, 1, 1, 0]

    N = len(labels)
    theta = radar_factory(N)
    theta = np.concatenate([theta, theta[:1]])

    fig, ax = plt.subplots(figsize=(6.4, 5.4), subplot_kw=dict(polar=True))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    for vals, color, name, sval in [
        (A, TAPE, "拒绝朋友借钱", "S = 2.30 中敏感"),
        (B, SAGE, "亲密关系·纯情感", "S = 0.90 低敏感"),
    ]:
        v = np.concatenate([np.array(vals, dtype=float), np.array(vals[:1], dtype=float)])
        ax.plot(theta, v, color=color, linewidth=2.4, label=f"{name}  {sval}")
        ax.fill(theta, v, color=color, alpha=0.18)

    ax.set_xticks(theta[:-1])
    ax.set_xticklabels(labels, fontsize=13, color=BROWN, fontweight="bold")
    ax.set_ylim(0, 4)
    ax.set_yticks([1, 2, 3, 4])
    ax.set_yticklabels(["1", "2", "3", "4"], fontsize=9, color=MUTED)
    ax.tick_params(axis="x", pad=14)
    ax.grid(color=GRID, linewidth=1)
    ax.spines["polar"].set_color(GRID)

    legend = ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.02),
                       ncol=2, frameon=False, fontsize=11)
    for t in legend.get_texts():
        t.set_color(BROWN)

    path = os.path.join(OUT, "fig-4dim-radar.png")
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor=BG, pad_inches=0.12)
    plt.close(fig)
    print("已生成", path)


# ═══════════════════════════════════════════════════
# 图2: 七维竞品雷达图 —— 5领先 + 2落后（诚实口径）
# ═══════════════════════════════════════════════════
def fig_7dim_radar():
    src = json.load(open(os.path.join(OUT, "fig1-雷达图数据.json"), encoding="utf-8"))
    labels = src["labels"]
    N = len(labels)
    theta = radar_factory(N)
    theta = np.concatenate([theta, theta[:1]])

    colors = {"ExpressCoach": TAPE, "GPT-4o": STONE, "Claude": SAGE, "DeepSeek": WARM}
    dash = {"ExpressCoach": "-", "GPT-4o": "--", "Claude": (0, (5, 3)), "DeepSeek": (0, (1, 2))}

    fig, ax = plt.subplots(figsize=(7.6, 6.6), subplot_kw=dict(polar=True))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    for ds in src["datasets"]:
        v = np.concatenate([np.array(ds["data"], dtype=float), np.array(ds["data"][:1], dtype=float)])
        c = colors.get(ds["label"], STONE)
        lw = 2.8 if ds["label"] == "ExpressCoach" else 1.6
        ax.plot(theta, v, color=c, linewidth=lw, linestyle=dash.get(ds["label"], "-"),
                label=ds["label"], zorder=3 if ds["label"] == "ExpressCoach" else 2)
        if ds["label"] == "ExpressCoach":
            ax.fill(theta, v, color=c, alpha=0.16)

    ax.set_xticks(theta[:-1])
    ax.set_xticklabels(labels, fontsize=11.5, color=BROWN, fontweight="bold")
    ax.set_ylim(0, 5)
    ax.set_yticks([1, 2, 3, 4, 5])
    ax.set_yticklabels(["1", "2", "3", "4", "5"], fontsize=8.5, color=MUTED)
    ax.tick_params(axis="x", pad=16)
    ax.grid(color=GRID, linewidth=1)
    ax.spines["polar"].set_color(GRID)

    ax.set_title("七维能力对比（5分制）—— 5 维领先 · 2 维落后",
                 fontsize=14.5, color=BROWN, fontweight="bold", pad=28)
    legend = ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.2),
                       ncol=4, frameon=False, fontsize=10.5)
    for t in legend.get_texts():
        t.set_color(BROWN)

    path = os.path.join(OUT, "fig-7dim-radar.png")
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print("已生成", path)


# ═══════════════════════════════════════════════════
# 图3: 混合架构验证 —— 规则0.3 + LLM0.7 的直接证据
# ═══════════════════════════════════════════════════
def fig_hybrid_bar():
    names = ["纯规则层\n(权重1.0)", "纯 LLM\n(权重1.0)", "混合架构\n(规则0.3+LLM0.7)"]
    vals = [78.9, 88.9, 92.6]
    colors = [STONE, STONE, TAPE]

    fig, ax = plt.subplots(figsize=(8.2, 5.2))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    bars = ax.bar(names, vals, color=colors, width=0.52, zorder=3)
    bars[2].set_edgecolor("#7A6B57")
    bars[2].set_linewidth(1.5)

    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 1.2, f"{v}%",
                ha="center", va="bottom", fontsize=17,
                fontweight="bold", color=BROWN)

    ax.set_ylim(60, 100)
    ax.set_ylabel("关系判断准确率", fontsize=12.5, color=BROWN)
    ax.set_title("M2 关系判断：混合架构显著优于单一方案",
                 fontsize=15, color=BROWN, fontweight="bold", pad=16)
    ax.tick_params(axis="x", labelsize=12, colors=BROWN)
    ax.tick_params(axis="y", labelsize=10, colors=MUTED)
    ax.grid(axis="y", color=GRID, linewidth=1, zorder=0)
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)
    for s in ["left", "bottom"]:
        ax.spines[s].set_color(GRID)

    ax.annotate("混合 +3.7pt vs 纯LLM", xy=(2, 92.6), xytext=(1.45, 96.5),
                fontsize=11, color=MUTED,
                arrowprops=dict(arrowstyle="->", color=MUTED, lw=1.2))

    path = os.path.join(OUT, "fig-hybrid-bar.png")
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print("已生成", path)


if __name__ == "__main__":
    fig_4dim_radar()
    fig_7dim_radar()
    fig_hybrid_bar()
    print("全部图表生成完成")
