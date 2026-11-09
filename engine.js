/* engine.js — shared kit + parametric piston-engine builder (inline-4, flat-4, V8).
   Rotary lives in rotary.js. Both expose the same engine interface:
   { root, parts, update(theta)->strokes[], setExplode, setCutaway, setHighlight, pick, labels,
     period, cycleDeg, rows, firing, firesPerRev, tone, cam, explodeShift, floorDrop, meta } */
(function () {
  'use strict';
  const T = THREE;
  const D2R = Math.PI / 180;

  // ---- piston geometry constants ----
  const R = 0.4;                 // crank radius (stroke = 2R)
  const L = 1.4;                 // connecting rod length
  const DECK = 2.3;              // head gasket plane (bank-local y)
  const THROW_X = [-1.8, -0.6, 0.6, 1.8];
  const CAM_Y = 3.54, CAM_Z = 0.3, VALVE_DX = 0.22;
  const INT_PEAK = 450, EXH_PEAK = 270, VDUR = 200, LIFT = 0.12;

  const STROKE_NAMES = ['Power', 'Exhaust', 'Intake', 'Compression'];
  const STROKE_HEX = { Power: 0xff7a1a, Exhaust: 0x9aa0a8, Intake: 0x6ec8ff, Compression: 0xffe08a };

  const mod = (a, n) => ((a % n) + n) % n;
  const cylX = (r, h, seg) => new T.CylinderGeometry(r, r, h, seg || 32).rotateZ(Math.PI / 2);
  const cylZ = (r, h, seg) => new T.CylinderGeometry(r, r, h, seg || 32).rotateX(Math.PI / 2);

  function lift(phi, peak) {
    const d = phi - (peak - VDUR / 2);
    if (d <= 0 || d >= VDUR) return 0;
    return LIFT * Math.pow(Math.sin(Math.PI * d / VDUR), 1.4);
  }

  // =========================================================================
  // kit: parts registry, materials, casings (cutaway), explode, highlight, pick
  // =========================================================================
  function kit(info, offs, casingKeys) {
    const root = new T.Group();
    const parts = {};
    const casings = [];
    const edgeLines = [];
    let explode = 0, cutaway = true;

    Object.keys(info).forEach(function (k) {
      parts[k] = { key: k, name: info[k][0], desc: info[k][1], mats: [], groups: [] };
    });

    function group(key, parent, off) {
      const g = new T.Group();
      (parent || root).add(g);
      parts[key].groups.push({ g: g, off: new T.Vector3().fromArray(off || offs[key] || [0, 0, 0]) });
      return g;
    }
    function mat(key, color, metal, rough, extra) {
      const m = new T.MeshStandardMaterial(Object.assign({ color: color, metalness: metal, roughness: rough, envMapIntensity: 1.2 }, extra || {}));
      parts[key].mats.push(m);
      return m;
    }
    function mesh(geo, m, key, parent, shadow) {
      const o = new T.Mesh(geo, m);
      o.userData.part = key;
      o.castShadow = shadow !== false;
      parent.add(o);
      return o;
    }
    function casing(key, geo, pos, m, level, parent) {
      const o = mesh(geo, m, key, parent, false);
      o.position.copy(pos);
      const l = new T.LineSegments(new T.EdgesGeometry(geo, 25), new T.LineBasicMaterial({ color: 0x9db2cf, transparent: true, opacity: 0.5 }));
      l.position.copy(pos);
      l.raycast = function () {};
      parent.add(l);
      edgeLines.push(l);
      casings.push({ mat: m, level: level });
      return o;
    }
    function applyOffsets() {
      Object.keys(parts).forEach(function (k) {
        parts[k].groups.forEach(function (e) { e.g.position.copy(e.off).multiplyScalar(explode); });
      });
    }
    function setExplode(t) { explode = t; applyOffsets(); }
    function setCutaway(on) {
      cutaway = !!on;
      casings.forEach(function (c) {
        c.mat.opacity = cutaway ? c.level : 1;
        c.mat.depthWrite = !cutaway;
        c.mat.needsUpdate = true;
      });
      edgeLines.forEach(function (l) { l.visible = cutaway; });
    }
    function setHighlight(key, level) {
      if (!parts[key]) return;
      const hex = level === 2 ? 0xb04a00 : level === 1 ? 0x4a2200 : 0x000000;
      parts[key].mats.forEach(function (m) { if (m.emissive) m.emissive.setHex(hex); });
    }
    function pick(raycaster) {
      const hits = raycaster.intersectObjects(root.children, true);
      let casingHit = null;
      for (let i = 0; i < hits.length; i++) {
        const key = hits[i].object.userData.part;
        if (!key || !hits[i].object.visible) continue;
        if (cutaway && casingKeys.indexOf(key) >= 0) { if (!casingHit) casingHit = key; continue; }
        return key;
      }
      return casingHit;
    }
    const box = new T.Box3(), tmp = new T.Box3();
    function labels() {
      root.updateMatrixWorld(true);
      return Object.keys(parts).map(function (k) {
        box.makeEmpty();
        parts[k].groups.forEach(function (e) { tmp.setFromObject(e.g); box.union(tmp); });
        return { key: k, name: parts[k].name, point: box.getCenter(new T.Vector3()) };
      });
    }
    return { root: root, parts: parts, group: group, mat: mat, mesh: mesh, casing: casing,
      setExplode: setExplode, setCutaway: setCutaway, setHighlight: setHighlight, pick: pick, labels: labels };
  }

  // =========================================================================
  // piston engine part texts
  // =========================================================================
  const PISTON_INFO = {
    block: ['Engine Block', 'The main casting. It holds the cylinder bores and the coolant passages, and it supports the whole engine.'],
    crankcase: ['Crankcase', 'The lower half of the block. It holds the main bearings that carry the crankshaft and keeps the oil in.'],
    pan: ['Oil Pan', 'The sump under the crankcase. It stores engine oil, which the pump sends to the bearings, cylinder walls and cams.'],
    piston: ['Pistons', 'Each piston slides in its bore. The burning mixture pushes it down in the power stroke. Piston rings seal the gap against the cylinder wall. Stroke = twice the crank radius.'],
    rod: ['Connecting Rods', 'Link each piston to the crankshaft and turn the straight-line motion of the pistons into rotation.'],
    crank: ['Crankshaft', 'Turns the pistons\' push into rotation. The angles between its throws decide when each cylinder fires. Counterweights balance the moving mass. It makes two turns for each full 4-stroke cycle.'],
    flywheel: ['Flywheel', 'A heavy disc on the crank. It stores energy to carry the engine through the three non-power strokes and smooths out the pulses. A starter motor engages its ring gear.'],
    pulley: ['Crank Pulley', 'Drives the belt for the alternator, water pump and other accessories.'],
    head: ['Cylinder Head', 'Closes the top of the cylinders and forms the combustion chambers. It holds the valve seats, the spark plugs and the intake and exhaust ports.'],
    cover: ['Valve Cover', 'Seals the top of the head and keeps oil around the valve train.'],
    valves: ['Valves & Springs', 'Two intake (blue) and two exhaust (orange) valves per cylinder. The cams push them open and the springs close them again.'],
    cams: ['Camshafts', 'A dual-overhead-cam layout. Each camshaft turns at half crank speed and its lobes open the valves at the right moment.'],
    plug: ['Spark Plugs', 'Ignite the compressed air-fuel mixture just before top dead centre. Watch them flash at the start of each power stroke.'],
    intake: ['Intake Manifold', 'Feeds air to the cylinders through the intake ports. The throttle controls how much air gets in.'],
    exhaust: ['Exhaust Manifold', 'Collects the burnt gas from the exhaust ports and sends it to the exhaust system.']
  };

  const BASE_OFFS = {
    block: [0, 2.4, 0], crankcase: [0, -1.6, 0], pan: [0, -1.6, 0], piston: [0, 0, 0], rod: [0, 0, 0], crank: [0, 0, 0],
    flywheel: [1.6, 0, 0], pulley: [-1.6, 0, 0], head: [0, 3.4, 0], valves: [0, 4.4, 0],
    plug: [0, 4.4, 0], cams: [0, 5.4, 0], cover: [0, 7.0, 0], intake: [0, 3.4, 1.9], exhaust: [0, 3.4, -1.9]
  };

  // =========================================================================
  // configs
  // =========================================================================
  const CONFIGS = {
    inline4: {
      id: 'inline4', kind: 'piston', name: 'Inline-4', tagline: 'Four cylinders in a straight line',
      cars: 'Honda Civic · Toyota Corolla · VW Golf', split: false, rodW: 0.44,
      how: 'All four cylinders sit in one row above a flat-plane crankshaft. Pistons 1 and 4 rise while 2 and 3 fall, so a power stroke fires every 180°. It is compact, cheap and efficient. The pistons moving up and down make it shake at twice engine speed.',
      phase: [0, Math.PI, Math.PI, 0],
      banks: [{ beta: 0, dx: 0 }],
      cyls: [{ t: 0, b: 0, off: 0 }, { t: 1, b: 0, off: 540 }, { t: 2, b: 0, off: 180 }, { t: 3, b: 0, off: 360 }],
      cam: { pos: [7.5, 4.8, 9.5], target: [0, 1.4, 0] }, explodeZoom: 1.8, explodeShift: [0, 3.4, 0], floorDrop: 1.6, tone: 1, subtitle: 'DOHC 16V'
    },
    flat4: {
      id: 'flat4', kind: 'piston', name: 'Flat-4 (Boxer)', tagline: 'Cylinders lie flat and face each other',
      cars: 'Subaru WRX · Subaru BRZ · Porsche 718 · VW Beetle', split: true, rodW: 0.44,
      how: 'Two banks of cylinders lie on either side of the crankshaft. Pistons on opposite sides move outward and inward together, like a boxer\'s punches, so their shaking cancels out. The engine is short, wide and low, which keeps the car\'s centre of gravity down.',
      phase: [0, Math.PI, Math.PI, 0],
      banks: [{ beta: Math.PI / 2, dx: 0 }, { beta: -Math.PI / 2, dx: 0 }],
      cyls: [{ t: 0, b: 0, off: 90 }, { t: 1, b: 1, off: 450 }, { t: 2, b: 0, off: 270 }, { t: 3, b: 1, off: 630 }],
      cam: { pos: [9, 6.5, 11.5], target: [0, 0.4, 0] }, explodeZoom: 1.5, explodeShift: [0, 0, 0], floorDrop: 3.0, tone: 0.85, subtitle: 'DOHC 16V'
    },
    v8: {
      id: 'v8', kind: 'piston', name: 'V8 (cross-plane)', tagline: 'Eight cylinders in two banks at 90°',
      cars: 'Ford Mustang GT · Chevrolet Corvette · Dodge Challenger', split: true, rodW: 0.28,
      how: 'Two banks of four cylinders form a V and share one four-throw crankshaft, so each crank pin drives two pistons. The throws are 90° apart, which gives a power stroke every 90°. The result is smooth power and the typical V8 rumble.',
      phase: [0, Math.PI / 2, 3 * Math.PI / 2, Math.PI],
      banks: [{ beta: Math.PI / 4, dx: -0.15 }, { beta: -Math.PI / 4, dx: 0.15 }],
      cyls: [
        { t: 0, b: 0, off: 45 }, { t: 1, b: 0, off: 315 }, { t: 2, b: 0, off: 135 }, { t: 3, b: 0, off: 225 },
        { t: 0, b: 1, off: 675 }, { t: 1, b: 1, off: 585 }, { t: 2, b: 1, off: 405 }, { t: 3, b: 1, off: 495 }
      ],
      cam: { pos: [9, 6, 12.5], target: [0, 1.6, 0] }, explodeZoom: 2.1, explodeShift: [0, 1.2, 0], floorDrop: 3.0, tone: 0.65, subtitle: 'DOHC 32V'
    }
  };

  function firingOrder(offs) {
    return offs.map(function (o, i) { return { o: o, n: i + 1 }; })
      .sort(function (a, b) { return a.o - b.o; })
      .map(function (x) { return x.n; }).join('-');
  }

  // =========================================================================
  // piston builder
  // =========================================================================
  function buildPiston(cfg) {
    const info = Object.assign({}, PISTON_INFO);
    if (!cfg.split) delete info.crankcase;
    const offs = Object.assign({}, BASE_OFFS);
    if (cfg.split) offs.pan = [0, -3.0, 0];
    const K = kit(info, offs, ['block', 'crankcase', 'head', 'cover', 'pan']);
    const root = K.root, mat = K.mat, mesh = K.mesh;

    const BANK_KEYS = ['block', 'head', 'cover', 'valves', 'cams', 'plug', 'intake', 'exhaust'];
    const banks = cfg.banks.map(function (b) {
      const g = new T.Group();
      g.position.x = b.dx;
      g.rotation.x = b.beta;
      root.add(g);
      const side = b.beta > 0 ? -1 : 1;          // intake side faces the valley
      const sg = {};
      BANK_KEYS.forEach(function (k) {
        const off = offs[k].slice();
        if (k === 'intake') off[2] = off[2] * side;
        if (k === 'exhaust') off[2] = off[2] * side;
        sg[k] = K.group(k, g, off);
      });
      return { beta: b.beta, dx: b.dx, side: side, g: g, sg: sg };
    });

    // ---- casings ----
    const blockMat = mat('block', 0x6d7683, 0.85, 0.38, { transparent: true });
    const headMat = mat('head', 0x7a8493, 0.85, 0.35, { transparent: true });
    const coverMat = mat('cover', 0x8a2a14, 0.5, 0.45, { transparent: true });
    const panMat = mat('pan', 0x3d434d, 0.7, 0.5, { transparent: true });
    const linerMat = mat('block', 0xaab4c4, 0.9, 0.3, { transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false });
    const inMat = mat('intake', 0x3a6ea8, 0.7, 0.4);
    const exMat = mat('exhaust', 0x5a4538, 0.75, 0.5);

    K.casing('pan', new T.BoxGeometry(4.8, 0.7, 1.2), new T.Vector3(0, -1.25, 0), panMat, 0.3, K.group('pan', root));
    if (cfg.split) {
      K.casing('crankcase', new T.BoxGeometry(5.0, 1.8, 1.8), new T.Vector3(0, 0, 0), mat('crankcase', 0x6d7683, 0.85, 0.38, { transparent: true }), 0.16, K.group('crankcase', root));
    }

    const cylInBank = banks.map(function (b, bi) {
      return cfg.cyls.map(function (c, i) { return { c: c, i: i }; }).filter(function (e) { return e.c.b === bi; });
    });

    banks.forEach(function (b, bi) {
      const sg = b.sg;
      if (cfg.split) K.casing('block', new T.BoxGeometry(5.0, 1.7, 1.4), new T.Vector3(0, 1.45, 0), blockMat, 0.16, sg.block);
      else K.casing('block', new T.BoxGeometry(5.0, 3.2, 1.4), new T.Vector3(0, 0.7, 0), blockMat, 0.16, sg.block);
      K.casing('head', new T.BoxGeometry(5.0, 0.7, 1.4), new T.Vector3(0, 2.65, 0), headMat, 0.22, sg.head);
      K.casing('cover', new T.BoxGeometry(4.9, 1.0, 1.2), new T.Vector3(0, 3.5, 0), coverMat, 0.16, sg.cover);

      // manifold: plenum + runners
      const plenum = mesh(cylX(0.28, 4.6), inMat, 'intake', sg.intake); plenum.position.set(0, 2.75, b.side * 1.2);
      const exPipe = mesh(cylX(0.2, 4.6), exMat, 'exhaust', sg.exhaust); exPipe.position.set(0, 2.75, -b.side * 1.15);
      THROW_X.forEach(function (x) {
        mesh(cylZ(0.14, 0.5), inMat, 'intake', sg.intake).position.set(x, 2.75, b.side * 0.95);
        mesh(cylZ(0.12, 0.5), exMat, 'exhaust', sg.exhaust).position.set(x, 2.75, -b.side * 0.95);
      });
      [-2.3, 2.3].forEach(function (x) { mesh(cylX(0.32, 0.12), inMat, 'intake', sg.intake).position.set(x, 2.75, b.side * 1.2); });

      cylInBank[bi].forEach(function (e) {
        const lx = THROW_X[e.c.t];
        const l = mesh(new T.CylinderGeometry(0.5, 0.5, 1.7, 40, 1, true), linerMat, 'block', sg.block, false);
        l.position.set(lx, 1.45, 0);
      });
    });

    // ---- crankshaft ----
    const crankRot = new T.Group();
    K.group('crank', root).add(crankRot);
    const crankMat = mat('crank', 0xb7bcc6, 0.95, 0.22);
    const cwMat = mat('crank', 0x8a929e, 0.9, 0.3);
    [-2.4, -1.2, 0, 1.2, 2.4].forEach(function (x) { mesh(cylX(0.2, 0.6), crankMat, 'crank', crankRot).position.x = x; });
    const wg = {
      disc: cylX(0.3, 0.12), pinDisc: cylX(0.22, 0.12), arm: new T.BoxGeometry(0.12, R, 0.4),
      cw: new T.CylinderGeometry(0.55, 0.55, 0.12, 28, 1, false, Math.PI, Math.PI).rotateZ(Math.PI / 2), pin: cylX(0.18, 0.6)
    };
    cfg.phase.forEach(function (ph, t) {
      const x = THROW_X[t];
      mesh(wg.pin, crankMat, 'crank', crankRot).position.set(x, R * Math.cos(ph), R * Math.sin(ph));
      [-0.3, 0.3].forEach(function (dx) {
        const w = new T.Group();
        w.rotation.x = ph; w.position.x = x + dx;
        crankRot.add(w);
        mesh(wg.disc, cwMat, 'crank', w);
        mesh(wg.pinDisc, cwMat, 'crank', w).position.y = R;
        mesh(wg.arm, cwMat, 'crank', w).position.y = R / 2;
        mesh(wg.cw, cwMat, 'crank', w);
      });
    });

    // ---- flywheel & pulley ----
    const fwRot = new T.Group(); fwRot.position.x = 2.85; K.group('flywheel', root).add(fwRot);
    const fwMat = mat('flywheel', 0x5d6470, 0.9, 0.35), fwRing = mat('flywheel', 0xc2a06a, 0.9, 0.3), fwDark = mat('flywheel', 0x15181d, 0.4, 0.7);
    mesh(cylX(0.92, 0.3, 64), fwMat, 'flywheel', fwRot);
    mesh(cylX(1.0, 0.14, 64), fwRing, 'flywheel', fwRot);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      mesh(cylX(0.13, 0.34, 20), fwDark, 'flywheel', fwRot).position.set(0, 0.55 * Math.cos(a), 0.55 * Math.sin(a));
    }
    mesh(cylX(0.26, 0.4, 24), fwRing, 'flywheel', fwRot).position.x = 0.05;
    const puRot = new T.Group(); puRot.position.x = -2.85; K.group('pulley', root).add(puRot);
    const puMat = mat('pulley', 0x2a2e36, 0.8, 0.35), puAcc = mat('pulley', 0xff7a1a, 0.4, 0.4);
    mesh(cylX(0.5, 0.3, 40), puMat, 'pulley', puRot);
    mesh(cylX(0.54, 0.06, 40), puMat, 'pulley', puRot).position.x = -0.12;
    mesh(cylX(0.54, 0.06, 40), puMat, 'pulley', puRot).position.x = 0.12;
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      mesh(cylX(0.08, 0.34, 16), puAcc, 'pulley', puRot).position.set(0, 0.3 * Math.cos(a), 0.3 * Math.sin(a));
    }
    mesh(new T.BoxGeometry(0.34, 0.1, 0.06), puAcc, 'pulley', puRot).position.set(0, 0.5, 0);

    // ---- pistons, rods, charge ----
    const pistRoot = K.group('piston', root), rodRoot = K.group('rod', root);
    const pistMat = mat('piston', 0xcfd3da, 0.9, 0.25), ringMat = mat('piston', 0x23262c, 0.8, 0.4), pinMat = mat('piston', 0x8e949e, 0.95, 0.2);
    const rodMat = mat('rod', 0x9097a3, 0.9, 0.3), rodDark = mat('rod', 0x4a4f58, 0.85, 0.35);
    const pistonGeo = new T.CylinderGeometry(0.455, 0.455, 0.7, 36), ringGeo = new T.CylinderGeometry(0.465, 0.465, 0.035, 36);
    const gpinGeo = cylX(0.1, Math.min(0.78, cfg.rodW + 0.3), 20), crownGeo = new T.CylinderGeometry(0.37, 0.4, 0.04, 32);
    const beamGeo = new T.BoxGeometry(Math.min(0.14, cfg.rodW * 0.5), L - 0.4, 0.1);
    const bigGeo = cylX(0.27, cfg.rodW, 32), smallGeo = cylX(0.15, cfg.rodW, 24), capGeo = new T.BoxGeometry(cfg.rodW, 0.2, 0.42);
    const chargeGeo = new T.CylinderGeometry(0.45, 0.45, 1, 32, 1, true);

    const cyl = cfg.cyls.map(function (c, i) {
      const bk = banks[c.b];
      const x = THROW_X[c.t] + bk.dx;
      const pg = new T.Group(); pg.position.x = x; pg.rotation.x = bk.beta; pistRoot.add(pg);
      mesh(pistonGeo, pistMat, 'piston', pg).position.y = -0.05;
      [0.24, 0.17, 0.1].forEach(function (y) { mesh(ringGeo, ringMat, 'piston', pg).position.y = y; });
      mesh(crownGeo, ringMat, 'piston', pg).position.y = 0.3;
      mesh(gpinGeo, pinMat, 'piston', pg);
      const rg = new T.Group(); rg.position.x = x; rodRoot.add(rg);
      mesh(beamGeo, rodMat, 'rod', rg).position.y = L / 2;
      mesh(bigGeo, rodMat, 'rod', rg);
      mesh(smallGeo, rodMat, 'rod', rg).position.y = L;
      mesh(capGeo, rodDark, 'rod', rg).position.y = -0.2;
      const chMat = new T.MeshBasicMaterial({ color: 0x6ec8ff, transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide });
      const ch = new T.Mesh(chargeGeo, chMat);
      ch.raycast = function () {};
      ch.rotation.x = bk.beta;
      pistRoot.add(ch);
      return { c: c, bk: bk, x: x, piston: pg, rod: rg, charge: ch, chMat: chMat, valves: [], springs: [], tipMat: null };
    });

    // ---- valves, springs, cams, plugs (per bank, bank-local frame) ----
    const vMatI = mat('valves', 0x4aa3ff, 0.9, 0.25), vMatE = mat('valves', 0xe0662a, 0.9, 0.25);
    const stemGeo = new T.CylinderGeometry(0.035, 0.035, 1.0, 12), discGeo = new T.CylinderGeometry(0.035, 0.17, 0.12, 24), retGeo = new T.CylinderGeometry(0.1, 0.1, 0.04, 16);
    const sprGeo = new T.CylinderGeometry(0.08, 0.08, 1, 14, 1, true);
    const camMat = mat('cams', 0x2c313a, 0.9, 0.3), camInt = mat('cams', 0x3d8fe8, 0.85, 0.3), camExh = mat('cams', 0xe0662a, 0.85, 0.3);
    const lobeGeo = new T.CylinderGeometry(1, 1, 0.14, 40).rotateZ(Math.PI / 2).scale(1, 0.3, 0.24).translate(0, 0.06, 0);
    const plugSteel = mat('plug', 0x9aa1ad, 0.9, 0.3), plugCer = mat('plug', 0xf1ece0, 0.1, 0.5);

    const camShafts = [];
    banks.forEach(function (b, bi) {
      [[+1, vMatI, camInt, INT_PEAK], [-1, vMatE, camExh, EXH_PEAK]].forEach(function (s) {
        const z = s[0] * b.side * CAM_Z;
        const sh = new T.Group(); sh.position.set(0, CAM_Y, z); b.sg.cams.add(sh);
        mesh(cylX(0.1, 4.9, 20), camMat, 'cams', sh);
        camShafts.push(sh);
        cylInBank[bi].forEach(function (e) {
          const c = cyl[e.i], lx = THROW_X[e.c.t];
          [-VALVE_DX, VALVE_DX].forEach(function (dx) {
            const lobe = mesh(lobeGeo, s[2], 'cams', sh);
            lobe.position.x = lx + dx;
            lobe.rotation.x = Math.PI - (s[3] + e.c.off) / 2 * D2R;
            const g = new T.Group(); g.position.set(lx + dx, DECK, z); b.sg.valves.add(g);
            mesh(discGeo, s[1], 'valves', g).position.y = 0.06;
            mesh(stemGeo, s[1], 'valves', g).position.y = 0.5;
            mesh(retGeo, s[1], 'valves', g).position.y = 0.98;
            const sp = new T.Mesh(sprGeo, new T.MeshStandardMaterial({ color: 0xd9b24a, metalness: 0.6, roughness: 0.4, side: T.DoubleSide, wireframe: true }));
            sp.userData.part = 'valves'; sp.position.set(lx + dx, 0, z);
            K.parts.valves.mats.push(sp.material);
            b.sg.valves.add(sp);
            c.valves.push({ g: g, peak: s[3] }); c.springs.push(sp);
          });
        });
      });
      cylInBank[bi].forEach(function (e) {
        const lx = THROW_X[e.c.t];
        const pg = new T.Group(); pg.position.set(lx, 0, 0); b.sg.plug.add(pg);
        mesh(new T.CylinderGeometry(0.055, 0.055, 1.6, 12), plugSteel, 'plug', pg).position.y = 3.1;
        mesh(new T.CylinderGeometry(0.1, 0.1, 0.1, 6), plugSteel, 'plug', pg).position.y = 3.95;
        mesh(new T.CylinderGeometry(0.075, 0.09, 0.55, 16), plugCer, 'plug', pg).position.y = 4.27;
        mesh(new T.CylinderGeometry(0.04, 0.04, 0.12, 10), plugSteel, 'plug', pg).position.y = 4.6;
        const tipMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
        const tip = new T.Mesh(new T.SphereGeometry(0.2, 16, 12), tipMat);
        tip.position.set(lx, DECK - 0.04, 0); tip.raycast = function () {};
        b.sg.plug.add(tip);
        cyl[e.i].tipMat = tipMat;
      });
    });

    // ---- animation ----
    const CH = { Intake: 0.28, Compression: 0.35, Power: 0.8, Exhaust: 0.3 };
    const offsList = cfg.cyls.map(function (c) { return c.off; });
    let explode = 0;
    const baseSetExplode = K.setExplode;
    function setExplode(t) { explode = t; baseSetExplode(t); }

    function strokeAt(i, thetaDeg) {
      const phi = mod(thetaDeg - offsList[i], 720);
      const idx = phi < 180 ? 0 : phi < 360 ? 1 : phi < 540 ? 2 : 3;
      return { phi: phi, idx: idx, name: STROKE_NAMES[idx] };
    }

    function update(theta) {
      const thetaDeg = mod(theta / D2R, 720);
      crankRot.rotation.x = theta; fwRot.rotation.x = theta; puRot.rotation.x = theta;
      camShafts.forEach(function (c) { c.rotation.x = theta / 2; });
      const chargeVisible = explode < 0.02;
      const strokes = [];
      for (let i = 0; i < cyl.length; i++) {
        const c = cyl[i], beta = c.bk.beta, cb = Math.cos(beta), sb = Math.sin(beta);
        const a = theta + cfg.phase[c.c.t];
        const cy = R * Math.cos(a), cz = R * Math.sin(a);
        const along = cy * cb + cz * sb, perp = -cy * sb + cz * cb;
        const s = along + Math.sqrt(L * L - perp * perp);
        c.piston.position.set(c.x, s * cb, s * sb);
        c.rod.position.set(c.x, cy, cz);
        c.rod.rotation.x = Math.atan2(s * sb - cz, s * cb - cy);

        const st = strokeAt(i, thetaDeg);
        strokes.push(st);
        c.valves.forEach(function (v, k) {
          const lf = lift(st.phi, v.peak);
          v.g.position.y = DECK - lf;
          const h = Math.max(0.05, 0.25 - lf);
          c.springs[k].scale.y = h;
          c.springs[k].position.y = 3.0 + h / 2;
        });

        const crown = s + 0.3;
        const h = Math.max(0.02, DECK - crown);
        c.charge.visible = chargeVisible;
        c.charge.scale.y = h;
        const d = crown + h / 2;
        c.charge.position.set(c.x, d * cb, d * sb);
        let op = CH[st.name], hex = STROKE_HEX[st.name];
        if (st.idx === 0) op = 0.85 - 0.6 * (st.phi / 180);
        if (st.idx === 3) op = 0.2 + 0.3 * ((st.phi - 540) / 180);
        if (st.idx === 0 && st.phi < 60) { hex = 0xffd27a; op = 0.95 - st.phi / 200; }
        c.chMat.color.setHex(hex); c.chMat.opacity = op;
        c.tipMat.opacity = st.idx === 0 && st.phi < 22 ? 1 - st.phi / 22 : 0;
      }
      return strokes;
    }

    K.setCutaway(true);
    update(0);

    return {
      root: root, parts: K.parts, update: update, setExplode: setExplode, setCutaway: K.setCutaway,
      setHighlight: K.setHighlight, pick: K.pick, labels: K.labels,
      period: 4 * Math.PI, cycleDeg: 720,
      rows: cfg.cyls.map(function (c, i) { return { label: 'C' + (i + 1), off: c.off }; }),
      firing: firingOrder(offsList), firesPerRev: cfg.cyls.length / 2, tone: cfg.tone,
      cam: cfg.cam, explodeZoom: cfg.explodeZoom, explodeShift: cfg.explodeShift, floorDrop: cfg.floorDrop,
      meta: { id: cfg.id, name: cfg.name, tagline: cfg.tagline, cars: cfg.cars, how: cfg.how,
        spec: cfg.cyls.length + ' cylinders · ' + cfg.subtitle + ' · firing order ' + firingOrder(offsList) }
    };
  }

  // =========================================================================
  // public API
  // =========================================================================
  const Engine = {
    CONFIGS: CONFIGS, kit: kit, STROKE_NAMES: STROKE_NAMES, STROKE_HEX: STROKE_HEX,
    ORDER: ['inline4', 'flat4', 'v8', 'rotary'],
    builders: {},
    create: function (id) {
      if (Engine.builders[id]) return Engine.builders[id]();
      return buildPiston(CONFIGS[id] || CONFIGS.inline4);
    },
    list: function () {
      return Engine.ORDER.map(function (id) { return { id: id, name: id === 'rotary' ? 'Rotary (Wankel)' : CONFIGS[id].name }; });
    }
  };
  window.Engine = Engine;
})();
