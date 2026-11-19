import type { StageFx } from '../game/stages/stage';

/**
 * All sound is synthesised at runtime with WebAudio: no files, no licences.
 * The context is created on the first user gesture (browser autoplay policy);
 * until then every call is a silent no-op.
 */
export function synth() {
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let noise: AudioBuffer | undefined;
  let enabled = true;
  let hum: { osc: OscillatorNode; gain: GainNode } | undefined;

  function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.55 : 0;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }

  // 'suspended' right after creation still schedules (it plays once resume() lands),
  // so the first countdown beep after page load is not lost.
  let paused = false;
  const live = () => (ctx && master && enabled && !paused && ctx.state !== 'closed' ? ctx : undefined);

  function envelope(gain: GainNode, at: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  function tone(freq: number, duration: number, type: OscillatorType, peak: number, slideTo?: number, delay = 0) {
    const c = live();
    if (!c) return;
    const at = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
    envelope(gain, at, peak, 0.005, duration);
    osc.connect(gain).connect(master!);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }

  function hiss(duration: number, filter: BiquadFilterType, freq: number, peak: number, sweepTo?: number, delay = 0) {
    const c = live();
    if (!c || !noise) return;
    const at = c.currentTime + delay;
    const source = c.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const biquad = c.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(freq, at);
    if (sweepTo) biquad.frequency.exponentialRampToValueAtTime(sweepTo, at + duration);
    const gain = c.createGain();
    envelope(gain, at, peak, 0.004, duration);
    source.connect(biquad).connect(gain).connect(master!);
    source.start(at, Math.random() * 0.5);
    source.stop(at + duration + 0.05);
  }

  function setHum(locked: boolean, lock: number) {
    const c = live();
    if (!c) return;
    if (!hum) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      gain.gain.value = 0;
      osc.connect(gain).connect(master!);
      osc.start();
      hum = { osc, gain };
    }
    hum.gain.gain.setTargetAtTime(locked ? 0.07 : 0, c.currentTime, 0.04);
    hum.osc.frequency.setTargetAtTime(220 + lock * 330, c.currentTime, 0.05);
  }

  function stopHum() {
    if (!hum || !ctx) return;
    hum.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    hum.osc.stop(ctx.currentTime + 0.2);
    hum = undefined;
  }

  return {
    unlock,
    setEnabled(value: boolean) {
      enabled = value;
      if (master && ctx) master.gain.setTargetAtTime(value ? 0.55 : 0, ctx.currentTime, 0.02);
      if (!value) stopHum();
    },
    fx(event: StageFx) {
      switch (event.type) {
        // Deliberately silent: a sound on the flash frame would be a faster cue
        // than the light (auditory reactions are ~40 ms quicker) and Lightning
        // measures visual reaction. The thunder answers the player's click instead.
        case 'flash': break;
        case 'reaction':
          hiss(0.14, 'highpass', 2500, 0.45);
          hiss(1.0, 'lowpass', 380, 0.4, 120, 0.05);
          tone(52, 0.8, 'sine', 0.3, 38, 0.05);
          break;
        case 'false-start': tone(196, 0.22, 'sawtooth', 0.12, 140); break;
        case 'drone-hit':
          tone(660 * event.multiplier, 0.09, 'square', 0.1, 1320 * event.multiplier);
          hiss(0.08, 'bandpass', 3000, 0.25);
          break;
        case 'drone-miss': tone(240, 0.05, 'triangle', 0.08); break;
        case 'drone-escape': hiss(0.28, 'bandpass', 2200, 0.25, 300); break;
        case 'comet': setHum(event.locked, event.lock); break;
        case 'comet-bonus':
          [880, 1320, 1760].forEach((f, i) => tone(f, 0.16, 'triangle', 0.14, undefined, i * 0.06));
          break;
        case 'clear': stopHum(); break;
      }
    },
    /** Operator pause / hidden tab: silence everything, including the comet hum. */
    suspend() {
      paused = true;
      stopHum();
      if (ctx?.state === 'running') void ctx.suspend();
    },
    resume() {
      paused = false;
      if (ctx?.state === 'suspended') void ctx.resume();
    },
    countdown(seconds: number) { tone(seconds > 0 ? 660 : 990, 0.12, 'square', 0.08); },
    go() { tone(990, 0.2, 'square', 0.1); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, undefined, i * 0.09)); },
    dispose() { stopHum(); void ctx?.close(); },
  };
}

export type Synth = ReturnType<typeof synth>;
