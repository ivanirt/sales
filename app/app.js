const KEY = "funnel-coach-v1";

const STAGES = [
  { id: "cold", label: "Cold contacts", hint: "Names who can pay" },
  { id: "email", label: "Email", hint: "Send the note" },
  { id: "call", label: "Calls", hint: "Have the conversation" },
  { id: "prospect", label: "Prospects", hint: "Pain, money, decision" },
  { id: "next", label: "Next steps", hint: "A time on the calendar" },
  { id: "offer", label: "Offers", hint: "What they buy" },
  { id: "close", label: "Close", hint: "Ask for the decision" },
  { id: "sale", label: "Sale", hint: "Cash and a start" },
  { id: "retain", label: "Retain", hint: "They keep paying" },
  { id: "revenue", label: "Revenue", hint: "Make each buyer worth more" },
];

const TONES = ["#1e3b33", "#234438", "#284c3e", "#2e5646", "#365f4c", "#3f6a56", "#4e7358", "#6a6244", "#7a4e32", "#8a3b22"];

const PLAYS = {
  "B2B SaaS": {
    avatar: "software companies that already have users and a leaky first win",
    outcome: "the first value moment live for new users within 14 days",
    guarantee: "If it is not live in 14 days, we keep working at our cost until it is.",
    subject: "activation in 14 days",
    list: "Users who signed up and never reached the first win. One list.",
    upsell: "annual plan or a done-with-you onboarding week",
    continuity: "an annual plan, with monthly left expensive",
  },
  "Agency / services": {
    avatar: "owners who sell a service and live on referrals",
    outcome: "20 qualified sales conversations in 60 days",
    guarantee: "If you do the outreach and we miss 20 conversations, the next month is free.",
    subject: "20 sales conversations",
    list: "Companies that already buy this kind of service and showed the pain in the last quarter.",
    upsell: "a monthly retainer after the sprint",
    continuity: "a monthly retainer to keep the calendar full",
  },
  "Home services": {
    avatar: "home-service owners with crews and uneven weeks",
    outcome: "a booked crew for the next 14 days",
    guarantee: "If the calendar is not full for 14 days after the offer is installed, we run it again free.",
    subject: "a full crew calendar",
    list: "Past customers quiet for 6 months, plus one neighborhood.",
    upsell: "a maintenance membership",
    continuity: "a maintenance plan billed monthly",
  },
  "Professional services": {
    avatar: "firms that trade hours and want fewer, better clients",
    outcome: "a higher-priced engagement paid before the work starts",
    guarantee: "If the new offer does not close one client in 30 days of real conversations, we rebuild it with you.",
    subject: "higher fees, paid up front",
    list: "Past clients who got a result, and the referrals they can name.",
    upsell: "a quarterly advisory seat",
    continuity: "quarterly advisory instead of one-off projects",
  },
  Ecommerce: {
    avatar: "stores with buyers and no reliable second purchase",
    outcome: "a first order that pays for the next customer's ads within 30 days",
    guarantee: "If 30-day gross profit does not cover ad cost after the offer change, we redo the offer.",
    subject: "ads that pay back in 30 days",
    list: "Buyers from the last 90 days who never bought again.",
    upsell: "a refill or bundle on the thank-you page",
    continuity: "a replenishment subscription",
  },
  "Health & fitness": {
    avatar: "gyms and clinics with empty prime-time slots",
    outcome: "clients who pay up front and show up",
    guarantee: "Hit the attendance rules and the result, and the start fee credits toward the membership.",
    subject: "full prime-time hours",
    list: "Leads from the last 90 days who did not join, and members who froze.",
    upsell: "membership, sold at the first win",
    continuity: "membership after the challenge, not after they disappear",
  },
  "Real estate": {
    avatar: "agents who talk to many people and list few",
    outcome: "a listing appointment with a seller who can sign this month",
    guarantee: "Follow the script for 30 appointments with no listing, and we rebuild the offer.",
    subject: "a listing conversation",
    list: "One neighborhood you already know. Not the whole city.",
    upsell: "a 90-day past-client review",
    continuity: "a past-client check-in every 90 days",
  },
  Other: {
    avatar: "buyers who already spend money on this problem",
    outcome: "a named result on a named date",
    guarantee: "If they do the work and miss the result, you keep working until they hit it or you refund.",
    subject: "a result with a date",
    list: "People who already tried to solve this and can pay. One source.",
    upsell: "the next problem the first purchase creates",
    continuity: "a reason to pay again before the first result goes cold",
  },
};

let state = blank();
let jump = false;
let toast = "";
let meta = { id: "", projects: [], hasKey: false, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", paths: { user: "memory/USER.md", project: "" } };
let userMemory = { entries: [], pct: "0% — 0/1,375 chars", usage: "0/1,375" };
let projectMemory = { entries: [], pct: "0% — 0/2,200 chars", usage: "0/2,200" };
let ai = { line: "", stage: "", cta: "" };
let thinking = false;
let showSettings = false;
let showMemory = false;
let settingsDraft = { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" };
let thinkGen = 0;
let saveTimer = 0;
let thinkTimer = 0;

document.addEventListener("click", onClick);
document.addEventListener("change", onChange);
document.addEventListener("submit", onSubmit);
document.addEventListener("input", onInput);
boot();

function blank() {
  return {
    companyName: "",
    goal: "",
    description: "",
    context: "",
    industry: "",
    employees: "",
    revenue: "",
    status: "",
    selected: "cold",
    offer: { outcome: "", price: "", guarantee: "", sentence: "" },
    math: { cash30: "", cost30: "", spend: "", customers: "" },
    deals: [],
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved) return blank();
    return { ...blank(), ...saved, offer: { ...blank().offer, ...(saved.offer || {}) }, math: { ...blank().math, ...(saved.math || {}) }, deals: saved.deals || [] };
  } catch {
    return blank();
  }
}

function save(options = { think: true }) {
  scheduleSave();
  if (options.think) scheduleThink();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persistNow().catch(() => flash("Could not save this project.")); }, 250);
}

async function persistNow() {
  if (!meta.id) return;
  clearTimeout(saveTimer);
  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: meta.id, state }),
  });
  if (!response.ok) throw new Error("save failed");
}

function scheduleThink() {
  if (!meta.hasKey) return;
  const gen = ++thinkGen;
  clearTimeout(thinkTimer);
  thinkTimer = setTimeout(() => { runThink(gen, "").catch(() => {}); }, 1200);
}

async function runThink(gen, note) {
  thinking = true;
  render();
  await persistNow();
  const response = await fetch("/api/think", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const data = await response.json().catch(() => ({}));
  if (gen !== thinkGen) return;
  thinking = false;
  if (!response.ok) {
    flash(data.error || "The coach could not think.");
    render();
    return;
  }
  applyThink(data);
}

function applyThink(data) {
  if (data.line) ai = { line: data.line, stage: data.stage || "cold", cta: data.cta || "Do this" };
  if (data.user) userMemory = data.user;
  if (data.memory) projectMemory = data.memory;
  if (data.learned && data.learned.length) flash("Saved to memory. The next think uses it.");
  else if (data.errors && data.errors.length) flash(data.errors[0]);
  render();
}

function applyBootstrap(data) {
  meta.id = data.active;
  meta.projects = data.projects || [];
  meta.hasKey = Boolean(data.settings && data.settings.hasKey);
  meta.baseUrl = (data.settings && data.settings.baseUrl) || meta.baseUrl;
  meta.model = (data.settings && data.settings.model) || meta.model;
  meta.paths = data.paths || meta.paths;
  settingsDraft.baseUrl = meta.baseUrl;
  settingsDraft.model = meta.model;
  userMemory = data.user || userMemory;
  projectMemory = data.memory || projectMemory;
  state = { ...blank(), ...(data.state || {}), offer: { ...blank().offer, ...((data.state || {}).offer || {}) }, math: { ...blank().math, ...((data.state || {}).math || {}) }, deals: (data.state || {}).deals || [] };
  ai = { line: "", stage: "", cta: "" };
}

async function boot() {
  document.getElementById("app").innerHTML = `<p class="sub" style="padding:28px">Loading the funnel…</p>`;
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error("offline");
    const data = await response.json();
    applyBootstrap(data);
    await adoptLegacy();
    render();
    scheduleThink();
  } catch {
    document.getElementById("app").innerHTML = `<main style="padding:28px;max-width:640px"><h1>Funnel</h1><p>Start the local server, then open <strong>http://127.0.0.1:8765</strong>. That is what writes the memory files and keeps the AI key on this machine.</p><pre>python server.py</pre></main>`;
  }
}

async function adoptLegacy() {
  const legacy = localStorage.getItem(KEY);
  if (!legacy) return;
  const empty = !state.companyName && !state.industry && state.deals.length === 0;
  if (!empty) {
    localStorage.removeItem(KEY);
    return;
  }
  try {
    const saved = JSON.parse(legacy);
    state = { ...blank(), ...saved, offer: { ...blank().offer, ...(saved.offer || {}) }, math: { ...blank().math, ...(saved.math || {}) }, deals: saved.deals || [] };
    await persistNow();
    localStorage.removeItem(KEY);
  } catch { /* keep the server board */ }
}

function isSettingsField(target) {
  return Boolean(target.closest && target.closest("#settings"));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function play() {
  return PLAYS[state.industry] || PLAYS.Other;
}

function ready() {
  return Boolean(state.industry && state.employees && state.revenue && state.status);
}

function gap() {
  return ["industry", "employees", "revenue", "status"].find((id) => !state[id]) || null;
}

function counts() {
  const map = Object.fromEntries(STAGES.map((stage) => [stage.id, 0]));
  state.deals.forEach((deal) => { if (map[deal.stage] !== undefined) map[deal.stage] += 1; });
  return map;
}

function nextId(id) {
  const index = STAGES.findIndex((stage) => stage.id === id);
  return STAGES[index + 1] ? STAGES[index + 1].id : null;
}

function prevId(id) {
  const index = STAGES.findIndex((stage) => stage.id === id);
  return index > 0 ? STAGES[index - 1].id : null;
}

function moneyCue() {
  if (state.revenue === "Pre-revenue" || state.revenue === "Under $250k") return "Cash in the first 30 days beats a fancy pipeline.";
  if (state.revenue === "$5M-$10M" || state.revenue === "$10M+") return "At this revenue, a cheap buyer who leaves is the leak.";
  return "";
}

function priceFor() {
  if (state.status === "Just starting") return "$2,000 for the first five buyers, then it doubles";
  if (state.employees === "Just me" && ["$1M-$5M", "$5M-$10M", "$10M+"].includes(state.revenue)) {
    return "$20,000, founder-delivered, a few clients at a time";
  }
  const table = {
    "Pre-revenue": "$2,500 before kickoff",
    "Under $250k": "$3,500 before kickoff",
    "$250k-$1M": "$8,000 before kickoff",
    "$1M-$5M": "$18,000",
    "$5M-$10M": "$36,000",
    "$10M+": "$60,000, or a share of the measured gain with a floor",
  };
  return table[state.revenue] || "$5,000 before kickoff";
}

function draftOffer() {
  const item = play();
  const price = priceFor();
  return {
    outcome: item.outcome,
    price,
    guarantee: item.guarantee,
    sentence: `${cap(item.outcome)}. ${price}. ${item.guarantee}`,
  };
}

function cap(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mathOf() {
  const cash = num(state.math.cash30);
  const cost = num(state.math.cost30);
  const spend = num(state.math.spend);
  const customers = num(state.math.customers);
  if ([cash, cost, spend, customers].some((value) => value === null)) return { ready: false };
  if (customers <= 0) return { ready: false, badCustomers: true };
  const gp = cash - cost;
  const cac = spend / customers;
  let level = 1;
  if (cac === 0 ? gp > 0 : gp >= cac * 2) level = 3;
  else if (gp >= cac) level = 2;
  return { ready: true, gp, cac, level, freeAcquire: cac === 0 };
}

function money(value) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function sizeLine() {
  const lines = {
    "Just me": "I do the work myself, with a few clients at a time.",
    "2-10": "A small team delivers. I still take the sales calls.",
    "11-50": "We open a limited number of new customers each month.",
    "51-200": "One owner runs this. We are not taking everyone.",
    "200+": "A few slots. The work has to be worth the team's time.",
  };
  return lines[state.employees] || "";
}

function coach() {
  if (!ready()) {
    return {
      stage: "cold",
      focus: gap(),
      cta: "Set the company",
      line: "Tell me the industry, headcount, revenue, and whether you are starting, growing, stuck, or scaling. I will not guess a next step for a company I cannot see.",
    };
  }
  const item = play();
  const cue = moneyCue();
  if (!state.offer.sentence.trim()) {
    return {
      stage: "offer",
      cta: "Write the offer",
      line: `You sell to ${item.avatar}, and there is no one-sentence offer yet. Write it before anyone gets an email. ${cue}`.trim(),
    };
  }
  const tally = counts();
  const customers = tally.sale + tally.retain + tally.revenue;
  const math = mathOf();
  const small = state.employees === "Just me" || state.employees === "2-10";

  if (state.status === "Stuck") {
    if (customers === 0) {
      return { stage: "offer", cta: "Rebuild the offer", line: `Stuck, and nobody has paid. That is the offer, not the ads. Rewrite it for ${item.avatar}. ${cue}`.trim() };
    }
    if (math.ready && math.level === 3) {
      return { stage: "retain", cta: "Fix retention", line: "The 30-day math works and you are still stuck. They are leaving, or the cheap buyers are clogging the list. Sell continuity at the first win." };
    }
    return { stage: "revenue", cta: "Do the math", line: `You already sell and you are stuck. Each buyer is worth too little, or the cash comes back too slow. Fill the 30-day numbers before you buy another lead. ${cue}`.trim() };
  }

  if (state.status === "Scaling" && small && (!math.ready || math.level < 3)) {
    return { stage: "revenue", cta: "Check payback", line: "Scaling with almost no team breaks delivery. Get 30-day gross profit to at least double what you pay to get a customer before you add more names." };
  }

  const pipeline = ["cold", "email", "call", "prospect", "next", "offer", "close"];
  for (const id of pipeline) {
    if (tally[id] > 0) {
      return { stage: id, cta: "Do this step", line: `${pushLine(id, tally[id])} ${cue}`.trim() };
    }
  }
  if (tally.sale > 0) {
    return { stage: "sale", cta: "Start delivery", line: "They said yes. Collect cash and start inside 48 hours. Then offer " + item.upsell + " before you leave the conversation." };
  }
  if (tally.retain > 0 || tally.revenue > 0) {
    return { stage: "revenue", cta: "Raise the value", line: `They stayed. Sell ${item.continuity}. Do not start a second funnel. ${cue}`.trim() };
  }
  return { stage: "cold", cta: "Add 10 names", line: coldOpen() + " " + cue };
}

function coldOpen() {
  const item = play();
  if (state.employees === "Just me" || state.status === "Just starting") {
    return `You are the sales team. Add 10 ${item.avatar} from one list: ${item.list} No deck. No hire.`;
  }
  if (state.employees === "51-200" || state.employees === "200+") {
    return `Same rule at your size. One person owns the list of ${item.avatar}. ${item.list}`;
  }
  return `Add 10 ${item.avatar}. ${item.list}`;
}

function pushLine(id, count) {
  const noun = count === 1 ? "person is" : "people are";
  const lines = {
    cold: `${count} ${noun} sitting in cold. Send the email today. Do not research them for an hour.`,
    email: `${count} ${noun} in email. Call anyone who replied. If two days pass in silence, call anyway.`,
    call: `${count} ${noun} on calls. Qualify pain, money, and who decides. Miss two, and they are not a prospect.`,
    prospect: `${count} ${noun} qualified. Book a time before you hang up. No time means they are still a stranger.`,
    next: `${count} ${noun} booked. Say the price and the guarantee out loud. Do not "circle back."`,
    offer: `${count} ${noun} holding the offer. Ask for the decision.`,
    close: `${count} ${noun} at yes or no. Split the payment or remove a feature. Do not discount the same offer.`,
  };
  return lines[id];
}

function bullets(id) {
  if (!ready()) return ["Set industry, headcount, revenue, and status. The words below change with them."];
  const item = play();
  const map = {
    cold: [
      item.list,
      state.employees === "Just me" ? "You add the names. Do not delegate a list you have not proven." : "One owner adds the names and is accountable for the count.",
      "Write why they can pay. If you cannot, they do not go on the list.",
    ],
    email: [
      "Send the note below. Change the first line so it sounds like you.",
      "Ten sends beat a better template.",
      "Log who you sent. Move them here when the email is actually out.",
    ],
    call: [
      state.status === "Stuck" ? "Do not pitch a new channel. Ask what they already pay for that is not working." : state.status === "Scaling" ? "Ask what breaks if they double. Sell the fix for that." : "Ask why this conversation is happening now.",
      "Repeat their problem in one sentence, then stop.",
      "Book the next step on the call, or take the no.",
    ],
    prospect: [
      "They need a painful problem, money, and a person who can say yes.",
      item.qualify || "If two of the three are missing, move them back.",
      "A maybe without a date is a no. Treat it that way.",
    ],
    next: [
      "Every name here has a day and a time.",
      "Send the one-pager the same day.",
      "If they miss it, one reschedule. Then drop them.",
    ],
    offer: [
      "One result, a price, and a guarantee you can pay.",
      state.status === "Just starting" ? "Sell this before you add people or a second product." : "Do not add a second offer while this one is unsent.",
      "Read the sentence to a real buyer this week.",
    ],
    close: [
      "Say the price. Then wait.",
      "Too expensive: payment plan, or remove a feature. Never a quiet discount.",
      "\"I need to think\" means ask whether it is the result, the fit, or the money.",
    ],
    sale: [
      "Collect what is due today and name the start date.",
      `Before you hang up, offer ${item.upsell}.`,
      "Start delivery inside 48 hours.",
    ],
    retain: [
      `At the first win, sell ${item.continuity}.`,
      "Month-to-month pays a real setup fee. A longer commit waives it.",
      "Book the next check-in before the call ends.",
    ],
    revenue: [
      "Use cash collected, not contracts.",
      "Include ads, commissions, and sales pay in the cost to get a customer.",
      mathOf().level === 3 ? "Math works. Cap sales at what you can deliver." : "If 30-day gross profit is under the cost to get a customer, fix the offer before you scale.",
    ],
  };
  return map[id];
}

function emailText() {
  if (!ready()) return "Set the company first. Then this note will match the buyer.";
  if (!state.offer.sentence.trim()) return "Write the offer first. An email without it is a nicer way to be ignored.";
  const item = play();
  const from = state.companyName || "me";
  return `Subject: ${item.subject}

I work with ${item.avatar}.

${state.offer.sentence}

${sizeLine()}

Worth 15 minutes this week? If not, I will close the file.

— ${from}`;
}

function callText() {
  if (!ready() || !state.offer.sentence.trim()) return "Write the offer first. The call is you saying it out loud.";
  const open = {
    "Just starting": "Do not introduce the company. Ask what they want fixed.",
    Growing: "Ask what they want more of. Sell more of that.",
    Stuck: "Ask what they already paid for that failed.",
    Scaling: "Ask what breaks if volume doubles.",
  }[state.status];
  return `${open}

1. Why this call, why now?
2. Repeat the problem in their words. Pause.
3. What did they try, and what did it cost?
4. Result: ${state.offer.outcome || play().outcome}.
5. Price: ${state.offer.price || priceFor()}. Guarantee: ${state.offer.guarantee || play().guarantee}.
6. What would stop them? Book a time, or take the no.`;
}

function closeText() {
  if (!state.offer.sentence.trim()) return "There is nothing to close until the offer is one sentence.";
  return `Say this, then stop talking:

"${state.offer.sentence}"

If it is the money: "How much can you put down today?" Same offer, split.

If they want it cheaper: remove ${play().upsell.includes("membership") ? "the membership bonus" : "the guarantee or the done-for-you part"}. Say what they lose.

If they need to think: "Is it the result, the fit, or the money?"

A second call with a partner is fine. A vague follow-up is a no.`;
}

function retainText() {
  return `When they hit the first win:

"You can stay month to month and pay a setup fee. Or commit longer and I waive it. Leave early, and the waived fee is due."

Then sell ${play().continuity}.

Put the next check-in on the calendar before you hang up.`;
}

function onePager() {
  if (!state.offer.sentence.trim()) return "Write the offer. This page is that sentence plus the next step.";
  return `Result: ${state.offer.outcome}
Who it is for: ${play().avatar}
Price: ${state.offer.price}
Guarantee: ${state.offer.guarantee}
Not a fit if they cannot pay or will not do the work.
Next step: a decision on the booked call.`;
}

function asset(id) {
  if (id === "email") return { title: "Email to send", text: emailText() };
  if (id === "call") return { title: "Call script", text: callText() };
  if (id === "close") return { title: "Close", text: closeText() };
  if (id === "retain") return { title: "Keep them", text: retainText() };
  if (id === "next") return { title: "Leave-behind", text: onePager() };
  if (id === "prospect") return { title: "Qualify out loud", text: `1. What is the painful problem?\n2. What have they already spent on it?\n3. Who else has to say yes?\n\nFit: ${play().avatar}.` };
  if (id === "sale") return { title: "After the yes", text: `Due today: ${state.offer.price || "the amount you named"}.\nStart inside 48 hours.\nUpsell now: ${play().upsell}.` };
  if (id === "cold") return { title: "Who goes on the list", text: ready() ? `${play().list}\n\nBuyer: ${play().avatar}.\n${sizeLine()}` : "Set the company first." };
  return null;
}

function activeAdvice() {
  if (meta.hasKey && ai.line) return { ...ai, focus: "" };
  return coach();
}

function render() {
  const advice = activeAdvice();
  const focus = captureFocus();
  document.getElementById("app").innerHTML = view(advice);
  restoreFocus(focus);
  if (jump) {
    jump = false;
    document.getElementById("drawer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function view(advice) {
  const tally = counts();
  return `
    <header class="top">
      <div class="top-row">
      <div class="brand">
        ${mark()}
        <div>
          <h1>Funnel</h1>
          <p class="sub">One next move for ${esc(state.companyName || "this company")}.</p>
        </div>
      </div>
      <div class="quiet">
        <button type="button" data-settings>${meta.hasKey ? "AI key saved" : "Set AI key"}</button>
        <button type="button" data-memory>Memory</button>
        <button type="button" data-example>Load example</button>
        <button type="button" data-clear>Clear board</button>
      </div>
      </div>
      <div class="project-bar">
        <label>Project
          <select id="projectPick">${meta.projects.map((project) => `<option value="${esc(project.id)}" ${project.id === meta.id ? "selected" : ""}>${esc(project.name)}</option>`).join("")}</select>
        </label>
        <input id="projectName" data-for="${esc(meta.id)}" value="${esc(currentProjectName())}" aria-label="Project name" />
        <button type="button" class="ghost" data-new-project>New</button>
        <button type="button" class="ghost" data-delete-project>Delete</button>
      </div>
      <div class="project-notes">
        ${noteField("goal", "Business goal", "What this business is trying to achieve")}
        ${noteField("description", "Description", "What the business does, who it sells to, and how it makes money")}
        ${noteField("context", "Context", "Constraints, history, and anything the coach should use")}
      </div>
    </header>
    ${showSettings ? settingsPanel() : ""}
    ${showMemory ? memoryPanel() : ""}
    <form class="fields" id="profile">
      <label>Company
        <input id="companyName" name="companyName" value="${esc(state.companyName)}" placeholder="Name" autocomplete="off" />
      </label>
      ${select("industry", "Industry", ["B2B SaaS", "Agency / services", "Home services", "Professional services", "Ecommerce", "Health & fitness", "Real estate", "Other"])}
      ${select("employees", "Employees", ["Just me", "2-10", "11-50", "51-200", "200+"])}
      ${select("revenue", "Revenue", ["Pre-revenue", "Under $250k", "$250k-$1M", "$1M-$5M", "$5M-$10M", "$10M+"])}
      ${select("status", "Status", ["Just starting", "Growing", "Stuck", "Scaling"])}
    </form>
    <section class="coach coach-${mood(advice)}">
      ${character(mood(advice))}
      <div>
        <p class="kicker">${thinking ? "Coach is thinking" : "Coach"} · you ${esc(userMemory.usage || "")} · this project ${esc(projectMemory.usage || "")}</p>
        <p class="coach-line" aria-live="polite">${esc(advice.line)}</p>
      </div>
      <div class="coach-actions">
        <button type="button" class="cta" data-cta="${esc(advice.stage)}" data-focus="${esc(advice.focus || "")}">${esc(thinking ? "Thinking" : advice.cta)}</button>
        <button type="button" class="ghost" data-think>${meta.hasKey ? "Think" : "Needs a key"}</button>
      </div>
    </section>
    <form class="teach" data-teach>
      <input name="note" placeholder="Tell the coach what to remember about you or this project" autocomplete="off" />
      <button class="small-primary" type="submit">Remember</button>
    </form>
    <div class="funnel">
      ${STAGES.map((stage, index) => stageBlock(stage, index, tally, advice)).join("")}
    </div>
    ${toast ? `<div class="toast" role="status">${esc(toast)}</div>` : ""}
  `;
}

function noteField(id, label, placeholder) {
  return `<label>${label}
    <textarea id="${id}" name="${id}" rows="4" maxlength="4000" placeholder="${esc(placeholder)}">${esc(state[id])}</textarea>
  </label>`;
}

function currentProjectName() {
  const project = meta.projects.find((item) => item.id === meta.id);
  return project ? project.name : "";
}

function settingsPanel() {
  return `<form id="settings" class="panel">
    <h3>AI key</h3>
    <p class="empty">Used only to think. Stored in memory/settings.json on this machine, never in the memory notes.</p>
    <div class="grid-2">
      <label>Key<input name="apiKey" type="password" placeholder="${meta.hasKey ? "Saved. Type a new key to replace it." : "Paste the key"}" autocomplete="off" /></label>
      <label>Model<input name="model" value="${esc(settingsDraft.model)}" autocomplete="off" /></label>
    </div>
    <label>Base URL<input name="baseUrl" value="${esc(settingsDraft.baseUrl)}" autocomplete="off" /></label>
    <div class="deal-actions">
      <button class="small-primary" type="submit">Save</button>
      ${meta.hasKey ? `<button type="button" class="ghost" data-clear-key>Remove key</button>` : ""}
    </div>
  </form>`;
}

function memoryPanel() {
  return `<section class="panel">
    <div class="mem-cols">
      ${memoryColumn("You", meta.paths.user, userMemory, "How you like to work. Shared by every project.")}
      ${memoryColumn("This project", meta.paths.project, projectMemory, "The buyer, the offer, and what the coach has learned here.")}
    </div>
  </section>`;
}

function memoryColumn(title, path, store, blurb) {
  const entries = store.entries || [];
  return `<div>
    <h3>${esc(title)} · ${esc(store.pct || "")}</h3>
    <p class="empty">${esc(blurb)} ${esc(path)}</p>
    ${entries.length ? entries.map((entry) => `<p class="entry">${esc(entry)}</p>`).join("") : `<p class="empty">Nothing saved yet.</p>`}
  </div>`;
}

function select(id, label, options) {
  const current = state[id];
  return `<label>${label}
    <select id="${id}" name="${id}" class="${current ? "" : "gap"}">
      <option value="">Choose</option>
      ${options.map((option) => `<option ${option === current ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  </label>`;
}

function stageBlock(stage, index, tally, advice) {
  const open = state.selected === stage.id;
  const recommended = advice.stage === stage.id;
  return `<div class="block">
    <button type="button" class="slice ${open ? "on" : ""}" style="--i:${index};--tone:${TONES[index]}" data-select="${stage.id}" aria-expanded="${open}">
      <span class="idx">${index + 1}</span>
      <span><span class="slice-label">${stage.label}</span><span class="slice-hint">${stage.hint}</span></span>
      <span class="count">${tally[stage.id]}</span>
      ${recommended ? `<span class="next-tag">Next</span>` : `<span></span>`}
    </button>
    ${open ? drawer(stage, advice) : ""}
  </div>`;
}

function drawer(stage, advice) {
  const deals = state.deals.filter((deal) => deal.stage === stage.id);
  const block = asset(stage.id);
  const here = advice.stage === stage.id;
  return `<section class="drawer" id="drawer">
    ${here ? `<span class="here">This is the next move</span>` : ""}
    <h2>${esc(stage.label)}</h2>
    <ul class="do">${bullets(stage.id).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    ${stage.id === "offer" ? offerForm() : ""}
    ${stage.id === "revenue" ? revenueForm() : ""}
    ${block ? `<div class="asset">
      <div class="asset-head"><h3>${esc(block.title)}</h3><button type="button" class="copy" data-copy="${esc(block.text)}">Copy</button></div>
      <pre>${esc(block.text)}</pre>
    </div>` : ""}
    <div class="people">
      <div class="people-head"><h3>In this step</h3></div>
      <form class="add-form" data-add="${stage.id}">
        <input name="name" placeholder="Name" required autocomplete="off" />
        <input name="company" placeholder="Company" autocomplete="off" />
        <input name="why" placeholder="Why they can buy" autocomplete="off" />
        <button class="small-primary" type="submit">Add</button>
      </form>
      ${deals.length ? deals.map(dealCard).join("") : `<p class="empty">Nobody here yet.</p>`}
    </div>
  </section>`;
}

function offerForm() {
  const offer = state.offer;
  return `<form class="asset" id="offerForm">
    <div class="asset-head"><h3>The offer</h3><button type="button" class="small-primary" data-draft>Write my offer</button></div>
    <div class="grid-2">
      <label>Dream outcome<input id="outcome" value="${esc(offer.outcome)}" /></label>
      <label>Price<input id="price" value="${esc(offer.price)}" /></label>
    </div>
    <label>Guarantee<input id="guarantee" value="${esc(offer.guarantee)}" /></label>
    <label>One sentence<textarea id="sentence">${esc(offer.sentence)}</textarea></label>
  </form>`;
}

function revenueForm() {
  const math = mathOf();
  const result = !math.ready
    ? (math.badCustomers ? "Customer count has to be at least 1." : "Enter all four numbers from the last 30 days.")
    : `${money(math.gp)} gross profit in 30 days. ${money(math.cac)} to get one customer. ${math.freeAcquire ? "You entered $0 acquisition cost. Only believe it if nobody's time was spent." : ""}`;
  return `<form class="asset" id="mathForm">
    <h3>Last 30 days</h3>
    <div class="grid-4">
      ${mathField("cash30", "Cash collected")}
      ${mathField("cost30", "Cost to deliver")}
      ${mathField("spend", "Ad + sales cost")}
      ${mathField("customers", "New customers")}
    </div>
    <div class="math">
      <strong class="level-${math.ready ? math.level : 1}">${math.ready ? `Level ${math.level}` : "Need numbers"}</strong>
      <p>${esc(result)}</p>
      <p>${esc(lever(math))}</p>
    </div>
  </form>`;
}

function mathField(id, label) {
  return `<label>${label}<input id="${id}" inputmode="decimal" value="${esc(state.math[id])}" /></label>`;
}

function lever(math) {
  if (!math.ready) return "Level 1 means you are funding growth from savings. Level 2 means you get the cash back inside 30 days. Level 3 means this customer pays for the next one.";
  if (math.level === 1) return "Do not buy more leads. Raise the price or add an upsell that collects this month.";
  if (math.level === 2) return "You break even inside 30 days. Add continuity so each buyer is worth twice the cost to get them.";
  return "This customer funds the next one. Sell only what you can deliver.";
}

function dealCard(deal) {
  const forward = nextId(deal.stage);
  const back = prevId(deal.stage);
  const showCash = deal.stage === "sale" || deal.stage === "retain" || deal.stage === "revenue";
  return `<article class="deal">
    <div>
      <div class="who">${esc(deal.name)}${deal.company ? ` · ${esc(deal.company)}` : ""}</div>
      ${deal.why ? `<p>${esc(deal.why)}</p>` : ""}
    </div>
    <div class="deal-actions">
      ${showCash ? `<input class="cash" data-cash="${deal.id}" inputmode="decimal" placeholder="Cash" value="${esc(deal.cash || "")}" />` : ""}
      ${back ? `<button type="button" class="ghost" data-back="${deal.id}">Back</button>` : ""}
      ${forward ? `<button type="button" class="small-primary" data-move="${deal.id}">Move forward</button>` : ""}
      <button type="button" class="ghost" data-drop="${deal.id}">Drop</button>
    </div>
  </article>`;
}

function character(kind) {
  return `<div class="buddy buddy-${kind}" aria-hidden="true">
    <svg class="coach-figure" viewBox="0 0 120 128">
      <ellipse class="ground" cx="60" cy="120" rx="24" ry="5"/>
      <g class="dots" fill="#c2410c">
        <circle class="dot d1" cx="86" cy="24" r="3"/>
        <circle class="dot d2" cx="97" cy="16" r="3.5"/>
        <circle class="dot d3" cx="110" cy="10" r="4"/>
      </g>
      <g class="coach-body">
        <g class="arm-wave">
          <path d="M40 82 Q24 74 20 54" stroke="#e7b08a" stroke-width="8" fill="none" stroke-linecap="round"/>
          <circle cx="18" cy="50" r="6" fill="#ffd3b0"/>
        </g>
        <path d="M38 76c0-8 8-14 22-14s22 6 22 14v20c0 10-8 16-18 16H52c-8 0-14-6-14-14V76z" fill="#1f3d34"/>
        <rect x="52" y="84" width="16" height="9" rx="3" fill="#c2410c"/>
        <g class="head">
          <circle cx="60" cy="50" r="24" fill="#ffd3b0"/>
          <path d="M38 48c2-18 14-26 22-26s20 8 22 26c-4-8-12-12-22-12s-18 4-22 12z" fill="#1f3d34"/>
          <ellipse cx="44" cy="56" rx="4.5" ry="2.4" fill="#f0a898" opacity="0.85"/>
          <ellipse cx="76" cy="56" rx="4.5" ry="2.4" fill="#f0a898" opacity="0.85"/>
          <g class="eyes" fill="#1c1915">
            <ellipse class="eye" cx="51" cy="50" rx="3.1" ry="3.6"/>
            <ellipse class="eye" cx="69" cy="50" rx="3.1" ry="3.6"/>
          </g>
          <g fill="#fff">
            <circle cx="52.2" cy="48.6" r="1.1"/>
            <circle cx="70.2" cy="48.6" r="1.1"/>
          </g>
          <path class="brow brow-left" d="M45 42 Q51 40 56 43" fill="none" stroke="#1f3d34" stroke-width="1.6" stroke-linecap="round"/>
          <path class="brow brow-right" d="M64 43 Q70 40 75 42" fill="none" stroke="#1f3d34" stroke-width="1.6" stroke-linecap="round"/>
          <path class="mouth mouth-smile" d="M50 60 Q60 70 70 60" fill="none" stroke="#c2410c" stroke-width="2.3" stroke-linecap="round"/>
          <path class="mouth mouth-soft" d="M52 62 Q60 67 68 62" fill="none" stroke="#c2410c" stroke-width="2.3" stroke-linecap="round"/>
          <circle class="mouth mouth-o" cx="60" cy="63" r="3.2" fill="none" stroke="#c2410c" stroke-width="2.2"/>
        </g>
        <g class="arm-point">
          <path d="M84 82 Q102 76 112 62" stroke="#e7b08a" stroke-width="8" fill="none" stroke-linecap="round"/>
          <circle cx="114" cy="58" r="6" fill="#ffd3b0"/>
        </g>
      </g>
    </svg>
  </div>`;
}

function mark() {
  return `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M6 8 h36 l-6 8 H12 z" fill="#1e3b33"/>
    <path d="M12 18 h24 l-5 8 H17 z" fill="#3f6a56"/>
    <path d="M17 28 h14 l-4 8 H21 z" fill="#8a3b22"/>
  </svg>`;
}

function mood(advice) {
  if (thinking) return "think";
  if (!ready()) return "hello";
  if (!state.offer.sentence.trim() || (advice.stage === "revenue" && state.status === "Stuck")) return "nudge";
  if (advice.stage === "sale" || advice.stage === "revenue") return "cheer";
  return "point";
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.id || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return null;
  return { id: el.id, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(focus) {
  if (!focus) return;
  const el = document.getElementById(focus.id);
  if (!el) return;
  el.focus();
  if (typeof focus.start === "number" && el.setSelectionRange) {
    try { el.setSelectionRange(focus.start, focus.end); } catch { /* number inputs */ }
  }
}

function onChange(event) {
  const id = event.target.id;
  if (id === "projectPick") {
    switchProject(event.target.value);
    return;
  }
  if (id === "projectName") {
    if (event.target.dataset.for !== meta.id) return;
    renameProject(event.target.value);
    return;
  }
  if (["industry", "employees", "revenue", "status", "companyName"].includes(id)) {
    state[id] = event.target.value;
    save();
    render();
  }
}

function onInput(event) {
  if (isSettingsField(event.target)) {
    if (event.target.name === "baseUrl" || event.target.name === "model") settingsDraft[event.target.name] = event.target.value;
    return;
  }
  const id = event.target.id;
  if (["goal", "description", "context"].includes(id)) {
    state[id] = event.target.value.slice(0, 4000);
    save();
    return;
  }
  if (["outcome", "price", "guarantee", "sentence"].includes(id)) {
    state.offer[id] = event.target.value;
    save();
    render();
    return;
  }
  if (["cash30", "cost30", "spend", "customers"].includes(id)) {
    state.math[id] = event.target.value;
    save();
    render();
    return;
  }
  if (event.target.dataset.cash) {
    const deal = state.deals.find((item) => item.id === event.target.dataset.cash);
    if (deal) deal.cash = event.target.value;
    save();
  }
}

function onSubmit(event) {
  const form = event.target;
  if (form.id === "settings") {
    event.preventDefault();
    saveSettings(form);
    return;
  }
  if (form.dataset.teach !== undefined) {
    event.preventDefault();
    const note = String(new FormData(form).get("note") || "").trim();
    if (note) remember(note);
    form.reset();
    return;
  }
  if (!form.dataset.add) return;
  event.preventDefault();
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) return;
  state.deals.unshift({
    id: crypto.randomUUID(),
    name,
    company: String(data.get("company") || "").trim(),
    why: String(data.get("why") || "").trim(),
    stage: form.dataset.add,
    cash: "",
  });
  state.selected = form.dataset.add;
  save();
  render();
}

function onClick(event) {
  if (event.target.closest("[data-settings]")) {
    showSettings = !showSettings;
    render();
    return;
  }
  if (event.target.closest("[data-memory]")) {
    showMemory = !showMemory;
    render();
    return;
  }
  if (event.target.closest("[data-new-project]")) {
    createProject();
    return;
  }
  if (event.target.closest("[data-delete-project]")) {
    deleteProject();
    return;
  }
  if (event.target.closest("[data-clear-key]")) {
    clearKey();
    return;
  }
  if (event.target.closest("[data-think]")) {
    if (!meta.hasKey) {
      showSettings = true;
      render();
      return;
    }
    const gen = ++thinkGen;
    runThink(gen, "").catch(() => flash("The coach could not think."));
    return;
  }
  const select = event.target.closest("[data-select]");
  if (select) {
    state.selected = select.dataset.select;
    save({ think: false });
    render();
    return;
  }
  const cta = event.target.closest("[data-cta]");
  if (cta) {
    if (cta.dataset.focus) {
      document.getElementById(cta.dataset.focus)?.focus();
      return;
    }
    state.selected = cta.dataset.cta;
    jump = true;
    save();
    render();
    return;
  }
  if (event.target.closest("[data-draft]")) {
    if (!ready()) {
      document.getElementById(gap())?.focus();
      return;
    }
    state.offer = draftOffer();
    state.selected = "offer";
    save();
    render();
    return;
  }
  if (event.target.closest("[data-example]")) {
    loadExample();
    return;
  }
  if (event.target.closest("[data-clear]")) {
    state = blank();
    save();
    render();
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard.writeText(copy.dataset.copy).then(() => flash("Copied"));
    return;
  }
  const move = event.target.closest("[data-move]");
  if (move) {
    shift(move.dataset.move, 1);
    return;
  }
  const back = event.target.closest("[data-back]");
  if (back) {
    shift(back.dataset.back, -1);
    return;
  }
  const drop = event.target.closest("[data-drop]");
  if (drop) {
    state.deals = state.deals.filter((deal) => deal.id !== drop.dataset.drop);
    save();
    render();
  }
}

function shift(id, direction) {
  const deal = state.deals.find((item) => item.id === id);
  if (!deal) return;
  const target = direction > 0 ? nextId(deal.stage) : prevId(deal.stage);
  if (!target) return;
  deal.stage = target;
  state.selected = target;
  jump = true;
  save();
  render();
}

function loadExample() {
  state = blank();
  state.companyName = "Northline";
  state.industry = "Agency / services";
  state.employees = "2-10";
  state.revenue = "$250k-$1M";
  state.status = "Growing";
  state.offer = draftOffer();
  state.deals = [
    ["Ava Shah", "Bright Dental", "Lives on referrals", "cold"],
    ["Luis Ortega", "Peak HVAC", "Uneven weeks", "email"],
    ["Mina Cho", "Fieldkit", "Founder still sells every deal", "call"],
    ["Jon Hale", "Hale Law", "Wants fewer, better clients", "prospect"],
    ["Rae Kim", "Sable", "Thursday at 10", "next"],
    ["Chris Adeyemi", "Adeyemi Co", "Heard the price", "close"],
  ].map(([name, company, why, stage]) => ({ id: crypto.randomUUID(), name, company, why, stage, cash: "" }));
  state.selected = "cold";
  save();
  render();
}

async function switchProject(id) {
  if (!id || id === meta.id) return;
  try {
    await persistNow();
    const data = await postJson("/api/projects/select", { id });
    applyBootstrap(data);
    render();
    scheduleThink();
  } catch (error) {
    flash(error.message);
  }
}

async function renameProject(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const data = await postJson("/api/projects/rename", { id: meta.id, name: trimmed });
    meta.projects = data.projects;
    render();
  } catch (error) {
    flash(error.message);
  }
}

async function createProject() {
  try {
    await persistNow();
    const data = await postJson("/api/projects/create", { name: "New project" });
    applyBootstrap(data);
    showMemory = false;
    render();
    document.getElementById("projectName")?.focus();
  } catch (error) {
    flash(error.message);
  }
}

async function deleteProject() {
  try {
    const data = await postJson("/api/projects/delete", { id: meta.id });
    applyBootstrap(data);
    render();
    scheduleThink();
  } catch (error) {
    flash(error.message);
  }
}

async function saveSettings(form) {
  const data = new FormData(form);
  try {
    const saved = await postJson("/api/settings", {
      apiKey: String(data.get("apiKey") || ""),
      baseUrl: String(data.get("baseUrl") || settingsDraft.baseUrl),
      model: String(data.get("model") || settingsDraft.model),
    });
    meta.hasKey = saved.hasKey;
    meta.baseUrl = saved.baseUrl;
    meta.model = saved.model;
    settingsDraft.baseUrl = saved.baseUrl;
    settingsDraft.model = saved.model;
    showSettings = false;
    flash(saved.hasKey ? "Key saved on this machine." : "Saved.");
    render();
    scheduleThink();
  } catch (error) {
    flash(error.message);
  }
}

async function clearKey() {
  try {
    const saved = await postJson("/api/settings", { clearKey: true, baseUrl: meta.baseUrl, model: meta.model });
    meta.hasKey = saved.hasKey;
    ai = { line: "", stage: "", cta: "" };
    thinkGen += 1;
    flash("Key removed.");
    render();
  } catch (error) {
    flash(error.message);
  }
}

async function remember(note) {
  if (meta.hasKey) {
    const gen = ++thinkGen;
    try {
      await runThink(gen, note);
    } catch (error) {
      flash(error.message);
    }
    return;
  }
  const target = /^(i |i'm |i am |my |call me)/i.test(note) ? "user" : "memory";
  try {
    const data = await postJson("/api/memory", { action: "add", target, content: note });
    userMemory = data.user;
    projectMemory = data.memory;
    showMemory = true;
    flash(target === "user" ? "Saved to your profile." : "Saved to this project.");
    render();
  } catch (error) {
    flash(error.message);
    showMemory = true;
    render();
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function flash(message) {
  toast = message;
  render();
  setTimeout(() => {
    toast = "";
    render();
  }, 1200);
}
