/* Graphique de poids (Chart.js, axe temporel linéaire sans adaptateur) */
window.weightChart = function(canvas, entries, opts={}){
  const { fmtKg, fmtDate, rollingAvg } = window.PDM;
  const pts = entries.map(w => ({ x: new Date(w.date + "T12:00:00").getTime(), y: w.kg, d: w.date, n: w.note }));
  const avg = rollingAvg(entries, 4);
  const datasets = [{
    label: "Poids", data: pts, borderColor: "#FF8A1F", backgroundColor: c => { const {ctx, chartArea} = c.chart; if(!chartArea) return "rgba(255,138,31,.12)";
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); g.addColorStop(0,"rgba(255,138,31,.35)"); g.addColorStop(1,"rgba(255,138,31,0)"); return g; },
    pointBackgroundColor: "#FFB24D", pointBorderColor: "#0C1126", pointBorderWidth: 2,
    pointRadius: entries.length > 40 ? 2 : 4, pointHoverRadius: 7, borderWidth: 3, tension: .32, fill: true
  }];
  if(opts.avg !== false) datasets.push({
    label: "Moyenne 4 pesées", data: pts.map((p,i) => ({ x: p.x, y: avg[i] })), borderColor: "#4DBA74",
    borderDash: [6,5], borderWidth: 2, pointRadius: 0, tension: .3, fill: false
  });
  if(opts.goal) datasets.push({
    label: "Objectif " + fmtKg(opts.goal) + " kg", data: pts.length ? [{x: pts[0].x, y: opts.goal}, {x: pts[pts.length-1].x, y: opts.goal}] : [],
    borderColor: "rgba(241,227,198,.55)", borderDash: [2,4], borderWidth: 1.5, pointRadius: 0, fill: false
  });
  const MONTHS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
  const ys = entries.map(w => w.kg).concat(opts.goal && opts.showGoalInRange ? [opts.goal] : []);
  return new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: window.FX && FX.RM ? 0 : 1100, easing: "easeOutQuart" },
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      scales: {
        x: { type: "linear", grid: { color: "rgba(255,236,200,.07)" }, ticks: { color: "#A3ABC6", maxTicksLimit: 7,
             callback: v => { const d = new Date(v); return d.getDate() + " " + MONTHS[d.getMonth()]; } } },
        y: { grid: { color: "rgba(255,236,200,.07)" }, ticks: { color: "#A3ABC6", callback: v => fmtKg(v) },
             suggestedMin: Math.floor(Math.min(...ys) - .5), suggestedMax: Math.ceil(Math.max(...ys) + .5) }
      },
      plugins: {
        legend: { labels: { color: "#F1EEE6", font: { family: "Zen Kaku Gothic New", weight: "700" }, boxWidth: 14, usePointStyle: true } },
        tooltip: {
          backgroundColor: "#F3E6C9", titleColor: "#231C14", bodyColor: "#231C14", padding: 12, cornerRadius: 12, titleFont: { family: "Dela Gothic One", weight: "400" }, bodyFont: { family: "Zen Kaku Gothic New", weight: "700" }, displayColors: false,
          filter: i => i.datasetIndex === 0,
          callbacks: {
            title: items => fmtDate(items[0].raw.d),
            label: i => fmtKg(i.raw.y) + " kg",
            afterLabel: i => { const n = i.raw.n || ""; return n.length > 70 ? n.slice(0,70) + "…" : n; }
          }
        }
      }
    }
  });
};
