/* PDM Thomas — page Calories : photo (Gemini), code-barres (Open Food Facts), recherche, saisie libre */
(async function(){
"use strict";
const P = window.PDM, { $, $$, esc, num, uid, todayISO, fmtDate, toast } = P;
const MEALS = [["pdj","Petit-déj"],["dej","Déjeuner"],["col","Collation"],["din","Dîner"]];
const MODES = [["photo","Photo"],["scan","Code-barres"],["search","Recherche"],["free","Saisie libre"]];
const root = $("#cal");

await P.load();
const D = P.data;
D.meals = D.meals || {};
D.customFoods = D.customFoods || [];
D.calTargets = D.calTargets || { kcalMin: 3000, kcalMax: 3200, protMin: 130 };

/* ---------- utilitaires ---------- */
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const r0 = v => Math.round(v), r1 = v => Math.round(v*10)/10;
const fmt = v => r0(v).toLocaleString("fr-FR");
const rq = v => v < 10 ? Math.round(v*100)/100 : r1(v); /* quantités : 0,49 g reste 0,49 g */
const fq = v => rq(v).toLocaleString("fr-FR");
const dec = v => r1(v).toLocaleString("fr-FR");
const defaultMeal = () => { const h = new Date().getHours() + new Date().getMinutes()/60; return h < 10.5 ? "pdj" : h < 15 ? "dej" : h < 18.5 ? "col" : "din"; };
const forQty = (it, g = it.g) => ({ kcal: it.k*g/100, p: it.p*g/100, c: it.c*g/100, l: it.l*g/100 });
const sum = items => items.reduce((a,it) => { const q = forQty(it); a.kcal += q.kcal; a.p += q.p; a.c += q.c; a.l += q.l; return a; }, { kcal:0, p:0, c:0, l:0 });
const allFoods = () => [...D.customFoods.map(f => ({ ...f, src: "perso" })), ...(window.PDM_FOODS || []).map(([n,k,p,c,l]) => ({ n, k, p, c, l, src: "base" }))];
function saveFood(food){
  const i = D.customFoods.findIndex(x => (food.code && x.code === food.code) || norm(x.n) === norm(food.n));
  if(i >= 0) D.customFoods[i] = { ...D.customFoods[i], ...food }; else D.customFoods.unshift(food);
}
const shiftDate = (iso, d) => { const x = new Date(iso + "T12:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0,10); };
const qtyLabel = it => it.por ? "1 portion" : `${fmt(it.g)} g`;

let mode = "photo"; try { mode = localStorage.getItem("pdm-cal-mode") || "photo"; } catch(e){}
const state = { date: todayISO(), meal: defaultMeal(), mode, photo: null, busy: false, pick: null, q: "", g: "", scan: null, edit: null };

/* ---------- Gemini : prompts ---------- */
const PROMPT_PHOTO = "Analyse cette photo de repas. Identifie chaque aliment visible, estime sa quantité en grammes (portion réellement présente dans l'assiette) et ses valeurs nutritionnelles pour cette quantité, en t'appuyant sur des valeurs de référence (table Ciqual). Pense aux matières grasses de cuisson et aux sauces visibles. En cas de doute sur une quantité ou une valeur, prends toujours l'estimation basse de la fourchette plutôt que la haute (mieux vaut sous-estimer que surestimer). Si tu hésites sur un aliment, liste-le quand même avec ta meilleure estimation basse. Renvoie une liste vide seulement s'il n'y a vraiment aucune nourriture sur la photo, et explique pourquoi dans le commentaire. Si un élément qui change nettement les calories n'est pas identifiable (photo floue, sombre ou coupée, aliment caché ou emballé, sauce, huile ou garniture inconnue, type de boisson, taille réelle de la portion, texte d'emballage illisible), pose jusqu'à 3 questions courtes et précises dans « questions », en français, en tutoyant, et donne quand même ta meilleure estimation basse dans « aliments ». Si la photo est claire, « questions » est une liste vide : ne pose pas de question pour un détail de moins de 50 kcal. Noms en français, courts.";
const PROMPT_PHOTO_2 = (prev, qa) => `${PROMPT_PHOTO}\n\nTu as déjà analysé cette photo et obtenu : ${JSON.stringify(prev)}\nRéponses de l'utilisateur à tes questions :\n${qa}\nRefais l'analyse complète en tenant compte de ces réponses : elles priment sur ce que tu crois voir. Ne pose plus de question : « questions » doit être une liste vide.`;
const PROMPT_FOOD = a => `Donne les valeurs nutritionnelles moyennes POUR 100 GRAMMES de cet aliment tel qu'on le mange : « ${a} ». Appuie-toi sur la table Ciqual quand c'est possible. En cas de doute, prends la valeur basse de la fourchette plutôt que la haute. Nom court en français.`;
const NUM = { type: "NUMBER" }, STR = { type: "STRING" };
const SCHEMA_PHOTO = { type: "OBJECT", properties: {
  aliments: { type: "ARRAY", items: { type: "OBJECT", properties: { nom: STR, grammes: NUM, kcal: NUM, proteines: NUM, glucides: NUM, lipides: NUM },
    required: ["nom","grammes","kcal","proteines","glucides","lipides"] } },
  commentaire: STR, questions: { type: "ARRAY", items: STR } }, required: ["aliments","commentaire","questions"] };
const SCHEMA_FOOD = { type: "OBJECT", properties: { nom: STR, kcal: NUM, proteines: NUM, glucides: NUM, lipides: NUM },
  required: ["nom","kcal","proteines","glucides","lipides"] };

/* photo → JPEG ≤ 1280 px */
function shrink(file, max = 1280){
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const d = c.toDataURL("image/jpeg", 0.85); ok({ url: d, b64: d.split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("Image illisible par ce navigateur.")); };
    img.src = url;
  });
}

/* ---------- code-barres : ZXing-C++ en WebAssembly (rapide, lit les petits codes et les codes penchés) ---------- */
const BC_OPTS = { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 };
let zxp = null;
function loadZX(){
  if(zxp) return zxp;
  zxp = new Promise((ok, ko) => {
    const wasm = new URL("assets/zxing-wasm/zxing_reader.wasm?v=" + P.version, location.href).href;
    const ready = () => window.ZXingWASM.prepareZXingModule({ overrides: { locateFile: (p, pre) => p.endsWith(".wasm") ? wasm : pre + p }, fireImmediately: true }).then(() => ok(window.ZXingWASM), ko);
    if(window.ZXingWASM) return ready();
    const s = document.createElement("script"); s.src = "assets/zxing-wasm/reader.js?v=" + P.version;
    s.onload = ready; s.onerror = () => ko(new Error("Lecteur de code-barres non chargé : vérifie ta connexion."));
    document.head.appendChild(s);
  });
  zxp.catch(() => { zxp = null; });
  return zxp;
}
async function readBC(src){
  const Z = await loadZX();
  const r = await Z.readBarcodes(src, BC_OPTS);
  const hit = r.find(x => x.isValid && x.text);
  return hit ? hit.text : null;
}
let audio = null;
function beep(){
  try{
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = "sine"; o.frequency.value = 1568; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.15);
  }catch(e){}
}

async function startCamera(){
  try{ audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); }catch(e){}
  const ov = document.createElement("div"); ov.className = "scan-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Scanner un code-barres");
  ov.innerHTML = `<video playsinline muted autoplay></video>
    <div class="scan-win"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><i class="scan-laser"></i><b class="scan-ok" aria-hidden="true">✓</b></div>
    <button class="scan-x" type="button" aria-label="Fermer">×</button>
    <div class="scan-foot">
      <p class="scan-tip" aria-live="polite">Place le code-barres dans le cadre</p>
      <div class="scan-tools">
        <button type="button" data-zoom hidden>Zoom ×2</button>
        <button type="button" data-torch hidden>Lampe</button>
        <label>Photo HD<input type="file" accept="image/*" capture="environment" hidden></label>
        <button type="button" data-type>Taper le code</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"), win = ov.querySelector(".scan-win"), tip = ov.querySelector(".scan-tip");
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  let stream = null, track = null, stop = false, busy = false, n = 0, t0 = Date.now();
  const halt = () => { stop = true; if(stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  const close = () => { halt(); ov.remove(); clearInterval(hints); document.removeEventListener("visibilitychange", onVis); };
  const onVis = () => { if(document.hidden) close(); };
  document.addEventListener("visibilitychange", onVis);
  ov.querySelector(".scan-x").onclick = close;
  ov.querySelector("[data-type]").onclick = () => { close(); const i = $("#bc input[name=code]"); if(i) i.focus(); };
  const ph = ov.querySelector("input[type=file]");
  ph.onclick = () => halt();
  ph.onchange = e => { const f = e.target.files[0]; close(); if(f) decodePhoto(f); };
  const hints = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    if(s > 14) tip.textContent = "Toujours rien ? Prends une « Photo HD » du code ou tape les chiffres.";
    else if(s > 6) tip.textContent = "Recule à 20 cm : de trop près, l'iPhone ne fait pas la mise au point." + (ov.querySelector("[data-zoom]").hidden ? "" : " Petit code : active le zoom.");
  }, 1000);

  /* zone à lire : le cadre (+ marge), converti en pixels de la vidéo (affichée en object-fit: cover) */
  function crop(){
    const vw = video.videoWidth, vh = video.videoHeight, er = video.getBoundingClientRect(), wr = win.getBoundingClientRect();
    const s = Math.max(er.width / vw, er.height / vh), ox = er.left + (er.width - vw * s) / 2, oy = er.top + (er.height - vh * s) / 2;
    const mx = wr.width * 0.12, my = wr.height * 0.45;
    let x = (wr.left - mx - ox) / s, y = (wr.top - my - oy) / s, w = (wr.width + 2 * mx) / s, h = (wr.height + 2 * my) / s;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }
  function grab(whole){
    const vw = video.videoWidth, vh = video.videoHeight;
    const r = whole ? { x: 0, y: 0, w: vw, h: vh } : crop();
    const k = Math.min(1, (whole ? 1280 : 1600) / Math.max(r.w, r.h));
    cv.width = Math.round(r.w * k); cv.height = Math.round(r.h * k);
    cx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
    return cx.getImageData(0, 0, cv.width, cv.height);
  }
  function found(code){
    stop = true; win.classList.add("ok"); beep(); if(navigator.vibrate) navigator.vibrate(70);
    tip.textContent = code;
    setTimeout(() => { close(); lookup(code); }, 380);
  }
  async function loop(){
    if(stop) return;
    if(!busy && video.readyState >= 2 && video.videoWidth){
      busy = true;
      try{
        const code = await readBC(grab(n++ % 3 === 2)); /* 2 fois sur 3 le cadre en pleine définition, 1 fois l'image entière */
        if(code && !stop){ found(code); return; }
      }catch(e){}
      busy = false;
    }
    if(video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  }

  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("NoCamera");
    const zx = loadZX(); /* le lecteur se charge pendant que la caméra démarre */
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if(stop){ halt(); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if(caps.focusMode && caps.focusMode.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    if(caps.zoom && caps.zoom.max >= 1.8){
      const zb = ov.querySelector("[data-zoom]"), z2 = Math.min(2, caps.zoom.max); let on = false; zb.hidden = false;
      zb.onclick = () => { on = !on; zb.setAttribute("aria-pressed", on); zb.textContent = on ? "Zoom ×1" : "Zoom ×2"; track.applyConstraints({ advanced: [{ zoom: on ? z2 : Math.max(1, caps.zoom.min) }] }).catch(() => {}); };
    }
    if(caps.torch){
      const tb = ov.querySelector("[data-torch]"); let on = false; tb.hidden = false;
      tb.onclick = () => { on = !on; tb.setAttribute("aria-pressed", on); track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
    }
    await zx;
    loop();
  }catch(err){
    close();
    const e = (err && (err.name + " " + err.message)) || "";
    toast(/NotAllowed|Permission|Security/i.test(e) ? "Accès caméra refusé : autorise la caméra pour ce site dans Réglages > Safari > Caméra." :
      /Lecteur/.test(e) ? err.message : "Caméra indisponible : utilise « Photo du code » ou tape les chiffres.");
  }
}

/* photo du code : l'appareil photo natif (mise au point, pleine définition), puis lecture à 2 tailles */
function loadImg(file){
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("Image illisible")); };
    img.src = url;
  });
}
function imgData(img, max, box){
  const b = box || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const k = Math.min(1, max / Math.max(b.w, b.h)), c = document.createElement("canvas");
  c.width = Math.round(b.w * k); c.height = Math.round(b.h * k);
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}
async function decodePhoto(file){
  state.scan = { busy: "photo" }; renderAdd();
  try{
    const img = await loadImg(file), W = img.naturalWidth, H = img.naturalHeight;
    const tries = [() => imgData(img, 2400), () => imgData(img, 2400, { x: W * 0.2, y: H * 0.2, w: W * 0.6, h: H * 0.6 }), () => imgData(img, 1200)];
    for(const t of tries){ const code = await readBC(t()); if(code){ lookup(code); return; } }
    state.scan = { err: "Code-barres non lu sur la photo. Recule un peu (20 cm), évite les reflets, ou tape les chiffres." };
  }catch(err){ state.scan = { err: /Lecteur/.test(err.message) ? err.message : "Photo illisible. Réessaie ou tape les chiffres." }; }
  renderAdd();
}

/* ---------- Open Food Facts (la base utilisée par Yuka) ---------- */
const OFF_FIELDS = "product_name,product_name_fr,generic_name_fr,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,nutriments,nutriscore_grade,nova_group,nutrient_levels,additives_tags,image_front_small_url,image_front_url,categories_tags";
const OFF_CACHE = "pdm-off";
const offGet = code => { try { return (JSON.parse(localStorage.getItem(OFF_CACHE) || "{}"))[code] || null; } catch(e){ return null; } };
const offPut = pr => { try { const c = JSON.parse(localStorage.getItem(OFF_CACHE) || "{}"); c[pr.code] = { ...pr, at: Date.now() };
  const keys = Object.keys(c).sort((a,b) => c[b].at - c[a].at); keys.slice(80).forEach(k => delete c[k]); localStorage.setItem(OFF_CACHE, JSON.stringify(c)); } catch(e){} };

function offProduct(code, pr){
  const nu = pr.nutriments || {}, v = k => { const x = nu[k + "_100g"]; return x == null || x === "" || isNaN(+x) ? null : +x; };
  let k = v("energy-kcal"); if(k == null && v("energy") != null) k = v("energy") / 4.184;
  const unitTxt = String(pr.product_quantity_unit || pr.quantity || "").toLowerCase();
  const drink = /\b(ml|cl|l)\b|litre/.test(unitTxt) || (pr.categories_tags || []).some(c => /beverages|boissons|waters|eaux/.test(c));
  const name = pr.product_name_fr || pr.product_name || pr.generic_name_fr || "Produit " + code;
  const brand = pr.brands ? pr.brands.split(",")[0].trim() : "";
  const grade = /^[a-e]$/.test(pr.nutriscore_grade || "") ? pr.nutriscore_grade : null;
  return { code, name, brand, n: brand && !norm(name).includes(norm(brand)) ? `${name} · ${brand}` : name, img: pr.image_front_url || pr.image_front_small_url || "",
    qty: pr.quantity || "", pq: +pr.product_quantity || null, serving: +pr.serving_quantity || null, servingTxt: pr.serving_size || "",
    drink, unit: drink ? "ml" : "g", grade, nova: +pr.nova_group || null, lv: pr.nutrient_levels || {},
    add: (pr.additives_tags || []).map(a => a.replace(/^en:/, "").toUpperCase()),
    hasNutri: k != null, k: r1(k || 0), p: r1(v("proteins") || 0), c: r1(v("carbohydrates") || 0), l: r1(v("fat") || 0),
    sug: v("sugars"), sat: v("saturated-fat"), salt: v("salt"), fib: v("fiber"), src: "off" };
}
async function lookup(code){
  code = String(code).replace(/\D/g, "");
  if(code.length < 8){ toast("Code trop court"); return; }
  const known = D.customFoods.find(f => f.code === code);
  const lastQty = known && known.serving;
  const cached = offGet(code);
  if(cached){ showProduct(cached, lastQty); refreshOff(code, lastQty); return; }
  state.scan = { code, busy: "off" }; renderAdd();
  try{
    const pr = await fetchOff(code);
    if(!pr){
      state.scan = known ? null : { code, err: `Produit ${code} absent d'Open Food Facts.` };
      if(known) showProduct({ code, n: known.n, name: known.n, brand: "", k: known.k, p: known.p, c: known.c, l: known.l, hasNutri: true, unit: "g", lv: {}, add: [], src: "perso" }, lastQty);
      else renderAdd();
      return;
    }
    offPut(pr); showProduct(pr, lastQty);
  }catch(err){
    if(known) showProduct({ code, n: known.n, name: known.n, brand: "", k: known.k, p: known.p, c: known.c, l: known.l, hasNutri: true, unit: "g", lv: {}, add: [], src: "perso" }, lastQty);
    else { state.scan = { code, err: "Open Food Facts ne répond pas. Vérifie ta connexion et réessaie." }; renderAdd(); }
  }
}
async function fetchOff(code){
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
  try{
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}&lc=fr`, { signal: ctl.signal });
    if(r.status === 404) return null;
    const j = await r.json();
    return j && j.status === 1 && j.product ? offProduct(code, j.product) : null;
  } finally { clearTimeout(to); }
}
async function refreshOff(code, lastQty){ /* le cache s'affiche tout de suite, la fiche se met à jour en fond */
  try{ const pr = await fetchOff(code); if(pr){ offPut(pr); if(state.scan && state.scan.product && state.scan.product.code === code && !state.scan.touched){ showProduct(pr, lastQty); } } }catch(e){}
}
function showProduct(pr, lastQty){
  const g = lastQty || pr.serving || (pr.pq && pr.pq <= 100 ? pr.pq : 100);
  state.scan = { code: pr.code, product: pr, g: rq(g) };
  renderAdd();
  const card = $(".yk"); if(card) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- rendu ---------- */
function render(){
  root.innerHTML = `
  <div class="toolbar">
    <div class="cal-date">
      <button class="icon-btn" data-act="day" data-d="-1" aria-label="Jour précédent">‹</button>
      <input type="date" id="cal-day" value="${state.date}" aria-label="Jour">
      <button class="icon-btn" data-act="day" data-d="1" aria-label="Jour suivant">›</button>
    </div>
    ${state.date !== todayISO() ? `<button class="btn ghost sm" data-act="today">Aujourd'hui</button>` : ""}
  </div>
  <section class="panel" id="tot" aria-label="Total du jour"></section>
  <section class="panel section" aria-labelledby="h-add">
    <h2 id="h-add">Ajouter</h2>
    <div class="seg cal-seg" role="group" aria-label="Repas">${MEALS.map(([k,l]) => `<button data-meal="${k}" aria-pressed="${k===state.meal}">${l}</button>`).join("")}</div>
    <div class="cal-modes" role="tablist" aria-label="Mode d'ajout">${MODES.map(([k,l]) => `<button role="tab" data-mode="${k}" aria-selected="${k===state.mode}">${l}</button>`).join("")}</div>
    <div id="add"></div>
  </section>
  <section class="panel section" aria-labelledby="h-day"><h2 id="h-day"></h2><div id="day"></div></section>
  <section class="panel section" aria-labelledby="h-week"><h2 id="h-week">7 derniers jours</h2><div id="week"></div></section>
  <section class="panel section" aria-labelledby="h-set">
    <details>
      <summary style="cursor:pointer"><h2 id="h-set" style="display:inline">Objectifs et aliments enregistrés</h2></summary>
      <form id="goals" class="form-row" style="margin-top:14px">
        <label class="f">Kcal min<input name="kmin" inputmode="numeric" value="${D.calTargets.kcalMin}"></label>
        <label class="f">Kcal max<input name="kmax" inputmode="numeric" value="${D.calTargets.kcalMax}"></label>
        <label class="f">Protéines min (g)<input name="pmin" inputmode="numeric" value="${D.calTargets.protMin}"></label>
        <button class="btn" type="submit">Enregistrer</button>
      </form>
      <div id="foods"></div>
    </details>
  </section>`;
  renderTotals(); renderAdd(); renderDay(); renderWeek(); renderFoods();
  bindStatic();
}

function renderTotals(){
  const t = sum(D.meals[state.date] || []), T = D.calTargets;
  const pct = Math.min(100, t.kcal / T.kcalMax * 100), pctMin = T.kcalMin / T.kcalMax * 100;
  const verdict = t.kcal === 0 ? "Rien noté pour ce jour." :
    t.kcal < T.kcalMin ? `Il te manque <b>${fmt(T.kcalMin - t.kcal)} kcal</b> pour atteindre ${fmt(T.kcalMin)}.` :
    t.kcal <= T.kcalMax ? "Objectif calories atteint." : `${fmt(t.kcal - T.kcalMax)} kcal au-dessus de ${fmt(T.kcalMax)}.`;
  const pLeft = T.protMin - t.p;
  $("#tot").innerHTML = `
    <div class="cal-big"><b>${fmt(t.kcal)}</b><span>/ ${fmt(T.kcalMin)}–${fmt(T.kcalMax)} kcal</span></div>
    <div class="cal-bar" role="img" aria-label="${fmt(t.kcal)} kcal sur ${fmt(T.kcalMax)}"><i style="width:${pct}%"></i><em style="left:${pctMin}%"></em></div>
    <p class="muted" style="margin:10px 0 14px">${verdict}${t.kcal && pLeft > 0 ? ` Protéines : encore <b>${fmt(pLeft)} g</b>.` : ""}</p>
    <div class="stats cal-macros">
      <div class="stat${t.p >= T.protMin ? " ok" : ""}"><b>${fmt(t.p)} g</b><small>protéines · min ${T.protMin} g</small></div>
      <div class="stat"><b>${fmt(t.c)} g</b><small>glucides</small></div>
      <div class="stat"><b>${fmt(t.l)} g</b><small>lipides</small></div>
    </div>`;
}

function renderAdd(){
  const el = $("#add"); if(!el) return;
  const noKey = !P.gemCfg.key;
  const keyNote = `<div class="alert" style="margin-bottom:12px">Pas de clé Gemini sur cet appareil. <a href="reglages.html" style="color:inherit">L'ajouter dans Réglages</a></div>`;
  let h = "";
  if(state.mode === "photo"){
    h = `${noKey ? keyNote : ""}
      <div class="cal-2btn">
        <label class="btn${state.busy === "photo" ? " is-busy" : ""}">Prendre une photo<input type="file" data-photo accept="image/*" capture="environment" hidden></label>
        <label class="btn ghost${state.busy === "photo" ? " is-busy" : ""}">Depuis la galerie<input type="file" data-photo accept="image/*" hidden></label>
      </div>
      ${state.photo ? photoBlock() : `<p class="muted cal-hint">Gemini repère chaque aliment et estime les grammes. Tu corriges avant d'ajouter.</p>`}`;
  }
  if(state.mode === "scan"){
    const s = state.scan;
    h = s && s.product ? productCard(s) : `
      <button class="btn big scan-cta" type="button" data-act="cam"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M2 5h2v14H2zm3 0h1v14H5zm2 0h3v14H7zm4 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h3v14h-3z"/></svg>Scanner un code-barres</button>
      <form id="bc" class="form-row" style="margin-top:12px" autocomplete="off">
        <label class="f" data-wide>Ou tape les chiffres<input name="code" inputmode="numeric" placeholder="3017620422003" value="${esc(s && s.code ? s.code : "")}"></label>
        <button class="btn ghost" type="submit">Chercher</button>
      </form>
      <label class="btn ghost sm" style="margin-top:10px">Lire le code sur une photo<input type="file" id="bc-photo" accept="image/*" hidden></label>
      ${!s ? `<p class="muted cal-hint">Produits du commerce via Open Food Facts, la base utilisée par Yuka. Gratuit, sans clé.</p>` :
        s.busy === "photo" ? `<p class="muted cal-hint">Lecture du code sur la photo…</p>` :
        s.busy === "off" ? `<div class="yk yk-skel" aria-busy="true"><div class="yk-h"><div class="yk-noimg"></div><div class="yk-id"><h3>Recherche du produit…</h3><p>${esc(s.code)}</p></div></div></div>` :
        s.err ? `<div class="alert" style="margin-top:12px">${esc(s.err)}</div>${s.code ? `<button class="btn ghost sm" style="margin-top:10px" data-act="scan-free">Le saisir à la main</button>` : ""}` : ""}`;
  }
  if(state.mode === "search"){
    h = `<form id="food" class="form-row" autocomplete="off">
        <label class="f" data-wide>Aliment<input name="q" placeholder="ex. riz basmati cuit" value="${esc(state.q)}"></label>
        <label class="f" style="max-width:110px">Grammes<input name="g" inputmode="decimal" placeholder="g" value="${esc(state.g)}"></label>
        <button class="btn" type="submit">Ajouter</button>
      </form>
      <div id="sugg" class="cal-sugg">${suggestions()}</div>`;
  }
  if(state.mode === "free"){
    const f = state.free || {};
    h = `<form id="free" class="form-row" autocomplete="off">
        <label class="f" data-wide>Nom<input name="n" placeholder="ex. bol de pâtes maison" value="${esc(f.n || "")}" required></label>
        <label class="f">Grammes (si connus)<input name="g" inputmode="decimal" placeholder="vide = 1 portion" value="${esc(f.g || "")}"></label>
        <label class="f">Kcal<input name="k" inputmode="decimal" value="${esc(f.k || "")}" required></label>
        <label class="f">Protéines (g)<input name="p" inputmode="decimal" value="${esc(f.p || "")}"></label>
        <label class="f">Glucides (g)<input name="c" inputmode="decimal" value="${esc(f.c || "")}"></label>
        <label class="f">Lipides (g)<input name="l" inputmode="decimal" value="${esc(f.l || "")}"></label>
        <label class="cal-chk" data-wide style="grid-column:1/-1"><input type="checkbox" name="keep"><span>Enregistrer dans mes aliments (retrouvable en Recherche)</span></label>
        <button class="btn" type="submit">Ajouter</button>
      </form>
      <p class="muted cal-hint">Valeurs pour la quantité mangée, pas pour 100 g.</p>`;
  }
  el.innerHTML = h;
  bindAdd();
}

/* ---------- fiche produit façon Yuka ---------- */
const NS = { a: ["Excellent", "#038141"], b: ["Bon", "#85BB2F"], c: ["Moyen", "#E5B700"], d: ["Médiocre", "#EE8100"], e: ["Mauvais", "#E63E11"] };
const NOVA = { 1: "Non transformé", 2: "Ingrédient culinaire", 3: "Transformé", 4: "Ultra-transformé" };
/* seuils pour 100 g (solides) puis 100 ml (boissons), utilisés si Open Food Facts ne donne pas le niveau */
const LIM = { sugars: [5, 22.5, 2.5, 11.25], "saturated-fat": [1.5, 5, 0.75, 2.5], salt: [0.3, 1.5, 0.3, 0.75] };
const LTXT = {
  sugars: ["Sucres", "Sans sucre", "Peu sucré", "Moyennement sucré", "Trop sucré"],
  "saturated-fat": ["Graisses saturées", "Sans graisses saturées", "Peu de graisses saturées", "Graisses saturées modérées", "Trop de graisses saturées"],
  salt: ["Sel", "Sans sel", "Peu salé", "Moyennement salé", "Trop salé"] };
const gTxt = x => (x < 1 && x > 0 ? (Math.round(x * 100) / 100).toLocaleString("fr-FR") : x < 10 ? dec(x) : fmt(x)) + " g";
function level(pr, key, val){
  if(pr.lv && /^(low|moderate|high)$/.test(pr.lv[key])) return pr.lv[key];
  const t = LIM[key], lo = pr.drink ? t[2] : t[0], hi = pr.drink ? t[3] : t[1];
  return val <= lo ? "low" : val > hi ? "high" : "moderate";
}
function nutriRows(pr){
  const rows = [];
  [["sugars", pr.sug], ["saturated-fat", pr.sat], ["salt", pr.salt]].forEach(([key, val]) => {
    if(val == null) return;
    const lv = level(pr, key, val), T = LTXT[key];
    rows.push({ name: T[0], val, label: val === 0 ? T[1] : T[{ low: 2, moderate: 3, high: 4 }[lv]], tone: { low: "g1", moderate: "o", high: "r" }[lv] });
  });
  if(pr.p >= 5) rows.push({ name: "Protéines", val: pr.p, label: pr.p >= 10 ? "Riche en protéines" : "Source de protéines", tone: pr.p >= 10 ? "g1" : "g2" });
  if(pr.fib != null && pr.fib >= 3) rows.push({ name: "Fibres", val: pr.fib, label: pr.fib >= 6 ? "Riche en fibres" : "Source de fibres", tone: pr.fib >= 6 ? "g1" : "g2" });
  return rows;
}
const rowHtml = r => `<li class="t-${r.tone}"><i aria-hidden="true"></i><span>${esc(r.name)}<small>${esc(r.label)}</small></span><b>${gTxt(r.val)}</b></li>`;
const sumTxt = q => `${fmt(q.kcal)} kcal · P ${dec(q.p)} g · G ${dec(q.c)} g · L ${dec(q.l)} g`;

function productCard(s){
  const pr = s.product, u = pr.unit || "g", g = s.g || 0, q = forQty(pr, g);
  const ns = pr.grade ? NS[pr.grade] : null;
  const rows = pr.hasNutri ? nutriRows(pr) : [];
  const bad = rows.filter(r => r.tone === "o" || r.tone === "r").sort((a,b) => (b.tone === "r") - (a.tone === "r"));
  const good = rows.filter(r => r.tone === "g1" || r.tone === "g2");
  const chips = [];
  if(pr.serving) chips.push([rq(pr.serving), `1 portion · ${fq(pr.serving)} ${u}`]);
  chips.push([100, `100 ${u}`]);
  if(pr.pq && pr.pq !== 100) chips.push([rq(pr.pq), `${pr.drink ? "Bouteille" : "Paquet"} entier · ${fq(pr.pq)} ${u}`]);
  const tags = [
    pr.nova ? `<span class="yk-tag nova n${pr.nova}">NOVA ${pr.nova} · ${NOVA[pr.nova] || ""}</span>` : "",
    Array.isArray(pr.add) ? `<span class="yk-tag${pr.add.length ? "" : " ok"}">${pr.add.length ? `${pr.add.length} additif${pr.add.length > 1 ? "s" : ""} : ${esc(pr.add.slice(0, 6).join(", "))}${pr.add.length > 6 ? "…" : ""}` : "Sans additif"}</span>` : ""
  ].join("");
  return `<article class="yk" aria-label="Fiche produit">
    <header class="yk-h">
      ${pr.img ? `<img src="${esc(pr.img)}" alt="" referrerpolicy="no-referrer">` : `<div class="yk-noimg" aria-hidden="true"></div>`}
      <div class="yk-id">
        <h3>${esc(pr.name || pr.n)}</h3>
        <p>${esc([pr.brand, pr.qty].filter(Boolean).join(" · ")) || (pr.src === "perso" ? "Aliment enregistré" : "&nbsp;")}</p>
        ${pr.src === "perso" ? "" : `<div class="yk-score" style="--c:${ns ? ns[1] : "#5d6584"}"><b>${ns ? pr.grade.toUpperCase() : "?"}</b><span>${ns ? ns[0] : "Non noté"}<small>Nutri-Score</small></span></div>`}
      </div>
    </header>
    ${pr.hasNutri ? `
    <div class="yk-kcal"><b>${fmt(pr.k)}</b> kcal <span>pour 100 ${u}${pr.serving ? ` · ${fmt(pr.k * pr.serving / 100)} kcal la portion` : ""}</span></div>
    <div class="yk-macros"><span><b>${dec(pr.p)} g</b>protéines</span><span><b>${dec(pr.c)} g</b>glucides</span><span><b>${dec(pr.l)} g</b>lipides</span></div>
    ${bad.length ? `<h4>Points faibles</h4><ul class="yk-list">${bad.map(rowHtml).join("")}</ul>` : ""}
    ${good.length ? `<h4>Points forts</h4><ul class="yk-list">${good.map(rowHtml).join("")}</ul>` : ""}
    ${tags ? `<div class="yk-tags">${tags}</div>` : ""}
    <form id="prod" class="yk-add" autocomplete="off">
      <h4>Je l'ai mangé</h4>
      <div class="yk-chips">${chips.map(([v, l]) => `<button type="button" data-q="${v}" aria-pressed="${v === rq(g)}">${l}</button>`).join("")}</div>
      <div class="yk-qty">
        ${pr.serving ? `<label class="f">Portions<input name="por" inputmode="decimal" value="${fq(g / pr.serving)}"></label><span class="yk-eq" aria-hidden="true">=</span>` : ""}
        <label class="f">Quantité (${u})<input name="g" inputmode="decimal" value="${fq(g)}"></label>
      </div>
      <div class="seg yk-meal" role="group" aria-label="Repas">${MEALS.map(([k, l]) => `<button type="button" data-pm="${k}" aria-pressed="${k === state.meal}">${l}</button>`).join("")}</div>
      <p class="yk-sum" aria-live="polite">${sumTxt(q)}</p>
      <button class="btn green big" type="submit">Ajouter ${fmt(q.kcal)} kcal</button>
    </form>` : `
    ${tags ? `<div class="yk-tags">${tags}</div>` : ""}
    <div class="alert">Ce produit n'a pas de valeurs nutritionnelles dans Open Food Facts.</div>
    <button class="btn" type="button" data-act="scan-free">Le saisir à la main</button>`}
    <button class="btn ghost yk-again" type="button" data-act="scan-again">Scanner un autre produit</button>
  </article>`;
}

function photoBlock(){
  const ph = state.photo, items = ph.items || [], qs = ph.questions || [];
  const tot = sum(items.filter(it => it.on));
  const busy = state.busy === "photo";
  const askQ = qs.length && !busy;
  return `<div class="cal-photo">
    <img src="${ph.url}" alt="Ton plat">
    ${busy ? `<p class="muted cal-hint">${ph.round > 1 ? "Gemini recalcule avec tes réponses…" : "Gemini analyse ton plat…"}</p>` : ""}
    ${ph.err ? `<div class="alert">${esc(ph.err)}</div><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>` : ""}
    ${askQ ? `<form id="phq" class="ph-q" autocomplete="off">
      <b>Gemini a besoin de précisions</b>
      ${qs.map((q, i) => `<label class="f">${esc(q)}<input name="a${i}" value="${esc((ph.answers || {})["a" + i] || "")}"></label>`).join("")}
      <div class="ph-q-btns"><button class="btn" type="submit">Répondre et recalculer</button>${items.length ? `<button class="btn ghost sm" type="button" data-act="ph-skip">Garder l'estimation</button>` : `<button class="btn ghost sm" type="button" data-act="ph-cancel">Annuler</button>`}</div>
    </form>` : ""}
    ${ph.items && !busy ? (items.length ? `
      ${askQ ? `<p class="muted cal-hint" style="margin:6px 0 0">Estimation provisoire, sans tes réponses :</p>` : ""}
      <ul class="cal-items${askQ ? " prov" : ""}">${items.map((it,i) => `<li class="ph${it.on ? "" : " off"}">
        <label class="cal-chk"><input type="checkbox" data-ph-on="${i}"${it.on ? " checked" : ""}><span>${esc(it.n)}</span></label>
        <input class="cal-g" data-ph-g="${i}" inputmode="decimal" value="${r0(it.g)}" aria-label="Grammes de ${esc(it.n)}"><span class="muted">g</span>
        <b>${fmt(forQty(it).kcal)}</b></li>`).join("")}</ul>
      ${ph.comment ? `<p class="details" style="margin:4px 0">${esc(ph.comment)}</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn green" data-act="ph-add">Ajouter ${fmt(tot.kcal)} kcal</button>
        <button class="btn ghost sm" data-act="ph-cancel">Annuler</button>
      </div>` : askQ ? "" : `<p class="muted">Aucun aliment reconnu sur cette photo.${ph.comment ? " Gemini dit : " + esc(ph.comment) : ""} <span class="muted">(modèle : ${esc(ph.model || "?")})</span></p><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>`) : ""}
  </div>`;
}

function suggestions(){
  const q = norm(state.q);
  if(state.busy === "food") return `<p class="muted cal-hint">Gemini estime « ${esc(state.q)} »…</p>`;
  if(state.pick) return `<p class="muted cal-hint">Sélectionné : <b>${esc(state.pick.n)}</b> · ${fmt(state.pick.k)} kcal, ${dec(state.pick.p)} g prot. pour 100 g${state.pick.src === "gemini" ? " (estimation Gemini)" : ""}. Indique les grammes puis Ajouter.</p>`;
  if(q.length < 2) return `<p class="muted cal-hint">Tape au moins 2 lettres : ${(window.PDM_FOODS || []).length} aliments de base + tes aliments enregistrés.</p>`;
  const words = q.split(/\s+/);
  const hits = allFoods().filter(f => { const n = norm(f.n); return words.every(w => n.includes(w)); }).slice(0, 8);
  return `${hits.map(f => `<button type="button" class="cal-opt" data-pick="${esc(f.n)}"><span>${esc(f.n)}</span><small>${fmt(f.k)} kcal · ${dec(f.p)} g prot. /100 g${f.src === "perso" ? " · perso" : ""}</small></button>`).join("")}
    <button type="button" class="cal-opt ai" data-act="ask"><span>${hits.length ? "Pas le bon ? " : "Introuvable : "}estimer « ${esc(state.q.trim())} » avec Gemini</span><small>valeurs pour 100 g, enregistrées pour la prochaine fois</small></button>`;
}

function renderDay(){
  const day = D.meals[state.date] || [];
  $("#h-day").textContent = state.date === todayISO() ? "Aujourd'hui" : fmtDate(state.date);
  $("#day").innerHTML = day.length ? MEALS.map(([k,l]) => mealBlock(k, l, day.filter(it => (it.m || "dej") === k))).join("") : `<p class="empty">Ajoute une photo, un code-barres ou un aliment.</p>`;
}
function mealBlock(k, label, items){
  if(!items.length) return "";
  const t = sum(items);
  return `<div class="cal-meal"><div class="cal-meal-h"><h3>${label}</h3><span class="muted">${fmt(t.kcal)} kcal · ${fmt(t.p)} g prot.</span></div>
    <ul class="cal-items">${items.map(it => state.edit === it.id ? editRow(it) : `<li class="row" data-it="${it.id}">
      <span class="cal-name">${esc(it.n)}<small class="muted">${qtyLabel(it)} · P ${fmt(forQty(it).p)} · G ${fmt(forQty(it).c)} · L ${fmt(forQty(it).l)}${it.src === "photo" ? " · photo" : it.src === "off" ? " · code-barres" : ""}</small></span>
      <b>${fmt(forQty(it).kcal)}</b>
      <span class="cal-acts"><button class="icon-btn" data-act="edit-it" aria-label="Modifier ${esc(it.n)}">Modifier</button><button class="icon-btn danger" data-act="del-it" aria-label="Supprimer ${esc(it.n)}">×</button></span></li>`).join("")}</ul></div>`;
}
function editRow(it){
  const q = forQty(it);
  return `<li class="cal-edit" data-it="${it.id}"><form class="form-row" data-edit>
    <label class="f" data-wide>Nom<input name="n" value="${esc(it.n)}"></label>
    <label class="f">Repas<select name="m">${MEALS.map(([k,l]) => `<option value="${k}"${k === (it.m || "dej") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
    ${it.por ? "" : `<label class="f">Grammes<input name="g" inputmode="decimal" value="${r1(it.g)}"></label>`}
    <label class="f">Kcal<input name="k" inputmode="decimal" value="${r0(q.kcal)}"></label>
    <label class="f">Protéines<input name="p" inputmode="decimal" value="${r1(q.p)}"></label>
    <label class="f">Glucides<input name="c" inputmode="decimal" value="${r1(q.c)}"></label>
    <label class="f">Lipides<input name="l" inputmode="decimal" value="${r1(q.l)}"></label>
    <button class="btn" type="submit">Enregistrer</button>
    <button class="btn ghost" type="button" data-act="edit-cancel">Annuler</button>
  </form><p class="muted cal-hint" style="margin:6px 0 0">${it.por ? "" : "Changer les grammes recalcule les valeurs. "}Les valeurs sont pour la quantité mangée.</p></li>`;
}

function renderWeek(){
  const days = []; for(let i = 6; i >= 0; i--) days.push(shiftDate(state.date, -i));
  const T = D.calTargets;
  const vals = days.map(d => ({ d, t: sum(D.meals[d] || []), n: (D.meals[d] || []).length }));
  const max = Math.max(T.kcalMax, ...vals.map(v => v.t.kcal)) * 1.05;
  const noted = vals.filter(v => v.n);
  const avg = k => noted.reduce((a,v) => a + v.t[k], 0) / (noted.length || 1);
  $("#week").innerHTML = `<div class="cal-week">${vals.map(v => `<button data-go="${v.d}" class="${v.d === state.date ? "cur" : ""}" aria-label="${fmtDate(v.d)} : ${fmt(v.t.kcal)} kcal">
      <span class="cal-col"><i style="height:${v.t.kcal / max * 100}%" class="${v.t.kcal >= T.kcalMin ? "ok" : ""}"></i><em style="bottom:${T.kcalMin / max * 100}%"></em></span>
      <b>${v.n ? fmt(v.t.kcal) : "—"}</b><small>${new Date(v.d + "T12:00").toLocaleDateString("fr-FR", { weekday: "short" })}</small></button>`).join("")}</div>
    <p class="muted" style="margin:12px 0 0">${noted.length ? `Moyenne sur ${noted.length} jour${noted.length > 1 ? "s" : ""} notés : <b>${fmt(avg("kcal"))} kcal</b> et <b>${fmt(avg("p"))} g</b> de protéines.` : "Aucun jour noté sur cette période."}</p>`;
}
function renderFoods(){
  $("#foods").innerHTML = D.customFoods.length ? `<h3 style="margin-top:18px">Tes aliments enregistrés</h3><div class="chips" style="margin-top:8px">${D.customFoods.map((f,i) => `<span class="chip">${esc(f.n)} <small>${fmt(f.k)} kcal/100 g</small><button data-act="del-food" data-i="${i}" aria-label="Supprimer ${esc(f.n)}">×</button></span>`).join("")}</div>` : `<p class="muted" style="margin-top:14px">Les aliments estimés par Gemini, scannés ou saisis à la main s'enregistrent ici.</p>`;
}
function refreshData(){ renderTotals(); renderDay(); renderWeek(); renderFoods(); }

/* ---------- actions ---------- */
function addItems(items){
  (D.meals[state.date] = D.meals[state.date] || []).push(...items);
  P.save(items.length > 1 ? `${items.length} aliments ajoutés` : `${items[0].n} ajouté`);
  refreshData();
}
const item = (food, g, src) => ({ id: uid("m"), n: food.n, g, k: r1(food.k), p: r1(food.p), c: r1(food.c), l: r1(food.l), m: state.meal, src });

function bindStatic(){
  $("#cal-day").onchange = e => { if(e.target.value){ state.date = e.target.value; state.edit = null; refreshData(); } };
  $$("[data-meal]", root).forEach(b => b.onclick = () => { state.meal = b.dataset.meal; $$("[data-meal]", root).forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $$("[data-mode]", root).forEach(b => b.onclick = () => {
    state.mode = b.dataset.mode; try { localStorage.setItem("pdm-cal-mode", state.mode); } catch(e){}
    $$("[data-mode]", root).forEach(x => x.setAttribute("aria-selected", x === b)); renderAdd();
  });
  $("#goals").onsubmit = e => {
    e.preventDefault(); const c = e.target;
    const kmin = num(c.kmin.value), kmax = num(c.kmax.value), pmin = num(c.pmin.value);
    if(!(kmin && kmax && kmax >= kmin && pmin)){ toast("Objectifs invalides"); return; }
    D.calTargets = { kcalMin: kmin, kcalMax: kmax, protMin: pmin }; P.save("Objectifs enregistrés"); refreshData();
  };
  root.onclick = e => {
    const go = e.target.closest("[data-go]"); if(go){ state.date = go.dataset.go; state.edit = null; render(); return; }
    const b = e.target.closest("[data-act]"); if(!b) return;
    const a = b.dataset.act, li = b.closest("[data-it]");
    const it = li ? (D.meals[state.date] || []).find(x => x.id === li.dataset.it) : null;
    if(a === "day"){ state.date = shiftDate(state.date, +b.dataset.d); state.edit = null; render(); }
    if(a === "today"){ state.date = todayISO(); state.edit = null; render(); }
    if(a === "edit-it"){ state.edit = it.id; renderDay(); const f = $(`[data-it="${it.id}"] input`); f && f.focus(); }
    if(a === "edit-cancel"){ state.edit = null; renderDay(); }
    if(a === "del-it" && it && confirm(`Supprimer ${it.n} ?`)){
      D.meals[state.date] = D.meals[state.date].filter(x => x !== it);
      if(!D.meals[state.date].length) delete D.meals[state.date];
      P.save("Supprimé"); refreshData();
    }
    if(a === "del-food"){
      const fd = D.customFoods[+b.dataset.i];
      if(confirm(`Retirer « ${fd.n} » de tes aliments enregistrés ?`)){ D.customFoods.splice(+b.dataset.i, 1); P.save("Aliment retiré"); renderFoods(); }
    }
  };
  root.onsubmit = e => {
    const f = e.target; if(!f.hasAttribute("data-edit")) return;
    e.preventDefault();
    const it = (D.meals[state.date] || []).find(x => x.id === f.closest("[data-it]").dataset.it); if(!it) return;
    const g = it.por ? 100 : num(f.g.value), k = num(f.k.value);
    if(!g || g <= 0 || k == null || k < 0){ toast("Grammes ou kcal invalides"); return; }
    const old = forQty(it), changedG = !it.por && g !== it.g;
    const vals = { k, p: num(f.p.value) || 0, c: num(f.c.value) || 0, l: num(f.l.value) || 0 };
    /* si seuls les grammes changent, on garde la valeur pour 100 g ; sinon les valeurs saisies font foi */
    const valsChanged = r0(vals.k) !== r0(old.kcal) || r1(vals.p) !== r1(old.p) || r1(vals.c) !== r1(old.c) || r1(vals.l) !== r1(old.l);
    if(valsChanged){ it.k = r1(vals.k / g * 100); it.p = r1(vals.p / g * 100); it.c = r1(vals.c / g * 100); it.l = r1(vals.l / g * 100); }
    if(changedG) it.g = g;
    it.n = f.n.value.trim() || it.n; it.m = f.m.value;
    state.edit = null; P.save("Modifié"); refreshData();
  };
}

/* analyse Gemini de la photo ; relance sur un autre modèle si la réponse est vide */
async function runPhoto(text, retryEmpty){
  const ph = state.photo;
  const ask = avoid => P.gemini({ parts: [{ text }, { inline_data: { mime_type: "image/jpeg", data: ph.b64 } }], schema: SCHEMA_PHOTO, avoid });
  const clean = r => (r.aliments || []).filter(a => a && a.grammes > 0);
  const qOf = r => (r.questions || []).map(q => String(q || "").trim()).filter(Boolean).slice(0, 3);
  let res = await ask(), used = P.gemCfg.lastModel;
  if(retryEmpty && !clean(res).length && !qOf(res).length){
    try{ const r2 = await ask([used]); if(clean(r2).length || qOf(r2).length){ res = r2; used = P.gemCfg.lastModel; } }catch(e){}
  }
  const al = clean(res);
  ph.raw = { aliments: al, commentaire: res.commentaire || "" };
  ph.items = al.map(a => ({ n: a.nom, g: a.grammes, on: true,
    k: a.kcal / a.grammes * 100, p: a.proteines / a.grammes * 100, c: a.glucides / a.grammes * 100, l: a.lipides / a.grammes * 100 }));
  ph.comment = res.commentaire || ""; ph.model = used;
  ph.questions = qOf(res);
}

function bindAdd(){
  const el = $("#add");
  $$("[data-photo]", el).forEach(inp => inp.onchange = async e => {
    const file = e.target.files[0]; if(!file || state.busy === "photo") return;
    let img; try { img = await shrink(file); } catch(err){ toast(err.message); return; }
    state.photo = { url: img.url, b64: img.b64, items: null, round: 1 }; state.busy = "photo"; renderAdd();
    try{ await runPhoto(PROMPT_PHOTO, true); }catch(err){ state.photo.err = err.message; }
    state.busy = false; renderAdd();
  });
  const phq = $("#phq", el);
  if(phq){
    phq.oninput = () => { const ph = state.photo; ph.answers = {}; [...new FormData(phq)].forEach(([k, v]) => ph.answers[k] = v); };
    phq.onsubmit = async e => {
      e.preventDefault();
      const ph = state.photo, qa = ph.questions.map((q, i) => [q, (phq["a" + i].value || "").trim()]).filter(([, a]) => a);
      if(!qa.length){ toast("Réponds à au moins une question"); return; }
      ph.round = 2; state.busy = "photo"; renderAdd();
      try{ await runPhoto(PROMPT_PHOTO_2(ph.raw, qa.map(([q, a]) => `- ${q} → ${a}`).join("\n")), false); ph.questions = []; ph.err = null; }
      catch(err){ toast(err.message); }
      state.busy = false; renderAdd();
    };
  }
  const skip = $("[data-act=ph-skip]", el); if(skip) skip.onclick = () => { state.photo.questions = []; renderAdd(); };
  const phAdd = $("[data-act=ph-add]", el);
  if(phAdd) phAdd.onclick = () => {
    const items = state.photo.items.filter(it => it.on && it.g > 0).map(it => item(it, it.g, "photo"));
    if(!items.length){ toast("Rien de coché"); return; }
    addItems(items); state.photo = null; renderAdd();
  };
  $$("[data-act=ph-cancel]", el).forEach(b => b.onclick = () => { state.photo = null; renderAdd(); });
  $$("[data-ph-g]", el).forEach(inp => inp.oninput = () => { const v = num(inp.value); if(v != null && v >= 0){ state.photo.items[+inp.dataset.phG].g = v; phTotals(); } });
  $$("[data-ph-on]", el).forEach(c => c.onchange = () => { state.photo.items[+c.dataset.phOn].on = c.checked; c.closest("li").classList.toggle("off", !c.checked); phTotals(); });
  function phTotals(){
    const items = state.photo.items;
    $$(".cal-photo li", el).forEach((li, i) => { li.querySelector("b").textContent = fmt(forQty(items[i]).kcal); });
    $("[data-act=ph-add]", el).textContent = `Ajouter ${fmt(sum(items.filter(it => it.on)).kcal)} kcal`;
  }

  /* code-barres */
  const cam = $("[data-act=cam]", el); if(cam) cam.onclick = startCamera;
  const bcp = $("#bc-photo"); if(bcp) bcp.onchange = e => { const f = e.target.files[0]; if(f) decodePhoto(f); };
  const bc = $("#bc"); if(bc) bc.onsubmit = e => { e.preventDefault(); lookup(bc.code.value); };
  const sf = $("[data-act=scan-free]", el); if(sf) sf.onclick = () => { const s = state.scan || {}; state.free = { n: (s.product && s.product.n) || "" }; state.scan = null; state.mode = "free"; render(); };
  const again = $("[data-act=scan-again]", el); if(again) again.onclick = () => { state.scan = null; renderAdd(); startCamera(); };
  const prod = $("#prod");
  if(prod){
    const pr = state.scan.product;
    const upd = from => {
      const s = state.scan; s.touched = true;
      if(from === "por"){ const v = num(prod.por.value); if(v == null || v < 0) return; s.g = rq(v * pr.serving); prod.g.value = fq(s.g); }
      else { const v = num(prod.g.value); s.g = v != null && v >= 0 ? v : 0; if(prod.por) prod.por.value = fq(s.g / pr.serving); }
      const q = forQty(pr, s.g);
      prod.querySelector(".yk-sum").textContent = sumTxt(q);
      prod.querySelector("[type=submit]").textContent = `Ajouter ${fmt(q.kcal)} kcal`;
      $$("[data-q]", prod).forEach(c => c.setAttribute("aria-pressed", +c.dataset.q === rq(s.g)));
    };
    prod.g.oninput = () => upd("g");
    if(prod.por) prod.por.oninput = () => upd("por");
    $$("[data-q]", prod).forEach(c => c.onclick = () => { prod.g.value = c.dataset.q; upd("g"); });
    $$("[data-pm]", prod).forEach(b => b.onclick = () => {
      state.meal = b.dataset.pm;
      $$("[data-pm]", prod).forEach(x => x.setAttribute("aria-pressed", x === b));
      $$("[data-meal]", root).forEach(x => x.setAttribute("aria-pressed", x.dataset.meal === state.meal));
    });
    prod.onsubmit = e => {
      e.preventDefault(); const g = state.scan.g;
      if(!g || g <= 0){ toast("Indique la quantité"); prod.g.focus(); return; }
      if(pr.src !== "perso") saveFood({ n: pr.n, k: pr.k, p: pr.p, c: pr.c, l: pr.l, code: pr.code, serving: g });
      else { const f = D.customFoods.find(x => x.code === pr.code); if(f) f.serving = g; }
      addItems([item(pr, g, "off")]); state.scan = null; renderAdd();
      const top = $("#h-add"); if(top) top.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  /* recherche */
  const f = $("#food");
  if(f){
    f.q.oninput = () => { state.q = f.q.value; state.pick = null; $("#sugg").innerHTML = suggestions(); };
    f.g.oninput = () => { state.g = f.g.value; };
    $("#sugg").onclick = e => {
      const o = e.target.closest("[data-pick]");
      if(o){ state.pick = allFoods().find(x => x.n === o.dataset.pick); state.q = f.q.value = state.pick.n; $("#sugg").innerHTML = suggestions(); f.g.focus(); return; }
      if(e.target.closest("[data-act=ask]")) ask();
    };
    f.onsubmit = e => {
      e.preventDefault();
      const g = num(f.g.value);
      const food = state.pick || allFoods().find(x => norm(x.n) === norm(f.q.value));
      if(!food){ toast(f.q.value.trim() ? "Choisis un aliment dans la liste ou demande à Gemini" : "Tape un aliment"); return; }
      if(!g || g <= 0){ f.g.focus(); toast("Indique les grammes"); return; }
      addItems([item(food, g, food.src === "gemini" ? "gemini" : "base")]);
      state.q = ""; state.g = ""; state.pick = null; renderAdd();
    };
  }
  async function ask(){
    const q = state.q.trim(); if(!q) return;
    state.busy = "food"; $("#sugg").innerHTML = suggestions();
    try{
      const r = await P.gemini({ parts: [{ text: PROMPT_FOOD(q) }], schema: SCHEMA_FOOD });
      const food = { n: r.nom || q, k: r1(r.kcal), p: r1(r.proteines), c: r1(r.glucides), l: r1(r.lipides) };
      saveFood(food); P.save(); renderFoods();
      state.pick = { ...food, src: "gemini" }; state.q = food.n;
    }catch(err){ toast(err.message); }
    state.busy = false; renderAdd();
    const ff = $("#food"); ff && ff.g.focus();
  }

  /* saisie libre */
  const fr = $("#free");
  if(fr) fr.onsubmit = e => {
    e.preventDefault();
    const n = fr.n.value.trim(), g = num(fr.g.value), k = num(fr.k.value);
    if(!n || k == null || k < 0){ toast("Nom et kcal obligatoires"); return; }
    const base = g && g > 0 ? g : 100, v = x => (num(x) || 0) / base * 100;
    const it = { id: uid("m"), n, g: base, k: r1(k / base * 100), p: r1(v(fr.p.value)), c: r1(v(fr.c.value)), l: r1(v(fr.l.value)), m: state.meal, src: "libre" };
    if(!(g && g > 0)) it.por = true;
    if(fr.keep.checked && !it.por) saveFood({ n, k: it.k, p: it.p, c: it.c, l: it.l });
    if(fr.keep.checked && it.por) toast("Sans grammes, l'aliment n'est pas enregistré (pas de valeur pour 100 g)");
    addItems([it]); state.free = null; renderAdd();
  };
}

render();
})();
