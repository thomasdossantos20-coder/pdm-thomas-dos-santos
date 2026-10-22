/* PDM — Défi shuriken : abats la malbouffe, épargne les protéines */
window.ShurikenGame = function(root, opts){
"use strict";
const cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
const hudScore = root.querySelector(".score"), hudTime = root.querySelector(".time"), hudCombo = root.querySelector(".combo");
const overlay = root.querySelector(".game-overlay");
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const DURATION = 30;
const BAD = ["🍔","🍟","🍕","🥤","🍩"], GOOD = ["🥛","🍗","🥚","🍌","🍚"];
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
let W, H, items, stars, shots, parts, floaters, score, combo, comboT, timeLeft, spawnT, running = false, last = 0, flash = 0, hits = 0, misses = 0, lastShot = 0;
const sprites = {};

function sprite(e){
  if(sprites[e]) return sprites[e];
  const s = 96, c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d"); x.font = `${s*.8}px ${EMOJI_FONT}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(e, s/2, s/2+4);
  return (sprites[e] = c);
}
function resize(){
  const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
  cv.width = W*DPR; cv.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
  stars = Array.from({length: 40}, () => ({x: Math.random()*W, y: Math.random()*H*.5, s: Math.random()*1.5+.4}));
  if(!running) drawScene(0);
}
function reset(){ items = []; shots = []; parts = []; floaters = []; score = 0; combo = 1; comboT = 0; timeLeft = DURATION; spawnT = .3; hits = 0; misses = 0; flash = 0; }

function spawn(){
  const good = Math.random() < .3, e = (good ? GOOD : BAD)[Math.floor(Math.random()*5)];
  const size = Math.max(54, Math.min(W, H) * .13);
  const x = size + Math.random()*(W - size*2);
  const tx = W*.2 + Math.random()*W*.6;
  const t = 1.25 + Math.random()*.35, g = 900;
  const peak = H*(.12 + Math.random()*.32);
  const vy = -Math.sqrt(2*g*(H + size - peak));
  items.push({ e, good, x, y: H + size*.6, vx: (tx - x)/t*.5, vy, g, size, r: size*.42, a: Math.random()*6, va: (Math.random()-.5)*4, hit: false });
}

function throwAt(px, py){
  const now = performance.now(); if(now - lastShot < 90) return; lastShot = now;
  const ox = W/2, oy = H - 16, dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy) || 1, sp = 1900;
  shots.push({ x: ox, y: oy, px: ox, py: oy, vx: dx/d*sp, vy: dy/d*sp, a: 0, life: 1.1 });
}

function burstAt(x, y, colors, n=14){
  for(let i=0;i<n;i++){ const a = Math.random()*6.28, v = 120 + Math.random()*320;
    parts.push({ x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v - 160, a: Math.random()*6, va: (Math.random()-.5)*10, s: 4 + Math.random()*6, life: .9 + Math.random()*.5, c: colors[i % colors.length] }); }
}
function segHit(s, it){
  const vx = s.x - s.px, vy = s.y - s.py, wx = it.x - s.px, wy = it.y - s.py, l2 = vx*vx + vy*vy || 1;
  const t = Math.max(0, Math.min(1, (wx*vx + wy*vy)/l2)), cx = s.px + vx*t - it.x, cy = s.py + vy*t - it.y;
  return cx*cx + cy*cy < it.r*it.r;
}

function update(dt){
  timeLeft -= dt;
  if(timeLeft <= 0){ timeLeft = 0; return end(); }
  const progress = 1 - timeLeft/DURATION;
  spawnT -= dt;
  if(spawnT <= 0){ spawn(); if(progress > .45 && Math.random() < .35) spawn(); spawnT = .85 - progress*.45 + Math.random()*.25; }
  if(comboT > 0){ comboT -= dt; if(comboT <= 0) combo = 1; }
  flash = Math.max(0, flash - dt*2.5);

  items.forEach(it => { it.vy += it.g*dt; it.x += it.vx*dt; it.y += it.vy*dt; it.a += it.va*dt; });
  items = items.filter(it => !it.hit && it.y < H + it.size*1.2);

  shots.forEach(s => {
    s.px = s.x; s.py = s.y; s.x += s.vx*dt; s.y += s.vy*dt; s.a += dt*28; s.life -= dt;
    for(const it of items){
      if(it.hit || !segHit(s, it)) continue;
      it.hit = true; s.life = 0;
      if(it.good){
        score = Math.max(0, score - 15); combo = 1; comboT = 0; flash = 1; misses++;
        floaters.push({ x: it.x, y: it.y, t: "-15 protéine !", c: "#FF6B5E", life: 1.2 });
        burstAt(it.x, it.y, ["#FF6B5E","#F3E6C9"], 10);
        if(navigator.vibrate) try{ navigator.vibrate([40,30,40]); }catch(e){}
      } else {
        const pts = 10*combo; score += pts; hits++;
        floaters.push({ x: it.x, y: it.y, t: `+${pts}`, c: combo > 1 ? "#FFB24D" : "#FFFFFF", life: .9 });
        combo = Math.min(5, combo + (comboT > 0 ? 1 : 0)); comboT = 1.3;
        burstAt(it.x, it.y, ["#FF8A1F","#4DBA74","#FFB24D","#F3E6C9"], 16);
        parts.push({ half: -1, e: it.e, x: it.x, y: it.y, vx: -140, vy: -180, a: it.a, va: -6, size: it.size, life: 1 });
        parts.push({ half: 1, e: it.e, x: it.x, y: it.y, vx: 140, vy: -160, a: it.a, va: 6, size: it.size, life: 1 });
        if(navigator.vibrate) try{ navigator.vibrate(12); }catch(e){}
      }
      break;
    }
  });
  shots = shots.filter(s => s.life > 0 && s.x > -40 && s.x < W+40 && s.y > -40);
  parts.forEach(p => { p.vy += 900*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.a += p.va*dt; p.life -= dt; });
  parts = parts.filter(p => p.life > 0);
  floaters.forEach(f => { f.y -= 60*dt; f.life -= dt; });
  floaters = floaters.filter(f => f.life > 0);

  hudScore.textContent = score;
  hudTime.textContent = Math.ceil(timeLeft) + " s";
  hudCombo.textContent = combo > 1 ? `Combo ×${combo}` : "";
}

function drawScene(t){
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,"#0A0F26"); g.addColorStop(.7,"#1A2150"); g.addColorStop(1,"#2B2245");
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  stars.forEach(s => { ctx.fillStyle = `rgba(255,240,210,${.4+.3*Math.sin(t*2+s.x)})`; ctx.fillRect(s.x, s.y, s.s, s.s); });
  // lune
  const mx = W*.82, my = H*.16, mr = Math.min(W,H)*.08;
  const h = ctx.createRadialGradient(mx,my,mr*.5,mx,my,mr*4); h.addColorStop(0,"rgba(255,220,160,.28)"); h.addColorStop(1,"rgba(255,220,160,0)");
  ctx.fillStyle = h; ctx.beginPath(); ctx.arc(mx,my,mr*4,0,6.29); ctx.fill();
  ctx.fillStyle = "#F6E2B6"; ctx.beginPath(); ctx.arc(mx,my,mr,0,6.29); ctx.fill();
  // treillis shoji
  ctx.strokeStyle = "rgba(255,236,200,.05)"; ctx.lineWidth = 2;
  for(let x = 0; x < W; x += 70){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y = 0; y < H; y += 90){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  // plancher
  const fy = H - 46; ctx.fillStyle = "#3a2414"; ctx.fillRect(0, fy, W, 46);
  ctx.fillStyle = "rgba(255,255,255,.06)"; for(let x = 0; x < W; x += 54) ctx.fillRect(x, fy, 2, 46);
  ctx.fillStyle = "#5B3A22"; ctx.fillRect(0, fy, W, 4);
  // lanceur
  ctx.save(); ctx.translate(W/2, H - 16); ctx.rotate(t*2); window.FX.drawShuriken(ctx, 18, "#D9DEE8"); ctx.restore();
}

function draw(t){
  drawScene(t);
  items.forEach(it => { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.a*.3);
    if(it.good){ ctx.fillStyle = "rgba(255,107,94,.18)"; ctx.beginPath(); ctx.arc(0,0,it.r*1.08,0,6.29); ctx.fill(); }
    ctx.drawImage(sprite(it.e), -it.size/2, -it.size/2, it.size, it.size); ctx.restore(); });
  parts.forEach(p => {
    ctx.save(); ctx.globalAlpha = Math.min(1, p.life*1.5); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    if(p.half){ const sp = sprite(p.e), s = p.size; ctx.beginPath(); ctx.rect(p.half < 0 ? -s/2 : 0, -s/2, s/2, s); ctx.clip(); ctx.drawImage(sp, -s/2, -s/2, s, s); }
    else window.FX.drawLeaf(ctx, p.s, p.c);
    ctx.restore(); });
  shots.forEach(s => {
    ctx.strokeStyle = "rgba(255,210,150,.35)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.px - s.vx*.03, s.py - s.vy*.03); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a); window.FX.drawShuriken(ctx, 13, "#E8ECF4"); ctx.restore(); });
  ctx.textAlign = "center"; ctx.font = `400 20px "Dela Gothic One", sans-serif`;
  floaters.forEach(f => { ctx.globalAlpha = Math.min(1, f.life*1.6); ctx.fillStyle = f.c; const hw = ctx.measureText(f.t).width/2 + 8; ctx.fillText(f.t, Math.max(hw, Math.min(W - hw, f.x)), f.y); });
  ctx.globalAlpha = 1;
  if(flash > 0){ ctx.fillStyle = `rgba(255,70,60,${flash*.25})`; ctx.fillRect(0,0,W,H); }
}

function loop(now){
  if(!running) return;
  const dt = Math.min(.04, (now - last)/1000); last = now;
  update(dt); if(running) draw(now/1000);
  requestAnimationFrame(loop);
}
function start(){
  root.scrollIntoView({ block: "center", behavior: window.FX && FX.RM ? "auto" : "smooth" });
  reset(); resize(); overlay.hidden = true; running = true; last = performance.now();
  hudScore.textContent = "0"; hudTime.textContent = DURATION + " s"; hudCombo.textContent = "";
  requestAnimationFrame(loop);
}
function end(){
  running = false; draw(performance.now()/1000);
  const acc = hits + misses ? Math.round(hits/(hits+misses)*100) : 0;
  const res = opts.onEnd ? opts.onEnd(score) : {};
  overlay.innerHTML = `<div>
    <h3>${res.best ? "Nouveau record !" : "Fin du défi"}</h3>
    <p style="font-size:20px;color:var(--text);margin-bottom:6px"><b style="font-family:var(--display);font-weight:400;font-size:46px;color:var(--flame-hi)">${score}</b> points</p>
    <p>${hits} malbouffe${hits>1?"s":""} abattue${hits>1?"s":""}, ${misses} protéine${misses>1?"s":""} gaspillée${misses>1?"s":""}. Meilleur score : ${res.bestScore ?? score}.</p>
    <button class="btn big" type="button" data-start>Rejouer</button></div>`;
  overlay.hidden = false;
  overlay.querySelector("[data-start]").onclick = start;
  if(res.best && window.FX) FX.burstFrom(root, 70);
}

cv.addEventListener("pointerdown", e => {
  if(!running) return; e.preventDefault();
  const r = cv.getBoundingClientRect(); throwAt(e.clientX - r.left, e.clientY - r.top);
});
addEventListener("resize", () => { if(!running) resize(); });
overlay.querySelector("[data-start]").onclick = start;
reset(); resize();
return { start };
};
