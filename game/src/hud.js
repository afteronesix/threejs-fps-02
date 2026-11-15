// The DOM HUD: health, armour, ammo, money, timer, score, both teams'
// rosters, kill feed, bomb status, a top-down minimap, the buy menu and the
// round banner. It never touches the simulation; main.js pushes numbers in
// and reads the buy and play callbacks out. Every setter caches its last
// value and touches the DOM only on change.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const healthValue = el('health-value');
  const healthFill = el('health-fill');
  const armorValue = el('armor-value');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const grenadeFrag = el('grenade-frag');
  const grenadeSmoke = el('grenade-smoke');
  const moneyValue = el('money-value');
  const timerLabel = el('timer-label');
  const timerValue = el('timer-value');
  const scoreA = el('score-a');
  const scoreB = el('score-b');
  const roundValue = el('round-value');
  const rosterA = el('roster-a');
  const rosterB = el('roster-b');
  const killfeed = el('killfeed');
  const bombStatus = el('bomb-status');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const damageFlash = el('damage-flash');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerReason = el('banner-reason');
  const bannerPayout = el('banner-payout');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const spectate = el('spectate');
  const hint = el('hint');
  const minimap = el('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;

  const last = {};
  let hitTimer = 0;
  let rosterRows = { A: [], B: [] };

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(health, armor) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(health))));
      setText(armorValue, 'armor', armor > 0 ? String(Math.ceil(armor)) : '—');
      const pct = Math.max(0, Math.min(100, health));
      if (last.hpPct !== pct) {
        last.hpPct = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 25);
      }
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', name);
      el('ammo').classList.toggle('empty', mag === 0);
    },
    setGrenades(frag, smoke) {
      setText(grenadeFrag, 'frag', `FRAG x${frag}`);
      setText(grenadeSmoke, 'smoke', `SMOKE x${smoke}`);
    },
    setMoney(value) {
      setText(moneyValue, 'money', String(value)); // the $ lives in the HTML
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setTimer(label, seconds) {
      setText(timerLabel, 'tlabel', label);
      setText(timerValue, 'timer', formatTime(seconds));
      timerValue.classList.toggle('urgent', label === 'BOMB' || (label === 'ROUND' && seconds <= 10));
    },
    setScore(a, b, round) {
      setText(scoreA, 'sa', String(a));
      setText(scoreB, 'sb', String(b));
      setText(roundValue, 'round', `ROUND ${round}`);
    },
    buildRosters(namesA, namesB) {
      rosterRows = { A: [], B: [] };
      for (const [team, names, list] of [['A', namesA, rosterA], ['B', namesB, rosterB]]) {
        list.innerHTML = '';
        for (const name of names) {
          const row = document.createElement('div');
          row.className = 'roster-row';
          row.innerHTML = `<span class="roster-name">${name}</span><span class="roster-hp"><i></i></span>`;
          list.appendChild(row);
          rosterRows[team].push(row);
        }
      }
    },
    setRoster(team, index, health, alive) {
      const row = rosterRows[team]?.[index];
      if (!row) return;
      row.classList.toggle('dead', !alive);
      const bar = row.querySelector('.roster-hp i');
      bar.style.width = `${Math.max(0, health)}%`;
    },
    killfeedEntry(killer, victim, headshot, weapon) {
      const entry = document.createElement('div');
      entry.className = 'killfeed-entry';
      entry.innerHTML = `<b>${killer}</b> <span>${headshot ? '◉' : '▸'} ${weapon}</span> <b>${victim}</b>`;
      killfeed.prepend(entry);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => entry.remove(), 5000);
    },
    setBombStatus(text, urgent) {
      setText(bombStatus, 'bomb', text);
      bombStatus.classList.toggle('urgent', !!urgent);
      bombStatus.classList.toggle('hidden', !text);
    },
    setCrosshairGap(px) {
      const gap = Math.round(px);
      if (last.gap === gap) return;
      last.gap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, headshot, holdMs = 120) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('headshot', !!headshot);
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on', 'headshot');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlashOn() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 180);
    },
    setHint(text) { setText(hint, 'hint', text || ''); },
    setSpectate(text) {
      setText(spectate, 'spec', text || '');
      spectate.classList.toggle('hidden', !text);
    },
    showBanner(title, reason, payout) {
      bannerTitle.textContent = title;
      bannerReason.textContent = reason;
      bannerPayout.textContent = payout || '';
      banner.classList.remove('hidden');
    },
    hideBanner() { banner.classList.add('hidden'); },
    showBuyMenu(items, money, onBuy) {
      buyMenu.classList.remove('hidden');
      const list = el('buy-list');
      list.innerHTML = '';
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        button.disabled = money < item.price || !!item.owned;
        button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span>${item.owned ? '<span class="buy-owned">OWNED</span>' : ''}`;
        button.addEventListener('click', () => onBuy(item.id));
        list.appendChild(button);
      }
    },
    hideBuyMenu() { buyMenu.classList.add('hidden'); },
    buyMenuOpen() { return !buyMenu.classList.contains('hidden'); },
    showOverlay(title, copy, action) {
      overlayTitle.textContent = title;
      overlayCopy.textContent = copy;
      playButton.textContent = action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { playButton.addEventListener('click', handler); },

    // Minimap: the world's collider footprints, the sites, the actors and the
    // bomb, drawn from live state. Called a few times a second, not per frame.
    drawMinimap(world, sites, actors, bomb, player) {
      if (!mapCtx) return;
      const W = minimap.width;
      const H = minimap.height;
      const scaleX = W / 54;
      const scaleY = H / 42;
      const px = (x) => (x + 27) * scaleX;
      const py = (z) => (z + 21) * scaleY;
      mapCtx.fillStyle = '#141210';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.fillStyle = '#3d3325';
      for (const c of world.colliders) {
        if (c.min.y > 1.2) continue; // skip lintels and high cover
        mapCtx.fillRect(px(c.min.x), py(c.min.z), (c.max.x - c.min.x) * scaleX, (c.max.z - c.min.z) * scaleY);
      }
      for (const site of Object.values(sites)) {
        mapCtx.fillStyle = site.id === 'A' ? '#e8a33d' : '#e05d3d';
        mapCtx.globalAlpha = 0.5;
        mapCtx.fillRect(px(site.center.x - site.half), py(site.center.z - site.half), site.half * 2 * scaleX, site.half * 2 * scaleY);
        mapCtx.globalAlpha = 1;
      }
      for (const actor of actors) {
        if (!actor.alive) continue;
        mapCtx.fillStyle = actor.team === 'A' ? '#3ec6b8' : '#e05d3d';
        mapCtx.beginPath();
        mapCtx.arc(px(actor.position.x), py(actor.position.z), 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      if (bomb.state === 'dropped' || bomb.state === 'planted') {
        mapCtx.fillStyle = '#e8a33d';
        mapCtx.beginPath();
        mapCtx.arc(px(bomb.position.x), py(bomb.position.z), 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      if (player.alive) {
        const x = px(player.position.x);
        const y = py(player.position.z);
        mapCtx.fillStyle = '#ece5d8';
        mapCtx.save();
        mapCtx.translate(x, y);
        mapCtx.rotate(-player.yaw);
        mapCtx.beginPath();
        mapCtx.moveTo(0, -5);
        mapCtx.lineTo(4, 4);
        mapCtx.lineTo(-4, 4);
        mapCtx.closePath();
        mapCtx.fill();
        mapCtx.restore();
      }
    },
  };
}
