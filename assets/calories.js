/* PDM Thomas — page Calories : photo du plat ou ingrédient tapé, estimation Gemini, cumul de la journée */
(async function(){
"use strict";
const P = window.PDM, { $, $$, esc, num, uid, todayISO, fmtDate, toast } = P;
const KEY_LS = "pdm-gemini-key", MODEL_LS = "pdm-gemini-model", DEFAULT_MODEL = "gemini-2.5-flash";
const MEALS = [["pdj","Petit-déj"],["dej","Déjeuner"],["col","Collation"],["din","Dîner"]];
const root = $("#cal");

await P.load();
const D = P.data;
D.meals = D.meals || {};
D.customFoods = D.customFoods || [];
D.calTargets = D.calTargets || { kcalMin: 3000, kcalMax: 3200, protMin: 130 };

/* ---------- utilitaires ---------- */
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch(e){ return ""; } };
const lsSet = (k,v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch(e){} };
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const r0 = v => Math.round(v), r1 = v => Math.round(v*10)/10;
const fmt = v => r0(v).toLocaleString("fr-FR");
const defaultMeal = () => { const h = new Date().getHours() + new Date().getMinutes()/60; return h < 10.5 ? "pdj" : h < 15 ? "dej" : h < 18.5 ? "col" : "din"; };
const forQty = (it, g = it.g) => ({ kcal: it.k*g/100, p: it.p*g/100, c: it.c*g/100, l: it.l*g/100 });
const sum = items => items.reduce((a,it) => { const q = forQty(it); a.kcal += q.kcal; a.p += q.p; a.c += q.c; a.l += q.l; return a; }, { kcal:0, p:0, c:0, l:0 });
function allFoods(){
  const base = (window.PDM_FOODS || []).map(([n,k,p,c,l]) => ({ n, k, p, c, l, src: "base" }));
  return [...D.customFoods.map(f => ({ ...f, src: "perso" })), ...base];
}

const state = { date: todayISO(), meal: defaultMeal(), photo: null, busy: false, pick: null };

/* ---------- Gemini ---------- */
const PROMPT_PHOTO = "Analyse cette photo de repas. Identifie chaque aliment visible, estime sa quantité en grammes (portion réellement présente dans l'assiette) et ses valeurs nutritionnelles pour cette quantité, en t'appuyant sur des valeurs de référence (table Ciqual). Pense aux matières grasses de cuisson et aux sauces visibles. Si ce n'est pas de la nourriture, renvoie une liste vide. Noms en français, courts.";
const PROMPT_FOOD = a => `Donne les valeurs nutritionnelles moyennes POUR 100 GRAMMES de cet aliment tel qu'on le mange : « ${a} ». Appuie-toi sur la table Ciqual quand c'est possible. Nom court en français.`;
const NUM = { type: "NUMBER" }, STR = { type: "STRING" };
const SCHEMA_PHOTO = { type: "OBJECT", properties: {
  aliments: { type: "ARRAY", items: { type: "OBJECT", properties: { nom: STR, grammes: NUM, kcal: NUM, proteines: NUM, glucides: NUM, lipides: NUM },
    required: ["nom","grammes","kcal","proteines","glucides","lipides"] } },
  commentaire: STR }, required: ["aliments","commentaire"] };
const SCHEMA_FOOD = { type: "OBJECT", properties: { nom: STR, kcal: NUM, proteines: NUM, glucides: NUM, lipides: NUM },
  required: ["nom","kcal","proteines","glucides","lipides"] };

async function gemini(parts, schema, retried){
  const key = lsGet(KEY_LS);
  if(!key) throw new Error("NOKEY");
  const model = lsGet(MODEL_LS) || DEFAULT_MODEL;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 } })
  });
  if(r.status === 404 && !retried){            /* modèle retiré par Google : on prend le Flash le plus récent dispo */
    const m = await pickModel(key);
    if(m && m !== model){ lsSet(MODEL_LS, m); return gemini(parts, schema, true); }
  }
  if(!r.ok){
    let msg = ""; try { msg = (await r.json()).error.message; } catch(e){}
    if(r.status === 400 && /API key/i.test(msg) || r.status === 403) throw new Error("Clé Gemini refusée. Vérifie-la dans le bloc « Clé Gemini ».");
    if(r.status === 429) throw new Error("Quota Gemini atteint. Réessaie dans une minute.");
    throw new Error("Gemini a répondu une erreur " + r.status + (msg ? " : " + msg : ""));
  }
  const j = await r.json();
  const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map(p => p.text || "").join("");
  if(!txt) throw new Error("Gemini n'a rien renvoyé (photo refusée ou bloquée).");
  return JSON.parse(txt);
}
async function pickModel(key){
  try{
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if(!r.ok) return null;
    const ms = (await r.json()).models.filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace("models/","")).filter(n => /flash/.test(n) && !/lite|image|tts|live|preview|exp|audio/.test(n));
    ms.sort((a,b) => b.localeCompare(a, "en", { numeric: true }));
    return ms[0] || null;
  }catch(e){ return null; }
}

/* photo → JPEG ≤ 1280 px, en base64 */
function shrink(file){
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const d = c.toDataURL("image/jpeg", 0.82); ok({ url: d, b64: d.split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("Image illisible (format HEIC non lu par ce navigateur ? Prends la photo depuis le site).")); };
    img.src = url;
  });
}

/* ---------- rendu ---------- */
function render(){
  const day = D.meals[state.date] || [];
  const t = sum(day), T = D.calTargets;
  const pct = Math.min(100, t.kcal / T.kcalMax * 100), pctMin = T.kcalMin / T.kcalMax * 100;
  const left = T.kcalMin - t.kcal;
  const verdict = t.kcal === 0 ? "Rien noté pour ce jour." :
    t.kcal < T.kcalMin ? `Il te manque <b>${fmt(left)} kcal</b> pour atteindre ${fmt(T.kcalMin)}.` :
    t.kcal <= T.kcalMax ? `Objectif atteint.` : `${fmt(t.kcal - T.kcalMax)} kcal au-dessus de ${fmt(T.kcalMax)}.`;
  const protOk = t.p >= T.protMin;
  const hasKey = !!lsGet(KEY_LS);

  root.innerHTML = `
  <div class="toolbar">
    <div class="cal-date">
      <button class="icon-btn" data-act="day" data-d="-1" aria-label="Jour précédent">‹</button>
      <input type="date" id="cal-day" value="${state.date}" aria-label="Jour">
      <button class="icon-btn" data-act="day" data-d="1" aria-label="Jour suivant">›</button>
    </div>
    ${state.date !== todayISO() ? `<button class="btn ghost sm" data-act="today">Aujourd'hui</button>` : ""}
  </div>

  <section class="panel" aria-labelledby="h-tot">
    <h2 id="h-tot" class="sr-only">Total du jour</h2>
    <div class="cal-big"><b>${fmt(t.kcal)}</b><span>/ ${fmt(T.kcalMin)}–${fmt(T.kcalMax)} kcal</span></div>
    <div class="cal-bar" role="img" aria-label="${fmt(t.kcal)} kcal sur ${fmt(T.kcalMax)}"><i style="width:${pct}%"></i><em style="left:${pctMin}%"></em></div>
    <p class="muted" style="margin:10px 0 14px">${verdict}</p>
    <div class="stats cal-macros">
      <div class="stat${protOk ? " ok" : ""}"><b>${fmt(t.p)} g</b><small>protéines · min ${T.protMin} g</small></div>
      <div class="stat"><b>${fmt(t.c)} g</b><small>glucides</small></div>
      <div class="stat"><b>${fmt(t.l)} g</b><small>lipides</small></div>
    </div>
  </section>

  <section class="panel section" aria-labelledby="h-add">
    <h2 id="h-add">Ajouter</h2>
    <div class="seg" role="group" aria-label="Repas" style="margin:12px 0 16px">${MEALS.map(([k,l]) => `<button data-meal="${k}" aria-pressed="${k===state.meal}">${l}</button>`).join("")}</div>

    ${hasKey ? "" : `<div class="alert" style="margin-bottom:14px">Colle ta clé Gemini en bas de page pour analyser les photos et estimer les aliments inconnus. La recherche dans la base marche déjà sans clé.</div>`}

    <div class="cal-add">
      <div>
        <h3>Photo du plat</h3>
        <label class="btn${state.busy ? " is-busy" : ""}" style="width:100%">${state.busy === "photo" ? "Analyse en cours…" : "Prendre / choisir une photo"}<input type="file" id="photo" accept="image/*" hidden${state.busy ? " disabled" : ""}></label>
        ${state.photo ? photoBlock() : `<p class="muted cal-hint">Gemini repère chaque aliment et estime les grammes. Tu corriges avant d'ajouter.</p>`}
      </div>
      <div>
        <h3>Ingrédient</h3>
        <form id="food" class="form-row" autocomplete="off">
          <label class="f" data-wide>Aliment<input name="q" placeholder="ex. riz basmati cuit" value="${esc(state.q || "")}"></label>
          <label class="f" style="max-width:110px">Grammes<input name="g" inputmode="decimal" placeholder="g" value="${esc(state.g || "")}"></label>
          <button class="btn" type="submit">Ajouter</button>
        </form>
        <div id="sugg" class="cal-sugg">${suggestions()}</div>
      </div>
    </div>
  </section>

  <section class="panel section" aria-labelledby="h-day">
    <h2 id="h-day">${state.date === todayISO() ? "Aujourd'hui" : esc(fmtDate(state.date))}</h2>
    ${day.length ? MEALS.map(([k,l]) => mealBlock(k, l, day.filter(it => (it.m || "dej") === k))).join("") : `<p class="empty">Ajoute une photo ou un ingrédient.</p>`}
  </section>

  <section class="panel section" aria-labelledby="h-week">
    <h2 id="h-week">7 derniers jours</h2>
    ${weekBlock()}
  </section>

  <section class="panel section" aria-labelledby="h-set">
    <details${hasKey ? "" : " open"}>
      <summary style="cursor:pointer"><h2 id="h-set" style="display:inline">Clé Gemini et objectifs</h2></summary>
      <p class="muted">La clé reste sur cet appareil, elle n'est jamais envoyée sur GitHub. À coller une fois sur le PC et une fois sur le téléphone. Clé gratuite sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
      <form id="cfg" class="form-row">
        <label class="f" data-wide>Clé Gemini<input name="key" type="password" autocomplete="off" placeholder="AIza…" value="${esc(lsGet(KEY_LS))}"></label>
        <label class="f">Modèle<input name="model" placeholder="${DEFAULT_MODEL}" value="${esc(lsGet(MODEL_LS))}"></label>
        <label class="f" style="max-width:120px">Kcal min<input name="kmin" inputmode="numeric" value="${T.kcalMin}"></label>
        <label class="f" style="max-width:120px">Kcal max<input name="kmax" inputmode="numeric" value="${T.kcalMax}"></label>
        <label class="f" style="max-width:120px">Protéines min (g)<input name="pmin" inputmode="numeric" value="${T.protMin}"></label>
        <button class="btn" type="submit">Enregistrer</button>
      </form>
      ${D.customFoods.length ? `<h3 style="margin-top:18px">Tes aliments enregistrés</h3><div class="chips" style="margin-top:8px">${D.customFoods.map((f,i) => `<span class="chip">${esc(f.n)} <small>${fmt(f.k)} kcal/100 g</small><button data-act="del-food" data-i="${i}" aria-label="Supprimer ${esc(f.n)}">×</button></span>`).join("")}</div>` : ""}
    </details>
  </section>`;
  bind();
}

function photoBlock(){
  const ph = state.photo;
  const tot = sum((ph.items || []).filter(it => it.on));
  return `<div class="cal-photo">
    <img src="${ph.url}" alt="Ton plat">
    ${state.busy === "photo" ? `<p class="muted cal-hint">Gemini analyse ton plat…</p>` : ""}
    ${ph.err ? `<div class="alert">${esc(ph.err)}</div><button class="btn ghost sm" data-act="ph-cancel" style="justify-self:start">Fermer</button>` : ""}
    ${ph.items ? (ph.items.length ? `
      <ul class="cal-items">${ph.items.map((it,i) => `<li class="${it.on ? "" : "off"}">
        <label class="cal-chk"><input type="checkbox" data-ph-on="${i}"${it.on ? " checked" : ""}><span>${esc(it.n)}</span></label>
        <input class="cal-g" data-ph-g="${i}" inputmode="decimal" value="${r0(it.g)}" aria-label="Grammes de ${esc(it.n)}"><span class="muted">g</span>
        <b>${fmt(forQty(it).kcal)}</b></li>`).join("")}</ul>
      ${ph.comment ? `<p class="details" style="margin:8px 0">${esc(ph.comment)}</p>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn green" data-act="ph-add">Ajouter ${fmt(tot.kcal)} kcal</button>
        <button class="btn ghost sm" data-act="ph-cancel">Annuler</button>
      </div>` : `<p class="muted">Aucun aliment reconnu sur cette photo.</p><button class="btn ghost sm" data-act="ph-cancel">Fermer</button>`) : ""}
  </div>`;
}

function suggestions(){
  const q = norm(state.q || "");
  if(state.busy === "food") return `<p class="muted cal-hint">Gemini estime « ${esc(state.q)} »…</p>`;
  if(state.pick) return `<p class="muted cal-hint">Sélectionné : <b>${esc(state.pick.n)}</b> · ${fmt(state.pick.k)} kcal, ${r1(state.pick.p)} g prot. pour 100 g${state.pick.src === "gemini" ? " (estimation Gemini)" : ""}. Indique les grammes puis Ajouter.</p>`;
  if(q.length < 2) return `<p class="muted cal-hint">Tape au moins 2 lettres : la base et tes aliments enregistrés s'affichent.</p>`;
  const words = q.split(/\s+/);
  const hits = allFoods().filter(f => { const n = norm(f.n); return words.every(w => n.includes(w)); }).slice(0, 8);
  return `${hits.map((f) => `<button type="button" class="cal-opt" data-pick="${esc(f.n)}"><span>${esc(f.n)}</span><small>${fmt(f.k)} kcal · ${r1(f.p)} g prot. /100 g${f.src === "perso" ? " · perso" : ""}</small></button>`).join("")}
    <button type="button" class="cal-opt ai" data-act="ask"><span>${hits.length ? "Pas le bon ? " : "Introuvable : "}estimer « ${esc(state.q.trim())} » avec Gemini</span><small>valeurs pour 100 g, enregistrées pour la prochaine fois</small></button>`;
}

function mealBlock(k, label, items){
  if(!items.length) return "";
  const t = sum(items);
  return `<div class="cal-meal"><div class="cal-meal-h"><h3>${label}</h3><span class="muted">${fmt(t.kcal)} kcal · ${fmt(t.p)} g prot.</span></div>
    <ul class="cal-items">${items.map(it => `<li data-it="${it.id}">
      <span class="cal-name">${esc(it.n)}${it.src === "photo" ? ` <small class="muted">photo</small>` : ""}</span>
      <input class="cal-g" data-it-g inputmode="decimal" value="${r0(it.g)}" aria-label="Grammes de ${esc(it.n)}"><span class="muted">g</span>
      <b>${fmt(forQty(it).kcal)}</b>
      <button class="icon-btn danger" data-act="del-it" aria-label="Supprimer ${esc(it.n)}">×</button></li>`).join("")}</ul></div>`;
}

function weekBlock(){
  const days = [];
  for(let i = 6; i >= 0; i--){ const d = new Date(state.date + "T12:00"); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0,10)); }
  const vals = days.map(d => ({ d, t: sum(D.meals[d] || []), n: (D.meals[d] || []).length }));
  const max = Math.max(D.calTargets.kcalMax, ...vals.map(v => v.t.kcal)) * 1.05;
  const noted = vals.filter(v => v.n);
  const avg = noted.length ? noted.reduce((a,v) => a + v.t.kcal, 0) / noted.length : 0;
  return `<div class="cal-week">${vals.map(v => `<button data-go="${v.d}" class="${v.d === state.date ? "cur" : ""}" aria-label="${fmtDate(v.d)} : ${fmt(v.t.kcal)} kcal">
      <span class="cal-col"><i style="height:${v.t.kcal / max * 100}%" class="${v.t.kcal >= D.calTargets.kcalMin ? "ok" : ""}"></i><em style="bottom:${D.calTargets.kcalMin / max * 100}%"></em></span>
      <b>${v.n ? fmt(v.t.kcal) : "—"}</b><small>${new Date(v.d + "T12:00").toLocaleDateString("fr-FR", { weekday: "short" })}</small></button>`).join("")}</div>
    <p class="muted" style="margin:12px 0 0">${noted.length ? `Moyenne sur ${noted.length} jour${noted.length > 1 ? "s" : ""} notés : <b>${fmt(avg)} kcal</b>.` : "Aucun jour noté sur cette période."}</p>`;
}

/* ---------- actions ---------- */
function addItems(items){
  (D.meals[state.date] = D.meals[state.date] || []).push(...items);
  P.save(items.length > 1 ? `${items.length} aliments ajoutés` : `${items[0].n} ajouté`);
}

function bind(){
  $("#cal-day").onchange = e => { if(e.target.value){ state.date = e.target.value; render(); } };
  $$("[data-meal]", root).forEach(b => b.onclick = () => { state.meal = b.dataset.meal; $$("[data-meal]", root).forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $$("[data-go]", root).forEach(b => b.onclick = () => { state.date = b.dataset.go; render(); });

  $("#photo").onchange = async e => {
    const file = e.target.files[0]; if(!file) return;
    let img;
    try { img = await shrink(file); } catch(err){ toast(err.message); return; }
    state.photo = { url: img.url, items: null }; state.busy = "photo"; render();
    try{
      const res = await gemini([{ text: PROMPT_PHOTO }, { inline_data: { mime_type: "image/jpeg", data: img.b64 } }], SCHEMA_PHOTO);
      state.photo.items = (res.aliments || []).filter(a => a.grammes > 0).map(a => ({
        n: a.nom, g: a.grammes, on: true,
        k: a.kcal / a.grammes * 100, p: a.proteines / a.grammes * 100, c: a.glucides / a.grammes * 100, l: a.lipides / a.grammes * 100 }));
      state.photo.comment = res.commentaire || "";
    }catch(err){
      state.photo.err = err.message === "NOKEY" ? "Ajoute d'abord ta clé Gemini en bas de page." : err.message;
      state.photo.items = state.photo.items || null;
    }
    state.busy = false; render();
  };

  const f = $("#food");
  f.q.oninput = () => { state.q = f.q.value; state.pick = null; $("#sugg").innerHTML = suggestions(); };
  f.g.oninput = () => { state.g = f.g.value; };
  $("#sugg").onclick = async e => {
    const o = e.target.closest("[data-pick]");
    if(o){ state.pick = allFoods().find(x => x.n === o.dataset.pick); state.q = f.q.value = state.pick.n; $("#sugg").innerHTML = suggestions(); f.g.focus(); return; }
    if(e.target.closest("[data-act=ask]")) ask();
  };
  async function ask(){
    const q = (state.q || "").trim(); if(!q) return;
    state.busy = "food"; $("#sugg").innerHTML = suggestions();
    try{
      const r = await gemini([{ text: PROMPT_FOOD(q) }], SCHEMA_FOOD);
      const food = { n: r.nom || q, k: r1(r.kcal), p: r1(r.proteines), c: r1(r.glucides), l: r1(r.lipides) };
      const i = D.customFoods.findIndex(x => norm(x.n) === norm(food.n));
      if(i >= 0) D.customFoods[i] = food; else D.customFoods.unshift(food);
      P.save();
      state.pick = { ...food, src: "gemini" }; state.q = food.n;
    }catch(err){ toast(err.message === "NOKEY" ? "Ajoute d'abord ta clé Gemini en bas de page" : err.message); }
    state.busy = false; render();
    const ff = $("#food"); ff && ff.g.focus();
  }
  f.onsubmit = e => {
    e.preventDefault();
    const g = num(f.g.value);
    let food = state.pick;
    if(!food){ const q = norm(f.q.value); food = allFoods().find(x => norm(x.n) === q); }
    if(!food){ toast(f.q.value.trim() ? "Choisis un aliment dans la liste ou demande à Gemini" : "Tape un aliment"); return; }
    if(!g || g <= 0){ f.g.focus(); toast("Indique les grammes"); return; }
    addItems([{ id: uid("m"), n: food.n, g, k: food.k, p: food.p, c: food.c, l: food.l, m: state.meal, src: food.src === "gemini" ? "gemini" : food.src }]);
    state.q = ""; state.g = ""; state.pick = null; render();
  };

  /* éditions de la liste photo et du jour */
  root.oninput = e => {
    const t = e.target;
    if(t.dataset.phG != null){ const v = num(t.value); if(v != null && v >= 0){ state.photo.items[+t.dataset.phG].g = v; refreshPhotoTotals(); } }
  };
  root.onchange = e => {
    const t = e.target;
    if(t.dataset.phOn != null){ state.photo.items[+t.dataset.phOn].on = t.checked; t.closest("li").classList.toggle("off", !t.checked); refreshPhotoTotals(); }
    if(t.hasAttribute("data-it-g")){
      const it = (D.meals[state.date] || []).find(x => x.id === t.closest("[data-it]").dataset.it), v = num(t.value);
      if(it && v != null && v > 0){ it.g = v; P.save("Quantité modifiée"); render(); } else render();
    }
  };
  root.onclick = e => {
    const b = e.target.closest("[data-act]"); if(!b) return;
    const a = b.dataset.act;
    if(a === "day"){ const d = new Date(state.date + "T12:00"); d.setDate(d.getDate() + +b.dataset.d); state.date = d.toISOString().slice(0,10); render(); }
    if(a === "today"){ state.date = todayISO(); render(); }
    if(a === "ph-cancel"){ state.photo = null; render(); }
    if(a === "ph-add"){
      const items = state.photo.items.filter(it => it.on && it.g > 0).map(it => ({ id: uid("m"), n: it.n, g: it.g, k: r1(it.k), p: r1(it.p), c: r1(it.c), l: r1(it.l), m: state.meal, src: "photo" }));
      if(!items.length){ toast("Rien de coché"); return; }
      addItems(items); state.photo = null; render();
    }
    if(a === "del-it"){
      const id = b.closest("[data-it]").dataset.it;
      D.meals[state.date] = D.meals[state.date].filter(x => x.id !== id);
      if(!D.meals[state.date].length) delete D.meals[state.date];
      P.save("Supprimé"); render();
    }
    if(a === "del-food"){
      const fd = D.customFoods[+b.dataset.i];
      if(confirm(`Retirer « ${fd.n} » de tes aliments enregistrés ?`)){ D.customFoods.splice(+b.dataset.i, 1); P.save("Aliment retiré"); render(); }
    }
  };
  function refreshPhotoTotals(){
    const items = state.photo.items;
    $$(".cal-photo .cal-items li", root).forEach((li, i) => { li.querySelector("b").textContent = fmt(forQty(items[i]).kcal); });
    const btn = $("[data-act=ph-add]", root); if(btn) btn.textContent = `Ajouter ${fmt(sum(items.filter(it => it.on)).kcal)} kcal`;
  }

  $("#cfg").onsubmit = e => {
    e.preventDefault(); const c = e.target;
    lsSet(KEY_LS, c.key.value.trim()); lsSet(MODEL_LS, c.model.value.trim());
    const kmin = num(c.kmin.value), kmax = num(c.kmax.value), pmin = num(c.pmin.value);
    if(kmin && kmax && kmax >= kmin && pmin){
      const T = D.calTargets;
      if(T.kcalMin !== kmin || T.kcalMax !== kmax || T.protMin !== pmin){ D.calTargets = { kcalMin: kmin, kcalMax: kmax, protMin: pmin }; P.save(); }
    } else { toast("Objectifs invalides"); return; }
    toast("Enregistré"); render();
  };
}

render();
})();
