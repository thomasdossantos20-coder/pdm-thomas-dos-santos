/* PDM — Dojo : 4 mini-jeux tactiles. Un appui court joue, un glissé fait défiler la page. */
(function(){
"use strict";
const FX = () => window.FX || { burst(){}, burstFrom(){}, drawShuriken(){}, drawLeaf(){}, RM:false };
const vibrate = p => { if(navigator.vibrate) try{ navigator.vibrate(p); }catch(e){} };

/* Appui court = action. Un glissé (défilement) n'est pas compté. */
function onTap(el, fn){
  let sx, sy, st, tDown, id = null;
  el.addEventListener("pointerdown", e => { if(e.button > 0) return; id = e.pointerId; sx = e.clientX; sy = e.clientY; st = scrollY; tDown = e.timeStamp; });
  el.addEventListener("pointerup", e => {
    if(e.pointerId !== id) return; id = null;
    if(Math.hypot(e.clientX - sx, e.clientY - sy) > 12 || Math.abs(scrollY - st) > 4 || e.timeStamp - tDown > 700) return;
    const r = el.getBoundingClientRect(); fn(sx - r.left, sy - r.top, tDown);
  });
  el.addEventListener("pointercancel", () => { id = null; });
}

/* Sons courts (Web Audio), créés au premier appui */
let AC = null;
function tone(freq, ms=140, type="sine", vol=.12){
  try{ AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + ms/1000);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + ms/1000 + .02); }catch(e){}
}

/* =================== 1. Défi shuriken =================== */
const shuriken = {
  id:"shuriken", name:"Défi shuriken", icon:"🍔", unit:"pts", lowerBetter:false,
  desc:"Abats la malbouffe, épargne les protéines.",
  howto:"Touche un aliment pour lancer un shuriken dessus. Enchaîne la malbouffe sans rater pour monter le combo jusqu'à ×5. Toucher une protéine coûte 15 points. 30 secondes.",
  legend:'<div class="legend-food"><span class="bad">🍔 🍟 🍕 🥤 🍩 à abattre</span><span class="good">🥛 🍗 🥚 🍌 🍚 à épargner</span></div>',
  fmt: s => `${s} pts`,
  mount(stage, api){
    stage.insertAdjacentHTML("beforeend", `<canvas class="g-canvas" aria-label="Zone du défi shuriken"></canvas>
      <div class="game-hud"><span class="score">0</span><span class="combo"></span><span class="time">30 s</span></div>`);
    const cv = stage.querySelector("canvas"), ctx = cv.getContext("2d");
    const hS = stage.querySelector(".score"), hT = stage.querySelector(".time"), hC = stage.querySelector(".combo");
    const DPR = Math.min(devicePixelRatio || 1, 2), DUR = 30;
    const BAD = ["🍔","🍟","🍕","🥤","🍩"], GOOD = ["🥛","🍗","🥚","🍌","🍚"];
    const EF = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif', spr = {};
    let W, H, items, shots, parts, fl, score, combo, comboT, left, spawnT, run = false, last = 0, flash, hits, miss, raf, stars;
    const sprite = e => spr[e] || (spr[e] = (() => { const c = document.createElement("canvas"); c.width = c.height = 96;
      const x = c.getContext("2d"); x.font = `76px ${EF}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(e, 48, 52); return c; })());
    function size(){ const r = cv.getBoundingClientRect(); W = r.width; H = r.height; cv.width = W*DPR; cv.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
      stars = Array.from({length:36}, () => ({x:Math.random()*W, y:Math.random()*H*.5, s:Math.random()*1.4+.4})); }
    function spawn(){ const good = Math.random() < .3, e = (good ? GOOD : BAD)[Math.floor(Math.random()*5)];
      const sz = Math.max(56, Math.min(W,H)*.14), x = sz + Math.random()*(W - sz*2), tx = W*.2 + Math.random()*W*.6, g = 900;
      const peak = H*(.12 + Math.random()*.3), vy = -Math.sqrt(2*g*(H + sz - peak));
      items.push({ e, good, x, y: H + sz*.6, vx: (tx-x)/1.4*.5, vy, g, sz, r: sz*.45, a: Math.random()*6, va: (Math.random()-.5)*4 }); }
    function seg(s, it){ const vx = s.x-s.px, vy = s.y-s.py, wx = it.x-s.px, wy = it.y-s.py, l = vx*vx+vy*vy || 1;
      const t = Math.max(0, Math.min(1, (wx*vx+wy*vy)/l)), cx = s.px+vx*t-it.x, cy = s.py+vy*t-it.y; return cx*cx+cy*cy < it.r*it.r; }
    function boom(x, y, cols, n){ for(let i=0;i<n;i++){ const a = Math.random()*6.28, v = 120+Math.random()*300;
      parts.push({x, y, vx:Math.cos(a)*v, vy:Math.sin(a)*v-160, a:0, va:(Math.random()-.5)*10, s:4+Math.random()*6, life:.9+Math.random()*.4, c:cols[i%cols.length]}); } }
    function step(now){
      if(!run) return; const dt = Math.min(.04, (now-last)/1000); last = now;
      left -= dt; if(left <= 0){ left = 0; draw(now/1000); return finish(); }
      const pr = 1 - left/DUR; spawnT -= dt;
      if(spawnT <= 0){ spawn(); if(pr > .45 && Math.random() < .35) spawn(); spawnT = .85 - pr*.45 + Math.random()*.25; }
      if(comboT > 0 && (comboT -= dt) <= 0) combo = 1;
      flash = Math.max(0, flash - dt*2.5);
      items.forEach(it => { it.vy += it.g*dt; it.x += it.vx*dt; it.y += it.vy*dt; it.a += it.va*dt; });
      items = items.filter(it => !it.hit && it.y < H + it.sz*1.2);
      shots.forEach(s => { s.px = s.x; s.py = s.y; s.x += s.vx*dt; s.y += s.vy*dt; s.a += dt*28; s.life -= dt;
        for(const it of items){ if(it.hit || !seg(s, it)) continue; it.hit = true; s.life = 0;
          if(it.good){ score = Math.max(0, score-15); combo = 1; comboT = 0; flash = 1; miss++; fl.push({x:it.x, y:it.y, t:"-15 protéine !", c:"#FF6B5E", life:1.2}); boom(it.x,it.y,["#FF6B5E","#F3E6C9"],10); vibrate([40,30,40]); tone(160,200,"square",.06); }
          else { const p = 10*combo; score += p; hits++; fl.push({x:it.x, y:it.y, t:`+${p}`, c: combo>1 ? "#FFB24D" : "#fff", life:.9});
            combo = Math.min(5, combo + (comboT > 0 ? 1 : 0)); comboT = 1.3; boom(it.x,it.y,["#FF8A1F","#4DBA74","#FFB24D","#F3E6C9"],16);
            parts.push({half:-1, e:it.e, x:it.x, y:it.y, vx:-140, vy:-180, a:it.a, va:-6, sz:it.sz, life:1}, {half:1, e:it.e, x:it.x, y:it.y, vx:140, vy:-160, a:it.a, va:6, sz:it.sz, life:1});
            vibrate(12); tone(520 + combo*80, 90, "triangle", .08); }
          break; } });
      shots = shots.filter(s => s.life > 0 && s.x > -40 && s.x < W+40 && s.y > -40);
      parts.forEach(p => { p.vy += 900*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.a += p.va*dt; p.life -= dt; }); parts = parts.filter(p => p.life > 0);
      fl.forEach(f => { f.y -= 60*dt; f.life -= dt; }); fl = fl.filter(f => f.life > 0);
      hS.textContent = score; hT.textContent = Math.ceil(left) + " s"; hC.textContent = combo > 1 ? `Combo ×${combo}` : "";
      draw(now/1000); raf = requestAnimationFrame(step);
    }
    function draw(t){
      const g = ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"#0A0F26"); g.addColorStop(.7,"#1A2150"); g.addColorStop(1,"#2B2245");
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      stars.forEach(s => { ctx.fillStyle = `rgba(255,240,210,${.4+.3*Math.sin(t*2+s.x)})`; ctx.fillRect(s.x, s.y, s.s, s.s); });
      const mx = W*.82, my = H*.16, mr = Math.min(W,H)*.07, h = ctx.createRadialGradient(mx,my,mr*.5,mx,my,mr*4);
      h.addColorStop(0,"rgba(255,220,160,.28)"); h.addColorStop(1,"rgba(255,220,160,0)"); ctx.fillStyle = h; ctx.beginPath(); ctx.arc(mx,my,mr*4,0,6.29); ctx.fill();
      ctx.fillStyle = "#F6E2B6"; ctx.beginPath(); ctx.arc(mx,my,mr,0,6.29); ctx.fill();
      ctx.strokeStyle = "rgba(255,236,200,.05)"; ctx.lineWidth = 2;
      for(let x = 0; x < W; x += 70){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      const fy = H - 40; ctx.fillStyle = "#3a2414"; ctx.fillRect(0, fy, W, 40); ctx.fillStyle = "#5B3A22"; ctx.fillRect(0, fy, W, 4);
      ctx.save(); ctx.translate(W/2, H-14); ctx.rotate(t*2); FX().drawShuriken(ctx, 16, "#D9DEE8"); ctx.restore();
      items.forEach(it => { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.a*.3);
        if(it.good){ ctx.fillStyle = "rgba(255,107,94,.18)"; ctx.beginPath(); ctx.arc(0,0,it.r*1.05,0,6.29); ctx.fill(); }
        ctx.drawImage(sprite(it.e), -it.sz/2, -it.sz/2, it.sz, it.sz); ctx.restore(); });
      parts.forEach(p => { ctx.save(); ctx.globalAlpha = Math.min(1, p.life*1.5); ctx.translate(p.x,p.y); ctx.rotate(p.a);
        if(p.half){ ctx.beginPath(); ctx.rect(p.half < 0 ? -p.sz/2 : 0, -p.sz/2, p.sz/2, p.sz); ctx.clip(); ctx.drawImage(sprite(p.e), -p.sz/2, -p.sz/2, p.sz, p.sz); }
        else FX().drawLeaf(ctx, p.s, p.c); ctx.restore(); });
      shots.forEach(s => { ctx.strokeStyle = "rgba(255,210,150,.35)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.px - s.vx*.03, s.py - s.vy*.03); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a); FX().drawShuriken(ctx, 12, "#E8ECF4"); ctx.restore(); });
      ctx.textAlign = "center"; ctx.font = `400 19px "Dela Gothic One", sans-serif`;
      fl.forEach(f => { ctx.globalAlpha = Math.min(1, f.life*1.6); ctx.fillStyle = f.c; const hw = ctx.measureText(f.t).width/2 + 8; ctx.fillText(f.t, Math.max(hw, Math.min(W-hw, f.x)), f.y); });
      ctx.globalAlpha = 1; if(flash > 0){ ctx.fillStyle = `rgba(255,70,60,${flash*.25})`; ctx.fillRect(0,0,W,H); }
    }
    function finish(){ run = false; api.end(score, `${hits} malbouffe${hits>1?"s":""} abattue${hits>1?"s":""}, ${miss} protéine${miss>1?"s":""} gaspillée${miss>1?"s":""}.`); }
    let lastShot = 0;
    onTap(cv, (x, y) => { if(!run) return; const n = performance.now(); if(n - lastShot < 90) return; lastShot = n;
      const ox = W/2, oy = H-14, dx = x-ox, dy = y-oy, d = Math.hypot(dx,dy) || 1; shots.push({x:ox, y:oy, px:ox, py:oy, vx:dx/d*1900, vy:dy/d*1900, a:0, life:1.1}); tone(880,40,"sine",.04); });
    const onResize = () => { if(!run){ size(); draw(0); } };
    addEventListener("resize", onResize);
    size(); items = []; shots = []; parts = []; fl = []; draw(0);
    return {
      start(){ size(); items = []; shots = []; parts = []; fl = []; score = 0; combo = 1; comboT = 0; left = DUR; spawnT = .3; flash = 0; hits = 0; miss = 0;
        hS.textContent = "0"; hT.textContent = DUR + " s"; hC.textContent = ""; run = true; last = performance.now(); raf = requestAnimationFrame(step); },
      destroy(){ run = false; cancelAnimationFrame(raf); removeEventListener("resize", onResize); }
    };
  }
};

/* =================== 2. Dégaine le kunai (réflexes) =================== */
const reflexe = {
  id:"reflexe", name:"Dégaine le kunai", icon:"⚡", unit:"ms", lowerBetter:true,
  desc:"Teste tes réflexes de ninja.",
  howto:"Attends que le panneau devienne orange, puis touche-le le plus vite possible. 5 essais, on garde ta moyenne. Toucher trop tôt compte l'essai à 600 ms.",
  fmt: s => `${s} ms`,
  mount(stage, api){
    stage.insertAdjacentHTML("beforeend", `<div class="rx" data-st="idle"><div class="rx-in"><div class="rx-kunai" aria-hidden="true"></div>
      <div class="rx-big">Prêt ?</div><div class="rx-sub"></div><div class="rx-dots"></div></div></div>`);
    const box = stage.querySelector(".rx"), big = stage.querySelector(".rx-big"), sub = stage.querySelector(".rx-sub"), dots = stage.querySelector(".rx-dots");
    let times = [], goAt = 0, timer = null, state = "idle", run = false;
    const set = (st, b, s) => { state = st; box.dataset.st = st; big.textContent = b; sub.textContent = s || ""; };
    const drawDots = () => { dots.innerHTML = Array.from({length:5}, (_,i) => `<i class="${i < times.length ? "on" : ""}">${times[i] != null ? times[i] : ""}</i>`).join(""); };
    function round(){
      drawDots(); set("wait", "Attends…", `Essai ${times.length + 1} sur 5`);
      clearTimeout(timer); timer = setTimeout(() => { goAt = performance.now(); set("go", "Maintenant !", ""); tone(990,90,"square",.06); }, 1100 + Math.random()*2400);
    }
    onTap(box, (x, y, tDown) => {
      if(!run) return;
      if(state === "wait"){ clearTimeout(timer); times.push(600); vibrate([40,30,40]); tone(150,220,"sawtooth",.05);
        set("early", "Trop tôt", "Essai compté 600 ms"); return setTimeout(next, 900); }
      if(state === "go"){ const ms = Math.max(80, Math.round(tDown - goAt)); times.push(ms); vibrate(15); tone(660,80,"triangle",.07);
        set("hit", `${ms} ms`, ms < 250 ? "Réflexe de jônin" : ms < 330 ? "Rapide" : "Tu peux mieux faire"); FX().burstFrom(big, 14); return setTimeout(next, 900); }
    });
    function next(){ if(times.length >= 5){ run = false; drawDots(); const avg = Math.round(times.reduce((a,b)=>a+b,0)/5);
      set("idle", `${avg} ms`, "de moyenne"); return api.end(avg, `Tes 5 essais : ${times.join(", ")} ms.`); } round(); }
    drawDots();
    return { start(){ times = []; run = true; round(); }, destroy(){ run = false; clearTimeout(timer); } };
  }
};

/* =================== 3. Mémoire des sceaux =================== */
const memoire = {
  id:"memoire", name:"Mémoire des sceaux", icon:"🔴", unit:"niv.", lowerBetter:false,
  desc:"Retiens la séquence, chaque niveau en ajoute un.",
  howto:"Regarde les sceaux s'allumer, puis touche-les dans le même ordre. Chaque réussite rallonge la séquence d'un sceau. Une erreur et c'est fini.",
  fmt: s => `niveau ${s}`,
  mount(stage, api){
    const SEALS = [["火","Feu","#E2483D",262],["水","Eau","#3E8EE8",330],["木","Bois","#3FAE6A",392],["風","Vent","#F0A13A",523]];
    stage.insertAdjacentHTML("beforeend", `<div class="mem"><div class="mem-info"><b class="mem-lvl">Niveau 0</b><span class="mem-msg">Touche « Lancer » pour commencer</span></div>
      <div class="mem-grid">${SEALS.map(([k,n,c],i) => `<button type="button" class="seal-btn" data-i="${i}" style="--c:${c}" aria-label="Sceau ${n}" disabled><span>${k}</span><small>${n}</small></button>`).join("")}</div></div>`);
    const btns = [...stage.querySelectorAll(".seal-btn")], lvl = stage.querySelector(".mem-lvl"), msg = stage.querySelector(".mem-msg");
    let seq = [], pos = 0, accept = false, run = false, timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    function light(i, ms){ const b = btns[i]; b.classList.add("lit"); tone(SEALS[i][3], ms*.9, "triangle", .1); later(() => b.classList.remove("lit"), ms); }
    function play(){
      accept = false; btns.forEach(b => b.disabled = true); msg.textContent = "Regarde bien…";
      const sp = Math.max(260, 560 - seq.length*22);
      seq.forEach((i, k) => later(() => light(i, sp*.75), 500 + k*sp));
      later(() => { accept = true; pos = 0; btns.forEach(b => b.disabled = false); msg.textContent = "À toi"; }, 500 + seq.length*sp);
    }
    function nextLevel(){ seq.push(Math.floor(Math.random()*4)); lvl.textContent = `Niveau ${seq.length}`; play(); }
    btns.forEach(b => b.addEventListener("click", () => {
      if(!run || !accept) return; const i = +b.dataset.i; light(i, 220);
      if(i !== seq[pos]){ run = false; accept = false; btns.forEach(x => x.disabled = true); vibrate([60,40,60]); tone(110,350,"sawtooth",.06);
        b.classList.add("wrong"); later(() => b.classList.remove("wrong"), 600);
        const reached = seq.length - 1; msg.textContent = "Raté";
        return later(() => api.end(reached, `La séquence suivante faisait ${seq.length} sceaux.`), 700); }
      if(++pos === seq.length){ accept = false; msg.textContent = "Bien joué"; FX().burstFrom(lvl, 12); later(nextLevel, 700); }
    }));
    return { start(){ seq = []; run = true; nextLevel(); }, destroy(){ run = false; timers.forEach(clearTimeout); } };
  }
};

/* =================== 4. Coupe le bambou (timing) =================== */
const bambou = {
  id:"bambou", name:"Coupe le bambou", icon:"🎋", unit:"coupes", lowerBetter:false,
  desc:"Frappe pile dans la zone, elle rétrécit à chaque coupe.",
  howto:"La lame va et vient sur le bambou. Touche l'écran quand elle est dans la zone verte. À chaque coupe réussie, la zone rétrécit et la lame accélère.",
  fmt: s => `${s} coupe${s>1?"s":""}`,
  mount(stage, api){
    stage.insertAdjacentHTML("beforeend", `<div class="bb"><div class="bb-info"><b class="bb-score">0</b><span class="bb-msg">coupe</span></div>
      <div class="bb-track"><div class="bb-stalk" aria-hidden="true"></div><div class="bb-zone"></div><div class="bb-blade" aria-hidden="true"></div></div>
      <p class="bb-tip">Touche n'importe où dans ce cadre</p></div>`);
    const box = stage.querySelector(".bb"), zone = stage.querySelector(".bb-zone"), blade = stage.querySelector(".bb-blade"), sc = stage.querySelector(".bb-score"), m = stage.querySelector(".bb-msg");
    let p = 0, dir = 1, speed, zw, zx, cuts, run = false, raf, last;
    function placeZone(){ zx = .08 + Math.random()*(.84 - zw); zone.style.left = zx*100 + "%"; zone.style.width = zw*100 + "%"; }
    function loop(now){ if(!run) return; const dt = Math.min(.04,(now-last)/1000); last = now;
      p += dir*speed*dt; if(p > 1){ p = 1; dir = -1; } if(p < 0){ p = 0; dir = 1; }
      blade.style.left = p*100 + "%"; raf = requestAnimationFrame(loop); }
    onTap(box, () => {
      if(!run) return;
      if(p >= zx && p <= zx + zw){ cuts++; sc.textContent = cuts; m.textContent = cuts > 1 ? "coupes" : "coupe";
        const center = Math.abs(p - (zx + zw/2)) < zw*.18; vibrate(center ? [15,20,15] : 12); tone(center ? 880 : 620, 90, "triangle", .08);
        box.classList.remove("cut"); void box.offsetWidth; box.classList.add("cut"); FX().burstFrom(zone, center ? 22 : 12);
        zw = Math.max(.045, zw*.88); speed = Math.min(3.2, speed*1.09); placeZone();
      } else { run = false; cancelAnimationFrame(raf); vibrate([60,40,60]); tone(120,320,"sawtooth",.06); box.classList.add("miss");
        setTimeout(() => { box.classList.remove("miss"); api.end(cuts, cuts ? `Zone finale : ${Math.round(zw*100)} % du bambou.` : "La lame était hors de la zone."); }, 500); }
    });
    return { start(){ cuts = 0; sc.textContent = "0"; m.textContent = "coupe"; zw = .26; speed = .9; p = 0; dir = 1; placeZone(); run = true; last = performance.now(); raf = requestAnimationFrame(loop); },
             destroy(){ run = false; cancelAnimationFrame(raf); } };
  }
};

const LIST = [shuriken, reflexe, memoire, bambou];

/* =================== Salle des jeux =================== */
window.DojoGames = function(hub, stageWrap, opts){
  let current = null, inst = null;
  function renderHub(){
    hub.innerHTML = LIST.map(g => { const b = opts.best(g.id);
      return `<button type="button" class="hub-card" data-game="${g.id}" aria-pressed="${current && current.id === g.id}">
        <span class="hub-ico" aria-hidden="true">${g.icon}</span><b>${g.name}</b><span class="hub-desc">${g.desc}</span>
        <span class="hub-best">${b != null ? "Record : " + g.fmt(b) : "Pas encore joué"}</span></button>`; }).join("");
  }
  function overlay(html){ let o = stageWrap.querySelector(".game-overlay"); if(!o){ o = document.createElement("div"); o.className = "game-overlay"; stageWrap.appendChild(o); }
    o.innerHTML = `<div>${html}</div>`; o.hidden = false; return o; }
  function intro(){
    const o = overlay(`<h3>${current.name}</h3><p>${current.howto}</p>${current.legend || ""}<button class="btn big" type="button" data-start>Lancer</button>`);
    o.querySelector("[data-start]").onclick = start;
  }
  function start(){
    stageWrap.querySelector(".game-overlay").hidden = true;
    const r = stageWrap.getBoundingClientRect();
    if(r.top < 60 || r.bottom > innerHeight - 90) stageWrap.scrollIntoView({ block:"center", behavior: FX().RM ? "auto" : "smooth" });
    inst.start();
  }
  function select(id, scroll){
    current = LIST.find(g => g.id === id) || LIST[0];
    if(inst) inst.destroy();
    stageWrap.innerHTML = ""; stageWrap.dataset.game = current.id;
    inst = current.mount(stageWrap, { end(score, detail){
      const res = opts.onEnd(current, score) || {};
      const o = overlay(`<h3>${res.best ? "Nouveau record !" : "Terminé"}</h3>
        <p class="g-result">${current.fmt(score)}</p><p>${detail || ""} Record : ${current.fmt(res.bestScore)}.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn big" type="button" data-start>Rejouer</button>
        <button class="btn ghost" type="button" data-other>Autre jeu</button></div>`);
      o.querySelector("[data-start]").onclick = start;
      o.querySelector("[data-other]").onclick = () => hub.scrollIntoView({ block:"start", behavior: FX().RM ? "auto" : "smooth" });
      if(res.best) FX().burstFrom(stageWrap, 60);
      renderHub(); opts.onSelect && opts.onSelect(current);
    }});
    intro(); renderHub(); opts.onSelect && opts.onSelect(current);
    if(scroll) stageWrap.scrollIntoView({ block:"nearest", behavior: FX().RM ? "auto" : "smooth" });
  }
  hub.addEventListener("click", e => { const b = e.target.closest("[data-game]"); if(b) select(b.dataset.game, true); });
  select(LIST[0].id, false);
  return { select, list: LIST };
};
})();
