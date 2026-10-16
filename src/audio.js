// 音频层：全部用 WebAudio 现场合成，不加载任何音频文件（零依赖、离线可用）。
// 设计目标：让"热量"能被听见 —— 枪声越打越尖、快过热时进警报，过热瞬间一声闷响。
//
// 用法：createAudio() 得到引擎；引擎在第一次 play/update 时惰性建 AudioContext
// （浏览器要求用户手势之后才能出声，所以必须在点击/按键之后再调用）。

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createAudio(opts = {}) {
  const cfg = { volume: 0.55, maxVoices: 20, ...opts };
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let sizzle = null; // 热量底噪
  let locked = false;
  let enabled = true;
  let voices = 0;
  let lastBeat = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? cfg.volume : 0;
    // 轻压一下动态，避免多人同时开枪糊成一片
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);

    // 预生成一段白噪声，反复复用
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function resume() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
    return c;
  }

  function budget() {
    if (!ctx || voices >= cfg.maxVoices) return false;
    voices++;
    return true;
  }

  function releaseAt(t) {
    const delay = Math.max(0, (t - ctx.currentTime) * 1000) + 40;
    setTimeout(() => {
      voices = Math.max(0, voices - 1);
      if (locked && !sizzle) locked = false;
    }, delay);
  }

  /** 一条振荡器音：从 f0 滑到 f1，带包络 */
  function tone({ type = 'square', f0 = 440, f1 = null, dur = 0.1, gain = 0.2, attack = 0.004, filter = null }) {
    if (!resume() || !budget()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== null && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = filter.type ?? 'lowpass';
      bq.frequency.value = filter.freq ?? 1200;
      bq.Q.value = filter.q ?? 1;
      osc.connect(bq);
      node = bq;
    }
    node.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    releaseAt(t + dur);
  }

  /** 一段噪声：打击感/爆炸/冲刺都靠它 */
  function noise({ dur = 0.12, gain = 0.2, type = 'lowpass', freq = 1200, freqEnd = null, q = 1 }) {
    if (!resume() || !budget()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) bq.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
    releaseAt(t + dur);
  }

  return {
    get enabled() {
      return enabled;
    },
    get ready() {
      return !!ctx;
    },
    /** 给播报模块用的音频上下文与总线 */
    get context() {
      return ctx;
    },
    get bus() {
      return master;
    },
    /** 在用户手势里调用一次，解锁音频 */
    unlock() {
      resume();
    },
    toggle() {
      enabled = !enabled;
      if (master) master.gain.value = enabled ? cfg.volume : 0;
      if (enabled) resume();
      return enabled;
    },

    /** 一次性事件的音效（由 main.js 把 world.events 直接喂进来） */
    play(events, world) {
      if (!ctx || !enabled) return;
      for (const e of events) {
        switch (e.type) {
          case 'shoot': {
            if (e.weapon === 'heavy') {
              noise({ dur: 0.2, gain: 0.3, freq: 2600, freqEnd: 300, q: 0.8 });
              tone({ type: 'triangle', f0: 150, f1: 60, dur: 0.15, gain: 0.22 });
            } else {
              // 激光：音高随该玩家的热量上移，越烫越尖
              const p = world.players.find((x) => x.id === e.id);
              const heat = p ? clamp(p.heat / p.stats.heatMax, 0, 1) : 0;
              tone({ type: 'square', f0: 860 + heat * 340, f1: 220, dur: 0.075, gain: 0.13, filter: { freq: 2600 } });
            }
            break;
          }
          case 'hit':
            noise({ dur: 0.05, gain: 0.14, type: 'bandpass', freq: 1800, q: 1.4 });
            break;
          case 'kill': {
            const big = e.type === 'tank';
            tone({ type: 'triangle', f0: big ? 520 : 420, f1: big ? 90 : 140, dur: big ? 0.28 : 0.13, gain: big ? 0.26 : 0.14 });
            noise({ dur: big ? 0.32 : 0.14, gain: big ? 0.26 : 0.13, freq: big ? 1400 : 2200, freqEnd: 220 });
            break;
          }
          case 'dash':
            noise({ dur: 0.16, gain: 0.16, type: 'bandpass', freq: 300, freqEnd: 2600, q: 0.9 });
            break;
          case 'overheat':
            locked = true;
            tone({ type: 'sawtooth', f0: 300, f1: 70, dur: 0.5, gain: 0.3, filter: { freq: 900 } });
            noise({ dur: 0.45, gain: 0.24, freq: 900, freqEnd: 160 });
            break;
          case 'cooledDown':
            tone({ type: 'sine', f0: 420, f1: 700, dur: 0.16, gain: 0.16 });
            break;
          case 'playerHit':
            noise({ dur: 0.24, gain: 0.3, freq: 1400, freqEnd: 180 });
            tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.24, gain: 0.18, filter: { freq: 700 } });
            break;
          case 'enemyShoot':
            tone({ type: 'sawtooth', f0: 520, f1: 300, dur: 0.12, gain: 0.09 });
            break;
          case 'waveClear':
            // 上行三和弦：清场的奖励感
            [0, 4, 7, 12].forEach((semi, i) => {
              setTimeout(() => tone({ type: 'triangle', f0: 330 * Math.pow(2, semi / 12), dur: 0.22, gain: 0.16 }), i * 70);
            });
            break;
          case 'cardPicked':
            tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.14, gain: 0.14 });
            break;
          case 'playerDown':
            tone({ type: 'sawtooth', f0: 260, f1: 40, dur: 0.8, gain: 0.3, filter: { freq: 600 } });
            noise({ dur: 0.7, gain: 0.26, freq: 900, freqEnd: 90 });
            break;
          case 'playerRevived':
            [0, 7, 12, 19].forEach((semi, i) => {
              setTimeout(
                () => tone({ type: 'sine', f0: 440 * Math.pow(2, semi / 12), dur: 0.3, gain: 0.13 }),
                i * 80
              );
            });
            break;
          case 'allDown':
            [12, 7, 3, 0].forEach((semi, i) => {
              setTimeout(
                () => tone({ type: 'sawtooth', f0: 300 * Math.pow(2, semi / 12), f1: 120, dur: 0.5, gain: 0.2, filter: { freq: 800 } }),
                i * 160
              );
            });
            break;
          default:
            break;
        }
      }
    },

    /**
     * 每帧调用：热量底噪 + 过热警报 + 低频脉冲。
     * 这些是"状态音"，玩家不用看 HUD 也能听出自己快烧穿了。
     */
    update(world, dt) {
      if (!ctx || !enabled) return;
      const alive = world.players.filter((p) => !p.down);
      if (!alive.length) return;
      const heat = Math.max(...alive.map((p) => clamp(p.heat / p.stats.heatMax, 0, 1)));
      const anyLock = alive.some((p) => p.heatLock);

      // 热量底噪：一个常驻噪声源，靠滤波器频率和音量表达温度
      if (!sizzle && heat > 0.3) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const bq = ctx.createBiquadFilter();
        bq.type = 'bandpass';
        bq.frequency.value = 1200;
        bq.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(bq).connect(g).connect(master);
        src.start();
        sizzle = { src, bq, g };
      }
      if (sizzle) {
        const target = heat > 0.35 ? (heat - 0.35) / 0.65 : 0;
        const targetGain = anyLock ? 0.16 : target * 0.075;
        sizzle.g.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.08);
        sizzle.bq.frequency.setTargetAtTime(700 + heat * 2600, ctx.currentTime, 0.1);
      }

      // 过热警报：每 0.45 秒一声
      if (anyLock) {
        if (world.time - lastBeat > 0.45) {
          lastBeat = world.time;
          tone({ type: 'square', f0: 1180, dur: 0.09, gain: 0.1 });
        }
      } else if (world.time - lastBeat > 0.5) {
        lastBeat = world.time;
        // 低频脉冲：纯节奏感，音量随波次提高
        const k = clamp(world.wave / 12, 0, 1);
        tone({ type: 'sine', f0: 70, f1: 45, dur: 0.14, gain: 0.05 + k * 0.05 });
      }
      void dt;
    },

    dispose() {
      if (sizzle) {
        try {
          sizzle.src.stop();
        } catch {
          /* 已经停了 */
        }
        sizzle = null;
      }
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}
