/* main.js — scene, camera, render loop, engine switching, labels, and wiring of engine + UI + audio. */
(function () {
  'use strict';
  const T = THREE;
  const $ = UI.$;
  const D2R = Math.PI / 180;

  // ---- renderer / scene ----
  const canvas = $('c');
  const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  scene.background = new T.Color(0x0a0c11);
  scene.fog = new T.FogExp2(0x0a0c11, 0.02);

  const camera = new T.PerspectiveCamera(38, 1, 0.1, 150);
  camera.position.set(7.5, 4.8, 9.5);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 45;
  controls.target.set(0, 1.4, 0);

  // procedural studio environment for metal reflections
  (function () {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#7b8aa3'); gr.addColorStop(0.5, '#222a36'); gr.addColorStop(1, '#07080b');
    x.fillStyle = gr; x.fillRect(0, 0, 1024, 512);
    x.fillStyle = 'rgba(255,255,255,.95)';
    x.fillRect(110, 60, 240, 70); x.fillRect(560, 40, 300, 90); x.fillRect(0, 180, 1024, 6);
    x.fillStyle = 'rgba(255,140,60,.85)';
    x.fillRect(400, 200, 110, 36); x.fillRect(850, 210, 80, 24);
    x.fillStyle = 'rgba(120,180,255,.7)';
    x.fillRect(250, 230, 90, 26);
    const tex = new T.CanvasTexture(c);
    tex.mapping = T.EquirectangularReflectionMapping;
    tex.encoding = T.sRGBEncoding;
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromEquirectangular(tex).texture;
    tex.dispose(); pm.dispose();
  })();

  const key = new T.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 14, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 15, bottom: -10, near: 1, far: 55 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new T.DirectionalLight(0xff8a3c, 0.9);
  rim.position.set(-8, 5, -7);
  scene.add(rim);
  scene.add(new T.HemisphereLight(0x8aa0c8, 0x10121a, 0.5));

  // floor
  const floor = new T.Group();
  const disc = new T.Mesh(new T.CircleGeometry(18, 64).rotateX(-Math.PI / 2),
    new T.MeshStandardMaterial({ color: 0x0d1016, roughness: 1, metalness: 0, envMapIntensity: 0.05 }));
  disc.receiveShadow = true;
  const grid = new T.GridHelper(36, 36, 0x2b3342, 0x1a1f2a);
  grid.position.y = 0.005;
  grid.material.transparent = true; grid.material.opacity = 0.6;
  floor.add(disc, grid);
  scene.add(floor);

  // ---- state ----
  const S = { running: false, rpm: 0, theta: 0, throttle: 0, timeScale: 0.05, explode: 0, explodeTarget: 0 };
  const IDLE = 850, MAX_RPM = 7000;
  let engine = null, selected = null, hovered = null;
  let camGoal = null, baseTarget = new T.Vector3(0, 1.4, 0), shift = new T.Vector3();
  let floorY = -1.7;
  let zoomFactor = 1;
  function zoomFor(t) { return 1 + (engine.explodeZoom - 1) * t; }

  function setHL() {
    Object.keys(engine.parts).forEach(function (k) {
      engine.setHighlight(k, k === selected ? 2 : k === hovered ? 1 : 0);
    });
    lblEls.forEach(function (el, k) { el.classList.toggle('sel', k === selected); });
  }

  function selectPart(k) {
    selected = k;
    UI.showPart(k ? engine.parts[k] : null);
    setHL();
  }

  // ---- labels ----
  const lblBox = $('labels');
  const lblEls = new Map();
  let lblAnchors = [], lblTick = 0, labelsOn = false;
  function rebuildLabels() {
    lblBox.innerHTML = '';
    lblEls.clear();
    Object.keys(engine.parts).forEach(function (k) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = engine.parts[k].name;
      el.addEventListener('click', function () { selectPart(k); });
      lblBox.appendChild(el);
      lblEls.set(k, el);
    });
    lblBox.style.display = labelsOn ? 'block' : 'none';
    lblAnchors = engine.labels();
  }
  const v3 = new T.Vector3();
  function updateLabels() {
    if (!labelsOn) return;
    if (++lblTick % 12 === 0) lblAnchors = engine.labels();
    const w = window.innerWidth, h = window.innerHeight;
    lblAnchors.forEach(function (a) {
      const el = lblEls.get(a.key);
      v3.copy(a.point).project(camera);
      if (v3.z > 1 || v3.z < -1) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.left = ((v3.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      el.style.top = ((-v3.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
    });
  }

  // ---- engine switching ----
  function disposeTree(o) {
    o.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(function (m) { m.dispose(); });
    });
  }
  function loadEngine(id) {
    if (engine) { scene.remove(engine.root); disposeTree(engine.root); }
    engine = Engine.create(id);
    scene.add(engine.root);
    engine.setCutaway($('cutaway').checked);
    engine.setExplode(S.explode);
    selected = hovered = null;
    UI.showPart(null);
    UI.setEngine(engine);
    S.theta = S.theta % engine.period;
    floorY = engine.floorY !== undefined ? engine.floorY : -1.7;
    baseTarget.fromArray(engine.cam.target);
    shift.fromArray(engine.explodeShift);
    zoomFactor = zoomFor(S.explode);
    camGoal = new T.Vector3().fromArray(engine.cam.pos).sub(baseTarget).multiplyScalar(zoomFactor).add(baseTarget);
    rebuildLabels();
    setHL();
  }

  const tabs = $('tabs');
  Engine.list().forEach(function (e, i) {
    const b = document.createElement('button');
    b.dataset.id = e.id;
    b.textContent = (i + 1) + ' · ' + e.name;
    b.addEventListener('click', function () { loadEngine(e.id); });
    tabs.appendChild(b);
  });

  // ---- controls ----
  const startBtn = $('startBtn');
  function setRunning(on) {
    S.running = on;
    startBtn.textContent = on ? 'STOP ENGINE' : 'START ENGINE';
    startBtn.classList.toggle('on', on);
    $('angle').disabled = on;
  }
  startBtn.addEventListener('click', function () { setRunning(!S.running); });
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); setRunning(!S.running); }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= Engine.ORDER.length) loadEngine(Engine.ORDER[n - 1]);
  });
  $('throttle').addEventListener('input', function (e) {
    S.throttle = e.target.value / 100;
    $('thrVal').textContent = e.target.value + '%';
  });
  $('angle').addEventListener('input', function (e) {
    if (!S.running) S.theta = e.target.value * D2R;
  });
  $('explode').addEventListener('input', function (e) {
    S.explodeTarget = e.target.value / 100;
    $('expVal').textContent = e.target.value + '%';
  });
  $('timeScale').addEventListener('change', function (e) { S.timeScale = parseFloat(e.target.value); });
  $('cutaway').addEventListener('change', function (e) { engine.setCutaway(e.target.checked); });
  $('showLabels').addEventListener('change', function (e) {
    labelsOn = e.target.checked;
    lblBox.style.display = labelsOn ? 'block' : 'none';
    if (labelsOn) lblAnchors = engine.labels();
  });
  $('sound').addEventListener('change', function (e) {
    if (!EngineAudio.setEnabled(e.target.checked)) e.target.checked = false;
  });
  setRunning(false);

  // ---- picking ----
  const ray = new T.Raycaster();
  const mouse = new T.Vector2();
  let downX = 0, downY = 0, hoverDirty = false;
  function setMouse(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }
  canvas.addEventListener('pointerdown', function (e) { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('pointerup', function (e) {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    setMouse(e);
    ray.setFromCamera(mouse, camera);
    selectPart(engine.pick(ray));
  });
  canvas.addEventListener('pointermove', function (e) { setMouse(e); hoverDirty = true; });

  // ---- resize ----
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- loop ----
  const clock = new T.Clock();
  const desired = new T.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);

    const target = S.running ? IDLE + S.throttle * (MAX_RPM - IDLE) : 0;
    S.rpm += (target - S.rpm) * (1 - Math.exp(-dt * (S.running ? 2.2 : 0.9)));
    if (!S.running && S.rpm < 5) S.rpm = 0;
    if (S.rpm > 0) S.theta = (S.theta + S.rpm / 60 * 2 * Math.PI * S.timeScale * dt) % engine.period;

    if (Math.abs(S.explode - S.explodeTarget) > 0.0005) {
      S.explode += (S.explodeTarget - S.explode) * (1 - Math.exp(-dt * 6));
      engine.setExplode(S.explode);
      // dolly out as the parts separate
      const f = zoomFor(S.explode);
      camera.position.sub(controls.target).multiplyScalar(f / zoomFactor).add(controls.target);
      zoomFactor = f;
    }
    floor.position.y = floorY - engine.floorDrop * S.explode;

    // camera: follow exploded-view shift, and glide to a new engine's default view
    desired.copy(baseTarget).addScaledVector(shift, S.explode);
    controls.target.lerp(desired, 1 - Math.exp(-dt * 6));
    if (camGoal) {
      camera.position.lerp(camGoal, 1 - Math.exp(-dt * 4));
      if (camera.position.distanceTo(camGoal) < 0.05) camGoal = null;
    }

    const strokes = engine.update(S.theta);
    const deg = S.theta / D2R;
    UI.setRpm(S.rpm);
    UI.setStrokes(strokes);
    UI.drawCycle(deg);
    if (S.rpm > 0) UI.setAngle(deg);
    EngineAudio.update(S.rpm, S.throttle, engine.firesPerRev, engine.tone);

    if (hoverDirty) {
      hoverDirty = false;
      ray.setFromCamera(mouse, camera);
      const h = engine.pick(ray);
      if (h !== hovered) { hovered = h; canvas.style.cursor = h ? 'pointer' : 'default'; setHL(); }
    }

    controls.update();
    renderer.render(scene, camera);
    updateLabels();
    requestAnimationFrame(frame);
  }

  // URL hash options (handy for sharing/testing): #v8,explode,labels,run,ang=120
  const opts = location.hash.replace('#', '').split(',').filter(Boolean);
  const startId = opts.filter(function (o) { return Engine.ORDER.indexOf(o) >= 0; })[0] || 'inline4';
  loadEngine(startId);
  camera.position.copy(camGoal); camGoal = null; controls.target.copy(baseTarget);
  opts.forEach(function (o) {
    if (o === 'explode') { S.explode = S.explodeTarget = 1; $('explode').value = 100; $('expVal').textContent = '100%'; engine.setExplode(1); controls.target.copy(baseTarget).add(shift); zoomFactor = zoomFor(1); camera.position.copy(new T.Vector3().fromArray(engine.cam.pos).sub(baseTarget).multiplyScalar(zoomFactor).add(baseTarget).add(shift)); }
    if (o === 'labels') { $('showLabels').checked = true; labelsOn = true; lblBox.style.display = 'block'; lblAnchors = engine.labels(); }
    if (o === 'solid') { $('cutaway').checked = false; engine.setCutaway(false); }
    if (o === 'run') { setRunning(true); S.throttle = 0.5; $('throttle').value = 50; $('thrVal').textContent = '50%'; }
    if (o.indexOf('ang=') === 0) S.theta = parseFloat(o.slice(4)) * D2R;
  });
  frame();

  window.__sim = { S: S, camera: camera, controls: controls, get engine() { return engine; } };
})();
