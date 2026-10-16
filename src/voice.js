// 机器人播报：不依赖任何外部 TTS 服务，用共振峰（formant）合成拼出"机甲播报音"。
//
// 为什么不用现成 TTS：这台机器上既没有 TTS 的 API key，也没有 python/ffmpeg，
// 而"第 N 波 / 过热 / 清空"这类战场播报恰恰最能提升节奏感。
// 于是用最朴素的办法：每个字拆成声母（噪声爆破）+ 韵母（双共振峰），套一条音高曲线，
// 拼出一个能听懂、且一听就是机器的声音。全离线、零依赖、不占体积。

/** 韵母 → 两个共振峰频率（决定"听起来像哪个元音"） */
const VOWELS = {
  i: [300, 2300],
  a: [800, 1200],
  e: [520, 1800],
  o: [480, 900],
  u: [340, 700],
  ai: [700, 1100],
  ei: [480, 1900],
  ao: [600, 950],
  ou: [470, 880],
  an: [700, 1150],
  en: [550, 1600],
  in: [320, 2000],
  ang: [750, 1050],
  eng: [560, 1500],
  ong: [520, 850],
  iu: [380, 1500],
  uo: [450, 800],
  er: [520, 1400],
};

/** 音节表：字 → [声母, 韵母]。声母只做噪声爆破，不追求严格音位。 */
const SYLLABLES = {
  di: ['d', 'i'],
  yi: ['', 'i'],
  er: ['', 'er'],
  san: ['s', 'an'],
  si: ['s', 'i'],
  wu: ['', 'u'],
  liu: ['l', 'iu'],
  qi: ['q', 'i'],
  ba: ['b', 'a'],
  jiu: ['j', 'iu'],
  shi: ['sh', 'i'],
  bo: ['b', 'o'],
  guo: ['g', 'uo'],
  re: ['r', 'e'],
  qing: ['q', 'eng'],
  kong: ['k', 'ong'],
  xin: ['x', 'in'],
  hao: ['h', 'ao'],
  duan: ['d', 'an'],
  kai: ['k', 'ai'],
  zhan: ['zh', 'an'],
  dou: ['d', 'ou'],
  shi_bai: ['sh', 'i'],
  bai: ['b', 'ai'],
  chao: ['ch', 'ao'],
  zai: ['z', 'ai'],
  hui: ['h', 'ei'],
  man: ['m', 'an'],
};

const CN_DIGITS = ['yi', 'yi', 'er', 'san', 'si', 'wu', 'liu', 'qi', 'ba', 'jiu'];

/** 1–99 的数字 → 音节序列（波次基本不会超过这个范围） */
function numberSyllables(n) {
  const out = [];
  const at = (i) => out.push(CN_DIGITS[i] ?? 'yi');
  if (n <= 0) return ['yi'];
  if (n < 10) at(n);
  else if (n === 10) out.push('shi');
  else if (n < 20) {
    out.push('shi');
    at(n % 10);
  } else {
    at(Math.floor(n / 10));
    out.push('shi');
    if (n % 10) at(n % 10);
  }
  return out;
}

export function createVoice(getCtx, getMaster) {
  let enabled = true;
  let lastSpokeAt = -99;
  let lastPhrase = '';
  const noiseCache = new WeakMap();

  function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(ctx, buf);
    }
    return buf;
  }

  /** 一个音节：声母噪声爆破 + 韵母双共振峰 + 音高包络 */
  function syllable(ctx, master, name, { start, dur, pitchA, pitchB, gain }) {
    const [initial, final] = SYLLABLES[name] ?? SYLLABLES[CN_DIGITS[1]];
    const [f1, f2] = VOWELS[final] ?? VOWELS.a;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitchA, start);
    osc.frequency.linearRampToValueAtTime(Math.max(40, pitchB), start + dur * 0.85);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, start);
    out.gain.linearRampToValueAtTime(gain, start + 0.018);
    out.gain.setValueAtTime(gain, start + dur * 0.62);
    out.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    for (const f of [f1, f2]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 7;
      const fg = ctx.createGain();
      fg.gain.value = 0.85;
      osc.connect(bp).connect(fg).connect(out);
    }
    // 一点干信号做"机器味"底子
    const dry = ctx.createGain();
    dry.gain.value = 0.05;
    osc.connect(dry).connect(out);
    out.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);

    if (initial) {
      const fric = ['s', 'sh', 'x', 'q', 'h'].includes(initial);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = fric ? 'highpass' : 'bandpass';
      bp.frequency.value = fric ? 2800 : 1500;
      bp.Q.value = fric ? 0.8 : 1.6;
      const g = ctx.createGain();
      const len = fric ? 0.055 : 0.02;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(gain * 0.5, start + 0.007);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
      src.connect(bp).connect(g).connect(master);
      src.start(start);
      src.stop(start + len + 0.01);
    }
  }

  function say(syllables, { pitch = 150, gain = 0.1, contour = null } = {}) {
    const ctx = getCtx();
    const master = getMaster();
    if (!ctx || !master || !enabled) return false;
    let t = ctx.currentTime + 0.01;
    const n = syllables.length;
    syllables.forEach((name, i) => {
      const dur = 0.125 * (name === 'shi' || name === 'zhan' ? 1.25 : 1);
      const k = n > 1 ? i / (n - 1) : 0;
      const p = contour ? contour(k) : 1;
      syllable(ctx, master, name, {
        start: t,
        dur,
        pitchA: pitch * p,
        pitchB: pitch * p * (contour ? 1 : 0.93),
        gain,
      });
      t += dur + 0.035;
    });
    return true;
  }

  const PHRASES = {
    wave: (wave) => ({ syllables: ['di', ...numberSyllables(wave), 'bo'], pitch: 138, gain: 0.085, contour: (k) => 0.94 + k * 0.1 }),
    clear: () => ({ syllables: ['qing', 'kong'], pitch: 175, gain: 0.085, contour: (k) => 0.95 + k * 0.4 }),
    overheat: () => ({ syllables: ['guo', 're'], pitch: 215, gain: 0.095, contour: (k) => 1.3 - k * 0.4 }),
    revive: () => ({ syllables: ['xin', 'hao'], pitch: 190, gain: 0.07, contour: (k) => 0.9 + k * 0.45 }),
    down: () => ({ syllables: ['duan', 'kai'], pitch: 150, gain: 0.09, contour: (k) => 1.15 - k * 0.4 }),
    lost: () => ({ syllables: ['zhan', 'dou', 'shi_bai'], pitch: 125, gain: 0.095, contour: (k) => 1.05 - k * 0.28 }),
    // 0.1% 大奖：拖长、压低、带一点失真感的"超载回满"
    jackpot: () => ({ syllables: ['chao', 'zai', 'hui', 'man'], pitch: 118, gain: 0.11, contour: (k) => 1.25 - k * 0.3 }),
  };

  return {
    get enabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      return enabled;
    },
    /** 直接说一串音节（调试/测试用） */
    say,
    /**
     * 战场播报，自带节流。
     * @param {'wave'|'clear'|'overheat'|'revive'|'down'|'lost'} kind
     */
    announce(kind, { wave = 0, now = 0, force = false } = {}) {
      if (!enabled) return false;
      const make = PHRASES[kind];
      if (!make) return false;
      if (!force && kind === lastPhrase && now - lastSpokeAt < 1.2) return false; // 同类播报不刷屏
      if (!force && now - lastSpokeAt < 0.45) return false; // 任意两条播报之间留口气
      const ok = say(make(wave).syllables, make(wave));
      if (ok) {
        lastSpokeAt = now;
        lastPhrase = kind;
      }
      return ok;
    },
  };
}
