// Sounds, all synthesized with WebAudio: no audio files, no network. Short
// noise bursts and oscillator blips, one function per game event. The context
// is created on the first user gesture (pointer lock); everything no-ops until
// then, and in headless capture there is simply no sound.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  // A burst of filtered noise: gunshots, explosions, footsteps of the UI.
  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
  }

  // A short tone: beeps, ticks, UI clicks.
  function tone(freq, duration, gainValue, slideTo = null) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    shoot(weapon) {
      if (weapon === 'sniper') noise(0.22, 900, 0.9);
      else if (weapon === 'smg') noise(0.07, 1800, 0.5);
      else noise(0.11, 1400, 0.7);
    },
    enemyShoot() { noise(0.09, 900, 0.25); },
    dryFire() { tone(1200, 0.05, 0.15); },
    reload() { tone(700, 0.06, 0.2); setTimeout(() => tone(500, 0.06, 0.2), 180); },
    hit(headshot) { tone(headshot ? 1900 : 1300, 0.07, 0.25); },
    kill() { tone(880, 0.09, 0.25); setTimeout(() => tone(1320, 0.12, 0.25), 90); },
    hurt() { noise(0.12, 500, 0.5); },
    plant() { tone(660, 0.1, 0.3); setTimeout(() => tone(660, 0.1, 0.3), 160); setTimeout(() => tone(990, 0.16, 0.3), 320); },
    beep() { tone(1100, 0.08, 0.3); },
    defuse() { tone(990, 0.1, 0.3); setTimeout(() => tone(1320, 0.14, 0.3), 150); },
    explosion() { noise(0.9, 220, 1.0); tone(55, 0.7, 0.6, 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.3), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.3), i * 130)); },
    buy() { tone(1560, 0.06, 0.2); },
    denied() { tone(220, 0.12, 0.25, 160); },
  };
}
