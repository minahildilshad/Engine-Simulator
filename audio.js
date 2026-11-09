/* audio.js — synthesized engine sound driven by RPM (Web Audio). */
window.EngineAudio = (function () {
  'use strict';
  let ctx = null, master, filter, oscs = [], noiseGain, enabled = false;

  function makeNoise(c) {
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2;
    [['sawtooth', 1, 0.5], ['sawtooth', 2, 0.28], ['square', 0.5, 0.35], ['triangle', 4, 0.12]].forEach(function (d) {
      const o = ctx.createOscillator(); o.type = d[0];
      const g = ctx.createGain(); g.gain.value = d[2];
      o.connect(g); g.connect(shaper); o.start();
      oscs.push({ o: o, mult: d[1] });
    });
    const n = makeNoise(ctx);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
    n.connect(nf); nf.connect(noiseGain); noiseGain.connect(shaper); n.start();
    shaper.connect(filter); filter.connect(master); master.connect(ctx.destination);
    return true;
  }

  function setEnabled(on) {
    if (on && !ctx && !init()) return false;
    enabled = on;
    if (ctx && on && ctx.state === 'suspended') ctx.resume();
    if (ctx && !on) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    return true;
  }

  // rpm = real engine rpm, throttle 0..1, firesPerRev = power strokes per crank turn, tone = brightness
  function update(rpm, throttle, firesPerRev, tone) {
    if (!ctx || !enabled) return;
    tone = tone || 1;
    const t = ctx.currentTime;
    const fire = Math.max(1, rpm / 60 * (firesPerRev || 2));
    oscs.forEach(function (x) { x.o.frequency.setTargetAtTime(fire * x.mult, t, 0.03); });
    filter.frequency.setTargetAtTime((220 + rpm * 0.55 + throttle * 900) * tone, t, 0.05);
    const vol = rpm < 20 ? 0 : 0.18 + 0.22 * throttle;
    master.gain.setTargetAtTime(vol, t, 0.08);
    noiseGain.gain.setTargetAtTime(0.05 + 0.5 * throttle * Math.min(1, rpm / 4000), t, 0.1);
  }

  return { setEnabled: setEnabled, update: update };
})();
