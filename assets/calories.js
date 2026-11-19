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
const PROMPT_PHOTO = "Analyse cette photo de repas. Identifie chaque aliment visible, estime sa quantité en grammes (portion réellement présente dans l'assiette) et ses valeurs nutritionnelles pour cette quantité, en t'appuyant sur des valeurs de référence (table Ciqual). Pense aux matières grasses de cuisson et aux sauces visibles. Si ce n'est pas de la nourriture, renvoie une liste vide. Noms en français, courts.";
const PROMPT_FOOD = a => `Donne les valeurs nutritionnelles moyennes POUR 100 GRAMMES de cet aliment tel qu'on le mange : « ${a} ». Appuie-toi sur la table Ciqual quand c'est possible. Nom court en français.`;
const NUM = { type: "NUMBER" }, STR = { type: "STRING" };
const SCHEMA_PHOTO = { type: "OBJECT", properties: {
  aliments: { type: "ARRAY", items: { type: "OBJECT", properties: { nom: STR, grammes: NUM, kcal: NUM, proteines: NUM, glucides: NUM, lipides: NUM },
    required: ["nom","grammes","kcal","proteines","glucides","lipides"] } },
  commentaire: STR }, required: ["aliments","commentaire"] };
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

/* ---------- code-barres ---------- */
let zx = null, reader = null;
function loadZXing(){
  if(window.ZXing) return Promise.resolve();
  if(zx) return zx;
  return zx = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "assets/zxing.min.js"; s.onload = ok; s.onerror = () => ko(new Error("Lecteur de code-barres non chargé.")); document.head.appendChild(s); });
}
function newReader(){
  const Z = window.ZXing, hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  return new Z.BrowserMultiFormatReader(hints, 300);
}
async function startCamera(){
  const ov = document.createElement("div"); ov.className = "scan-ov";
  ov.innerHTML = `<div class="scan-box"><video playsinline muted></video><i class="scan-line"></i></div>
    <p>Vise le code-barres, à 10-15 cm.</p><button class="btn ghost" type="button">Fermer</button>`;
  document.body.appendChild(ov);
  const close = () => { try { reader && reader.reset(); } catch(e){} ov.remove(); };
  ov.querySelector("button").onclick = close;
  try{
    await loadZXing(); reader = newReader();
    await reader.decodeFromConstraints({ video: { facingMode: "environment", width: { ideal: 1280 } } }, ov.querySelector("video"), (res) => {
      if(res){ if(navigator.vibrate) navigator.vibrate(60); close(); lookup(res.getText()); }
    });
  }catch(err){
    close();
    toast(/Permission|NotAllowed/i.test(err.name + err.message) ? "Accès caméra refusé : autorise-le dans les réglages du navigateur" : "Caméra indisponible : prends le code en photo ou tape-le");
  }
}
async function decodePhoto(file){
  try{
    await loadZXing();
    const img = await shrink(file, 1600);
    const res = await newReader().decodeFromImageUrl(img.url);
    lookup(res.getText());
  }catch(err){ toast("Code-barres non lu sur la photo. Rapproche-toi ou tape les chiffres."); }
}
async function lookup(code){
  code = String(code).replace(/\D/g, "");
  if(code.length < 8){ toast("Code trop court"); return; }
  const known = D.customFoods.find(f => f.code === code);
  state.scan = { code, busy: true }; renderAdd();
  if(known){ state.scan = { code, product: { ...known, src: "perso" } }; state.g = String(known.serving || 100); renderAdd(); return; }
  try{
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_fr,generic_name_fr,brands,nutriments,serving_quantity,quantity,image_front_small_url`);
    const j = r.ok ? await r.json() : null;
    const pr = j && j.status === 1 ? j.product : null;
    if(!pr){ state.scan = { code, err: "Produit absent d'Open Food Facts." }; renderAdd(); return; }
    const n = pr.nutriments || {};
    let k = n["energy-kcal_100g"]; if(k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
    const name = [pr.product_name_fr || pr.product_name || pr.generic_name_fr || "Produit " + code, pr.brands ? pr.brands.split(",")[0].trim() : ""].filter(Boolean).join(" · ");
    if(k == null){ state.scan = { code, err: `« ${name} » trouvé, mais sans valeurs nutritionnelles.`, name }; renderAdd(); return; }
    const product = { n: name, k: r1(k), p: r1(n.proteins_100g || 0), c: r1(n.carbohydrates_100g || 0), l: r1(n.fat_100g || 0), code, img: pr.image_front_small_url || "", serving: +pr.serving_quantity || null, qty: pr.quantity || "", src: "off" };
    state.scan = { code, product }; state.g = String(product.serving || 100);
  }catch(err){ state.scan = { code, err: "Open Food Facts injoignable. Vérifie ta connexion." }; }
  renderAdd();
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
    h = `<div class="cal-2btn">
        <button class="btn" type="button" data-act="cam">Scanner</button>
        <label class="btn ghost">Photo du code<input type="file" id="bc-photo" accept="image/*" hidden></label>
      </div>
      <form id="bc" class="form-row" style="margin-top:12px" autocomplete="off">
        <label class="f" data-wide>Ou tape les chiffres<input name="code" inputmode="numeric" placeholder="3017620422003" value="${esc(s && !s.product ? s.code : "")}"></label>
        <button class="btn ghost" type="submit">Chercher</button>
      </form>
      ${!s ? `<p class="muted cal-hint">Produits du commerce (yaourt, boisson, céréales…) via Open Food Facts, la base utilisée par Yuka. Gratuit, sans clé.</p>` :
        s.busy ? `<p class="muted cal-hint">Recherche du produit ${esc(s.code)}…</p>` :
        s.err ? `<div class="alert" style="margin-top:12px">${esc(s.err)}</div><button class="btn ghost sm" style="margin-top:10px" data-act="scan-free">Le saisir à la main</button>` :
        productCard(s.product)}`;
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

function productCard(pr){
  const g = num(state.g) || 0, q = forQty(pr, g);
  return `<div class="cal-prod">
    ${pr.img ? `<img src="${esc(pr.img)}" alt="" loading="lazy">` : ""}
    <div><b>${esc(pr.n)}</b><small class="muted">${fmt(pr.k)} kcal · P ${dec(pr.p)} · G ${dec(pr.c)} · L ${dec(pr.l)} pour 100 g${pr.qty ? " · paquet " + esc(pr.qty) : ""}</small></div>
  </div>
  <form id="prod" class="form-row" style="margin-top:12px">
    <label class="f" style="max-width:140px">Grammes / ml<input name="g" inputmode="decimal" value="${esc(state.g)}"></label>
    <button class="btn" type="submit">Ajouter ${fmt(q.kcal)} kcal</button>
  </form>`;
}

function photoBlock(){
  const ph = state.photo, items = ph.items || [];
  const tot = sum(items.filter(it => it.on));
  return `<div class="cal-photo">
    <img src="${ph.url}" alt="Ton plat">
    ${state.busy === "photo" ? `<p class="muted cal-hint">Gemini analyse ton plat…</p>` : ""}
    ${ph.err ? `<div class="alert">${esc(ph.err)}</div><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>` : ""}
    ${ph.items ? (items.length ? `
      <ul class="cal-items">${items.map((it,i) => `<li class="ph${it.on ? "" : " off"}">
        <label class="cal-chk"><input type="checkbox" data-ph-on="${i}"${it.on ? " checked" : ""}><span>${esc(it.n)}</span></label>
        <input class="cal-g" data-ph-g="${i}" inputmode="decimal" value="${r0(it.g)}" aria-label="Grammes de ${esc(it.n)}"><span class="muted">g</span>
        <b>${fmt(forQty(it).kcal)}</b></li>`).join("")}</ul>
      ${ph.comment ? `<p class="details" style="margin:4px 0">${esc(ph.comment)}</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn green" data-act="ph-add">Ajouter ${fmt(tot.kcal)} kcal</button>
        <button class="btn ghost sm" data-act="ph-cancel">Annuler</button>
      </div>` : `<p class="muted">Aucun aliment reconnu sur cette photo.</p><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>`) : ""}
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

function bindAdd(){
  const el = $("#add");
  $$("[data-photo]", el).forEach(inp => inp.onchange = async e => {
    const file = e.target.files[0]; if(!file) return;
    let img; try { img = await shrink(file); } catch(err){ toast(err.message); return; }
    state.photo = { url: img.url, items: null }; state.busy = "photo"; renderAdd();
    try{
      const res = await P.gemini({ parts: [{ text: PROMPT_PHOTO }, { inline_data: { mime_type: "image/jpeg", data: img.b64 } }], schema: SCHEMA_PHOTO });
      state.photo.items = (res.aliments || []).filter(a => a.grammes > 0).map(a => ({ n: a.nom, g: a.grammes, on: true,
        k: a.kcal / a.grammes * 100, p: a.proteines / a.grammes * 100, c: a.glucides / a.grammes * 100, l: a.lipides / a.grammes * 100 }));
      state.photo.comment = res.commentaire || "";
    }catch(err){ state.photo.err = err.message; }
    state.busy = false; renderAdd();
  });
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
  const sf = $("[data-act=scan-free]", el); if(sf) sf.onclick = () => { state.free = { n: state.scan.name || "" }; state.mode = "free"; render(); };
  const prod = $("#prod");
  if(prod){
    prod.g.oninput = () => { state.g = prod.g.value; const q = forQty(state.scan.product, num(prod.g.value) || 0); prod.querySelector("button").textContent = `Ajouter ${fmt(q.kcal)} kcal`; };
    prod.onsubmit = e => {
      e.preventDefault(); const g = num(prod.g.value); if(!g || g <= 0){ toast("Indique les grammes"); return; }
      const pr = state.scan.product;
      saveFood({ n: pr.n, k: pr.k, p: pr.p, c: pr.c, l: pr.l, code: pr.code, serving: g });
      addItems([item(pr, g, "off")]); state.scan = null; state.g = ""; renderAdd();
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
