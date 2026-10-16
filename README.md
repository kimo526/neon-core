# NEON CORE // 解限核心

一个"热管理驱动"的机甲 roguelite 竞技场。单文件网页游戏，纯 JS + Canvas，没有依赖、没有构建步骤。

```
双击 start.cmd       # 或者：  node tools/serve.mjs   然后打开 http://127.0.0.1:8787/
```

> ES module 在 `file://` 下会被浏览器 CORS 拦掉，所以必须走 http。`start.cmd` 已经包好了这一步。

## 玩什么

| 操作 | 说明 |
| --- | --- |
| `W A S D` | 移动 |
| 鼠标 | 瞄准，`左键` 射击 |
| `空格` | 冲刺（有无敌帧，可以穿过敌人） |
| `1` / `2` | 切换武器：游侠脉冲 / 重锤霰射 |
| `1 2 3` | 清波后选择强化卡 |
| `Esc` | 暂停 |
| `G` | 让内置 AI 接管（打不过就看它打，再按一次交还） |

**核心机制是热量。** 按住扳机时**完全不散热**，热量满了会锁枪，散热期间还会额外减速。所以这游戏不是"按住左键"，而是一口气打空 → 松手散热 → 再打一波的节奏。血量/热量/DASH 都在左上角，热量超过 75% 屏幕边缘会开始泛红。

清掉一波给三张强化卡，卡池有 15 张，偏向**改变玩法**而不是纯数值：超载核心（射速换热量）、弹射协议（子弹打墙反弹）、相位脉冲（冲刺穿敌触发脉冲）、引力锚（站桩散热翻倍）……

## 代码结构

```
src/content.js    数值与内容：手感参数、武器、敌人、成长系数
src/upgrades.js   强化卡池 + 抽卡
src/sim.js        纯逻辑模拟：step(world, input, dt)，不碰 DOM
src/bot.js        会走位/预判/管理热量的 AI（就是按 G 出场的那个）
src/harness.js    无头对局跑分（Node 和浏览器共用）
src/render.js     Canvas 渲染
src/main.js       主循环、HUD、界面状态机、window.NEON 调试钩子
tests/            23 个测试：机制、边界、平衡、长跑稳定性
tools/            静态服务器 / 平衡台 / 诊断脚本
```

关键设计：**逻辑层是纯函数式的**，`step(world, input, dt)` 只依赖传入的 world 和一份 input。人类玩家和 AI 走的是同一个 input 接口，所以 AI 跑出来的平衡数据对人类是有意义的。

## 开发

```bash
node --test tests/sim.test.js tests/balance.test.js   # 23 个测试
node tools/simulate.mjs 1,2,3,4,5 180                 # 让 AI 跑 5 局，输出成绩单
node tools/sim.js                                     # （诊断用）热量曲线
```

改手感只需要动 `src/content.js` 里的 `TUNING` / `WEAPONS` / `ENEMY_TYPES`。

浏览器里还有调试钩子：`NEON.debug()` 看状态，`NEON.setSpeed(4)` 加速，`NEON.bot.on()` 托管。

## 当前平衡基线

AI（会预判瞄准、会拉距离、热量到 72% 主动松手）在 8 个种子上平均：

- 存活 180s 时长局能到第 10 波，击杀 ~160，命中率 ~87%
- 120s 短局一般第 7–9 波阵亡，击杀 70–110

人类成绩通常会低于这个数（AI 的预判瞄准很准），所以如果你能活过 AI，说明打得不错。
