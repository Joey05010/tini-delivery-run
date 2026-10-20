(() => {
  'use strict';

  // ---------- Tunables ----------
  const MAX_W = 900;
  const MIN_W = 480;             // narrow screens see less road rather than a tiny game
  const H = 320;
  let W = MAX_W;                 // visible width in game units, set by resize()
  let speedScale = 1;            // eases the pace when less road is visible
  const ROAD_TOP = 236;          // far edge of the road, where buildings stand
  const GROUND = 280;            // y where the van's wheels touch the road

  const VAN_X = 90;
  const VAN_W = 86;
  const VAN_H = 50;

  const GRAVITY = 2400;
  const JUMP_VELOCITY = 820;
  const JUMP_CUT_VELOCITY = 480; // releasing early caps upward speed to this

  const START_SPEED = 340;
  const SPEED_STEP = 45;
  const MAX_SPEED = 1000;
  const BUILDINGS_PER_LEVEL = 3; // speed goes up after this many buildings pass
  const GAP_TIGHTEN_PER_LEVEL = 0.06; // obstacles also bunch closer each level
  const MIN_GAP_EASE = 0.35;
  const LEVEL_FLASH_TIME = 1.4;

  const START_LIVES = 3;
  const INVULNERABLE_TIME = 1.2;

  const DELIVERY_POINTS = 100;
  const STREAK_BONUS = 10;       // extra per consecutive delivery, capped below
  const MAX_STREAK_BONUS = 50;
  const WRONG_ADDRESS_PENALTY = 50;

  const COLOURS = [
    { name: 'Red',    fill: '#e5484d', dark: '#b3343a' },
    { name: 'Blue',   fill: '#3b82f6', dark: '#2a62c4' },
    { name: 'Green',  fill: '#30a46c', dark: '#237a50' },
    { name: 'Yellow', fill: '#f5b800', dark: '#bd8d00' },
    { name: 'Purple', fill: '#8e4ec6', dark: '#6b3996' },
  ];

  // Neutral paints so oncoming cars are never mistaken for a delivery colour
  const CAR_PAINTS = ['#dfe3ea', '#2f3542', '#a0673c', '#6f7c8f'];

  const BEST_KEY = 'tiniDeliveryRun.best';

  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Fits the canvas to the screen: full width, as tall as the page allows, and
  // showing between MIN_W and MAX_W game units of road
  function resize() {
    const cssW = canvas.clientWidth;
    const chrome = canvas.parentElement.offsetHeight - canvas.offsetHeight;
    const room = window.innerHeight - chrome;
    const scale = Math.max(cssW / MAX_W, Math.min(room / H, 1, cssW / MIN_W));
    W = Math.round(cssW / scale);
    speedScale = 0.55 + 0.45 * (W / MAX_W);
    canvas.style.height = Math.round(H * scale) + 'px';

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('load', resize);

  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (n) => Math.floor(Math.random() * n);

  function loadBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch (e) {
      // storage unavailable; best score just won't persist
    }
  }

  // ---------- State ----------
  let state = 'ready'; // ready | playing | over
  let best = loadBest();
  let game;

  // Scenery is generated once and looped
  const SKYLINE_PERIOD = 1800;
  const skyline = [];
  for (let x = 0; x < SKYLINE_PERIOD;) {
    const w = rand(40, 90);
    skyline.push({ x, w, h: rand(40, 110) });
    x += w + rand(4, 30);
  }
  const clouds = [];
  for (let i = 0; i < 6; i++) {
    clouds.push({ x: i * 220 + rand(0, 120), y: rand(20, 90), s: rand(0.7, 1.3) });
  }

  function newGame() {
    game = {
      speed: START_SPEED,
      level: 1,
      distance: 0,
      score: 0,
      lives: START_LIVES,
      streak: 0,
      deliveries: 0,
      buildingsPassed: 0,
      target: randInt(COLOURS.length),
      sinceTarget: 0,          // buildings spawned since one matched the target
      nextSpawn: 500,          // distance until the next obstacle spawns
      invulnerable: 0,
      levelFlash: 0,
      overTime: 0,
      van: { y: 0, vy: 0, grounded: true, holding: false },
      buildings: [],
      potholes: [],
      cars: [],
      birds: [],
      popups: [],
    };
  }
  newGame();

  // ---------- Input ----------
  function press() {
    if (state === 'ready') {
      state = 'playing';
      return;
    }
    if (state === 'over') {
      if (game.overTime > 0.6) {
        newGame();
        state = 'playing';
      }
      return;
    }
    const van = game.van;
    van.holding = true;
    if (van.grounded) {
      van.vy = JUMP_VELOCITY;
      van.grounded = false;
    }
  }

  function release() {
    const van = game.van;
    van.holding = false;
    if (!van.grounded && van.vy > JUMP_CUT_VELOCITY) {
      van.vy = JUMP_CUT_VELOCITY;
    }
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  window.addEventListener('keydown', (e) => {
    if (!JUMP_KEYS.includes(e.code)) return;
    e.preventDefault();
    if (!e.repeat) press();
  });
  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.code)) release();
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // On-screen button for phones and tablets
  document.getElementById('btn-jump').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press();
  });

  // ---------- Spawning ----------
  function spawnBuilding() {
    let colour;
    if (game.sinceTarget >= 2 || Math.random() < 0.4) {
      colour = game.target;
    } else {
      colour = (game.target + 1 + randInt(COLOURS.length - 1)) % COLOURS.length;
    }
    game.sinceTarget = colour === game.target ? 0 : game.sinceTarget + 1;
    game.buildings.push({
      x: W + 20,
      w: 104,
      h: rand(120, 165),
      colour,
      result: null,   // null | 'delivered' | 'wrong'
      counted: false,
    });
  }

  function spawnPothole() {
    game.potholes.push({ x: W + 20, w: rand(46, 62) });
  }

  function spawnCar() {
    game.cars.push({
      x: W + 20,
      w: 62,
      h: 30,
      paint: CAR_PAINTS[randInt(CAR_PAINTS.length)],
    });
  }

  function spawnBird() {
    // Birds fly above a grounded van and only punish a jump
    game.birds.push({
      x: W + 20,
      w: 40,
      h: 20,
      alt: rand(98, 112), // height of the bird's underside above the road
      flap: rand(0, Math.PI * 2),
    });
  }

  function spawnNext() {
    const roll = Math.random();
    if (roll < 0.45) spawnBuilding();
    else if (roll < 0.7) spawnPothole();
    else if (roll < 0.88 || game.level < 2) spawnCar();
    else spawnBird();
    // The minimum gap scales with speed so there is always time to land and react;
    // the slack on top of it shrinks each level
    const ease = Math.max(MIN_GAP_EASE, 1 - (game.level - 1) * GAP_TIGHTEN_PER_LEVEL);
    const speed = game.speed * speedScale;
    const minGap = speed * 0.75 + 150;
    game.nextSpawn = rand(minGap, minGap + (speed * 0.65 + 110) * ease);
  }

  // ---------- Game events ----------
  function popup(text, colour) {
    game.popups.push({ text, colour, x: VAN_X + VAN_W / 2, y: GROUND - VAN_H - game.van.y - 14, t: 0 });
  }

  function deliver(building) {
    if (building.colour === game.target) {
      const bonus = Math.min(game.streak * STREAK_BONUS, MAX_STREAK_BONUS);
      game.score += DELIVERY_POINTS + bonus;
      game.streak++;
      game.deliveries++;
      building.result = 'delivered';
      popup('+' + (DELIVERY_POINTS + bonus) + ' Delivered!', '#1f8a55');
      game.target = (game.target + 1 + randInt(COLOURS.length - 1)) % COLOURS.length;
      game.sinceTarget = 0;
    } else {
      game.score = Math.max(0, game.score - WRONG_ADDRESS_PENALTY);
      game.streak = 0;
      building.result = 'wrong';
      popup('-' + WRONG_ADDRESS_PENALTY + ' Wrong address', '#c0262d');
    }
  }

  function crash() {
    if (game.invulnerable > 0) return;
    game.lives--;
    game.streak = 0;
    if (game.lives <= 0) {
      state = 'over';
      game.overTime = 0;
      const final = Math.floor(game.score);
      if (final > best) {
        best = final;
        saveBest(best);
      }
      return;
    }
    game.invulnerable = INVULNERABLE_TIME;
    popup('Ouch!', '#c0262d');
  }

  // ---------- Update ----------
  function update(dt) {
    if (state === 'over') {
      game.overTime += dt;
      return;
    }
    if (state !== 'playing') return;

    const van = game.van;
    const move = game.speed * speedScale * dt;
    game.distance += move;
    game.score += game.speed * dt * 0.02;
    game.invulnerable = Math.max(0, game.invulnerable - dt);
    game.levelFlash = Math.max(0, game.levelFlash - dt);

    // Van physics (y is height above the road)
    if (!van.grounded) {
      van.vy -= GRAVITY * dt;
      van.y += van.vy * dt;
      if (van.y <= 0) {
        van.y = 0;
        van.vy = 0;
        van.grounded = true;
        // Holding through the landing chains straight into the next jump
        if (van.holding) {
          van.vy = JUMP_VELOCITY;
          van.grounded = false;
        }
      }
    }

    game.nextSpawn -= move;
    if (game.nextSpawn <= 0) spawnNext();

    const vanCentre = VAN_X + VAN_W / 2;

    for (const b of game.buildings) {
      b.x -= move;
      // Delivery bay sits on the road in front of the building
      const bayLeft = b.x + 20;
      const bayRight = b.x + b.w - 20;
      if (!b.result && van.y < 10 && vanCentre > bayLeft && vanCentre < bayRight) {
        deliver(b);
      }
      if (!b.counted && b.x + b.w < VAN_X) {
        b.counted = true;
        game.buildingsPassed++;
        if (game.buildingsPassed % BUILDINGS_PER_LEVEL === 0 && game.speed < MAX_SPEED) {
          game.speed = Math.min(MAX_SPEED, game.speed + SPEED_STEP);
          game.level++;
          game.levelFlash = LEVEL_FLASH_TIME;
        }
      }
    }

    for (const p of game.potholes) {
      p.x -= move;
      if (van.y < 4 && VAN_X + 20 < p.x + p.w - 6 && VAN_X + VAN_W - 20 > p.x + 6) {
        crash();
      }
    }

    // Oncoming cars close in faster than the scenery
    for (const car of game.cars) {
      car.x -= move * 1.15;
      const overlapX = VAN_X + 8 < car.x + car.w - 6 && VAN_X + VAN_W - 8 > car.x + 6;
      if (overlapX && van.y < car.h - 4) crash();
    }

    for (const bird of game.birds) {
      bird.x -= move * 1.15;
      bird.flap += dt * 14;
      const overlapX = VAN_X + 8 < bird.x + bird.w - 4 && VAN_X + VAN_W - 8 > bird.x + 4;
      const overlapY = van.y + 4 < bird.alt + bird.h - 3 && van.y + VAN_H - 4 > bird.alt + 3;
      if (overlapX && overlapY) crash();
    }

    for (const p of game.popups) {
      p.t += dt;
      p.y -= 40 * dt;
    }

    game.buildings = game.buildings.filter((b) => b.x + b.w > -20);
    game.potholes = game.potholes.filter((p) => p.x + p.w > -20);
    game.cars = game.cars.filter((c) => c.x + c.w > -20);
    game.birds = game.birds.filter((b) => b.x + b.w > -20);
    game.popups = game.popups.filter((p) => p.t < 1.1);
  }

  // ---------- Drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Each colour also has a shape so it can be told apart without relying on hue
  function drawSymbol(index, cx, cy, r, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    switch (index) {
      case 0: // circle
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      case 1: // square
        ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
        break;
      case 2: // triangle
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r * 0.8);
        ctx.lineTo(cx - r, cy + r * 0.8);
        break;
      case 3: // diamond
        ctx.moveTo(cx, cy - r * 1.1);
        ctx.lineTo(cx + r * 0.9, cy);
        ctx.lineTo(cx, cy + r * 1.1);
        ctx.lineTo(cx - r * 0.9, cy);
        break;
      default: // star
        for (let i = 0; i < 10; i++) {
          const radius = i % 2 === 0 ? r * 1.15 : r * 0.5;
          const angle = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        }
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, ROAD_TOP);
    sky.addColorStop(0, '#9fd4f0');
    sky.addColorStop(1, '#e3f3fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, ROAD_TOP);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const c of clouds) {
      const x = ((c.x - game.distance * 0.05) % (W + 200) + (W + 200)) % (W + 200) - 100;
      ctx.beginPath();
      ctx.ellipse(x, c.y, 34 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 22 * c.s, c.y - 8 * c.s, 22 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#b9c9d6';
    const offset = (game.distance * 0.2) % SKYLINE_PERIOD;
    for (const s of skyline) {
      for (let x = s.x - offset; x < W; x += SKYLINE_PERIOD) {
        if (x + s.w > 0) ctx.fillRect(x, ROAD_TOP - s.h, s.w, s.h);
      }
    }

    // Road
    ctx.fillStyle = '#4b5263';
    ctx.fillRect(0, ROAD_TOP, W, H - ROAD_TOP);
    ctx.fillStyle = '#8a92a3';
    ctx.fillRect(0, ROAD_TOP, W, 3);
    ctx.fillStyle = '#f2f2ea';
    const dash = game.distance % 60;
    for (let x = -dash; x < W; x += 60) {
      ctx.fillRect(x, H - 16, 32, 4);
    }
  }

  function drawBuilding(b) {
    const colour = COLOURS[b.colour];
    const top = ROAD_TOP - b.h;

    ctx.fillStyle = colour.fill;
    ctx.fillRect(b.x, top, b.w, b.h);
    ctx.fillStyle = colour.dark;
    ctx.fillRect(b.x - 4, top - 6, b.w + 8, 8);

    // Sign with the colour's shape
    ctx.fillStyle = '#ffffff';
    roundRect(b.x + b.w / 2 - 20, top + 12, 40, 34, 6);
    ctx.fill();
    drawSymbol(b.colour, b.x + b.w / 2, top + 29, 10, colour.dark);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let wy = top + 58; wy < ROAD_TOP - 44; wy += 26) {
      ctx.fillRect(b.x + 14, wy, 20, 14);
      ctx.fillRect(b.x + b.w - 34, wy, 20, 14);
    }
    ctx.fillStyle = colour.dark;
    ctx.fillRect(b.x + b.w / 2 - 12, ROAD_TOP - 34, 24, 34);

    // Delivery bay painted on the road
    const bayX = b.x + 20;
    const bayW = b.w - 40;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = colour.fill;
    ctx.fillRect(bayX, ROAD_TOP + 8, bayW, H - ROAD_TOP - 32);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(bayX, ROAD_TOP + 8, bayW, H - ROAD_TOP - 32);

    const cx = bayX + bayW / 2;
    const cy = ROAD_TOP + 8 + (H - ROAD_TOP - 32) / 2;
    if (b.result === 'delivered') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy);
      ctx.lineTo(cx - 4, cy + 10);
      ctx.lineTo(cx + 15, cy - 11);
      ctx.stroke();
    } else if (b.result === 'wrong') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy - 12);
      ctx.lineTo(cx + 12, cy + 12);
      ctx.moveTo(cx + 12, cy - 12);
      ctx.lineTo(cx - 12, cy + 12);
      ctx.stroke();
    } else {
      drawSymbol(b.colour, cx, cy, 11, '#ffffff');
    }
  }

  function drawPothole(p) {
    ctx.fillStyle = '#23262e';
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, GROUND, p.w / 2, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f1115';
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, GROUND + 2, p.w / 2 - 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCar(car) {
    const x = car.x;
    const bottom = GROUND;
    const top = bottom - car.h;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x + car.w / 2, GROUND + 2, car.w / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body and cabin, nose pointing at the van
    ctx.fillStyle = car.paint;
    roundRect(x, top + 12, car.w, car.h - 18, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 14, top + 13);
    ctx.lineTo(x + 22, top);
    ctx.lineTo(x + 46, top);
    ctx.lineTo(x + 54, top + 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6fb7dc';
    ctx.beginPath();
    ctx.moveTo(x + 18, top + 12);
    ctx.lineTo(x + 24, top + 3);
    ctx.lineTo(x + 44, top + 3);
    ctx.lineTo(x + 50, top + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd95a';
    ctx.fillRect(x, top + 15, 4, 5);

    for (const wx of [x + 14, x + car.w - 14]) {
      ctx.fillStyle = '#1b1d23';
      ctx.beginPath();
      ctx.arc(wx, bottom - 7, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa3b2';
      ctx.beginPath();
      ctx.arc(wx, bottom - 7, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBird(bird) {
    const x = bird.x;
    const y = GROUND - bird.alt - bird.h;
    const wing = Math.sin(bird.flap) * 12;

    ctx.fillStyle = '#3a3f4b';
    ctx.beginPath();
    ctx.ellipse(x + bird.w / 2, y + bird.h / 2, bird.w / 2 - 4, bird.h / 2 - 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // wing
    ctx.moveTo(x + 14, y + bird.h / 2);
    ctx.lineTo(x + 30, y + bird.h / 2);
    ctx.lineTo(x + 26, y + bird.h / 2 - wing);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f5a623'; // beak, facing the van
    ctx.beginPath();
    ctx.moveTo(x + 5, y + bird.h / 2 - 3);
    ctx.lineTo(x - 4, y + bird.h / 2);
    ctx.lineTo(x + 5, y + bird.h / 2 + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 10, y + bird.h / 2 - 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawVan() {
    const van = game.van;
    if (game.invulnerable > 0 && Math.floor(game.invulnerable * 10) % 2 === 0) return;

    const colour = COLOURS[game.target];
    const x = VAN_X;
    const bottom = GROUND - van.y;
    const top = bottom - VAN_H;

    // Shadow stays on the road and shrinks as the van rises
    const shadow = Math.max(0.35, 1 - van.y / 220);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x + VAN_W / 2, GROUND + 2, (VAN_W / 2) * shadow, 5 * shadow, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cargo box, painted in the colour of the address to deliver to
    ctx.fillStyle = colour.fill;
    roundRect(x, top, 58, VAN_H - 10, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 29, top + 20, 14, 0, Math.PI * 2);
    ctx.fill();
    drawSymbol(game.target, x + 29, top + 20, 8, colour.dark);

    // Cab
    ctx.fillStyle = '#f4f6fa';
    ctx.beginPath();
    ctx.moveTo(x + 56, top + 8);
    ctx.lineTo(x + 72, top + 8);
    ctx.lineTo(x + VAN_W, top + 24);
    ctx.lineTo(x + VAN_W, top + VAN_H - 10);
    ctx.lineTo(x + 56, top + VAN_H - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6fb7dc';
    ctx.beginPath();
    ctx.moveTo(x + 61, top + 12);
    ctx.lineTo(x + 71, top + 12);
    ctx.lineTo(x + 81, top + 24);
    ctx.lineTo(x + 61, top + 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd95a';
    ctx.fillRect(x + VAN_W - 4, top + 29, 4, 6);

    // Wheels
    for (const wx of [x + 18, x + 68]) {
      ctx.fillStyle = '#1b1d23';
      ctx.beginPath();
      ctx.arc(wx, bottom - 9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa3b2';
      ctx.beginPath();
      ctx.arc(wx, bottom - 9, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud() {
    const colour = COLOURS[game.target];
    ctx.textBaseline = 'middle';

    // Deliver-to indicator
    ctx.fillStyle = 'rgba(29, 36, 51, 0.82)';
    roundRect(W / 2 - 105, 10, 210, 36, 18);
    ctx.fill();
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf3';
    ctx.textAlign = 'left';
    ctx.fillText('DELIVER TO', W / 2 - 90, 29);
    ctx.fillStyle = colour.fill;
    roundRect(W / 2 - 4, 16, 96, 24, 12);
    ctx.fill();
    drawSymbol(game.target, W / 2 + 12, 28, 6, '#ffffff');
    ctx.fillStyle = '#ffffff';
    ctx.fillText(colour.name.toUpperCase(), W / 2 + 25, 29);

    // Score
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1d2433';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(String(Math.floor(game.score)).padStart(5, '0'), W - 16, 24);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('BEST ' + String(Math.max(best, Math.floor(game.score))).padStart(5, '0'), W - 16, 44);

    // Lives and level
    ctx.textAlign = 'left';
    for (let i = 0; i < START_LIVES; i++) {
      ctx.fillStyle = i < game.lives ? '#e5484d' : 'rgba(29, 36, 51, 0.2)';
      const hx = 24 + i * 24;
      ctx.beginPath();
      ctx.moveTo(hx, 30);
      ctx.bezierCurveTo(hx - 14, 20, hx - 6, 10, hx, 18);
      ctx.bezierCurveTo(hx + 6, 10, hx + 14, 20, hx, 30);
      ctx.fill();
    }
    ctx.fillStyle = '#1d2433';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('LEVEL ' + game.level + '  ·  ' + game.deliveries + ' DELIVERED', 14, 56);

    // Speed gauge
    const gauge = (game.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    ctx.fillText('SPEED', 14, 74);
    ctx.fillStyle = 'rgba(29, 36, 51, 0.2)';
    roundRect(58, 70, 80, 8, 4);
    ctx.fill();
    ctx.fillStyle = gauge > 0.7 ? '#e5484d' : '#1d2433';
    roundRect(58, 70, 8 + 72 * gauge, 8, 4);
    ctx.fill();

    if (game.levelFlash > 0) {
      ctx.globalAlpha = Math.min(1, game.levelFlash / 0.4);
      ctx.textAlign = 'center';
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText('LEVEL ' + game.level + ' — SPEED UP!', W / 2, 106);
      ctx.fillStyle = '#1d2433';
      ctx.fillText('LEVEL ' + game.level + ' — SPEED UP!', W / 2, 106);
      ctx.globalAlpha = 1;
    }
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 16px system-ui, sans-serif';
    for (const p of game.popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 1.1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.colour;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(title, lines) {
    ctx.fillStyle = 'rgba(29, 36, 51, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - 40, W - 32);
    ctx.font = '500 16px system-ui, sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 + 4 + i * 26, W - 32));
  }

  function draw() {
    drawBackground();
    for (const b of game.buildings) drawBuilding(b);
    for (const p of game.potholes) drawPothole(p);
    for (const car of game.cars) drawCar(car);
    drawVan();
    for (const bird of game.birds) drawBird(bird);
    drawPopups();
    drawHud();

    if (state === 'ready') {
      drawOverlay('Tini Delivery Run', [
        'Deliver to the bay that matches your van. Jump everything else.',
        'Press Space or tap Jump to start',
      ]);
    } else if (state === 'over') {
      drawOverlay('Game over', [
        'Score ' + Math.floor(game.score) + '  ·  ' + game.deliveries + ' delivered  ·  Best ' + best,
        'Press Space or tap Jump to play again',
      ]);
    }
  }

  // Open index.html?debug to inspect or tweak the running game from the console
  if (location.search.includes('debug')) {
    window.tiniDebug = { get game() { return game; } };
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
