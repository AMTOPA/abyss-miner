// ---------- WebAudio 合成音效引擎（零素材文件） ----------
// 打磨目标：更饱满的钻机轰鸣、清脆矿石拾取、压迫感警报/灾难、
// 悠远氛围底噪、有质感的 UI 反馈，并利用 detune / StereoPanner 拓宽声场。

export type SfxName =
  | "click" | "hover" | "drill" | "drillStop" | "ore" | "combo" | "warning"
  | "accident" | "disaster" | "success" | "retreat" | "detector" | "support"
  | "milking" | "megaShield" | "powerLow" | "creature" | "anomaly" | "ambient"
  | "roomDiscover" | "moduleSelect" | "boss" | "evacWindow";

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur?: number;
  vol?: number;
  attack?: number;
  delay?: number;
  harmonics?: number[];                  // 泛音倍率列表
  detune?: number;                       // 失谐（音分）
  pan?: number;                          // 声像 -1..1
  vibrato?: { rate: number; depth: number }; // 颤音（频率 Hz / 深度 音分）
  glide?: "exp" | "linear";              // 频率滑变曲线，默认指数
}

interface NoiseOpts {
  dur?: number;
  vol?: number;
  f0?: number;
  f1?: number;
  delay?: number;
  type?: BiquadFilterType;
  Q?: number;
  pan?: number;
  attack?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private ambientNodes: { stop: () => void } | null = null;
  private drillNodes: { stop: () => void } | null = null;
  muted = false;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      // 轻压缩：让灾难/事故等大动态音效更厚实，同时防止削波
      try {
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -16;
        this.limiter.knee.value = 20;
        this.limiter.ratio.value = 10;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.2;
        this.master.connect(this.limiter).connect(ctx.destination);
      } catch {
        this.master.connect(ctx.destination);
      }
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  // ---- 基础工具 ----

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // 声像节点：不支持 StereoPanner 的环境退化为直通
  private panNode(pan: number): AudioNode {
    const ctx = this.ctx!;
    try {
      if (typeof ctx.createStereoPanner === "function") {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        return p;
      }
    } catch { /* 不支持则直通 */ }
    return ctx.createGain();
  }

  // 单声部振荡器：包络 + 失谐 + 颤音 + 声像
  private voice(opts: {
    type?: OscillatorType;
    f0: number;
    f1?: number;
    dur: number;
    vol: number;
    attack: number;
    t0: number;
    detune?: number;
    pan?: number;
    vibrato?: { rate: number; depth: number };
    glide?: "exp" | "linear";
  }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const { type = "sine", f0, f1, dur, vol, attack, t0, detune = 0, pan = 0, glide = "exp" } = opts;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 !== undefined) {
      const f1v = Math.max(1, f1);
      if (glide === "linear") osc.frequency.linearRampToValueAtTime(f1v, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(f1v, t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let tail: AudioNode = g;
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.vibrato.rate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = opts.vibrato.depth;
      lfo.connect(lfoGain).connect(osc.detune);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    if (pan !== 0) {
      const p = this.panNode(pan);
      g.connect(p);
      tail = p;
    }
    osc.connect(g);
    tail.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // 短促有源音：点击、拾取等
  private tone(opts: ToneOpts): void {
    if (!this.ctx || !this.master) return;
    const { type = "sine", f0, f1, dur = 0.15, vol = 0.3, attack = 0.005, delay = 0, harmonics, detune, pan, vibrato, glide } = opts;
    const t0 = this.ctx.currentTime + delay;
    this.voice({ type, f0, f1, dur, vol, attack, t0, detune, pan, vibrato, glide });
    if (harmonics) {
      for (const h of harmonics) {
        this.voice({
          type: "sine",
          f0: f0 * h,
          f1: f1 !== undefined ? f1 * h : undefined,
          dur,
          vol: (vol * 0.35) / h,
          attack,
          t0,
          detune,
          pan,
          vibrato,
          glide,
        });
      }
    }
  }

  // 一次性噪声：可选滤波类型 / Q / 声像
  private noise(opts: NoiseOpts): void {
    if (!this.ctx || !this.master) return;
    const { dur = 0.3, vol = 0.25, f0 = 800, f1 = 200, delay = 0, type = "lowpass", Q = 0.7, pan = 0, attack = 0.01 } = opts;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(this.ctx, dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(Math.max(20, f0), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g);
    let tail: AudioNode = g;
    if (pan !== 0) {
      const p = this.panNode(pan);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---- 钻机（连续循环，带平滑淡出） ----

  private startDrill(intensity: number): { stop: () => void } {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return { stop: () => {} };
    const t0 = ctx.currentTime;
    const fadeIn = 0.12;

    // 引擎轰鸣：两条失谐锯齿 + 低通（随 intensity 提高音高/音量）
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 180 + intensity * 140;
    const r1 = ctx.createOscillator();
    r1.type = "sawtooth";
    r1.frequency.value = 40 + intensity * 24;
    r1.detune.value = -9;
    const r2 = ctx.createOscillator();
    r2.type = "sawtooth";
    r2.frequency.value = 61 + intensity * 30;
    r2.detune.value = 11;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, t0);
    rumbleGain.gain.linearRampToValueAtTime(0.05 + intensity * 0.03, t0 + fadeIn);
    r1.connect(rumbleFilter);
    r2.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain).connect(master);

    // 钻头磨削：带通噪声，中心频率缓慢上扫
    const grindFilter = ctx.createBiquadFilter();
    grindFilter.type = "bandpass";
    grindFilter.Q.value = 1.4;
    const gf0 = 650 + intensity * 500;
    grindFilter.frequency.setValueAtTime(gf0, t0);
    grindFilter.frequency.linearRampToValueAtTime(gf0 * 1.6, t0 + 0.35);
    const grindGain = ctx.createGain();
    grindGain.gain.setValueAtTime(0.0001, t0);
    grindGain.gain.linearRampToValueAtTime(0.085 + intensity * 0.04, t0 + fadeIn);
    const gn = ctx.createBufferSource();
    gn.buffer = this.noiseBuffer(ctx, 1);
    gn.loop = true;
    gn.connect(grindFilter).connect(grindGain).connect(master);

    // 高频金属刮擦层
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "highpass";
    hissFilter.frequency.value = 4200;
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0.0001, t0);
    hissGain.gain.linearRampToValueAtTime(0.018 + intensity * 0.012, t0 + fadeIn);
    const hs = ctx.createBufferSource();
    hs.buffer = this.noiseBuffer(ctx, 1);
    hs.loop = true;
    hs.connect(hissFilter).connect(hissGain).connect(master);

    // 随机敲击：岩石被钻碎的不规则感
    let running = true;
    let nextHit = t0 + 0.1;
    const hitTimer = window.setInterval(() => {
      if (!running || ctx.currentTime < nextHit) return;
      nextHit = ctx.currentTime + 0.08 + Math.random() * 0.2;
      this.noise({
        dur: 0.05 + Math.random() * 0.05,
        vol: 0.028 + Math.random() * 0.04,
        f0: 280,
        f1: 90,
        type: "lowpass",
        pan: Math.random() * 0.5 - 0.25,
      });
      if (Math.random() < 0.45) {
        this.noise({
          dur: 0.03,
          vol: 0.02 + Math.random() * 0.02,
          f0: 3400,
          f1: 1500,
          type: "bandpass",
          Q: 2.5,
          pan: Math.random() * 0.6 - 0.3,
        });
      }
    }, 70);

    const nodes = [r1, r2, gn, hs];
    const gains = [rumbleGain, grindGain, hissGain];

    return {
      stop: () => {
        if (!running) return;
        running = false;
        window.clearInterval(hitTimer);
        const t = ctx.currentTime;
        // 平滑淡出
        for (const g of gains) {
          g.gain.cancelScheduledValues(t);
          const cur = Math.max(0.0001, g.gain.value);
          g.gain.setValueAtTime(cur, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        }
        for (const n of nodes) {
          try { n.stop(t + 0.18); } catch { /* noop */ }
        }
      },
    };
  }

  play(name: SfxName, intensity = 0.5): void {
    if (!this.ctx) return;
    const v = (x: number) => Math.min(1, x * (0.6 + intensity * 0.6));
    switch (name) {
      case "click":
        // 利落的 UI 触感：噪声“嗒”+ 高频微“咔”
        this.noise({ dur: 0.035, vol: v(0.1), f0: 3600, f1: 900, type: "bandpass", Q: 1.3, attack: 0.002 });
        this.tone({ type: "sine", f0: 1500 + Math.random() * 120, f1: 880, dur: 0.045, vol: v(0.07), attack: 0.001 });
        break;
      case "hover":
        this.tone({ type: "sine", f0: 660 + Math.random() * 80, f1: 860, dur: 0.06, vol: v(0.05), attack: 0.004 });
        break;
      case "drill":
        this.stopDrill();
        this.drillNodes = this.startDrill(intensity);
        break;
      case "drillStop":
        // 电机余转 + 磨削噪声衰减 + 停止后的余震撞击
        this.stopDrill();
        this.tone({ type: "sawtooth", f0: 190, f1: 56, dur: 0.36, vol: v(0.09), attack: 0.02, detune: -6 });
        this.tone({ type: "sawtooth", f0: 186, f1: 54, dur: 0.36, vol: v(0.08), attack: 0.02, detune: 7, delay: 0.02 });
        this.tone({ type: "sine", f0: 130, f1: 38, dur: 0.4, vol: v(0.16) });
        this.noise({ dur: 0.38, vol: v(0.13), f0: 1500, f1: 160, type: "lowpass", attack: 0.02 });
        this.tone({ type: "sine", f0: 95, f1: 45, dur: 0.16, vol: v(0.18), delay: 0.3 });
        this.noise({ dur: 0.14, vol: v(0.1), f0: 320, f1: 80, type: "lowpass", delay: 0.3 });
        break;
      case "ore": {
        // 清脆“叮”：基音 + 金属非谐泛音，音高随稀有度 + 轻微随机化
        const f = 620 * Math.pow(1.45, intensity * 7);
        const f0 = f * (1 + (Math.random() * 0.06 - 0.03));
        const pan = Math.random() * 0.8 - 0.4;
        this.tone({ type: "sine", f0, f1: f0 * 1.02, dur: 0.45, vol: v(0.15), attack: 0.002, pan, harmonics: [2.76, 5.4] });
        this.tone({ type: "sine", f0: f0 * 2, f1: f0 * 2.5, dur: 0.2, vol: v(0.08), attack: 0.002, pan: -pan * 0.5, delay: 0.01 });
        this.noise({ dur: 0.02, vol: v(0.05), f0: 6200, f1: 4200, type: "bandpass", Q: 1, pan, attack: 0.001 });
        break;
      }
      case "combo": {
        // 上行琶音（更明亮、带声像展开）
        const base = 440;
        for (let i = 0; i < 4; i++) {
          const f = base * Math.pow(1.26, i);
          this.tone({ type: "triangle", f0: f, dur: 0.12, vol: v(0.1), delay: i * 0.06, pan: i % 2 === 0 ? -0.2 : 0.2 });
          this.tone({ type: "sine", f0: f * 2, dur: 0.1, vol: v(0.04), delay: i * 0.06 });
        }
        break;
      }
      case "warning": {
        // 双声失谐警报（渐低）+ 低频下坠，压迫感
        const base = 300 + intensity * 50;
        const honk = (mult: number, delay: number) => {
          this.tone({ type: "square", f0: base * mult, f1: base * mult * 0.88, dur: 0.15, vol: v(0.12), detune: -14 });
          this.tone({ type: "square", f0: base * mult, f1: base * mult * 0.88, dur: 0.15, vol: v(0.12), detune: 14, delay: delay + 0.02 });
          this.tone({ type: "sine", f0: 92, f1: 54, dur: 0.2, vol: v(0.22), delay });
        };
        honk(1, 0);
        honk(0.84, 0.26);
        break;
      }
      case "accident":
        // 事故：低频冲击 + 轰鸣 + 金属碎裂
        this.tone({ type: "sine", f0: 150, f1: 36, dur: 0.5, vol: v(0.4) });
        this.noise({ dur: 0.45, vol: v(0.3), f0: 520, f1: 70, type: "lowpass", attack: 0.008 });
        this.noise({ dur: 0.14, vol: v(0.16), f0: 2400, f1: 480, type: "bandpass", Q: 1.2, delay: 0.02 });
        this.tone({ type: "sawtooth", f0: 92, f1: 30, dur: 0.5, vol: v(0.12), detune: -22 });
        break;
      case "disaster":
        // 灾难：低频下坠 + 失谐锯齿集群 + 渐强轰鸣 + 金属尖啸
        this.tone({ type: "sine", f0: 110, f1: 26, dur: 1.3, vol: v(0.5), attack: 0.02 });
        this.tone({ type: "sine", f0: 55, f1: 20, dur: 1.3, vol: v(0.34), attack: 0.02, detune: -28 });
        this.tone({ type: "sawtooth", f0: 190, f1: 32, dur: 1.2, vol: v(0.2), attack: 0.06, detune: -38 });
        this.tone({ type: "sawtooth", f0: 186, f1: 31, dur: 1.2, vol: v(0.2), attack: 0.06, detune: 42 });
        this.noise({ dur: 1.25, vol: v(0.5), f0: 750, f1: 30, type: "lowpass", attack: 0.4 });
        this.noise({ dur: 1.6, vol: v(0.28), f0: 240, f1: 25, type: "lowpass", attack: 0.7 });
        this.noise({ dur: 0.5, vol: v(0.12), f0: 3600, f1: 400, type: "bandpass", Q: 2, delay: 0.55 });
        break;
      case "success": {
        // 明亮上行琶音 + 结尾闪烁
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
        notes.forEach((f, i) => {
          const pan = i % 2 === 0 ? -0.22 : 0.22;
          this.tone({ type: "triangle", f0: f, f1: f * 1.01, dur: 0.26, vol: v(0.14), delay: i * 0.08, pan });
          this.tone({ type: "sine", f0: f * 2, dur: 0.2, vol: v(0.06), delay: i * 0.08, pan });
        });
        const end = notes.length * 0.08;
        this.tone({ type: "sine", f0: 2093, dur: 0.55, vol: v(0.05), delay: end, attack: 0.03 });
        this.noise({ dur: 0.16, vol: v(0.04), f0: 8000, f1: 5000, type: "bandpass", Q: 1, delay: end });
        break;
      }
      case "roomDiscover":
        // 房间发现：门锁弹开、短促空间扫描与远处金属回声。
        this.noise({ dur: 0.07, vol: v(0.08), f0: 2100, f1: 620, type: "bandpass", Q: 1.8, attack: 0.002, pan: -0.18 });
        this.tone({ type: "square", f0: 210, f1: 150, dur: 0.08, vol: v(0.08), delay: 0.025, pan: -0.12 });
        this.tone({ type: "sine", f0: 480, f1: 920, dur: 0.32, vol: v(0.1), delay: 0.08, glide: "linear", pan: 0.18, harmonics: [2.03] });
        this.tone({ type: "sine", f0: 920, f1: 610, dur: 0.38, vol: v(0.045), delay: 0.28, pan: -0.28 });
        break;
      case "moduleSelect":
        // 模组选择：插槽咔哒 + 两级确认音，强调“装配完成”。
        this.noise({ dur: 0.026, vol: v(0.08), f0: 4800, f1: 1800, type: "bandpass", Q: 1.5, attack: 0.001 });
        this.tone({ type: "square", f0: 180, f1: 120, dur: 0.055, vol: v(0.07), delay: 0.015 });
        this.tone({ type: "triangle", f0: 523.25, dur: 0.14, vol: v(0.09), delay: 0.055, pan: -0.12 });
        this.tone({ type: "triangle", f0: 783.99, dur: 0.2, vol: v(0.1), delay: 0.13, pan: 0.12, harmonics: [2] });
        break;
      case "boss":
        // Boss 现身：重型汽笛、低频冲击和缓慢金属刮擦。
        this.tone({ type: "sine", f0: 88, f1: 34, dur: 1.05, vol: v(0.38), attack: 0.015 });
        this.tone({ type: "sawtooth", f0: 138, f1: 72, dur: 0.82, vol: v(0.16), attack: 0.08, detune: -24 });
        this.tone({ type: "sawtooth", f0: 136, f1: 70, dur: 0.82, vol: v(0.14), attack: 0.08, detune: 27, delay: 0.025 });
        this.noise({ dur: 0.95, vol: v(0.19), f0: 980, f1: 90, type: "lowpass", attack: 0.26 });
        this.noise({ dur: 0.48, vol: v(0.075), f0: 3200, f1: 500, type: "bandpass", Q: 2.2, delay: 0.36, pan: 0.24 });
        break;
      case "evacWindow":
        // 模组选择：插槽咔哒 + 两级确认音，强调“装配完成”。????
        this.noise({ dur: 0.32, vol: v(0.075), f0: 1400, f1: 260, type: "bandpass", Q: 1.1, attack: 0.06, pan: -0.2 });
        this.tone({ type: "triangle", f0: 659.25, f1: 622.25, dur: 0.2, vol: v(0.1), delay: 0.04, pan: -0.12 });
        this.tone({ type: "triangle", f0: 880, f1: 830.61, dur: 0.26, vol: v(0.11), delay: 0.22, pan: 0.12, harmonics: [2] });
        this.tone({ type: "sine", f0: 110, f1: 72, dur: 0.34, vol: v(0.07), delay: 0.18 });
        break;
      case "retreat":
        // 上行呼啸：逃生感
        this.noise({ dur: 0.7, vol: v(0.18), f0: 220, f1: 2400, type: "bandpass", Q: 1.4, attack: 0.08 });
        this.tone({ type: "sine", f0: 260, f1: 780, dur: 0.55, vol: v(0.12), glide: "linear" });
        this.tone({ type: "sine", f0: 392, f1: 1046, dur: 0.4, vol: v(0.08), delay: 0.16, glide: "linear" });
        break;
      case "detector":
        // 声呐扫描：两连 ping + 回声
        this.tone({ type: "sine", f0: 820, f1: 1660, dur: 0.3, vol: v(0.15), glide: "linear", harmonics: [2] });
        this.tone({ type: "sine", f0: 820, f1: 1660, dur: 0.3, vol: v(0.09), delay: 0.15, glide: "linear", pan: 0.25 });
        this.tone({ type: "sine", f0: 410, f1: 830, dur: 0.35, vol: v(0.06), delay: 0.32, glide: "linear", pan: -0.25 });
        break;
      case "support":
        // 支撑架落地：闷响 + 金属锁定咔哒
        this.tone({ type: "sine", f0: 150, f1: 52, dur: 0.22, vol: v(0.26) });
        this.noise({ dur: 0.14, vol: v(0.2), f0: 900, f1: 220, type: "bandpass", Q: 1.2, attack: 0.005 });
        this.tone({ type: "square", f0: 250, f1: 180, dur: 0.06, vol: v(0.1), delay: 0.1 });
        this.tone({ type: "sine", f0: 720, f1: 480, dur: 0.1, vol: v(0.09), delay: 0.1, harmonics: [2.6] });
        break;
      case "milking":
        // 温和明亮的收益反馈
        this.tone({ type: "sine", f0: 780, f1: 980, dur: 0.3, vol: v(0.18), harmonics: [2, 3], pan: -0.2 });
        this.tone({ type: "triangle", f0: 1180, f1: 1320, dur: 0.22, vol: v(0.12), delay: 0.09, pan: 0.2 });
        this.tone({ type: "sine", f0: 1560, dur: 0.45, vol: v(0.06), delay: 0.15, attack: 0.03, pan: 0.1 });
        break;
      case "megaShield":
        // 护盾展开：能量升起 + 嗡鸣
        this.tone({ type: "sawtooth", f0: 180, f1: 720, dur: 0.5, vol: v(0.13), glide: "linear", detune: -8 });
        this.tone({ type: "sawtooth", f0: 184, f1: 726, dur: 0.5, vol: v(0.13), glide: "linear", detune: 10, delay: 0.03 });
        this.tone({ type: "triangle", f0: 220, f1: 880, dur: 0.45, vol: v(0.18), glide: "linear" });
        this.tone({ type: "triangle", f0: 330, f1: 1320, dur: 0.45, vol: v(0.12), glide: "linear", delay: 0.05, pan: 0.2 });
        this.tone({ type: "sine", f0: 440, dur: 0.6, vol: v(0.07), attack: 0.1, vibrato: { rate: 8, depth: 4 } });
        this.noise({ dur: 0.35, vol: v(0.08), f0: 3000, f1: 800, type: "bandpass", Q: 1.5, attack: 0.05 });
        break;
      case "powerLow":
        // 电量不足：急促双响 + 低频预警
        this.tone({ type: "square", f0: 620, f1: 560, dur: 0.09, vol: v(0.09) });
        this.tone({ type: "square", f0: 500, f1: 440, dur: 0.1, vol: v(0.09), delay: 0.16 });
        this.tone({ type: "sine", f0: 110, f1: 58, dur: 0.22, vol: v(0.09), delay: 0.16 });
        break;
      case "creature":
        // 地底生物：低沉咆哮（颤音失谐）+ 心跳脉冲 + 气息
        this.tone({ type: "sawtooth", f0: 110, f1: 52, dur: 0.9, vol: v(0.18), detune: -18, vibrato: { rate: 6, depth: 14 } });
        this.tone({ type: "sawtooth", f0: 108, f1: 55, dur: 0.9, vol: v(0.14), detune: 22, vibrato: { rate: 5, depth: 18 } });
        this.tone({ type: "sine", f0: 70, f1: 40, dur: 0.22, vol: v(0.18) });
        this.tone({ type: "sine", f0: 65, f1: 38, dur: 0.2, vol: v(0.16), delay: 0.3 });
        this.noise({ dur: 0.8, vol: v(0.07), f0: 420, f1: 120, type: "bandpass", Q: 1.2, delay: 0.1, pan: 0.3 });
        this.tone({ type: "sine", f0: 300, f1: 880, dur: 0.3, vol: v(0.05), delay: 0.55, attack: 0.09 });
        break;
      case "anomaly":
        // 深渊异常：反向上升扫频 + 颤音脉冲 + 低频心跳
        this.tone({ type: "sine", f0: 60, f1: 520, dur: 0.7, vol: v(0.16), glide: "linear", vibrato: { rate: 0.4, depth: 6 } });
        this.tone({ type: "sine", f0: 150, f1: 840, dur: 0.7, vol: v(0.1), delay: 0.08, glide: "linear", vibrato: { rate: 0.3, depth: 8 } });
        this.tone({ type: "triangle", f0: 92, f1: 68, dur: 0.9, vol: v(0.13), detune: 10, vibrato: { rate: 7, depth: 25 } });
        this.tone({ type: "sine", f0: 50, dur: 0.5, vol: v(0.11), delay: 0.15 });
        this.tone({ type: "sine", f0: 48, dur: 0.5, vol: v(0.09), delay: 0.45 });
        this.noise({ dur: 0.9, vol: v(0.06), f0: 600, f1: 150, type: "bandpass", Q: 1.6, delay: 0.2, pan: -0.3 });
        break;
      case "ambient":
        this.startAmbient();
        break;
      default:
        break;
    }
  }

  startAmbient(): void {
    if (this.ambientNodes || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const master = this.master;
    const t0 = ctx.currentTime;

    // 主低音嗡鸣：两条轻微失谐正弦产生缓慢拍频（极轻）
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 160;
    const drone1 = ctx.createOscillator();
    drone1.type = "sine";
    drone1.frequency.value = 46;
    const drone2 = ctx.createOscillator();
    drone2.type = "sine";
    drone2.frequency.value = 46.7;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.022;
    drone1.connect(droneFilter);
    drone2.connect(droneFilter);
    droneFilter.connect(droneGain).connect(master);

    // 缓慢 LFO：在安静与轻微起伏之间呼吸
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(droneGain.gain);

    // 地下风声：低通噪声 + 慢 LFO（极轻）
    const windGain = ctx.createGain();
    windGain.gain.value = 0.012;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 220;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.03;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.006;
    windLfo.connect(windLfoGain).connect(windGain.gain);
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer(ctx, 3);
    windSrc.loop = true;
    windSrc.connect(windFilter).connect(windGain).connect(master);

    drone1.start(t0);
    drone2.start(t0);
    lfo.start(t0);
    windLfo.start(t0);
    windSrc.start(t0);

    // 水滴：更稀疏、更轻，带随机声像
    const dripTimer = window.setInterval(() => {
      if (Math.random() < 0.45) {
        const p = Math.random() * 0.6 - 0.3;
        this.tone({ type: "sine", f0: 700 + Math.random() * 500, f1: 380, dur: 0.12, vol: 0.018, attack: 0.004, pan: p });
        this.tone({ type: "sine", f0: 1500 + Math.random() * 400, dur: 0.08, vol: 0.008, delay: 0.05, pan: p });
      }
    }, 5200);

    this.ambientNodes = {
      stop: () => {
        window.clearInterval(dripTimer);
        const t = ctx.currentTime;
        for (const o of [drone1, drone2, lfo, windLfo]) {
          try { o.stop(t); } catch { /* noop */ }
        }
        try { windSrc.stop(t); } catch { /* noop */ }
        droneGain.gain.setTargetAtTime(0.0001, t, 0.3);
        windGain.gain.setTargetAtTime(0.0001, t, 0.3);
      },
    };
  }

  stopAmbient(): void {
    if (this.ambientNodes) {
      this.ambientNodes.stop();
      this.ambientNodes = null;
    }
  }

  stopDrill(): void {
    if (this.drillNodes) {
      this.drillNodes.stop();
      this.drillNodes = null;
    }
  }
}
