// 强化卡池：不做数值膨胀，尽量做"改变玩法"的词条。
import { PLAYER, WEAPONS, TUNING } from './content.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const CARDS = [
  {
    id: 'overclock',
    tag: 'weapon',
    name: '超载核心',
    desc: (s) => `射速 +25%，热量累积 +70%（现在 ${Math.round(s.heatPerShot * 1.7)}/发）`,
    weight: 1,
    apply: (s) => {
      s.fireRate = Math.max(0.045, s.fireRate * 0.8);
      s.heatPerShot *= 1.7;
    },
  },
  {
    id: 'coolant',
    tag: 'weapon',
    name: '低温循环',
    desc: () => '散热 ×1.8，热量上限 +20',
    weight: 1,
    apply: (s) => {
      s.heatCool *= 1.8;
      s.heatMax += 20;
    },
  },
  {
    id: 'piercer',
    tag: 'weapon',
    name: '贯穿弹头',
    desc: () => '子弹可多穿透 1 个目标，伤害 −8%',
    weight: 1,
    apply: (s) => {
      s.pierce += 1;
      s.damage *= 0.92;
    },
  },
  {
    id: 'ricochet',
    tag: 'special',
    name: '弹射协议',
    desc: () => '子弹撞墙后弹射一次（不再消失）',
    weight: 0.8,
    apply: (s) => {
      s.ricochet += 1;
    },
  },
  {
    id: 'split',
    tag: 'weapon',
    name: '裂变枪管',
    desc: (s) => `每次射击多打 1 发，散布变大（${Math.round(s.spread * TUNING.spreadMult * 57.3)}° → 更散）`,
    weight: 0.9,
    apply: (s) => {
      s.pellets += 1;
      s.spread *= TUNING.spreadMult;
      s.damage *= 0.88;
    },
  },
  {
    id: 'thermo',
    tag: 'special',
    name: '热熔增幅',
    desc: () => '热量越高伤害越高，满热时 +60%',
    weight: 1,
    apply: (s) => {
      s.thermo += 0.6;
    },
  },
  {
    id: 'vent',
    tag: 'weapon',
    name: '强制排热',
    desc: () => '过热时自动放出环形冲击波，击退并伤害周围敌人',
    weight: 0.8,
    apply: (s) => {
      s.ventBlast = true;
    },
  },
  {
    id: 'thruster',
    tag: 'mobility',
    name: '推进过载',
    desc: () => '冲刺冷却 −30%，冲刺距离 +15%',
    weight: 1,
    apply: (s) => {
      s.dashCooldown *= 0.7;
      s.dashSpeed *= 1.15;
    },
  },
  {
    id: 'doublejump',
    tag: 'mobility',
    name: '二段推进',
    desc: () => '冲刺可连续使用 2 次',
    weight: 0.7,
    apply: (s) => {
      s.dashCharges = Math.max(s.dashCharges, 0) + 1;
    },
  },
  {
    id: 'pulse',
    tag: 'mobility',
    name: '相位脉冲',
    desc: () => '冲刺穿过敌人时触发脉冲：26 伤害 + 击退（冲刺构筑的起点）',
    weight: 1,
    apply: (s) => {
      s.dashPulse = Math.max(s.dashPulse, 26);
    },
  },
  // ---------- 冲刺构筑（互相叠加成一套"以冲刺为核心"的打法）----------
  {
    id: 'phaseblade',
    tag: 'dash',
    name: '相位刀锋',
    desc: () => '所有冲刺伤害 ×2.5',
    weight: 1,
    apply: (s) => {
      s.dashDamage *= 2.5;
    },
  },
  {
    id: 'coretrail',
    tag: 'dash',
    name: '熔核尾迹',
    desc: (s) => `冲刺路径留下灼烧尾迹（${s.trailDamage + 22}/秒，持续 1.2 秒）`,
    weight: 1,
    apply: (s) => {
      s.trailDamage += 22;
      s.trailLife = Math.max(s.trailLife, 1.2);
      s.trailRadius += 4;
    },
  },
  {
    id: 'burststop',
    tag: 'dash',
    name: '急停爆发',
    desc: () => '冲刺结束打出一圈弹幕，并立刻返还 1 段冲刺充能',
    weight: 0.9,
    apply: (s) => {
      s.burstOnDash = true;
    },
  },
  {
    id: 'chaindash',
    tag: 'dash',
    name: '连锁冲刺',
    desc: () => '每次击杀返还 0.45 秒冲刺冷却 —— 杀得越多，冲得越勤',
    weight: 1,
    apply: (s) => {
      s.dashOnKill += 0.45;
    },
  },
  {
    id: 'reflectplate',
    tag: 'dash',
    name: '反射装甲',
    desc: (s) => `冲刺获得 25 点护盾（上限 ${s.shieldMax + 50}，优先抵挡伤害）`,
    weight: 1,
    apply: (s) => {
      s.shieldMax += 50;
      s.shieldOnDash += 25;
    },
  },
  {
    id: 'voidbreak',
    tag: 'dash',
    name: '破空',
    desc: () => '冲刺结束时震住周围敌人 0.55 秒',
    weight: 0.9,
    apply: (s) => {
      s.dashStun += 0.55;
    },
  },
  {
    id: 'killheal',
    tag: 'chassis',
    name: '残骸回收',
    desc: (s) => `击杀恢复 ${((s.lifeOnKill + 0.03) * 100).toFixed(0)} 点结构值`,
    weight: 0.9,
    apply: (s) => {
      s.lifeOnKill += 0.03;
    },
  },
  {
    id: 'armor',
    tag: 'chassis',
    name: '复合装甲',
    desc: () => '结构上限 +25，并立即修复 25',
    weight: 1,
    apply: (s, world, player) => {
      s.hpMax += 25;
      if (player) player.hp = Math.min(s.hpMax, player.hp + 25);
    },
  },
  {
    id: 'kinetic',
    tag: 'chassis',
    name: '动能阻尼',
    desc: () => '受到的伤害 −20%',
    weight: 1,
    apply: (s) => {
      s.damageTaken *= 0.8;
    },
  },
  {
    id: 'nanoswarm',
    tag: 'chassis',
    name: '纳米蜂群',
    desc: () => '每秒修复 1.2 点结构值',
    weight: 0.7,
    apply: (s) => {
      s.regen += 1.2;
    },
  },
  {
    id: 'magnetar',
    tag: 'mobility',
    name: '引力锚',
    desc: () => '静止时散热 ×2.4，移动时 ×0.7',
    weight: 0.8,
    apply: (s) => {
      s.anchor = true;
    },
  },
];

export function cardText(card, stats) {
  return typeof card.desc === 'function' ? card.desc(stats) : card.desc;
}

/** 从卡池里按权重抽 n 张不重复的卡 */
export function rollCards(rng, n = TUNING.cardCount, exclude = []) {
  const pool = CARDS.filter((c) => !exclude.includes(c.id));
  const picked = [];
  const bag = pool.slice();
  while (picked.length < n && bag.length) {
    let total = 0;
    for (const c of bag) total += c.weight;
    let r = rng() * total;
    let idx = bag.length - 1;
    for (let i = 0; i < bag.length; i++) {
      r -= bag[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(bag.splice(idx, 1)[0]);
  }
  return picked;
}

export function createStats() {
  const base = WEAPONS.ranger;
  return {
    weapon: base.id,
    damage: base.damage,
    fireRate: base.fireRate,
    bulletSpeed: base.speed,
    spread: base.spread,
    pellets: base.pellets,
    bulletLife: base.life,
    bulletRadius: base.radius,
    bulletKnockback: base.knockback,
    pierce: base.pierce,
    ricochet: 0,

    heatPerShot: base.heatPerShot,
    heatMax: base.heatMax,
    heatCool: base.heatCool,
    thermo: 0,
    ventBlast: false,

    hpMax: PLAYER.hpMax,
    speed: PLAYER.speed,
    accel: TUNING.accel,
    dashSpeed: TUNING.dashSpeed,
    dashTime: TUNING.dashTime,
    dashCooldown: TUNING.dashCooldown,
    dashCharges: 0,
    // 冲刺构筑：这些数值决定"冲刺流"能走多远
    dashPulse: 0, // >0 时冲刺穿敌触发脉冲（数值 = 脉冲伤害）
    dashDamage: 1, // 所有冲刺伤害的倍率
    trailDamage: 0, // 熔核尾迹：每 0.25 秒的伤害
    trailLife: 0.9,
    trailRadius: 26,
    shieldOnDash: 0,
    shieldMax: 0,
    dashStun: 0, // 破空：冲刺结束时震住周围敌人的秒数
    burstOnDash: false, // 急停爆发：冲刺结束打出一圈弹幕
    dashOnKill: 0, // 连锁冲刺：击杀返还的冷却秒数
    dashPulse: false,

    damageTaken: 1,
    regen: 0,
    lifeOnKill: TUNING.lifeOnKill,
    anchor: false,
    taken: [],
  };
}

export function applyCard(world, id, playerId = null) {
  const card = CARDS.find((c) => c.id === id);
  const player = (playerId === null ? world.players?.[0] : world.players?.find((p) => p.id === playerId)) ?? null;
  if (!card || !player) return null;
  card.apply(player.stats, world, player);
  player.stats.taken.push(id);
  player.hp = Math.min(player.stats.hpMax, player.hp);
  return card;
}

export { clamp };
