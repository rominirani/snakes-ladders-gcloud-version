/**
 * Snakes & Ladders: Pluggable Edition Engine (game.js)
 * Loads customizable scenario & question packs from `packs/manifest.json`
 * (with offline fallback to `window.GCP_PACKS` in `scenarios.js`).
 *
 * Security notes (mandatory-secure-web-skills):
 * - Zero innerHTML / outerHTML / insertAdjacentHTML / document.write usage.
 * - Zero inline styles or style-attribute mutations (strict style-src 'self').
 * - External documentation links strictly validated against https:// and the
 *   active pack's allowedDocHosts, with rel="noopener noreferrer".
 * - OS CSPRNG (crypto.getRandomValues) with rejection sampling for dice & shuffle.
 * - TODO(security): Server-side authentication, session management, CSRF
 *   protection, database queries, and file uploads are omitted because this is
 *   a stateless, local client-side game with no user accounts or persistence.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_SHIELDS = 2;
  const DEFAULT_TIER_CENTERS = [100, 300, 500, 700, 900];

  const DIE_PIPS = {
    1: [[32, 32]],
    2: [[20, 20], [44, 44]],
    3: [[20, 20], [32, 32], [44, 44]],
    4: [[20, 20], [44, 20], [20, 44], [44, 44]],
    5: [[20, 20], [44, 20], [32, 32], [20, 44], [44, 44]],
    6: [[20, 18], [44, 18], [20, 32], [44, 32], [20, 46], [44, 46]]
  };

  const TOKEN_OFFSETS = {
    1: [[0, 0]],
    2: [[-14, 4], [14, 4]],
    3: [[-15, 7], [15, 7], [0, -11]]
  };

  // =========================================================================
  // SAFE DOM & CSPRNG UTILITIES
  // =========================================================================

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
      }
    }
    return el;
  }

  function htmlEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function cryptoRandomInt(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    let val = limit;
    while (val >= limit) {
      window.crypto.getRandomValues(buf);
      val = buf[0];
    }
    return val % maxExclusive;
  }

  function rollCryptoDie() {
    return cryptoRandomInt(6) + 1;
  }

  function cryptoShuffle(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = cryptoRandomInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pickFreshSubset(pool, count, recentSet) {
    const fresh = cryptoShuffle(pool.filter((item) => !recentSet.has(item.id)));
    const seen = cryptoShuffle(pool.filter((item) => recentSet.has(item.id)));
    return fresh.concat(seen).slice(0, count);
  }

  // =========================================================================
  // BOARD GEOMETRY & PROCEDURAL NON-CROSSING LAYOUT GENERATOR
  // =========================================================================

  function squareInfo(square) {
    const idx = square - 1;
    const rowFromBottom = Math.floor(idx / 10);
    const visualRow = 9 - rowFromBottom;
    const col = rowFromBottom % 2 === 0 ? idx % 10 : 9 - (idx % 10);
    const x = col * 100;
    const y = visualRow * 100;
    return {
      square,
      rowFromBottom,
      col,
      visualRow,
      x,
      y,
      cx: x + 50,
      cy: y + 54
    };
  }

  function pointToSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function orient2D(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orient2D(a.cx, a.cy, b.cx, b.cy, c.cx, c.cy);
    const o2 = orient2D(a.cx, a.cy, b.cx, b.cy, d.cx, d.cy);
    const o3 = orient2D(c.cx, c.cy, d.cx, d.cy, a.cx, a.cy);
    const o4 = orient2D(c.cx, c.cy, d.cx, d.cy, b.cx, b.cy);
    return o1 * o2 <= 0 && o3 * o4 <= 0;
  }

  function segmentToSegmentDist(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointToSegmentDist(a.cx, a.cy, c.cx, c.cy, d.cx, d.cy),
      pointToSegmentDist(b.cx, b.cy, c.cx, c.cy, d.cx, d.cy),
      pointToSegmentDist(c.cx, c.cy, a.cx, a.cy, b.cx, b.cy),
      pointToSegmentDist(d.cx, d.cy, a.cx, a.cy, b.cx, b.cy)
    );
  }

  const FALLBACK_GEOMETRY = {
    ladderPairs: [[4, 25], [12, 49], [22, 42], [33, 68], [45, 66], [61, 81], [72, 92]],
    snakePairs: [[27, 6], [38, 18], [51, 30], [64, 43], [79, 59], [87, 54], [97, 76]],
    shieldSquares: [9, 20, 36, 60, 71, 86]
  };

  function generateCleanBoardGeometry() {
    const ladderBands = [
      { r1: [0, 1], span: [2, 3] },
      { r1: [1, 2], span: [2, 3] },
      { r1: [2, 3], span: [2, 3] },
      { r1: [3, 4], span: [2, 3] },
      { r1: [4, 5], span: [2, 3] },
      { r1: [5, 6], span: [2, 2] },
      { r1: [6, 7], span: [2, 2] }
    ];

    const snakeBands = [
      { r1: [2, 3], span: [2, 2] },
      { r1: [3, 4], span: [2, 3] },
      { r1: [4, 5], span: [2, 3] },
      { r1: [5, 6], span: [2, 3] },
      { r1: [6, 7], span: [2, 3] },
      { r1: [7, 8], span: [2, 3] },
      { r1: [9, 9], span: [2, 3] }
    ];

    const shieldRanges = [
      [3, 18],
      [19, 34],
      [35, 50],
      [51, 66],
      [67, 82],
      [83, 96]
    ];

    for (let attempt = 0; attempt < 300; attempt++) {
      const used = new Set([1, 100]);
      const placedSegments = [];
      const ladderPairs = [];
      const snakePairs = [];

      const tasks = [];
      for (const b of ladderBands) tasks.push({ kind: 'ladder', band: b });
      for (const b of snakeBands) tasks.push({ kind: 'snake', band: b });
      const orderedTasks = cryptoShuffle(tasks);

      let ok = true;
      for (const task of orderedTasks) {
        const candidates = [];
        for (let fromSq = 2; fromSq <= 99; fromSq++) {
          if (used.has(fromSq)) continue;
          const a = squareInfo(fromSq);
          if (a.rowFromBottom < task.band.r1[0] || a.rowFromBottom > task.band.r1[1]) continue;

          for (let toSq = 2; toSq <= 98; toSq++) {
            if (used.has(toSq) || toSq === fromSq) continue;
            const b = squareInfo(toSq);
            const rowDiff = task.kind === 'ladder'
              ? b.rowFromBottom - a.rowFromBottom
              : a.rowFromBottom - b.rowFromBottom;

            if (rowDiff < task.band.span[0] || rowDiff > task.band.span[1]) continue;
            if (Math.abs(a.col - b.col) > 2) continue;
            if (Math.abs(toSq - fromSq) < 12) continue;

            candidates.push([fromSq, toSq, a, b]);
          }
        }

        const shuffledCandidates = cryptoShuffle(candidates);
        let chosen = null;
        for (const cand of shuffledCandidates) {
          const [fSq, tSq, a, b] = cand;
          let conflict = false;
          for (const seg of placedSegments) {
            if (segmentToSegmentDist(a, b, seg.a, seg.b) < 66) {
              conflict = true;
              break;
            }
          }
          if (!conflict) {
            chosen = [fSq, tSq, a, b];
            break;
          }
        }

        if (!chosen) {
          ok = false;
          break;
        }

        const [fSq, tSq, a, b] = chosen;
        used.add(fSq);
        used.add(tSq);
        placedSegments.push({ a, b });
        if (task.kind === 'ladder') {
          ladderPairs.push([fSq, tSq]);
        } else {
          snakePairs.push([fSq, tSq]);
        }
      }

      if (!ok) continue;

      const shieldSquares = [];
      for (const [lo, hi] of shieldRanges) {
        const valid = [];
        for (let sq = lo; sq <= hi; sq++) {
          if (used.has(sq)) continue;
          const info = squareInfo(sq);
          let clear = true;
          for (const seg of placedSegments) {
            if (pointToSegmentDist(info.cx, info.cy, seg.a.cx, seg.a.cy, seg.b.cx, seg.b.cy) < 70) {
              clear = false;
              break;
            }
          }
          if (clear) valid.push(sq);
        }
        if (valid.length === 0) {
          ok = false;
          break;
        }
        const pick = valid[cryptoRandomInt(valid.length)];
        used.add(pick);
        shieldSquares.push(pick);
      }

      if (ok) {
        ladderPairs.sort((x, y) => x[0] - y[0]);
        snakePairs.sort((x, y) => x[0] - y[0]);
        shieldSquares.sort((x, y) => x - y);
        return { ladderPairs, snakePairs, shieldSquares };
      }
    }

    return FALLBACK_GEOMETRY;
  }

  function snakeCurvePoint(snake, t) {
    const start = squareInfo(snake.from);
    const end = squareInfo(snake.to);
    const dx = end.cx - start.cx;
    const dy = end.cy - start.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const waves = len > 280 ? 3 : 2;
    const amp = 18;
    const offset = Math.sin(t * Math.PI * waves) * amp;
    return {
      x: start.cx + dx * t + nx * offset,
      y: start.cy + dy * t + ny * offset
    };
  }

  // =========================================================================
  // SUBTLE WEB AUDIO SYNTHESIZER
  // =========================================================================

  class SoundEngine {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    ensureContext() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    tone(freq, duration, type, gainVal, delaySec) {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const start = ctx.currentTime + (delaySec || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainVal || 0.06, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    playHop() {
      this.tone(440, 0.06, 'triangle', 0.045, 0);
    }

    playLadder() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this.tone(f, 0.14, 'triangle', 0.06, i * 0.075);
      });
    }

    playSnake() {
      [440, 370, 311.13, 233.08].forEach((f, i) => {
        this.tone(f, 0.17, 'sawtooth', 0.038, i * 0.09);
      });
    }

    playShieldGain() {
      [587.33, 880].forEach((f, i) => {
        this.tone(f, 0.16, 'sine', 0.065, i * 0.08);
      });
    }

    playShieldBlock() {
      [523.25, 659.25, 783.99, 987.77].forEach((f, i) => {
        this.tone(f, 0.22, 'sine', 0.07, i * 0.055);
      });
    }

    playWin() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        this.tone(f, 0.26, 'triangle', 0.075, i * 0.09);
      });
    }
  }

  const sound = new SoundEngine();

  // =========================================================================
  // GAME STATE & DYNAMIC PACK ENGINE
  // =========================================================================

  const state = {
    mode: 'solo', // 'solo' | 'bot'
    phase: 'IDLE_HUMAN',
    bonusType: null,
    manifest: null,
    activePackId: 'cloud-architect',
    activePack: null,
    loadedPacks: new Map(),
    allowedDocHosts: new Set(['cloud.google.com', 'docs.cloud.google.com']),
    tiers: [
      { label: 'GLOBAL SRE', centerY: 100 },
      { label: 'DATA & AI', centerY: 300 },
      { label: 'SERVERLESS', centerY: 500 },
      { label: 'CORE INFRA', centerY: 700 },
      { label: 'SANDBOX', centerY: 900 }
    ],
    milestones: {
      1: {
        shortTag: 'localhost',
        badge: 'SANDBOX ORIGIN',
        badgeClass: 'badge-neutral',
        jump: 'Square 1',
        title: 'localhost:8080 Prototype',
        quip: '"One container, a fresh Google Cloud project, and big multi-region dreams."',
        tip: 'Start every workload with a clean Folder/Project hierarchy, least-privilege IAM, and Cloud Billing Budgets.',
        docLabel: 'Google Cloud Documentation Overview',
        docUrl: 'https://cloud.google.com/docs/overview'
      },
      100: {
        shortTag: '99.999% SLA',
        badge: 'PRODUCTION NIRVANA',
        badgeClass: 'badge-shield',
        jump: 'Square 100 · 99.999%',
        title: 'Global Five-Nines Launch!',
        quip: '"Zero pages overnight, sub-50ms p99 latency worldwide, and plenty of error budget to spare."',
        tip: 'Sustaining 99.999% availability unites multi-region active-active design, automated rollbacks, and SRE culture.',
        docLabel: 'Google Cloud Well-Architected Framework',
        docUrl: 'https://cloud.google.com/architecture/framework'
      }
    },
    players: [],
    currentIdx: 0,
    consecutiveSixes: 0,
    turnCount: 1,
    lastRoll: 1,
    selectedSquare: 1,
    topologyNumber: 0,
    generation: 0,
    turnSeq: 0,
    recentScenarioIds: new Set(),
    ladders: [],
    snakes: [],
    shields: [],
    ladderByStart: new Map(),
    snakeByStart: new Map(),
    shieldBySquare: new Map(),
    pendingShieldResolver: null,
    pendingChallengeContinue: null
  };

  const dom = {};
  const cellElements = new Map();
  const tokenNodes = new Map();
  let tokensLayer = null;
  let effectsLayer = null;

  function setSafeDocLink(anchorEl, textEl, rawUrl, label) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && state.allowedDocHosts.has(parsed.hostname)) {
        anchorEl.setAttribute('href', parsed.href);
        textEl.textContent = `Learn more: ${label}`;
        return;
      }
    } catch (_) {
      // Fallback below
    }
    anchorEl.setAttribute('href', 'https://cloud.google.com/docs/overview');
    textEl.textContent = 'Learn more: Official Documentation';
  }

  async function fetchJsonSafe(url) {
    try {
      const resp = await fetch(url, { cache: 'no-cache' });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) {
      return null;
    }
  }

  async function loadPackRegistryAndInitialPack() {
    // Seed built-in packs from scenarios.js fallback if present
    if (window.GCP_PACKS) {
      for (const [k, v] of Object.entries(window.GCP_PACKS)) {
        state.loadedPacks.set(k, v);
      }
    }

    const remoteManifest = await fetchJsonSafe('packs/manifest.json');
    state.manifest = remoteManifest || window.GCP_MANIFEST || {
      defaultPack: 'cloud-architect',
      packs: [{ id: 'cloud-architect', name: 'Cloud Architect Edition', file: 'packs/cloud-architect.json' }]
    };

    const packEntries = Array.isArray(state.manifest.packs) ? state.manifest.packs : [];
    const params = new URLSearchParams(window.location.search);
    const requestedPack = params.get('pack');
    const validRequested = packEntries.find((p) => p.id === requestedPack);
    const initialId = validRequested
      ? validRequested.id
      : state.manifest.defaultPack || (packEntries[0] && packEntries[0].id) || 'cloud-architect';

    // Populate pack dropdown selector
    if (dom.packSelect) {
      dom.packSelect.replaceChildren();
      for (const entry of packEntries) {
        const label = entry.name || entry.title || entry.editionBadge || entry.id;
        const opt = htmlEl('option', '', label);
        opt.value = entry.id;
        if (entry.id === initialId) opt.selected = true;
        dom.packSelect.appendChild(opt);
      }
      dom.packSelect.parentElement.classList.toggle('is-hidden', packEntries.length <= 1);
    }

    await activatePack(initialId, false);
  }

  async function activatePack(packId, updateUrl) {
    const packEntries = (state.manifest && state.manifest.packs) || [];
    const entry = packEntries.find((p) => p.id === packId);

    let packData = null;
    if (entry && entry.file) {
      packData = await fetchJsonSafe(entry.file);
    }
    if (!packData && state.loadedPacks.has(packId)) {
      packData = state.loadedPacks.get(packId);
    }
    if (!packData && window.GCP_CATALOG) {
      packData = window.GCP_CATALOG;
    }
    if (!packData) return;

    state.loadedPacks.set(packId, packData);
    state.activePackId = packId;
    state.activePack = packData;
    state.recentScenarioIds.clear();
    state.topologyNumber = 0;

    // Apply pack metadata to UI, tiers, milestones & allowed doc hosts
    const meta = packData.meta || {};
    const baseTitle = meta.title ? String(meta.title).split(':')[0].trim() : 'Snakes & Ladders';
    if (dom.brandTitle) dom.brandTitle.textContent = baseTitle;
    if (dom.editionPill && meta.editionBadge) dom.editionPill.textContent = meta.editionBadge;
    if (dom.brandSubtitle && meta.subtitle) dom.brandSubtitle.textContent = meta.subtitle;
    if (meta.editionBadge) {
      document.title = `${baseTitle}: ${meta.editionBadge}`;
    }

    if (Array.isArray(meta.allowedDocHosts) && meta.allowedDocHosts.length > 0) {
      state.allowedDocHosts = new Set(meta.allowedDocHosts);
    }

    if (Array.isArray(meta.tiers) && meta.tiers.length === 5) {
      state.tiers = meta.tiers.map((label, idx) => ({
        label: String(label),
        centerY: DEFAULT_TIER_CENTERS[idx]
      }));
    }

    if (meta.milestones) {
      if (meta.milestones['1']) {
        state.milestones[1] = { ...meta.milestones['1'], badgeClass: 'badge-neutral' };
      }
      if (meta.milestones['100']) {
        state.milestones[100] = { ...meta.milestones['100'], badgeClass: 'badge-shield' };
      }
    }

    if (dom.packSelect && dom.packSelect.value !== packId) {
      dom.packSelect.value = packId;
    }

    if (updateUrl && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('pack', packId);
      window.history.replaceState({}, '', url.toString());
    }

    resetGame();
  }

  function createPlayers(mode) {
    if (mode === 'solo') {
      return [
        {
          id: 0,
          name: 'You (Architect)',
          short: 'YOU',
          isBot: false,
          pos: 1,
          shields: [],
          stats: { rolls: 0, ladders: 0, snakes: 0, shieldsUsed: 0, checksPassed: 0, checksTotal: 0 }
        }
      ];
    }
    return [
      {
        id: 0,
        name: 'You (Architect)',
        short: 'YOU',
        isBot: false,
        pos: 1,
        shields: [],
        stats: { rolls: 0, ladders: 0, snakes: 0, shieldsUsed: 0, checksPassed: 0, checksTotal: 0 }
      },
      {
        id: 1,
        name: 'Chaos Bot',
        short: 'BOT',
        isBot: true,
        pos: 1,
        shields: [],
        stats: { rolls: 0, ladders: 0, snakes: 0, shieldsUsed: 0, checksPassed: 0, checksTotal: 0 }
      }
    ];
  }

  function randomizeBoardData() {
    const pack = state.activePack || window.GCP_CATALOG || {};
    const ladderCatalog = Array.isArray(pack.ladders) ? pack.ladders : [];
    const snakeCatalog = Array.isArray(pack.snakes) ? pack.snakes : [];
    const shieldCatalog = Array.isArray(pack.shields) ? pack.shields : [];

    const totalPool = ladderCatalog.length + snakeCatalog.length + shieldCatalog.length;
    if (state.recentScenarioIds.size > Math.max(20, totalPool - 25)) {
      state.recentScenarioIds.clear();
    }

    const pickedLadders = pickFreshSubset(ladderCatalog, 7, state.recentScenarioIds);
    const pickedSnakes = pickFreshSubset(snakeCatalog, 7, state.recentScenarioIds);
    const pickedShields = pickFreshSubset(shieldCatalog, 6, state.recentScenarioIds);

    for (const item of pickedLadders) state.recentScenarioIds.add(item.id);
    for (const item of pickedSnakes) state.recentScenarioIds.add(item.id);
    for (const item of pickedShields) state.recentScenarioIds.add(item.id);

    const geom = generateCleanBoardGeometry();

    state.ladders = geom.ladderPairs.map(([from, to], idx) => ({
      ...pickedLadders[idx],
      from,
      to
    }));

    state.snakes = geom.snakePairs.map(([from, to], idx) => ({
      ...pickedSnakes[idx],
      from,
      to
    }));

    state.shields = geom.shieldSquares.map((square, idx) => ({
      ...pickedShields[idx],
      square
    }));

    state.ladderByStart = new Map(state.ladders.map((l) => [l.from, l]));
    state.snakeByStart = new Map(state.snakes.map((s) => [s.from, s]));
    state.shieldBySquare = new Map(state.shields.map((sh) => [sh.square, sh]));
    state.topologyNumber += 1;
  }

  // =========================================================================
  // SVG BOARD RENDERER
  // =========================================================================

  function buildBoardSVG() {
    const svg = dom.boardSvg;
    svg.replaceChildren();
    cellElements.clear();

    const marginGroup = svgEl('g', { 'aria-hidden': 'true' });
    for (const tier of state.tiers) {
      const txt = svgEl('text', {
        x: -18,
        y: tier.centerY,
        'text-anchor': 'middle',
        transform: `rotate(-90 -18 ${tier.centerY})`,
        class: 'svg-tier-text'
      });
      txt.textContent = tier.label;
      marginGroup.appendChild(txt);
    }
    svg.appendChild(marginGroup);

    svg.appendChild(svgEl('rect', {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      rx: 10,
      class: 'board-grid-frame'
    }));

    const cellsLayer = svgEl('g', { id: 'cells-layer' });
    const flowLayer = svgEl('g', { 'aria-hidden': 'true' });
    const connectorsLayer = svgEl('g', { 'aria-hidden': 'true' });
    effectsLayer = svgEl('g', { 'aria-hidden': 'true' });
    tokensLayer = svgEl('g', { id: 'tokens-layer' });

    for (let sq = 1; sq <= 100; sq++) {
      const info = squareInfo(sq);
      const ladder = state.ladderByStart.get(sq);
      const snake = state.snakeByStart.get(sq);
      const shield = state.shieldBySquare.get(sq);
      const isSpecial = Boolean(ladder || snake || shield || sq === 1 || sq === 100);

      const g = svgEl('g', {
        class: isSpecial ? 'cell-group cell-interactive' : 'cell-group',
        'data-square': sq
      });

      let fillClass = (info.col + info.visualRow) % 2 === 0 ? 'cell-even' : 'cell-odd';
      if (ladder) fillClass = 'cell-ladder-base';
      else if (snake) fillClass = 'cell-snake-head';
      else if (shield) fillClass = 'cell-shield';
      else if (sq === 1) fillClass = 'cell-start';
      else if (sq === 100) fillClass = 'cell-finish';

      g.appendChild(svgEl('rect', {
        x: info.x,
        y: info.y,
        width: 100,
        height: 100,
        class: `cell-base ${fillClass}`
      }));

      let numClass = 'svg-cell-num';
      if (ladder) numClass += ' svg-num-ladder';
      else if (snake) numClass += ' svg-num-snake';
      else if (shield) numClass += ' svg-num-shield';
      else if (sq === 1 || sq === 100) numClass += ' svg-num-milestone';

      const numTxt = svgEl('text', {
        x: info.x + 10,
        y: info.y + 21,
        class: numClass
      });
      numTxt.textContent = String(sq);
      g.appendChild(numTxt);

      if (shield) {
        drawShieldIcon(g, info.x + 50, info.y + 49);
        appendCellTag(g, info, shield.shortTag, 'svg-tag-shield', 90);
      } else if (ladder) {
        appendCellTag(g, info, `↑ ${ladder.shortTag}`, 'svg-tag-ladder', 90);
      } else if (snake) {
        appendCellTag(g, info, `↓ ${snake.shortTag}`, 'svg-tag-snake', 35);
      } else if (sq === 1) {
        drawStartIcon(g, info.x + 50, info.y + 50);
        appendCellTag(g, info, state.milestones[1].shortTag || 'localhost', 'svg-tag-milestone', 90);
      } else if (sq === 100) {
        drawFinishIcon(g, info.x + 50, info.y + 48);
        appendCellTag(g, info, state.milestones[100].shortTag || '99.999% SLA', 'svg-tag-milestone', 90);
      }

      if (isSpecial) {
        g.appendChild(svgEl('rect', {
          x: info.x + 1.5,
          y: info.y + 1.5,
          width: 97,
          height: 97,
          class: 'cell-highlight'
        }));
        g.addEventListener('click', () => {
          selectSquareSpotlight(sq);
        });
      }

      cellsLayer.appendChild(g);
      cellElements.set(sq, g);
    }

    for (let r = 0; r < 9; r++) {
      const sqEnd = (r + 1) * 10;
      const a = squareInfo(sqEnd);
      const arrowX = a.col === 9 ? 988 : 12;
      const arrowY = a.y + 6;
      flowLayer.appendChild(svgEl('path', {
        d: `M ${arrowX - 4} ${arrowY + 3} L ${arrowX} ${arrowY - 3} L ${arrowX + 4} ${arrowY + 3}`,
        class: 'svg-flow-hint'
      }));
    }

    for (const ladder of state.ladders) {
      drawLadder(connectorsLayer, ladder);
    }
    for (const snake of state.snakes) {
      drawSnake(connectorsLayer, snake);
    }

    svg.appendChild(cellsLayer);
    svg.appendChild(flowLayer);
    svg.appendChild(connectorsLayer);
    svg.appendChild(effectsLayer);
    svg.appendChild(tokensLayer);
  }

  function appendCellTag(group, info, label, extraClass, yOffset) {
    const tag = svgEl('text', {
      x: info.x + 50,
      y: info.y + (yOffset || 90),
      'text-anchor': 'middle',
      class: `svg-cell-tag ${extraClass}`
    });
    tag.textContent = label;
    group.appendChild(tag);
  }

  function drawShieldIcon(group, cx, cy) {
    const pathD = [
      `M ${cx} ${cy - 17}`,
      `L ${cx + 14} ${cy - 11}`,
      `L ${cx + 14} ${cy + 1}`,
      `C ${cx + 14} ${cy + 10}, ${cx + 7} ${cy + 16}, ${cx} ${cy + 19}`,
      `C ${cx - 7} ${cy + 16}, ${cx - 14} ${cy + 10}, ${cx - 14} ${cy + 1}`,
      `L ${cx - 14} ${cy - 11} Z`
    ].join(' ');
    group.appendChild(svgEl('path', { d: pathD, class: 'board-shield-shape' }));
    group.appendChild(svgEl('path', {
      d: `M ${cx - 5.5} ${cy + 1} L ${cx - 1.5} ${cy + 5} L ${cx + 6.5} ${cy - 4}`,
      class: 'board-shield-check'
    }));
  }

  function drawStartIcon(group, cx, cy) {
    group.appendChild(svgEl('rect', {
      x: cx - 15,
      y: cy - 12,
      width: 30,
      height: 22,
      rx: 5,
      class: 'start-icon-box'
    }));
    group.appendChild(svgEl('path', {
      d: `M ${cx - 8} ${cy - 5} L ${cx - 3} ${cy - 1} L ${cx - 8} ${cy + 3} M ${cx} ${cy + 3} L ${cx + 7} ${cy + 3}`,
      class: 'start-icon-prompt'
    }));
  }

  function drawFinishIcon(group, cx, cy) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 16 : 7.5;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
    }
    group.appendChild(svgEl('polygon', {
      points: pts.join(' '),
      class: 'finish-icon-star'
    }));
  }

  function drawLadder(layer, ladder) {
    const a = squareInfo(ladder.from);
    const b = squareInfo(ladder.to);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const halfW = 10.5;

    const x1L = a.cx + nx * halfW;
    const y1L = a.cy + ny * halfW;
    const x2L = b.cx + nx * halfW;
    const y2L = b.cy + ny * halfW;

    const x1R = a.cx - nx * halfW;
    const y1R = a.cy - ny * halfW;
    const x2R = b.cx - nx * halfW;
    const y2R = b.cy - ny * halfW;

    const g = svgEl('g');
    g.appendChild(svgEl('line', { x1: x1L + 2, y1: y1L + 3, x2: x2L + 2, y2: y2L + 3, class: 'ladder-shadow' }));
    g.appendChild(svgEl('line', { x1: x1R + 2, y1: y1R + 3, x2: x2R + 2, y2: y2R + 3, class: 'ladder-shadow' }));

    const rungSpacing = 24;
    const count = Math.max(2, Math.floor(len / rungSpacing) - 1);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const rx = a.cx + dx * t;
      const ry = a.cy + dy * t;
      g.appendChild(svgEl('line', {
        x1: rx + nx * halfW,
        y1: ry + ny * halfW,
        x2: rx - nx * halfW,
        y2: ry - ny * halfW,
        class: 'ladder-rung'
      }));
    }

    g.appendChild(svgEl('line', { x1: x1L, y1: y1L, x2: x2L, y2: y2L, class: 'ladder-rail' }));
    g.appendChild(svgEl('line', { x1: x1R, y1: y1R, x2: x2R, y2: y2R, class: 'ladder-rail' }));
    g.appendChild(svgEl('circle', { cx: a.cx, cy: a.cy, r: 5.5, class: 'ladder-node' }));
    g.appendChild(svgEl('circle', { cx: b.cx, cy: b.cy, r: 5.5, class: 'ladder-node' }));

    layer.appendChild(g);
  }

  function drawSnake(layer, snake) {
    const samples = 42;
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      pts.push(snakeCurvePoint(snake, i / samples));
    }

    const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const shadowD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${(p.x + 2).toFixed(1)} ${(p.y + 3.5).toFixed(1)}`).join(' ');

    const g = svgEl('g');
    g.appendChild(svgEl('path', { d: shadowD, class: 'snake-shadow' }));
    g.appendChild(svgEl('path', { d, class: 'snake-body' }));
    g.appendChild(svgEl('path', { d, class: 'snake-spine' }));

    const tail = pts[pts.length - 1];
    g.appendChild(svgEl('circle', { cx: tail.x, cy: tail.y, r: 5, class: 'snake-tail-dot' }));

    const head = pts[0];
    const next = pts[1];
    const angleDeg = (Math.atan2(next.y - head.y, next.x - head.x) * 180) / Math.PI;
    const headGroup = svgEl('g', {
      transform: `translate(${head.x.toFixed(1)} ${head.y.toFixed(1)}) rotate(${angleDeg.toFixed(1)})`
    });
    headGroup.appendChild(svgEl('ellipse', { cx: 0, cy: 0, rx: 10.5, ry: 8, class: 'snake-head-shape' }));
    headGroup.appendChild(svgEl('circle', { cx: 2.5, cy: -3.2, r: 2.3, class: 'snake-eye' }));
    headGroup.appendChild(svgEl('circle', { cx: 2.5, cy: 3.2, r: 2.3, class: 'snake-eye' }));
    headGroup.appendChild(svgEl('circle', { cx: 3.1, cy: -3.2, r: 1.1, class: 'snake-pupil' }));
    headGroup.appendChild(svgEl('circle', { cx: 3.1, cy: 3.2, r: 1.1, class: 'snake-pupil' }));

    g.appendChild(headGroup);
    layer.appendChild(g);
  }

  function renderDieFace(value) {
    const svg = dom.dieSvg;
    svg.replaceChildren();
    svg.appendChild(svgEl('rect', {
      x: 4,
      y: 4,
      width: 56,
      height: 56,
      rx: 13,
      class: 'die-face'
    }));

    const pips = DIE_PIPS[value] || DIE_PIPS[1];
    const pipClass = value === 6 ? 'die-pip die-pip-six' : 'die-pip';
    for (const [px, py] of pips) {
      svg.appendChild(svgEl('circle', {
        cx: px,
        cy: py,
        r: 5.2,
        class: pipClass
      }));
    }
  }

  function getRestingPosition(player) {
    const occupants = state.players.filter((p) => p.pos === player.pos);
    const idxInSquare = occupants.findIndex((p) => p.id === player.id);
    const offsets = TOKEN_OFFSETS[occupants.length] || TOKEN_OFFSETS[1];
    const [ox, oy] = offsets[idxInSquare] || [0, 0];
    const base = squareInfo(player.pos);
    return { x: base.cx + ox, y: base.cy + oy };
  }

  function buildPlayerTokens() {
    tokensLayer.replaceChildren();
    tokenNodes.clear();

    for (const player of state.players) {
      const pos = getRestingPosition(player);
      const g = svgEl('g', {
        class: player.shields.length > 0 ? 'token-group has-shield' : 'token-group',
        transform: `translate(${pos.x} ${pos.y})`
      });

      g.appendChild(svgEl('circle', { cx: 0, cy: 2.5, r: 16, class: 'token-shadow' }));
      g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 20.5, class: 'token-shield-aura' }));
      g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 15.5, class: `token-disc token-p${player.id}` }));

      const lbl = svgEl('text', { x: 0, y: 0.5, class: 'token-label' });
      lbl.textContent = player.short;
      g.appendChild(lbl);

      tokensLayer.appendChild(g);
      tokenNodes.set(player.id, g);
    }
  }

  function syncAllTokenPositions() {
    for (const player of state.players) {
      const node = tokenNodes.get(player.id);
      if (!node) continue;
      const pos = getRestingPosition(player);
      node.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
      node.setAttribute('class', player.shields.length > 0 ? 'token-group has-shield' : 'token-group');
    }
  }

  // =========================================================================
  // RESILIENT ANIMATION ENGINE
  // =========================================================================

  function animateRingPulse(square, cssClass, gen) {
    const info = squareInfo(square);
    const circle = svgEl('circle', {
      cx: info.cx,
      cy: info.cy,
      r: 14,
      class: cssClass
    });
    effectsLayer.appendChild(circle);

    animateTween(540, gen, (t) => {
      circle.setAttribute('r', (14 + t * 36).toFixed(1));
      circle.setAttribute('opacity', (1 - t).toFixed(2));
    }).then(() => {
      circle.remove();
    });
  }

  function animateTween(durationMs, gen, onProgress) {
    return new Promise((resolve) => {
      const startWall = performance.now();
      let settled = false;

      function finish(completed) {
        if (settled) return;
        settled = true;
        clearInterval(backupTimer);
        if (completed) {
          onProgress(1);
        }
        resolve(completed);
      }

      function tick() {
        if (settled) return;
        if (gen !== state.generation) {
          finish(false);
          return;
        }
        const elapsed = Math.max(0, performance.now() - startWall);
        const raw = Math.min(1, elapsed / durationMs);
        onProgress(raw);
        if (raw >= 1) {
          finish(true);
        } else {
          requestAnimationFrame(tick);
        }
      }

      const backupTimer = setInterval(() => {
        if (gen !== state.generation) {
          finish(false);
          return;
        }
        const elapsed = Math.max(0, performance.now() - startWall);
        const raw = Math.min(1, elapsed / durationMs);
        onProgress(raw);
        if (raw >= 1) {
          finish(true);
        }
      }, 30);

      requestAnimationFrame(tick);
    });
  }

  function delay(ms, gen) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(gen === state.generation);
      }, ms);
    });
  }

  async function animateHop(player, fromSq, toSq, gen) {
    const node = tokenNodes.get(player.id);
    if (!node) return false;
    tokensLayer.appendChild(node);

    const a = squareInfo(fromSq);
    const b = squareInfo(toSq);
    sound.playHop();

    return animateTween(135, gen, (t) => {
      const ease = 1 - Math.pow(1 - t, 2);
      const x = a.cx + (b.cx - a.cx) * ease;
      const y = a.cy + (b.cy - a.cy) * ease - Math.sin(t * Math.PI) * 11;
      node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    });
  }

  async function animateLadderClimb(player, ladder, gen) {
    const node = tokenNodes.get(player.id);
    if (!node) return false;
    tokensLayer.appendChild(node);

    const a = squareInfo(ladder.from);
    const b = squareInfo(ladder.to);
    sound.playLadder();

    return animateTween(580, gen, (t) => {
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = a.cx + (b.cx - a.cx) * ease;
      const y = a.cy + (b.cy - a.cy) * ease;
      node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    });
  }

  async function animateSnakeSlide(player, snake, gen) {
    const node = tokenNodes.get(player.id);
    if (!node) return false;
    tokensLayer.appendChild(node);
    sound.playSnake();

    return animateTween(780, gen, (t) => {
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pt = snakeCurvePoint(snake, ease);
      node.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
    });
  }

  // =========================================================================
  // SPOTLIGHT, LOGS & HUD RENDERING
  // =========================================================================

  function setSpotlight(config) {
    dom.spotBadge.className = `spot-badge ${config.badgeClass}`;
    dom.spotBadge.textContent = config.badge;
    dom.spotJump.textContent = config.jump;
    dom.spotTitle.textContent = config.title;
    dom.spotQuip.textContent = config.quip;

    if (config.prevent && config.detect && config.recover) {
      dom.spotTipBox.classList.add('is-hidden');
      dom.spotDebriefBox.classList.remove('is-hidden');
      dom.spotPrevent.textContent = config.prevent;
      dom.spotDetect.textContent = config.detect;
      dom.spotRecover.textContent = config.recover;
    } else {
      dom.spotDebriefBox.classList.add('is-hidden');
      dom.spotTipBox.classList.remove('is-hidden');
      dom.spotTip.textContent = config.tip || '';
    }

    setSafeDocLink(dom.spotDocLink, dom.spotDocText, config.docUrl, config.docLabel);
  }

  function highlightSelectedCell(sq) {
    const prev = cellElements.get(state.selectedSquare);
    if (prev) prev.classList.remove('cell-selected');
    state.selectedSquare = sq;
    const next = cellElements.get(sq);
    if (next && next.classList.contains('cell-interactive')) {
      next.classList.add('cell-selected');
    }
  }

  function selectSquareSpotlight(sq) {
    highlightSelectedCell(sq);
    const ladder = state.ladderByStart.get(sq);
    if (ladder) {
      const gain = ladder.to - ladder.from;
      setSpotlight({
        badge: `CLOUD UPLINK (+${gain} + BONUS ROLL)`,
        badgeClass: 'badge-ladder',
        jump: `Sq ${ladder.from} → Sq ${ladder.to}`,
        title: ladder.title,
        quip: ladder.quip,
        tip: ladder.tip,
        docLabel: ladder.docLabel,
        docUrl: ladder.docUrl
      });
      return;
    }

    const snake = state.snakeByStart.get(sq);
    if (snake) {
      const drop = snake.from - snake.to;
      setSpotlight({
        badge: `SEV-1 OUTAGE (-${drop})`,
        badgeClass: 'badge-snake',
        jump: `Sq ${snake.from} → Sq ${snake.to}`,
        title: snake.title,
        quip: snake.quip,
        tip: snake.tip,
        prevent: snake.prevent,
        detect: snake.detect,
        recover: snake.recover,
        docLabel: snake.docLabel,
        docUrl: snake.docUrl
      });
      return;
    }

    const shield = state.shieldBySquare.get(sq);
    if (shield) {
      setSpotlight({
        badge: 'SRE SHIELD GUARDRAIL',
        badgeClass: 'badge-shield',
        jump: `Square ${shield.square}`,
        title: shield.title,
        quip: shield.quip,
        tip: shield.tip,
        docLabel: shield.docLabel,
        docUrl: shield.docUrl
      });
      return;
    }

    if (state.milestones[sq]) {
      setSpotlight(state.milestones[sq]);
    }
  }

  function appendLog(severity, text) {
    const li = htmlEl('li', 'log-entry');
    const sev = htmlEl('span', `sev-tag sev-${severity}`, severity);
    const msg = htmlEl('span', 'log-msg', text);
    li.appendChild(sev);
    li.appendChild(msg);
    dom.logsList.prepend(li);

    while (dom.logsList.children.length > 32) {
      dom.logsList.lastElementChild.remove();
    }
  }

  function renderHUD() {
    const active = state.players[state.currentIdx];
    const humanCanAct = state.phase === 'IDLE_HUMAN' && !active.isBot;

    dom.rollBtn.disabled = !humanCanAct;
    dom.dieBtn.disabled = !humanCanAct;
    dom.rollKeyHint.classList.toggle('is-hidden', !humanCanAct);
    dom.modeEyebrow.textContent = state.mode === 'solo' ? 'Learning Mode · Solo Run' : 'Head-to-Head · 1P vs Bot';

    if (state.phase === 'GAME_OVER') {
      dom.turnTitle.textContent = `${active.name} Launched!`;
      dom.turnStatusPill.textContent = '99.999% SLA';
      dom.turnStatusPill.className = 'status-pill pill-burst';
      dom.rollBtnLabel.textContent = 'Launch Complete';
    } else if (active.isBot) {
      dom.turnTitle.textContent = 'Chaos Bot Deploying...';
      dom.rollBtnLabel.textContent = 'Chaos Bot\'s Turn...';
      if (state.bonusType === 'uplink') {
        dom.turnStatusPill.textContent = 'Bot Uplink Bonus!';
        dom.turnStatusPill.className = 'status-pill pill-uplink';
      } else if (state.bonusType === 'autoscaler') {
        dom.turnStatusPill.textContent = `Bot Burst (${state.consecutiveSixes}/2)`;
        dom.turnStatusPill.className = 'status-pill pill-burst';
      } else {
        dom.turnStatusPill.textContent = 'Bot Active';
        dom.turnStatusPill.className = 'status-pill';
      }
    } else {
      dom.turnTitle.textContent = state.mode === 'solo' ? 'Architect Console' : `${active.name}'s Turn`;
      if (state.phase === 'ANIMATING') {
        dom.rollBtnLabel.textContent = 'Moving...';
      } else if (state.phase === 'AWAITING_SHIELD' || state.phase === 'AWAITING_CHALLENGE') {
        dom.rollBtnLabel.textContent = 'Scenario Check...';
      } else if (state.bonusType !== null) {
        dom.rollBtnLabel.textContent = 'Bonus Roll!';
      } else {
        dom.rollBtnLabel.textContent = 'Roll Die';
      }

      if (state.bonusType === 'uplink') {
        dom.turnStatusPill.textContent = 'Uplink Bonus Roll!';
        dom.turnStatusPill.className = 'status-pill pill-uplink';
      } else if (state.bonusType === 'autoscaler') {
        dom.turnStatusPill.textContent = `Autoscaler Burst (${state.consecutiveSixes}/2)`;
        dom.turnStatusPill.className = 'status-pill pill-burst';
      } else {
        const labelPrefix = state.mode === 'solo' ? 'Roll' : 'Turn';
        dom.turnStatusPill.textContent = state.phase === 'ANIMATING' ? 'Moving...' : `${labelPrefix} ${state.turnCount}`;
        dom.turnStatusPill.className = 'status-pill';
      }
    }

    const pack = state.activePack || {};
    const totalScenarios =
      ((pack.ladders && pack.ladders.length) || 0) +
      ((pack.snakes && pack.snakes.length) || 0) +
      ((pack.shields && pack.shields.length) || 0) +
      2;
    dom.boardSeedTag.textContent = `Topology #${state.topologyNumber} · ${totalScenarios} Scenarios`;

    dom.playersList.replaceChildren();
    for (const p of state.players) {
      const row = htmlEl('div', p.id === active.id && state.phase !== 'GAME_OVER' ? 'player-row is-turn' : 'player-row');
      const top = htmlEl('div', 'player-top');

      const ident = htmlEl('div', 'player-ident');
      ident.appendChild(htmlEl('span', `p-swatch swatch-p${p.id}`));
      ident.appendChild(htmlEl('span', '', p.name));

      const meta = htmlEl('div', 'player-meta');
      if (state.mode === 'solo' && p.stats.checksTotal > 0) {
        meta.appendChild(
          htmlEl('span', 'shield-pill', `Checks: ${p.stats.checksPassed}/${p.stats.checksTotal}`)
        );
      }
      const shieldText = `Shields: ${p.shields.length}/${MAX_SHIELDS}`;
      const shieldPill = htmlEl(
        'span',
        p.shields.length > 0 ? 'shield-pill shield-armed' : 'shield-pill',
        shieldText
      );
      if (p.shields.length > 0) {
        shieldPill.title = `Active SRE Shields: ${p.shields.join(', ')}`;
      }
      meta.appendChild(shieldPill);
      meta.appendChild(htmlEl('span', 'sq-badge', `Sq ${p.pos}`));

      top.appendChild(ident);
      top.appendChild(meta);
      row.appendChild(top);

      const progSvg = svgEl('svg', { viewBox: '0 0 100 6', preserveAspectRatio: 'none', class: 'progress-svg' });
      progSvg.appendChild(svgEl('rect', { x: 0, y: 0, width: 100, height: 6, rx: 3, class: 'progress-track' }));
      progSvg.appendChild(svgEl('rect', { x: 0, y: 0, width: p.pos, height: 6, rx: 3, class: `progress-p${p.id}` }));
      row.appendChild(progSvg);

      dom.playersList.appendChild(row);
    }
  }

  // =========================================================================
  // LEARNING MODE CHALLENGE MODAL
  // =========================================================================

  function promptLearningChallenge(player, item, kind, gen) {
    return new Promise((resolve) => {
      if (gen !== state.generation) {
        resolve(null);
        return;
      }

      state.phase = 'AWAITING_CHALLENGE';
      renderHUD();

      const isLadder = kind === 'ladder';
      dom.challengeEyebrow.className = isLadder ? 'eyebrow eyebrow-uplink' : 'eyebrow eyebrow-alert';
      dom.challengeEyebrow.textContent = isLadder
        ? `Architecture Design Review · Square ${item.from}`
        : `SEV-1 Incident Triage · Square ${item.from}`;
      dom.challengeTitle.textContent = item.title;
      dom.challengeJumpPill.textContent = isLadder
        ? `Climb Sq ${item.from} → Sq ${item.to}`
        : `Risk: Slide Sq ${item.from} → Sq ${item.to}`;
      dom.challengeQuip.textContent = item.quip;
      dom.challengeQuestion.textContent = item.q;

      dom.challengeFeedback.classList.add('is-hidden');
      dom.challengeFooter.classList.add('is-hidden');
      dom.challengeDebrief.classList.add('is-hidden');

      let answered = false;
      let outcome = null;

      if (!isLadder && item.prevent && item.detect && item.recover) {
        dom.challengePrevent.textContent = item.prevent;
        dom.challengeDetect.textContent = item.detect;
        dom.challengeRecover.textContent = item.recover;
      }
      setSafeDocLink(dom.challengeDocLink, dom.challengeDocText, item.docUrl, item.docLabel);

      if (!isLadder && player.shields.length > 0) {
        const nextShield = player.shields[0];
        dom.challengeShieldLabel.textContent = `SRE Shield Ready: [${nextShield}]`;
        dom.btnChallengeShield.textContent = `Deploy [${nextShield}] Shield (Auto-Block)`;
        dom.btnChallengeShield.disabled = false;
        dom.challengeShieldBar.classList.remove('is-hidden');
        dom.btnChallengeShield.onclick = () => {
          if (answered) return;
          answered = true;
          outcome = { passed: true, usedShield: true };
          dom.challengeShieldBar.classList.add('is-hidden');
          for (const btn of Array.from(dom.challengeOptions.children)) {
            btn.disabled = true;
          }
          dom.challengeVerdict.className = 'verdict-banner verdict-shield';
          dom.challengeVerdict.textContent = `SRE Shield [${nextShield}] Deployed! Outage neutralized on Square ${item.from}.`;
          dom.challengeRationale.textContent = item.why;
          if (item.prevent) dom.challengeDebrief.classList.remove('is-hidden');
          dom.challengeFeedback.classList.remove('is-hidden');
          dom.btnChallengeContinue.textContent = `Hold Square ${item.from} & Continue →`;
          dom.challengeFooter.classList.remove('is-hidden');
          sound.playShieldBlock();
        };
      } else {
        dom.challengeShieldBar.classList.add('is-hidden');
      }

      const indexedOptions = (item.opts || []).map((text, idx) => ({
        text,
        isCorrect: idx === (item.ans || 0)
      }));
      const shuffled = cryptoShuffle(indexedOptions);
      const letters = ['A', 'B', 'C'];

      dom.challengeOptions.replaceChildren();
      shuffled.forEach((opt, i) => {
        const btn = htmlEl('button', 'option-btn');
        btn.type = 'button';
        btn.appendChild(htmlEl('span', 'option-key', letters[i] || String(i + 1)));
        btn.appendChild(htmlEl('span', '', opt.text));

        btn.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          player.stats.checksTotal += 1;
          if (opt.isCorrect) {
            player.stats.checksPassed += 1;
          }
          outcome = { passed: opt.isCorrect, usedShield: false };
          dom.challengeShieldBar.classList.add('is-hidden');

          const allBtns = Array.from(dom.challengeOptions.children);
          allBtns.forEach((b, idx) => {
            b.disabled = true;
            if (shuffled[idx].isCorrect) {
              b.classList.add('option-correct');
            } else if (idx === i) {
              b.classList.add('option-wrong');
            }
          });

          if (opt.isCorrect) {
            dom.challengeVerdict.className = 'verdict-banner verdict-pass';
            dom.challengeVerdict.textContent = isLadder
              ? `Design Approved! Climbing ${item.shortTag} to Square ${item.to} (+ Bonus Roll).`
              : `Blast Radius Contained! You triaged the SEV-1 and held Square ${item.from}.`;
            dom.btnChallengeContinue.textContent = isLadder
              ? `Climb to Sq ${item.to} (+ Bonus Roll) →`
              : `Hold Square ${item.from} & Continue →`;
            sound.playShieldGain();
          } else {
            dom.challengeVerdict.className = 'verdict-banner verdict-fail';
            dom.challengeVerdict.textContent = isLadder
              ? `Review Blocked — staying at Square ${item.from} this turn.`
              : `Uncontained SEV-1 — sliding down to Square ${item.to}.`;
            dom.btnChallengeContinue.textContent = isLadder
              ? `Stay on Sq ${item.from} & Continue →`
              : `Slide to Sq ${item.to} & Continue →`;
          }

          dom.challengeRationale.textContent = item.why || item.tip;
          if (!isLadder && item.prevent) {
            dom.challengeDebrief.classList.remove('is-hidden');
          }
          dom.challengeFeedback.classList.remove('is-hidden');
          dom.challengeFooter.classList.remove('is-hidden');
          renderHUD();
        });

        dom.challengeOptions.appendChild(btn);
      });

      state.pendingChallengeContinue = () => {
        if (!answered) return;
        state.pendingChallengeContinue = null;
        dom.challengeModal.classList.add('is-hidden');
        if (gen !== state.generation) {
          resolve(null);
          return;
        }
        state.phase = 'ANIMATING';
        renderHUD();
        resolve(outcome);
      };

      dom.challengeModal.classList.remove('is-hidden');
    });
  }

  // =========================================================================
  // 1P VS BOT SRE SHIELD PROMPT
  // =========================================================================

  function promptHumanShieldChoice(player, snake, gen) {
    return new Promise((resolve) => {
      if (gen !== state.generation) {
        resolve(null);
        return;
      }
      const nextShield = player.shields[0];
      const drop = snake.from - snake.to;

      state.phase = 'AWAITING_SHIELD';
      renderHUD();

      dom.shieldModalEyebrow.textContent = `SEV-1 Outage · Square ${snake.from} (-${drop} squares)`;
      dom.shieldModalTitle.textContent = snake.title;
      dom.shieldModalQuip.textContent = snake.quip;
      dom.shieldModalPrevent.textContent = snake.prevent || snake.tip;
      dom.shieldModalDetect.textContent = snake.detect || 'Cloud Monitoring & Security Command Center alerts.';
      dom.shieldModalRecover.textContent = snake.recover || 'Remediate configuration and restore known-good state.';
      setSafeDocLink(dom.shieldModalDoc, dom.shieldModalDocText, snake.docUrl, snake.docLabel);
      dom.shieldModalPrompt.textContent = `Deploy your [${nextShield}] SRE Shield to stay on Square ${snake.from}, or save it and slide down to Square ${snake.to}?`;
      dom.btnUseShield.textContent = `Deploy [${nextShield}] Shield (Stay on Sq ${snake.from})`;
      dom.btnSkipShield.textContent = `Save Shield & Slide to Sq ${snake.to}`;

      state.pendingShieldResolver = (useShield) => {
        state.pendingShieldResolver = null;
        dom.shieldModal.classList.add('is-hidden');
        if (gen !== state.generation) {
          resolve(null);
          return;
        }
        state.phase = 'ANIMATING';
        renderHUD();
        resolve(useShield);
      };

      dom.shieldModal.classList.remove('is-hidden');
    });
  }

  // =========================================================================
  // STRICT TURN EXECUTION
  // =========================================================================

  function requestHumanRoll() {
    if (state.phase !== 'IDLE_HUMAN') return;
    const actor = state.players[state.currentIdx];
    if (!actor || actor.isBot) return;

    state.phase = 'ANIMATING';
    state.turnSeq += 1;
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
      document.activeElement.blur();
    }
    renderHUD();
    runTurnForActor(actor.id, state.generation, state.turnSeq);
  }

  async function scheduleBotTurn(botId, gen, seq) {
    state.phase = 'BOT_DELAY';
    renderHUD();
    const ok = await delay(700, gen);
    if (!ok || seq !== state.turnSeq || state.phase !== 'BOT_DELAY') return;
    const active = state.players[state.currentIdx];
    if (!active || !active.isBot || active.id !== botId) return;

    state.phase = 'ANIMATING';
    renderHUD();
    runTurnForActor(botId, gen, seq);
  }

  async function runTurnForActor(actorId, gen, seq) {
    const isStale = () => gen !== state.generation || seq !== state.turnSeq;
    const player = state.players[state.currentIdx];
    if (!player || player.id !== actorId || isStale()) return;

    dom.dieSvg.classList.add('die-rolling');
    for (let i = 0; i < 5; i++) {
      renderDieFace(((i + state.lastRoll) % 6) + 1);
      if (!(await delay(50, gen)) || isStale()) {
        dom.dieSvg.classList.remove('die-rolling');
        return;
      }
    }
    dom.dieSvg.classList.remove('die-rolling');

    const rolled = rollCryptoDie();
    state.lastRoll = rolled;
    state.bonusType = null;
    player.stats.rolls += 1;
    renderDieFace(rolled);

    const startSq = player.pos;
    const steps = [];
    let cursor = startSq;
    let dir = 1;
    for (let s = 0; s < rolled; s++) {
      if (cursor === 100) dir = -1;
      cursor += dir;
      steps.push(cursor);
    }

    const bounced = startSq + rolled > 100;
    dom.rollCaption.textContent = bounced
      ? `${player.name} rolled ${rolled} — overshot 100 and bounced back to Sq ${cursor}!`
      : `${player.name} rolled a ${rolled} → moving ${startSq} → ${cursor}.`;

    appendLog(
      'INFO',
      `${player.name} rolled ${rolled} (Sq ${startSq} → Sq ${cursor})${bounced ? ' [bounce-back]' : ''}.`
    );

    let prevSq = startSq;
    for (const nextSq of steps) {
      const ok = await animateHop(player, prevSq, nextSq, gen);
      if (!ok || isStale()) return;
      prevSq = nextSq;
      player.pos = nextSq;
    }

    syncAllTokenPositions();
    renderHUD();

    if (!(await delay(220, gen)) || isStale()) return;

    if (player.pos === 100) {
      state.phase = 'GAME_OVER';
      selectSquareSpotlight(100);
      sound.playWin();
      appendLog('NOTICE', `${player.name} reached Square 100 (${state.milestones[100].shortTag})!`);
      renderHUD();
      showWinModal(player);
      return;
    }

    let climbedLadder = false;
    const ladder = state.ladderByStart.get(player.pos);
    if (ladder) {
      selectSquareSpotlight(player.pos);
      let allowClimb = true;

      if (state.mode === 'solo' && !player.isBot && ladder.q) {
        const res = await promptLearningChallenge(player, ladder, 'ladder', gen);
        if (res === null || isStale()) return;
        allowClimb = res.passed;
      }

      if (allowClimb) {
        climbedLadder = true;
        appendLog('NOTICE', `${player.name} deployed ${ladder.shortTag}! Climbed Sq ${ladder.from} → Sq ${ladder.to} (+ bonus roll).`);
        dom.rollCaption.textContent = `Cloud Uplink! ${ladder.title} boosted ${player.name} to Sq ${ladder.to} + Bonus Roll!`;

        const ok = await animateLadderClimb(player, ladder, gen);
        if (!ok || isStale()) return;

        player.pos = ladder.to;
        player.stats.ladders += 1;
        syncAllTokenPositions();
        renderHUD();
        if (!(await delay(200, gen)) || isStale()) return;
      } else {
        appendLog('INFO', `Architecture review missed for ${ladder.shortTag} at Sq ${ladder.from} — stayed at base.`);
        dom.rollCaption.textContent = `Review missed on ${ladder.shortTag} — staying on Square ${ladder.from}.`;
        renderHUD();
        if (!(await delay(200, gen)) || isStale()) return;
      }
    }

    let slidDownSnake = false;
    const snake = state.snakeByStart.get(player.pos);
    if (snake) {
      selectSquareSpotlight(player.pos);
      animateRingPulse(snake.from, 'snake-alert-ring', gen);

      if (state.mode === 'solo' && !player.isBot && snake.q) {
        const res = await promptLearningChallenge(player, snake, 'snake', gen);
        if (res === null || isStale()) return;

        if (res.usedShield && player.shields.length > 0) {
          const usedShield = player.shields.shift();
          player.stats.shieldsUsed += 1;
          animateRingPulse(snake.from, 'shield-burst', gen);
          syncAllTokenPositions();
          setSpotlight({
            badge: `MITIGATED BY SRE SHIELD (${usedShield})`,
            badgeClass: 'badge-shield',
            jump: `Held Square ${snake.from}!`,
            title: `Blocked: ${snake.title}`,
            quip: `"SEV-1 averted! Your [${usedShield}] guardrail contained the blast radius."`,
            prevent: snake.prevent,
            detect: snake.detect,
            recover: snake.recover,
            docLabel: snake.docLabel,
            docUrl: snake.docUrl
          });
          dom.rollCaption.textContent = `SRE Shield (${usedShield}) blocked ${snake.shortTag} — stayed on Sq ${snake.from}!`;
          appendLog('SHIELD', `${player.name} deployed [${usedShield}] shield to block ${snake.title} at Sq ${snake.from}!`);
          renderHUD();
          if (!(await delay(300, gen)) || isStale()) return;
        } else if (res.passed) {
          animateRingPulse(snake.from, 'shield-burst', gen);
          setSpotlight({
            badge: 'TRIAGE PASSED · BLAST CONTAINED',
            badgeClass: 'badge-shield',
            jump: `Held Square ${snake.from}!`,
            title: `Contained: ${snake.title}`,
            quip: `"Spot-on incident triage! You contained ${snake.shortTag} and held Square ${snake.from}."`,
            prevent: snake.prevent,
            detect: snake.detect,
            recover: snake.recover,
            docLabel: snake.docLabel,
            docUrl: snake.docUrl
          });
          dom.rollCaption.textContent = `Triage passed! Contained ${snake.shortTag} and held Square ${snake.from}.`;
          appendLog('NOTICE', `${player.name} triaged ${snake.title} correctly and held Square ${snake.from}!`);
          renderHUD();
          if (!(await delay(300, gen)) || isStale()) return;
        } else {
          slidDownSnake = true;
          appendLog('ERROR', `SEV-1! ${player.name} slid on ${snake.title}: Sq ${snake.from} → Sq ${snake.to}.`);
          dom.rollCaption.textContent = `SEV-1 Outage! ${snake.title} slid ${player.name} down to Square ${snake.to}.`;
          const ok = await animateSnakeSlide(player, snake, gen);
          if (!ok || isStale()) return;
          player.pos = snake.to;
          player.stats.snakes += 1;
          syncAllTokenPositions();
          renderHUD();
          if (!(await delay(220, gen)) || isStale()) return;
        }
      } else {
        let deployShield = false;
        if (player.shields.length > 0) {
          if (player.isBot) {
            if (!(await delay(380, gen)) || isStale()) return;
            deployShield = true;
          } else {
            const decision = await promptHumanShieldChoice(player, snake, gen);
            if (decision === null || isStale()) return;
            deployShield = decision;
          }
        } else {
          if (!(await delay(300, gen)) || isStale()) return;
        }

        if (deployShield && player.shields.length > 0) {
          const usedShield = player.shields.shift();
          player.stats.shieldsUsed += 1;
          sound.playShieldBlock();
          animateRingPulse(snake.from, 'shield-burst', gen);
          syncAllTokenPositions();

          setSpotlight({
            badge: `MITIGATED BY SRE SHIELD (${usedShield})`,
            badgeClass: 'badge-shield',
            jump: `Held Square ${snake.from}!`,
            title: `Blocked: ${snake.title}`,
            quip: `"SEV-1 averted! Your [${usedShield}] guardrail contained the blast radius before customers noticed."`,
            prevent: snake.prevent,
            detect: snake.detect,
            recover: snake.recover,
            docLabel: snake.docLabel,
            docUrl: snake.docUrl
          });
          dom.rollCaption.textContent = `SRE Shield (${usedShield}) blocked ${snake.shortTag} — stayed on Sq ${snake.from}!`;
          appendLog('SHIELD', `${player.name} deployed [${usedShield}] shield to block ${snake.title} at Sq ${snake.from}!`);
          renderHUD();
          if (!(await delay(420, gen)) || isStale()) return;
        } else {
          slidDownSnake = true;
          appendLog('ERROR', `SEV-1! ${player.name} hit ${snake.title} — sliding Sq ${snake.from} → Sq ${snake.to}.`);
          dom.rollCaption.textContent = `SEV-1 Outage! ${snake.title} slid ${player.name} down to Square ${snake.to}.`;

          const ok = await animateSnakeSlide(player, snake, gen);
          if (!ok || isStale()) return;

          player.pos = snake.to;
          player.stats.snakes += 1;
          syncAllTokenPositions();
          renderHUD();
          if (!(await delay(220, gen)) || isStale()) return;
        }
      }
    }

    const shield = state.shieldBySquare.get(player.pos);
    if (shield) {
      selectSquareSpotlight(player.pos);
      if (player.shields.length < MAX_SHIELDS) {
        player.shields.push(shield.shortTag);
        sound.playShieldGain();
        animateRingPulse(shield.square, 'shield-burst', gen);
        syncAllTokenPositions();
        dom.rollCaption.textContent = `SRE Shield armed: ${shield.title} (${player.shields.length}/${MAX_SHIELDS})!`;
        appendLog('SHIELD', `${player.name} armed SRE Shield [${shield.shortTag}] at Sq ${shield.square}.`);
      } else {
        dom.rollCaption.textContent = `Verified ${shield.title} — SRE Shield belt already full (${MAX_SHIELDS}/${MAX_SHIELDS}).`;
        appendLog('INFO', `${player.name} verified ${shield.shortTag} at Sq ${shield.square} (shields full at ${MAX_SHIELDS}/${MAX_SHIELDS}).`);
      }
      renderHUD();
      if (!(await delay(200, gen)) || isStale()) return;
    }

    if (climbedLadder) {
      if (rolled !== 6) {
        state.consecutiveSixes = 0;
      } else if (state.consecutiveSixes < 2) {
        state.consecutiveSixes += 1;
      }
      state.bonusType = 'uplink';
      state.turnSeq += 1;
      const nextSeq = state.turnSeq;
      dom.rollCaption.textContent = `${player.name} climbed a Cloud Uplink — roll again!`;

      if (player.isBot) {
        scheduleBotTurn(player.id, gen, nextSeq);
      } else {
        state.phase = 'IDLE_HUMAN';
        renderHUD();
      }
      return;
    }

    const hitSnakeWithoutShield = Boolean(snake) && slidDownSnake;
    if (rolled === 6 && hitSnakeWithoutShield) {
      appendLog('INFO', `Autoscaler halted: ${player.name} slid down a SEV-1 outage on a 6 — bonus roll forfeited.`);
    } else if (rolled === 6 && state.consecutiveSixes < 2) {
      state.consecutiveSixes += 1;
      state.bonusType = 'autoscaler';
      state.turnSeq += 1;
      const nextSeq = state.turnSeq;
      appendLog('INFO', `Autoscaler triggered on 6! ${player.name} earns a bonus roll.`);
      dom.rollCaption.textContent = `Rolled a 6! Autoscaler burst — ${player.name} rolls again.`;

      if (player.isBot) {
        scheduleBotTurn(player.id, gen, nextSeq);
      } else {
        state.phase = 'IDLE_HUMAN';
        renderHUD();
      }
      return;
    } else if (rolled === 6 && state.consecutiveSixes >= 2) {
      appendLog('INFO', `Autoscaler hit --max-instances cap for ${player.name}; rotating turn.`);
    }

    state.consecutiveSixes = 0;
    state.bonusType = null;
    const nextIdx = (state.currentIdx + 1) % state.players.length;
    if (nextIdx === 0) {
      state.turnCount += 1;
    }
    state.currentIdx = nextIdx;
    state.turnSeq += 1;
    const nextSeq = state.turnSeq;
    const nextPlayer = state.players[state.currentIdx];

    if (nextPlayer.isBot) {
      scheduleBotTurn(nextPlayer.id, gen, nextSeq);
    } else {
      state.phase = 'IDLE_HUMAN';
      renderHUD();
    }
  }

  function showWinModal(winner) {
    if (state.mode === 'solo') {
      const total = winner.stats.checksTotal;
      const passed = winner.stats.checksPassed;
      const ratio = total > 0 ? passed / total : 1;
      let rank = 'Principal Cloud Architect';
      if (ratio < 0.5) rank = 'Associate Cloud Builder';
      else if (ratio < 0.8) rank = 'Senior Cloud Architect';

      dom.winEyebrow.textContent = `99.999% SLA Achieved · Rank: ${rank}`;
      dom.winSummary.textContent = `You scaled from Square 1 to Square 100 in ${winner.stats.rolls} rolls and passed ${passed}/${total} architecture & triage checks!`;
    } else {
      dom.winEyebrow.textContent = 'SLO Target Achieved · 99.999%';
      dom.winSummary.textContent = `${winner.name} scaled all the way from Square 1 to Square 100 with five-nines reliability!`;
    }

    dom.winStats.replaceChildren();
    const items = state.mode === 'solo'
      ? [
          { val: winner.stats.rolls, lbl: 'Total Rolls' },
          { val: `${winner.stats.checksPassed}/${winner.stats.checksTotal}`, lbl: 'Checks Passed' },
          { val: winner.stats.ladders, lbl: 'Cloud Uplinks' },
          { val: winner.stats.shieldsUsed, lbl: 'Shield Saves' }
        ]
      : [
          { val: winner.stats.rolls, lbl: 'Total Rolls' },
          { val: winner.stats.ladders, lbl: 'Cloud Uplinks' },
          { val: winner.stats.shieldsUsed, lbl: 'Shield Saves' },
          { val: winner.stats.snakes, lbl: 'SEV-1 Slides' }
        ];

    for (const item of items) {
      const tile = htmlEl('div', 'stat-tile');
      tile.appendChild(htmlEl('span', 'stat-val', String(item.val)));
      tile.appendChild(htmlEl('span', 'stat-lbl', item.lbl));
      dom.winStats.appendChild(tile);
    }

    dom.winModal.classList.remove('is-hidden');
  }

  function resetGame(newMode) {
    state.generation += 1;
    state.turnSeq += 1;
    state.pendingShieldResolver = null;
    state.pendingChallengeContinue = null;
    dom.dieSvg.classList.remove('die-rolling');
    dom.shieldModal.classList.add('is-hidden');
    dom.challengeModal.classList.add('is-hidden');
    dom.winModal.classList.add('is-hidden');

    if (newMode) {
      state.mode = newMode;
    }

    randomizeBoardData();
    buildBoardSVG();

    state.players = createPlayers(state.mode);
    state.currentIdx = 0;
    state.consecutiveSixes = 0;
    state.bonusType = null;
    state.phase = 'IDLE_HUMAN';
    state.turnCount = 1;
    state.lastRoll = 1;

    dom.logsList.replaceChildren();
    renderDieFace(1);
    buildPlayerTokens();
    selectSquareSpotlight(1);

    const badgeName = (state.activePack && state.activePack.meta && state.activePack.meta.editionBadge) || 'Cloud Architect Edition';
    dom.rollCaption.textContent = state.mode === 'solo'
      ? 'Learning Mode: Pass design checks on Ladders to climb, and triage SEV-1 Snakes to hold your ground!'
      : '1P vs Bot: Race Chaos Bot to Square 100! Climbing a Ladder or rolling a 6 grants a bonus roll.';
    appendLog(
      'INFO',
      `Loaded [${badgeName}] · Topology #${state.topologyNumber} (${state.mode === 'solo' ? 'Learning Mode' : '1P vs Bot'}).`
    );
    renderHUD();
  }

  function bindEvents() {
    dom.rollBtn.addEventListener('click', () => requestHumanRoll());
    dom.dieBtn.addEventListener('click', () => requestHumanRoll());

    if (dom.packSelect) {
      dom.packSelect.addEventListener('change', () => {
        const nextPack = dom.packSelect.value;
        if (nextPack && nextPack !== state.activePackId) {
          activatePack(nextPack, true);
        }
      });
    }

    dom.btnChallengeContinue.addEventListener('click', () => {
      if (state.pendingChallengeContinue) state.pendingChallengeContinue();
    });

    dom.btnUseShield.addEventListener('click', () => {
      if (state.pendingShieldResolver) state.pendingShieldResolver(true);
    });
    dom.btnSkipShield.addEventListener('click', () => {
      if (state.pendingShieldResolver) state.pendingShieldResolver(false);
    });

    dom.resetBtn.addEventListener('click', () => resetGame());
    dom.playAgainBtn.addEventListener('click', () => resetGame());
    dom.inspectBoardBtn.addEventListener('click', () => {
      dom.winModal.classList.add('is-hidden');
    });

    for (const btn of dom.modeBtns) {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        if (!mode || mode === state.mode) return;
        for (const b of dom.modeBtns) {
          b.classList.toggle('is-active', b === btn);
        }
        resetGame(mode);
      });
    }

    dom.soundBtn.addEventListener('click', () => {
      sound.enabled = !sound.enabled;
      dom.soundBtn.setAttribute('aria-pressed', String(sound.enabled));
      dom.soundBtn.textContent = sound.enabled ? 'Sound: On' : 'Sound: Off';
      if (sound.enabled) sound.playHop();
    });

    dom.themeBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      dom.themeBtn.textContent = next === 'dark' ? 'Theme: Dark' : 'Theme: Light';
    });

    dom.rulesBtn.addEventListener('click', () => {
      dom.rulesModal.classList.remove('is-hidden');
    });
    dom.closeRulesBtn.addEventListener('click', () => {
      dom.rulesModal.classList.add('is-hidden');
    });
    dom.gotItRulesBtn.addEventListener('click', () => {
      dom.rulesModal.classList.add('is-hidden');
    });
    dom.rulesModal.addEventListener('click', (e) => {
      if (e.target === dom.rulesModal) dom.rulesModal.classList.add('is-hidden');
    });
    dom.winModal.addEventListener('click', (e) => {
      if (e.target === dom.winModal) dom.winModal.classList.add('is-hidden');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dom.rulesModal.classList.add('is-hidden');
        dom.winModal.classList.add('is-hidden');
        return;
      }
      if (!dom.challengeModal.classList.contains('is-hidden')) {
        if ((e.code === 'Space' || e.code === 'Enter') && !dom.challengeFooter.classList.contains('is-hidden')) {
          e.preventDefault();
          if (state.pendingChallengeContinue) state.pendingChallengeContinue();
        }
        return;
      }
      const modalsClosed =
        dom.rulesModal.classList.contains('is-hidden') &&
        dom.winModal.classList.contains('is-hidden') &&
        dom.shieldModal.classList.contains('is-hidden') &&
        dom.challengeModal.classList.contains('is-hidden');

      if (e.code === 'Space' && !e.repeat && modalsClosed) {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'SELECT') {
          e.preventDefault();
          requestHumanRoll();
        }
      }
    });
  }

  function init() {
    dom.brandTitle = document.getElementById('brand-title');
    dom.editionPill = document.getElementById('edition-pill');
    dom.brandSubtitle = document.getElementById('brand-subtitle');
    dom.packSelect = document.getElementById('pack-select');

    dom.boardSvg = document.getElementById('board-svg');
    dom.dieSvg = document.getElementById('die-svg');
    dom.dieBtn = document.getElementById('die-btn');
    dom.rollBtn = document.getElementById('roll-btn');
    dom.rollBtnLabel = document.getElementById('roll-btn-label');
    dom.rollKeyHint = document.getElementById('roll-key-hint');
    dom.rollCaption = document.getElementById('roll-caption');
    dom.modeEyebrow = document.getElementById('mode-eyebrow');
    dom.turnTitle = document.getElementById('turn-title');
    dom.turnStatusPill = document.getElementById('turn-status-pill');
    dom.playersList = document.getElementById('players-list');

    dom.spotBadge = document.getElementById('spot-badge');
    dom.spotJump = document.getElementById('spot-jump');
    dom.spotTitle = document.getElementById('spot-title');
    dom.spotQuip = document.getElementById('spot-quip');
    dom.spotTipBox = document.getElementById('spot-tip-box');
    dom.spotTip = document.getElementById('spot-tip');
    dom.spotDebriefBox = document.getElementById('spot-debrief-box');
    dom.spotPrevent = document.getElementById('spot-prevent');
    dom.spotDetect = document.getElementById('spot-detect');
    dom.spotRecover = document.getElementById('spot-recover');
    dom.spotDocLink = document.getElementById('spot-doc-link');
    dom.spotDocText = document.getElementById('spot-doc-text');

    dom.logsList = document.getElementById('logs-list');
    dom.boardSeedTag = document.getElementById('board-seed-tag');

    dom.soundBtn = document.getElementById('btn-sound');
    dom.themeBtn = document.getElementById('btn-theme');
    dom.rulesBtn = document.getElementById('btn-rules');
    dom.resetBtn = document.getElementById('btn-reset');
    dom.modeBtns = Array.from(document.querySelectorAll('.seg-btn'));

    dom.challengeModal = document.getElementById('challenge-modal');
    dom.challengeEyebrow = document.getElementById('challenge-eyebrow');
    dom.challengeTitle = document.getElementById('challenge-title');
    dom.challengeJumpPill = document.getElementById('challenge-jump-pill');
    dom.challengeQuip = document.getElementById('challenge-quip');
    dom.challengeShieldBar = document.getElementById('challenge-shield-bar');
    dom.challengeShieldLabel = document.getElementById('challenge-shield-label');
    dom.btnChallengeShield = document.getElementById('btn-challenge-shield');
    dom.challengeQuestion = document.getElementById('challenge-question');
    dom.challengeOptions = document.getElementById('challenge-options');
    dom.challengeFeedback = document.getElementById('challenge-feedback');
    dom.challengeVerdict = document.getElementById('challenge-verdict');
    dom.challengeRationale = document.getElementById('challenge-rationale');
    dom.challengeDebrief = document.getElementById('challenge-debrief');
    dom.challengePrevent = document.getElementById('challenge-prevent');
    dom.challengeDetect = document.getElementById('challenge-detect');
    dom.challengeRecover = document.getElementById('challenge-recover');
    dom.challengeDocLink = document.getElementById('challenge-doc-link');
    dom.challengeDocText = document.getElementById('challenge-doc-text');
    dom.challengeFooter = document.getElementById('challenge-footer');
    dom.btnChallengeContinue = document.getElementById('btn-challenge-continue');

    dom.shieldModal = document.getElementById('shield-modal');
    dom.shieldModalEyebrow = document.getElementById('shield-modal-eyebrow');
    dom.shieldModalTitle = document.getElementById('shield-modal-title');
    dom.shieldModalQuip = document.getElementById('shield-modal-quip');
    dom.shieldModalPrevent = document.getElementById('shield-modal-prevent');
    dom.shieldModalDetect = document.getElementById('shield-modal-detect');
    dom.shieldModalRecover = document.getElementById('shield-modal-recover');
    dom.shieldModalDoc = document.getElementById('shield-modal-doc');
    dom.shieldModalDocText = document.getElementById('shield-modal-doc-text');
    dom.shieldModalPrompt = document.getElementById('shield-modal-prompt');
    dom.btnUseShield = document.getElementById('btn-use-shield');
    dom.btnSkipShield = document.getElementById('btn-skip-shield');

    dom.rulesModal = document.getElementById('rules-modal');
    dom.closeRulesBtn = document.getElementById('close-rules-btn');
    dom.gotItRulesBtn = document.getElementById('got-it-rules-btn');

    dom.winModal = document.getElementById('win-modal');
    dom.winEyebrow = document.getElementById('win-eyebrow');
    dom.winSummary = document.getElementById('win-summary');
    dom.winStats = document.getElementById('win-stats');
    dom.inspectBoardBtn = document.getElementById('inspect-board-btn');
    dom.playAgainBtn = document.getElementById('play-again-btn');

    bindEvents();
    loadPackRegistryAndInitialPack();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
