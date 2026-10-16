// NEON CORE — 数值与配置层
// 所有可调手感参数集中在 TUNING，玩法内容集中在 WEAPONS / ENEMY_TYPES / ENEMY_SCALING。

export const ARENA = { w: 960, h: 540 };
export const STEP = 1 / 60;

export const TUNING = {
  accel: 3200,
  friction: 10.5,
  dashSpeed: 1080,
  dashTime: 0.16,
  dashCooldown: 0.95,
  dashIframe: 0.28,
  // 过热惩罚：锁定期间散热打 55 折，且要降到这个比例才解枪
  heatRelease: 0.3,
  overheatCoolMul: 0.55,
  reviveIframe: 1.6,

  hitStop: 0.045,
  shakeKill: 4.5,
  shakeHit: 13,
  shakePlayerHit: 20,

  lifeOnKill: 0.02,

  spreadMult: 6,
  waveClearDelay: 1.35,
  cardCount: 3,
};

export const WEAPONS = {
  ranger: {
    id: 'ranger',
    name: '游侠脉冲',
    damage: 10,
    fireRate: 0.115,
    speed: 720,
    spread: 0.045,
    pellets: 1,
    life: 0.85,
    radius: 3,
    knockback: 90,
    pierce: 0,
    heatPerShot: 6,
    heatMax: 100,
    heatCool: 64,
  },
  heavy: {
    id: 'heavy',
    name: '重锤霰射',
    damage: 7,
    fireRate: 0.72,
    speed: 560,
    spread: 0.42,
    pellets: 7,
    life: 0.42,
    radius: 4,
    knockback: 420,
    pierce: 0,
    heatPerShot: 42,
    heatMax: 100,
    heatCool: 58,
  },
};

export const ENEMY_TYPES = {
  drone: { hp: 24, radius: 11, speed: 118, accel: 520, damage: 9, color: '#6ff0ff', lifeOnHit: 0.02 },
  runner: { hp: 15, radius: 8, speed: 205, accel: 1500, damage: 7, color: '#ffe066', lifeOnHit: 0.02 },
  tank: { hp: 135, radius: 21, speed: 62, accel: 320, damage: 19, color: '#ff7a4d', lifeOnHit: 0.03 },
  turret: { hp: 62, radius: 15, speed: 0, accel: 0, damage: 11, color: '#ff5cad', lifeOnHit: 0.02, ranged: true },
};

export const ENEMY_SCALING = { hp: 1.14, speed: 1.025, damage: 1.055 };

export const PLAYER = { radius: 12, hpMax: 100, speed: 300 };

export const UPGRADE_TAGS = {
  weapon: { label: '武器核心', color: '#4ff0ff' },
  mobility: { label: '推进系统', color: '#8affc1' },
  chassis: { label: '装甲框架', color: '#ffd166' },
  special: { label: '异常模组', color: '#ff5cad' },
};
