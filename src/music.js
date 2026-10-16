// BGM 管理：双向交叉淡入淡出、按游戏状态选曲、独立音量。
//
// 用 HTMLAudioElement 而不是 WebAudio 解码：
//   - MP3 交给浏览器解码最省事，也天然支持流式播放（大文件不用一次读进内存）
//   - 混音层面已经够用：音乐音量独立于音效，切换时交叉淡化
//
// 选曲是纯函数（pickTrack），方便单测；播放本身才碰 DOM。

/**
 * 曲目表：都来自《解限机穿越小说》原创专辑（纯音乐版，适合当 BGM）。
 * 文件在 assets/music/ 下。
 */
export const TRACKS = {
  // 标题 / 结算：片尾曲，抒情，给"读文字"留空间
  ending: { id: 'ending', file: './assets/music/ending.mp3', label: '下个赛季见（片尾曲）', volume: 0.5 },
  // 常规战斗：主题曲，燃
  theme: { id: 'theme', file: './assets/music/theme.mp3', label: '解限（主题曲）', volume: 0.5 },
  // Boss 战：战斗曲《十七秒》，最快最爆的一首
  battle: { id: 'battle', file: './assets/music/battle.mp3', label: '十七秒（战斗曲·燃版）', volume: 0.55 },
};

/**
 * 该放哪首？——纯函数，输入游戏状态输出曲目 id（或 null = 不放）。
 * 规则：标题/结算放片尾曲，Boss 战放战斗曲，其余战斗放主题曲。
 */
export function pickTrack({ uiMode, dead = false, boss = false } = {}) {
  if (dead || uiMode === 'over' || uiMode === 'title' || uiMode === 'dying') return 'ending';
  if (uiMode === 'running' || uiMode === 'upgrade' || uiMode === 'paused') return boss ? 'battle' : 'theme';
  return null;
}

/** 该用多大音量？弹窗/暂停时压低，打架时给足 */
export function musicGain({ uiMode, dead = false } = {}) {
  if (dead || uiMode === 'over') return 0.75;
  if (uiMode === 'title') return 0.6;
  if (uiMode === 'paused' || uiMode === 'upgrade') return 0.45; // 选卡/暂停时让位给"读文字"
  return 1;
}

export function createMusic() {
  let enabled = true;
  let current = null; // 正在播的曲目 id
  let baseVolume = 0.5;
  const players = new Map(); // id -> { audio, target, fade }
  let unlocked = false;

  function player(id) {
    let p = players.get(id);
    if (p) return p;
    const track = TRACKS[id];
    const audio = new Audio(track.file);
    audio.loop = true; // 单曲循环：一局 2–5 分钟，正好铺满
    audio.preload = 'auto';
    audio.volume = 0;
    // 有些浏览器要显式 load 才会开始缓冲
    try {
      audio.load();
    } catch {
      /* 无所谓 */
    }
    p = { id, audio, target: 0 };
    players.set(id, p);
    return p;
  }

  /** 每帧朝目标音量靠拢，做出淡入淡出 */
  function ramp(dt) {
    for (const p of players.values()) {
      const want = enabled ? Math.min(1, p.target * baseVolume) : 0;
      const diff = want - p.audio.volume;
      if (Math.abs(diff) < 0.002) {
        p.audio.volume = want;
        if (want === 0 && !p.audio.paused) p.audio.pause();
        continue;
      }
      // 淡出比淡入稍快，避免两首歌糊在一起
      const rate = diff < 0 ? 1.6 : 0.9;
      p.audio.volume = Math.max(0, Math.min(1, p.audio.volume + diff * Math.min(1, dt * rate)));
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    get current() {
      return current;
    },
    get trackLabel() {
      return current ? TRACKS[current].label : null;
    },
    get volume() {
      return baseVolume;
    },

    /** 第一次用户手势后解锁播放（浏览器自动播放策略） */
    unlock() {
      unlocked = true;
    },

    toggle() {
      enabled = !enabled;
      if (enabled && unlocked && current) {
        const p = player(current);
        p.audio.play().catch(() => {});
      }
      return enabled;
    },

    /** 音量 0–1（M 已经是静音总开关，这里只调音乐相对音量） */
    setVolume(v) {
      baseVolume = Math.max(0, Math.min(1, Number(v) || 0));
      return baseVolume;
    },

    /**
     * 每帧调用：决定该放什么、该多大声。
     * @param {{uiMode:string, dead?:boolean}} state
     */
    update(state, dt) {
      const want = enabled ? pickTrack(state) : null;
      const gain = musicGain(state);

      if (want !== current) {
        if (current) player(current).target = 0;
        current = want;
        if (want) {
          const p = player(want);
          p.target = gain;
          if (unlocked && p.audio.paused) {
            p.audio.play().catch(() => {
              /* 没解锁就等下一次手势，ramp 会保持音量为 0 */
            });
          }
        }
      } else if (current) {
        player(current).target = gain;
      }
      ramp(dt);
    },

    /** 页面切走时停一下，省电也避免"后台还在响" */
    suspend() {
      for (const p of players.values()) p.audio.pause();
    },
    resume(state) {
      const want = pickTrack(state);
      if (want && enabled) {
        const p = player(want);
        p.target = musicGain(state);
        if (unlocked) p.audio.play().catch(() => {});
      }
    },
    dispose() {
      for (const p of players.values()) {
        p.audio.pause();
        p.audio.src = '';
      }
      players.clear();
      current = null;
    },

    /** 诊断用：真实的播放状态（调试钩子/自动化测试读这个） */
    debug() {
      const out = { current, enabled, volume: baseVolume, tracks: {} };
      for (const [id, p] of players) {
        out.tracks[id] = {
          paused: p.audio.paused,
          time: Number(p.audio.currentTime.toFixed(2)),
          volume: Number(p.audio.volume.toFixed(3)),
          duration: Number.isFinite(p.audio.duration) ? Number(p.audio.duration.toFixed(1)) : null,
          readyState: p.audio.readyState,
          error: p.audio.error ? p.audio.error.code : null,
        };
      }
      return out;
    },
  };
}
