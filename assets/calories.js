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
const state = { date: todayISO(), meal: defaultMeal(), mode, photo: null, busy: false, pick: null, q: "", g: "", scan: null, edit: null, list: [] };

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
const OFF_FIELDS = "product_name,product_name_fr,generic_name_fr,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,nutriments,nutriscore_grade,nutriscore_score,nutriscore_data,nova_group,additives_tags,image_front_small_url,image_front_url,categories_tags,categories_hierarchy,labels_tags,ingredients_text_fr,ingredients_text,allergens_tags,environmental_score_grade,environmental_score_score,environmental_score_data,ecoscore_grade,ecoscore_score,ecoscore_data";
const OFF_CACHE = "pdm-off2";
const lsJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch(e){ return d; } };
const offGet = code => { const c = lsJSON(OFF_CACHE, {})[code]; return c && c.v === 3 ? c : null; };
const offPut = pr => { try { const c = lsJSON(OFF_CACHE, {}); c[pr.code] = { ...pr, at: Date.now() };
  Object.keys(c).sort((a,b) => c[b].at - c[a].at).slice(60).forEach(k => delete c[k]); localStorage.setItem(OFF_CACHE, JSON.stringify(c)); } catch(e){} };

function offProduct(code, pr){
  const nu = pr.nutriments || {}, v = k => { const x = nu[k + "_100g"]; return x == null || x === "" || isNaN(+x) ? null : +x; };
  let k = v("energy-kcal"); if(k == null && v("energy") != null) k = v("energy") / 4.184;
  const unitTxt = String(pr.product_quantity_unit || pr.quantity || "").toLowerCase();
  const cats = pr.categories_tags || pr.categories_hierarchy || [];
  const drink = (pr.nutriscore_data && pr.nutriscore_data.is_beverage === 1) || /\b(ml|cl|l)\b|litre/.test(unitTxt) || cats.some(c => /beverages|boissons|waters|eaux/.test(c));
  const name = pr.product_name_fr || pr.product_name || pr.generic_name_fr || "Produit " + code;
  const brand = pr.brands ? pr.brands.split(",")[0].trim() : "";
  const grade = /^[a-e]$/.test(pr.nutriscore_grade || "") ? pr.nutriscore_grade : null;
  const ed = pr.environmental_score_data || pr.ecoscore_data || {}, adj = ed.adjustments || {};
  const og = adj.origins_of_ingredients || {}, pk = adj.packaging || {}, ts = adj.threatened_species || {};
  const out = { v: 3, code, name, brand, n: brand && !norm(name).includes(norm(brand)) ? `${name} · ${brand}` : name,
    img: pr.image_front_url || pr.image_front_small_url || "", thumb: pr.image_front_small_url || pr.image_front_url || "",
    qty: pr.quantity || "", pq: +pr.product_quantity || null, serving: +pr.serving_quantity || null, servingTxt: pr.serving_size || "",
    drink: !!drink, unit: drink ? "ml" : "g", grade, ns: pr.nutriscore_score == null ? null : +pr.nutriscore_score, nova: +pr.nova_group || null,
    add: Array.isArray(pr.additives_tags) ? pr.additives_tags.map(a => a.replace(/^en:/, "").toUpperCase()) : null,
    labels: pr.labels_tags || [], cats: pr.categories_hierarchy || pr.categories_tags || [],
    ingr: pr.ingredients_text_fr || pr.ingredients_text || "", allergens: pr.allergens_tags || [],
    hasNutri: k != null, k: r1(k || 0), p: r1(v("proteins") || 0), c: r1(v("carbohydrates") || 0), l: r1(v("fat") || 0),
    sug: v("sugars"), sat: v("saturated-fat"), salt: v("salt"), fib: v("fiber"),
    fvl: v("fruits-vegetables-legumes-estimate-from-ingredients") ?? v("fruits-vegetables-nuts-estimate-from-ingredients"),
    env: {
      grade: pr.environmental_score_grade || pr.ecoscore_grade || "",
      agri: ed.agribalyse && ed.agribalyse.score != null ? +ed.agribalyse.score : null,
      pack: { score: pk.score == null ? null : +pk.score, warn: pk.warning || "", mats: (pk.packagings || []).map(x => [x.shape || "", x.material || ""]) },
      orig: (og.aggregated_origins || []).filter(o => o.origin && o.origin !== "en:unknown").map(o => [o.origin, +o.percent || 0]),
      origScore: og.transportation_scores && og.transportation_scores.fr != null ? +og.transportation_scores.fr : null,
      origVal: og.value == null ? null : +og.value,
      threat: ts.ingredient || "",
      labels: (adj.production_system && adj.production_system.labels) || []
    },
    src: "off" };
  out.score = pdmScore(out);
  return out;
}
async function lookup(code){
  code = String(code).replace(/\D/g, "");
  if(code.length < 8){ toast("Code trop court"); return; }
  const known = D.customFoods.find(f => f.code === code);
  const lastQty = known && known.serving;
  const persoP = () => ({ v: 3, code, n: known.n, name: known.n, brand: "", k: known.k, p: known.p, c: known.c, l: known.l, hasNutri: true, unit: "g", add: null, labels: [], cats: [], env: {}, src: "perso" });
  const cached = offGet(code);
  if(cached){ showProduct(cached, lastQty); refreshOff(code); return; }
  state.scan = { code, busy: "off" }; renderAdd();
  try{
    const pr = await fetchOff(code);
    if(pr){ offPut(pr); showProduct(pr, lastQty); }
    else if(known) showProduct(persoP(), lastQty);
    else { state.scan = { code, err: `Produit ${code} absent d'Open Food Facts.` }; renderAdd(); }
  }catch(err){
    if(known) showProduct(persoP(), lastQty);
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
async function refreshOff(code){ /* le cache s'affiche tout de suite, la fiche se met à jour en fond */
  try{ const pr = await fetchOff(code); if(pr){ offPut(pr); const s = state.scan; if(s && s.product && s.product.code === code && !s.touched){ s.product = pr; rerenderSheet(); } } }catch(e){}
}
function showProduct(pr, lastQty){
  const g = lastQty || pr.serving || (pr.pq && pr.pq <= 100 ? pr.pq : 100);
  state.scan = { code: pr.code, product: pr, g: rq(g) };
  renderAdd(); openSheet();
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
      ${state.photo ? photoBlock() : `<p class="muted cal-hint">Gemini repère chaque aliment et estime les grammes. Tu corriges avant d'ajouter.</p>`}
      ${gemLine()}`;
  }
  if(state.mode === "scan"){
    const s = state.scan;
    const favs = D.customFoods.filter(f => f.fav && f.code);
    h = s && s.product ? miniCard(s.product) : `
      <button class="btn big scan-cta" type="button" data-act="cam"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M2 5h2v14H2zm3 0h1v14H5zm2 0h3v14H7zm4 0h1v14h-1zm3 0h2v14h-2zm3 0h1v14h-1zm2 0h3v14h-3z"/></svg>Scanner un code-barres</button>
      <form id="bc" class="form-row" style="margin-top:12px" autocomplete="off">
        <label class="f" data-wide>Ou tape les chiffres<input name="code" inputmode="numeric" placeholder="3017620422003" value="${esc(s && s.code ? s.code : "")}"></label>
        <button class="btn ghost" type="submit">Chercher</button>
      </form>
      <label class="btn ghost sm" style="margin-top:10px">Lire le code sur une photo<input type="file" id="bc-photo" accept="image/*" hidden></label>
      ${favs.length ? `<div class="cal-favs"><h3>Favoris</h3><div class="chips">${favs.map(f => `<button type="button" class="chip" data-fav="${esc(f.code)}">★ ${esc(f.n)}</button>`).join("")}</div></div>` : ""}
      ${!s ? `<p class="muted cal-hint">Produits du commerce via Open Food Facts, la base utilisée par Yuka. Gratuit, sans clé.</p>` :
        s.busy === "photo" ? `<p class="muted cal-hint">Lecture du code sur la photo…</p>` :
        s.busy === "off" ? `<div class="cal-mini skel" aria-busy="true"><span class="yk-nopic"></span><div><b>Recherche du produit…</b><small>${esc(s.code)}</small></div></div>` :
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

/* ---------- fiche produit façon Yuka (feuille plein écran) ---------- */
const TONE = { g1: "#1e8f4e", g2: "#85bb2f", y: "#f2c200", o: "#ee8100", r: "#e63e11", n: "#b8b8bd" };
const IC = {
  add: '<path d="M9 4.5 4.5 7v5L9 14.5 13.5 12V7z"/><path d="M13.5 7 17 5l3 1.5M9 9.5v2.5"/>',
  kcal: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.9 2.3-5 .2 1.6.9 2.6 1.9 3.1C11 8.5 11 5.5 12 3z"/>',
  sug: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  sat: '<path d="M12 3.5c3 4 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
  salt: '<path d="M8 8h8l1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8"/><circle cx="10.5" cy="14" r=".6"/><circle cx="13.5" cy="13" r=".6"/><circle cx="12" cy="16.5" r=".6"/>',
  prot: '<path d="M7 17c-2.5-2.5-2.5-6.5 0-9s7.5-3.5 10-1 1.5 7.5-1 10-6.5 2.5-9 0z"/><path d="M7 17l-3 3M10 12h4"/>',
  fib: '<path d="M12 21V9M12 13c-3 0-4.5-2-4.5-4 2.5 0 4.5 1.5 4.5 4zm0 0c3 0 4.5-2 4.5-4-2.5 0-4.5 1.5-4.5 4zm0-4c-2 0-3-1.6-3-3.5 1.8 0 3 1.4 3 3.5zm0 0c2 0 3-1.6 3-3.5-1.8 0-3 1.4-3 3.5z"/>',
  fvl: '<path d="M12 8c-3-2-7-.5-7 4 0 4 3 8 5 8 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8 0-4.5-4-6-7-4z"/><path d="M12 8c0-2 1-3.5 3-4"/>',
  prod: '<path d="M4 19h16M6 19c0-3.3 2.7-6 6-6s6 2.7 6 6M9 19c0-1.7 1.3-3 3-3s3 1.3 3 3"/><path d="M12 4v2M5.6 6.6 7 8M18.4 6.6 17 8M3 11h2M19 11h2"/>',
  lab: '<path d="M12 3l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1z"/><path d="m9 12 2 2 4-4"/>',
  pack: '<path d="M7 7.5 9.5 3.5 12 7.5M17 13.5l2.5 4H14.5M7 17.5H4.5L7 13.5"/><path d="M9.5 3.5 12 7.5M14.5 17.5h5M4.5 17.5l2.5-4"/>',
  orig: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  threat: '<path d="M12 21v-6M7 15h10l-3.5-4H16l-4-6-4 6h2.5z"/>',
  nova: '<path d="M5 8h14v11H5zM8 8V5h8v3"/><path d="M9 13h6"/>'
};
const icon = k => `<svg class="yk-ic" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ""}</svg>`;
/* seuils par 100 g (s) et 100 ml (d) : vert foncé ≤ t0 < vert clair ≤ t1 < orange ≤ t2 < rouge */
const SCALE = {
  kcal: { s: [160, 360, 560], d: [1, 14, 35], u: " kcal", name: "Énergie", txt: ["Peu calorique", "Calories raisonnables", "Un peu trop calorique", "Trop calorique"], zero: "Sans calories" },
  sug: { s: [4.5, 9, 18], d: [0, 1.5, 5], u: " g", name: "Sucres", txt: ["Peu sucré", "Faible quantité de sucre", "Un peu trop sucré", "Trop sucré"], zero: "Sans sucre" },
  sat: { s: [1, 2, 4], d: [1, 2, 4], u: " g", name: "Graisses saturées", txt: ["Peu de graisses saturées", "Faible quantité de graisses saturées", "Un peu trop de graisses saturées", "Trop de graisses saturées"], zero: "Sans graisses saturées" },
  salt: { s: [0.46, 0.92, 1.62], d: [0.46, 0.92, 1.62], u: " g", name: "Sel", txt: ["Peu de sel", "Faible quantité de sel", "Un peu trop salé", "Trop salé"], zero: "Sans sel" } };
const POS = {
  prot: { th: [4.8, 8], u: " g", name: "Protéines", txt: ["Peu de protéines", "Quelques protéines", "Excellente quantité de protéines"] },
  fib: { th: [3, 4.7], u: " g", name: "Fibres", txt: ["Peu de fibres", "Quelques fibres", "Excellente quantité de fibres"] },
  fvl: { th: [40, 80], u: " %", name: "Fruits et légumes", txt: ["Peu de fruits et légumes", "Quelques fruits et légumes", "Excellente quantité de fruits et légumes"] } };
const nf = x => x == null ? "" : x === 0 ? "0" : x < 1 ? (Math.round(x * 100) / 100).toLocaleString("fr-FR") : x < 10 ? dec(x) : fmt(x);
const ADD_RISK = { h: ["r", "Risque élevé de surexposition (EFSA)"], m: ["o", "Risque modéré de surexposition (EFSA)"], n: ["g1", "Pas de risque de surexposition (EFSA)"], "": ["n", "Pas d'alerte EFSA connue"] };
const addInfo = c => { const A = (window.PDM_OFFDATA || {}).add || {}; return A[c] || A[c.replace(/[A-Z]+$/, "")] || ["", "", ""]; };
const ENVG = { "a-plus": ["A+", "Impact très faible", "#00803d"], a: ["A", "Très faible impact", "#1e8f4e"], b: ["B", "Faible impact", "#60ac0e"], c: ["C", "Impact modéré", "#d9a400"], d: ["D", "Impact élevé", "#ee8100"], e: ["E", "Impact très élevé", "#e63e11"], f: ["F", "Impact très élevé", "#b0170c"] };
const ENV_LABELS = { "en:organic": "Agriculture biologique", "en:eu-organic": "Agriculture biologique (UE)", "en:ab-agriculture-biologique": "AB Agriculture biologique", "en:rainforest-alliance": "Rainforest Alliance", "en:fair-trade": "Commerce équitable", "en:fairtrade-international": "Fairtrade / Max Havelaar", "en:max-havelaar": "Max Havelaar", "en:msc-sustainable-fishery": "Pêche durable MSC", "en:asc-aquaculture-stewardship-council": "Aquaculture responsable ASC", "en:label-rouge": "Label Rouge", "en:bleu-blanc-coeur": "Bleu-Blanc-Cœur", "en:utz-certified": "UTZ", "en:demeter": "Demeter", "en:nature-et-progres": "Nature & Progrès", "en:haute-valeur-environnementale": "Haute Valeur Environnementale" };
const ENV_LABEL_SUB = { "en:rainforest-alliance": "Lutte contre la déforestation", "en:msc-sustainable-fishery": "Ressources halieutiques préservées" };
const MAT = { glass: "verre", plastic: "plastique", "pet-1-polyethylene-terephthalate": "plastique PET", "hdpe-2-high-density-polyethylene": "plastique PEHD", "pp-5-polypropylene": "plastique PP", "ldpe-4-low-density-polyethylene": "plastique PEBD", "ps-6-polystyrene": "polystyrène", aluminium: "aluminium", steel: "acier", metal: "métal", "paper-or-cardboard": "papier ou carton", paper: "papier", cardboard: "carton", "non-corrugated-cardboard": "carton", "corrugated-cardboard": "carton ondulé", "tetra-pak": "brique Tetra Pak", wood: "bois" };
const SHAPE = { bottle: "bouteille", "bottle-cap": "bouchon", cap: "bouchon", lid: "couvercle", label: "étiquette", box: "boîte", pot: "pot", jar: "bocal", can: "canette", tray: "barquette", bag: "sachet", film: "film", wrapper: "emballage", brick: "brique", sleeve: "manchon", pouch: "doypack" };
const ALG = { "en:milk": "Lait", "en:gluten": "Gluten", "en:eggs": "Œufs", "en:nuts": "Fruits à coque", "en:peanuts": "Arachides", "en:soybeans": "Soja", "en:fish": "Poisson", "en:crustaceans": "Crustacés", "en:molluscs": "Mollusques", "en:celery": "Céleri", "en:mustard": "Moutarde", "en:sesame-seeds": "Sésame", "en:sulphur-dioxide-and-sulphites": "Sulfites", "en:lupin": "Lupin" };
const flag = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : "";
const tag = t => String(t || "").replace(/^[a-z]{2}:/, "");

/* note sur 100, méthode inspirée de Yuka : 60 % nutrition (Nutri-Score), 30 % additifs, 10 % bio */
function nutriPart(pr){
  if(!pr.grade) return null;
  const G = "abcde".indexOf(pr.grade), top = 100 - G * 20;
  const bands = pr.drink ? [[-15, 1], [0, 2], [3, 6], [7, 9], [10, 20]] : [[-17, 0], [1, 2], [3, 10], [11, 18], [19, 40]];
  if(pr.ns == null) return top - 10;
  const [lo, hi] = bands[G], f = Math.min(1, Math.max(0, (pr.ns - lo) / (hi - lo || 1)));
  return Math.round(top - f * 19);
}
function pdmScore(pr){
  const N = nutriPart(pr); if(N == null) return null;
  const risks = (pr.add || []).map(c => addInfo(c)[1]);
  const hi = risks.filter(r => r === "h").length, mo = risks.filter(r => r === "m").length, other = risks.length - hi - mo;
  const A = Math.max(0, 100 - 30 * hi - 15 * mo - 4 * other);
  const B = (pr.labels || []).some(l => /organic|biologique|ab-agriculture/.test(l)) ? 100 : 0;
  let s = Math.round(0.6 * N + 0.3 * A + 0.1 * B);
  if(hi) s = Math.min(s, 49);
  return Math.max(0, Math.min(100, s));
}
const scoreTone = s => s == null ? ["n", "Non noté"] : s >= 75 ? ["g1", "Excellent"] : s >= 50 ? ["g2", "Bon"] : s >= 25 ? ["o", "Médiocre"] : ["r", "Mauvais"];

/* jauge : 4 segments égaux, repère placé dans le bon segment */
function gauge(th, tones, v, u, max){
  const edges = [0, ...th, max], n = tones.length;
  let i = edges.findIndex((e, j) => j > 0 && v <= e) - 1; if(i < 0) i = n - 1;
  const lo = edges[i], hi = edges[i + 1], pos = Math.min(100, ((i + Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1)))) / n) * 100);
  return `<div class="yk-gauge"><div class="yk-gbar">${tones.map(t => `<i style="background:${TONE[t]}"></i>`).join("")}</div>
    <b class="yk-mark" style="left:${pos}%"></b>
    <div class="yk-gtk">${th.map((t, j) => `<span style="left:${(j + 1) / n * 100}%">${nf(t)}</span>`).join("")}</div>
    <p class="yk-gu">Valeurs pour 100 ${u}</p></div>`;
}
function healthRows(pr){
  const rows = [], u = pr.unit;
  if(Array.isArray(pr.add)){
    const list = pr.add.map(c => { const [nm, rk, cl] = addInfo(c); return { c, nm, cl, rk, t: ADD_RISK[rk] || ADD_RISK[""] }; });
    const worst = list.some(a => a.rk === "h") ? "r" : list.some(a => a.rk === "m") ? "o" : list.length ? "y" : "g1";
    rows.push({ ic: "add", name: "Additifs", sub: !list.length ? "Sans additif" : worst === "r" ? "Contient des additifs à risque" : worst === "o" ? "Additifs à risque modéré" : "Pas d'alerte EFSA sur ces additifs",
      val: String(list.length), tone: worst, bad: list.length > 0,
      more: list.length ? `<ul class="yk-adds">${list.map(a => `<li><i style="background:${TONE[a.t[0]]}"></i><span><b>${esc(a.c)}${a.nm ? " · " + esc(a.nm) : ""}</b><small>${a.cl ? esc(a.cl) + " · " : ""}${esc(a.t[1])}</small></span></li>`).join("")}</ul>` : "" });
  }
  [["kcal", pr.hasNutri ? pr.k : null, "kcal"], ["sug", pr.sug, "sug"], ["sat", pr.sat, "sat"], ["salt", pr.salt, "salt"]].forEach(([key, v, ic]) => {
    if(v == null) return;
    const S = SCALE[key], th = pr.drink ? S.d : S.s, i = v <= th[0] ? 0 : v <= th[1] ? 1 : v <= th[2] ? 2 : 3, tone = ["g1", "g2", "o", "r"][i];
    rows.push({ ic, name: S.name, sub: v === 0 ? S.zero : S.txt[i], val: nf(v) + S.u, tone, bad: i >= 2,
      more: gauge(th, ["g1", "g2", "o", "r"], v, u, th[2] * 1.6 || 1) });
  });
  [["prot", pr.hasNutri ? pr.p : null], ["fib", pr.fib], ["fvl", pr.fvl]].forEach(([key, v]) => {
    if(v == null) return;
    const S = POS[key], i = v >= S.th[1] ? 2 : v >= S.th[0] ? 1 : 0;
    if(i === 0) return;
    rows.push({ ic: key, name: S.name, sub: S.txt[i], val: nf(v) + S.u, tone: i === 2 ? "g1" : "g2", bad: false, more: gauge(S.th, ["n", "g2", "g1"], v, u, S.th[1] * 1.6) });
  });
  return rows;
}
function envRows(pr){
  const E = pr.env || {}, rows = [];
  if(E.agri != null){ const a = E.agri, i = a >= 80 ? 0 : a >= 60 ? 1 : a >= 40 ? 2 : a >= 20 ? 3 : 4;
    rows.push({ ic: "prod", name: "Production", sub: ["Très faible impact", "Faible impact", "Impact modéré", "Impact élevé", "Impact très élevé"][i], val: `${fmt(a)}/100`, tone: ["g1", "g2", "o", "r", "r"][i], bad: i >= 2,
      more: `<p class="yk-more-t">Impact de la production des ingrédients (analyse de cycle de vie Agribalyse de l'ADEME).</p>` }); }
  const labs = [...new Set([...(E.labels || []), ...(pr.labels || []).filter(l => ENV_LABELS[l])])].filter(l => ENV_LABELS[l]);
  labs.forEach(l => rows.push({ ic: "lab", name: ENV_LABELS[l], sub: ENV_LABEL_SUB[l] || "Label environnemental", check: true, tone: "g1", bad: false }));
  const pk = E.pack || {};
  if(pk.mats && pk.mats.length && pk.score != null){ const s = pk.score, i = s >= 70 ? 0 : s >= 50 ? 1 : s >= 30 ? 2 : 3;
    const mats = [...new Set(pk.mats.map(([sh, m]) => [SHAPE[tag(sh)] || "", MAT[tag(m)] || tag(m).replace(/-/g, " ")].filter(Boolean).join(" en ")))].filter(Boolean);
    rows.push({ ic: "pack", name: "Emballage", sub: ["Emballage à faible impact", "Impact modéré", "Emballage polluant", "Emballage très polluant"][i], val: `${fmt(s)}/100`, tone: ["g1", "g2", "o", "r"][i], bad: i >= 2,
      more: mats.length ? `<p class="yk-more-t">${esc(mats.join(" · "))}</p>` : "" });
  } else rows.push({ ic: "pack", name: "Emballage", sub: "Non renseigné", tone: "n", bad: false, grey: true });
  if(E.orig && E.orig.length){ const C = (window.PDM_OFFDATA || {}).ctry || {};
    const list = E.orig.map(([o, p]) => { const c = C[o] || [tag(o).replace(/-/g, " "), ""]; return { n: c[0], f: flag(c[1]), p }; });
    const sc = E.origScore, near = sc != null ? sc >= 60 : (E.origVal == null || E.origVal >= 0);
    rows.push({ ic: "orig", name: "Origine", sub: list.map(x => x.n).join(", "), val: list.slice(0, 3).map(x => x.f).join(" "), tone: near ? "g1" : "o", bad: !near,
      more: `<p class="yk-more-t">${list.map(x => `${x.f} ${esc(x.n)}${x.p && x.p < 100 ? ` (${fmt(x.p)} %)` : ""}`).join("<br>")}</p>` });
  } else rows.push({ ic: "orig", name: "Origine", sub: "Non renseignée", tone: "n", bad: false, grey: true });
  if(E.threat) rows.push({ ic: "threat", name: tag(E.threat) === "palm-oil" ? "Huile de palme" : "Espèces menacées", sub: "Contribue à la déforestation", tone: "r", bad: true });
  return rows;
}
const rowHtml = (r, i) => `<li class="yk-row${r.more ? " has-more" : ""}${r.grey ? " grey" : ""}" ${r.more ? `data-row="${i}" tabindex="0" role="button" aria-expanded="false"` : ""}>
  ${icon(r.ic)}<span class="yk-rt"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>
  <span class="yk-rv">${r.check ? `<em class="yk-check">✓</em>` : `${r.val ? `<span>${r.val}</span>` : ""}<i style="background:${TONE[r.tone]}"></i>`}${r.more ? `<svg class="yk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>` : ""}</span>
  ${r.more ? `<div class="yk-more">${r.more}</div>` : ""}</li>`;
function rowsBlock(rows, per){
  const bad = rows.filter(r => r.bad), good = rows.filter(r => !r.bad && !r.grey), grey = rows.filter(r => r.grey);
  let k = 0; const list = rs => `<ul class="yk-rows">${rs.map(r => rowHtml(r, k++)).join("")}</ul>`;
  return `${bad.length ? `<div class="yk-sec"><h4>Points négatifs</h4>${per ? `<small>${per}</small>` : ""}</div>${list(bad)}` : ""}
    ${good.length ? `<div class="yk-sec"><h4>Points positifs</h4>${per && !bad.length ? `<small>${per}</small>` : ""}</div>${list(good)}` : ""}
    ${grey.length ? `<div class="yk-sec"><h4>Non renseigné</h4></div>${list(grey)}` : ""}`;
}
function nutriTable(pr){
  const u = pr.unit, sv = pr.serving, L = [["Énergie", pr.k, " kcal"], ["Matières grasses", pr.l, " g"], ["dont saturées", pr.sat, " g", 1], ["Glucides", pr.c, " g"], ["dont sucres", pr.sug, " g", 1], ["Fibres", pr.fib, " g"], ["Protéines", pr.p, " g"], ["Sel", pr.salt, " g"]].filter(x => x[1] != null);
  return `<table class="yk-tab"><thead><tr><th></th><th>100 ${u}</th>${sv ? `<th>Portion (${fq(sv)} ${u})</th>` : ""}</tr></thead><tbody>
    ${L.map(([n, v, un, sub]) => `<tr${sub ? ' class="sub"' : ""}><td>${n}</td><td>${nf(v)}${un}</td>${sv ? `<td>${nf(v * sv / 100)}${un}</td>` : ""}</tr>`).join("")}</tbody></table>`;
}
function sheetHtml(pr){
  const [st, sl] = scoreTone(pr.score), eg = ENVG[(pr.env || {}).grade];
  const hRows = pr.hasNutri || Array.isArray(pr.add) ? healthRows(pr) : [];
  const eRows = pr.src === "off" ? envRows(pr) : [];
  const fav = D.customFoods.some(f => f.code === pr.code && f.fav);
  const alg = (pr.allergens || []).map(a => ALG[a] || tag(a)).filter(Boolean);
  return `<header class="yk-top">
      ${pr.img ? `<img class="yk-pic" src="${esc(pr.img)}" alt="" referrerpolicy="no-referrer">` : `<div class="yk-pic yk-nopic" aria-hidden="true"></div>`}
      <div class="yk-id"><h2>${esc(pr.name || pr.n)}</h2><p>${esc(pr.brand || (pr.src === "perso" ? "Aliment enregistré" : ""))}</p>
        <div class="yk-head-score" data-tabshow="h"><i style="background:${TONE[st]}"></i><span><b>${pr.score == null ? "?" : pr.score}<small>/100</small></b><em>${sl}</em></span></div>
        ${eg ? `<div class="yk-head-score env" data-tabshow="e" hidden><svg class="yk-leaf" viewBox="0 0 40 40" aria-hidden="true"><path fill="${eg[2]}" d="M36 4C18 4 6 12 6 26c0 3 .7 5.6 1.8 7.6L4 37.5l2 2 3.7-3.7C11.8 37 14.3 38 18 38 30 38 36 26 36 4z"/><text x="20" y="27" text-anchor="middle" font-size="${eg[0].length > 1 ? 12 : 15}" font-weight="900" fill="#fff">${eg[0]}</text></svg><span><b class="gs">Green-Score</b><em>${eg[1]}</em></span></div>` : ""}
      </div>
    </header>
    ${eRows.length ? `<div class="yk-tabs" role="tablist"><button role="tab" data-tab="h" aria-selected="true">Santé</button><button role="tab" data-tab="e" aria-selected="false">Environnement</button></div>` : ""}
    <div class="yk-pane" data-pane="h">
      ${hRows.length ? rowsBlock(hRows, `pour 100 ${pr.unit === "ml" ? "mL" : "g"}`) : `<p class="yk-empty">Pas de valeurs nutritionnelles pour ce produit dans Open Food Facts.</p>`}
      ${pr.hasNutri ? `<div class="yk-pdm"><b>${fmt(pr.k)} kcal</b> · ${dec(pr.p)} g prot. · ${dec(pr.c)} g gluc. · ${dec(pr.l)} g lip. <small>pour 100 ${pr.unit}${pr.serving ? ` · portion ${fq(pr.serving)} ${pr.unit} = ${fmt(pr.k * pr.serving / 100)} kcal` : ""}</small></div>` : ""}
      ${pr.src === "off" ? `<div class="yk-sec"><h4>Plus d'informations</h4></div>
      <div class="yk-info">
        <div class="yk-ns" aria-label="Nutri-Score ${pr.grade ? pr.grade.toUpperCase() : "inconnu"}">${"abcde".split("").map(g => `<span class="ns-${g}${g === pr.grade ? " on" : ""}">${g.toUpperCase()}</span>`).join("")}<small>Nutri-Score</small></div>
        ${pr.nova ? `<div class="yk-nova n${pr.nova}"><b>${pr.nova}</b><span>NOVA · ${["", "Aliment non transformé", "Ingrédient culinaire", "Aliment transformé", "Ultra-transformé"][pr.nova]}</span></div>` : ""}
      </div>
      ${pr.hasNutri ? `<details class="yk-det"><summary>Valeurs nutritionnelles</summary>${nutriTable(pr)}</details>` : ""}
      ${pr.ingr ? `<details class="yk-det"><summary>Ingrédients</summary><p>${esc(pr.ingr)}</p></details>` : ""}
      ${alg.length ? `<details class="yk-det"><summary>Allergènes</summary><p>${esc(alg.join(", "))}</p></details>` : ""}` : ""}
    </div>
    ${eRows.length ? `<div class="yk-pane" data-pane="e" hidden>${rowsBlock(eRows, "")}${!eg ? `<p class="yk-empty">Green-Score non calculé pour ce produit.</p>` : ""}</div>` : ""}
    ${pr.src === "off" && pr.cats && pr.cats.length ? `<div class="yk-sec"><h4>Recommandations</h4></div><div class="yk-recos" aria-live="polite"><p class="yk-empty">Recherche de meilleures alternatives…</p></div>` : ""}
    <div class="yk-sec"><h4>Options</h4></div>
    <div class="yk-opts">
      <button type="button" data-opt="fav" aria-pressed="${fav}"><span>${fav ? "Retirer des favoris" : "Ajouter aux favoris"}</span><b>${fav ? "★" : "☆"}</b></button>
      <details><summary><span>Méthode de calcul</span><b>?</b></summary><p>Note PDM sur 100, inspirée de la méthode publiée par Yuka : 60 % qualité nutritionnelle (Nutri-Score), 30 % additifs (alertes de surexposition de l'EFSA), 10 % bio. Un additif à risque élevé plafonne la note à 49. Ce n'est pas la note officielle de Yuka : elle peut différer de quelques points. Couleurs des nutriments : seuils du Nutri-Score pour 100 g (ou 100 ml pour les boissons). Données : Open Food Facts.</p></details>
      ${pr.src === "off" ? `<a href="https://fr.openfoodfacts.org/produit/${esc(pr.code)}" target="_blank" rel="noopener"><span>Voir ou corriger sur Open Food Facts</span><b>↗</b></a>` : ""}
      <button type="button" data-opt="again"><span>Scanner un autre produit</span><b>›</b></button>
    </div>`;
}
function dockHtml(pr){
  if(!pr.hasNutri) return `<button class="btn" type="button" data-act="scan-free">Le saisir à la main</button>`;
  const s = state.scan, u = pr.unit, g = s.g || 0, q = forQty(pr, g), chips = [];
  if(pr.serving) chips.push([rq(pr.serving), `1 portion · ${fq(pr.serving)} ${u}`]);
  chips.push([100, `100 ${u}`]);
  if(pr.pq && pr.pq !== 100) chips.push([rq(pr.pq), `${pr.drink ? "Bouteille entière" : "Paquet entier"} · ${fq(pr.pq)} ${u}`]);
  return `<form id="prod" class="yk-add" autocomplete="off">
    <div class="yk-add-body">
      <div class="yk-chips">${chips.map(([v, l]) => `<button type="button" data-q="${v}" aria-pressed="${v === rq(g)}">${l}</button>`).join("")}</div>
      <div class="yk-qty">
        ${pr.serving ? `<label class="f">Portions<input name="por" inputmode="decimal" value="${fq(g / pr.serving)}"></label><span class="yk-eq" aria-hidden="true">=</span>` : ""}
        <label class="f">Quantité (${u})<input name="g" inputmode="decimal" value="${fq(g)}"></label>
      </div>
      <div class="seg yk-meal" role="group" aria-label="Repas">${MEALS.map(([k, l]) => `<button type="button" data-pm="${k}" aria-pressed="${k === state.meal}">${l}</button>`).join("")}</div>
      <p class="yk-sum" aria-live="polite">${sumTxt(q)}</p>
    </div>
    <button class="btn green big" type="submit" data-eat>J'en ai mangé</button>
  </form>`;
}
const sumTxt = q => `${fmt(q.kcal)} kcal · P ${dec(q.p)} g · G ${dec(q.c)} g · L ${dec(q.l)} g`;

let sheet = null;
function closeSheet(){ if(!sheet) return; const el = sheet; sheet = null; el.classList.remove("on"); document.documentElement.classList.remove("yk-lock"); setTimeout(() => el.remove(), 260); renderAdd(); }
function rerenderSheet(){ if(!sheet) return; const sc = sheet.querySelector(".yk-scroll"), top = sc.scrollTop; sc.innerHTML = sheetHtml(state.scan.product); sc.scrollTop = top; bindSheet(); loadRecos(); }
function openSheet(){
  if(sheet){ sheet.remove(); sheet = null; }
  const pr = state.scan.product;
  const el = document.createElement("div"); el.className = "yk-ov";
  el.innerHTML = `<div class="yk-back" data-close></div>
    <section class="yk-sheet" role="dialog" aria-modal="true" aria-label="${esc(pr.name || pr.n)}">
      <div class="yk-grab" aria-hidden="true"><i></i></div>
      <button class="yk-x" type="button" data-close aria-label="Fermer">×</button>
      <div class="yk-scroll">${sheetHtml(pr)}</div>
      <div class="yk-dock">${dockHtml(pr)}</div>
    </section>`;
  document.body.appendChild(el); sheet = el;
  document.documentElement.classList.add("yk-lock");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  el.addEventListener("click", e => { if(e.target.closest("[data-close]")) closeSheet(); });
  el.addEventListener("keydown", e => { if(e.key === "Escape") closeSheet(); });
  swipe(el); bindSheet(); bindDock(); loadRecos();
}
function swipe(el){ /* glisser vers le bas pour fermer, comme Yuka */
  const sh = el.querySelector(".yk-sheet"), sc = el.querySelector(".yk-scroll");
  let y0 = null, dy = 0;
  sh.addEventListener("touchstart", e => { if(e.target.closest(".yk-dock")) return; if(sc.scrollTop <= 0 || e.target.closest(".yk-grab")){ y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sh.addEventListener("touchmove", e => { if(y0 == null) return; dy = e.touches[0].clientY - y0; if(dy > 0){ sh.style.transition = "none"; sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sh.addEventListener("touchend", () => { if(y0 == null) return; sh.style.transition = ""; sh.style.transform = ""; if(dy > 110) closeSheet(); y0 = null; });
}
function bindSheet(){
  const el = sheet; if(!el) return;
  $$("[data-tab]", el).forEach(b => b.onclick = () => {
    const t = b.dataset.tab;
    $$("[data-tab]", el).forEach(x => x.setAttribute("aria-selected", x === b));
    $$("[data-pane]", el).forEach(p => p.hidden = p.dataset.pane !== t);
    $$("[data-tabshow]", el).forEach(p => p.hidden = p.dataset.tabshow !== t);
  });
  $$("[data-row]", el).forEach(r => {
    const tog = () => { const o = !r.classList.contains("open"); r.classList.toggle("open", o); r.setAttribute("aria-expanded", o); };
    r.onclick = e => { if(!e.target.closest(".yk-more")) tog(); };
    r.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); tog(); } };
  });
  const fav = $("[data-opt=fav]", el);
  if(fav) fav.onclick = () => {
    const pr = state.scan.product; let f = D.customFoods.find(x => x.code === pr.code);
    if(!f){ f = { n: pr.n, k: pr.k, p: pr.p, c: pr.c, l: pr.l, code: pr.code }; D.customFoods.unshift(f); }
    f.fav = !f.fav; P.save(f.fav ? "Ajouté aux favoris" : "Retiré des favoris");
    fav.setAttribute("aria-pressed", f.fav); fav.innerHTML = `<span>${f.fav ? "Retirer des favoris" : "Ajouter aux favoris"}</span><b>${f.fav ? "★" : "☆"}</b>`; renderFoods();
  };
  const ag = $("[data-opt=again]", el); if(ag) ag.onclick = () => { closeSheet(); state.scan = null; renderAdd(); startCamera(); };
}
function bindDock(){
  const el = sheet, prod = $("#prod", el), pr = state.scan.product;
  const sf = $("[data-act=scan-free]", el); if(sf) sf.onclick = () => { state.free = { n: pr.n || "" }; closeSheet(); state.scan = null; state.mode = "free"; render(); };
  if(!prod) return;
  const body = $(".yk-add-body", prod);
  const upd = from => {
    const s = state.scan; s.touched = true;
    if(from === "por"){ const v = num(prod.por.value); if(v == null || v < 0) return; s.g = rq(v * pr.serving); prod.g.value = fq(s.g); }
    else { const v = num(prod.g.value); s.g = v != null && v >= 0 ? v : 0; if(prod.por) prod.por.value = fq(s.g / pr.serving); }
    const q = forQty(pr, s.g);
    $(".yk-sum", prod).textContent = sumTxt(q);
    if(prod.classList.contains("open")) $("[data-eat]", prod).textContent = `Ajouter ${fmt(q.kcal)} kcal`;
    $$("[data-q]", prod).forEach(c => c.setAttribute("aria-pressed", +c.dataset.q === rq(s.g)));
  };
  prod.g.oninput = () => upd("g");
  if(prod.por) prod.por.oninput = () => upd("por");
  $$("[data-q]", prod).forEach(c => c.onclick = () => { prod.g.value = fq(+c.dataset.q); upd("g"); });
  $$("[data-pm]", prod).forEach(b => b.onclick = () => {
    state.meal = b.dataset.pm;
    $$("[data-pm]", prod).forEach(x => x.setAttribute("aria-pressed", x === b));
    $$("[data-meal]", root).forEach(x => x.setAttribute("aria-pressed", x.dataset.meal === state.meal));
  });
  prod.onsubmit = e => {
    e.preventDefault();
    if(!prod.classList.contains("open")){ /* 1er appui : ouvre le choix de quantité */
      prod.classList.add("open"); state.scan.touched = true; upd("keep");
      $("[data-eat]", prod).textContent = `Ajouter ${fmt(forQty(pr, state.scan.g).kcal)} kcal`; return;
    }
    const g = state.scan.g;
    if(!g || g <= 0){ toast("Indique la quantité"); prod.g.focus(); return; }
    if(pr.src !== "perso") saveFood({ n: pr.n, k: pr.k, p: pr.p, c: pr.c, l: pr.l, code: pr.code, serving: g });
    else { const f = D.customFoods.find(x => x.code === pr.code); if(f) f.serving = g; }
    addItems([item(pr, g, "off")]); state.scan = null; closeSheet();
  };
}
/* alternatives mieux notées dans la même catégorie (recherche Open Food Facts, mise en cache 7 jours) */
const RECO_CACHE = "pdm-off-reco";
async function loadRecos(){
  const el = sheet && $(".yk-recos", sheet); if(!el) return;
  const pr = state.scan.product, cats = (pr.cats || []).filter(c => c.startsWith("en:")).slice(-2).reverse();
  const show = list => { if(!sheet || state.scan.product.code !== pr.code) return;
    const min = Math.max((pr.score ?? 0) + 10, 50);
    const better = list.filter(x => x.code !== pr.code && x.score != null && x.score >= min).sort((a, b) => b.score - a.score).slice(0, 8);
    el.innerHTML = better.length ? `<div class="yk-reco-row">${better.map(x => { const [t, l] = scoreTone(x.score); return `<button type="button" class="yk-reco" data-code="${esc(x.code)}">
      ${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="yk-nopic"></span>`}
      <b>${esc(x.name)}</b><small>${esc(x.brand)}</small><span class="yk-rs"><i style="background:${TONE[t]}"></i>${x.score}/100 <em>${l}</em></span></button>`; }).join("")}</div>`
      : `<p class="yk-empty">${pr.score != null && pr.score >= 75 ? "Ce produit fait déjà partie des meilleurs de sa catégorie." : "Pas de meilleure alternative trouvée dans sa catégorie."}</p>`;
    $$(".yk-reco", el).forEach(b => b.onclick = () => lookup(b.dataset.code));
  };
  const cache = lsJSON(RECO_CACHE, {});
  let all = [];
  for(const cat of cats){
    const hit = cache[cat];
    let list = hit && Date.now() - hit.at < 7 * 864e5 ? hit.list : null;
    if(!list){
      try{
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/search?categories_tags=${encodeURIComponent(cat)}&countries_tags=en:france&sort_by=popularity_key&page_size=40&fields=code,product_name,product_name_fr,brands,image_front_small_url,nutriscore_grade,nutriscore_score,nutriscore_data,additives_tags,labels_tags,categories_tags,product_quantity_unit,quantity&lc=fr`, { signal: ctl.signal });
        clearTimeout(to);
        const j = await r.json();
        list = (j.products || []).filter(p => p.code && (p.product_name_fr || p.product_name)).map(p => { const o = offProduct(p.code, p); return { code: o.code, name: o.name, brand: o.brand, img: o.thumb, score: o.score }; });
        try{ cache[cat] = { at: Date.now(), list }; const ks = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at); ks.slice(30).forEach(k => delete cache[k]); localStorage.setItem(RECO_CACHE, JSON.stringify(cache)); }catch(e){}
      }catch(e){ list = []; }
    }
    all = all.concat(list.filter(x => !all.some(y => y.code === x.code)));
    if(all.filter(x => x.score != null && x.score >= Math.max((pr.score ?? 0) + 10, 50) && x.code !== pr.code).length >= 4) break;
  }
  show(all);
}

function miniCard(pr){
  const [t, l] = scoreTone(pr.score);
  return `<div class="cal-mini">
    ${pr.thumb || pr.img ? `<img src="${esc(pr.thumb || pr.img)}" alt="" referrerpolicy="no-referrer">` : `<span class="yk-nopic"></span>`}
    <div><b>${esc(pr.name || pr.n)}</b><small><i style="background:${TONE[t]}"></i>${pr.score == null ? "Non noté" : pr.score + "/100 · " + l}</small></div>
    <button class="btn sm" type="button" data-act="sheet-open">Voir la fiche</button>
  </div>
  <button class="btn ghost sm" type="button" data-act="scan-again" style="margin-top:10px">Scanner un autre produit</button>`;
}

/* compteur Gemini du jour (offre gratuite : ≈ 20 requêtes par modèle Flash, 500 en Flash-Lite) */
function gemLine(){
  if(!P.gemStatus) return "";
  const st = P.gemStatus(), day = st.blocked.filter(b => /jour/.test(b.why)), min = st.blocked.filter(b => /minute/.test(b.why));
  if(!st.total && !st.blocked.length) return "";
  return `<p class="muted cal-gem">Gemini aujourd'hui : ${st.total} requête${st.total > 1 ? "s" : ""}${day.length ? ` · quota du jour atteint sur ${day.map(b => b.name).join(", ")} (retour à ${st.reset})` : ""}${min.length ? ` · en pause 1 min : ${min.map(b => b.name).join(", ")}` : ""}</p>`;
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
      ${ph.model ? `<p class="muted cal-gem" style="margin:0">Analysé par ${esc(P.gemShort ? P.gemShort(ph.model) : ph.model)}</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn green" data-act="ph-add">Ajouter ${fmt(tot.kcal)} kcal</button>
        <button class="btn ghost sm" data-act="ph-cancel">Annuler</button>
      </div>` : askQ ? "" : `<p class="muted">Aucun aliment reconnu sur cette photo.${ph.comment ? " Gemini dit : " + esc(ph.comment) : ""} <span class="muted">(modèle : ${esc(ph.model || "?")})</span></p><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>`) : ""}
  </div>`;
}

function histRow(h, i){
  const g = h.g, q = forQty(h, g);
  return `<div class="cal-hist"><button type="button" class="cal-opt" data-pick="${i}"><span>${esc(h.n)}</span><small>${h.cnt > 1 ? `Déjà mangé ${h.cnt} fois` : "Déjà mangé"} · ${h.days === 0 ? "aujourd'hui" : h.days === 1 ? "hier" : `il y a ${h.days} j`} · ${fmt(h.k)} kcal/100 ${h.u === "ml" ? "ml" : "g"}</small></button>
    <button type="button" class="cal-plus" data-quick="${i}" aria-label="Ajouter ${esc(portionTxt(h, g))} de ${esc(h.n)}"><b>+ ${esc(portionTxt(h, g).split(" · ")[0])}</b><small>${fmt(q.kcal)} kcal</small></button></div>`;
}
function suggestions(){
  const q = norm(state.q);
  if(state.busy === "food") return `<p class="muted cal-hint">Gemini estime « ${esc(state.q)} »…</p>`;
  if(state.pick){
    const p = state.pick, u = p.u === "ml" ? "ml" : "g";
    const por = p.sv ? `<div class="chips cal-por">${[1, 2, 3].map(k => `<button type="button" class="chip" data-gq="${rq(p.sv * k)}">${k} ${esc(plural(p.svn || "portion", k))} · ${fq(p.sv * k)} ${u}</button>`).join("")}</div>` : "";
    return `<p class="muted cal-hint">Sélectionné : <b>${esc(p.n)}</b> · ${fmt(p.k)} kcal, ${dec(p.p)} g prot. pour 100 ${u}${p.src === "gemini" && !p.hist ? " (estimation Gemini)" : ""}.${p.hist ? ` Dernière fois : ${esc(portionTxt(p, p.g))}.` : ""} Indique les ${u === "ml" ? "ml" : "grammes"} puis Ajouter.</p>${por}`;
  }
  const H = history();
  if(q.length < 2){
    const top = H.slice(0, 12); state.list = top;
    return top.length ? `<h4 class="cal-sub">Tes habituels${state.meal ? " · " + MEALS.find(m => m[0] === state.meal)[1].toLowerCase() + " en tête" : ""}</h4>${top.map(histRow).join("")}
      <p class="muted cal-hint">« + » ajoute la même quantité que la dernière fois. Touche le nom pour changer la quantité.</p>`
      : `<p class="muted cal-hint">Tape au moins 2 lettres : ${(window.PDM_FOODS || []).length} aliments de base + tes aliments enregistrés. Ce que tu ajoutes apparaîtra ici en premier la prochaine fois.</p>`;
  }
  const ok = matcher(state.q);
  const hh = H.filter(h => ok(h.n)).slice(0, 15);
  const seen = new Set(hh.map(h => norm(h.n)));
  const rest = allFoods().filter(f => !seen.has(norm(f.n)) && ok(f.n)).slice(0, 10);
  state.list = [...hh, ...rest];
  return `${hh.length ? `<h4 class="cal-sub">Déjà mangé</h4>${hh.map(histRow).join("")}${rest.length ? `<h4 class="cal-sub">Autres aliments</h4>` : ""}` : ""}
    ${rest.map((f, j) => `<button type="button" class="cal-opt" data-pick="${hh.length + j}"><span>${esc(f.n)}</span><small>${fmt(f.k)} kcal · ${dec(f.p)} g prot. /100 g${f.src === "perso" ? " · perso" : ""}</small></button>`).join("")}
    <button type="button" class="cal-opt ai" data-act="ask"><span>${hh.length || rest.length ? "Pas le bon ? " : "Introuvable : "}estimer « ${esc(state.q.trim())} » avec Gemini</span><small>valeurs pour 100 g, enregistrées pour la prochaine fois</small></button>`;
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
const item = (food, g, src) => { const it = { id: uid("m"), n: food.n, g, k: r1(food.k), p: r1(food.p), c: r1(food.c), l: r1(food.l), m: state.meal, src };
  const si = food.sv ? { sv: food.sv, svn: food.svn } : servInfo(food.serving, food.servingTxt);
  if(food.code) it.code = food.code; if(si){ it.sv = si.sv; it.svn = si.svn; }
  if(food.unit === "ml" || food.u === "ml") it.u = "ml"; if(food.por) it.por = true;
  return it; };
/* « 1 tranche (42 g) » → { sv: 42, svn: "tranche" } ; « 2 biscuits (25 g) » → 12,5 g le biscuit */
function servInfo(sv, txt){
  if(!(sv > 0)) return null;
  const m = String(txt || "").toLowerCase().match(/^\s*(\d+(?:[.,]\d+)?)?\s*([a-zàâçéèêëîïôûùüÿœ]{3,})/);
  let name = "portion", cnt = 1;
  if(m && !/^(gr|grammes?|ml|cl|litres?|kg|portions?|serving|environ|une?)$/.test(m[2])){ name = m[2]; cnt = m[1] ? parseFloat(m[1].replace(",", ".")) || 1 : 1; }
  if(cnt > 1 && /s$/.test(name)) name = name.slice(0, -1);
  return { sv: rq(sv / cnt), svn: name };
}
const plural = (w, n) => n > 1 && !/[sx]$/.test(w) ? w.replace(/^(\S+)/, "$1s") : w;
/* « 1 tranche · 44 g » si la quantité tombe sur un nombre de portions, sinon « 44 g » */
function portionTxt(f, g){
  const u = f.u === "ml" || f.unit === "ml" ? "ml" : "g";
  if(f.por) return "1 portion";
  if(f.sv){ const n = g / f.sv, k = Math.round(n); if(k >= 1 && Math.abs(n - k) < 0.06) return `${k} ${plural(f.svn || "portion", k)} · ${fq(g)} ${u}`; }
  return `${fq(g)} ${u}`;
}

/* ---------- historique : tout ce que tu as déjà ajouté (scan, recherche, photo, saisie), le plus fréquent d'abord ---------- */
function history(){
  const map = new Map(), dates = Object.keys(D.meals).sort().reverse();
  for(const d of dates) for(const it of D.meals[d] || []){
    if(!it || !it.n || !(it.g > 0)) continue;
    const key = norm(it.n);
    let h = map.get(key);
    if(!h){ h = { n: it.n, k: it.k, p: it.p, c: it.c, l: it.l, g: it.g, por: !!it.por, code: it.code, sv: it.sv, svn: it.svn, u: it.u, src: it.src, last: d, cnt: 0, meals: {}, hist: true }; map.set(key, h); }
    h.cnt++; const m = it.m || "dej"; h.meals[m] = (h.meals[m] || 0) + 1;
  }
  const today = new Date(todayISO() + "T12:00");
  for(const h of map.values()){
    if(!h.sv){ /* anciens ajouts : on retrouve la portion via l'aliment enregistré et la fiche Open Food Facts en cache */
      const f = D.customFoods.find(x => norm(x.n) === norm(h.n)); const code = h.code || (f && f.code);
      const pr = code && offGet(code); const si = pr && servInfo(pr.serving, pr.servingTxt);
      if(code) h.code = code; if(si){ h.sv = si.sv; h.svn = si.svn; } if(pr && pr.drink) h.u = "ml";
    }
    h.days = Math.round((today - new Date(h.last + "T12:00")) / 864e5);
    h.score = h.cnt + 2 * (h.meals[state.meal] || 0) - h.days * 0.08;
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}
/* tolère une faute de frappe d'une lettre sur les mots de 4 lettres ou plus (« harris » trouve « Harrys ») */
function near(a, b){
  if(Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while(i < a.length && j < b.length){ if(a[i] === b[j]){ i++; j++; continue; } if(++e > 1) return false;
    if(a.length > b.length) i++; else if(b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
}
function matcher(q){
  const words = norm(q).split(/[\s,.'’·-]+/).filter(Boolean);
  return name => { const n = norm(name), toks = n.split(/[\s,.'’·()-]+/).filter(Boolean);
    return words.every(w => n.includes(w) || (w.length >= 4 && toks.some(t => near(w, t) || (t.length > w.length && near(w, t.slice(0, w.length)))))); };
}

function bindStatic(){
  $("#cal-day").onchange = e => { if(e.target.value){ state.date = e.target.value; state.edit = null; refreshData(); } };
  $$("[data-meal]", root).forEach(b => b.onclick = () => { state.meal = b.dataset.meal; $$("[data-meal]", root).forEach(x => x.setAttribute("aria-pressed", x === b));
    const sg = $("#sugg"); if(sg && !state.pick) sg.innerHTML = suggestions(); });
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
  const sf = $("[data-act=scan-free]", el); if(sf) sf.onclick = () => { state.free = { n: "" }; state.scan = null; state.mode = "free"; render(); };
  const again = $("[data-act=scan-again]", el); if(again) again.onclick = () => { state.scan = null; renderAdd(); startCamera(); };
  const so = $("[data-act=sheet-open]", el); if(so) so.onclick = () => openSheet();
  $$("[data-fav]", el).forEach(b => b.onclick = () => lookup(b.dataset.fav));

  /* recherche */
  const f = $("#food");
  if(f){
    f.q.oninput = () => { state.q = f.q.value; state.pick = null; $("#sugg").innerHTML = suggestions(); };
    f.g.oninput = () => { state.g = f.g.value; };
    $("#sugg").onclick = e => {
      const qk = e.target.closest("[data-quick]");
      if(qk){ const h = state.list[+qk.dataset.quick]; if(!h) return;
        addItems([item(h, h.g, h.src || "base")]); state.q = f.q.value = ""; state.pick = null; $("#sugg").innerHTML = suggestions(); return; }
      const gq = e.target.closest("[data-gq]");
      if(gq){ state.g = f.g.value = fq(+gq.dataset.gq); return; }
      const o = e.target.closest("[data-pick]");
      if(o){ state.pick = state.list[+o.dataset.pick]; if(!state.pick) return; state.q = f.q.value = state.pick.n;
        if(state.pick.hist){ state.g = f.g.value = fq(state.pick.g); }
        $("#sugg").innerHTML = suggestions(); f.g.focus(); return; }
      if(e.target.closest("[data-act=ask]")) ask();
    };
    f.onsubmit = e => {
      e.preventDefault();
      const g = num(f.g.value);
      const food = state.pick || allFoods().find(x => norm(x.n) === norm(f.q.value));
      if(!food){ toast(f.q.value.trim() ? "Choisis un aliment dans la liste ou demande à Gemini" : "Tape un aliment"); return; }
      if(!g || g <= 0){ f.g.focus(); toast("Indique les grammes"); return; }
      addItems([item(food, g, food.hist ? food.src || "base" : food.src === "gemini" ? "gemini" : "base")]);
      state.q = ""; state.g = ""; state.pick = null; renderAdd();
    };
  }
  async function ask(){
    const q = state.q.trim(); if(!q) return;
    state.busy = "food"; $("#sugg").innerHTML = suggestions();
    try{
      const r = await P.gemini({ parts: [{ text: PROMPT_FOOD(q) }], schema: SCHEMA_FOOD, lite: true });
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
