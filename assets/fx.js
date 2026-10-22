/* PDM — effets : décor de nuit animé, explosions de feuilles, tampon, compteurs */
(function(){
"use strict";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const rand = (a,b) => a + Math.random()*(b-a);
function seeded(seed){ let s = seed; return () => (s = (s*16807) % 2147483647) / 2147483647; }

/* Filtre « tampon encré » réutilisé par les sceaux */
function injectDefs(){
  if(document.getElementById("fx-defs")) return;
  const d = document.createElement("div"); d.id = "fx-defs"; d.setAttribute("aria-hidden","true");
  d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  d.innerHTML = `<svg width="0" height="0"><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></svg>`;
  document.body.appendChild(d);
}

/* ---------- Décor ---------- */
function drawLeaf(ctx, size, color){
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(size*.9, -size*.2, 0, size);
  ctx.quadraticCurveTo(-size*.9, -size*.2, 0, -size);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = Math.max(1, size*.08);
  ctx.beginPath(); ctx.moveTo(0,-size*.8); ctx.lineTo(0,size*.85); ctx.stroke();
}
function drawShuriken(ctx, r, color){
  ctx.fillStyle = color;
  ctx.beginPath();
  for(let i=0;i<8;i++){
    const a = i*Math.PI/4, rr = i%2 ? r*.32 : r;
    ctx.lineTo(Math.cos(a)*rr, Math.sin(a)*rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(10,14,30,.9)";
  ctx.beginPath(); ctx.arc(0,0,r*.16,0,Math.PI*2); ctx.fill();
}

function scene(){
  if(document.getElementById("scene")) return;
  const fb = document.createElement("div"); fb.className = "scene-fallback"; document.body.prepend(fb);
  const cv = document.createElement("canvas"); cv.id = "scene"; cv.setAttribute("aria-hidden","true");
  document.body.prepend(cv);
  const ctx = cv.getContext("2d");
  let W, H, stars, ridgeFar, ridgeNear, roofs, leaves, clouds;
  const small = () => W < 700;

  function build(){
    W = innerWidth; H = innerHeight;
    cv.width = W*DPR; cv.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
    const r = seeded(7);
    stars = Array.from({length: small() ? 60 : 110}, () => ({x:r()*W, y:r()*H*.6, s:r()*1.4+.3, p:r()*6.28}));
    const ridge = (base, amp, step, seed) => { const rr = seeded(seed), pts = []; let y = base;
      for(let x=-20; x<=W+40; x+=step){ y = base + (rr()-.5)*amp + Math.sin(x/170+seed)*amp*.6; pts.push([x,y]); } return pts; };
    ridgeFar = ridge(H*.70, H*.09, 46, 3);
    ridgeNear = ridge(H*.80, H*.06, 34, 11);
    // toits de pagodes génériques
    const rr = seeded(21); roofs = []; let x = -30;
    while(x < W+60){ const w = 60 + rr()*120, h = 30 + rr()*70, floors = 1 + Math.floor(rr()*3);
      roofs.push({x, w, h, floors, lantern: rr() < .45}); x += w + 6 + rr()*30; }
    leaves = Array.from({length: small() ? 9 : 16}, () => newLeaf(true));
    clouds = Array.from({length: 4}, (_,i) => ({x: rand(0,W), y: H*(.1+i*.07), w: rand(W*.25, W*.5), v: rand(4,9)}));
  }
  function newLeaf(anyY){
    return { x: rand(-40, W), y: anyY ? rand(-H*.2, H) : -30, s: rand(5,10), vx: rand(8,26), vy: rand(14,32),
             a: rand(0,6.28), va: rand(-1.4,1.4), sw: rand(.6,1.6), c: Math.random()<.55 ? "#FF8A1F" : (Math.random()<.5 ? "#4DBA74" : "#E8B04A") };
  }
  function path(pts, fill, yOff){
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(-20, H+10);
    pts.forEach(([x,y]) => ctx.lineTo(x, y + yOff)); ctx.lineTo(W+40, H+10); ctx.closePath(); ctx.fill();
  }
  function roofShape(r, base){
    const {x,w,h,floors} = r; ctx.beginPath();
    let y = base, ww = w;
    for(let f=0; f<floors; f++){
      const cx = x + w/2, bw = ww*.72, bh = h*.38/floors*2;
      ctx.rect(cx-bw/2, y-bh, bw, bh);
      const ry = y-bh, ow = ww*.62, lift = 10 + ww*.05;
      ctx.moveTo(cx-ow, ry+2);
      ctx.quadraticCurveTo(cx-ow*.55, ry-4, cx-ow*.35, ry-lift*.9);
      ctx.lineTo(cx+ow*.35, ry-lift*.9);
      ctx.quadraticCurveTo(cx+ow*.55, ry-4, cx+ow, ry+2);
      ctx.closePath();
      y = ry - lift*.9; ww *= .72;
    }
    ctx.rect(x+w/2-1.5, y-14, 3, 14);
    return y;
  }
  let t0 = performance.now(), last = t0, running = true;
  function frame(now){
    const dt = Math.min(.05, (now-last)/1000); last = now; const t = (now - t0)/1000;
    const sy = scrollY;
    ctx.clearRect(0,0,W,H);
    // ciel
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,"#060A1A"); g.addColorStop(.55,"#121B42"); g.addColorStop(.85,"#2A2350"); g.addColorStop(1,"#3B2747");
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    // étoiles
    stars.forEach(s => { const a = .35 + .45*Math.sin(t*1.3 + s.p); ctx.fillStyle = `rgba(255,244,220,${a})`;
      ctx.fillRect(s.x, s.y - sy*.04, s.s, s.s); });
    // lune
    const mr = Math.max(42, Math.min(W,H)*.085), mx = W*(small()?.78:.82), my = H*.17 - sy*.08;
    const halo = ctx.createRadialGradient(mx,my,mr*.6,mx,my,mr*4.5);
    halo.addColorStop(0,"rgba(255,226,170,.35)"); halo.addColorStop(1,"rgba(255,226,170,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx,my,mr*4.5,0,6.29); ctx.fill();
    const mg = ctx.createRadialGradient(mx-mr*.3,my-mr*.3,mr*.1,mx,my,mr);
    mg.addColorStop(0,"#FFF6DE"); mg.addColorStop(1,"#F1D49A");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx,my,mr,0,6.29); ctx.fill();
    ctx.fillStyle = "rgba(196,160,100,.25)";
    [[-.3,-.1,.18],[.25,.2,.13],[.05,-.4,.09],[.35,-.25,.07]].forEach(([dx,dy,rr]) => { ctx.beginPath(); ctx.arc(mx+dx*mr,my+dy*mr,rr*mr,0,6.29); ctx.fill(); });
    // nuages
    clouds.forEach(c => { c.x += c.v*dt; if(c.x - c.w > W) c.x = -c.w;
      const cg = ctx.createLinearGradient(c.x-c.w/2,0,c.x+c.w/2,0);
      cg.addColorStop(0,"rgba(120,110,170,0)"); cg.addColorStop(.5,"rgba(120,110,170,.16)"); cg.addColorStop(1,"rgba(120,110,170,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(c.x, c.y - sy*.06, c.w/2, 10, 0, 0, 6.29); ctx.fill(); });
    // montagnes + toits (parallaxe)
    path(ridgeFar, "#151C40", -sy*.10);
    path(ridgeNear, "#0F1533", -sy*.16);
    ctx.fillStyle = "#090D24";
    const base = H*.93 - sy*.22;
    ctx.beginPath(); ctx.rect(-10, base, W+20, H); ctx.fill();
    roofs.forEach(r => {
      ctx.fillStyle = "#090D24"; const top = roofShape(r, base); ctx.fill();
      if(r.lantern){ const lx = r.x + r.w*.5, ly = base - r.h*.25, f = .7 + .3*Math.sin(t*3 + r.x);
        const lg = ctx.createRadialGradient(lx,ly,1,lx,ly,22); lg.addColorStop(0,`rgba(255,160,60,${.55*f})`); lg.addColorStop(1,"rgba(255,160,60,0)");
        ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx,ly,22,0,6.29); ctx.fill();
        ctx.fillStyle = `rgba(255,190,100,${.9*f})`; ctx.beginPath(); ctx.ellipse(lx,ly,4,5.5,0,0,6.29); ctx.fill(); }
    });
    // feuilles
    leaves.forEach((l,i) => {
      l.x += (l.vx + Math.sin(t*l.sw + i)*18)*dt; l.y += l.vy*dt; l.a += l.va*dt;
      if(l.y > H + 30 || l.x > W + 40) leaves[i] = newLeaf(false);
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.a); ctx.globalAlpha = .75; drawLeaf(ctx, l.s, l.c); ctx.restore();
    });
    ctx.globalAlpha = 1;
    if(running && !RM) requestAnimationFrame(frame);
  }
  build();
  addEventListener("resize", () => { build(); if(RM) frame(performance.now()); });
  if(RM) addEventListener("scroll", () => frame(performance.now()), {passive:true});
  document.addEventListener("visibilitychange", () => {
    if(document.hidden){ running = false; } else if(!running){ running = true; last = performance.now(); if(!RM) requestAnimationFrame(frame); }
  });
  requestAnimationFrame(frame);
}

/* ---------- Explosion de feuilles et shuriken ---------- */
let fxCv, fxCtx, parts = [], fxRunning = false;
function burst(x, y, n=36){
  if(RM) return;
  if(!fxCv){ fxCv = document.createElement("canvas"); fxCv.id = "fx"; fxCv.setAttribute("aria-hidden","true"); document.body.appendChild(fxCv); fxCtx = fxCv.getContext("2d"); }
  fxCv.width = innerWidth*DPR; fxCv.height = innerHeight*DPR; fxCtx.setTransform(DPR,0,0,DPR,0,0);
  if(x == null){ x = innerWidth/2; y = innerHeight*.42; }
  for(let i=0;i<n;i++){
    const a = rand(0, 6.28), v = rand(160, 520);
    parts.push({ x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v - 220, a: rand(0,6.28), va: rand(-9,9), s: rand(6,12), life: rand(1,1.7),
      kind: Math.random() < .22 ? "s" : "l", c: ["#FF8A1F","#FFB24D","#4DBA74","#F3E6C9"][i%4] });
  }
  if(!fxRunning){ fxRunning = true; let lt = performance.now();
    const step = now => { const dt = Math.min(.05,(now-lt)/1000); lt = now;
      fxCtx.clearRect(0,0,innerWidth,innerHeight);
      parts = parts.filter(p => (p.life -= dt) > 0);
      parts.forEach(p => { p.vy += 620*dt; p.vx *= .985; p.x += p.vx*dt; p.y += p.vy*dt; p.a += p.va*dt;
        fxCtx.save(); fxCtx.globalAlpha = Math.min(1, p.life*1.4); fxCtx.translate(p.x,p.y); fxCtx.rotate(p.a);
        p.kind === "s" ? drawShuriken(fxCtx, p.s, "#D9DEE8") : drawLeaf(fxCtx, p.s, p.c); fxCtx.restore(); });
      if(parts.length) requestAnimationFrame(step); else { fxRunning = false; fxCtx.clearRect(0,0,innerWidth,innerHeight); } };
    requestAnimationFrame(step); }
}
function burstFrom(el, n){ if(!el) return burst(null,null,n); const r = el.getBoundingClientRect(); burst(r.left + r.width/2, r.top + r.height/2, n); }

/* ---------- Tampon plein écran ---------- */
function stamp(text){
  injectDefs();
  const s = document.createElement("div"); s.className = "stamp-fx"; s.setAttribute("role","status"); s.textContent = text;
  document.body.appendChild(s); setTimeout(() => s.remove(), 1700);
  if(navigator.vibrate) try{ navigator.vibrate(30); }catch(e){}
}

/* ---------- Compteur animé ---------- */
function countUp(el, to, fmt, ms=1100){
  if(RM || to == null){ el.textContent = fmt(to); return; }
  const from = Math.max(0, to - Math.max(6, to*.12)), t0 = performance.now();
  const step = now => { const k = Math.min(1,(now-t0)/ms), e = 1 - Math.pow(1-k, 4);
    el.textContent = fmt(from + (to-from)*e); if(k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

window.FX = { scene, burst, burstFrom, stamp, countUp, injectDefs, drawLeaf, drawShuriken, RM };
injectDefs();
scene();
})();
