/* ui.js — DOM controls, HUD, engine card and the stroke-cycle diagram. No 3D knowledge. */
window.UI = (function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const COLORS = { Power: '#ff7a1a', Exhaust: '#9aa0a8', Intake: '#6ec8ff', Compression: '#ffe08a' };

  const cycle = $('cycle');
  const g = cycle.getContext('2d');
  let rows = [], cycleDeg = 720, cylEls = [];

  function setEngine(eng) {
    rows = eng.rows;
    cycleDeg = eng.cycleDeg;
    $('engName').textContent = eng.meta.name;
    $('engTag').textContent = eng.meta.tagline;
    $('engHow').textContent = eng.meta.how;
    $('engCars').textContent = eng.meta.cars;
    $('engSpec').textContent = eng.meta.spec;
    $('angle').max = cycleDeg;
    $('cycleSub').textContent = '(' + cycleDeg + '° of shaft turn)';
    const box = $('cyls');
    box.innerHTML = '';
    box.className = 'cyls n' + rows.length;
    cylEls = rows.map(function (r) {
      const d = document.createElement('div');
      d.className = 'cyl';
      d.innerHTML = '<small>' + r.label + '</small><span>-</span>';
      box.appendChild(d);
      return { box: d, label: d.querySelector('span') };
    });
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.id === eng.meta.id); });
  }

  function drawCycle(deg) {
    const W = cycle.width, H = cycle.height, left = 30, top = 6, bottom = 14;
    const n = rows.length, gap = n > 4 ? 3 : 6;
    const rowH = Math.min(24, (H - top - bottom - gap * (n - 1)) / n);
    g.clearRect(0, 0, W, H);
    g.font = '10px Consolas, monospace';
    g.textBaseline = 'middle';
    const span = W - left - 8, seg = cycleDeg / 4;
    rows.forEach(function (r, i) {
      const y = top + i * (rowH + gap);
      g.fillStyle = '#8b93a3';
      g.fillText(r.label, 4, y + rowH / 2);
      for (let s = 0; s < 4; s++) {
        const start = (r.off + s * seg) % cycleDeg;
        g.fillStyle = COLORS[['Power', 'Exhaust', 'Intake', 'Compression'][s]];
        g.globalAlpha = 0.85;
        const x0 = left + start / cycleDeg * span, w = seg / cycleDeg * span;
        if (start + seg <= cycleDeg + 0.001) g.fillRect(x0 + 1, y, w - 2, rowH);
        else {
          const first = cycleDeg - start;
          g.fillRect(x0 + 1, y, first / cycleDeg * span - 1, rowH);
          g.fillRect(left, y, (seg - first) / cycleDeg * span - 1, rowH);
        }
        g.globalAlpha = 1;
      }
    });
    const mx = left + deg / cycleDeg * span;
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(mx, 2); g.lineTo(mx, H - 12); g.stroke();
    g.fillStyle = '#8b93a3';
    g.fillText('0', left, H - 5);
    g.textAlign = 'right'; g.fillText(cycleDeg + '°', W - 8, H - 5); g.textAlign = 'left';
  }

  function setStrokes(strokes) {
    for (let i = 0; i < cylEls.length && i < strokes.length; i++) {
      cylEls[i].label.textContent = strokes[i].name;
      cylEls[i].box.style.setProperty('--c', COLORS[strokes[i].name]);
    }
  }

  return {
    $: $,
    setEngine: setEngine,
    drawCycle: drawCycle,
    setStrokes: setStrokes,
    setRpm: function (rpm) { $('rpm').textContent = Math.round(rpm); },
    setAngle: function (deg) { $('angle').value = deg; $('angVal').textContent = Math.round(deg) + '°'; },
    showPart: function (p) {
      $('infoName').textContent = p ? p.name : 'Click a part';
      $('infoDesc').textContent = p ? p.desc : 'Select any component to see what it does. Hover to highlight it.';
    }
  };
})();
