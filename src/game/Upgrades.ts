/** Run modifiers picked between waves. Reset when the run ends. */
export type Mods = {
  /** Added to every jab. */
  punchDamage: number;
  /** Added to the roundhouse finisher. */
  finisherDamage: number;
  /** Extra seconds of counter window after a Shadow Step. */
  counterWindow: number;
  /** HP restored by every counter blow that lands. */
  counterHeal: number;
  maxHp: number;
  /** Extra reach and damage for the jump-attack slam. */
  slamReach: number;
  slamDamage: number;
  /** The roundhouse finisher breaks a duelist's guard. */
  guardBreakKick: boolean;
  /** Every roll, not just a perfect one, primes a short counter. */
  ghostRoll: boolean;
};

export function freshMods(): Mods {
  return {
    punchDamage: 0,
    finisherDamage: 0,
    counterWindow: 0,
    counterHeal: 0,
    maxHp: 0,
    slamReach: 0,
    slamDamage: 0,
    guardBreakKick: false,
    ghostRoll: false,
  };
}

export type Upgrade = {
  id: string;
  name: string;
  glyph: string;
  describe: string;
  /** How many times it can be taken in one run. */
  max: number;
  apply(mods: Mods): void;
};

export const UPGRADES: readonly Upgrade[] = [
  {
    id: "iron-fist",
    name: "Iron Fist",
    glyph: "拳",
    describe: "Jabs deal +1 damage.",
    max: 2,
    apply: (m) => void (m.punchDamage += 1),
  },
  {
    id: "crescent",
    name: "Crescent Moon",
    glyph: "月",
    describe: "The roundhouse finisher deals +2 damage.",
    max: 2,
    apply: (m) => void (m.finisherDamage += 2),
  },
  {
    id: "long-shadow",
    name: "Long Shadow",
    glyph: "影",
    describe: "Shadow Step counters last 1 second longer.",
    max: 2,
    apply: (m) => void (m.counterWindow += 1),
  },
  {
    id: "leeching",
    name: "Leeching Shadow",
    glyph: "吸",
    describe: "Every counter blow heals 5 HP.",
    max: 2,
    apply: (m) => void (m.counterHeal += 5),
  },
  {
    id: "tempered",
    name: "Tempered Body",
    glyph: "鋼",
    describe: "+30 max HP, and heal to full.",
    max: 3,
    apply: (m) => void (m.maxHp += 30),
  },
  {
    id: "earthshaker",
    name: "Earthshaker",
    glyph: "震",
    describe: "Jump-attack slam: +1.2 m radius and +1 damage.",
    max: 2,
    apply: (m) => {
      m.slamReach += 1.2;
      m.slamDamage += 1;
    },
  },
  {
    id: "guard-breaker",
    name: "Guard Breaker",
    glyph: "破",
    describe: "Your roundhouse smashes through a duelist's guard.",
    max: 1,
    apply: (m) => void (m.guardBreakKick = true),
  },
  {
    id: "ghost-roll",
    name: "Ghost Roll",
    glyph: "霊",
    describe: "Any roll primes a half-second counter, not just a perfect one.",
    max: 1,
    apply: (m) => void (m.ghostRoll = true),
  },
];

/** Three different upgrades not yet taken to their limit. */
export function rollChoices(taken: ReadonlyMap<string, number>): Upgrade[] {
  const open = UPGRADES.filter((u) => (taken.get(u.id) ?? 0) < u.max);
  for (let i = open.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, 3);
}

/** The between-waves choice: three cards, picked with the 1 / 2 / 3 keys. */
export class UpgradePick {
  private readonly root: HTMLElement | null;
  private choices: Upgrade[] = [];
  private onPick: ((upgrade: Upgrade) => void) | null = null;

  constructor() {
    this.root = document.getElementById("upgrade-pick");
    this.onKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
  }

  isOpen(): boolean {
    return this.onPick !== null;
  }

  open(choices: Upgrade[], onPick: (upgrade: Upgrade) => void): void {
    if (choices.length === 0) return;
    this.choices = choices;
    this.onPick = onPick;
    const list = this.root?.querySelector(".upgrade-cards");
    if (list) {
      list.replaceChildren(
        ...choices.map((u, i) => {
          const card = document.createElement("div");
          card.className = "upgrade-card";
          const key = document.createElement("span");
          key.className = "upgrade-key";
          key.textContent = String(i + 1);
          const glyph = document.createElement("span");
          glyph.className = "upgrade-glyph";
          glyph.textContent = u.glyph;
          const name = document.createElement("strong");
          name.textContent = u.name;
          const text = document.createElement("p");
          text.textContent = u.describe;
          card.append(key, glyph, name, text);
          return card;
        }),
      );
    }
    this.root?.classList.add("is-visible");
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.onPick || event.repeat) return;
    const index = ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].indexOf(event.code) % 3;
    const upgrade = this.choices[index];
    if (index < 0 || !upgrade) return;
    const pick = this.onPick;
    this.onPick = null;
    this.root?.classList.remove("is-visible");
    pick(upgrade);
  }
}
