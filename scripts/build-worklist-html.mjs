// Gera o painel HTML (Artifact) a partir de worklist.json.
//   node scripts/build-worklist-html.mjs <in.json> <out.html>
import { readFile, writeFile } from "node:fs/promises";

const [, , inPath, outPath] = process.argv;
const data = JSON.parse(await readFile(inPath, "utf8"));

const REC = {
  email: { label: "E-mail", key: "email" },
  ig_dm: { label: "Instagram DM", key: "ig" },
  whatsapp_manual: { label: "WhatsApp", key: "wa" },
  call: { label: "Ligação", key: "call" },
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const phoneDisplay = (p) => {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
};

// enriquece cada row com dados de apresentação
const rows = data.rows.map((r, i) => {
  const rec = REC[r.recommended] ?? { label: r.recommended, key: "call" };
  // mensagem principal = a que casa com o canal recomendado; senão a 1ª
  const prefCh = r.recommended === "whatsapp_manual" ? "email" : (r.recommended === "call" ? "call" : (r.recommended === "ig_dm" ? "ig_dm" : "email"));
  const primary = r.messages.find((m) => m.channel === prefCh) ?? r.messages[0];
  const others = r.messages.filter((m) => m !== primary);
  return { ...r, idx: i, recKey: rec.key, recLabel: rec.label, primary, others };
});

const counts = { email: 0, ig: 0, wa: 0, call: 0 };
for (const r of rows) counts[r.recKey]++;

const cardHtml = (r) => {
  const contacts = [];
  const waPhone = r.phone ? r.phone.replace(/\D/g, "") : null;
  if (r.phone) {
    contacts.push(`<a class="chip chip-wa" href="https://wa.me/${waPhone}" target="_blank" rel="noopener" title="Abrir no WhatsApp">WhatsApp · ${esc(phoneDisplay(r.phone))}</a>`);
    contacts.push(`<a class="chip" href="tel:+${waPhone}" title="Ligar">Ligar</a>`);
  }
  if (r.instagram) contacts.push(`<a class="chip chip-ig" href="https://instagram.com/${esc(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>`);
  if (r.email) contacts.push(`<a class="chip chip-em" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(r.primary?.subject ?? "")}&body=${encodeURIComponent(r.primary?.body ?? "")}">${esc(r.email)}</a>`);
  if (r.website) contacts.push(`<a class="chip chip-web" href="${esc(r.website)}" target="_blank" rel="noopener">site</a>`);

  const note = r.recommended === "whatsapp_manual"
    ? `<p class="note">O e-mail cadastrado é pessoal/inválido — envie por <b>WhatsApp</b>. O texto abaixo (rascunho de e-mail) serve de base; encurte para o tom de zap.</p>`
    : "";

  const msgBlock = (m, isPrimary) => {
    const full = (m.subject ? "Assunto: " + m.subject + "\n\n" : "") + m.body;
    const id = `msg-${r.idx}-${m.channel}`;
    return `<div class="msg${isPrimary ? " msg-primary" : ""}">
      <div class="msg-head">
        <span class="msg-ch ch-${m.channel}">${esc(m.channelLabel)}${isPrimary ? " · recomendado" : ""}</span>
        <button class="copy" data-target="${id}">Copiar</button>
      </div>
      ${m.subject ? `<div class="subj">${esc(m.subject)}</div>` : ""}
      <pre class="body" id="${id}">${esc(m.body)}</pre>
    </div>`;
  };

  return `<article class="card" data-rec="${r.recKey}" data-search="${esc((r.clinic + " " + r.city).toLowerCase())}">
    <header class="card-top">
      <div class="rec rec-${r.recKey}">${esc(r.recLabel)}</div>
      <div class="titlewrap">
        <h3>${esc(r.clinic)}</h3>
        <span class="loc">${esc(r.city)}/${esc(r.uf)}</span>
      </div>
    </header>
    <p class="why">${esc(r.recommendedReason)}</p>
    <div class="chips">${contacts.join("")}</div>
    ${note}
    ${msgBlock(r.primary, true)}
    ${r.others.map((m) => msgBlock(m, false)).join("")}
  </article>`;
};

const html = `<title>Worklist Comercial — Sysmax Software</title>
<style>
  :root{
    --bg:#F5F7F6; --surface:#FFFFFF; --surface-2:#F0F3F1; --ink:#141F1B; --muted:#5A6A63;
    --border:#E1E7E3; --accent:#0E7C66; --accent-ink:#0A5A4A;
    --email:#4F46E5; --ig:#D6336C; --wa:#12925A; --call:#B45309;
    --email-bg:#EEF0FE; --ig-bg:#FDECF3; --wa-bg:#E6F5EC; --call-bg:#FBF0E1;
    --shadow:0 1px 2px rgba(20,31,27,.04),0 4px 16px rgba(20,31,27,.05);
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0D1512; --surface:#151F1B; --surface-2:#1B2723; --ink:#E7EFEB; --muted:#93A69D;
    --border:#27332E; --accent:#2DD4BF; --accent-ink:#5EEAD4;
    --email:#8B93FF; --ig:#F472A6; --wa:#4FCB86; --call:#E0A45C;
    --email-bg:#1D2140; --ig-bg:#33202B; --wa-bg:#172B22; --call-bg:#2E2416;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 4px 18px rgba(0,0,0,.35);
  }}
  :root[data-theme="light"]{
    --bg:#F5F7F6; --surface:#FFFFFF; --surface-2:#F0F3F1; --ink:#141F1B; --muted:#5A6A63;
    --border:#E1E7E3; --accent:#0E7C66; --accent-ink:#0A5A4A;
    --email:#4F46E5; --ig:#D6336C; --wa:#12925A; --call:#B45309;
    --email-bg:#EEF0FE; --ig-bg:#FDECF3; --wa-bg:#E6F5EC; --call-bg:#FBF0E1;
  }
  :root[data-theme="dark"]{
    --bg:#0D1512; --surface:#151F1B; --surface-2:#1B2723; --ink:#E7EFEB; --muted:#93A69D;
    --border:#27332E; --accent:#2DD4BF; --accent-ink:#5EEAD4;
    --email:#8B93FF; --ig:#F472A6; --wa:#4FCB86; --call:#E0A45C;
    --email-bg:#1D2140; --ig-bg:#33202B; --wa-bg:#172B22; --call-bg:#2E2416;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
  .tnum{font-variant-numeric:tabular-nums}

  header.top{margin-bottom:22px}
  .eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink);font-weight:700}
  h1{font-size:clamp(24px,4vw,34px);margin:.15em 0 .1em;letter-spacing:-.02em;text-wrap:balance}
  .sub{color:var(--muted);font-size:15px;max-width:70ch}

  .kpis{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 8px}
  .kpi{flex:1 1 130px;background:var(--surface);border:1px solid var(--border);border-radius:12px;
    padding:12px 14px;box-shadow:var(--shadow);cursor:pointer;transition:transform .12s,border-color .12s}
  .kpi:hover{transform:translateY(-1px)}
  .kpi.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
  .kpi .n{font-size:26px;font-weight:750;line-height:1}
  .kpi .l{font-size:12.5px;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:6px}
  .dot{width:9px;height:9px;border-radius:50%;display:inline-block}
  .dot.email{background:var(--email)} .dot.ig{background:var(--ig)}
  .dot.wa{background:var(--wa)} .dot.call{background:var(--call)}

  .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0 22px}
  .search{flex:1 1 240px;min-width:180px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;
    background:var(--surface);color:var(--ink);font-size:14px}
  .search:focus{outline:2px solid var(--accent);outline-offset:1px}
  .allbtn{padding:9px 14px;border:1px solid var(--border);background:var(--surface);color:var(--ink);
    border-radius:10px;font-size:13px;font-weight:600;cursor:pointer}
  .allbtn.active{border-color:var(--accent);color:var(--accent-ink)}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px 18px 16px;
    box-shadow:var(--shadow);display:flex;flex-direction:column;gap:11px}
  .card-top{display:flex;flex-direction:column;gap:8px}
  .rec{align-self:flex-start;font-size:11.5px;font-weight:750;letter-spacing:.03em;text-transform:uppercase;
    padding:4px 10px;border-radius:999px}
  .rec-email{background:var(--email-bg);color:var(--email)}
  .rec-ig{background:var(--ig-bg);color:var(--ig)}
  .rec-wa{background:var(--wa-bg);color:var(--wa)}
  .rec-call{background:var(--call-bg);color:var(--call)}
  .titlewrap{display:flex;flex-direction:column;gap:2px}
  h3{margin:0;font-size:16.5px;line-height:1.25;letter-spacing:-.01em;text-wrap:balance}
  .loc{font-size:12.5px;color:var(--muted);font-weight:600}
  .why{margin:0;font-size:13px;color:var(--muted)}

  .chips{display:flex;flex-wrap:wrap;gap:7px}
  .chip{font-size:12.5px;text-decoration:none;color:var(--ink);background:var(--surface-2);
    border:1px solid var(--border);padding:5px 10px;border-radius:8px;font-weight:600;white-space:nowrap}
  .chip:hover{border-color:var(--accent)}
  .chip-wa{color:var(--wa)} .chip-ig{color:var(--ig)} .chip-em{color:var(--email)}
  .chip-web{color:var(--muted);font-weight:500}

  .note{margin:0;font-size:12.5px;background:var(--call-bg);color:var(--call);border-radius:8px;padding:8px 10px}
  .note b{font-weight:750}

  .msg{border:1px solid var(--border);border-radius:11px;overflow:hidden;background:var(--surface)}
  .msg-primary{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
  .msg-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-2)}
  .msg-ch{font-size:11.5px;font-weight:700;letter-spacing:.02em}
  .ch-email{color:var(--email)} .ch-ig_dm{color:var(--ig)} .ch-call{color:var(--call)} .ch-whatsapp{color:var(--wa)}
  .copy{font-size:12px;font-weight:650;border:1px solid var(--border);background:var(--surface);color:var(--ink);
    padding:4px 12px;border-radius:7px;cursor:pointer}
  .copy:hover{border-color:var(--accent);color:var(--accent-ink)}
  .copy.done{background:var(--accent);color:#fff;border-color:var(--accent)}
  .subj{font-size:13px;font-weight:700;padding:9px 12px 0}
  .body{margin:0;padding:10px 12px 13px;white-space:pre-wrap;font-family:inherit;font-size:13px;
    color:var(--ink);line-height:1.5}

  .empty{grid-column:1/-1;text-align:center;color:var(--muted);padding:40px}
  footer{margin-top:34px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);padding-top:16px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header class="top">
    <div class="eyebrow">Sysmax Software · Esteira Comercial</div>
    <h1>Prospectos prontos para abordar</h1>
    <p class="sub">${rows.length} clínicas veterinárias com mensagem já redigida, cada uma no canal com maior chance de resposta. Clique num contato para abrir o canal; use <b>Copiar</b> para levar a mensagem. Selecionadas de 404 clínicas mapeadas em 17 cidades.</p>
  </header>

  <div class="kpis">
    <div class="kpi" data-filter="all"><div class="n tnum">${rows.length}</div><div class="l">Todas prontas</div></div>
    <div class="kpi" data-filter="email"><div class="n tnum">${counts.email}</div><div class="l"><span class="dot email"></span>E-mail</div></div>
    <div class="kpi" data-filter="ig"><div class="n tnum">${counts.ig}</div><div class="l"><span class="dot ig"></span>Instagram DM</div></div>
    <div class="kpi" data-filter="wa"><div class="n tnum">${counts.wa}</div><div class="l"><span class="dot wa"></span>WhatsApp</div></div>
    <div class="kpi" data-filter="call"><div class="n tnum">${counts.call}</div><div class="l"><span class="dot call"></span>Ligação</div></div>
  </div>

  <div class="toolbar">
    <input class="search" type="search" placeholder="Buscar clínica ou cidade…" aria-label="Buscar">
    <button class="allbtn active" data-filter="all">Ver todas</button>
  </div>

  <div class="grid" id="grid">
    ${rows.map(cardHtml).join("\n")}
    <p class="empty" id="empty" hidden>Nenhuma clínica com esse filtro.</p>
  </div>

  <footer>
    Canal recomendado por heurística de alcance B2B: e-mail corporativo válido &rarr; e-mail frio; sem e-mail mas ativa no Instagram &rarr; DM; e-mail pessoal/telefone-só &rarr; WhatsApp ou ligação. Todo disparo passa pela sua aprovação — nada é enviado automaticamente. Gerado a partir do CRM <span class="tnum">sysmax-sales-agent</span>.
  </footer>
</div>

<script>
  const grid=document.getElementById('grid');
  const cards=[...grid.querySelectorAll('.card')];
  const empty=document.getElementById('empty');
  const search=document.querySelector('.search');
  let filter='all';

  function apply(){
    const q=search.value.trim().toLowerCase();
    let shown=0;
    for(const c of cards){
      const okF=filter==='all'||c.dataset.rec===filter;
      const okQ=!q||c.dataset.search.includes(q);
      const vis=okF&&okQ;
      c.style.display=vis?'':'none';
      if(vis)shown++;
    }
    empty.hidden=shown>0;
  }
  function setFilter(f){
    filter=f;
    document.querySelectorAll('.kpi').forEach(k=>k.classList.toggle('active',k.dataset.filter===f&&f!=='all'));
    document.querySelectorAll('.allbtn').forEach(b=>b.classList.toggle('active',f==='all'));
    apply();
  }
  document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>setFilter(el.dataset.filter)));
  search.addEventListener('input',apply);

  grid.addEventListener('click',async e=>{
    const btn=e.target.closest('.copy'); if(!btn)return;
    const el=document.getElementById(btn.dataset.target); if(!el)return;
    try{await navigator.clipboard.writeText(el.textContent);}catch{
      const r=document.createRange();r.selectNode(el);const s=getSelection();s.removeAllRanges();s.addRange(r);
      try{document.execCommand('copy');}catch{} s.removeAllRanges();
    }
    const old=btn.textContent;btn.textContent='Copiado ✓';btn.classList.add('done');
    setTimeout(()=>{btn.textContent=old;btn.classList.remove('done');},1400);
  });
</script>`;

await writeFile(outPath, html, "utf8");
console.log("OK ->", outPath, "(", html.length, "bytes )");
