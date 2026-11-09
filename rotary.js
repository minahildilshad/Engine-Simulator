/* rotary.js — twin-rotor Wankel engine (Mazda 13B style). Registers Engine.builders.rotary. */
(function () {
  'use strict';
  const T = THREE;
  const D2R = Math.PI / 180;
  const mod = (a, n) => ((a % n) + n) % n;
  const cylZ = (r, h, seg) => new T.CylinderGeometry(r, r, h, seg || 32).rotateX(Math.PI / 2);

  const RR = 1.5;          // rotor radius (apex distance from rotor centre)
  const E = 0.3;           // eccentricity
  const ROTORS = 2;
  const ZR = [-0.65, 0.65];            // rotor z positions
  const CTRL = 0.85;                   // flank control distance (flank bulge)
  const N = 28;                        // samples per chamber edge
  const OUT = 1.28;                    // outer housing scale
  const STROKE_NAMES = ['Power', 'Exhaust', 'Intake', 'Compression'];
  const HEX = { Power: 0xff7a1a, Exhaust: 0x9aa0a8, Intake: 0x6ec8ff, Compression: 0xffe08a };

  const INFO = {
    housing: ['Rotor Housings', 'The oval-ish chamber (an epitrochoid) the rotor spins in. It carries the spark plugs and the intake and exhaust ports, so there are no valves.'],
    sides: ['Side Plates', 'The end plates and the middle plate seal the faces of the rotors and hold the shaft bearings. Switch cutaway on to see through them.'],
    rotor: ['Rotors', 'A triangular rotor that orbits and spins in its housing. Its three faces make three chambers that grow and shrink as it turns, and each face goes through intake, compression, power and exhaust once per rotor turn.'],
    seals: ['Apex Seals', 'Spring-loaded strips at the three corners of the rotor. They seal the chambers against the housing wall. They are the hardest part of a rotary to make durable.'],
    eccentric: ['Eccentric Shaft', 'Takes the place of a crankshaft. Its off-centre lobes are pushed by the rotors. The shaft turns three times for each turn of the rotor, so it turns three times faster.'],
    plug: ['Spark Plugs', 'Two plugs per rotor housing fire at the top of the housing. They ignite the compressed mixture just as a chamber reaches its smallest size.'],
    intake: ['Intake Port', 'Air and fuel enter through the housing wall when the rotor face uncovers this port. Chambers at this position are in the intake stroke.'],
    exhaust: ['Exhaust Port', 'Burnt gas leaves through this port after the power stroke.'],
    flywheel: ['Flywheel', 'Smooths out the engine and carries the starter ring gear.']
  };

  const OFFS = {
    housing: [0, 0, 1.4], sides: [0, 0, 0], rotor: [0, 0, 0], seals: [0, 0, 0], eccentric: [0, 0, 0],
    plug: [0, 0, 1.4], intake: [0, 0, 1.4], exhaust: [0, 0, 1.4], flywheel: [0, 0, -3.6]
  };

  function H(phi) {            // housing (epitrochoid) point
    return [RR * Math.cos(phi) + E * Math.cos(3 * phi), RR * Math.sin(phi) + E * Math.sin(3 * phi)];
  }

  function build() {
    const K = Engine.kit(INFO, OFFS, ['housing', 'sides']);
    const root = K.root, mat = K.mat, mesh = K.mesh;

    // ---- housing outline ----
    const inner = [], outer = [];
    for (let i = 0; i < 120; i++) {
      const p = H(i / 120 * Math.PI * 2);
      inner.push(new T.Vector2(p[0], p[1]));
      outer.push(new T.Vector2(p[0] * OUT, p[1] * OUT));
    }
    const housingMat = mat('housing', 0x6d7683, 0.85, 0.38, { transparent: true });
    const sidesMat = mat('sides', 0x7a8493, 0.85, 0.35, { transparent: true });
    const wallMat = mat('housing', 0x3b4149, 0.8, 0.5, { side: T.DoubleSide });

    function housingGeo() {
      const s = new T.Shape(outer);
      s.holes.push(new T.Path(inner));
      return new T.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.4);
    }
    function plateGeo(depth) {
      return new T.ExtrudeGeometry(new T.Shape(outer), { depth: depth, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -depth / 2);
    }

    const sideGroups = [
      { z: -1.2, d: 0.3, off: [0, 0, -2.8] }, { z: 0, d: 0.5, off: [0, 0, 0] }, { z: 1.2, d: 0.3, off: [0, 0, 2.8] }
    ];
    sideGroups.forEach(function (s) {
      K.casing('sides', plateGeo(s.d), new T.Vector3(0, 0, s.z), sidesMat, 0.12, K.group('sides', root, s.off));
    });

    const rotorRoot = K.group('rotor', root);
    const sealRoot = K.group('seals', root);
    const eccRot = new T.Group();
    K.group('eccentric', root).add(eccRot);

    // ---- per-rotor-housing groups: housing, plugs, ports ----
    const plugSteel = mat('plug', 0x9aa1ad, 0.9, 0.3), plugCer = mat('plug', 0xf1ece0, 0.1, 0.5);
    const inMat = mat('intake', 0x3a6ea8, 0.7, 0.4), exMat = mat('exhaust', 0x5a4538, 0.75, 0.5);
    const rotors = [];
    for (let j = 0; j < ROTORS; j++) {
      const sgn = j === 0 ? -1 : 1;
      const hg = K.group('housing', root, [0, 0, 1.4 * sgn]);
      K.casing('housing', housingGeo(), new T.Vector3(0, 0, ZR[j]), housingMat, 0.18, hg);
      // thin inner wall so the housing shape reads even in cutaway
      const wallPts = inner.concat([inner[0]]);
      const wall = new T.Line(new T.BufferGeometry().setFromPoints(wallPts.map(function (p) { return new T.Vector3(p.x, p.y, ZR[j] + 0.4); })),
        new T.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.8 }));
      wall.raycast = function () {};
      hg.add(wall);

      const pg = K.group('plug', root, [0, 0, 1.4 * sgn]);
      [80, 100].forEach(function (deg) {
        const p = H(deg * D2R);
        mesh(new T.CylinderGeometry(0.06, 0.06, 0.9, 12), plugSteel, 'plug', pg).position.set(p[0], p[1] + 0.55, ZR[j]);
        mesh(new T.CylinderGeometry(0.075, 0.09, 0.5, 16), plugCer, 'plug', pg).position.set(p[0], p[1] + 1.2, ZR[j]);
      });
      const tp = H(90 * D2R);
      const tipMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
      const tip = new T.Mesh(new T.SphereGeometry(0.22, 16, 12), tipMat);
      tip.position.set(tp[0], tp[1] - 0.12, ZR[j]); tip.raycast = function () {};
      pg.add(tip);

      [[315, 0.3, inMat, 'intake'], [225, 0.26, exMat, 'exhaust']].forEach(function (pt) {
        const g = K.group(pt[3], root, [0, 0, 1.4 * sgn]);
        const a = pt[0] * D2R, p = H(a);
        const m = mesh(new T.CylinderGeometry(pt[1], pt[1], 1.2, 24), pt[2], pt[3], g);
        m.rotation.z = a - Math.PI / 2;
        m.position.set(p[0] + Math.cos(a) * 0.6, p[1] + Math.sin(a) * 0.6, ZR[j]);
      });

      rotors.push({ tipMat: tipMat });
    }

    // ---- rotor bodies ----
    const rotorMat = mat('rotor', 0xb7bcc6, 0.95, 0.25);
    const pocketMat = mat('rotor', 0x20242b, 0.6, 0.5);
    const sealMat = mat('seals', 0xff7a1a, 0.5, 0.35);
    const A = [], Cc = [];
    for (let k = 0; k < 3; k++) {
      const a = k * 120 * D2R;
      A.push([RR * Math.cos(a), RR * Math.sin(a)]);
      const m = (k * 120 + 60) * D2R;
      Cc.push([CTRL * Math.cos(m), CTRL * Math.sin(m)]);
    }
    const rs = new T.Shape();
    rs.moveTo(A[0][0], A[0][1]);
    for (let k = 0; k < 3; k++) rs.quadraticCurveTo(Cc[k][0], Cc[k][1], A[(k + 1) % 3][0], A[(k + 1) % 3][1]);
    const hole = new T.Path(); hole.absarc(0, 0, 0.48, 0, Math.PI * 2, true); rs.holes.push(hole);
    const rotorGeo = new T.ExtrudeGeometry(rs, { depth: 0.7, bevelEnabled: false, curveSegments: 20 }).translate(0, 0, -0.35);
    const sealGeo = new T.BoxGeometry(0.13, 0.13, 0.74);
    const pocketGeo = cylZ(0.2, 0.05, 24);

    // ---- gas chambers ----
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    const chamber = [];
    for (let j = 0; j < ROTORS; j++) {
      const rg = new T.Group(); rotorRoot.add(rg);
      mesh(rotorGeo, rotorMat, 'rotor', rg);
      for (let k = 0; k < 3; k++) {
        const sl = mesh(sealGeo, sealMat, 'seals', sealRoot, false);
        sl.userData.apex = [j, k];
        const mm = (k * 120 + 60) * D2R;
        const pk = mesh(pocketGeo, pocketMat, 'rotor', rg, false);
        pk.position.set(0.66 * Math.cos(mm), 0.66 * Math.sin(mm), 0.35);
        const pk2 = mesh(pocketGeo, pocketMat, 'rotor', rg, false);
        pk2.position.set(0.66 * Math.cos(mm), 0.66 * Math.sin(mm), -0.35);
      }
      rotors[j].rg = rg;
      rotors[j].seals = sealRoot.children.filter(function (o) { return o.userData.apex && o.userData.apex[0] === j; });
      rotors[j].chambers = [];
      for (let k = 0; k < 3; k++) {
        const faces = [];
        [0.345, -0.345].forEach(function (zo) {
          const geo = new T.BufferGeometry();
          geo.setAttribute('position', new T.BufferAttribute(new Float32Array((N + 1) * 6), 3));
          geo.setIndex(idx);
          const m = new T.MeshBasicMaterial({ color: 0x6ec8ff, transparent: true, opacity: 0.4, depthWrite: false, side: T.DoubleSide });
          const mshape = new T.Mesh(geo, m);
          mshape.frustumCulled = false; mshape.raycast = function () {};
          root.add(mshape);
          faces.push({ geo: geo, mat: m, zo: zo });
        });
        rotors[j].chambers.push(faces);
      }
    }

    // ---- eccentric shaft + flywheel ----
    const shMat = mat('eccentric', 0xb7bcc6, 0.95, 0.22), lobeMat = mat('eccentric', 0xd9a25a, 0.9, 0.3);
    mesh(cylZ(0.28, 4.4, 28), shMat, 'eccentric', eccRot);
    for (let j = 0; j < ROTORS; j++) {
      const lb = mesh(cylZ(0.46, 0.72, 32), lobeMat, 'eccentric', eccRot);
      lb.position.set(E * Math.cos(j * Math.PI), E * Math.sin(j * Math.PI), ZR[j]);
    }
    const fwRot = new T.Group(); fwRot.position.z = -1.7; K.group('flywheel', root).add(fwRot);
    const fwMat = mat('flywheel', 0x5d6470, 0.9, 0.35), fwRing = mat('flywheel', 0xc2a06a, 0.9, 0.3), fwDark = mat('flywheel', 0x15181d, 0.4, 0.7);
    mesh(cylZ(1.0, 0.3, 64), fwMat, 'flywheel', fwRot);
    mesh(cylZ(1.08, 0.14, 64), fwRing, 'flywheel', fwRot);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      mesh(cylZ(0.12, 0.34, 20), fwDark, 'flywheel', fwRot).position.set(0.55 * Math.cos(a), 0.55 * Math.sin(a), 0);
    }

    // ---- animation ----
    const OFF = [];    // cycle offset (shaft deg) for chamber (j,k)
    const rows = [];
    for (let j = 0; j < ROTORS; j++) for (let k = 0; k < 3; k++) {
      const o = mod(90 - 360 * k - 180 * j, 1080);
      OFF.push(o);
      rows.push({ label: (j + 1) + 'ABC'[k], off: o });
    }

    let explode = 0;
    const baseSetExplode = K.setExplode;
    function setExplode(t) { explode = t; baseSetExplode(t); }

    function fillStrip(face, k, rho, cx, cy, z) {
      const pos = face.geo.attributes.position.array;
      const a0 = A[k], a1 = A[(k + 1) % 3], c = Cc[k];
      const cr = Math.cos(rho), sr = Math.sin(rho);
      const phi0 = rho + k * 120 * D2R;
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        const lx = u * u * a0[0] + 2 * u * t * c[0] + t * t * a1[0];
        const ly = u * u * a0[1] + 2 * u * t * c[1] + t * t * a1[1];
        const h = H(phi0 + t * 120 * D2R);
        pos[(2 * i) * 3] = h[0]; pos[(2 * i) * 3 + 1] = h[1]; pos[(2 * i) * 3 + 2] = z + face.zo;
        pos[(2 * i + 1) * 3] = cx + lx * cr - ly * sr; pos[(2 * i + 1) * 3 + 1] = cy + lx * sr + ly * cr; pos[(2 * i + 1) * 3 + 2] = z + face.zo;
      }
      face.geo.attributes.position.needsUpdate = true;
    }

    function update(theta) {
      const psiDeg = mod(theta / D2R, 1080);
      eccRot.rotation.z = theta;
      fwRot.rotation.z = theta;
      const strokes = [];
      const vis = explode < 0.02;
      for (let j = 0; j < ROTORS; j++) {
        const R_ = rotors[j];
        const psi = theta + j * Math.PI, rho = psi / 3;
        const cx = E * Math.cos(psi), cy = E * Math.sin(psi);
        R_.rg.position.set(cx, cy, ZR[j]);
        R_.rg.rotation.z = rho;
        R_.seals.forEach(function (s) {
          const k = s.userData.apex[1], a = rho + k * 120 * D2R;
          s.position.set(cx + RR * Math.cos(a), cy + RR * Math.sin(a), ZR[j]);
          s.rotation.z = a;
        });
        let flash = 0;
        for (let k = 0; k < 3; k++) {
          const ci = j * 3 + k;
          const phi = mod(psiDeg - OFF[ci], 1080);
          const sidx = Math.floor(phi / 270);
          const name = STROKE_NAMES[sidx];
          strokes.push({ phi: phi, idx: sidx, name: name });
          const inStroke = phi - sidx * 270;     // 0..270 inside the stroke
          let op = name === 'Power' ? 0.85 - 0.6 * inStroke / 270 : name === 'Compression' ? 0.2 + 0.35 * inStroke / 270 : name === 'Intake' ? 0.3 : 0.32;
          let hex = HEX[name];
          if (sidx === 0 && inStroke < 80) { hex = 0xffd27a; op = 0.95 - inStroke / 200; }
          if (sidx === 0 && inStroke < 45) flash = Math.max(flash, 1 - inStroke / 45);
          R_.chambers[k].forEach(function (f) {
            fillStrip(f, k, rho, cx, cy, ZR[j]);
            f.mat.color.setHex(hex); f.mat.opacity = op;
          });
        }
        R_.tipMat.opacity = flash;
      }
      return strokes;
    }

    K.setCutaway(true);
    update(0);

    return {
      root: root, parts: K.parts, update: update, setExplode: setExplode, setCutaway: K.setCutaway,
      setHighlight: K.setHighlight, pick: K.pick, labels: K.labels,
      period: 6 * Math.PI, cycleDeg: 1080, rows: rows,
      firing: rows.slice().sort(function (a, b) { return a.off - b.off; }).map(function (r) { return r.label; }).join('-'),
      firesPerRev: ROTORS, tone: 1.6, floorY: -2.4,
      cam: { pos: [8, 3.5, 9], target: [0, 0, 0] }, explodeZoom: 1.6, explodeShift: [0, 0, -0.8], floorDrop: 0,
      meta: {
        id: 'rotary', name: 'Rotary (Wankel)', tagline: 'A triangular rotor spins instead of pistons moving',
        cars: 'Mazda RX-7 · Mazda RX-8 · Mazda Cosmo',
        how: 'A triangle-shaped rotor orbits inside an oval housing. Its three faces make three chambers that grow and shrink as it turns, so each face goes through intake, compression, power and exhaust once per rotor turn. There are no valves or pistons, so it is smooth, compact and happy to rev. Sealing the rotor corners is hard.',
        spec: '2 rotors · 13B style · one power pulse per shaft turn per rotor'
      }
    };
  }

  Engine.builders.rotary = build;
})();
