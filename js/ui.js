// ============================================================
//  Interface : barre du haut, panneau de sélection, commandes
// ============================================================
const BUILDING_ICONS = {
  town_center: '🏛️', house: '🏠', mill: '🌾', lumber_camp: '🪓', mining_camp: '⛏️', farm: '🌱', blacksmith: '⚒️',
  wonder: '🗿', barracks: '⚔️', archery_range: '🏹', stable: '🐎', siege_workshop: '🛠️', tower: '🗼', castle: '🏰',
};
const RESOURCE_ICONS = { tree: '🌳', gold: '🪙', stone: '🪨', berry: '🫐' };

function entityIcon(e) {
  if (e.kind === 'unit') return e.def.icon;
  if (e.kind === 'building') return BUILDING_ICONS[e.type];
  return RESOURCE_ICONS[e.type];
}

const UI = {
  menu: 'root', cmdKey: '', buttons: [], panelT: 0, idleIdx: 0,
  init() {
    this.el = {
      res: {}, pop: document.getElementById('r-pop'), age: document.getElementById('r-age'), time: document.getElementById('r-time'),
      idle: document.getElementById('idle-btn'), info: document.getElementById('info'), cmds: document.getElementById('commands'),
      msgs: document.getElementById('messages'), tip: document.getElementById('tooltip'), bottom: document.getElementById('bottom'),
    };
    for (const r of RES_TYPES) this.el.res[r] = document.getElementById('r-' + r);
    // Commandes : activation au mousedown (robuste aux rafraîchissements)
    this.el.cmds.addEventListener('mousedown', ev => {
      ev.stopPropagation();
      const b = ev.target.closest('.cmd');
      if (!b) return;
      const spec = this.buttons[+b.dataset.i];
      if (spec) this.runButton(spec, ev.shiftKey);
    });
    this.el.info.addEventListener('mousedown', ev => {
      ev.stopPropagation();
      const q = ev.target.closest('[data-cancel]');
      if (q) { const b = G.selection[0]; if (b && b.kind === 'building') { b.cancel(+q.dataset.cancel); Sound.play('click'); this.updatePanel(true); } return; }
      const s = ev.target.closest('[data-sel]');
      if (s) {
        const e = G.byId.get(+s.dataset.sel);
        if (!e) return;
        if (ev.shiftKey) G.selection = G.selection.filter(x => x !== e);
        else G.selection = [e];
        this.selectionChanged();
      }
    });
    document.addEventListener('mousemove', ev => this.moveTip(ev));
    this.el.idle.addEventListener('mousedown', ev => { ev.stopPropagation(); Input.selectIdleVillager(); });
    document.getElementById('menu-btn').addEventListener('mousedown', ev => { ev.stopPropagation(); this.togglePause(); });
    document.getElementById('bottom').addEventListener('contextmenu', ev => ev.preventDefault());
  },
  panelHeight() { return this.el ? this.el.bottom.offsetHeight : 180; },

  message(text, type = 'info') {
    if (!this.el) return;
    const d = document.createElement('div');
    d.className = 'msg ' + type;
    d.textContent = text;
    this.el.msgs.appendChild(d);
    while (this.el.msgs.children.length > 5) this.el.msgs.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 5500);
    setTimeout(() => d.remove(), 6500);
  },

  selectionChanged() {
    this.menu = 'root';
    this.cmdKey = '';
    this.updatePanel(true);
  },

  update(dt) {
    if (!G.running) return;
    const p = G.players[1];
    for (const r of RES_TYPES) {
      const v = Math.floor(p.res[r]);
      if (this.el.res[r].textContent !== String(v)) this.el.res[r].textContent = v;
    }
    const popTxt = `${p.pop}/${p.popCap}`;
    if (this.el.pop.textContent !== popTxt) this.el.pop.textContent = popTxt;
    this.el.pop.parentElement.classList.toggle('full', p.pop >= p.popCap);
    this.el.age.textContent = AGES[p.age].name + (p.ageing ? ' ⏳' : '');
    let t = formatTime(G.time);
    for (const pid of [1, 2]) if (G.players[pid].wonderTimer !== null) t += `  🗿 ${pid === 1 ? 'Vous' : 'Ennemi'} : ${formatTime(G.players[pid].wonderTimer)}`;
    this.el.time.textContent = t;
    const idle = this.idleVillagers().length;
    this.el.idle.textContent = `💤 ${idle}`;
    this.el.idle.classList.toggle('has', idle > 0);
    this.panelT -= dt;
    if (this.panelT <= 0) { this.panelT = 0.15; this.updatePanel(false); }
  },
  idleVillagers() { return G.entities.filter(e => e.alive && e.owner === 1 && e.kind === 'unit' && e.cls === 'villager' && !e.cmd); },

  // ------------- Panneau d'informations -------------
  updatePanel(force) {
    const sel = G.selection.filter(e => e.alive);
    this.el.info.innerHTML = this.infoHtml(sel);
    const specs = this.getCommands(sel);
    const key = specs.map(s => s.id).join('|') + '#' + this.menu;
    if (force || key !== this.cmdKey) {
      this.cmdKey = key;
      this.buttons = specs;
      this.el.cmds.innerHTML = specs.map((s, i) =>
        `<div class="cmd" data-i="${i}" data-tip="${i}"><span class="ic">${s.icon}</span>${s.key ? `<span class="hk">${s.key}</span>` : ''}${s.badge ? `<span class="badge">${s.badge}</span>` : ''}</div>`).join('');
    } else this.buttons = specs;
    // états
    [...this.el.cmds.children].forEach((d, i) => {
      const s = this.buttons[i];
      if (!s) return;
      d.classList.toggle('locked', !!s.locked);
      d.classList.toggle('poor', !s.locked && s.cost && !canAfford(G.players[1], s.cost));
      const bd = d.querySelector('.badge');
      if (s.badge && bd) bd.textContent = s.badge;
      else if (s.badge && !bd) d.insertAdjacentHTML('beforeend', `<span class="badge">${s.badge}</span>`);
      else if (!s.badge && bd) bd.remove();
    });
    if (this.tipIndex !== undefined) this.showTip(this.tipIndex);
  },
  infoHtml(sel) {
    if (!sel.length) {
      const p = G.players[1];
      return `<div class="info-empty"><div class="big-title">${AGES[p.age].name}</div>
        <div>Villageois : ${G.entities.filter(e => e.alive && e.owner === 1 && e.cls === 'villager').length} · Militaires : ${G.entities.filter(e => e.alive && e.owner === 1 && e.kind === 'unit' && e.cls !== 'villager').length}</div>
        <div class="hint">Clic gauche : sélectionner · Glisser : sélection multiple · Clic droit : ordre</div></div>`;
    }
    if (sel.length === 1) return this.singleInfo(sel[0]);
    const counts = {};
    return `<div class="multi">${sel.slice(0, 40).map(e => {
      const k = clamp(e.hp / e.maxHp, 0, 1);
      return `<div class="mini-unit" data-sel="${e.id}"><span>${entityIcon(e)}</span><i style="width:${k * 100}%;background:${k > 0.5 ? '#3ddc4a' : k > 0.25 ? '#f0c030' : '#e53d2e'}"></i></div>`;
    }).join('')}</div><div class="multi-count">${sel.length} sélectionné(s)</div>`;
  },
  singleInfo(e) {
    const ownerTxt = e.owner ? `<span style="color:${e.player.color}">${e.player.name}</span>` : 'Nature';
    let h = `<div class="single"><div class="portrait" style="border-color:${e.owner ? e.player.color : '#999'}">${entityIcon(e)}</div><div class="details">`;
    if (e.kind === 'resource') {
      h += `<div class="name">${e.def.name}</div><div>${ownerTxt}</div>`;
      h += `<div class="stat">${RES_ICON[e.resType]} ${Math.ceil(e.amount)} ${RES_LABEL[e.resType].toLowerCase()}</div>`;
      return h + '</div></div>';
    }
    const k = clamp(e.hp / e.maxHp, 0, 1);
    h += `<div class="name">${e.def.name} <small>${ownerTxt}</small></div>`;
    h += `<div class="hpbar"><i style="width:${k * 100}%"></i><span>${Math.ceil(e.hp)} / ${e.maxHp}</span></div>`;
    if (e.kind === 'unit') {
      h += `<div class="stats"><span title="Attaque">⚔️ ${e.atk()}</span><span title="Armure">🛡️ ${e.armor()}</span>`;
      if (e.def.range) h += `<span title="Portée">🎯 ${e.range()}</span>`;
      h += `<span title="Vitesse">👟 ${e.speed().toFixed(1)}</span></div>`;
      if (e.cls === 'villager') {
        let act = 'Inactif';
        if (e.cmd) act = { move: 'Se déplace', build: 'Construit', attack: 'Attaque', gather: e.cmd.sub === 'drop' ? 'Rapporte des ressources' : 'Récolte ' + RES_LABEL[e.cmd.resType].toLowerCase() }[e.cmd.type];
        h += `<div class="stat">${act}${e.carry > 0 ? ` · Porte ${RES_ICON[e.carryType]} ${e.carry}/${e.capacity()}` : ''}</div>`;
      } else if (e.def.bonus) {
        const labels = { cavalry: 'cavalerie', building: 'bâtiments', infantry: 'infanterie', archer: 'archers' };
        h += `<div class="stat small">Bonus : ${Object.entries(e.def.bonus).map(([c, v]) => `+${v} vs ${labels[c]}`).join(', ')}</div>`;
      }
    } else {
      if (!e.complete) h += `<div class="stat">En construction : ${Math.floor(e.progress * 100)}%</div>`;
      else {
        const parts = [];
        if (e.def.atk) parts.push(`⚔️ ${e.def.atk + e.player.mods.atk.building}`, `🎯 ${e.def.range}`);
        parts.push(`🛡️ ${e.def.armor}`);
        if (e.def.pop) parts.push(`👥 +${e.def.pop}`);
        if (e.walkable) parts.push(`🍖 ${Math.ceil(e.amount)} restants`);
        if (e.def.drop && e.type !== 'town_center') parts.push('Dépôt : ' + e.def.drop.map(r => RES_ICON[r]).join(''));
        h += `<div class="stats">${parts.map(p => `<span>${p}</span>`).join('')}</div>`;
        if (e.type === 'wonder' && e.player.wonderTimer !== null) h += `<div class="stat">Victoire dans ${formatTime(e.player.wonderTimer)}</div>`;
        if (e.owner === 1 && e.queue.length) {
          const it = e.queue[0];
          const rate = (it.kind === 'unit' && it.id !== 'villager') ? e.player.mods.trainSpeed : 1;
          const k2 = clamp(e.prod / it.time, 0, 1);
          h += `<div class="queue">` + e.queue.map((q, i) => `<div class="qi${i === 0 ? ' first' : ''}" data-cancel="${i}" title="Clic : annuler">${q.icon}${i === 0 ? `<i style="width:${k2 * 100}%"></i>` : ''}</div>`).join('') + `</div>`;
          const waiting = it.kind === 'unit' && !it.started;
          h += `<div class="stat small">${waiting ? '⚠️ En attente de population' : `${it.name} — ${Math.ceil((it.time - e.prod) / rate)}s`}</div>`;
        }
      }
    }
    return h + '</div></div>';
  },

  // ------------- Commandes -------------
  getCommands(sel) {
    const p = G.players[1];
    const own = sel.filter(e => e.owner === 1);
    if (!own.length || own.length !== sel.length) return [];
    const specs = [];
    const units = own.filter(e => e.kind === 'unit');
    if (units.length) {
      const hasVill = units.some(u => u.cls === 'villager');
      if (hasVill && this.menu === 'root') {
        specs.push({ id: 'eco', icon: '🏠', key: 'Q', tip: '<b>Bâtiments économiques</b>', action: () => { this.menu = 'eco'; this.updatePanel(true); } });
        specs.push({ id: 'mil', icon: '🏰', key: 'W', tip: '<b>Bâtiments militaires</b>', action: () => { this.menu = 'mil'; this.updatePanel(true); } });
      } else if (hasVill && (this.menu === 'eco' || this.menu === 'mil')) {
        for (const [type, d] of Object.entries(BUILDING_DEFS)) {
          if (d.page !== this.menu) continue;
          const ok = buildingRequirementMet(p, type);
          let req = '';
          if (p.age < d.age) req = `Nécessite : ${AGES[d.age].name}`;
          else if (!ok && d.req) req = `Nécessite : ${BUILDING_DEFS[d.req].name}`;
          specs.push({
            id: 'b_' + type, icon: BUILDING_ICONS[type], key: d.key, cost: d.cost, locked: !ok,
            tip: `<b>${d.name}</b> ${costHtml(d.cost)}<br>${d.desc}${req ? `<br><span class="req">${req}</span>` : ''}`,
            action: () => {
              if (!ok) { notify(req); Sound.play('error'); return; }
              if (!canAfford(p, d.cost)) { notify(`Pas assez de ${RES_LABEL[missingRes(p, d.cost)].toLowerCase()}.`); Sound.play('error'); return; }
              Input.placing = type;
            },
          });
        }
        specs.push({ id: 'back', icon: '↩️', key: 'Échap', tip: 'Retour', action: () => { this.menu = 'root'; this.updatePanel(true); } });
        return specs;
      }
      specs.push({ id: 'stop', icon: '✋', key: 'S', tip: '<b>Stop</b><br>Arrête l\'action en cours.', action: () => { units.forEach(u => u.stop()); } });
      specs.push({ id: 'del', icon: '💀', key: 'Suppr', tip: '<b>Supprimer</b><br>Tue les unités sélectionnées.', action: () => Input.deleteSelection() });
      return specs;
    }
    // Bâtiments : on prend le type du premier
    const b = own[0];
    if (!b.complete) {
      specs.push({ id: 'del', icon: '💀', key: 'Suppr', tip: '<b>Annuler la construction</b>', action: () => Input.deleteSelection() });
      return specs;
    }
    const same = own.filter(e => e.type === b.type && e.complete);
    const pickB = () => same.reduce((a, c) => (c.queue.length < a.queue.length ? c : a), same[0]);
    for (const u of b.def.train || []) {
      const d = UNIT_DEFS[u];
      const locked = p.age < d.age;
      const n = same.reduce((a, c) => a + c.queue.filter(q => q.kind === 'unit' && q.id === u).length, 0);
      specs.push({
        id: 'u_' + u, icon: d.icon, key: d.key, cost: d.cost, locked, badge: n ? String(n) : '',
        tip: `<b>${d.name}</b> ${costHtml(d.cost)} ⏱️ ${d.time}s<br>${d.desc}<br><small>PV ${d.hp} · Att ${d.atk} · Arm ${d.armor}${d.range ? ' · Portée ' + d.range : ''}</small><br><small>Maj+clic : x5</small>${locked ? `<br><span class="req">Nécessite : ${AGES[d.age].name}</span>` : ''}`,
        action: (shift) => {
          if (locked) { notify(`Nécessite : ${AGES[d.age].name}`); Sound.play('error'); return; }
          const times = shift ? 5 : 1;
          for (let i = 0; i < times; i++) if (!pickB().enqueue('unit', u, i > 0)) break;
        },
      });
    }
    for (const t of b.def.techs || []) {
      const d = TECH_DEFS[t];
      if (p.techs.has(t)) continue;
      const researching = p.researching.has(t);
      const locked = p.age < d.age || (d.requires && !p.techs.has(d.requires)) || researching;
      let req = '';
      if (p.age < d.age) req = `Nécessite : ${AGES[d.age].name}`;
      else if (d.requires && !p.techs.has(d.requires)) req = `Nécessite : ${TECH_DEFS[d.requires].name}`;
      else if (researching) req = 'Recherche en cours…';
      specs.push({
        id: 't_' + t, icon: d.icon, key: d.key, cost: d.cost, locked,
        tip: `<b>${d.name}</b> ${costHtml(d.cost)} ⏱️ ${d.time}s<br>${d.desc}${req ? `<br><span class="req">${req}</span>` : ''}`,
        action: () => { if (locked) { notify(req); Sound.play('error'); return; } pickB().enqueue('tech', t); },
      });
    }
    if (b.def.ageUp && p.age < AGES.length - 1) {
      const a = AGES[p.age + 1];
      specs.push({
        id: 'age', icon: '⏫', key: 'A', cost: a.cost, locked: p.ageing,
        tip: `<b>Passer à l'${a.name}</b> ${costHtml(a.cost)} ⏱️ ${a.time}s<br>Débloque de nouvelles unités, bâtiments et technologies.${p.ageing ? '<br><span class="req">En cours…</span>' : ''}`,
        action: () => { if (p.ageing) return; b.enqueue('age'); },
      });
    }
    specs.push({ id: 'del', icon: '💀', key: 'Suppr', tip: '<b>Détruire le bâtiment</b>', action: () => Input.deleteSelection() });
    return specs;
  },
  runButton(spec, shift) {
    spec.action(shift);
    this.updatePanel(true);
  },
  handleHotkey(key) {
    const k = key.toUpperCase();
    const spec = this.buttons.find(s => s.key === k);
    if (spec) { this.runButton(spec, Input.shift); return true; }
    return false;
  },

  // ------------- Info-bulles -------------
  moveTip(ev) {
    const t = ev.target.closest && ev.target.closest('.cmd');
    if (!t) { this.tipIndex = undefined; this.el.tip.style.display = 'none'; return; }
    this.tipIndex = +t.dataset.i;
    this.showTip(this.tipIndex);
    const r = this.el.tip.getBoundingClientRect();
    this.el.tip.style.left = Math.min(window.innerWidth - r.width - 8, ev.clientX - r.width / 2) + 'px';
    this.el.tip.style.top = (window.innerHeight - this.panelHeight() - r.height - 10) + 'px';
  },
  showTip(i) {
    const s = this.buttons[i];
    if (!s) { this.el.tip.style.display = 'none'; return; }
    if (this.el.tip.dataset.html !== s.tip) { this.el.tip.innerHTML = s.tip; this.el.tip.dataset.html = s.tip; }
    this.el.tip.style.display = 'block';
  },

  // ------------- Écrans -------------
  togglePause(force) {
    if (!G.running || G.over) return;
    G.paused = force !== undefined ? force : !G.paused;
    document.getElementById('pause').classList.toggle('show', G.paused);
  },
  showEnd(victory, reason) {
    const el = document.getElementById('end');
    const p1 = G.players[1], p2 = G.players[2];
    const rows = [['Temps de jeu', formatTime(G.time), ''], ['Âge atteint', AGES[p1.age].name, AGES[p2.age].name],
      ['Unités formées', p1.stats.trained, p2.stats.trained], ['Unités tuées', p1.stats.killed, p2.stats.killed],
      ['Unités perdues', p1.stats.lost, p2.stats.lost], ['Bâtiments construits', p1.stats.built, p2.stats.built],
      ['Bâtiments détruits', p1.stats.razed, p2.stats.razed], ['Ressources récoltées', p1.stats.gathered, p2.stats.gathered]];
    el.querySelector('.end-title').textContent = victory ? '🏆 Victoire !' : '💀 Défaite…';
    el.querySelector('.end-title').className = 'end-title ' + (victory ? 'win' : 'lose');
    el.querySelector('.end-reason').textContent = victory
      ? (reason === 'Merveille' ? 'Votre Merveille a résisté : votre civilisation domine le monde !' : 'Vous avez conquis la civilisation ennemie !')
      : (reason === 'Merveille' ? 'La Merveille ennemie a résisté trois minutes…' : 'Votre civilisation a été anéantie.');
    el.querySelector('tbody').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
    el.classList.add('show');
  },
};
