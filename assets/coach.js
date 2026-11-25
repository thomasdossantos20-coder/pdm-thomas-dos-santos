/* PDM Thomas — Coach : récap de séance, bilan de la semaine, chat.
   Les chiffres sont calculés ici (exacts). Gemini ne fait que les expliquer et répondre aux questions. */
(async function(){
"use strict";
const P = window.PDM, { $, $$, esc, todayISO, fmtDate, fmtDateShort, fmtLoad, toast } = P;
const root = $("#coach");

await P.load();
const D = P.data;
D.coach = D.coach || {};
D.coach.notes = D.coach.notes || {};
D.coach.chat = D.coach.chat || [];

const r0 = v => Math.round(v), r1 = v => Math.round(v*10)/10;
const fmt = v => r0(v).toLocaleString("fr-FR");
const dec = v => r1(v).toLocaleString("fr-FR");
const shift = (iso, d) => { const x = new Date(iso + "T12:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0,10); };
const monday = iso => { const x = new Date(iso + "T12:00"); return shift(iso, -((x.getDay() + 6) % 7)); };
const MEALS = { pdj: "Petit-déj", dej: "Déjeuner", col: "Collation", din: "Dîner" };

const prog = D.programs.find(p => p.current) || D.programs[0];
const sessions = prog.sessions.filter(s => s.exercises.some(x => x.kind !== "stretch"));
const T = D.calTargets || { kcalMin: 3000, kcalMax: 3200, protMin: 130 };

/* ---------- analyse des charges ---------- */
const compatible = (a, b) => !a.gym || !b.gym || a.gym === b.gym;
function exerciseOn(ex, date){
  const idx = ex.loads.map((l,i) => ({ ...l, i })).filter(l => l.date === date);
  if(!idx.length) return null;
  const today = idx.reduce((m,l) => l.v > m.v ? l : m);
  const before = ex.loads.slice(0, idx[0].i).filter(l => compatible(l, today) && (!l.date || l.date < date));
  const prev = before.length ? before[before.length - 1] : null;
  const best = before.length ? Math.max(...before.map(l => l.v)) : null;
  const status = best == null ? "first" : today.v > best ? "pr" : prev && today.v > prev.v ? "up" : prev && today.v < prev.v ? "down" : "same";
  return { name: ex.name, scheme: `${ex.sets}×${ex.reps}`, v: today.v, gym: today.gym, prev: prev && prev.v, prevDate: prev && prev.date, best, status, note: ex.note || "", alert: ex.alert || "" };
}
function sessionDates(s){
  const set = new Set(); s.exercises.forEach(ex => ex.loads.forEach(l => l.date && set.add(l.date)));
  return [...set].sort();
}
function sessionRecap(s, date){
  const rows = s.exercises.filter(ex => ex.kind !== "stretch").map(ex => exerciseOn(ex, date) || { name: ex.name, scheme: `${ex.sets}×${ex.reps}`, status: ex.reps === "max" || !ex.loads.length ? "na" : "none", note: ex.note || "" });
  return { key: s.key, name: s.name, date, rows,
    pr: rows.filter(r => r.status === "pr").length, up: rows.filter(r => r.status === "up").length,
    down: rows.filter(r => r.status === "down").length, logged: rows.filter(r => r.v != null).length,
    total: rows.filter(r => r.status !== "na").length };
}
const undated = () => sessions.reduce((n,s) => n + s.exercises.reduce((m,ex) => m + ex.loads.filter(l => !l.date).length, 0), 0);

/* ---------- analyse de la semaine ---------- */
const dayTotals = items => items.reduce((a,it) => { const g = it.g/100; a.kcal += it.k*g; a.p += it.p*g; a.c += it.c*g; a.l += it.l*g; return a; }, { kcal:0, p:0, c:0, l:0 });
function weekRecap(start){
  const days = Array.from({ length: 7 }, (_, i) => shift(start, i)), end = days[6];
  const done = sessions.map(s => ({ s, dates: sessionDates(s).filter(d => d >= start && d <= end) })).filter(x => x.dates.length);
  const recaps = done.flatMap(x => x.dates.map(d => sessionRecap(x.s, d)));
  const records = recaps.flatMap(r => r.rows.filter(x => x.status === "pr").map(x => ({ ...x, session: r.name, date: r.date })));
  const meals = days.map(d => ({ d, t: dayTotals((D.meals || {})[d] || []), n: ((D.meals || {})[d] || []).length })).filter(x => x.n);
  const avg = k => meals.length ? meals.reduce((a,x) => a + x.t[k], 0) / meals.length : null;
  const w = P.weightsAsc();
  const inWeek = w.filter(x => x.date >= start && x.date <= end), before = w.filter(x => x.date < start);
  const lastW = inWeek.length ? inWeek[inWeek.length - 1] : null, refW = before.length ? before[before.length - 1] : null;
  return { start, end, sessionsDone: recaps.length, sessionsPlanned: sessions.length, recaps, records,
    daysNoted: meals.length, kcalAvg: avg("kcal"), protAvg: avg("p"),
    daysKcalOk: meals.filter(x => x.t.kcal >= T.kcalMin).length, daysProtOk: meals.filter(x => x.t.p >= T.protMin).length,
    weight: lastW ? { kg: lastW.kg, date: lastW.date, delta: refW ? r1(lastW.kg - refW.kg) : null, refDate: refW && refW.date } : null };
}

/* ---------- contexte pour Gemini ---------- */
function context(){
  const pr = D.profile || {};
  const progTxt = prog.sessions.map(s => `${s.name} : ` + s.exercises.map(ex => {
    if(ex.kind === "stretch") return `${ex.name} (${ex.sets}×${ex.reps})`;
    const last = ex.loads[ex.loads.length - 1], best = ex.loads.length ? Math.max(...ex.loads.map(l => l.v)) : null;
    return `${ex.name} ${ex.sets}×${ex.reps}` + (last ? `, dernière ${fmtLoad(last.v)} kg${last.gym ? " (" + last.gym + ")" : ""}${last.date ? " le " + last.date : ""}, record ${fmtLoad(best)} kg` : "") +
      (ex.note ? `, note : « ${ex.note} »` : "") + (ex.alert ? `, ALERTE : « ${ex.alert} »` : "");
  }).join(" ; ")).join("\n");
  const w = P.weightsAsc().slice(-10).map(x => `${x.date} : ${x.kg} kg`).join(", ");
  const days = Array.from({ length: 7 }, (_, i) => shift(todayISO(), -i)).map(d => {
    const it = (D.meals || {})[d] || []; if(!it.length) return `${d} : rien noté`;
    const t = dayTotals(it); return `${d} : ${fmt(t.kcal)} kcal, P ${fmt(t.p)} g, G ${fmt(t.c)} g, L ${fmt(t.l)} g`;
  }).join("\n");
  const todayItems = ((D.meals || {})[todayISO()] || []).map(it => `${MEALS[it.m] || ""} : ${it.n} ${it.por ? "1 portion" : fmt(it.g) + " g"} (${fmt(it.k*it.g/100)} kcal, P ${dec(it.p*it.g/100)} g)`).join("\n");
  return `Date du jour : ${todayISO()}.
Profil : ${pr.name || "Thomas"}, ${pr.heightCm || "?"} cm, en prise de masse. Objectif : ${pr.goalLabel || pr.goalKg + " kg"}${pr.longGoalKg ? ", long terme " + pr.longGoalKg + " kg" : ""}.
Cibles nutrition : ${T.kcalMin}-${T.kcalMax} kcal/jour, protéines ${T.protMin} g, glucides ${T.carb || "?"} g, lipides ${T.fat || "?"} g par jour.
Il s'entraîne dans deux salles (Paris et Courbevoie) dont les machines ne sont pas calibrées pareil : ne compare pas une charge de Paris avec une de Courbevoie.
Programme actuel (${prog.title}, ${prog.subtitle || ""}) :
${progTxt}
Pesées récentes : ${w || "aucune"}.
Nutrition des 7 derniers jours :
${days}
${todayItems ? "Détail d'aujourd'hui :\n" + todayItems : ""}`;
}
const SYSTEM = () => `Tu es le coach personnel de musculation et de nutrition de Thomas, intégré à son appli de suivi. Tu parles français, tu le tutoies.
Règles :
- Tu t'appuies uniquement sur les données ci-dessous. Si une donnée manque (séance non notée, jour sans repas, pas de pesée), dis-le clairement au lieu d'inventer.
- Tu es direct et honnête : pas de flatterie, pas de félicitations creuses. Si quelque chose ne va pas (stagnation, calories trop basses, protéines insuffisantes), dis-le et explique le coût.
- Tu expliques les chiffres simplement, avec des phrases courtes, comme à quelqu'un qui n'est pas expert.
- Tu respectes les notes et les ALERTES des exercices (par exemple une consigne du kiné) : ne conseille jamais d'aller contre.
- Tu n'es pas médecin : en cas de douleur ou de blessure, renvoie vers un professionnel.
- Réponds en 150 mots maximum sauf si on te demande plus de détail. Pas de titres, pas de tableaux ; des listes courtes si utile.

Données de Thomas :
${context()}`;

async function askCoach(prompt){ return P.gemini({ system: SYSTEM(), parts: [{ text: prompt }], temperature: 0.5 }); }

/* ---------- rendu ---------- */
const lastDone = () => { let best = null; sessions.forEach(s => { const d = sessionDates(s).pop(); if(d && (!best || d > best.d)) best = { s, d }; }); return best; };
const ld = lastDone();
const state = { sess: ld ? ld.s.key : sessions[0].key, date: ld ? ld.d : null, week: monday(todayISO()), busy: null };

const STATUS = { pr: ["Record", "pr"], up: ["En hausse", "up"], same: ["Stable", "same"], down: ["En baisse", "down"], first: ["1re charge", "same"], none: ["Pas noté", "none"], na: ["Sans charge", "none"] };

function render(){
  root.innerHTML = `
  <section class="panel" aria-labelledby="h-sess"><div class="coach-h"><h2 id="h-sess">Récap de séance</h2></div><div id="sess"></div></section>
  <section class="panel section" aria-labelledby="h-week"><div class="coach-h"><h2 id="h-week">Bilan de la semaine</h2></div><div id="week"></div></section>
  <section class="panel section" aria-labelledby="h-chat"><div class="coach-h"><h2 id="h-chat">Parle à ton coach</h2>${D.coach.chat.length ? `<button class="btn ghost sm" data-act="clear">Effacer</button>` : ""}</div><div id="chat"></div></section>`;
  renderSess(); renderWeek(); renderChat();
}

function noteBlock(key, label){
  const n = D.coach.notes[key];
  if(state.busy === key) return `<div class="coach-note busy">Le coach analyse…</div>`;
  if(n) return `<div class="coach-note">${P.md(n.text)}<button class="icon-btn" data-ai="${esc(key)}">Redemander</button></div>`;
  return `<button class="btn ghost" data-ai="${esc(key)}">${label}</button>${P.gemCfg.key ? "" : `<p class="muted cal-hint">Nécessite la clé Gemini (<a href="reglages.html">Réglages</a>). Les chiffres au-dessus marchent sans.</p>`}`;
}

function renderSess(){
  const s = sessions.find(x => x.key === state.sess);
  const dates = sessionDates(s);
  if(!state.date || !dates.includes(state.date)) state.date = dates[dates.length - 1] || null;
  const i = dates.indexOf(state.date);
  let body;
  if(!state.date){
    body = `<p class="empty">Aucune charge datée sur ${esc(s.name)}. Dès que tu ajoutes une charge dans Programme, le récap apparaît ici.</p>`;
  } else {
    const r = sessionRecap(s, state.date);
    body = `<div class="coach-nav">
        <button class="icon-btn" data-sd="-1"${i <= 0 ? " disabled" : ""} aria-label="Séance précédente">‹</button>
        <b>${esc(fmtDate(state.date))}</b>
        <button class="icon-btn" data-sd="1"${i >= dates.length - 1 ? " disabled" : ""} aria-label="Séance suivante">›</button>
      </div>
      <div class="stats coach-stats">
        <div class="stat${r.pr ? " ok" : ""}"><b>${r.pr}</b><small>record${r.pr > 1 ? "s" : ""}</small></div>
        <div class="stat"><b>${r.up}</b><small>en hausse</small></div>
        <div class="stat"><b>${r.down}</b><small>en baisse</small></div>
        <div class="stat"><b>${r.logged}/${r.total}</b><small>exos notés</small></div>
      </div>
      <ul class="coach-rows">${r.rows.map(x => { const [lab, cls] = STATUS[x.status]; return `<li>
        <span><b>${esc(x.name)}</b><small class="muted">${esc(x.scheme)}${x.v != null && x.prev != null ? ` · avant ${fmtLoad(x.prev)} kg${x.prevDate ? " (" + fmtDateShort(x.prevDate) + ")" : ""}` : ""}${x.gym ? " · " + esc(x.gym) : ""}</small></span>
        <span class="coach-v">${x.v != null ? `${fmtLoad(x.v)} kg` : ""}</span><span class="tag ${cls}">${lab}</span></li>`; }).join("")}</ul>
      ${noteBlock(`s:${s.key}:${state.date}`, "Avis du coach sur cette séance")}`;
  }
  $("#sess").innerHTML = `<div class="seg" role="group" aria-label="Séance" style="margin:12px 0 14px">${sessions.map(x => `<button data-sess="${esc(x.key)}" aria-pressed="${x.key === state.sess}">${esc(x.name)}</button>`).join("")}</div>${body}
    ${undated() ? `<p class="muted cal-hint">${undated()} anciennes charges n'ont pas de date : elles comptent pour les records mais pas dans les récaps.</p>` : ""}`;
}

function renderWeek(){
  const w = weekRecap(state.week), isCur = state.week === monday(todayISO());
  const wt = w.weight;
  $("#week").innerHTML = `<div class="coach-nav" style="margin-top:12px">
      <button class="icon-btn" data-wk="-7" aria-label="Semaine précédente">‹</button>
      <b>${isCur ? "Cette semaine" : "Semaine du " + esc(fmtDateShort(w.start))}</b>
      <button class="icon-btn" data-wk="7"${isCur ? " disabled" : ""} aria-label="Semaine suivante">›</button>
    </div>
    <div class="stats coach-stats">
      <div class="stat${w.sessionsDone >= w.sessionsPlanned ? " ok" : ""}"><b>${w.sessionsDone}/${w.sessionsPlanned}</b><small>séances notées</small></div>
      <div class="stat${w.records.length ? " ok" : ""}"><b>${w.records.length}</b><small>record${w.records.length > 1 ? "s" : ""}</small></div>
      <div class="stat${w.kcalAvg != null && w.kcalAvg >= T.kcalMin ? " ok" : ""}"><b>${w.kcalAvg != null ? fmt(w.kcalAvg) : "—"}</b><small>kcal/jour · ${w.daysNoted} j notés</small></div>
      <div class="stat${w.protAvg != null && w.protAvg >= T.protMin ? " ok" : ""}"><b>${w.protAvg != null ? fmt(w.protAvg) + " g" : "—"}</b><small>protéines/jour</small></div>
      <div class="stat"><b>${wt ? dec(wt.kg) + " kg" : "—"}</b><small>${wt ? (wt.delta != null ? (wt.delta > 0 ? "+" : wt.delta < 0 ? "−" : "±") + dec(Math.abs(wt.delta)) + " kg depuis le " + fmtDateShort(wt.refDate) : "1re pesée") : "pas de pesée"}</small></div>
    </div>
    ${w.records.length ? `<div class="chips" style="margin:4px 0 14px">${w.records.map(x => `<span class="chip last">${esc(x.name)} ${fmtLoad(x.v)} kg</span>`).join("")}</div>` : ""}
    ${w.recaps.length || w.daysNoted ? noteBlock(`w:${w.start}`, "Bilan du coach") : `<p class="empty">Rien de noté cette semaine.</p>`}`;
}

const SUGG = ["Fais le bilan de ma semaine", "Qu'est-ce que je mange ce soir pour finir ma journée ?", "Sur quels exercices je stagne ?", "Explique-moi mes stats de poids"];
function renderChat(){
  const c = D.coach.chat;
  $("#chat").innerHTML = `<div class="chat-log" id="log">${c.length ? c.map(m => `<div class="msg ${m.r}">${m.r === "m" ? P.md(m.t) : esc(m.t)}</div>`).join("") : `<p class="muted" style="margin:0">Pose n'importe quelle question sur ton programme, tes charges, ta nutrition ou ton poids. Le coach voit tes vraies données.</p>`}
      ${state.busy === "chat" ? `<div class="msg m busy">…</div>` : ""}</div>
    <div class="chat-sugg">${SUGG.map(s => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    <form id="ask" class="chat-form"><textarea name="q" rows="1" placeholder="Ta question…" aria-label="Ta question"></textarea><button class="btn" type="submit"${state.busy === "chat" ? " disabled" : ""}>Envoyer</button></form>
    ${P.gemCfg.key ? "" : `<p class="muted cal-hint">Le chat nécessite la clé Gemini : <a href="reglages.html">l'ajouter dans Réglages</a>.</p>`}
    ${c.length ? `<p class="muted cal-hint">La conversation est sauvegardée avec tes données (PC + téléphone).</p>` : ""}`;
  const log = $("#log"); log.scrollTop = log.scrollHeight;
  const f = $("#ask");
  f.onsubmit = e => { e.preventDefault(); send(f.q.value); };
  f.q.onkeydown = e => { if(e.key === "Enter" && !e.shiftKey && matchMedia("(hover:hover)").matches){ e.preventDefault(); send(f.q.value); } };
  $$("[data-q]", $("#chat")).forEach(b => b.onclick = () => send(b.dataset.q));
}

async function send(q){
  q = (q || "").trim(); if(!q || state.busy === "chat") return;
  if(!P.gemCfg.key){ toast("Ajoute ta clé Gemini dans Réglages"); return; }
  const c = D.coach.chat;
  c.push({ r: "u", t: q, at: new Date().toISOString() });
  state.busy = "chat"; renderChat();
  try{
    const history = c.slice(-20).map(m => ({ role: m.r === "u" ? "user" : "model", parts: [{ text: m.t }] }));
    const t = await P.gemini({ system: SYSTEM(), history, temperature: 0.5 });
    c.push({ r: "m", t: t.trim(), at: new Date().toISOString() });
  }catch(err){ c.pop(); toast(err.message); state.busy = null; renderChat(); $("#ask").q.value = q; return; }
  if(c.length > 60) c.splice(0, c.length - 60);
  state.busy = null; P.save(); render();
  const log = $("#log"); log && log.lastElementChild && log.lastElementChild.scrollIntoView({ block: "nearest" });
}

async function aiNote(key){
  if(!P.gemCfg.key){ toast("Ajoute ta clé Gemini dans Réglages"); return; }
  let prompt;
  if(key.startsWith("s:")){
    const [, sk, date] = key.split(":"), r = sessionRecap(sessions.find(s => s.key === sk), date);
    prompt = `Fais le récap de ma ${r.name} du ${date}. Résultats calculés par l'appli (statut : pr = record battu, up = hausse vs séance précédente, down = baisse, same = stable, none = pas noté) :\n` +
      r.rows.map(x => `- ${x.name} (${x.scheme}) : ${x.v != null ? x.v + " kg" + (x.gym ? " à " + x.gym : "") : "pas de charge"}${x.prev != null ? ", avant " + x.prev + " kg" : ""}${x.best != null ? ", ancien record " + x.best + " kg" : ""}, statut ${x.status}${x.note ? ", ma note : « " + x.note + " »" : ""}`).join("\n") +
      `\nDis-moi en clair si c'est une bonne séance, ce qui a progressé, ce qui coince, et quoi viser la prochaine fois.`;
  } else {
    const w = weekRecap(key.slice(2));
    prompt = `Fais le bilan de ma semaine du ${w.start} au ${w.end}. Chiffres calculés par l'appli :
- Séances notées : ${w.sessionsDone} sur ${w.sessionsPlanned} prévues (${w.recaps.map(r => r.name + " le " + r.date + " : " + r.pr + " record(s), " + r.up + " hausse(s), " + r.down + " baisse(s)").join(" ; ") || "aucune"}).
- Records : ${w.records.map(x => x.name + " " + x.v + " kg").join(", ") || "aucun"}.
- Nutrition : ${w.daysNoted} jour(s) notés sur 7${w.kcalAvg != null ? `, moyenne ${fmt(w.kcalAvg)} kcal et ${fmt(w.protAvg)} g de protéines, objectif kcal atteint ${w.daysKcalOk} jour(s), protéines atteintes ${w.daysProtOk} jour(s)` : ""}.
- Poids : ${w.weight ? w.weight.kg + " kg le " + w.weight.date + (w.weight.delta != null ? ", soit " + w.weight.delta + " kg depuis le " + w.weight.refDate : "") : "pas de pesée cette semaine"}.
Dis-moi si la semaine est bonne pour ma prise de masse, le point le plus important à corriger, et la priorité pour la semaine prochaine.`;
  }
  state.busy = key; renderSess(); renderWeek();
  try{
    const t = await askCoach(prompt);
    D.coach.notes[key] = { text: t.trim(), at: new Date().toISOString() };
    const keys = Object.keys(D.coach.notes); if(keys.length > 40) keys.sort((a,b) => D.coach.notes[a].at.localeCompare(D.coach.notes[b].at)).slice(0, keys.length - 40).forEach(k => delete D.coach.notes[k]);
    P.save();
  }catch(err){ toast(err.message); }
  state.busy = null; renderSess(); renderWeek();
}

root.onclick = e => {
  const t = e.target.closest("button"); if(!t || t.disabled) return;
  if(t.dataset.sess){ state.sess = t.dataset.sess; state.date = null; renderSess(); }
  if(t.dataset.sd){ const s = sessions.find(x => x.key === state.sess), d = sessionDates(s), i = d.indexOf(state.date) + +t.dataset.sd; if(d[i]){ state.date = d[i]; renderSess(); } }
  if(t.dataset.wk){ state.week = shift(state.week, +t.dataset.wk); renderWeek(); }
  if(t.dataset.ai) aiNote(t.dataset.ai);
  if(t.dataset.act === "clear" && confirm("Effacer toute la conversation avec le coach ?")){ D.coach.chat = []; P.save("Conversation effacée"); render(); }
};

render();
})();
