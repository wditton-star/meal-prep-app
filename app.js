/* ============================================================
   MEAL PREP APP — app.js
   ============================================================
   HOW THIS FILE IS ORGANIZED:
   1. DATA  — All your app content lives here. Edit this section
              to add recipes, family members, grocery items, etc.
   2. STATE — Tracks what the user has done (current stage, etc.)
   3. INIT  — Runs on page load, wires everything up.
   4. STAGE NAVIGATION — Handles tab switching + progress bar.
   5. RENDER FUNCTIONS — Build DOM from data. One function per section.
   6. INTERACTION HANDLERS — Checkbox clicks, recipe toggles, etc.
   ============================================================ */


/* ============================================================
   0. THEME
   Runs immediately (before DOMContentLoaded) to avoid flash of
   wrong theme. Persists preference in localStorage.
   ============================================================ */
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  }
})();


/* ============================================================
   1. DATA
   Edit these arrays/objects to customize the app content.
   ============================================================ */

/**
 * MEMBERS — family members with their maintenance macro targets.
 * Deficit = −20%, Bulking = +20%. Users can override any value per phase.
 */
const MEMBERS = [
  { id: 'william', name: 'William', initials: 'WD', avatarClass: 'avatar-green',
    maintenance: { cal: 2400, protein: 185, carbs: 200, fat: 75 } },
  { id: 'julie',   name: 'Julie',   initials: 'JD', avatarClass: 'avatar-blue',
    maintenance: { cal: 1900, protein: 140, carbs: 160, fat: 60 } },
  { id: 'owen',    name: 'Owen',    initials: 'OD', avatarClass: 'avatar-amber',
    maintenance: { cal: 1600, protein: 90,  carbs: 180, fat: 55 } },
  { id: 'colin',   name: 'Colin',   initials: 'CD', avatarClass: 'avatar-pink',
    maintenance: { cal: 1400, protein: 75,  carbs: 155, fat: 48 } },
];

const PHASES = [
  { id: 'deficit',     label: 'Deficit',  factor: 0.8 },
  { id: 'maintenance', label: 'Maintain', factor: 1.0 },
  { id: 'bulking',     label: 'Bulk',     factor: 1.2 },
];

function scalePhase(maintenance, factor) {
  return {
    cal:     Math.round(maintenance.cal     * factor),
    protein: Math.round(maintenance.protein * factor),
    carbs:   Math.round(maintenance.carbs   * factor),
    fat:     Math.round(maintenance.fat     * factor),
  };
}

function getFamilyScaleFactor() {
  const base = MEMBERS.reduce((s, m) => s + m.maintenance.cal, 0);
  const current = MEMBERS.reduce((s, m) => {
    const phase = state.memberPhases[m.id] || 'maintenance';
    return s + (state.memberMacros[m.id]?.[phase]?.cal || m.maintenance.cal);
  }, 0);
  return current / base;
}

function getMemberScaleFactor(memberId) {
  const member = MEMBERS.find(m => m.id === memberId);
  const phase = state.memberPhases[memberId] || 'maintenance';
  const active = state.memberMacros[memberId]?.[phase]?.cal || member.maintenance.cal;
  return active / member.maintenance.cal;
}

function fmtCups(v) {
  const q = Math.round(v * 4) / 4;
  return `${q} cups`;
}

function fmtScaled(base, unit, scale) {
  const v = base * scale;
  switch (unit) {
    case 'lbs': case 'lb': return `${(Math.round(v * 2) / 2).toFixed(1)} lbs`;
    case 'oz':   return `${Math.round(v)} oz`;
    case 'cups': return fmtCups(v);
    case 'ct':   return `${Math.ceil(v)} ct`;
    case 'packs': return `${Math.ceil(v)} packs`;
    case 'head': return `${Math.ceil(v)} head`;
    case 'bottle': return `${Math.ceil(v)} bottle${Math.ceil(v) > 1 ? 's' : ''}`;
    default:     return `${Math.round(v)} ${unit}`;
  }
}

function loadMemberPhases() {
  try {
    const raw = localStorage.getItem('prepFlowMemberPhases');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return Object.fromEntries(MEMBERS.map(m => [m.id, 'maintenance']));
}

function saveMemberPhases() {
  localStorage.setItem('prepFlowMemberPhases', JSON.stringify(state.memberPhases));
}

function loadMemberMacros() {
  try {
    const raw = localStorage.getItem('prepFlowMemberMacros');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return Object.fromEntries(MEMBERS.map(m => [
    m.id,
    Object.fromEntries(PHASES.map(p => [p.id, scalePhase(m.maintenance, p.factor)])),
  ]));
}

function saveMemberMacros() {
  localStorage.setItem('prepFlowMemberMacros', JSON.stringify(state.memberMacros));
}

const ACTIVITY_LEVELS = [
  { factor: 1.2,   emoji: '🪑', label: 'Sedentary',          desc: 'Desk job · little or no exercise' },
  { factor: 1.375, emoji: '🚶', label: 'Lightly Active',     desc: 'Light exercise 1–3 days/week' },
  { factor: 1.55,  emoji: '🏃', label: 'Moderately Active',  desc: 'Exercise 3–5 days/week' },
  { factor: 1.725, emoji: '🏋️', label: 'Very Active',        desc: 'Hard exercise 6–7 days/week' },
  { factor: 1.9,   emoji: '🔥', label: 'Extra Active',       desc: 'Intense training or physical job' },
];

function loadCalcInputs() {
  try {
    const raw = localStorage.getItem('prepFlowCalcInputs');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function saveCalcInputs() {
  localStorage.setItem('prepFlowCalcInputs', JSON.stringify(state.calcInputs));
}

/**
 * RECIPES — shown on Stage 1 as selectable cards.
 * Add more objects to expand the picker.
 */
const RECIPES = [
  {
    id: 'chicken-bowls',
    name: 'Grilled chicken & rice bowls',
    protein: 48,
    carbs: 52,
    fat: 12,
    calories: 580,
    selected: true,   // pre-selected on load
  },
  {
    id: 'turkey-stirfry',
    name: 'Turkey & veggie stir-fry',
    protein: 42,
    carbs: 38,
    fat: 14,
    calories: 490,
    selected: true,
  },
  {
    id: 'salmon-sweet-potato',
    name: 'Salmon with roasted sweet potato',
    protein: 40,
    carbs: 35,
    fat: 18,
    calories: 520,
    selected: false,
  },
  {
    id: 'beef-taco-bowls',
    name: 'Ground beef taco bowls',
    protein: 38,
    carbs: 44,
    fat: 16,
    calories: 545,
    selected: false,
  },
];

/**
 * MEAL_CALENDAR — 7 days, each has a dinner slot.
 * Set `meal` to a recipe id string (from RECIPES above) or null for empty.
 * Add more slot types (e.g. 'lunch', 'breakfast') to expand.
 */
const MEAL_CALENDAR = [
  { day: 'Mon', slots: [{ label: 'D', meal: 'chicken-bowls' }] },
  { day: 'Tue', slots: [{ label: 'D', meal: 'turkey-stirfry' }] },
  { day: 'Wed', slots: [{ label: 'D', meal: 'chicken-bowls' }] },
  { day: 'Thu', slots: [{ label: 'D', meal: 'turkey-stirfry' }] },
  { day: 'Fri', slots: [{ label: 'D', meal: null }] },
  { day: 'Sat', slots: [{ label: 'D', meal: null }] },
  { day: 'Sun', slots: [{ label: 'D', meal: null, note: 'prep day' }] },
];

/**
 * GROCERY_LIST — shown on Stage 2, organized by category.
 * checked: false = unchecked on load.
 */
const GROCERY_LIST = [
  {
    category: 'Proteins',
    items: [
      { name: 'Chicken breast',           baseQty: 5,  unit: 'lbs',   checked: false },
      { name: 'Ground turkey (93% lean)', baseQty: 3,  unit: 'lbs',   checked: false },
      { name: 'Eggs',                     baseQty: 18, unit: 'ct',    checked: false },
    ],
  },
  {
    category: 'Grains & Carbs',
    items: [
      { name: 'Jasmine rice',   baseQty: 5,  unit: 'lbs',   checked: false },
      { name: 'Rice noodles',   baseQty: 2,  unit: 'packs', checked: false },
      { name: 'Oats (rolled)',  baseQty: 42, unit: 'oz',    checked: false },
    ],
  },
  {
    category: 'Vegetables',
    items: [
      { name: 'Broccoli crowns',      baseQty: 2,  unit: 'lbs',  checked: false },
      { name: 'Bell peppers (mixed)', baseQty: 6,  unit: 'ct',   checked: false },
      { name: 'Baby spinach',         baseQty: 16, unit: 'oz',   checked: false },
      { name: 'Snap peas',            baseQty: 1,  unit: 'lbs',  checked: false },
      { name: 'Garlic',               baseQty: 1,  unit: 'head', checked: false },
    ],
  },
  {
    category: 'Pantry & Sauces',
    items: [
      { name: 'Low-sodium soy sauce',         baseQty: 1,  unit: 'bottle', checked: false },
      { name: 'Olive oil',                    baseQty: 16, unit: 'oz',     checked: false },
      { name: 'Chicken broth (low sodium)',   baseQty: 32, unit: 'oz',     checked: false },
      { name: 'Greek yogurt (plain, non-fat)',baseQty: 32, unit: 'oz',     checked: false },
    ],
  },
];

/**
 * STORE_LAYOUT — shown on Stage 3 as an ordered list of aisles.
 * Reorder the array to match your store's layout.
 */
const STORE_LAYOUT = [
  { icon: '🥩', category: 'Meat & Seafood', itemsList: [
    { name: 'Chicken breast',          base: 5,  unit: 'lb'  },
    { name: 'Ground turkey 93% lean',  base: 3,  unit: 'lb'  },
  ]},
  { icon: '🥦', category: 'Produce', itemsList: [
    { name: 'Broccoli crowns',  base: 2,  unit: 'lbs' },
    { name: 'Bell peppers',     base: 6,  unit: 'ct'  },
    { name: 'Baby spinach',     base: 16, unit: 'oz'  },
    { name: 'Snap peas',        base: 1,  unit: 'lbs' },
    { name: 'Garlic',           base: 1,  unit: 'head'},
  ]},
  { icon: '🌾', category: 'Grains & Dry Goods', itemsList: [
    { name: 'Jasmine rice',  base: 5,  unit: 'lb'    },
    { name: 'Rice noodles',  base: 2,  unit: 'packs' },
    { name: 'Rolled oats',   base: 42, unit: 'oz'    },
  ]},
  { icon: '🫙', category: 'Pantry & Condiments', itemsList: [
    { name: 'Low-sodium soy sauce', base: 1,  unit: 'bottle' },
    { name: 'Olive oil',            base: 16, unit: 'oz'     },
    { name: 'Chicken broth',        base: 32, unit: 'oz'     },
  ]},
  { icon: '🧊', category: 'Dairy & Refrigerated', itemsList: [
    { name: 'Eggs',                        base: 18, unit: 'ct' },
    { name: 'Greek yogurt plain non-fat',  base: 32, unit: 'oz' },
  ]},
];

/**
 * PREP_STEPS — shown on Stage 4 as a numbered sequence.
 * Order matters — this is the batch cooking timeline.
 */
const PREP_STEPS = [
  {
    title: 'Start the rice cooker',
    desc: 'Rinse {{RICE}} jasmine rice. Cook with chicken broth instead of water for extra flavor. Hands-off while you do everything else.',
    tokens: { RICE: { base: 6, unit: 'cups' } },
    time: '5 min active · 30 min cook time',
  },
  {
    title: 'Season & bake chicken',
    desc: 'Cut chicken breast into even portions. Season simply — salt, pepper, garlic powder, olive oil. Bake at 400°F.',
    time: '10 min active · 25 min bake time',
  },
  {
    title: 'Roast the vegetables',
    desc: 'Chop broccoli into florets, slice bell peppers. Toss with olive oil and salt. Roast on a sheet pan at 400°F alongside the chicken.',
    time: '10 min active · 25 min roast time',
  },
  {
    title: 'Cook turkey stir-fry base',
    desc: 'Brown ground turkey in a large skillet. Add snap peas, soy sauce, minced garlic. Keep it simple — sauce goes on fresh each day.',
    time: '15 min active',
  },
  {
    title: 'Hard boil eggs for snacks',
    desc: 'Place eggs in cold water, bring to boil, cook 10 min, ice bath. Label by family member if desired.',
    time: '5 min active · 15 min cook',
  },
  {
    title: 'Assemble & portion containers',
    desc: 'Once everything has cooled, build each container per family member\'s portion targets. Label with name + day.',
    time: '20 min active',
  },
];

/**
 * PORTIONS — shown on Stage 5 as a table.
 * avatarClass maps to CSS classes defined in styles.css.
 */
const PORTIONS = [
  { initials: 'WD', name: 'William', avatarClass: 'avatar-green', memberId: 'william',
    baseChicken: 7, baseRice: 1.5, baseVeg: 1.5, baseProtein: 54, baseCal: 620 },
  { initials: 'JD', name: 'Julie',   avatarClass: 'avatar-blue',  memberId: 'julie',
    baseChicken: 5, baseRice: 1.0, baseVeg: 1.5, baseProtein: 40, baseCal: 490 },
  { initials: 'OD', name: 'Owen',    avatarClass: 'avatar-amber', memberId: 'owen',
    baseChicken: 4, baseRice: 1.0, baseVeg: 1.0, baseProtein: 31, baseCal: 415 },
  { initials: 'CD', name: 'Colin',   avatarClass: 'avatar-pink',  memberId: 'colin',
    baseChicken: 3, baseRice: 0.75,baseVeg: 1.0, baseProtein: 24, baseCal: 355 },
];


/* ============================================================
   2. STATE
   Tracks runtime values that change as the user interacts.
   mealsByWeek is persisted to localStorage under 'mealPrepCalendar'.
   Keys are week offsets (integers); values are 7-element arrays
   of recipe id strings or null, indexed Mon–Sun.
   ============================================================ */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STORAGE_KEY = 'mealPrepCalendar';

function loadMeals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  // First run — seed week 0 from the MEAL_CALENDAR data array.
  return { 0: MEAL_CALENDAR.map(d => d.slots[0].meal || null) };
}

function saveMeals() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mealsByWeek));
  } catch (_) {}
}

const state = {
  currentStage: 0,
  checkedItems: 0,
  totalItems: 0,
  weekOffset: 0,
  mealsByWeek:   loadMeals(),
  memberPhases:  loadMemberPhases(),
  memberMacros:  loadMemberMacros(),
  calcInputs:    loadCalcInputs(),
};

// Transient state for the calculator modal (not persisted between opens)
const _calc = { memberId: MEMBERS[0].id, gender: 'male', activity: 1.55 };


/* ============================================================
   3. INIT
   Called once when the DOM is ready.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();
  renderMealCalendar();
  setupNavigation();
  updateProgress();

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
});


/* ============================================================
   4. STAGE NAVIGATION
   ============================================================ */

/**
 * Wire up the nav buttons so clicking one switches stages.
 */
function setupNavigation() {
  const buttons = document.querySelectorAll('.nav-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetStage = parseInt(btn.dataset.stage, 10);
      switchStage(targetStage);
    });
  });
}

/**
 * Show stage `index`, hide all others, update nav + progress bar.
 */
function switchStage(index) {
  // Hide current stage, remove active class from its button
  document.getElementById(`stage-${state.currentStage}`).classList.remove('active');
  document.querySelector(`.nav-btn[data-stage="${state.currentStage}"]`).classList.remove('active');

  // Show new stage, add active class to its button
  state.currentStage = index;
  document.getElementById(`stage-${state.currentStage}`).classList.add('active');
  document.querySelector(`.nav-btn[data-stage="${state.currentStage}"]`).classList.add('active');

  updateProgress();

  // Scroll back to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Update the green progress bar width based on current stage.
 */
function updateProgress() {
  const pct = ((state.currentStage + 1) / 5) * 100;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}


/* ============================================================
   5. RENDER FUNCTIONS
   Each one reads from the DATA section above and builds HTML.
   ============================================================ */

/**
 * Stage 1 — Family macro targets with per-member phase toggles.
 */
function renderMacroTargets() {
  const container = document.getElementById('macro-targets');
  if (!container) return;

  const FIELDS = [
    { key: 'cal',     label: 'Cal' },
    { key: 'protein', label: 'Protein (g)' },
    { key: 'carbs',   label: 'Carbs (g)' },
    { key: 'fat',     label: 'Fat (g)' },
  ];

  container.innerHTML = MEMBERS.map(member => {
    const currentPhase = state.memberPhases[member.id];
    const macros       = state.memberMacros[member.id][currentPhase];

    const phaseBtns = PHASES.map(p => {
      const isActive = currentPhase === p.id;
      return `<button
        class="phase-btn${isActive ? ' phase-active phase-active--' + p.id : ''}"
        onclick="setMemberPhase('${member.id}', '${p.id}')"
      >${p.label}</button>`;
    }).join('');

    const macroFields = FIELDS.map(f => `
      <div class="macro-field">
        <label>${f.label}</label>
        <input type="number" value="${macros[f.key]}"
          onchange="saveMacroOverride('${member.id}', '${f.key}', this.value)" />
      </div>
    `).join('');

    return `
      <div class="member-row">
        <div class="member-row-top">
          <div class="avatar ${member.avatarClass}">${member.initials}</div>
          <span class="member-name">${member.name}</span>
          <div class="phase-toggle">${phaseBtns}</div>
        </div>
        <div class="macro-inputs">${macroFields}</div>
      </div>
    `;
  }).join('');
}

function renderAll() {
  renderMacroTargets();
  renderRecipes();
  renderGroceryList();
  renderStoreLayout();
  renderPrepSteps();
  renderPortionTable();
}

function setMemberPhase(memberId, phase) {
  state.memberPhases[memberId] = phase;
  saveMemberPhases();
  renderAll();
}

function saveMacroOverride(memberId, field, value) {
  const phase = state.memberPhases[memberId];
  state.memberMacros[memberId][phase][field] = Math.round(parseFloat(value)) || 0;
  saveMemberMacros();
  renderAll();
}

/**
 * Stage 1 — Recipe picker cards.
 */
function renderRecipes() {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  const scale = getFamilyScaleFactor();
  const batchLabel = Math.abs(scale - 1) >= 0.01
    ? `<span class="badge badge-batch">×${scale.toFixed(2)} batch</span>`
    : '';

  grid.innerHTML = RECIPES.map((recipe, i) => `
    <div
      class="recipe-card ${recipe.selected ? 'selected' : ''}"
      data-recipe-index="${i}"
      onclick="toggleRecipe(${i})"
    >
      <div class="recipe-name">${recipe.name}</div>
      <div class="macro-badges">
        <span class="badge badge-protein">${recipe.protein}g protein</span>
        <span class="badge badge-carbs">${recipe.carbs}g carbs</span>
        ${recipe.fat ? `<span class="badge badge-fat">${recipe.fat}g fat</span>` : ''}
        <span class="badge badge-calories">${recipe.calories} cal</span>
        ${recipe.selected ? batchLabel : ''}
      </div>
    </div>
  `).join('');
}

/**
 * Stage 1 — Weekly meal calendar with week navigation.
 */
function renderMealCalendar() {
  const monday = getWeekStart(state.weekOffset);
  const meals  = getMealsForWeek(state.weekOffset);

  // Card header: title + prev/next arrows
  const header = document.getElementById('meal-cal-header');
  if (header) {
    const label = monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    header.innerHTML = `
      <span>Meal calendar</span>
      <div class="week-nav">
        <button class="week-nav-btn" onclick="changeWeek(-1)" title="Previous week">&#8592;</button>
        <span class="week-nav-label">${label}</span>
        <button class="week-nav-btn" onclick="changeWeek(1)" title="Next week">&#8594;</button>
      </div>
    `;
  }

  // Keep the app header subtitle in sync
  const weekLabel = document.getElementById('week-label');
  if (weekLabel) {
    weekLabel.textContent = 'Week of ' + monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const cal = document.getElementById('meal-calendar');
  if (!cal) return;

  cal.innerHTML = DAY_NAMES.map((name, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);

    const mealId = meals[i];
    let text   = '+ add';
    let filled = false;

    if (mealId) {
      const recipe = RECIPES.find(r => r.id === mealId);
      text   = recipe ? recipe.name : mealId;
      filled = true;
    }

    return `
      <div class="day-col">
        <div class="day-header">${name}<span class="day-date">${date.getDate()}</span></div>
        <div class="meal-slot ${filled ? 'filled' : ''}">
          <div class="meal-slot-label">D</div>
          <div class="meal-slot-text">${text}</div>
        </div>
      </div>
    `;
  }).join('');
}

function changeWeek(delta) {
  state.weekOffset += delta;
  renderMealCalendar();
}

function getWeekStart(offset) {
  const today = new Date();
  const dow   = today.getDay(); // 0 = Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getMealsForWeek(offset) {
  if (!state.mealsByWeek[offset]) {
    state.mealsByWeek[offset] = Array(7).fill(null);
    saveMeals();
  }
  return state.mealsByWeek[offset];
}

/**
 * Stage 2 — Grocery list with section headers and checkboxes.
 */
function renderGroceryList() {
  const container = document.getElementById('grocery-list-container');
  if (!container) return;

  const scale = getFamilyScaleFactor();

  // Count total items for the metrics
  state.totalItems = GROCERY_LIST.reduce((sum, section) => sum + section.items.length, 0);
  document.getElementById('total-items').textContent = state.totalItems;
  document.getElementById('remaining-count').textContent = state.totalItems - state.checkedItems;

  container.innerHTML = GROCERY_LIST.map((section, sectionIndex) => `
    <div class="grocery-section">
      <div class="grocery-section-title">${section.category}</div>
      ${section.items.map((item, itemIndex) => `
        <div class="grocery-item">
          <div
            class="grocery-check ${item.checked ? 'checked' : ''}"
            onclick="toggleGroceryItem(${sectionIndex}, ${itemIndex}, this)"
            title="Mark as got it"
          >
            <svg class="check-icon" viewBox="0 0 11 11" fill="none">
              <polyline
                points="1.5,5.5 4.5,8.5 9.5,2.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <span class="grocery-name ${item.checked ? 'checked' : ''}"
                id="grocery-name-${sectionIndex}-${itemIndex}">
            ${item.name}
          </span>
          <span class="grocery-qty">${fmtScaled(item.baseQty, item.unit, scale)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

/**
 * Stage 3 — Store aisle order.
 */
function renderStoreLayout() {
  const container = document.getElementById('store-layout');
  if (!container) return;

  const scale = getFamilyScaleFactor();

  container.innerHTML = STORE_LAYOUT.map((row) => {
    const itemsText = row.itemsList.map(item =>
      `${item.name} (${fmtScaled(item.base, item.unit, scale)})`
    ).join(' · ');
    return `
      <div class="store-row">
        <div class="store-icon">${row.icon}</div>
        <div>
          <div class="store-cat-name">${row.category}</div>
          <div class="store-items-text">${itemsText}</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Stage 4 — Numbered prep steps.
 */
function renderPrepSteps() {
  const container = document.getElementById('prep-steps');
  if (!container) return;

  const scale = getFamilyScaleFactor();

  container.innerHTML = PREP_STEPS.map((step, i) => {
    let desc = step.desc;
    if (step.tokens) {
      for (const [token, qty] of Object.entries(step.tokens)) {
        desc = desc.replace(`{{${token}}}`, fmtScaled(qty.base, qty.unit, scale));
      }
    }
    return `
      <div class="prep-step">
        <div class="step-number">${i + 1}</div>
        <div class="step-body">
          <div class="step-title">${step.title}</div>
          <div class="step-desc">${desc}</div>
          <div class="step-time">${step.time}</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Stage 5 — Portion breakdown table.
 */
function renderPortionTable() {
  const tbody = document.getElementById('portion-table-body');
  if (!tbody) return;

  tbody.innerHTML = PORTIONS.map((p) => {
    const scale = getMemberScaleFactor(p.memberId);
    const chicken  = fmtScaled(p.baseChicken, 'oz',   scale);
    const rice     = fmtCups(p.baseRice * scale);
    const veg      = fmtCups(p.baseVeg  * scale);
    const protein  = `${Math.round(p.baseProtein * scale)}g`;
    const calories = Math.round(p.baseCal * scale);
    return `
      <tr>
        <td>
          <div class="member-cell">
            <div class="avatar ${p.avatarClass}">${p.initials}</div>
            ${p.name}
          </div>
        </td>
        <td>${chicken}</td>
        <td>${rice}</td>
        <td>${veg}</td>
        <td class="highlight-val">${protein}</td>
        <td class="highlight-val">${calories}</td>
      </tr>
    `;
  }).join('');
}


/* ============================================================
   6. INTERACTION HANDLERS
   ============================================================ */

/**
 * Toggle a recipe card selected/deselected on Stage 1.
 * @param {number} index - index into the RECIPES array
 */
function toggleRecipe(index) {
  RECIPES[index].selected = !RECIPES[index].selected;

  // Re-render just the card's class rather than the whole grid
  const card = document.querySelector(`[data-recipe-index="${index}"]`);
  if (card) {
    card.classList.toggle('selected', RECIPES[index].selected);
  }
}

/**
 * Toggle a grocery item checked/unchecked on Stage 2.
 * Updates the data model, the checkbox UI, and the counter metrics.
 *
 * @param {number} sectionIndex - index into GROCERY_LIST
 * @param {number} itemIndex    - index into section.items
 * @param {HTMLElement} checkEl - the clicked .grocery-check element
 */
function toggleGroceryItem(sectionIndex, itemIndex, checkEl) {
  // Flip the value in the data model
  const item = GROCERY_LIST[sectionIndex].items[itemIndex];
  item.checked = !item.checked;

  // Update checkbox appearance
  checkEl.classList.toggle('checked', item.checked);

  // Update the item name strikethrough
  const nameEl = document.getElementById(`grocery-name-${sectionIndex}-${itemIndex}`);
  if (nameEl) {
    nameEl.classList.toggle('checked', item.checked);
  }

  // Update running counters
  state.checkedItems = item.checked
    ? state.checkedItems + 1
    : state.checkedItems - 1;

  document.getElementById('checked-count').textContent = state.checkedItems;
  document.getElementById('remaining-count').textContent = state.totalItems - state.checkedItems;
}


/* ============================================================
   7. MACRO CALCULATOR MODAL
   Uses the Mifflin-St Jeor BMR formula:
     Male:   10×kg + 6.25×cm − 5×age + 5
     Female: 10×kg + 6.25×cm − 5×age − 161
   TDEE = BMR × activity factor.
   Macro split: 30% protein · 25% fat · 45% carbs.
   ============================================================ */

function openMacroCalc() {
  _calc.memberId = MEMBERS[0].id;
  _syncCalcModal();
  document.getElementById('macro-calc-modal').classList.add('open');
}

function closeMacroCalc() {
  document.getElementById('macro-calc-modal').classList.remove('open');
}

function handleModalOverlayClick(e) {
  if (e.target === e.currentTarget) closeMacroCalc();
}

function setCalcMember(memberId) {
  _calc.memberId = memberId;
  _syncCalcModal();
}

function setCalcGender(gender) {
  _calc.gender = gender;
  document.querySelectorAll('.gender-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.gender === gender)
  );
}

function setCalcActivity(factor) {
  _calc.activity = parseFloat(factor);
  document.querySelectorAll('.activity-card').forEach(card =>
    card.classList.toggle('active', parseFloat(card.dataset.factor) === _calc.activity)
  );
}

// Populate modal fields from saved inputs for the current member
function _syncCalcModal() {
  const saved = state.calcInputs[_calc.memberId] || {};
  _calc.gender   = saved.gender   || 'male';
  _calc.activity = saved.activity || 1.55;

  document.getElementById('calc-member-select').value = _calc.memberId;
  document.getElementById('calc-age').value    = saved.age    || '';
  document.getElementById('calc-weight').value = saved.weight || '';
  document.getElementById('calc-feet').value   = saved.feet   || '';
  document.getElementById('calc-inches').value = saved.inches || '';

  document.querySelectorAll('.gender-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.gender === _calc.gender)
  );
  document.querySelectorAll('.activity-card').forEach(card =>
    card.classList.toggle('active', parseFloat(card.dataset.factor) === _calc.activity)
  );

  // Show member name in the modal heading
  const member = MEMBERS.find(m => m.id === _calc.memberId);
  document.getElementById('calc-member-name').textContent =
    member ? `for ${member.name}` : '';
}

function calculateAndApply() {
  const age    = parseInt(document.getElementById('calc-age').value,    10);
  const weight = parseFloat(document.getElementById('calc-weight').value);
  const feet   = parseInt(document.getElementById('calc-feet').value,   10) || 0;
  const inches = parseInt(document.getElementById('calc-inches').value, 10) || 0;

  if (!age || !weight || (feet === 0 && inches === 0)) {
    alert('Please fill in age, weight, and height before calculating.');
    return;
  }

  const kg = weight / 2.2046;
  const cm = (feet * 12 + inches) * 2.54;

  const bmr = _calc.gender === 'male'
    ? (10 * kg) + (6.25 * cm) - (5 * age) + 5
    : (10 * kg) + (6.25 * cm) - (5 * age) - 161;

  const tdee = Math.round(bmr * _calc.activity);

  // 30% protein · 25% fat · 45% carbs
  const maintenance = {
    cal:     tdee,
    protein: Math.round(tdee * 0.30 / 4),
    fat:     Math.round(tdee * 0.25 / 9),
    carbs:   Math.round(tdee * 0.45 / 4),
  };

  // Persist calculator inputs for next time
  state.calcInputs[_calc.memberId] = {
    gender: _calc.gender, activity: _calc.activity,
    age, weight, feet, inches,
  };
  saveCalcInputs();

  // Recompute all three phases from the new maintenance baseline
  PHASES.forEach(p => {
    state.memberMacros[_calc.memberId][p.id] = scalePhase(maintenance, p.factor);
  });
  saveMemberMacros();

  // Switch the member to maintenance so the result is immediately visible
  state.memberPhases[_calc.memberId] = 'maintenance';
  saveMemberPhases();

  closeMacroCalc();
  renderAll();
}
