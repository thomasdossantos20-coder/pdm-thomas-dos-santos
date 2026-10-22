/* PDM Thomas — moteur commun : données, sauvegarde GitHub, navigation */
(function(){
"use strict";

const CFG_KEY = "pdm-config";
const DATA_KEY = "pdm-data";
const DIRTY_KEY = "pdm-dirty";
const DEFAULT_CFG = { owner:"thomasdossantos20-coder", repo:"pdm-thomas-dos-santos", branch:"data", path:"data.json", token:"" };

/* ---------- utilitaires ---------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
const fmtKg = v => v == null ? "—" : (Math.round(v*10)/10).toLocaleString("fr-FR", {minimumFractionDigits:1, maximumFractionDigits:1});
const fmtLoad = v => v == null ? "—" : v.toLocaleString("fr-FR", {maximumFractionDigits:2});
const fmtDelta = d => d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "±") + fmtKg(Math.abs(d));
const MONTHS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const fmtDate = iso => { if(!iso) return "—"; const [y,m,d] = iso.split("-").map(Number); return `${d} ${MONTHS[m-1]} ${y}`; };
const fmtDateShort = iso => { if(!iso) return ""; const [,m,d] = iso.split("-").map(Number); return `${d} ${MONTHS[m-1]}`; };
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const daysBetween = (a,b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function toast(msg){
  let t = $(".toast"); if(!t){ t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- config ---------- */
function getCfg(){ try { return Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch(e){ return {...DEFAULT_CFG}; } }
function setCfg(c){ try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch(e){} }

/* ---------- base64 UTF-8 ---------- */
function b64encode(str){
  const bytes = new TextEncoder().encode(str); let bin = "";
  for(let i=0;i<bytes.length;i+=0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i+0x8000));
  return btoa(bin);
}
function b64decode(b64){
  const bin = atob(b64.replace(/\s/g,"")); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- statut de synchro ---------- */
let syncState = "local";
function setSync(s, label){
  syncState = s;
  const el = $(".sync"); if(!el) return;
  el.dataset.s = s;
  const txt = label || ({ok:"Sauvegardé", busy:"Sauvegarde…", err:"Erreur de sauvegarde", local:"Sur cet appareil"})[s];
  el.querySelector("span").textContent = txt;
  el.title = s === "local" ? "Ajoute ta clé GitHub dans Réglages pour synchroniser PC et téléphone" : txt;
}

/* ---------- GitHub ---------- */
let remoteSha = null;
function apiUrl(c){ return `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path}?ref=${encodeURIComponent(c.branch)}`; }
function apiHeaders(c){ return { "Authorization": `Bearer ${c.token}`, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; }

async function fetchRemote(){
  const c = getCfg();
  if(c.token){
    const r = await fetch(apiUrl(c) + "&t=" + Date.now(), { headers: apiHeaders(c), cache: "no-store" });
    if(r.status === 404) { remoteSha = null; return null; }
    if(!r.ok) throw new Error("GitHub " + r.status);
    const j = await r.json(); remoteSha = j.sha;
    return JSON.parse(b64decode(j.content));
  }
  const r = await fetch(`https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${c.path}?t=${Date.now()}`, { cache: "no-store" });
  if(!r.ok) return null;
  return await r.json();
}

async function pushRemote(data, retry=true){
  const c = getCfg();
  if(!c.token){ setSync("local"); return false; }
  setSync("busy");
  try{
    if(!remoteSha){
      const g = await fetch(apiUrl(c) + "&t=" + Date.now(), { headers: apiHeaders(c), cache: "no-store" });
      if(g.ok) remoteSha = (await g.json()).sha;
    }
    const body = { message: `PDM : mise à jour ${new Date().toLocaleString("fr-FR")}`, content: b64encode(JSON.stringify(data, null, 1)), branch: c.branch };
    if(remoteSha) body.sha = remoteSha;
    const payload = JSON.stringify(body);
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path}`, { method:"PUT", headers: {...apiHeaders(c), "Content-Type":"application/json"}, body: payload, keepalive: payload.length < 60000 });
    if((r.status === 409 || r.status === 422) && retry){ remoteSha = null; return pushRemote(data, false); }
    if(!r.ok){
      const msg = r.status === 401 ? "Clé GitHub refusée" : r.status === 404 ? "Repo ou branche introuvable" : "Erreur GitHub " + r.status;
      setSync("err", msg); return false;
    }
    remoteSha = (await r.json()).content.sha;
    localStorage.setItem(DIRTY_KEY, "0");
    setSync("ok");
    return true;
  }catch(e){
    setSync("err", navigator.onLine ? "Erreur de sauvegarde" : "Hors ligne, sauvegardé ici");
    return false;
  }
}

/* ---------- store ---------- */
let DATA = null;
let pushTimer = null;

async function load(){
  let local = null;
  try { local = JSON.parse(localStorage.getItem(DATA_KEY) || "null"); } catch(e){}
  const dirty = localStorage.getItem(DIRTY_KEY) === "1";
  let remote = null;
  try { remote = await fetchRemote(); } catch(e){ setSync("err", "GitHub injoignable"); }
  if(!remote && !local){
    const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    remote = await r.json();
  }
  if(local && dirty && (!remote || (local.updatedAt || "") >= (remote.updatedAt || ""))){
    DATA = local; schedulePush(0);
  } else if(remote && (!local || (remote.updatedAt || "") >= (local.updatedAt || "") || !dirty)){
    DATA = remote; persistLocal(false);
    if(getCfg().token && syncState !== "err") setSync("ok");
  } else {
    DATA = local;
  }
  if(!getCfg().token){ setSync("local"); keyBanner(); }
  return DATA;
}
function persistLocal(dirty){
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(DATA));
    if(dirty) localStorage.setItem(DIRTY_KEY, "1");
  } catch(e){}
}
function schedulePush(ms=300){
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushRemote(DATA), ms);
}
function save(msg){
  DATA.updatedAt = new Date().toISOString();
  persistLocal(true);
  if(getCfg().token){ setSync("busy"); schedulePush(); } else setSync("local");
  if(msg) toast(msg);
}
function flushNow(){
  if(!DATA || !getCfg().token) return;
  if(pushTimer || localStorage.getItem(DIRTY_KEY) === "1"){ clearTimeout(pushTimer); pushTimer = null; pushRemote(DATA); }
}
async function pullIfNewer(){
  if(!DATA || !getCfg().token || document.visibilityState === "hidden") return;
  if(pushTimer || localStorage.getItem(DIRTY_KEY) === "1"){ clearTimeout(pushTimer); pushTimer = null; await pushRemote(DATA); return; }
  try{
    const remote = await fetchRemote();
    if(remote && (remote.updatedAt || "") > (DATA.updatedAt || "")){
      DATA = remote; persistLocal(false); setSync("ok", "Mis à jour");
      const a = document.activeElement;
      if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value !== a.defaultValue) return; /* ne coupe pas une saisie en cours */
      location.reload();
    }
  }catch(e){}
}
document.addEventListener("visibilitychange", () => { document.visibilityState === "hidden" ? flushNow() : pullIfNewer(); });
window.addEventListener("pagehide", flushNow);
window.addEventListener("beforeunload", flushNow);
window.addEventListener("focus", pullIfNewer);
window.addEventListener("online", pullIfNewer);
setInterval(pullIfNewer, 20000);

function keyBanner(){
  if(location.pathname.endsWith("reglages.html") || document.querySelector(".key-banner")) return;
  let priv = false; try { localStorage.setItem("pdm-t","1"); localStorage.removeItem("pdm-t"); } catch(e){ priv = true; }
  const standalone = navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  const b = document.createElement("div"); b.className = "key-banner"; b.setAttribute("role","alert");
  b.innerHTML = priv
    ? `Navigation privée : rien n'est sauvegardé ici. Ouvre le site dans un onglet normal.`
    : `Pas de clé GitHub ${standalone ? "dans l'app de l'écran d'accueil (elle ne partage pas la mémoire de Safari)" : "sur cet appareil"} : tes modifs ne vont pas sur l'autre appareil. <a href="reglages.html">Coller la clé</a>`;
  document.querySelector(".topbar").after(b);
}

/* ---------- calculs poids ---------- */
function weightsAsc(){ return [...DATA.weights].sort((a,b) => a.date.localeCompare(b.date)); }
function withDeltas(){
  const asc = weightsAsc();
  return asc.map((w,i) => ({...w, delta: i ? Math.round((w.kg - asc[i-1].kg)*10)/10 : null }));
}
function rollingAvg(asc, n=4){
  return asc.map((w,i) => { const s = asc.slice(Math.max(0,i-n+1), i+1); return Math.round(s.reduce((a,b)=>a+b.kg,0)/s.length*100)/100; });
}

/* ---------- navigation ---------- */
const ICONS = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7"/><path d="M5 4a2 2 0 0 0-2 2v1h4V6a2 2 0 0 0-2-2Z"/><path d="M7 20a2 2 0 0 1-2-2V7"/><path d="M10 9h6M10 13h6M10 17h3"/></svg>',
  weight:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-3 7a3 3 0 0 0 6 0L4 7ZM20 7l-3 7a3 3 0 0 0 6 0l-3-7Z"/></svg>',
  prog:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/></svg>',
  arch:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
  dojo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5c4 1.2 16 1.2 20 0M4 9h16M7 6.5V21M17 6.5V21M12 9v3"/></svg>'
};
const PAGES = [
  ["index.html","Accueil","home"],["poids.html","Poids","weight"],["programme.html","Programme","prog"],["archives.html","Archives","arch"],["dojo.html","Dojo","dojo"]
];
const BRAND = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="bm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB24D"/><stop offset="1" stop-color="#E0610B"/></linearGradient></defs><circle cx="20" cy="20" r="19" fill="url(#bm)"/><path d="M20 6 L23.5 16.5 L34 20 L23.5 23.5 L20 34 L16.5 23.5 L6 20 L16.5 16.5 Z" fill="#1d1000"/><circle cx="20" cy="20" r="3" fill="#FFB24D"/></svg>';
function renderShell(){
  const here = location.pathname.split("/").pop() || "index.html";
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `<div class="tape" aria-hidden="true"></div>
    <div class="topbar-in">
      <a class="brand" href="index.html" aria-label="PDM Thomas, accueil">${BRAND}<span><b>PDM</b> <small>Thomas</small></span></a>
      <nav class="nav" aria-label="Pages">${PAGES.map(([h,l,ic]) => `<a href="${h}"${h===here?' aria-current="page"':""}>${ICONS[ic]}<span>${l}</span></a>`).join("")}</nav>
      <a class="sync" href="reglages.html" data-s="local"${here==="reglages.html"?' aria-current="page"':""}><i></i><span>Sur cet appareil</span></a>
    </div>`;
  document.body.prepend(header);
}
function leaves(){ /* remplacé par le décor animé (fx.js) */ }

/* ---------- programme : rendu commun ---------- */
function lastLoad(ex, gym){
  const ls = ex.loads.filter(l => !gym || gym === "all" || l.gym === gym || (!l.gym && gym === "none"));
  return ls.length ? ls[ls.length-1] : null;
}
function sparkSVG(values){
  if(values.length < 2) return "";
  const w = 200, h = 34, min = Math.min(...values), max = Math.max(...values), span = (max-min) || 1;
  const pts = values.map((v,i) => `${(i/(values.length-1)*w).toFixed(1)},${(h-3-(v-min)/span*(h-6)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sparkg" x1="0" x2="1"><stop offset="0" stop-color="#4DBA74"/><stop offset="1" stop-color="#FF8A1F"/></linearGradient></defs><polyline points="${pts}" fill="none" stroke="url(#sparkg)" stroke-width="2.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderProgram(root, prog, state){
  const sessions = prog.sessions;
  if(!state.session || !sessions.find(s => s.key === state.session)) state.session = sessions[0].key;
  const sess = sessions.find(s => s.key === state.session);
  const gym = state.gym || "all";
  const defGym = gym === "Paris" || gym === "Courbevoie" ? gym : (localStorage.getItem("pdm-gym") || "");

  root.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Séance">${sessions.map(s => `<button data-sess="${esc(s.key)}" aria-pressed="${s.key===state.session}">${esc(s.name)}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Salle">${[["all","Toutes salles"],["Paris","Paris"],["Courbevoie","Courbevoie"]].map(([k,l]) => `<button data-gym="${k}" aria-pressed="${k===gym}">${l}</button>`).join("")}</div>
    </div>
    <div class="legend-gym" style="margin-bottom:14px"><span class="lp">Paris</span><span class="lc">Courbevoie</span><span>Sans marque : salle non précisée</span></div>
    <div class="ex-list">
      ${sess.exercises.map(ex => exCard(ex, gym, defGym)).join("")}
    </div>
    <div style="margin-top:16px"><button class="btn ghost" data-act="add-ex">Ajouter un exercice à ${esc(sess.name)}</button></div>`;

  $$("[data-sess]", root).forEach(b => b.onclick = () => { state.session = b.dataset.sess; if(state.hash) history.replaceState(null,"","#"+state.session); renderProgram(root, prog, state); });
  $$("[data-gym]", root).forEach(b => b.onclick = () => { state.gym = b.dataset.gym; if(b.dataset.gym !== "all") localStorage.setItem("pdm-gym", b.dataset.gym); renderProgram(root, prog, state); });

  root.onclick = e => {
    const t = e.target.closest("[data-act]"); if(!t) return;
    const card = t.closest("[data-ex]");
    const ex = card ? sess.exercises.find(x => x.id === card.dataset.ex) : null;
    const act = t.dataset.act;
    if(act === "add-load"){
      const v = num($("input[name=load]", card).value);
      if(v == null){ $("input[name=load]", card).focus(); toast("Entre une charge en kg"); return; }
      const g = $("select[name=gym]", card).value || null;
      if(g) localStorage.setItem("pdm-gym", g);
      const prevMax = ex.loads.filter(l => !g || !l.gym || l.gym === g).reduce((m,l) => Math.max(m, l.v), -Infinity);
      ex.loads.push({ v, gym: g, date: todayISO() });
      const isPR = ex.loads.length > 1 && v > prevMax;
      save(isPR ? `Nouveau record : ${fmtLoad(v)} kg sur ${ex.name}` : `${fmtLoad(v)} kg ajouté sur ${ex.name}`);
      renderProgram(root, prog, state);
      if(isPR && window.FX){ const c = root.querySelector(`[data-ex="${ex.id}"]`); c && c.classList.add("pr"); FX.burstFrom(c && c.querySelector(".ex-max"), 40); FX.stamp("Nouveau record"); }
    }
    if(act === "del-load"){
      const i = +t.dataset.i; const l = ex.loads[i];
      if(confirm(`Supprimer ${fmtLoad(l.v)} kg de l'historique ${ex.name} ?`)){ ex.loads.splice(i,1); save("Charge supprimée"); renderProgram(root, prog, state); }
    }
    if(act === "edit-ex"){
      const name = prompt("Nom de l'exercice", ex.name); if(name === null) return;
      const sets = prompt("Séries", ex.sets); if(sets === null) return;
      const reps = prompt("Répétitions", ex.reps); if(reps === null) return;
      ex.name = name.trim() || ex.name; ex.sets = isFinite(+sets) && sets !== "" ? +sets : sets; ex.reps = reps;
      save("Exercice modifié"); renderProgram(root, prog, state);
    }
    if(act === "del-ex"){
      if(confirm(`Retirer ${ex.name} de ${sess.name} ? L'historique de charges sera perdu.`)){ sess.exercises = sess.exercises.filter(x => x !== ex); save("Exercice retiré"); renderProgram(root, prog, state); }
    }
    if(act === "move-up" || act === "move-down"){
      const i = sess.exercises.indexOf(ex), j = act === "move-up" ? i-1 : i+1;
      if(j < 0 || j >= sess.exercises.length) return;
      [sess.exercises[i], sess.exercises[j]] = [sess.exercises[j], sess.exercises[i]];
      save(); renderProgram(root, prog, state);
    }
    if(act === "add-ex"){
      const name = prompt("Nom du nouvel exercice"); if(!name) return;
      const sets = prompt("Séries", "3") || "3"; const reps = prompt("Répétitions", "10") || "10";
      sess.exercises.push({ id: uid("e"), name: name.trim(), sets: isFinite(+sets) ? +sets : sets, reps, loads: [], note: "" });
      save("Exercice ajouté"); renderProgram(root, prog, state);
    }
  };
  $$("textarea.next-note", root).forEach(ta => ta.onchange = () => {
    const ex = sess.exercises.find(x => x.id === ta.closest("[data-ex]").dataset.ex);
    ex.note = ta.value.trim(); save("Note enregistrée");
  });
  $$("input[name=load]", root).forEach(inp => inp.onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); inp.closest("[data-ex]").querySelector("[data-act=add-load]").click(); } });
}

function exCard(ex, gym, defGym){
  const shown = ex.loads.map((l,i) => ({...l, i})).filter(l => gym === "all" || l.gym === gym);
  const last = shown.length ? shown[shown.length-1] : null;
  const best = shown.length ? Math.max(...shown.map(l => l.v)) : null;
  const gymClass = g => g === "Paris" ? "paris" : g === "Courbevoie" ? "courbevoie" : "";
  const chips = shown.map((l,k) => `<span class="chip ${gymClass(l.gym)}${k===shown.length-1?" last":""}" title="${l.gym?esc(l.gym):"Salle non précisée"}${l.date?" · "+fmtDate(l.date):""}${l.label?" · "+esc(l.label):""}">${fmtLoad(l.v)}${l.label?` <small>(${esc(l.label)})</small>`:""}<button data-act="del-load" data-i="${l.i}" aria-label="Supprimer ${fmtLoad(l.v)} kg">×</button></span>`).join("");
  const hasLoads = ex.loads.length > 0 || ex.reps !== "max";
  return `<article class="ex" data-ex="${ex.id}">
    <div class="ex-head">
      <div>
        <div class="ex-name">${esc(ex.name)}</div>
        <div class="ex-scheme">${esc(ex.sets)} séries × ${esc(ex.reps)} reps${best!=null && last && best!==last.v ? ` · <span class="rec">record ${fmtLoad(best)} kg</span>` : ""}</div>
      </div>
      ${last ? `<div class="ex-max"><b>${fmtLoad(last.v)}</b><small>kg${last.date ? " · " + fmtDateShort(last.date) : ", dernière"}</small></div>` : ""}
    </div>
    ${ex.alert ? `<div class="alert">${esc(ex.alert)}</div>` : ""}
    ${ex.details ? `<div class="details">${esc(ex.details)}</div>` : ""}
    ${shown.length > 1 ? sparkSVG(shown.map(l => l.v)) : ""}
    ${chips ? `<div class="chips">${chips}</div>` : (ex.loads.length && gym !== "all" ? `<div class="muted" style="font-size:14px">Rien noté à ${esc(gym)} sur cet exercice.</div>` : "")}
    ${hasLoads ? `<div class="add-load">
      <input name="load" inputmode="decimal" placeholder="kg" aria-label="Nouvelle charge pour ${esc(ex.name)}">
      <select name="gym" aria-label="Salle">
        <option value="">Salle ?</option>
        <option${defGym==="Paris"?" selected":""}>Paris</option>
        <option${defGym==="Courbevoie"?" selected":""}>Courbevoie</option>
      </select>
      <button class="btn sm" data-act="add-load">Ajouter</button>
    </div>` : ""}
    <label class="f" style="min-width:0">Pour la prochaine fois
      <textarea class="next-note" rows="2">${esc(ex.note)}</textarea>
    </label>
    <div class="ex-actions">
      <button class="icon-btn" data-act="move-up" aria-label="Monter">↑</button>
      <button class="icon-btn" data-act="move-down" aria-label="Descendre">↓</button>
      <button class="icon-btn" data-act="edit-ex">Modifier</button>
      <button class="icon-btn danger" data-act="del-ex">Retirer</button>
    </div>
  </article>`;
}

/* ---------- export ---------- */
window.PDM = { $, $$, esc, uid, num, fmtKg, fmtLoad, fmtDelta, fmtDate, fmtDateShort, todayISO, daysBetween, toast,
  getCfg, setCfg, load, save, pushRemote, fetchRemote, weightsAsc, withDeltas, rollingAvg, renderProgram, leaves,
  get data(){ return DATA; }, set data(v){ DATA = v; },
  resetRemoteSha(){ remoteSha = null; }, setSync };

renderShell();
})();
