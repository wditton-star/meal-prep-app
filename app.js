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

// ── Calendar-driven plan engine ─────────────────────────────────
// Aggregates this week's calendar meals into structured data used
// by Stages 2–5. Each member's portion is scaled by their
// active-cal / maintenance-cal ratio so bulking members pull more
// groceries and larger prep quantities.

const _checkedIngredients = new Set(); // in-memory shopping-check state

// Keyword→category map for store layout grouping
const INGREDIENT_CATS = [
  { label: 'Proteins',        icon: '🥩', keys: ['chicken','turkey','beef','salmon','shrimp','tuna','pork','lamb','egg','tofu','sausage','steak','ground','ribeye'] },
  { label: 'Produce',         icon: '🥦', keys: ['broccoli','spinach','pepper','onion','garlic','carrot','potato','tomato','lettuce','kale','zucchini','mushroom','cabbage','cauliflower','celery','avocado','lime','lemon','ginger','snap pea','bell','cucumber','jalapeño','scallion','cilantro','dill','herb','apple','sweet potato','butternut'] },
  { label: 'Grains & Carbs',  icon: '🌾', keys: ['rice','pasta','noodle','oat','bread','flour','quinoa','tortilla','couscous','barley','lentil'] },
  { label: 'Dairy & Eggs',    icon: '🧀', keys: ['milk','cheese','yogurt','cream','butter','egg','feta','parmesan','mozzarella','ricotta','provolone','cheddar','tahini'] },
  { label: 'Canned & Pantry', icon: '🥫', keys: ['broth','stock','sauce','oil','vinegar','soy','coconut','beans','chickpea','tomato','salsa','honey','maple','syrup','peanut','almond','cashew','can '] },
  { label: 'Spices & Sauces', icon: '🧂', keys: ['salt','pepper','seasoning','spice','cumin','paprika','powder','sriracha','mustard','mayo','aioli','dressing','amino','curry','oregano','thyme','basil','turmeric','cinnamon','chili','za\'atar','taco','italian'] },
];

function categorizeIngredient(name) {
  const n = name.toLowerCase();
  for (const cat of INGREDIENT_CATS) {
    if (cat.keys.some(k => n.includes(k))) return cat.label;
  }
  return 'Other';
}

function fmtIngQty(amount, unit) {
  if (!amount) return unit ? `(${unit})` : '—';
  let v = amount >= 10 ? Math.round(amount) : Math.round(amount * 4) / 4;
  const display = v % 1 === 0 ? `${v}` : `${v}`;
  return unit ? `${display} ${unit}` : display;
}

function buildWeekPlan() {
  const days = getMealsForWeek(state.weekOffset);
  const recipeMap = {};     // recipeId → { recipe, instances[], totalScale }
  const ingredientMap = {}; // `name|unit` → { name, unit, amount, fromRecipes }

  for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
    for (const meal of days[dayIdx]) {
      const { recipeId, members } = meal;
      const recipe = [...RECIPES, ...ETG_RECIPES].find(r => r.id === recipeId);
      if (!recipe) continue;

      const portionSum = members.reduce((s, mid) => s + getMemberScaleFactor(mid), 0);
      const batchScale = portionSum / (recipe.servings || 4);

      if (!recipeMap[recipeId]) {
        recipeMap[recipeId] = { recipe, instances: [], totalScale: 0 };
      }
      recipeMap[recipeId].instances.push({ dayIdx, members, batchScale });
      recipeMap[recipeId].totalScale += batchScale;

      if (recipe.ingredients) {
        for (const ing of recipe.ingredients) {
          if (!ing.amount) continue;
          const key = `${ing.name.toLowerCase().trim()}|${ing.unit}`;
          if (!ingredientMap[key]) {
            ingredientMap[key] = { name: ing.name, unit: ing.unit, amount: 0, fromRecipes: new Set() };
          }
          ingredientMap[key].amount += ing.amount * batchScale;
          ingredientMap[key].fromRecipes.add(recipe.name);
        }
      }
    }
  }

  const recipes = Object.values(recipeMap);
  const ingredients = Object.values(ingredientMap)
    .map(i => ({ ...i, fromRecipes: [...i.fromRecipes] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { hasMeals: recipes.length > 0, recipes, ingredients };
}

// ── Batch step generator ────────────────────────────────────────
function generateBatchSteps(plan) {
  const ings = plan.ingredients;
  const find = (re) => ings.filter(i => re.test(i.name.toLowerCase()));

  const grains       = find(/\b(rice|quinoa|oats?|pasta|noodles?|couscous|barley)\b/);
  const bakedProts   = find(/\b(chicken breast|chicken thigh|salmon|pork|tilapia|cod)\b/);
  const stoveProts   = find(/\b(ground turkey|ground beef|shrimp|steak|sausage|chicken(?! breast| thigh))\b/);
  const eggs         = find(/\beggs?\b/);
  const veg          = find(/\b(broccoli|pepper|carrot|onion|sweet potato|potato|zucchini|asparagus|mushroom|cabbage|cauliflower|snap pea|spinach|kale|green bean|tomato|corn)\b/);

  const steps = [];
  let activeMin = 0;
  let parallelCookMin = 0; // longest parallel cook block

  // Helper to build a nice ingredient quantity string
  const qty = (arr) => arr.map(i => `${fmtIngQty(i.amount, i.unit)} ${i.name}`).join(', ');

  // ── Step 1: Start grains first (hands-off, runs in background)
  if (grains.length) {
    const list = qty(grains);
    steps.push({
      title: 'Start the grains',
      desc: `Rinse ${list}. Add to a rice cooker or pot with a 2:1 water-to-grain ratio — use chicken broth instead of water for extra flavor. Set it and move on; this runs hands-off while you do everything else.`,
      active: '5 min active',
      cook: '25–30 min cook',
      activeMin: 5, cookMin: 30,
    });
    activeMin += 5;
    parallelCookMin = Math.max(parallelCookMin, 30);
  }

  // ── Step 2: Preheat oven & season baked proteins
  if (bakedProts.length || veg.length) {
    const protList = bakedProts.length ? qty(bakedProts) : '';
    const desc = bakedProts.length
      ? `Preheat oven to 400°F. Pat ${protList} dry with paper towels. Season generously with salt, pepper, garlic powder, and a drizzle of olive oil. Arrange in a single layer on a lined sheet pan.`
      : 'Preheat oven to 400°F while you prep the vegetables.';
    steps.push({
      title: 'Preheat oven & season proteins',
      desc,
      active: '10 min active',
      cook: '',
      activeMin: 10, cookMin: 0,
    });
    activeMin += 10;
  }

  // ── Step 3: Prep & roast vegetables
  if (veg.length) {
    const vegList = veg.slice(0, 5).map(i => i.name).join(', ');
    const extraNote = bakedProts.length ? ' Slide into the oven alongside the proteins.' : ' Slide into the preheated oven.';
    steps.push({
      title: 'Prep & roast vegetables',
      desc: `Chop ${vegList} into even-sized pieces for uniform cooking. Toss with olive oil, salt, and pepper.${extraNote} Roast at 400°F until tender and slightly caramelized.`,
      active: '10 min active',
      cook: '20–25 min roast',
      activeMin: 10, cookMin: 25,
    });
    activeMin += 10;
    parallelCookMin = Math.max(parallelCookMin, 25);
  }

  // ── Step 4: Bake the proteins (oven is already on)
  if (bakedProts.length) {
    const names = bakedProts.map(i => i.name).join(' & ');
    const tips = bakedProts.map(i => {
      const n = i.name.toLowerCase();
      if (/chicken/.test(n)) return 'chicken: 22–25 min until 165°F internal';
      if (/salmon/.test(n)) return 'salmon: 12–15 min until it flakes easily';
      if (/pork/.test(n))   return 'pork: 20–25 min until 145°F internal';
      return `${i.name}: cook until done`;
    }).join('; ');
    steps.push({
      title: `Bake the ${names}`,
      desc: `Slide the sheet pan into the 400°F oven. ${tips}. Let proteins rest 5 min before slicing — this keeps them juicy.`,
      active: '2 min active',
      cook: '15–25 min bake',
      activeMin: 2, cookMin: 25,
    });
    activeMin += 2;
    parallelCookMin = Math.max(parallelCookMin, 25);
  }

  // ── Step 5: Stovetop proteins
  if (stoveProts.length) {
    const list = qty(stoveProts);
    const recipeNames = [...new Set(stoveProts.flatMap(i => i.fromRecipes))].join(', ');
    steps.push({
      title: 'Cook stovetop proteins',
      desc: `Heat a large skillet over medium-high heat with a splash of oil. Cook ${list}, breaking apart ground meat as it cooks. Season to taste. Used for: ${recipeNames}. Leave sauce additions for serving day — they stay fresher that way.`,
      active: '15 min active',
      cook: '',
      activeMin: 15, cookMin: 0,
    });
    activeMin += 15;
  }

  // ── Step 6: Eggs
  if (eggs.length) {
    const count = fmtIngQty(eggs[0].amount, eggs[0].unit || '');
    steps.push({
      title: 'Hard boil eggs',
      desc: `Place ${count} eggs in a single layer in a saucepan, cover with cold water by 1 inch. Bring to a full boil, then cover and remove from heat. Let sit 10–12 min. Transfer immediately to an ice bath for 5 min. Peel now or refrigerate unpeeled up to a week.`,
      active: '5 min active',
      cook: '15 min cook',
      activeMin: 5, cookMin: 15,
    });
    activeMin += 5;
  }

  // ── Final step: Portion & store (always last)
  const allMemberNames = MEMBERS.map(m => m.name).join(', ');
  steps.push({
    title: 'Cool, portion & store',
    desc: `Let everything cool 15–20 min before sealing containers — hot food creates condensation and shortens shelf life. Divide into individual containers for ${allMemberNames}. Label each with name + day. Refrigerate for up to 4 days; freeze anything beyond that.`,
    active: '20 min active',
    cook: '',
    activeMin: 20, cookMin: 0,
  });
  activeMin += 20;

  // Estimated wall-clock time: active steps run sequentially but oven/cook runs in parallel
  const totalMin = activeMin + parallelCookMin;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const timeLabel = hrs > 0
    ? (mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`)
    : `${mins} min`;

  return { steps, timeLabel };
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
    protein: 48, carbs: 52, fat: 12, calories: 580,
    servings: 4,
    ingredients: [
      { amount: 2,   unit: 'lbs',   name: 'chicken breast' },
      { amount: 2,   unit: 'cups',  name: 'jasmine rice' },
      { amount: 1.5, unit: 'lbs',   name: 'broccoli crowns' },
      { amount: 1,   unit: 'cup',   name: 'bell peppers, sliced' },
      { amount: 2,   unit: 'tbsp',  name: 'olive oil' },
      { amount: 3,   unit: 'tbsp',  name: 'low-sodium soy sauce' },
      { amount: 2,   unit: 'cloves',name: 'garlic, minced' },
      { amount: 0,   unit: '',      name: 'salt and pepper' },
    ],
  },
  {
    id: 'turkey-stirfry',
    name: 'Turkey & veggie stir-fry',
    protein: 42, carbs: 38, fat: 14, calories: 490,
    servings: 4,
    ingredients: [
      { amount: 1.5, unit: 'lbs',  name: 'ground turkey (93% lean)' },
      { amount: 2,   unit: 'cups', name: 'bell peppers, julienned' },
      { amount: 1,   unit: 'cup',  name: 'snap peas' },
      { amount: 1,   unit: 'cup',  name: 'shredded carrots' },
      { amount: 2,   unit: 'cups', name: 'broccoli florets' },
      { amount: 3,   unit: 'tbsp', name: 'low-sodium soy sauce' },
      { amount: 1,   unit: 'tbsp', name: 'sesame oil' },
      { amount: 2,   unit: 'cloves',name: 'garlic, minced' },
      { amount: 1,   unit: 'tsp',  name: 'fresh ginger' },
    ],
  },
  {
    id: 'salmon-sweet-potato',
    name: 'Salmon with roasted sweet potato',
    protein: 40, carbs: 35, fat: 18, calories: 520,
    servings: 4,
    ingredients: [
      { amount: 1.5, unit: 'lbs',  name: 'salmon fillets' },
      { amount: 3,   unit: '',     name: 'medium sweet potatoes, cubed' },
      { amount: 2,   unit: 'tbsp', name: 'olive oil' },
      { amount: 1,   unit: 'tsp',  name: 'garlic powder' },
      { amount: 1,   unit: 'tsp',  name: 'paprika' },
      { amount: 1,   unit: 'tbsp', name: 'lemon juice' },
      { amount: 0,   unit: '',     name: 'salt and pepper' },
    ],
  },
  {
    id: 'beef-taco-bowls',
    name: 'Ground beef taco bowls',
    protein: 38, carbs: 44, fat: 16, calories: 545,
    servings: 4,
    ingredients: [
      { amount: 1.5, unit: 'lbs',  name: 'ground beef (90/10)' },
      { amount: 2,   unit: 'cups', name: 'jasmine rice' },
      { amount: 1,   unit: 'can',  name: 'black beans, drained' },
      { amount: 1,   unit: 'cup',  name: 'salsa' },
      { amount: 2,   unit: 'tbsp', name: 'taco seasoning' },
      { amount: 1,   unit: 'cup',  name: 'shredded cheddar cheese' },
      { amount: 1,   unit: '',     name: 'avocado, sliced' },
      { amount: 0,   unit: '',     name: 'salt and pepper' },
    ],
  },
];

/**
 * ETG_RECIPES — Recipes sourced from eatthegains.com/product-category/meal-prep/.
 * Macros are per-serving as published on each recipe page.
 */
const ETG_RECIPES = [
  { id: 'etg-peanut-butter-and-jelly-smoothie', name: 'Creamy Peanut Butter and Jelly Smoothie (w/ Protein!)', url: 'https://eatthegains.com/peanut-butter-and-jelly-smoothie/', protein: 38, carbs: 57, fat: 26, calories: 585 , servings:1, ingredients:[{amount:1,unit:'cup',name:'frozen berries'},{amount:1,unit:'cup',name:'frozen cauliflower rice'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:2,unit:'tbsp',name:'peanut butter powder'},{amount:1,unit:'tbsp',name:'peanut butter'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:0.25,unit:'tsp',name:'cinnamon'},{amount:0,unit:'',name:'salt'},{amount:1,unit:'cup',name:'milk'},{amount:1,unit:'tsp',name:'peanut butter (for swirling, optional)'}] },
  { id: 'etg-carrot-cake-muffins', name: 'Healthy Carrot Cake Muffins (Gluten-Free)', url: 'https://eatthegains.com/carrot-cake-muffins/', protein: 3, carbs: 28, fat: 5, calories: 163 , servings:9, ingredients:[{amount:1,unit:'cup',name:'1:1 gluten-free flour'},{amount:2,unit:'tsp',name:'cinnamon'},{amount:1,unit:'tsp',name:'ground ginger'},{amount:0.5,unit:'tsp',name:'nutmeg'},{amount:1,unit:'tsp',name:'baking soda'},{amount:1,unit:'tsp',name:'baking powder'},{amount:0.25,unit:'tsp',name:'salt'},{amount:0.5,unit:'cup',name:'unsweetened applesauce'},{amount:1,unit:'',name:'large egg'},{amount:0.3125,unit:'cup',name:'milk'},{amount:0.25,unit:'cup',name:'maple syrup'},{amount:2,unit:'tsp',name:'vanilla extract'},{amount:1,unit:'cup',name:'finely shredded carrots'},{amount:0.25,unit:'cup',name:'raisins'},{amount:0.5,unit:'cup',name:'walnuts, roughly chopped'}] },
  { id: 'etg-egg-roll-in-a-bowl', name: 'Healthy Egg Roll in a Bowl with Chicken', url: 'https://eatthegains.com/egg-roll-in-a-bowl/', protein: 33, carbs: 28, fat: 16, calories: 375 , servings:3, ingredients:[{amount:1,unit:'tbsp',name:'olive oil'},{amount:3,unit:'',name:'cloves garlic, minced'},{amount:1,unit:'tbsp',name:'grated ginger'},{amount:1,unit:'lbs',name:'ground chicken (93/7)'},{amount:1,unit:'cup',name:'sliced onions'},{amount:4,unit:'cup',name:'sliced cabbage'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:2,unit:'cup',name:'diced mushrooms'},{amount:3,unit:'tbsp',name:'coconut aminos'},{amount:2,unit:'tbsp',name:'lime juice'},{amount:0.5,unit:'tbsp',name:'honey'},{amount:1,unit:'tsp',name:'sesame oil'},{amount:0.5,unit:'tsp',name:'fish sauce'},{amount:0.5,unit:'tsp',name:'red pepper flakes'}] },
  { id: 'etg-peanut-butter-protein-balls', name: 'Peanut Butter Protein Balls', url: 'https://eatthegains.com/peanut-butter-protein-balls/', protein: 6, carbs: 10, fat: 5, calories: 104 , servings:15, ingredients:[{amount:1,unit:'cup',name:'medjool dates'},{amount:0.5,unit:'cup',name:'all-natural peanut butter'},{amount:1,unit:'cup',name:'vanilla protein powder'},{amount:4,unit:'tbsp',name:'milk'},{amount:1,unit:'tsp',name:'vanilla bean paste'},{amount:0.25,unit:'tsp',name:'cinnamon'}] },
  { id: 'etg-stuffed-shells-with-meat', name: 'Stuffed Shells with Meat and Ricotta', url: 'https://eatthegains.com/stuffed-shells-with-meat/', protein: 34, carbs: 46, fat: 22, calories: 521 , servings:6, ingredients:[{amount:8,unit:'oz',name:'jumbo pasta shells'},{amount:0.5,unit:'tbsp',name:'olive oil'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'',name:'cloves garlic, minced'},{amount:1,unit:'lbs',name:'lean ground beef'},{amount:1,unit:'tbsp',name:'italian seasoning'},{amount:3,unit:'cup',name:'marinara sauce'},{amount:16,unit:'oz',name:'ricotta cheese'},{amount:1,unit:'',name:'large egg'},{amount:0.5,unit:'cup',name:'parsley, chopped'},{amount:1,unit:'cup',name:'shredded mozzarella'}] },
  { id: 'etg-chili-pasta', name: 'Chili Pasta', url: 'https://eatthegains.com/chili-pasta/', protein: 17, carbs: 30, fat: 6, calories: 233 , servings:10, ingredients:[{amount:1,unit:'tbsp',name:'olive oil'},{amount:1,unit:'cup',name:'diced onion'},{amount:3,unit:'',name:'cloves garlic, minced'},{amount:1,unit:'lbs',name:'lean ground beef'},{amount:1.5,unit:'tbsp',name:'chili powder'},{amount:0.5,unit:'tbsp',name:'cumin'},{amount:0.5,unit:'tbsp',name:'smoked paprika'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can red kidney beans'},{amount:8,unit:'oz',name:'macaroni pasta'},{amount:1,unit:'',name:'can tomato sauce'},{amount:1,unit:'',name:'can fire-roasted diced tomatoes'},{amount:1,unit:'cup',name:'bone broth'}] },
  { id: 'etg-no-bake-peanut-butter-cookies', name: 'No Bake Peanut Butter Cookies', url: 'https://eatthegains.com/no-bake-peanut-butter-cookies/', protein: 5, carbs: 8, fat: 8, calories: 118 , servings:8, ingredients:[{amount:0.5,unit:'cup',name:'all-natural peanut butter'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:1,unit:'tsp',name:'vanilla extract'},{amount:3,unit:'tbsp',name:'peanut butter powder'}] },
  { id: 'etg-hot-honey-chicken', name: 'Sheet Pan Hot Honey Chicken w/ Veggies', url: 'https://eatthegains.com/hot-honey-chicken/', protein: 44, carbs: 65, fat: 20, calories: 602 , servings:4, ingredients:[{amount:2.5,unit:'tbsp',name:'olive oil'},{amount:2,unit:'tbsp',name:'honey'},{amount:1,unit:'tbsp',name:'lemon juice'},{amount:2,unit:'tsp',name:'garlic powder'},{amount:1,unit:'tsp',name:'paprika'},{amount:0.5,unit:'tsp',name:'cayenne pepper'},{amount:1.5,unit:'lbs',name:'chicken thighs'},{amount:3.5,unit:'',name:'large sweet potatoes'},{amount:1,unit:'lbs',name:'brussels sprouts'},{amount:1.5,unit:'tbsp',name:'hot honey'},{amount:0.5,unit:'cup',name:'crumbled goat cheese'},{amount:0.25,unit:'cup',name:'cilantro'}] },
  { id: 'etg-chocolate-protein-bars', name: 'Double Chocolate Protein Bars', url: 'https://eatthegains.com/chocolate-protein-bars/', protein: 10, carbs: 24, fat: 8, calories: 198 , servings:6, ingredients:[{amount:1,unit:'cup',name:'medjool dates, pitted'},{amount:0.25,unit:'cup',name:'tahini'},{amount:4.5,unit:'tbsp',name:'milk'},{amount:0.75,unit:'cup',name:'chocolate protein powder'},{amount:2,unit:'tbsp',name:'dark cocoa powder'},{amount:2,unit:'tsp',name:'vanilla bean paste'},{amount:1.5,unit:'tbsp',name:'mini chocolate chips'}] },
  { id: 'etg-spinach-artichoke-chicken', name: 'Creamy Spinach Artichoke Chicken Skillet', url: 'https://eatthegains.com/spinach-artichoke-chicken/', protein: 33, carbs: 13, fat: 19, calories: 353 , servings:4, ingredients:[{amount:1,unit:'tbsp',name:'butter'},{amount:1,unit:'lbs',name:'chicken cutlets or breasts'},{amount:1,unit:'cup',name:'diced onion'},{amount:3,unit:'',name:'cloves garlic'},{amount:4,unit:'oz',name:'cream cheese'},{amount:1.5,unit:'cup',name:'bone broth'},{amount:1,unit:'tbsp',name:'tapioca flour'},{amount:4,unit:'cup',name:'spinach'},{amount:1,unit:'',name:'can artichoke hearts'}] },
  { id: 'etg-healthy-white-chicken-chili', name: 'Healthy White Chicken Chili', url: 'https://eatthegains.com/healthy-white-chicken-chili/', protein: 24, carbs: 24, fat: 8, calories: 263 , servings:9, ingredients:[{amount:1.5,unit:'cup',name:'diced onion'},{amount:1.5,unit:'lbs',name:'chicken thighs'},{amount:3,unit:'',name:'cloves garlic, minced'},{amount:2,unit:'tsp',name:'cumin'},{amount:2,unit:'tsp',name:'chili powder'},{amount:1,unit:'',name:'can green chiles'},{amount:2,unit:'cup',name:'diced poblano pepper'},{amount:2,unit:'',name:'cans white beans'},{amount:1,unit:'',name:'can sweet corn'},{amount:2,unit:'cup',name:'chicken broth'},{amount:4,unit:'oz',name:'cream cheese'},{amount:2,unit:'tbsp',name:'lime juice'}] },
  { id: 'etg-bbq-chicken-twice-baked-sweet-potatoes', name: 'BBQ Chicken Stuffed Sweet Potatoes', url: 'https://eatthegains.com/bbq-chicken-twice-baked-sweet-potatoes/', protein: 16, carbs: 27, fat: 11, calories: 274 , servings:8, ingredients:[{amount:4,unit:'',name:'medium sweet potatoes'},{amount:1,unit:'cup',name:'diced red onion'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'bbq sauce'},{amount:0.333,unit:'cup',name:'mayo'}] },
  { id: 'etg-homemade-butterfinger', name: 'Homemade Butterfinger', url: 'https://eatthegains.com/homemade-butterfinger/', protein: 4, carbs: 14, fat: 10, calories: 153 , servings:14, ingredients:[{amount:0.75,unit:'cup',name:'crunchy peanut butter'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:1.333,unit:'cup',name:'cornflakes'},{amount:2,unit:'tbsp',name:'coconut flour'},{amount:0.75,unit:'cup',name:'chocolate chips'}] },
  { id: 'etg-pumpkin-oatmeal-muffins', name: 'Pumpkin Oatmeal Muffins (Gluten-Free)', url: 'https://eatthegains.com/pumpkin-oatmeal-muffins/', protein: 5, carbs: 28, fat: 5, calories: 168 , servings:10, ingredients:[{amount:1,unit:'cup',name:'pumpkin puree'},{amount:0.75,unit:'cup',name:'milk'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:2,unit:'tsp',name:'vanilla bean paste'},{amount:2.5,unit:'cup',name:'rolled oats'},{amount:1.5,unit:'tbsp',name:'pumpkin pie spice'},{amount:1,unit:'tsp',name:'baking powder'},{amount:0.333,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-instant-pot-coconut-rice', name: 'Instant Pot Coconut Rice', url: 'https://eatthegains.com/instant-pot-coconut-rice/', protein: 4, carbs: 45, fat: 14, calories: 320 , servings:7, ingredients:[{amount:2,unit:'cup',name:'jasmine rice'},{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:1,unit:'',name:'can lite coconut milk'}] },
  { id: 'etg-taco-stuffed-peppers', name: 'Taco Stuffed Peppers', url: 'https://eatthegains.com/taco-stuffed-peppers/', protein: 22, carbs: 21, fat: 12, calories: 270 , servings:8, ingredients:[{amount:4,unit:'',name:'medium-large bell peppers'},{amount:1,unit:'tbsp',name:'olive oil'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'',name:'cloves garlic, minced'},{amount:1,unit:'lbs',name:'ground turkey'},{amount:2,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'',name:'can fire-roasted diced tomatoes'},{amount:1,unit:'',name:'can black beans'},{amount:1,unit:'cup',name:'frozen corn'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-harvest-chicken-sweet-potato-salad', name: 'Fall Harvest Salad', url: 'https://eatthegains.com/harvest-chicken-sweet-potato-salad/', protein: 38, carbs: 41, fat: 25, calories: 526 , servings:2, ingredients:[{amount:2,unit:'cup',name:'diced sweet potatoes'},{amount:6,unit:'cup',name:'mixed greens'},{amount:1.5,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'diced apple'},{amount:2,unit:'tbsp',name:'dried cranberries'},{amount:2,unit:'tbsp',name:'pumpkin seeds'},{amount:0.333,unit:'cup',name:'goat cheese'},{amount:0.25,unit:'cup',name:'orange vinaigrette'}] },
  { id: 'etg-apple-cinnamon-baked-oatmeal', name: 'Apple Cinnamon Baked Oatmeal (One Pan)', url: 'https://eatthegains.com/apple-cinnamon-baked-oatmeal/', protein: 7, carbs: 31, fat: 8, calories: 216 , servings:9, ingredients:[{amount:2,unit:'',name:'large eggs'},{amount:1,unit:'cup',name:'milk'},{amount:1,unit:'cup',name:'unsweetened apple sauce'},{amount:1,unit:'tbsp',name:'honey'},{amount:2,unit:'tsp',name:'vanilla extract'},{amount:2.5,unit:'cup',name:'rolled oats'},{amount:2,unit:'tsp',name:'cinnamon'},{amount:1,unit:'tsp',name:'baking powder'},{amount:2,unit:'cup',name:'diced apples'},{amount:0.5,unit:'cup',name:'walnuts, roughly chopped'}] },
  { id: 'etg-pumpkin-protein-pancakes', name: 'Pumpkin Protein Pancakes', url: 'https://eatthegains.com/pumpkin-protein-pancakes/', protein: 34, carbs: 60, fat: 16, calories: 512 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:1,unit:'tbsp',name:'coconut flour'},{amount:1,unit:'tsp',name:'baking powder'},{amount:2,unit:'tsp',name:'pumpkin pie spice'},{amount:0.25,unit:'cup',name:'pumpkin puree'},{amount:1,unit:'',name:'large egg'},{amount:0.4375,unit:'cup',name:'milk'}] },
  { id: 'etg-enchilada-pasta', name: 'Cheesy Enchilada Pasta (One Pot)', url: 'https://eatthegains.com/enchilada-pasta/', protein: 42, carbs: 54, fat: 21, calories: 575 , servings:4, ingredients:[{amount:1,unit:'tbsp',name:'olive oil'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'lean ground beef'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:2,unit:'cup',name:'diced mushrooms'},{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'',name:'jar red enchilada sauce'},{amount:1.5,unit:'cup',name:'broth'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-chicken-burrito-bowls', name: 'Chicken Burrito Bowl (High Protein)', url: 'https://eatthegains.com/chicken-burrito-bowls/', protein: 40, carbs: 65, fat: 23, calories: 621 , servings:5, ingredients:[{amount:1.5,unit:'lbs',name:'chicken thighs'},{amount:1,unit:'tbsp',name:'olive oil'},{amount:2,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'cup',name:'jasmine rice'},{amount:0.5,unit:'',name:'large onion, sliced'},{amount:3,unit:'',name:'medium bell peppers'},{amount:2,unit:'',name:'small avocados'},{amount:5,unit:'cup',name:'chopped romaine lettuce'},{amount:1,unit:'',name:'can black beans'},{amount:1,unit:'cup',name:'pico de gallo'},{amount:1,unit:'cup',name:'canned sweet corn'},{amount:1,unit:'cup',name:'shredded monterey jack cheese'}] },
  { id: 'etg-chocolate-overnight-oats', name: 'Chocolate Overnight Oats (High Protein)', url: 'https://eatthegains.com/chocolate-overnight-oats/', protein: 40, carbs: 66, fat: 14, calories: 544 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:1,unit:'scoop',name:'chocolate protein powder'},{amount:1,unit:'tbsp',name:'unsweetened cocoa powder'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:0.667,unit:'cup',name:'milk'}] },
  { id: 'etg-freezer-breakfast-sandwiches', name: 'Freezer Breakfast Sandwiches', url: 'https://eatthegains.com/freezer-breakfast-sandwiches/', protein: 34, carbs: 37, fat: 20, calories: 473 , servings:6, ingredients:[{amount:10,unit:'',name:'eggs'},{amount:1,unit:'cup',name:'cottage cheese'},{amount:6,unit:'',name:'english muffins'},{amount:6,unit:'',name:'chicken sausage patties'},{amount:6,unit:'slice',name:'pepper jack cheese'}] },
  { id: 'etg-no-bake-protein-cookies', name: 'Healthy No Bake Protein Cookies (Vegan)', url: 'https://eatthegains.com/no-bake-protein-cookies/', protein: 6, carbs: 13, fat: 5, calories: 116 , servings:12, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:1,unit:'cup',name:'rolled oats'},{amount:0.375,unit:'cup',name:'peanut butter'},{amount:0.5,unit:'cup',name:'chocolate protein powder'}] },
  { id: 'etg-whole30-tuna-salad', name: 'Healthy Tuna Salad (No Mayo) w/ Apples', url: 'https://eatthegains.com/whole30-tuna-salad/', protein: 31, carbs: 11, fat: 7, calories: 219 , servings:3, ingredients:[{amount:2,unit:'',name:'cans wild-caught tuna'},{amount:1,unit:'cup',name:'diced green apple'},{amount:1,unit:'cup',name:'diced red bell pepper'},{amount:0.333,unit:'cup',name:'diced red onion'},{amount:0.25,unit:'cup',name:'parsley'},{amount:2,unit:'tbsp',name:'tahini'},{amount:2,unit:'tbsp',name:'lemon juice'}] },
  { id: 'etg-chicken-bacon-ranch-pasta-salad', name: 'Chicken Bacon Ranch Pasta Salad', url: 'https://eatthegains.com/chicken-bacon-ranch-pasta-salad/', protein: 16, carbs: 23, fat: 9, calories: 233 , servings:10, ingredients:[{amount:8,unit:'oz',name:'fusilli pasta'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:4,unit:'',name:'pieces bacon'},{amount:2,unit:'cup',name:'cherry tomatoes, halved'},{amount:0.5,unit:'cup',name:'diced green onion'},{amount:1,unit:'',name:'ear corn'},{amount:1,unit:'',name:'large avocado'},{amount:0.25,unit:'cup',name:'dill, chopped'},{amount:0.75,unit:'cup',name:'jalapeno ranch'}] },
  { id: 'etg-protein-chia-pudding', name: 'Protein Chia Pudding', url: 'https://eatthegains.com/protein-chia-pudding/', protein: 19, carbs: 29, fat: 11, calories: 280 , servings:2, ingredients:[{amount:1,unit:'cup',name:'plain greek yogurt'},{amount:1,unit:'cup',name:'milk'},{amount:1,unit:'tbsp',name:'honey'},{amount:1,unit:'tsp',name:'vanilla bean paste'},{amount:0.25,unit:'cup',name:'chia seeds'}] },
  { id: 'etg-chicken-and-egg-salad', name: 'Chicken and Egg Salad (High Protein)', url: 'https://eatthegains.com/chicken-and-egg-salad/', protein: 28, carbs: 4, fat: 9, calories: 215 , servings:6, ingredients:[{amount:3,unit:'cup',name:'shredded chicken'},{amount:6,unit:'',name:'hard-boiled eggs'},{amount:1,unit:'cup',name:'plain greek yogurt'},{amount:1,unit:'tbsp',name:'dijon mustard'},{amount:1,unit:'cup',name:'diced celery'},{amount:0.5,unit:'cup',name:'chopped green onions'},{amount:0.5,unit:'cup',name:'diced dill pickles'},{amount:0.25,unit:'cup',name:'fresh dill'}] },
  { id: 'etg-strawberry-overnight-oats', name: 'Strawberry Overnight Oats', url: 'https://eatthegains.com/strawberry-overnight-oats/', protein: 27, carbs: 66, fat: 13, calories: 474 , servings:2, ingredients:[{amount:1,unit:'cup',name:'diced fresh strawberries'},{amount:1.5,unit:'cup',name:'milk'},{amount:2,unit:'tsp',name:'honey'},{amount:1,unit:'cup',name:'rolled oats'},{amount:1,unit:'cup',name:'plain greek yogurt'},{amount:2,unit:'tbsp',name:'chia seeds'},{amount:1,unit:'tsp',name:'cinnamon'}] },
  { id: 'etg-chopped-salad', name: 'Chopped Salad', url: 'https://eatthegains.com/chopped-salad/', protein: 8, carbs: 11, fat: 7, calories: 135 , servings:8, ingredients:[{amount:6,unit:'cup',name:'chopped romaine lettuce'},{amount:1,unit:'',name:'can chickpeas'},{amount:1,unit:'cup',name:'turkey breast, chopped'},{amount:0.5,unit:'cup',name:'cubed provolone cheese'},{amount:0.5,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:0.333,unit:'cup',name:'diced roasted red peppers'},{amount:0.25,unit:'cup',name:'thinly sliced red onion'},{amount:0.25,unit:'cup',name:'banana peppers'}] },
  { id: 'etg-buffalo-chickpea-salad', name: 'Buffalo Chickpea Salad', url: 'https://eatthegains.com/buffalo-chickpea-salad/', protein: 10, carbs: 24, fat: 8, calories: 204 , servings:7, ingredients:[{amount:2,unit:'',name:'cans chickpeas'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:1,unit:'cup',name:'diced celery'},{amount:1,unit:'cup',name:'diced red bell pepper'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:1,unit:'cup',name:'diced cheddar cheese'},{amount:0.25,unit:'cup',name:'hot sauce'},{amount:0.25,unit:'cup',name:'plain greek yogurt'}] },
  { id: 'etg-chicken-caesar-pasta-salad', name: 'Chicken Caesar Pasta Salad (High Protein)', url: 'https://eatthegains.com/chicken-caesar-pasta-salad/', protein: 23, carbs: 25, fat: 10, calories: 281 , servings:8, ingredients:[{amount:8,unit:'oz',name:'pasta'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:3,unit:'cup',name:'chopped romaine lettuce'},{amount:0.5,unit:'cup',name:'shredded parmesan cheese'},{amount:1.25,unit:'cup',name:'caesar dressing'}] },
  { id: 'etg-chocolate-protein-muffins', name: 'Chocolate Protein Muffins (8g of Protein!)', url: 'https://eatthegains.com/chocolate-protein-muffins/', protein: 9, carbs: 26, fat: 5, calories: 182 , servings:8, ingredients:[{amount:0.5,unit:'cup',name:'gluten-free baking flour'},{amount:0.75,unit:'cup',name:'chocolate protein powder'},{amount:3,unit:'tbsp',name:'cocoa powder'},{amount:1,unit:'tsp',name:'baking powder'},{amount:2,unit:'',name:'medium bananas'},{amount:2,unit:'',name:'large eggs'},{amount:3,unit:'tbsp',name:'milk'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:0.333,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-mediterranean-farro-salad', name: 'Mediterranean Farro Salad w/ Arugula & Feta', url: 'https://eatthegains.com/mediterranean-farro-salad/', protein: 6, carbs: 19, fat: 5, calories: 138 , servings:11, ingredients:[{amount:1,unit:'cup',name:'farro, rinsed'},{amount:4,unit:'cup',name:'arugula'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:1,unit:'cup',name:'diced red onion'},{amount:0.5,unit:'cup',name:'kalamata olives'},{amount:1,unit:'',name:'can quartered artichoke hearts'},{amount:1,unit:'cup',name:'crumbled feta'}] },
  { id: 'etg-salmon-rice-bowls', name: 'Salmon Rice Bowls', url: 'https://eatthegains.com/salmon-rice-bowls/', protein: 42, carbs: 62, fat: 25, calories: 638 , servings:2, ingredients:[{amount:10,unit:'oz',name:'salmon'},{amount:1,unit:'tbsp',name:'coconut aminos'},{amount:1,unit:'tbsp',name:'sriracha'},{amount:2,unit:'tsp',name:'honey'},{amount:1,unit:'tsp',name:'sesame oil'},{amount:0.667,unit:'cup',name:'white rice'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:0.5,unit:'cup',name:'shredded carrots'},{amount:0.5,unit:'cup',name:'shelled edamame'},{amount:0.5,unit:'',name:'avocado, diced'}] },
  { id: 'etg-protein-pancakes', name: 'High Protein Pancakes', url: 'https://eatthegains.com/protein-pancakes/', protein: 37, carbs: 63, fat: 14, calories: 512 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:1,unit:'tbsp',name:'coconut flour'},{amount:1,unit:'tsp',name:'cinnamon'},{amount:0.5,unit:'',name:'ripe banana'},{amount:1,unit:'',name:'large egg'},{amount:0.25,unit:'cup',name:'milk'}] },
  { id: 'etg-greek-chicken-meatballs', name: 'Greek Chicken Meatballs with Feta (Gluten-Free)', url: 'https://eatthegains.com/greek-chicken-meatballs/', protein: 29, carbs: 4, fat: 12, calories: 234 , servings:5, ingredients:[{amount:1.5,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'diced red onion'},{amount:0.5,unit:'cup',name:'feta, crumbled'},{amount:3,unit:'',name:'cloves garlic, minced'},{amount:0.5,unit:'cup',name:'parsley, chopped'},{amount:2,unit:'tsp',name:'dried oregano'}] },
  { id: 'etg-peanut-butter-oatmeal-protein-balls', name: 'Peanut Butter Oatmeal Protein Balls', url: 'https://eatthegains.com/peanut-butter-oatmeal-protein-balls/', protein: 6, carbs: 12, fat: 7, calories: 124 , servings:14, ingredients:[{amount:0.5,unit:'cup',name:'natural peanut butter'},{amount:2,unit:'tbsp',name:'honey'},{amount:1,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:3,unit:'tbsp',name:'mini chocolate chips'}] },
  { id: 'etg-peanut-butter-noodles', name: 'Peanut Butter Noodles with Chicken & Veggies', url: 'https://eatthegains.com/peanut-butter-noodles/', protein: 38, carbs: 76, fat: 20, calories: 641 , servings:4, ingredients:[{amount:8,unit:'oz',name:'rice noodles'},{amount:1,unit:'lbs',name:'chicken'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:2,unit:'cup',name:'julienned carrots'},{amount:2,unit:'cup',name:'julienned bell peppers'},{amount:1,unit:'cup',name:'peanut sauce'}] },
  { id: 'etg-philly-cheesesteak-skillet', name: 'Philly Cheesesteak Skillet (25-Minutes)', url: 'https://eatthegains.com/philly-cheesesteak-skillet/', protein: 33, carbs: 9, fat: 23, calories: 366 , servings:6, ingredients:[{amount:2,unit:'lbs',name:'ribeye steak, sliced thinly'},{amount:2.5,unit:'cup',name:'thinly sliced onion'},{amount:4,unit:'cup',name:'julienned bell peppers'},{amount:2,unit:'cup',name:'sliced mushrooms'},{amount:6,unit:'slice',name:'provolone cheese'}] },
  { id: 'etg-healthy-chicken-salad', name: 'Healthy Chicken Salad with Greek Yogurt', url: 'https://eatthegains.com/healthy-chicken-salad/', protein: 25, carbs: 10, fat: 9, calories: 222 , servings:7, ingredients:[{amount:0.5,unit:'cup',name:'almonds'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:1.5,unit:'cup',name:'grapes, quartered'},{amount:1,unit:'cup',name:'diced celery'},{amount:1,unit:'cup',name:'greek yogurt'},{amount:3,unit:'tbsp',name:'lemon juice'},{amount:1,unit:'tbsp',name:'dijon mustard'},{amount:0.333,unit:'cup',name:'fresh dill'}] },
  { id: 'etg-protein-pudding', name: 'Protein Pudding with Cottage Cheese', url: 'https://eatthegains.com/protein-pudding/', protein: 17, carbs: 22, fat: 9, calories: 226 , servings:4, ingredients:[{amount:2,unit:'cup',name:'full-fat cottage cheese'},{amount:1,unit:'',name:'small avocado'},{amount:0.25,unit:'cup',name:'maple syrup'},{amount:0.25,unit:'cup',name:'chocolate protein powder'},{amount:0.25,unit:'cup',name:'unsweetened cocoa powder'}] },
  { id: 'etg-chicken-enchilada-dip-paleo-whole30', name: 'Chicken Enchilada Dip', url: 'https://eatthegains.com/chicken-enchilada-dip-paleo-whole30/', protein: 24, carbs: 11, fat: 12, calories: 239 , servings:6, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:2,unit:'cup',name:'cauliflower rice'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:0.75,unit:'cup',name:'red enchilada sauce'},{amount:0.75,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-banana-oatmeal-cookies', name: 'Healthy Banana Oatmeal Cookies w/ Chocolate Chips', url: 'https://eatthegains.com/banana-oatmeal-cookies/', protein: 4, carbs: 18, fat: 5, calories: 131 , servings:12, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'cup',name:'rolled oats'},{amount:1,unit:'tsp',name:'cinnamon'},{amount:0.25,unit:'cup',name:'mini chocolate chips'},{amount:0.333,unit:'cup',name:'chopped walnuts'}] },
  { id: 'etg-chicken-quinoa-salad', name: 'Chicken Quinoa Salad', url: 'https://eatthegains.com/chicken-quinoa-salad/', protein: 13, carbs: 23, fat: 9, calories: 220 , servings:14, ingredients:[{amount:6,unit:'cup',name:'butternut squash'},{amount:1,unit:'cup',name:'quinoa, rinsed'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:4,unit:'cup',name:'chopped kale'},{amount:2,unit:'cup',name:'diced bell pepper'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.5,unit:'cup',name:'walnuts'},{amount:0.5,unit:'cup',name:'shaved parmesan cheese'},{amount:0.75,unit:'cup',name:'maple mustard vinaigrette'}] },
  { id: 'etg-creamy-vegan-pasta', name: 'Creamy Vegan Pasta with Veggies', url: 'https://eatthegains.com/creamy-vegan-pasta/', protein: 17, carbs: 64, fat: 20, calories: 491 , servings:4, ingredients:[{amount:8,unit:'oz',name:'penne pasta'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:1,unit:'cup',name:'julienned red bell pepper'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:1,unit:'',name:'can quartered artichokes'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:1.5,unit:'cup',name:'pasta sauce'},{amount:0.75,unit:'cup',name:'raw cashews, soaked'}] },
  { id: 'etg-healthy-chicken-broccoli-rice-casserole', name: 'Healthy Chicken Broccoli Rice Casserole', url: 'https://eatthegains.com/healthy-chicken-broccoli-rice-casserole/', protein: 28, carbs: 24, fat: 12, calories: 319 , servings:8, ingredients:[{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:0.5,unit:'cup',name:'cream cheese'},{amount:5,unit:'cup',name:'broccoli florets'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'white rice, uncooked'},{amount:2,unit:'cup',name:'bone broth'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-protein-french-toast', name: 'Protein French Toast', url: 'https://eatthegains.com/protein-french-toast/', protein: 23, carbs: 49, fat: 9, calories: 371 , servings:2, ingredients:[{amount:2,unit:'',name:'large eggs'},{amount:3,unit:'tbsp',name:'milk'},{amount:0.5,unit:'tsp',name:'vanilla extract'},{amount:0.25,unit:'tsp',name:'cinnamon'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:6,unit:'oz',name:'sourdough bread'}] },
  { id: 'etg-perfect-bar-recipe', name: 'Perfect Bar Recipe', url: 'https://eatthegains.com/perfect-bar-recipe/', protein: 16, carbs: 19, fat: 18, calories: 293 , servings:8, ingredients:[{amount:1,unit:'cup',name:'natural peanut butter'},{amount:1,unit:'cup',name:'egg white protein powder'},{amount:0.25,unit:'cup',name:'maple syrup'},{amount:0.333,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-chicken-parmesan-spaghetti-squash', name: 'Chicken Parmesan Spaghetti Squash Boats', url: 'https://eatthegains.com/chicken-parmesan-spaghetti-squash/', protein: 35, carbs: 44, fat: 27, calories: 533 , servings:4, ingredients:[{amount:2,unit:'',name:'small spaghetti squashes'},{amount:1,unit:'lbs',name:'ground chicken'},{amount:2,unit:'',name:'cloves garlic'},{amount:0.5,unit:'cup',name:'grated parmesan cheese'},{amount:2,unit:'cup',name:'pasta sauce'},{amount:0.75,unit:'cup',name:'shredded mozzarella'}] },
  { id: 'etg-turkey-butternut-squash-soup', name: 'Leftover Turkey Soup with Butternut Squash', url: 'https://eatthegains.com/turkey-butternut-squash-soup/', protein: 17, carbs: 16, fat: 4, calories: 171 , servings:10, ingredients:[{amount:4,unit:'cup',name:'diced butternut squash'},{amount:5,unit:'cup',name:'chicken broth'},{amount:4,unit:'cup',name:'leftover turkey'},{amount:2,unit:'cup',name:'chopped kale'},{amount:1,unit:'',name:'can cannellini beans'},{amount:1,unit:'cup',name:'diced carrots'},{amount:1,unit:'cup',name:'diced celery'},{amount:1,unit:'cup',name:'diced onion'}] },
  { id: 'etg-roasted-parsnips', name: 'Roasted Parsnips with Parmesan and Herbs', url: 'https://eatthegains.com/roasted-parsnips/', protein: 4, carbs: 33, fat: 6, calories: 195 , servings:5, ingredients:[{amount:2,unit:'lbs',name:'parsnips'},{amount:1.5,unit:'tbsp',name:'olive oil'},{amount:0.5,unit:'cup',name:'grated parmesan cheese'}] },
  { id: 'etg-chicken-enchilada-skillet', name: 'Green Chicken Enchilada Skillet', url: 'https://eatthegains.com/chicken-enchilada-skillet/', protein: 38, carbs: 35, fat: 14, calories: 424 , servings:5, ingredients:[{amount:1,unit:'cup',name:'diced yellow onion'},{amount:2,unit:'cup',name:'diced poblano pepper'},{amount:1,unit:'',name:'can black beans'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:1,unit:'',name:'jar green enchilada sauce'},{amount:1,unit:'',name:'can diced green chiles'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:4,unit:'',name:'corn tortillas'},{amount:1,unit:'cup',name:'shredded monterey jack cheese'}] },
  { id: 'etg-peanut-butter-crunch-bars', name: 'Chocolate Peanut Butter Crunch Bars', url: 'https://eatthegains.com/peanut-butter-crunch-bars/', protein: 7, carbs: 15, fat: 12, calories: 177 , servings:10, ingredients:[{amount:0.75,unit:'cup',name:'all-natural peanut butter'},{amount:2,unit:'tbsp',name:'honey'},{amount:0.333,unit:'cup',name:'peanut butter powder'},{amount:1,unit:'cup',name:'cornflakes'},{amount:0.25,unit:'cup',name:'chocolate chips'}] },
  { id: 'etg-chicken-salad-with-apples', name: 'Chicken Salad with Apples & Walnuts', url: 'https://eatthegains.com/chicken-salad-with-apples/', protein: 29, carbs: 16, fat: 11, calories: 268 , servings:6, ingredients:[{amount:4,unit:'cup',name:'shredded chicken'},{amount:1.5,unit:'cup',name:'diced apples'},{amount:1,unit:'cup',name:'diced celery'},{amount:0.5,unit:'cup',name:'walnuts'},{amount:0.333,unit:'cup',name:'diced red onion'},{amount:1,unit:'cup',name:'greek yogurt'},{amount:2,unit:'tbsp',name:'lemon juice'}] },
  { id: 'etg-chicken-and-broccoli-stir-fry', name: 'Healthy Chicken and Broccoli Stir Fry', url: 'https://eatthegains.com/chicken-and-broccoli-stir-fry/', protein: 41, carbs: 32, fat: 16, calories: 446 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:7,unit:'cup',name:'broccoli florets'},{amount:0.5,unit:'cup',name:'chicken broth'},{amount:0.5,unit:'cup',name:'coconut aminos'},{amount:3,unit:'tbsp',name:'lime juice'},{amount:1,unit:'tbsp',name:'sesame oil'},{amount:3,unit:'',name:'cloves garlic'}] },
  { id: 'etg-sausage-peppers-and-potatoes-skillet', name: 'Sausage Peppers and Potatoes Skillet', url: 'https://eatthegains.com/sausage-peppers-and-potatoes-skillet/', protein: 33, carbs: 39, fat: 18, calories: 432 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ground italian sausage'},{amount:1,unit:'lbs',name:'yukon gold potatoes, diced'},{amount:1,unit:'cup',name:'diced onion'},{amount:5,unit:'cup',name:'diced bell peppers'},{amount:1.5,unit:'cup',name:'marinara sauce'},{amount:1,unit:'cup',name:'shredded mozzarella cheese'}] },
  { id: 'etg-protein-pumpkin-chocolate-chip-energy-balls', name: 'Pumpkin Protein Balls with Chocolate Chips', url: 'https://eatthegains.com/protein-pumpkin-chocolate-chip-energy-balls/', protein: 4, carbs: 14, fat: 4, calories: 100 , servings:12, ingredients:[{amount:1,unit:'cup',name:'medjool dates'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:0.25,unit:'cup',name:'pumpkin puree'},{amount:0.25,unit:'cup',name:'cashew butter'},{amount:2,unit:'tbsp',name:'coconut flour'},{amount:2,unit:'tbsp',name:'mini chocolate chips'}] },
  { id: 'etg-air-fryer-brussel-sprouts', name: 'Air Fryer Brussel Sprouts', url: 'https://eatthegains.com/air-fryer-brussel-sprouts/', protein: 5, carbs: 25, fat: 5, calories: 152 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'brussel sprouts'},{amount:1,unit:'tbsp',name:'avocado oil'},{amount:2,unit:'tbsp',name:'coconut aminos'},{amount:1,unit:'tbsp',name:'honey'}] },
  { id: 'etg-curry-noodles', name: 'Curry Noodles with Chicken & Veggies', url: 'https://eatthegains.com/curry-noodles/', protein: 34, carbs: 70, fat: 26, calories: 654 , servings:4, ingredients:[{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:2,unit:'tbsp',name:'red curry paste'},{amount:8,unit:'oz',name:'rice noodles'},{amount:1,unit:'lbs',name:'chicken breasts'},{amount:1,unit:'cup',name:'diced onion'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:2,unit:'cup',name:'julienned bell pepper'},{amount:2,unit:'cup',name:'sliced mushrooms'}] },
  { id: 'etg-gluten-free-pumpkin-muffins', name: 'Gluten Free Pumpkin Muffins with Chocolate Chips', url: 'https://eatthegains.com/gluten-free-pumpkin-muffins/', protein: 3, carbs: 22, fat: 8, calories: 169 , servings:10, ingredients:[{amount:1,unit:'cup',name:'gluten-free baking flour'},{amount:1.17,unit:'cup',name:'pumpkin puree'},{amount:2,unit:'',name:'large eggs'},{amount:0.25,unit:'cup',name:'butter'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:0.333,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-sweetgreen-harvest-bowl', name: 'Sweetgreen Harvest Bowl', url: 'https://eatthegains.com/sweetgreen-harvest-bowl/', protein: 37, carbs: 64, fat: 29, calories: 640 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken thighs'},{amount:0.667,unit:'cup',name:'brown rice, uncooked'},{amount:2,unit:'',name:'small sweet potatoes'},{amount:1,unit:'lbs',name:'brussel sprouts'},{amount:1,unit:'',name:'large apple'},{amount:0.5,unit:'cup',name:'pecans'},{amount:0.5,unit:'cup',name:'goat cheese'},{amount:8,unit:'cup',name:'baby kale'}] },
  { id: 'etg-taco-skillet', name: 'Cheesy Beef Taco Skillet', url: 'https://eatthegains.com/taco-skillet/', protein: 30, carbs: 35, fat: 23, calories: 463 , servings:4, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'lean ground beef'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can fire-roasted diced tomatoes'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'',name:'can black beans'},{amount:1.5,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-fried-sweet-plantains', name: 'Fried Sweet Plantains', url: 'https://eatthegains.com/fried-sweet-plantains/', protein: 1, carbs: 32, fat: 8, calories: 189 , servings:3, ingredients:[{amount:2,unit:'',name:'medium ripe plantains'},{amount:2,unit:'tbsp',name:'butter or ghee'}] },
  { id: 'etg-chipotle-chicken-salad', name: 'Chipotle Chicken Salad with Honey & Lime', url: 'https://eatthegains.com/chipotle-chicken-salad/', protein: 29, carbs: 9, fat: 16, calories: 292 , servings:5, ingredients:[{amount:4,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'diced red bell pepper'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.333,unit:'cup',name:'chipotle mayo'},{amount:2,unit:'tbsp',name:'lime juice'},{amount:0.25,unit:'cup',name:'fresh cilantro'}] },
  { id: 'etg-banana-protein-muffins', name: 'Banana Protein Muffins', url: 'https://eatthegains.com/banana-protein-muffins/', protein: 8, carbs: 25, fat: 5, calories: 174 , servings:8, ingredients:[{amount:0.5,unit:'cup',name:'gluten-free baking flour'},{amount:0.75,unit:'cup',name:'vanilla protein powder'},{amount:2,unit:'',name:'brown bananas'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:0.333,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-italian-tuna-salad', name: 'Italian Tuna Salad with Capers & Olive Oil', url: 'https://eatthegains.com/italian-tuna-salad/', protein: 43, carbs: 4, fat: 12, calories: 281 , servings:4, ingredients:[{amount:4,unit:'',name:'cans tuna in water'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.667,unit:'cup',name:'parsley'},{amount:0.25,unit:'cup',name:'nonpareil capers'},{amount:3,unit:'tbsp',name:'olive oil'},{amount:0.25,unit:'cup',name:'lemon juice'}] },
  { id: 'etg-chocolate-peanut-butter-protein-balls', name: 'Chocolate Peanut Butter Protein Balls', url: 'https://eatthegains.com/chocolate-peanut-butter-protein-balls/', protein: 6, carbs: 9, fat: 8, calories: 126 , servings:18, ingredients:[{amount:1,unit:'cup',name:'natural peanut butter'},{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'chocolate protein powder'},{amount:0.25,unit:'cup',name:'milk'},{amount:3,unit:'tbsp',name:'maple syrup'},{amount:2,unit:'tbsp',name:'cocoa powder'}] },
  { id: 'etg-chicken-and-rice-bowl', name: 'Summer Grilled Chicken and Rice Bowl', url: 'https://eatthegains.com/chicken-and-rice-bowl/', protein: 39, carbs: 53, fat: 29, calories: 631 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'chicken thighs'},{amount:0.25,unit:'cup',name:'coconut aminos'},{amount:1,unit:'cup',name:'white rice'},{amount:13.5,unit:'oz',name:'full-fat coconut milk'},{amount:2,unit:'cup',name:'mango cucumber salsa'},{amount:4,unit:'cup',name:'chopped romaine'},{amount:1,unit:'',name:'small avocado'}] },
  { id: 'etg-southwest-chicken-salad', name: 'Southwest Chicken Salad', url: 'https://eatthegains.com/southwest-chicken-salad/', protein: 43, carbs: 41, fat: 20, calories: 503 , servings:2, ingredients:[{amount:6,unit:'cup',name:'chopped romaine lettuce'},{amount:1.5,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'',name:'can black beans'},{amount:0.5,unit:'cup',name:'corn'},{amount:0.5,unit:'cup',name:'cherry tomatoes'},{amount:0.5,unit:'',name:'avocado'},{amount:0.5,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-chicken-zucchini-meatballs', name: 'Chicken Zucchini Meatballs with Parmesan & Herbs', url: 'https://eatthegains.com/chicken-zucchini-meatballs/', protein: 27, carbs: 5, fat: 11, calories: 219 , servings:20, ingredients:[{amount:1,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'shredded zucchini'},{amount:0.5,unit:'cup',name:'diced onion'},{amount:0.5,unit:'cup',name:'shredded parmesan cheese'},{amount:2,unit:'tbsp',name:'almond flour'},{amount:2,unit:'',name:'cloves garlic'}] },
  { id: 'etg-sesame-noodles', name: 'Sesame Noodles with Chicken & Broccoli', url: 'https://eatthegains.com/sesame-noodles/', protein: 21, carbs: 25, fat: 11, calories: 275 , servings:10, ingredients:[{amount:8,unit:'oz',name:'udon noodles'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:6,unit:'cup',name:'broccoli florets'},{amount:1,unit:'cup',name:'sliced green onion'},{amount:0.5,unit:'cup',name:'tahini'},{amount:0.25,unit:'cup',name:'coconut aminos'},{amount:1,unit:'tbsp',name:'sesame oil'},{amount:1,unit:'tbsp',name:'honey'}] },
  { id: 'etg-coffee-overnight-oats', name: 'Coffee Overnight Oats', url: 'https://eatthegains.com/coffee-overnight-oats/', protein: 26, carbs: 56, fat: 21, calories: 506 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:0.75,unit:'cup',name:'greek yogurt'},{amount:1,unit:'tbsp',name:'cashew butter'},{amount:0.5,unit:'cup',name:'cold brew coffee'}] },
  { id: 'etg-taco-bowls', name: 'Ground Beef Taco Bowls', url: 'https://eatthegains.com/taco-bowls/', protein: 37, carbs: 65, fat: 22, calories: 602 , servings:4, ingredients:[{amount:1,unit:'cup',name:'white rice'},{amount:1,unit:'lbs',name:'lean ground beef'},{amount:1,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'',name:'can black beans'},{amount:4,unit:'cup',name:'chopped romaine lettuce'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:0.5,unit:'cup',name:'shredded cheddar cheese'},{amount:1,unit:'',name:'small avocado'}] },
  { id: 'etg-oatmeal-raisin-bars', name: 'Oatmeal Raisin Bars', url: 'https://eatthegains.com/oatmeal-raisin-bars/', protein: 12, carbs: 28, fat: 10, calories: 238 , servings:8, ingredients:[{amount:1.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:0.5,unit:'cup',name:'cashew butter'},{amount:0.5,unit:'cup',name:'raisins'},{amount:0.3125,unit:'cup',name:'milk'},{amount:1,unit:'tbsp',name:'honey'}] },
  { id: 'etg-paleo-cilantro-lime-chicken-salad', name: 'Cilantro Lime Chicken Salad', url: 'https://eatthegains.com/paleo-cilantro-lime-chicken-salad/', protein: 39, carbs: 3, fat: 7, calories: 238 , servings:4, ingredients:[{amount:0.75,unit:'cup',name:'greek yogurt'},{amount:0.25,unit:'cup',name:'lime juice'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'cilantro'}] },
  { id: 'etg-beef-and-broccoli-noodles', name: 'Beef and Broccoli Noodles', url: 'https://eatthegains.com/beef-and-broccoli-noodles/', protein: 33, carbs: 68, fat: 18, calories: 575 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ground beef'},{amount:5,unit:'cup',name:'broccoli florets'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:8,unit:'oz',name:'ramen noodles'},{amount:0.5,unit:'cup',name:'coconut aminos'},{amount:0.5,unit:'cup',name:'bone broth'},{amount:1,unit:'tbsp',name:'sesame oil'},{amount:4,unit:'',name:'cloves garlic'}] },
  { id: 'etg-sesame-garlic-green-beans', name: 'Sesame Green Beans with Garlic', url: 'https://eatthegains.com/sesame-garlic-green-beans/', protein: 4, carbs: 15, fat: 8, calories: 140 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'green beans'},{amount:3,unit:'',name:'cloves garlic'},{amount:1.5,unit:'tbsp',name:'coconut aminos'},{amount:1,unit:'tsp',name:'sesame oil'},{amount:1,unit:'tbsp',name:'sesame seeds'}] },
  { id: 'etg-protein-overnight-oats', name: 'High Protein Overnight Oats', url: 'https://eatthegains.com/protein-overnight-oats/', protein: 38, carbs: 64, fat: 14, calories: 536 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:1,unit:'scoop',name:'vanilla protein powder'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:0.66,unit:'cup',name:'milk'}] },
  { id: 'etg-cottage-cheese-pasta', name: 'Creamy Cottage Cheese Pasta', url: 'https://eatthegains.com/cottage-cheese-pasta/', protein: 37, carbs: 60, fat: 20, calories: 562 , servings:4, ingredients:[{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'ground turkey'},{amount:2,unit:'cup',name:'diced red bell pepper'},{amount:3,unit:'cup',name:'spinach'},{amount:2,unit:'cup',name:'pasta sauce'},{amount:1,unit:'cup',name:'cottage cheese'}] },
  { id: 'etg-red-chicken-enchiladas', name: 'Healthy Chicken Enchiladas with Red Sauce', url: 'https://eatthegains.com/red-chicken-enchiladas/', protein: 16, carbs: 18, fat: 11, calories: 224 , servings:10, ingredients:[{amount:1.5,unit:'cup',name:'red enchilada sauce'},{amount:1,unit:'cup',name:'diced onion'},{amount:1.5,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'cup',name:'diced zucchini'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:10,unit:'',name:'corn tortillas'},{amount:1,unit:'cup',name:'shredded cheese'}] },
  { id: 'etg-greek-sheet-pan-chicken', name: 'Greek Sheet Pan Chicken with Potatoes & Veggies', url: 'https://eatthegains.com/greek-sheet-pan-chicken/', protein: 41, carbs: 42, fat: 24, calories: 541 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'chicken thighs'},{amount:1.5,unit:'lbs',name:'baby potatoes'},{amount:2,unit:'cup',name:'julienned bell pepper'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:0.5,unit:'cup',name:'feta cheese'},{amount:0.5,unit:'cup',name:'kalamata olives'},{amount:1,unit:'cup',name:'julienned red onion'}] },
  { id: 'etg-chocolate-oatmeal-muffins', name: 'Double Chocolate Oatmeal Muffins', url: 'https://eatthegains.com/chocolate-oatmeal-muffins/', protein: 5, carbs: 31, fat: 7, calories: 196 , servings:10, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:0.75,unit:'cup',name:'milk'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:2.5,unit:'cup',name:'rolled oats'},{amount:2.5,unit:'tbsp',name:'cocoa powder'},{amount:0.5,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-hummus-chicken-salad', name: 'Hummus Chicken Salad with Veggies', url: 'https://eatthegains.com/hummus-chicken-salad/', protein: 26, carbs: 12, fat: 9, calories: 232 , servings:6, ingredients:[{amount:4,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'diced red bell pepper'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:1,unit:'',name:'container hummus'},{amount:0.25,unit:'cup',name:'lemon juice'}] },
  { id: 'etg-ground-turkey-sweet-potato-skillet', name: 'Ground Turkey Sweet Potato Skillet', url: 'https://eatthegains.com/ground-turkey-sweet-potato-skillet/', protein: 33, carbs: 45, fat: 13, calories: 417 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ground turkey'},{amount:6,unit:'cup',name:'diced sweet potatoes'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:3,unit:'cup',name:'chopped kale'},{amount:0.75,unit:'cup',name:'shredded pepper jack cheese'}] },
  { id: 'etg-protein-peanut-butter-cups', name: 'Protein Peanut Butter Cups', url: 'https://eatthegains.com/protein-peanut-butter-cups/', protein: 6, carbs: 8, fat: 7, calories: 114 , servings:12, ingredients:[{amount:0.5,unit:'cup',name:'natural peanut butter'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:0.25,unit:'cup',name:'chocolate chips'}] },
  { id: 'etg-sheet-pan-sausage-and-veggies', name: 'Sheet Pan Sausage and Veggies', url: 'https://eatthegains.com/sheet-pan-sausage-and-veggies/', protein: 40, carbs: 65, fat: 14, calories: 524 , servings:2, ingredients:[{amount:3,unit:'cup',name:'diced sweet potato'},{amount:1,unit:'cup',name:'sliced yellow onion'},{amount:2,unit:'cup',name:'julienned red bell pepper'},{amount:2,unit:'cup',name:'baby broccoli'},{amount:1,unit:'',name:'package chicken sausage'},{amount:1,unit:'tbsp',name:'taco seasoning'}] },
  { id: 'etg-buffalo-chicken-casserole-rice', name: 'Buffalo Chicken Casserole with Rice', url: 'https://eatthegains.com/buffalo-chicken-casserole-rice/', protein: 34, carbs: 50, fat: 20, calories: 521 , servings:4, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'cup',name:'diced carrots'},{amount:1,unit:'cup',name:'diced celery'},{amount:2,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'cup',name:'white rice'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:2,unit:'cup',name:'chicken broth'},{amount:0.75,unit:'cup',name:'buffalo sauce'},{amount:0.5,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-cottage-cheese-muffins', name: 'Cottage Cheese Muffins', url: 'https://eatthegains.com/cottage-cheese-muffins/', protein: 7, carbs: 21, fat: 6, calories: 159 , servings:9, ingredients:[{amount:1,unit:'cup',name:'cottage cheese'},{amount:1.25,unit:'cup',name:'rolled oats'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:2,unit:'tsp',name:'baking powder'},{amount:2,unit:'tsp',name:'cinnamon'},{amount:0.25,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-coconut-curry-lentil-soup', name: 'Coconut Curry Lentil Soup', url: 'https://eatthegains.com/coconut-curry-lentil-soup/', protein: 11, carbs: 34, fat: 12, calories: 275 , servings:8, ingredients:[{amount:1,unit:'tbsp',name:'coconut oil'},{amount:1,unit:'tbsp',name:'curry powder'},{amount:1,unit:'cup',name:'diced carrots'},{amount:1,unit:'cup',name:'diced onion'},{amount:1.5,unit:'cup',name:'brown lentils'},{amount:2,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:1,unit:'',name:'can diced tomatoes'},{amount:4,unit:'cup',name:'vegetable broth'}] },
  { id: 'etg-chicken-sweet-potato-soup', name: 'Chipotle Chicken Sweet Potato Soup', url: 'https://eatthegains.com/chicken-sweet-potato-soup/', protein: 15, carbs: 23, fat: 5, calories: 194 , servings:10, ingredients:[{amount:1,unit:'cup',name:'diced onions'},{amount:1,unit:'',name:'can fire roasted diced tomatoes'},{amount:4,unit:'cup',name:'diced sweet potatoes'},{amount:1,unit:'lbs',name:'chicken breasts'},{amount:2.5,unit:'cup',name:'chicken broth'},{amount:0.5,unit:'cup',name:'full-fat coconut milk'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can black beans'}] },
  { id: 'etg-ground-turkey-pasta', name: 'Ground Turkey Pasta with Veggies', url: 'https://eatthegains.com/ground-turkey-pasta/', protein: 17, carbs: 27, fat: 10, calories: 258 , servings:8, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'lean ground turkey'},{amount:2,unit:'cup',name:'diced zucchini'},{amount:2,unit:'cup',name:'diced mushroom'},{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'',name:'jar pasta sauce'},{amount:2,unit:'cup',name:'spinach'}] },
  { id: 'etg-instant-pot-bbq-chicken', name: 'Instant Pot BBQ Chicken', url: 'https://eatthegains.com/instant-pot-bbq-chicken/', protein: 44, carbs: 5, fat: 5, calories: 279 , servings:7, ingredients:[{amount:3,unit:'lbs',name:'chicken breast'},{amount:1,unit:'cup',name:'bbq sauce'},{amount:0.333,unit:'cup',name:'chicken broth'}] },
  { id: 'etg-pumpkin-baked-oatmeal', name: 'Pumpkin Baked Oatmeal with Cranberries', url: 'https://eatthegains.com/pumpkin-baked-oatmeal/', protein: 7, carbs: 32, fat: 7, calories: 216 , servings:9, ingredients:[{amount:1,unit:'',name:'can pumpkin puree'},{amount:0.5,unit:'cup',name:'milk'},{amount:2,unit:'',name:'large eggs'},{amount:0.25,unit:'cup',name:'almond butter'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:2.25,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'dried cranberries'}] },
  { id: 'etg-steak-fajita-stuffed-sweet-potatoes-paleo-whole30', name: 'Steak Fajita Stuffed Sweet Potatoes', url: 'https://eatthegains.com/steak-fajita-stuffed-sweet-potatoes-paleo-whole30/', protein: 34, carbs: 53, fat: 15, calories: 488 , servings:4, ingredients:[{amount:4,unit:'',name:'small sweet potatoes'},{amount:1,unit:'lbs',name:'flank steak'},{amount:0.5,unit:'',name:'large onion, diced'},{amount:4,unit:'',name:'medium bell peppers'},{amount:1,unit:'tbsp',name:'taco seasoning'},{amount:2,unit:'tbsp',name:'lime juice'}] },
  { id: 'etg-chicken-fajita-casserole', name: 'Chicken Fajita Casserole with Rice', url: 'https://eatthegains.com/chicken-fajita-casserole/', protein: 21, carbs: 32, fat: 7, calories: 280 , servings:10, ingredients:[{amount:1.5,unit:'lbs',name:'chicken breast'},{amount:2,unit:'tbsp',name:'taco seasoning'},{amount:3,unit:'cup',name:'julienned onion'},{amount:5,unit:'cup',name:'julienned bell peppers'},{amount:1.5,unit:'cup',name:'brown rice'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:1,unit:'',name:'can fire-roasted tomatoes'},{amount:1.75,unit:'cup',name:'chicken broth'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-greek-chicken-bowls', name: 'Greek Chicken Bowls', url: 'https://eatthegains.com/greek-chicken-bowls/', protein: 34, carbs: 52, fat: 23, calories: 550 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken thighs'},{amount:1.5,unit:'cup',name:'cherry tomatoes'},{amount:1.5,unit:'cup',name:'diced cucumbers'},{amount:0.5,unit:'cup',name:'kalamata olives'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:1,unit:'cup',name:'white rice'},{amount:0.5,unit:'cup',name:'tzatziki sauce'},{amount:8,unit:'cup',name:'chopped romaine'}] },
  { id: 'etg-baked-potato-wedges', name: 'Baked Potato Wedges', url: 'https://eatthegains.com/baked-potato-wedges/', protein: 3, carbs: 29, fat: 6, calories: 173 , servings:5, ingredients:[{amount:2,unit:'lbs',name:'russet potatoes'},{amount:2,unit:'tbsp',name:'olive oil'}] },
  { id: 'etg-turkey-kale-ranch-casserole', name: 'Ground Turkey Spaghetti Squash Casserole', url: 'https://eatthegains.com/turkey-kale-ranch-casserole/', protein: 19, carbs: 13, fat: 16, calories: 263 , servings:6, ingredients:[{amount:1,unit:'',name:'small spaghetti squash'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'lean ground turkey'},{amount:3,unit:'cup',name:'packed kale'},{amount:3,unit:'',name:'large eggs'}] },
  { id: 'etg-chocolate-peppermint-energy-balls', name: 'Chocolate Peppermint Energy Balls', url: 'https://eatthegains.com/chocolate-peppermint-energy-balls/', protein: 4, carbs: 11, fat: 4, calories: 81 , servings:12, ingredients:[{amount:1,unit:'cup',name:'pitted medjool dates'},{amount:2,unit:'tbsp',name:'dark cocoa powder'},{amount:3,unit:'tbsp',name:'coconut butter'},{amount:0.5,unit:'tsp',name:'peppermint extract'},{amount:3,unit:'tbsp',name:'unsweetened shredded coconut'}] },
  { id: 'etg-whole30-sweet-potato-and-sausage-casserole', name: 'Sweet Potato Breakfast Casserole with Sausage', url: 'https://eatthegains.com/whole30-sweet-potato-and-sausage-casserole/', protein: 23, carbs: 22, fat: 19, calories: 357 , servings:6, ingredients:[{amount:1,unit:'lbs',name:'lean ground sausage'},{amount:3,unit:'cup',name:'diced sweet potatoes'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'cup',name:'diced yellow onion'},{amount:10,unit:'',name:'large eggs'}] },
  { id: 'etg-chicken-fajita-soup', name: 'Chicken Fajita Soup with Rice', url: 'https://eatthegains.com/chicken-fajita-soup/', protein: 17, carbs: 26, fat: 3, calories: 202 , servings:9, ingredients:[{amount:1,unit:'cup',name:'diced yellow onion'},{amount:1,unit:'lbs',name:'chicken breast'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:3,unit:'cup',name:'diced bell peppers'},{amount:0.75,unit:'cup',name:'white rice'},{amount:1,unit:'',name:'can fire-roasted diced tomatoes'},{amount:4,unit:'cup',name:'chicken broth'},{amount:1,unit:'',name:'can black beans'}] },
  { id: 'etg-leftover-turkey-salad', name: 'Leftover Turkey Salad with Apples & Walnuts', url: 'https://eatthegains.com/leftover-turkey-salad/', protein: 25, carbs: 8, fat: 8, calories: 198 , servings:6, ingredients:[{amount:4,unit:'cup',name:'leftover turkey meat'},{amount:0.667,unit:'cup',name:'diced apple'},{amount:0.5,unit:'cup',name:'diced celery'},{amount:0.333,unit:'cup',name:'walnuts'},{amount:0.25,unit:'cup',name:'cranberry sauce'},{amount:0.5,unit:'cup',name:'greek yogurt'}] },
  { id: 'etg-green-beans-with-mushrooms-and-bacon-paleo-whole30', name: 'Green Beans and Mushrooms with Bacon', url: 'https://eatthegains.com/green-beans-with-mushrooms-and-bacon-paleo-whole30/', protein: 6, carbs: 16, fat: 10, calories: 166 , servings:4, ingredients:[{amount:4,unit:'',name:'pieces bacon'},{amount:1.5,unit:'lbs',name:'green beans'},{amount:2,unit:'',name:'cloves garlic'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:0.25,unit:'cup',name:'full-fat coconut milk'}] },
  { id: 'etg-tahini-whipped-sweet-potatoes', name: 'Tahini Whipped Sweet Potatoes', url: 'https://eatthegains.com/tahini-whipped-sweet-potatoes/', protein: 3, carbs: 36, fat: 4, calories: 181 , servings:4, ingredients:[{amount:4,unit:'',name:'small-medium sweet potatoes'},{amount:3,unit:'tbsp',name:'tahini'},{amount:0.5,unit:'tsp',name:'cinnamon'}] },
  { id: 'etg-cinnamon-roasted-delicata-squash', name: 'Roasted Delicata Squash', url: 'https://eatthegains.com/cinnamon-roasted-delicata-squash/', protein: 2, carbs: 18, fat: 5, calories: 116 , servings:4, ingredients:[{amount:3,unit:'',name:'small-medium delicata squash'},{amount:1.5,unit:'tbsp',name:'olive oil'},{amount:2,unit:'tsp',name:'cinnamon'}] },
  { id: 'etg-kale-beef-stuffed-butternut-squash', name: 'Stuffed Butternut Squash with Beef & Kale', url: 'https://eatthegains.com/kale-beef-stuffed-butternut-squash/', protein: 30, carbs: 67, fat: 18, calories: 518 , servings:4, ingredients:[{amount:2,unit:'',name:'small butternut squashes'},{amount:1,unit:'lbs',name:'ground beef'},{amount:4,unit:'cup',name:'packed kale'},{amount:2,unit:'tbsp',name:'tahini'},{amount:1,unit:'tbsp',name:'coconut aminos'}] },
  { id: 'etg-cranberry-pecan-chicken-salad-paleo-whole30', name: 'Cranberry Pecan Chicken Salad', url: 'https://eatthegains.com/cranberry-pecan-chicken-salad-paleo-whole30/', protein: 30, carbs: 13, fat: 26, calories: 399 , servings:5, ingredients:[{amount:4,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'chopped celery'},{amount:0.5,unit:'cup',name:'pecans'},{amount:0.5,unit:'cup',name:'dried cranberries'},{amount:0.25,unit:'cup',name:'mayo'},{amount:2,unit:'tbsp',name:'lemon juice'}] },
  { id: 'etg-air-fryer-carrots', name: 'Air Fryer Carrots', url: 'https://eatthegains.com/air-fryer-carrots/', protein: 1, carbs: 11, fat: 2, calories: 63 , servings:4, ingredients:[{amount:2,unit:'lbs',name:'carrots'},{amount:1,unit:'tbsp',name:'olive oil'}] },
  { id: 'etg-paleo-buffalo-chicken-enchiladas', name: 'Buffalo Chicken Enchiladas', url: 'https://eatthegains.com/paleo-buffalo-chicken-enchiladas/', protein: 19, carbs: 13, fat: 11, calories: 223 , servings:10, ingredients:[{amount:1,unit:'cup',name:'buffalo sauce'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:10,unit:'',name:'corn tortillas'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-brownie-baked-oatmeal', name: 'Brownie Baked Oatmeal', url: 'https://eatthegains.com/brownie-baked-oatmeal/', protein: 7, carbs: 28, fat: 9, calories: 206 , servings:9, ingredients:[{amount:1,unit:'',name:'brown banana'},{amount:2,unit:'',name:'large eggs'},{amount:0.25,unit:'cup',name:'tahini'},{amount:2,unit:'tbsp',name:'maple syrup'},{amount:0.25,unit:'cup',name:'unsweetened cocoa powder'},{amount:2,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'chocolate chips'}] },
  { id: 'etg-spaghetti-squash-casserole', name: 'Chili Spaghetti Squash Casserole', url: 'https://eatthegains.com/spaghetti-squash-casserole/', protein: 32, carbs: 25, fat: 15, calories: 358 , servings:8, ingredients:[{amount:1,unit:'',name:'medium-large spaghetti squash'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'lbs',name:'lean ground beef'},{amount:4,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can fire-roasted tomatoes'},{amount:1,unit:'',name:'can black beans'},{amount:2,unit:'',name:'large eggs'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-cheesy-rice', name: 'Cheesy Rice', url: 'https://eatthegains.com/cheesy-rice/', protein: 11, carbs: 48, fat: 11, calories: 341 , servings:6, ingredients:[{amount:2,unit:'cup',name:'long-grain rice'},{amount:2,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-pumpkin-overnight-oats', name: 'Pumpkin Overnight Oats', url: 'https://eatthegains.com/pumpkin-overnight-oats/', protein: 32, carbs: 57, fat: 19, calories: 523 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:0.25,unit:'cup',name:'pumpkin puree'},{amount:0.25,unit:'cup',name:'greek yogurt'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:0.5,unit:'cup',name:'milk'}] },
  { id: 'etg-protein-waffles', name: 'Protein Waffles', url: 'https://eatthegains.com/protein-waffles/', protein: 33, carbs: 30, fat: 13, calories: 376 , servings:1, ingredients:[{amount:0.25,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'vanilla protein powder'},{amount:1,unit:'',name:'large egg'},{amount:0.5,unit:'cup',name:'greek yogurt'}] },
  { id: 'etg-jalapeno-popper-chicken-casserole', name: 'Jalapeno Popper Chicken Casserole', url: 'https://eatthegains.com/jalapeno-popper-chicken-casserole/', protein: 31, carbs: 19, fat: 19, calories: 366 , servings:4, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1.25,unit:'cup',name:'diced green pepper'},{amount:2,unit:'cup',name:'cauliflower rice'},{amount:1,unit:'cup',name:'greek yogurt'},{amount:0.5,unit:'cup',name:'cream cheese'},{amount:2,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'diced jalapeños'},{amount:0.5,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-pistachio-coconut-baked-chicken-tenders', name: 'Pistachio Crusted Chicken Tenders', url: 'https://eatthegains.com/pistachio-coconut-baked-chicken-tenders/', protein: 32, carbs: 9, fat: 16, calories: 301 , servings:6, ingredients:[{amount:1.5,unit:'lbs',name:'chicken tenders'},{amount:0.667,unit:'cup',name:'shelled pistachios'},{amount:0.5,unit:'cup',name:'unsweetened shredded coconut'},{amount:0.25,unit:'cup',name:'coconut flour'},{amount:2,unit:'',name:'large eggs'}] },
  { id: 'etg-chicken-and-corn-skillet', name: 'Cheesy Chicken and Corn Skillet', url: 'https://eatthegains.com/chicken-and-corn-skillet/', protein: 37, carbs: 46, fat: 17, calories: 456 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can black beans'},{amount:2,unit:'cup',name:'sweet corn kernels'},{amount:0.5,unit:'cup',name:'salsa'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-peanut-butter-oatmeal-chocolate-chip-bars', name: 'Healthy Oatmeal Chocolate Chip Bars', url: 'https://eatthegains.com/peanut-butter-oatmeal-chocolate-chip-bars/', protein: 7, carbs: 32, fat: 12, calories: 246 , servings:9, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:0.5,unit:'cup',name:'peanut butter'},{amount:0.5,unit:'cup',name:'milk'},{amount:2,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'semi-sweet chocolate chips'}] },
  { id: 'etg-avocado-chicken-salad', name: 'Avocado Chicken Salad', url: 'https://eatthegains.com/avocado-chicken-salad/', protein: 31, carbs: 7, fat: 12, calories: 259 , servings:5, ingredients:[{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:2,unit:'',name:'small-medium avocados'},{amount:2,unit:'tbsp',name:'lime juice'},{amount:4,unit:'cup',name:'shredded chicken'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.333,unit:'cup',name:'cilantro'}] },
  { id: 'etg-apple-cinnamon-protein-cookies', name: 'Apple Cinnamon Oatmeal Protein Cookies', url: 'https://eatthegains.com/apple-cinnamon-protein-cookies/', protein: 4, carbs: 10, fat: 1, calories: 63 , servings:14, ingredients:[{amount:1.25,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'unsweetened apple sauce'},{amount:0.5,unit:'cup',name:'egg whites'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:1.5,unit:'cup',name:'diced apple'},{amount:1,unit:'tbsp',name:'cinnamon'}] },
  { id: 'etg-paleo-loaded-roasted-potato-salad', name: 'Roasted Potato Salad with Bacon & Broccoli', url: 'https://eatthegains.com/paleo-loaded-roasted-potato-salad/', protein: 5, carbs: 27, fat: 12, calories: 229 , servings:9, ingredients:[{amount:3,unit:'lbs',name:'red potatoes'},{amount:5,unit:'',name:'pieces bacon'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:1,unit:'cup',name:'chopped green onions'},{amount:0.333,unit:'cup',name:'mayo'}] },
  { id: 'etg-raw-summer-corn-salad', name: 'Summer Corn Salad with Tomato & Avocado', url: 'https://eatthegains.com/raw-summer-corn-salad/', protein: 2, carbs: 11, fat: 5, calories: 84 , servings:6, ingredients:[{amount:4,unit:'',name:'ears corn'},{amount:2.5,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced red onion'},{amount:1,unit:'',name:'large avocado'},{amount:0.5,unit:'cup',name:'cilantro'},{amount:0.25,unit:'cup',name:'lime juice'}] },
  { id: 'etg-healthy-broccoli-salad', name: 'Healthy Broccoli Salad with Raisins', url: 'https://eatthegains.com/healthy-broccoli-salad/', protein: 4, carbs: 17, fat: 13, calories: 188 , servings:8, ingredients:[{amount:8,unit:'cup',name:'broccoli florets'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.5,unit:'cup',name:'raisins'},{amount:0.25,unit:'cup',name:'sunflower seeds'}] },
  { id: 'etg-ground-turkey-stir-fry', name: '30-Minute Ground Turkey Stir Fry', url: 'https://eatthegains.com/ground-turkey-stir-fry/', protein: 32, carbs: 33, fat: 18, calories: 417 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'ground turkey'},{amount:1,unit:'cup',name:'sliced onions'},{amount:1,unit:'cup',name:'julienned carrots'},{amount:2,unit:'cup',name:'roughly chopped green beans'},{amount:2,unit:'cup',name:'julienned bell pepper'},{amount:3,unit:'tbsp',name:'coconut aminos'},{amount:2,unit:'tbsp',name:'lime juice'}] },
  { id: 'etg-greek-chickpea-salad', name: 'Greek Chickpea Salad with Feta & Herbs', url: 'https://eatthegains.com/greek-chickpea-salad/', protein: 7, carbs: 21, fat: 8, calories: 177 , servings:8, ingredients:[{amount:2,unit:'',name:'cans chickpeas'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:0.5,unit:'cup',name:'diced red onion'},{amount:0.5,unit:'cup',name:'kalamata olives'},{amount:0.5,unit:'cup',name:'crumbled feta'}] },
  { id: 'etg-healthy-egg-salad', name: 'Healthy Egg Salad with Greek Yogurt', url: 'https://eatthegains.com/healthy-egg-salad/', protein: 23, carbs: 4, fat: 16, calories: 261 , servings:4, ingredients:[{amount:12,unit:'',name:'hard-boiled eggs'},{amount:0.75,unit:'cup',name:'greek yogurt'},{amount:1,unit:'tbsp',name:'dijon mustard'},{amount:0.5,unit:'cup',name:'chopped green onions'},{amount:0.5,unit:'cup',name:'diced dill pickles'},{amount:0.25,unit:'cup',name:'fresh dill'}] },
  { id: 'etg-chocolate-chia-pudding', name: 'Chocolate Chia Pudding with Coconut Milk', url: 'https://eatthegains.com/chocolate-chia-pudding/', protein: 14, carbs: 24, fat: 15, calories: 259 , servings:2, ingredients:[{amount:1,unit:'cup',name:'lite coconut milk'},{amount:2,unit:'tbsp',name:'dark cocoa powder'},{amount:1.5,unit:'tbsp',name:'maple syrup'},{amount:3,unit:'tbsp',name:'chia seeds'}] },
  { id: 'etg-yogurt-bowl', name: 'Yogurt Bowl', url: 'https://eatthegains.com/yogurt-bowl/', protein: 41, carbs: 19, fat: 11, calories: 331 , servings:1, ingredients:[{amount:1,unit:'cup',name:'plain greek yogurt'},{amount:1,unit:'scoop',name:'chocolate protein powder'},{amount:1,unit:'tbsp',name:'peanut butter'}] },
  { id: 'etg-healthy-chicken-pad-thai-paleo-whole30', name: 'Healthy Chicken Pad Thai', url: 'https://eatthegains.com/healthy-chicken-pad-thai-paleo-whole30/', protein: 39, carbs: 55, fat: 19, calories: 538 , servings:4, ingredients:[{amount:3,unit:'',name:'large eggs'},{amount:1,unit:'lbs',name:'chicken breast'},{amount:1,unit:'cup',name:'sliced onion'},{amount:4,unit:'',name:'small-medium sweet potatoes, spiralized'},{amount:2,unit:'cup',name:'julienned red bell pepper'},{amount:3,unit:'cup',name:'sliced mushrooms'},{amount:0.25,unit:'cup',name:'coconut aminos'},{amount:3,unit:'tbsp',name:'almond butter'}] },
  { id: 'etg-crispy-roasted-breakfast-potatoes', name: 'Crispy Breakfast Potatoes', url: 'https://eatthegains.com/crispy-roasted-breakfast-potatoes/', protein: 4, carbs: 31, fat: 5, calories: 177 , servings:6, ingredients:[{amount:2.5,unit:'lbs',name:'yukon gold potatoes'},{amount:2,unit:'tbsp',name:'olive oil'}] },
  { id: 'etg-protein-baked-oatmeal', name: 'Protein Baked Oatmeal', url: 'https://eatthegains.com/protein-baked-oatmeal/', protein: 10, carbs: 26, fat: 7, calories: 199 , servings:9, ingredients:[{amount:1,unit:'',name:'medium banana'},{amount:1,unit:'cup',name:'milk'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:0.25,unit:'cup',name:'peanut butter'},{amount:2,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:1,unit:'cup',name:'berries'}] },
  { id: 'etg-meal-prep-smoked-salmon-breakfast-bowl-paleo-whole30', name: 'Savory Breakfast Bowl with Smoked Salmon', url: 'https://eatthegains.com/meal-prep-smoked-salmon-breakfast-bowl-paleo-whole30/', protein: 27, carbs: 46, fat: 22, calories: 473 , servings:2, ingredients:[{amount:5,unit:'oz',name:'smoked salmon'},{amount:2,unit:'cup',name:'crispy breakfast potatoes'},{amount:1,unit:'cup',name:'diced cucumbers'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:4,unit:'cup',name:'arugula'},{amount:0.5,unit:'',name:'avocado'}] },
  { id: 'etg-peanut-butter-chicken', name: '30-Minute Peanut Butter Chicken', url: 'https://eatthegains.com/peanut-butter-chicken/', protein: 33, carbs: 26, fat: 17, calories: 379 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:2,unit:'cup',name:'julienned red bell peppers'},{amount:2,unit:'cup',name:'julienned carrots'},{amount:0.75,unit:'cup',name:'peanut sauce'}] },
  { id: 'etg-chocolate-protein-balls', name: 'Chocolate Protein Balls', url: 'https://eatthegains.com/chocolate-protein-balls/', protein: 5, carbs: 8, fat: 7, calories: 108 , servings:11, ingredients:[{amount:0.5,unit:'cup',name:'cashew butter'},{amount:0.5,unit:'cup',name:'chocolate protein powder'},{amount:3,unit:'tbsp',name:'cocoa powder'},{amount:2,unit:'tbsp',name:'mini chocolate chips'}] },
  { id: 'etg-tahini-pasta', name: 'Tahini Pasta with Chicken & Veggies', url: 'https://eatthegains.com/tahini-pasta/', protein: 41, carbs: 56, fat: 19, calories: 536 , servings:4, ingredients:[{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'lbs',name:'chicken breasts'},{amount:3,unit:'cup',name:'snap peas'},{amount:2,unit:'cup',name:'julienned red peppers'},{amount:4,unit:'cup',name:'spinach'},{amount:0.25,unit:'cup',name:'tahini'}] },
  { id: 'etg-burrito-casserole', name: 'Easy Beef Burrito Casserole', url: 'https://eatthegains.com/burrito-casserole/', protein: 30, carbs: 32, fat: 17, calories: 408 , servings:8, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'lbs',name:'lean ground beef'},{amount:2,unit:'tbsp',name:'taco seasoning'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'',name:'can black beans'},{amount:1,unit:'cup',name:'salsa'},{amount:1,unit:'cup',name:'white rice'},{amount:1.5,unit:'cup',name:'broth'},{amount:1,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-paleo-blueberry-breakfast-sausage-whole30', name: 'Blueberry Breakfast Sausage', url: 'https://eatthegains.com/paleo-blueberry-breakfast-sausage-whole30/', protein: 9, carbs: 2, fat: 6, calories: 94 , servings:10, ingredients:[{amount:1,unit:'lbs',name:'lean ground pork'},{amount:0.5,unit:'cup',name:'blueberries'}] },
  { id: 'etg-beef-and-cabbage-stir-fry', name: 'Ground Beef and Cabbage Stir Fry', url: 'https://eatthegains.com/beef-and-cabbage-stir-fry/', protein: 33, carbs: 30, fat: 19, calories: 414 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'ground beef'},{amount:1,unit:'cup',name:'diced onion'},{amount:5,unit:'cup',name:'sliced cabbage'},{amount:2,unit:'cup',name:'julienned red bell peppers'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:3,unit:'tbsp',name:'coconut aminos'},{amount:2,unit:'tbsp',name:'lime juice'}] },
  { id: 'etg-chicken-mushroom-soup', name: 'Creamy Chicken Mushroom Soup', url: 'https://eatthegains.com/chicken-mushroom-soup/', protein: 22, carbs: 10, fat: 14, calories: 248 , servings:8, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'lbs',name:'cremini mushrooms, sliced'},{amount:2,unit:'cup',name:'chicken broth'},{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:4,unit:'cup',name:'shredded chicken'}] },
  { id: 'etg-chocolate-peanut-butter-overnight-oats', name: 'Chocolate Peanut Butter Overnight Oats', url: 'https://eatthegains.com/chocolate-peanut-butter-overnight-oats/', protein: 33, carbs: 57, fat: 24, calories: 547 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:1,unit:'scoop',name:'peanut butter protein powder'},{amount:1,unit:'tbsp',name:'cocoa powder'},{amount:1.5,unit:'tbsp',name:'peanut butter'},{amount:1,unit:'cup',name:'almond milk'}] },
  { id: 'etg-buffalo-potatoes', name: 'Buffalo Potatoes', url: 'https://eatthegains.com/buffalo-potatoes/', protein: 3, carbs: 29, fat: 4, calories: 164 , servings:5, ingredients:[{amount:2,unit:'lbs',name:'russet potatoes'},{amount:0.25,unit:'cup',name:'hot sauce'}] },
  { id: 'etg-buffalo-chicken-soup', name: 'Buffalo Chicken Soup', url: 'https://eatthegains.com/buffalo-chicken-soup/', protein: 22, carbs: 19, fat: 7, calories: 236 , servings:8, ingredients:[{amount:1,unit:'cup',name:'diced yellow onion'},{amount:1,unit:'cup',name:'diced carrot'},{amount:1,unit:'cup',name:'diced celery'},{amount:1.5,unit:'lbs',name:'chicken breasts'},{amount:3,unit:'cup',name:'chicken broth'},{amount:0.5,unit:'cup',name:'buffalo sauce'},{amount:0.5,unit:'cup',name:'full-fat coconut milk'}] },
  { id: 'etg-birthday-cake-protein-bars', name: 'Birthday Cake Protein Bars', url: 'https://eatthegains.com/birthday-cake-protein-bars/', protein: 15, carbs: 19, fat: 18, calories: 293 , servings:6, ingredients:[{amount:0.75,unit:'cup',name:'cashew butter'},{amount:0.25,unit:'cup',name:'almond milk'},{amount:1,unit:'cup',name:'vanilla protein powder'},{amount:2,unit:'tbsp',name:'rainbow sprinkles'}] },
  { id: 'etg-one-pan-whole30-shrimp-fajitas', name: '30-Minute Shrimp Fajitas', url: 'https://eatthegains.com/one-pan-whole30-shrimp-fajitas/', protein: 34, carbs: 17, fat: 8, calories: 268 , servings:3, ingredients:[{amount:2,unit:'cup',name:'julienned onions'},{amount:4,unit:'cup',name:'julienned bell peppers'},{amount:2,unit:'cup',name:'sliced mushrooms'},{amount:1,unit:'lbs',name:'shrimp, peeled and deveined'}] },
  { id: 'etg-thai-coconut-chicken-curry-paleo-whole30', name: 'Thai Coconut Chicken Curry', url: 'https://eatthegains.com/thai-coconut-chicken-curry-paleo-whole30/', protein: 16, carbs: 15, fat: 13, calories: 230 , servings:8, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'cubed sweet potato'},{amount:2,unit:'cup',name:'julienned bell peppers'},{amount:3,unit:'cup',name:'broccoli florets'},{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:1,unit:'tbsp',name:'red curry paste'}] },
  { id: 'etg-zaatar-chicken', name: 'Za\'atar Chicken & Veggie Sheet Pan', url: 'https://eatthegains.com/zaatar-chicken/', protein: 42, carbs: 36, fat: 22, calories: 501, servings:4, ingredients:[{amount:2,unit:'tablespoons',name:'olive oil'},{amount:2,unit:'tablespoons',name:'za\'atar'},{amount:1,unit:'teaspoon',name:'garlic powder'},{amount:2,unit:'tablespoons',name:'lemon juice'},{amount:1.5,unit:'pounds',name:'chicken thighs'},{amount:1,unit:'pound',name:'halved/quartered baby potatoes'},{amount:3,unit:'cups',name:'cauliflower florets'},{amount:2,unit:'cups',name:'diced carrots'},{amount:2,unit:'heaping cups',name:'julienned bell pepper'},{amount:0,unit:'',name:'salt and pepper'},{amount:0.333,unit:'cup',name:'plain greek yogurt'},{amount:3,unit:'tablespoons',name:'tahini'},{amount:2,unit:'tablespoons',name:'lemon juice'},{amount:2,unit:'heaping tablespoons',name:'fresh dill, roughly chopped'},{amount:2,unit:'tablespoons',name:'water'},{amount:0,unit:'',name:'salt and pepper'}] },
  { id: 'etg-chicken-parmesan-pasta', name: 'Chicken Parmesan Pasta', url: 'https://eatthegains.com/chicken-parmesan-pasta/', protein: 42, carbs: 46, fat: 19, calories: 533 , servings:4, ingredients:[{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'lbs',name:'chicken breasts'},{amount:2,unit:'cup',name:'pasta sauce'},{amount:0.25,unit:'cup',name:'shredded parmesan cheese'},{amount:4,unit:'oz',name:'mozzarella cheese'}] },
  { id: 'etg-chicken-sausage-pasta', name: 'Creamy Chicken Sausage Pasta', url: 'https://eatthegains.com/chicken-sausage-pasta/', protein: 30, carbs: 53, fat: 16, calories: 451 , servings:4, ingredients:[{amount:8,unit:'oz',name:'pasta'},{amount:1,unit:'',name:'package chicken sausages'},{amount:2,unit:'cup',name:'sliced mushrooms'},{amount:4,unit:'cup',name:'spinach'},{amount:2,unit:'cup',name:'marinara sauce'},{amount:0.5,unit:'cup',name:'goat cheese'}] },
  { id: 'etg-pork-meatballs', name: 'Baked Asian-Inspired Pork Meatballs', url: 'https://eatthegains.com/pork-meatballs/', protein: 24, carbs: 4, fat: 15, calories: 255 , servings:6, ingredients:[{amount:1.5,unit:'lbs',name:'lean ground pork'},{amount:1,unit:'',name:'large egg'},{amount:0.25,unit:'cup',name:'almond flour'},{amount:2,unit:'tbsp',name:'coconut aminos'},{amount:3,unit:'',name:'cloves garlic'}] },
  { id: 'etg-pizza-frittata', name: 'Pizza Frittata', url: 'https://eatthegains.com/pizza-frittata/', protein: 18, carbs: 8, fat: 16, calories: 246 , servings:6, ingredients:[{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:12,unit:'',name:'large eggs'},{amount:0.75,unit:'cup',name:'pizza sauce'},{amount:0.5,unit:'cup',name:'mozzarella cheese'},{amount:0.333,unit:'cup',name:'pepperoni'}] },
  { id: 'etg-chicken-tomato-soup', name: 'Creamy Chicken Tomato Soup', url: 'https://eatthegains.com/chicken-tomato-soup/', protein: 15, carbs: 8, fat: 5, calories: 125 , servings:10, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'',name:'can san marzano whole peeled tomatoes'},{amount:3,unit:'cup',name:'bone broth'},{amount:1,unit:'lbs',name:'chicken breasts'},{amount:0.5,unit:'cup',name:'full-fat coconut milk'},{amount:1,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'cup',name:'diced zucchini'},{amount:1,unit:'cup',name:'sliced mushrooms'},{amount:2,unit:'cup',name:'spinach'}] },
  { id: 'etg-chicken-hash', name: 'Chicken Hash with Sweet Potatoes & Apples', url: 'https://eatthegains.com/chicken-hash/', protein: 28, carbs: 38, fat: 14, calories: 384 , servings:4, ingredients:[{amount:4,unit:'',name:'pieces bacon'},{amount:1,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'diced onion'},{amount:4,unit:'cup',name:'diced sweet potato'},{amount:2,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'cup',name:'diced apple'}] },
  { id: 'etg-bison-chili', name: 'Bison Chili with Butternut Squash', url: 'https://eatthegains.com/bison-chili/', protein: 35, carbs: 29, fat: 18, calories: 394 , servings:12, ingredients:[{amount:2,unit:'cup',name:'diced onions'},{amount:2,unit:'lbs',name:'ground bison'},{amount:5,unit:'cup',name:'cubed butternut squash'},{amount:3,unit:'cup',name:'chopped bell peppers'},{amount:2,unit:'cup',name:'broth'},{amount:16,unit:'oz',name:'tomato sauce'}] },
  { id: 'etg-chicken-quinoa-skillet', name: 'Southwestern Chicken Quinoa Skillet', url: 'https://eatthegains.com/chicken-quinoa-skillet/', protein: 40, carbs: 48, fat: 13, calories: 461 , servings:4, ingredients:[{amount:0.75,unit:'cup',name:'quinoa, dry'},{amount:1,unit:'lbs',name:'chicken breast'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'cup',name:'diced onion'},{amount:3,unit:'cup',name:'diced bell pepper'},{amount:1,unit:'',name:'can black beans'},{amount:0.5,unit:'cup',name:'shredded cheddar cheese'}] },
  { id: 'etg-pumpkin-pie-chia-pudding', name: 'Pumpkin Chia Pudding', url: 'https://eatthegains.com/pumpkin-pie-chia-pudding/', protein: 9, carbs: 17, fat: 11, calories: 189 , servings:4, ingredients:[{amount:1,unit:'cup',name:'pumpkin puree'},{amount:1.5,unit:'cup',name:'almond milk'},{amount:1,unit:'tbsp',name:'maple syrup'},{amount:0.417,unit:'cup',name:'chia seeds'}] },
  { id: 'etg-buffalo-chicken-tenders', name: 'Buffalo Chicken Tenders', url: 'https://eatthegains.com/buffalo-chicken-tenders/', protein: 32, carbs: 10, fat: 15, calories: 305 , servings:6, ingredients:[{amount:1.5,unit:'lbs',name:'chicken tenders'},{amount:0.25,unit:'cup',name:'coconut flour'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'tbsp',name:'hot sauce'},{amount:0.75,unit:'cup',name:'raw cashews'}] },
  { id: 'etg-apple-cinnamon-overnight-oats', name: 'Apple Cinnamon Overnight Oats', url: 'https://eatthegains.com/apple-cinnamon-overnight-oats/', protein: 31, carbs: 59, fat: 13, calories: 468 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:0.5,unit:'cup',name:'diced apple'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:1,unit:'tsp',name:'cinnamon'},{amount:0.667,unit:'cup',name:'almond milk'}] },
  { id: 'etg-salsa-pork-chops', name: 'Salsa Pork Chops', url: 'https://eatthegains.com/salsa-pork-chops/', protein: 41, carbs: 8, fat: 15, calories: 328 , servings:6, ingredients:[{amount:1,unit:'cup',name:'salsa'},{amount:2,unit:'lbs',name:'pork chops'},{amount:2,unit:'tbsp',name:'taco seasoning'}] },
  { id: 'etg-greek-lamb-meatball-bowls', name: 'Greek Lamb Meatball Bowls', url: 'https://eatthegains.com/greek-lamb-meatball-bowls/', protein: 27, carbs: 7, fat: 25, calories: 366 , servings:6, ingredients:[{amount:1.5,unit:'lbs',name:'ground lamb'},{amount:1,unit:'cup',name:'diced red onion'},{amount:3,unit:'',name:'cloves garlic'},{amount:0.5,unit:'cup',name:'fresh parsley'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:1.5,unit:'cup',name:'cherry tomatoes'},{amount:0.75,unit:'cup',name:'tzatziki sauce'}] },
  { id: 'etg-chocolate-coconut-overnight-oats', name: 'Creamy Chocolate Coconut Overnight Oats', url: 'https://eatthegains.com/chocolate-coconut-overnight-oats/', protein: 37, carbs: 53, fat: 26, calories: 581 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:0.25,unit:'cup',name:'chocolate protein powder'},{amount:1,unit:'tbsp',name:'cacao powder'},{amount:2,unit:'tbsp',name:'shredded coconut'},{amount:0.667,unit:'cup',name:'light coconut milk'}] },
  { id: 'etg-buffalo-chicken-pasta-salad', name: 'Buffalo Chicken Pasta Salad', url: 'https://eatthegains.com/buffalo-chicken-pasta-salad/', protein: 17, carbs: 18, fat: 5, calories: 191 , servings:10, ingredients:[{amount:8,unit:'oz',name:'fusilli pasta'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:1,unit:'cup',name:'diced celery'},{amount:1,unit:'cup',name:'diced bell pepper'},{amount:0.75,unit:'cup',name:'blue cheese dressing'},{amount:0.25,unit:'cup',name:'hot sauce'}] },
  { id: 'etg-peach-baked-oatmeal', name: 'Peach Baked Oatmeal', url: 'https://eatthegains.com/peach-baked-oatmeal/', protein: 5, carbs: 24, fat: 6, calories: 169 , servings:9, ingredients:[{amount:2,unit:'',name:'large eggs'},{amount:0.75,unit:'cup',name:'coconut milk'},{amount:2.5,unit:'cup',name:'rolled oats'},{amount:2,unit:'cup',name:'diced peaches'}] },
  { id: 'etg-blue-cheese-coleslaw', name: 'Blue Cheese Coleslaw', url: 'https://eatthegains.com/blue-cheese-coleslaw/', protein: 3, carbs: 6, fat: 3, calories: 59 , servings:6, ingredients:[{amount:6,unit:'cup',name:'shredded cabbage'},{amount:2,unit:'cup',name:'shredded carrots'},{amount:0.25,unit:'cup',name:'blue cheese dressing'},{amount:0.25,unit:'cup',name:'blue cheese crumbles'}] },
  { id: 'etg-greek-chicken-kabobs', name: 'Greek Chicken Kabobs', url: 'https://eatthegains.com/greek-chicken-kabobs/', protein: 41, carbs: 15, fat: 15, calories: 361 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'chicken breast'},{amount:2,unit:'',name:'medium zucchini'},{amount:2,unit:'',name:'medium bell peppers'},{amount:3,unit:'tbsp',name:'lemon juice'},{amount:1,unit:'tbsp',name:'dried oregano'}] },
  { id: 'etg-creamy-sun-dried-tomato-pasta', name: 'Creamy Sun Dried Tomato Chicken Pasta', url: 'https://eatthegains.com/creamy-sun-dried-tomato-pasta/', protein: 40, carbs: 62, fat: 20, calories: 569 , servings:4, ingredients:[{amount:8,unit:'oz',name:'rigatoni pasta'},{amount:1,unit:'lbs',name:'chicken breast'},{amount:2,unit:'cup',name:'diced bell pepper'},{amount:2,unit:'cup',name:'diced zucchini'},{amount:4,unit:'cup',name:'spinach'},{amount:0.5,unit:'cup',name:'sun-dried tomatoes'}] },
  { id: 'etg-paleo-buffalo-ranch-chicken-salad', name: 'Buffalo Ranch Chicken Salad', url: 'https://eatthegains.com/paleo-buffalo-ranch-chicken-salad/', protein: 26, carbs: 3, fat: 11, calories: 221 , servings:6, ingredients:[{amount:4,unit:'cup',name:'shredded chicken'},{amount:1,unit:'cup',name:'shredded carrots'},{amount:1,unit:'cup',name:'diced celery'},{amount:0.5,unit:'cup',name:'greek yogurt'},{amount:3,unit:'tbsp',name:'hot sauce'}] },
  { id: 'etg-healthy-turkey-taco-skillet', name: 'Healthy Turkey Taco Skillet', url: 'https://eatthegains.com/healthy-turkey-taco-skillet/', protein: 32, carbs: 68, fat: 14, calories: 527 , servings:4, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'ground turkey'},{amount:1,unit:'cup',name:'white rice'},{amount:1,unit:'',name:'can fire roasted tomatoes'},{amount:1,unit:'',name:'can black beans'},{amount:3,unit:'cup',name:'diced bell peppers'},{amount:2,unit:'tbsp',name:'taco seasoning'},{amount:1.5,unit:'cup',name:'broth'}] },
  { id: 'etg-oatmeal-chocolate-chip-muffins', name: 'Oatmeal Chocolate Chip Muffins', url: 'https://eatthegains.com/oatmeal-chocolate-chip-muffins/', protein: 5, carbs: 31, fat: 7, calories: 195 , servings:10, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:0.75,unit:'cup',name:'almond milk'},{amount:2.5,unit:'cup',name:'rolled oats'},{amount:0.5,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-banana-bread-bars', name: 'Banana Bread Bars', url: 'https://eatthegains.com/banana-bread-bars/', protein: 3, carbs: 29, fat: 9, calories: 199 , servings:9, ingredients:[{amount:1,unit:'cup',name:'gluten-free baking flour'},{amount:2,unit:'',name:'medium-large brown bananas'},{amount:1,unit:'',name:'large egg'},{amount:0.25,unit:'cup',name:'ghee'},{amount:0.3125,unit:'cup',name:'mini chocolate chips'}] },
  { id: 'etg-vegan-broccoli-cheese-soup', name: 'Vegan Broccoli Cheese Soup', url: 'https://eatthegains.com/vegan-broccoli-cheese-soup/', protein: 9, carbs: 19, fat: 22, calories: 317 , servings:6, ingredients:[{amount:1.5,unit:'cup',name:'diced onion'},{amount:3,unit:'cup',name:'vegetable broth'},{amount:1,unit:'',name:'can full fat coconut milk'},{amount:1,unit:'cup',name:'raw cashews'},{amount:0.5,unit:'cup',name:'nutritional yeast'},{amount:6,unit:'cup',name:'broccoli florets'}] },
  { id: 'etg-buffalo-chicken-breakfast-casserole', name: 'Buffalo Chicken Breakfast Casserole', url: 'https://eatthegains.com/buffalo-chicken-breakfast-casserole/', protein: 26, carbs: 6, fat: 15, calories: 271 , servings:6, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'shredded carrots'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:0.25,unit:'cup',name:'buffalo sauce'},{amount:10,unit:'',name:'large eggs'}] },
  { id: 'etg-paleo-beef-broccoli-stir-fry-whole30', name: 'Beef and Broccoli Stir Fry', url: 'https://eatthegains.com/paleo-beef-broccoli-stir-fry-whole30/', protein: 18, carbs: 13, fat: 10, calories: 217 , servings:6, ingredients:[{amount:1,unit:'lbs',name:'flank steak, thinly sliced'},{amount:7,unit:'cup',name:'broccoli florets'},{amount:0.333,unit:'cup',name:'coconut aminos'},{amount:0.333,unit:'cup',name:'chicken broth'},{amount:1,unit:'tbsp',name:'sesame oil'}] },
  { id: 'etg-gingerbread-baked-oatmeal-bars', name: 'Gingerbread Baked Oatmeal Bars', url: 'https://eatthegains.com/gingerbread-baked-oatmeal-bars/', protein: 5, carbs: 23, fat: 3, calories: 133 , servings:9, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'cup',name:'rolled oats'},{amount:1.5,unit:'tsp',name:'ground ginger'},{amount:1.5,unit:'tsp',name:'cinnamon'}] },
  { id: 'etg-chicken-apple-sausage', name: 'Chicken Apple Sausage', url: 'https://eatthegains.com/chicken-apple-sausage/', protein: 10, carbs: 2, fat: 1, calories: 60 , servings:11, ingredients:[{amount:1,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'diced apple'},{amount:0.5,unit:'cup',name:'diced onion'}] },
  { id: 'etg-buffalo-cauliflower-potato-soup', name: 'Buffalo Cauliflower Potato Soup', url: 'https://eatthegains.com/buffalo-cauliflower-potato-soup/', protein: 3, carbs: 18, fat: 7, calories: 136 , servings:9, ingredients:[{amount:4,unit:'cup',name:'veggie broth'},{amount:4,unit:'cup',name:'diced potatoes'},{amount:4,unit:'cup',name:'cauliflower florets'},{amount:0.5,unit:'cup',name:'buffalo sauce'},{amount:0.5,unit:'cup',name:'full-fat coconut milk'}] },
  { id: 'etg-shrimp-rice-noodles', name: 'Shrimp Rice Noodles with Peanut Butter Sauce', url: 'https://eatthegains.com/shrimp-rice-noodles/', protein: 33, carbs: 66, fat: 14, calories: 529 , servings:4, ingredients:[{amount:8,unit:'oz',name:'rice noodles'},{amount:1.5,unit:'lbs',name:'shrimp, peeled and deveined'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:2,unit:'',name:'large bell peppers'},{amount:0.25,unit:'cup',name:'peanut butter'},{amount:0.25,unit:'cup',name:'coconut aminos'}] },
  { id: 'etg-beef-taco-casserole-paleo-whole30', name: 'Beef Taco Casserole', url: 'https://eatthegains.com/beef-taco-casserole-paleo-whole30/', protein: 19, carbs: 25, fat: 22, calories: 357 , servings:6, ingredients:[{amount:1,unit:'lbs',name:'ground beef'},{amount:1.5,unit:'cup',name:'diced yellow onion'},{amount:2,unit:'',name:'large bell peppers, diced'},{amount:3,unit:'cup',name:'kale, roughly chopped'},{amount:4,unit:'cup',name:'raw sweet potato noodles'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:1.25,unit:'cup',name:'salsa'}] },
  { id: 'etg-pumpkin-chocolate-chip-protein-muffins', name: 'Pumpkin Chocolate Chip Protein Muffins', url: 'https://eatthegains.com/pumpkin-chocolate-chip-protein-muffins/', protein: 7, carbs: 15, fat: 6, calories: 122 , servings:12, ingredients:[{amount:1,unit:'cup',name:'rolled oats'},{amount:1,unit:'cup',name:'pumpkin puree'},{amount:1,unit:'cup',name:'greek yogurt'},{amount:2,unit:'',name:'large eggs'},{amount:0.5,unit:'cup',name:'vanilla protein powder'},{amount:0.5,unit:'cup',name:'dark chocolate chips'}] },
  { id: 'etg-one-pan-chicken-asparagus-mushrooms', name: 'Lemon Garlic Chicken Asparagus Mushroom Skillet', url: 'https://eatthegains.com/one-pan-chicken-asparagus-mushrooms/', protein: 34, carbs: 18, fat: 21, calories: 390 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:5,unit:'cup',name:'chopped asparagus'},{amount:4,unit:'cup',name:'sliced mushrooms'},{amount:0.75,unit:'cup',name:'full fat coconut milk'},{amount:0.5,unit:'cup',name:'raw cashews'}] },
  { id: 'etg-peanut-butter-jelly-stuffed-oatmeal-cups', name: 'Peanut Butter & Jelly Stuffed Oatmeal Cups', url: 'https://eatthegains.com/peanut-butter-jelly-stuffed-oatmeal-cups/', protein: 5, carbs: 18, fat: 6, calories: 146 , servings:12, ingredients:[{amount:2.5,unit:'cup',name:'rolled oats'},{amount:1.25,unit:'cup',name:'almond milk'},{amount:0.25,unit:'cup',name:'berry chia jam'}] },
  { id: 'etg-blt-avocado-pasta-salad', name: 'BLT Pasta Salad', url: 'https://eatthegains.com/blt-avocado-pasta-salad/', protein: 6, carbs: 25, fat: 9, calories: 195 , servings:16, ingredients:[{amount:1,unit:'lbs',name:'rotini pasta'},{amount:8,unit:'',name:'pieces bacon'},{amount:3,unit:'cup',name:'chopped romaine'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:2,unit:'',name:'large avocados'}] },
  { id: 'etg-honey-mustard-potato-salad', name: 'Honey Mustard Potato Salad', url: 'https://eatthegains.com/honey-mustard-potato-salad/', protein: 3, carbs: 29, fat: 11, calories: 216 , servings:9, ingredients:[{amount:3,unit:'lbs',name:'red potatoes'},{amount:0.5,unit:'cup',name:'mayo'},{amount:2.5,unit:'tbsp',name:'dijon mustard'},{amount:2,unit:'tbsp',name:'honey'},{amount:0.5,unit:'cup',name:'chopped green onions'}] },
  { id: 'etg-buffalo-chicken-zucchini-boats', name: 'Buffalo Chicken Zucchini Boats', url: 'https://eatthegains.com/buffalo-chicken-zucchini-boats/', protein: 25, carbs: 6, fat: 13, calories: 236 , servings:6, ingredients:[{amount:3,unit:'',name:'medium zucchinis'},{amount:2.5,unit:'cup',name:'shredded chicken'},{amount:0.75,unit:'cup',name:'buffalo sauce'},{amount:0.25,unit:'cup',name:'blue cheese crumbles'}] },
  { id: 'etg-paleo-zucchini-banana-bread', name: 'Paleo Zucchini Banana Bread', url: 'https://eatthegains.com/paleo-zucchini-banana-bread/', protein: 6, carbs: 25, fat: 8, calories: 197 , servings:8, ingredients:[{amount:2,unit:'',name:'ripe bananas'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'tbsp',name:'honey'},{amount:2,unit:'cup',name:'paleo baking flour'},{amount:1,unit:'cup',name:'shredded zucchini'}] },
  { id: 'etg-one-pan-steak-fajita-lettuce-wraps', name: 'Easy Steak Fajitas', url: 'https://eatthegains.com/one-pan-steak-fajita-lettuce-wraps/', protein: 33, carbs: 23, fat: 21, calories: 323 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'steak'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:0.5,unit:'',name:'large onion, sliced'},{amount:4,unit:'',name:'medium bell peppers'}] },
  { id: 'etg-cauliflower-chickpea-curry', name: 'Cauliflower Chickpea Curry', url: 'https://eatthegains.com/cauliflower-chickpea-curry/', protein: 12, carbs: 53, fat: 23, calories: 453 , servings:7, ingredients:[{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'',name:'medium-large sweet potato, cubed'},{amount:2,unit:'',name:'large bell peppers'},{amount:4,unit:'cup',name:'cauliflower florets'},{amount:1,unit:'',name:'can chickpeas'},{amount:1,unit:'',name:'can full fat coconut milk'},{amount:1,unit:'tbsp',name:'red curry paste'}] },
  { id: 'etg-maple-mustard-chicken-skillet', name: 'Maple Mustard Chicken Skillet', url: 'https://eatthegains.com/maple-mustard-chicken-skillet/', protein: 31, carbs: 44, fat: 11, calories: 390 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:1,unit:'lbs',name:'sweet potatoes, diced'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'brussel sprouts, shredded'},{amount:0.25,unit:'cup',name:'maple syrup'},{amount:2,unit:'tbsp',name:'dijon mustard'}] },
  { id: 'etg-cheesy-chicken-soup', name: 'Cheesy Chicken Soup', url: 'https://eatthegains.com/cheesy-chicken-soup/', protein: 18, carbs: 21, fat: 12, calories: 263 , servings:8, ingredients:[{amount:1.5,unit:'lbs',name:'yukon gold potatoes, diced'},{amount:3,unit:'cup',name:'chicken broth'},{amount:3,unit:'cup',name:'diced bell peppers'},{amount:3,unit:'cup',name:'shredded chicken'},{amount:1,unit:'',name:'can full-fat coconut milk'},{amount:0.5,unit:'cup',name:'nutritional yeast'}] },
  { id: 'etg-steak-and-sweet-potato-skillet', name: 'Steak and Sweet Potato Skillet', url: 'https://eatthegains.com/steak-and-sweet-potato-skillet/', protein: 41, carbs: 44, fat: 16, calories: 478 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'steak, cubed'},{amount:6,unit:'cup',name:'diced sweet potatoes'},{amount:1,unit:'cup',name:'roughly chopped onion'},{amount:3,unit:'cup',name:'diced bell peppers'},{amount:1,unit:'cup',name:'sliced mushrooms'}] },
  { id: 'etg-buffalo-chicken-twice-baked-sweet-potatoes', name: 'Buffalo Chicken Stuffed Sweet Potatoes', url: 'https://eatthegains.com/buffalo-chicken-twice-baked-sweet-potatoes/', protein: 12, carbs: 28, fat: 10, calories: 242 , servings:8, ingredients:[{amount:4,unit:'',name:'medium sweet potatoes'},{amount:0.5,unit:'cup',name:'diced yellow onion'},{amount:0.5,unit:'cup',name:'diced celery'},{amount:0.5,unit:'cup',name:'shredded carrots'},{amount:2,unit:'cup',name:'shredded chicken'},{amount:0.25,unit:'cup',name:'hot sauce'}] },
  { id: 'etg-whole30-breakfast-salad-poached-eggs', name: 'Whole30 Breakfast Salad with Poached Eggs', url: 'https://eatthegains.com/whole30-breakfast-salad-poached-eggs/', protein: 22, carbs: 49, fat: 40, calories: 635 , servings:1, ingredients:[{amount:1,unit:'',name:'small sweet potato, diced'},{amount:2,unit:'',name:'pieces bacon'},{amount:0.5,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced cucumber'},{amount:2,unit:'cup',name:'mixed greens'},{amount:0.5,unit:'',name:'avocado'},{amount:2,unit:'',name:'large eggs'}] },
  { id: 'etg-vegetable-pumpkin-quiche', name: 'Crustless Pumpkin Quiche', url: 'https://eatthegains.com/vegetable-pumpkin-quiche/', protein: 10, carbs: 4, fat: 9, calories: 135 , servings:6, ingredients:[{amount:2,unit:'cup',name:'cubed pumpkin'},{amount:3,unit:'cup',name:'packed kale'},{amount:1,unit:'cup',name:'chopped mushrooms'},{amount:8,unit:'',name:'large eggs'}] },
  { id: 'etg-roasted-carrot-and-arugula-salad-with-avocado-feta', name: 'Roasted Carrot and Arugula Salad with Feta & Avocado', url: 'https://eatthegains.com/roasted-carrot-and-arugula-salad-with-avocado-feta/', protein: 9, carbs: 28, fat: 19, calories: 303 , servings:4, ingredients:[{amount:8,unit:'',name:'rainbow carrots'},{amount:6,unit:'cup',name:'arugula'},{amount:0.5,unit:'cup',name:'crumbled feta cheese'},{amount:1,unit:'',name:'avocado'},{amount:0.25,unit:'cup',name:'pumpkin seeds'}] },
  { id: 'etg-instant-pot-pumpkin-soup', name: 'Instant Pot Pumpkin Soup', url: 'https://eatthegains.com/instant-pot-pumpkin-soup/', protein: 9, carbs: 22, fat: 10, calories: 189 , servings:9, ingredients:[{amount:8,unit:'cup',name:'diced pumpkin'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'cup',name:'cashews'},{amount:5,unit:'cup',name:'vegetable broth'}] },
  { id: 'etg-pumpkin-protein-bars', name: 'Pumpkin Protein Bars', url: 'https://eatthegains.com/pumpkin-protein-bars/', protein: 18, carbs: 17, fat: 20, calories: 288 , servings:6, ingredients:[{amount:0.75,unit:'cup',name:'pumpkin puree'},{amount:0.75,unit:'cup',name:'natural almond butter'},{amount:1.25,unit:'cup',name:'vanilla protein powder'}] },
  { id: 'etg-chicken-ranch-pasta', name: 'Chicken Ranch Pasta with Broccoli', url: 'https://eatthegains.com/chicken-ranch-pasta/', protein: 38, carbs: 43, fat: 28, calories: 572 , servings:5, ingredients:[{amount:1.5,unit:'lbs',name:'chicken breast'},{amount:6,unit:'cup',name:'broccoli florets'},{amount:0.5,unit:'cup',name:'ranch dressing'}] },
  { id: 'etg-cauliflower-oatmeal', name: 'Cauliflower Oatmeal', url: 'https://eatthegains.com/cauliflower-oatmeal/', protein: 24, carbs: 57, fat: 13, calories: 414 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'rolled oats'},{amount:1,unit:'cup',name:'frozen riced cauliflower'},{amount:1,unit:'tbsp',name:'chia seeds'},{amount:1,unit:'cup',name:'almond milk'},{amount:1,unit:'scoop',name:'vanilla protein powder'}] },
  { id: 'etg-cinnamon-mango-overnight-oats', name: 'Cinnamon Mango Overnight Oats', url: 'https://eatthegains.com/cinnamon-mango-overnight-oats/', protein: 25, carbs: 61, fat: 9, calories: 422 , servings:2, ingredients:[{amount:1.5,unit:'cup',name:'almond milk'},{amount:1,unit:'cup',name:'diced mango'},{amount:1,unit:'cup',name:'rolled oats'},{amount:1,unit:'cup',name:'greek yogurt'},{amount:2,unit:'tbsp',name:'chia seeds'}] },
  { id: 'etg-grilled-cilantro-lime-shrimp', name: 'Grilled Cilantro Lime Shrimp', url: 'https://eatthegains.com/grilled-cilantro-lime-shrimp/', protein: 21, carbs: 6, fat: 18, calories: 327 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'shrimp, peeled and deveined'},{amount:0.5,unit:'cup',name:'cilantro'},{amount:2,unit:'tbsp',name:'lime juice'},{amount:2,unit:'',name:'medium avocado'}] },
  { id: 'etg-beet-burger', name: 'Beet Burger', url: 'https://eatthegains.com/beet-burger/', protein: 8, carbs: 26, fat: 14, calories: 254 , servings:4, ingredients:[{amount:0.5,unit:'cup',name:'pecans'},{amount:0.5,unit:'cup',name:'diced onion'},{amount:2,unit:'cup',name:'shredded beets'},{amount:1,unit:'cup',name:'cooked lentils'},{amount:2,unit:'tbsp',name:'coconut aminos'}] },
  { id: 'etg-buffalo-chicken-burgers', name: 'Buffalo Chicken Burgers', url: 'https://eatthegains.com/buffalo-chicken-burgers/', protein: 29, carbs: 3, fat: 11, calories: 210 , servings:4, ingredients:[{amount:0.5,unit:'cup',name:'hot sauce'},{amount:1,unit:'lbs',name:'ground chicken breast'},{amount:0.5,unit:'cup',name:'diced onions'},{amount:0.25,unit:'cup',name:'blue cheese crumbles'},{amount:2.5,unit:'tbsp',name:'greek yogurt'}] },
  { id: 'etg-healthy-broccoli-fried-rice', name: 'Broccoli Fried Rice', url: 'https://eatthegains.com/healthy-broccoli-fried-rice/', protein: 7, carbs: 18, fat: 5, calories: 137 , servings:6, ingredients:[{amount:1,unit:'cup',name:'diced red onion'},{amount:2,unit:'',name:'medium carrots, diced'},{amount:3.75,unit:'cup',name:'riced broccoli'},{amount:0.75,unit:'cup',name:'frozen peas'},{amount:0.75,unit:'cup',name:'frozen corn'},{amount:3,unit:'tbsp',name:'coconut aminos'},{amount:8,unit:'',name:'medium mushrooms'},{amount:2,unit:'',name:'large eggs'}] },
  { id: 'etg-grilled-eggplant-pizza', name: 'Grilled Eggplant Pizza', url: 'https://eatthegains.com/grilled-eggplant-pizza/', protein: 13, carbs: 20, fat: 11, calories: 225 , servings:4, ingredients:[{amount:2,unit:'',name:'medium-large eggplants'},{amount:1.25,unit:'cup',name:'pizza sauce'},{amount:1,unit:'cup',name:'shredded mozzarella cheese'}] },
  { id: 'etg-smoked-brisket-dry-rub', name: 'Smoked Brisket with Dry Rub', url: 'https://eatthegains.com/smoked-brisket-dry-rub/', protein: 30, carbs: 0, fat: 11, calories: 220 , servings:19, ingredients:[{amount:6,unit:'lbs',name:'brisket'}] },
  { id: 'etg-whole30-chicken-bacon-ranch-sweet-potato-pizza', name: 'Whole30 Pizza with Chicken, Bacon & Ranch', url: 'https://eatthegains.com/whole30-chicken-bacon-ranch-sweet-potato-pizza/', protein: 21, carbs: 42, fat: 23, calories: 457 , servings:4, ingredients:[{amount:3,unit:'',name:'medium-large sweet potatoes'},{amount:3,unit:'',name:'pieces bacon'},{amount:2.25,unit:'cup',name:'shredded chicken'},{amount:5,unit:'tbsp',name:'ranch dressing'}] },
  { id: 'etg-chicken-bacon-ranch-salad', name: 'Chicken Bacon Ranch Salad', url: 'https://eatthegains.com/chicken-bacon-ranch-salad/', protein: 30, carbs: 13, fat: 23, calories: 358 , servings:8, ingredients:[{amount:4,unit:'',name:'pieces bacon'},{amount:1,unit:'lbs',name:'chicken tenders'},{amount:8,unit:'cup',name:'chopped romaine'},{amount:1.5,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'',name:'large avocado'},{amount:0.333,unit:'cup',name:'ranch dressing'}] },
  { id: 'etg-air-fryer-potatoes', name: 'Rosemary Garlic Air Fryer Potatoes', url: 'https://eatthegains.com/air-fryer-potatoes/', protein: 4, carbs: 36, fat: 3, calories: 187 , servings:6, ingredients:[{amount:2.5,unit:'lbs',name:'potatoes'},{amount:2,unit:'tbsp',name:'fresh rosemary'}] },
  { id: 'etg-roasted-winter-veggie-power-bowl', name: 'Winter Veggie Power Bowl', url: 'https://eatthegains.com/roasted-winter-veggie-power-bowl/', protein: 10, carbs: 63, fat: 29, calories: 521 , servings:3, ingredients:[{amount:3,unit:'cup',name:'cubed butternut squash'},{amount:3,unit:'',name:'medium parsnips, cubed'},{amount:1,unit:'',name:'large beet, cubed'},{amount:6,unit:'cup',name:'packed kale'},{amount:0.333,unit:'cup',name:'walnuts'},{amount:0.333,unit:'cup',name:'dried cranberries'},{amount:1,unit:'',name:'small avocado'}] },
  { id: 'etg-instant-pot-creamy-curry-cauliflower-butternut-squash-soup', name: 'Curried Butternut Squash Soup', url: 'https://eatthegains.com/instant-pot-creamy-curry-cauliflower-butternut-squash-soup/', protein: 4, carbs: 26, fat: 3, calories: 132 , servings:9, ingredients:[{amount:5,unit:'cup',name:'cubed butternut squash'},{amount:4.5,unit:'cup',name:'cauliflower florets'},{amount:3.5,unit:'cup',name:'vegetable broth'},{amount:0.5,unit:'cup',name:'lite coconut milk'},{amount:1.5,unit:'tbsp',name:'curry powder'}] },
  { id: 'etg-turnip-fries', name: 'Turnip Fries', url: 'https://eatthegains.com/turnip-fries/', protein: 2, carbs: 15, fat: 5, calories: 109 , servings:4, ingredients:[{amount:2,unit:'lbs',name:'turnips'}] },
  { id: 'etg-raw-pad-thai-salad', name: 'Raw Pad Thai Salad', url: 'https://eatthegains.com/raw-pad-thai-salad/', protein: 4, carbs: 11, fat: 4, calories: 91 , servings:10, ingredients:[{amount:3,unit:'',name:'large zucchini, spiralized'},{amount:2,unit:'cup',name:'shredded carrots'},{amount:2,unit:'',name:'medium bell peppers, julienned'},{amount:4.5,unit:'tbsp',name:'peanut butter'},{amount:2,unit:'tbsp',name:'coconut aminos'},{amount:1,unit:'tbsp',name:'lime juice'}] },
  { id: 'etg-cheesy-buffalo-brussel-sprouts', name: 'Buffalo Brussels Sprouts', url: 'https://eatthegains.com/cheesy-buffalo-brussel-sprouts/', protein: 7, carbs: 15, fat: 6, calories: 124 , servings:4, ingredients:[{amount:1.5,unit:'lbs',name:'brussel sprouts'},{amount:1.5,unit:'tbsp',name:'hot sauce'},{amount:1,unit:'tbsp',name:'nutritional yeast'}] },
  { id: 'etg-whiskey-glazed-sweet-potatoes', name: 'Whiskey Glazed Sweet Potatoes', url: 'https://eatthegains.com/whiskey-glazed-sweet-potatoes/', protein: 5, carbs: 65, fat: 8, calories: 349 , servings:6, ingredients:[{amount:3,unit:'lbs',name:'sweet potatoes, cubed'},{amount:4,unit:'',name:'pieces bacon'},{amount:3,unit:'tbsp',name:'coconut aminos'},{amount:1.5,unit:'tbsp',name:'honey'}] },
  { id: 'etg-roasted-red-pepper-squash-soup', name: 'Roasted Red Pepper & Squash Soup', url: 'https://eatthegains.com/roasted-red-pepper-squash-soup/', protein: 2, carbs: 20, fat: 0, calories: 83 , servings:6, ingredients:[{amount:1,unit:'',name:'medium acorn squash'},{amount:2,unit:'',name:'medium red peppers'},{amount:2,unit:'cup',name:'vegetable broth'}] },
  { id: 'etg-sausage-stuffed-acorn-squash', name: 'Sausage Stuffed Acorn Squash', url: 'https://eatthegains.com/sausage-stuffed-acorn-squash/', protein: 33, carbs: 42, fat: 34, calories: 586 , servings:6, ingredients:[{amount:3,unit:'',name:'small-medium acorn squash'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'lbs',name:'ground pork'},{amount:1,unit:'',name:'medium apple, diced'},{amount:0.5,unit:'cup',name:'pecans'},{amount:0.25,unit:'cup',name:'dried cranberries'}] },
  { id: 'etg-arroz-verde-green-rice-recipe', name: 'Arroz Verde (Green Rice)', url: 'https://eatthegains.com/arroz-verde-green-rice-recipe/', protein: 2, carbs: 20, fat: 1, calories: 93 , servings:8, ingredients:[{amount:2,unit:'cup',name:'long grain white rice'},{amount:1,unit:'',name:'poblano pepper'},{amount:1,unit:'',name:'jalapeno pepper'},{amount:0.5,unit:'cup',name:'chopped onion'},{amount:1,unit:'cup',name:'packed cilantro'},{amount:1.75,unit:'cup',name:'vegetable broth'}] },
  { id: 'etg-balsamic-roasted-mushrooms', name: 'Balsamic Roasted Mushrooms', url: 'https://eatthegains.com/balsamic-roasted-mushrooms/', protein: 6, carbs: 7, fat: 2, calories: 67 , servings:3, ingredients:[{amount:2,unit:'lbs',name:'mushrooms'},{amount:3,unit:'tbsp',name:'balsamic vinegar'},{amount:0.5,unit:'cup',name:'parsley'}] },
  { id: 'etg-instant-pot-bbq-chicken-meatballs-paleo-whole30', name: 'Instant Pot BBQ Chicken Meatballs', url: 'https://eatthegains.com/instant-pot-bbq-chicken-meatballs-paleo-whole30/', protein: 30, carbs: 13, fat: 8, calories: 262 , servings:30, ingredients:[{amount:2,unit:'lbs',name:'ground chicken'},{amount:1,unit:'cup',name:'bbq sauce'},{amount:0.25,unit:'cup',name:'coconut flour'}] },
  { id: 'etg-beef-rice-stuffed-peppers', name: 'Beef and Rice Stuffed Peppers', url: 'https://eatthegains.com/beef-rice-stuffed-peppers/', protein: 22, carbs: 19, fat: 15, calories: 291 , servings:5, ingredients:[{amount:5,unit:'',name:'medium bell peppers'},{amount:1,unit:'cup',name:'diced onion'},{amount:1,unit:'lbs',name:'ground beef'},{amount:1,unit:'',name:'can diced tomatoes'},{amount:1.5,unit:'tbsp',name:'taco seasoning'},{amount:3,unit:'cup',name:'cauliflower rice'}] },
  { id: 'etg-paleo-pumpkin-protein-pancakes', name: 'Paleo Pumpkin Protein Pancakes', url: 'https://eatthegains.com/paleo-pumpkin-protein-pancakes/', protein: 34, carbs: 33, fat: 12, calories: 378 , servings:1, ingredients:[{amount:0.5,unit:'cup',name:'pumpkin puree'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'tbsp',name:'coconut flour'},{amount:2,unit:'tbsp',name:'tapioca flour'},{amount:1,unit:'tsp',name:'pumpkin pie spice'}] },
  { id: 'etg-sausage-apple-hash-paleo-whole30', name: 'Sweet Potato Sausage Hash', url: 'https://eatthegains.com/sausage-apple-hash-paleo-whole30/', protein: 19, carbs: 35, fat: 20, calories: 393 , servings:7, ingredients:[{amount:1,unit:'lbs',name:'ground pork'},{amount:2,unit:'',name:'medium-large sweet potatoes, cubed'},{amount:1,unit:'cup',name:'diced onion'},{amount:2,unit:'',name:'small apples, diced'},{amount:3,unit:'cup',name:'roughly chopped kale'},{amount:0.25,unit:'cup',name:'walnuts'}] },
  { id: 'etg-air-fryer-pork-chops-with-cabbage-apple-salad', name: 'Air Fryer Pork Chops with Cabbage Apple Salad', url: 'https://eatthegains.com/air-fryer-pork-chops-with-cabbage-apple-salad/', protein: 56, carbs: 31, fat: 24, calories: 553 , servings:2, ingredients:[{amount:2,unit:'',name:'boneless pork chops'},{amount:3,unit:'cup',name:'shredded cabbage'},{amount:0.5,unit:'',name:'large green apple'},{amount:2,unit:'tbsp',name:'raisins'},{amount:2,unit:'tbsp',name:'almonds'}] },
  { id: 'etg-instant-pot-buffalo-chicken', name: 'Instant Pot Buffalo Chicken', url: 'https://eatthegains.com/instant-pot-buffalo-chicken/', protein: 24, carbs: 1, fat: 8, calories: 177 , servings:5, ingredients:[{amount:2.5,unit:'lbs',name:'chicken breast'},{amount:1,unit:'cup',name:'buffalo sauce'}] },
  { id: 'etg-zucchini-pizza-boats', name: 'Zucchini Pizza Boats', url: 'https://eatthegains.com/zucchini-pizza-boats/', protein: 21, carbs: 11, fat: 18, calories: 288 , servings:6, ingredients:[{amount:3,unit:'',name:'medium zucchinis'},{amount:1,unit:'lbs',name:'ground pork'},{amount:1,unit:'',name:'can pizza sauce'},{amount:1,unit:'cup',name:'shredded mozzarella cheese'}] },
  { id: 'etg-cauliflower-shrimp-fried-rice', name: 'Cauliflower Shrimp Fried Rice', url: 'https://eatthegains.com/cauliflower-shrimp-fried-rice/', protein: 46, carbs: 33, fat: 15, calories: 437 , servings:3, ingredients:[{amount:3,unit:'',name:'large eggs'},{amount:1,unit:'lbs',name:'shrimp, peeled and deveined'},{amount:1,unit:'cup',name:'diced onions'},{amount:1,unit:'cup',name:'diced carrots'},{amount:4,unit:'cup',name:'broccoli florets'},{amount:6,unit:'cup',name:'cauliflower rice'},{amount:1,unit:'cup',name:'mushrooms'},{amount:3,unit:'tbsp',name:'coconut aminos'}] },
  { id: 'etg-avocado-cauliflower-rice', name: 'Avocado Cauliflower Rice', url: 'https://eatthegains.com/avocado-cauliflower-rice/', protein: 4, carbs: 14, fat: 10, calories: 151 , servings:6, ingredients:[{amount:6,unit:'cup',name:'cauliflower rice'},{amount:1,unit:'cup',name:'diced yellow onion'},{amount:2,unit:'',name:'large avocados'},{amount:2.5,unit:'tbsp',name:'lime juice'},{amount:0.5,unit:'cup',name:'cilantro'}] },
  { id: 'etg-tropical-chicken-salad-with-mango-coconut-dressing', name: 'Tropical Chicken Salad with Mango Dressing', url: 'https://eatthegains.com/tropical-chicken-salad-with-mango-coconut-dressing/', protein: 31, carbs: 23, fat: 27, calories: 434 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breasts'},{amount:8,unit:'cup',name:'chopped romaine lettuce'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced mango'},{amount:0.5,unit:'cup',name:'macadamia nuts'},{amount:1,unit:'',name:'large avocado'},{amount:0.333,unit:'cup',name:'coconut flakes'}] },
  { id: 'etg-herb-grilled-salmon', name: 'Herb Grilled Salmon', url: 'https://eatthegains.com/herb-grilled-salmon/', protein: 30, carbs: 2, fat: 28, calories: 303 , servings:4, ingredients:[{amount:4,unit:'',name:'salmon filets'},{amount:0.5,unit:'cup',name:'fresh parsley'},{amount:0.5,unit:'cup',name:'fresh cilantro'},{amount:3,unit:'tbsp',name:'lemon juice'},{amount:1.5,unit:'tbsp',name:'olive oil'}] },
  { id: 'etg-greek-chicken-pasta-salad', name: 'Greek Chicken Pasta Salad', url: 'https://eatthegains.com/greek-chicken-pasta-salad/', protein: 12, carbs: 9, fat: 10, calories: 172 , servings:10, ingredients:[{amount:1,unit:'lbs',name:'chicken tenders'},{amount:4,unit:'',name:'medium zucchini, spiralized'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:1,unit:'cup',name:'diced red onion'},{amount:1,unit:'cup',name:'kalamata olives'},{amount:1,unit:'',name:'can quartered artichoke hearts'},{amount:0.5,unit:'cup',name:'crumbled feta'}] },
  { id: 'etg-burger-salad', name: 'Burger Salad', url: 'https://eatthegains.com/burger-salad/', protein: 28, carbs: 17, fat: 41, calories: 539 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ground beef'},{amount:8,unit:'cup',name:'chopped romaine'},{amount:2,unit:'cup',name:'cherry tomatoes'},{amount:0.5,unit:'cup',name:'pickle chips'},{amount:1,unit:'',name:'large avocado'},{amount:0.5,unit:'cup',name:'shredded cheese'}] },
  { id: 'etg-paleo-jalapeno-ranch-turkey-burgers', name: 'Jalapeno Ranch Turkey Burgers', url: 'https://eatthegains.com/paleo-jalapeno-ranch-turkey-burgers/', protein: 22, carbs: 3, fat: 18, calories: 264 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'lean ground turkey'},{amount:1,unit:'',name:'jalapeño, diced'},{amount:0.25,unit:'cup',name:'ranch dressing'}] },
  { id: 'etg-grilled-lemon-pepper-chicken', name: 'Grilled Lemon Pepper Chicken', url: 'https://eatthegains.com/grilled-lemon-pepper-chicken/', protein: 35, carbs: 2, fat: 4, calories: 187 , servings:8, ingredients:[{amount:2.2,unit:'lbs',name:'chicken breast'},{amount:0.5,unit:'cup',name:'lemon juice'}] },
  { id: 'etg-sweet-potato-blueberry-protein-muffins', name: 'Sweet Potato Blueberry Protein Muffins', url: 'https://eatthegains.com/sweet-potato-blueberry-protein-muffins/', protein: 7, carbs: 18, fat: 3, calories: 127 , servings:12, ingredients:[{amount:1.5,unit:'cup',name:'rolled oats'},{amount:1,unit:'',name:'small sweet potato'},{amount:1,unit:'cup',name:'plain yogurt'},{amount:2,unit:'',name:'large eggs'},{amount:2,unit:'scoop',name:'vanilla protein powder'},{amount:1.5,unit:'cup',name:'blueberries'}] },
  { id: 'etg-harissa-salmon-burgers', name: 'Harissa Salmon Burgers', url: 'https://eatthegains.com/harissa-salmon-burgers/', protein: 31, carbs: 8, fat: 19, calories: 326 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'raw salmon'},{amount:6,unit:'tbsp',name:'almond flour'},{amount:1,unit:'',name:'large egg'},{amount:2,unit:'tbsp',name:'harissa'}] },
  { id: 'etg-taco-spaghetti-squash-boats', name: 'Taco Spaghetti Squash Boats', url: 'https://eatthegains.com/taco-spaghetti-squash-boats/', protein: 25, carbs: 46, fat: 26, calories: 467 , servings:4, ingredients:[{amount:2,unit:'',name:'small spaghetti squashes'},{amount:1,unit:'lbs',name:'ground beef'},{amount:0.5,unit:'cup',name:'chopped yellow onion'},{amount:0.5,unit:'cup',name:'chopped bell pepper'},{amount:1,unit:'tbsp',name:'taco seasoning'},{amount:1,unit:'',name:'medium avocado'}] },
  { id: 'etg-no-bake-carrot-cake-protein-bars-vegan', name: 'No Bake Carrot Cake Protein Bars', url: 'https://eatthegains.com/no-bake-carrot-cake-protein-bars-vegan/', protein: 4, carbs: 15, fat: 5, calories: 112 , servings:12, ingredients:[{amount:0.5,unit:'cup',name:'dates'},{amount:0.5,unit:'cup',name:'raisins'},{amount:0.5,unit:'cup',name:'walnuts'},{amount:2,unit:'scoop',name:'vanilla protein powder'},{amount:1.5,unit:'cup',name:'shredded carrots'}] },
  { id: 'etg-chicken-cabbage-salad', name: 'Chicken Cabbage Salad', url: 'https://eatthegains.com/chicken-cabbage-salad/', protein: 32, carbs: 20, fat: 11, calories: 312 , servings:16, ingredients:[{amount:2,unit:'lbs',name:'chicken breast'},{amount:1,unit:'',name:'small head green cabbage'},{amount:2,unit:'',name:'medium red bell peppers'},{amount:2,unit:'',name:'large carrots'},{amount:2,unit:'cup',name:'sugar snap peas'},{amount:1,unit:'cup',name:'cashews'},{amount:0.25,unit:'cup',name:'coconut aminos'}] },
  { id: 'etg-air-fryer-salmon-asparagus', name: 'Air Fryer Salmon & Asparagus', url: 'https://eatthegains.com/air-fryer-salmon-asparagus/', protein: 48, carbs: 9, fat: 19, calories: 391 , servings:2, ingredients:[{amount:2,unit:'',name:'salmon filets'},{amount:1,unit:'bunch',name:'asparagus'},{amount:1.5,unit:'tbsp',name:'lemon juice'},{amount:2,unit:'tbsp',name:'fresh dill'}] },
  { id: 'etg-balsamic-chicken-veggies-skillet-paleo-whole30', name: 'Balsamic Chicken & Veggies Skillet', url: 'https://eatthegains.com/balsamic-chicken-veggies-skillet-paleo-whole30/', protein: 37, carbs: 32, fat: 12, calories: 373 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast, diced'},{amount:1,unit:'',name:'large bell pepper'},{amount:4,unit:'cup',name:'shredded brussels sprouts'},{amount:4,unit:'cup',name:'packed kale'},{amount:1,unit:'cup',name:'cherry tomatoes'},{amount:0.25,unit:'cup',name:'balsamic vinegar'}] },
  { id: 'etg-sausage-pepper-rice-soup-paleo-whole30', name: 'Sausage, Pepper & Rice Soup', url: 'https://eatthegains.com/sausage-pepper-rice-soup-paleo-whole30/', protein: 16, carbs: 24, fat: 13, calories: 277 , servings:8, ingredients:[{amount:4,unit:'link',name:'precooked sausage, sliced'},{amount:1,unit:'cup',name:'chopped onion'},{amount:2,unit:'',name:'large bell pepper, diced'},{amount:5,unit:'cup',name:'broth'},{amount:4,unit:'cup',name:'packed kale'},{amount:2,unit:'cup',name:'cauliflower rice'}] },
  { id: 'etg-chicken-caesar-spaghetti-squash-boats', name: 'Chicken Caesar Spaghetti Squash Boats', url: 'https://eatthegains.com/chicken-caesar-spaghetti-squash-boats/', protein: 33, carbs: 42, fat: 24, calories: 498 , servings:4, ingredients:[{amount:2,unit:'',name:'small spaghetti squashes'},{amount:1,unit:'lbs',name:'chicken breast, cubed'},{amount:4,unit:'cup',name:'packed chopped kale'},{amount:0.375,unit:'cup',name:'caesar dressing'}] },
  { id: 'etg-turkey-kale-spaghetti-squash-boats', name: 'Turkey Kale Spaghetti Squash Boats', url: 'https://eatthegains.com/turkey-kale-spaghetti-squash-boats/', protein: 36, carbs: 47, fat: 25, calories: 526 , servings:2, ingredients:[{amount:1,unit:'',name:'small spaghetti squash'},{amount:0.5,unit:'lbs',name:'ground turkey'},{amount:3,unit:'cup',name:'packed kale'},{amount:3.5,unit:'oz',name:'goat cheese'}] },
  { id: 'etg-paleo-beef-and-plantain-chili-whole30', name: 'Paleo Beef and Plantain Chili', url: 'https://eatthegains.com/paleo-beef-and-plantain-chili-whole30/', protein: 27, carbs: 59, fat: 21, calories: 521 , servings:10, ingredients:[{amount:1,unit:'lbs',name:'ground beef'},{amount:2,unit:'',name:'large bell peppers, diced'},{amount:3,unit:'cup',name:'broth'},{amount:1,unit:'',name:'can fire roasted tomatoes'},{amount:2,unit:'',name:'large yellow plantains'}] },
  { id: 'etg-whole30-chicken-and-broccoli-alfredo-paleo', name: 'Whole30 Chicken and Broccoli Alfredo', url: 'https://eatthegains.com/whole30-chicken-and-broccoli-alfredo-paleo/', protein: 39, carbs: 26, fat: 12, calories: 365 , servings:5, ingredients:[{amount:1.5,unit:'lbs',name:'chicken breast'},{amount:6,unit:'cup',name:'broccoli florets'},{amount:3,unit:'',name:'large turnips, peeled'},{amount:0.625,unit:'cup',name:'raw cashews'}] },
  { id: 'etg-whole30-shrimp-butternut-squash-noodles-with-curry-peanut-sauce', name: 'Whole30 Shrimp & Butternut Squash Noodles with Curry Sauce', url: 'https://eatthegains.com/whole30-shrimp-butternut-squash-noodles-with-curry-peanut-sauce/', protein: 51, carbs: 56, fat: 17, calories: 502 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'shrimp, peeled and deveined'},{amount:2,unit:'package',name:'butternut squash noodles'},{amount:6,unit:'cup',name:'broccoli florets'},{amount:2,unit:'',name:'medium red bell peppers'},{amount:0.25,unit:'cup',name:'sunbutter'},{amount:1.5,unit:'tbsp',name:'red curry paste'}] },
  { id: 'etg-kale-salad-with-butternut-squash-pomegranates', name: 'Kale Salad with Butternut Squash & Pomegranates', url: 'https://eatthegains.com/kale-salad-with-butternut-squash-pomegranates/', protein: 7, carbs: 20, fat: 16, calories: 236 , servings:4, ingredients:[{amount:5,unit:'cup',name:'packed baby kale'},{amount:1,unit:'package',name:'butternut squash noodles'},{amount:0.5,unit:'cup',name:'pomegranate seeds'},{amount:0.5,unit:'cup',name:'walnuts'},{amount:2,unit:'tbsp',name:'pumpkin seeds'}] },
  { id: 'etg-spicy-grilled-citrus-turkey-breast-paleo', name: 'Spicy Grilled Citrus Turkey Breast', url: 'https://eatthegains.com/spicy-grilled-citrus-turkey-breast-paleo/', protein: 26, carbs: 6, fat: 9, calories: 218 , servings:16, ingredients:[{amount:4,unit:'lbs',name:'turkey breast'},{amount:1,unit:'cup',name:'pineapple juice'},{amount:0.5,unit:'cup',name:'coconut aminos'}] },
  { id: 'etg-paleo-breakfast-fried-rice-whole30', name: 'Paleo Breakfast Fried Rice', url: 'https://eatthegains.com/paleo-breakfast-fried-rice-whole30/', protein: 7, carbs: 14, fat: 8, calories: 154 , servings:4, ingredients:[{amount:5,unit:'',name:'pieces bacon'},{amount:1,unit:'cup',name:'diced yellow onion'},{amount:1,unit:'',name:'large red bell pepper'},{amount:2,unit:'cup',name:'packed chopped kale'},{amount:3.75,unit:'cup',name:'fresh riced cauliflower'},{amount:3,unit:'tbsp',name:'coconut aminos'}] },
  { id: 'etg-paleo-popcorn-chicken-whole30', name: 'Paleo Popcorn Chicken', url: 'https://eatthegains.com/paleo-popcorn-chicken-whole30/', protein: 35, carbs: 10, fat: 45, calories: 571 , servings:6, ingredients:[{amount:1.5,unit:'lbs',name:'chicken breast or tenders'},{amount:1.5,unit:'cup',name:'almond flour'},{amount:3,unit:'',name:'large eggs'}] },
  { id: 'etg-zucchini-noodles-with-blistered-tomatoes-basil', name: 'Zucchini Noodles with Blistered Tomatoes & Basil', url: 'https://eatthegains.com/zucchini-noodles-with-blistered-tomatoes-basil/', protein: 3, carbs: 11, fat: 6, calories: 93 , servings:2, ingredients:[{amount:1,unit:'pint',name:'cherry tomatoes'},{amount:1,unit:'',name:'container zucchini spirals'},{amount:1,unit:'tbsp',name:'butter'}] },
  { id: 'etg-grilled-steak-with-pistachio-pesto-paleo-whole30', name: 'Grilled Steak with Pistachio Pesto', url: 'https://eatthegains.com/grilled-steak-with-pistachio-pesto-paleo-whole30/', protein: 24, carbs: 2, fat: 25, calories: 327 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'ny strip steaks'},{amount:1.5,unit:'cup',name:'loosely packed basil'},{amount:0.5,unit:'cup',name:'shelled pistachios'},{amount:5,unit:'tbsp',name:'olive oil'}] },
  { id: 'etg-peach-and-pistachio-salad-grilled-chicken', name: 'Peach and Pistachio Salad with Grilled Chicken', url: 'https://eatthegains.com/peach-and-pistachio-salad-grilled-chicken/', protein: 33, carbs: 14, fat: 14, calories: 288 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:5,unit:'oz',name:'arugula'},{amount:2,unit:'',name:'medium peaches, sliced'},{amount:0.5,unit:'cup',name:'shelled pistachios'}] },
  { id: 'etg-whole30-fish-taco-bowls', name: 'Whole30 Fish Taco Bowls', url: 'https://eatthegains.com/whole30-fish-taco-bowls/', protein: 28, carbs: 24, fat: 22, calories: 399 , servings:2, ingredients:[{amount:2,unit:'filet',name:'mahi mahi'},{amount:2,unit:'cup',name:'riced cauliflower'},{amount:4,unit:'cup',name:'shredded cabbage'},{amount:0.5,unit:'cup',name:'mango salsa'},{amount:0.5,unit:'',name:'large avocado'}] },
  { id: 'etg-plantain-crusted-crispy-shrimp-tacos', name: 'Plantain Crusted Crispy Shrimp Tacos', url: 'https://eatthegains.com/plantain-crusted-crispy-shrimp-tacos/', protein: 28, carbs: 29, fat: 10, calories: 326 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'shrimp, peeled and deveined'},{amount:1,unit:'bag',name:'plantain chips'},{amount:2,unit:'',name:'large eggs'},{amount:1.5,unit:'cup',name:'shredded cabbage'},{amount:1,unit:'cup',name:'cherry tomatoes'}] },
  { id: 'etg-meal-prep-salmon-and-veggies-bowls', name: 'Meal Prep Salmon and Veggies Bowls', url: 'https://eatthegains.com/meal-prep-salmon-and-veggies-bowls/', protein: 38, carbs: 42, fat: 21, calories: 518 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'wild caught salmon'},{amount:2,unit:'',name:'medium purple sweet potatoes'},{amount:1,unit:'',name:'head cauliflower'},{amount:4,unit:'cup',name:'packed baby kale'}] },
  { id: 'etg-paleo-supreme-pizza-meatballs', name: 'Paleo Supreme Pizza Meatballs', url: 'https://eatthegains.com/paleo-supreme-pizza-meatballs/', protein: 18, carbs: 5, fat: 24, calories: 303 , servings:24, ingredients:[{amount:1,unit:'lbs',name:'ground sausage'},{amount:0.5,unit:'cup',name:'diced green pepper'},{amount:1,unit:'cup',name:'diced mushrooms'},{amount:0.25,unit:'cup',name:'pizza sauce'}] },
  { id: 'etg-chili-dusted-chicken-sweet-potato-noodles-avocado-sauce', name: 'Chili Dusted Chicken & Sweet Potato Noodles with Avocado Sauce', url: 'https://eatthegains.com/chili-dusted-chicken-sweet-potato-noodles-avocado-sauce/', protein: 49, carbs: 29, fat: 10, calories: 402 , servings:3, ingredients:[{amount:1,unit:'lbs',name:'chicken breasts'},{amount:1,unit:'package',name:'sweet potato spirals'},{amount:1,unit:'cup',name:'cherry tomatoes'}] },
  { id: 'etg-fall-veggie-chicken-power-bowl', name: 'Fall Veggie Chicken Power Bowl', url: 'https://eatthegains.com/fall-veggie-chicken-power-bowl/', protein: 35, carbs: 47, fat: 28, calories: 566 , servings:4, ingredients:[{amount:1,unit:'lbs',name:'chicken breast'},{amount:2.5,unit:'cup',name:'cubed butternut squash'},{amount:2,unit:'',name:'large parsnips, cubed'},{amount:1,unit:'',name:'large beet, cubed'},{amount:4,unit:'cup',name:'packed kale'},{amount:1,unit:'cup',name:'chickpeas'},{amount:0.5,unit:'cup',name:'goat cheese'},{amount:1,unit:'',name:'small avocado'}] },
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
// ── Grocery store chains ────────────────────────────────────────
const STORE_KEY = 'prepflowStore';

const STORE_CHAINS = [
  { id: 'heb',        name: 'H-E-B',         nameMatch: /h[\-.]?e[\-.]?b/i,       mapQ: 'H-E-B+grocery',             weeklyAd: 'https://www.heb.com/weekly-ads' },
  { id: 'kroger',     name: 'Kroger',         nameMatch: /kroger/i,                mapQ: 'Kroger',                    weeklyAd: 'https://www.kroger.com/weeklyad' },
  { id: 'walmart',    name: 'Walmart',        nameMatch: /walmart/i,               mapQ: 'Walmart+Supercenter',       weeklyAd: 'https://www.walmart.com/store/weeklyads' },
  { id: 'target',     name: 'Target',         nameMatch: /\btarget\b/i,            mapQ: 'Target',                    weeklyAd: 'https://www.target.com/circle/weekly-ad' },
  { id: 'costco',     name: 'Costco',         nameMatch: /costco/i,                mapQ: 'Costco+Wholesale',          weeklyAd: 'https://www.costco.com/coupons.html' },
  { id: 'aldi',       name: 'Aldi',           nameMatch: /\baldi\b/i,              mapQ: 'Aldi',                      weeklyAd: 'https://www.aldi.us/en/weekly-specials/' },
  { id: 'sprouts',    name: 'Sprouts',        nameMatch: /sprouts/i,               mapQ: 'Sprouts+Farmers+Market',    weeklyAd: 'https://www.sprouts.com/weekly-ad/' },
  { id: 'wholefoods', name: 'Whole Foods',    nameMatch: /whole\s*foods/i,         mapQ: 'Whole+Foods+Market',        weeklyAd: 'https://www.wholefoodsmarket.com/sales-flyer' },
  { id: 'publix',     name: 'Publix',         nameMatch: /publix/i,                mapQ: 'Publix',                    weeklyAd: 'https://www.publix.com/savings/weekly-ad' },
  { id: 'traderjoes', name: "Trader Joe's",   nameMatch: /trader\s*joe/i,          mapQ: "Trader+Joe's",              weeklyAd: 'https://www.traderjoes.com/home/products/featured-items' },
  { id: 'safeway',    name: 'Safeway',        nameMatch: /safeway/i,               mapQ: 'Safeway',                   weeklyAd: 'https://www.safeway.com/weeklyad' },
  { id: 'meijer',     name: 'Meijer',         nameMatch: /meijer/i,                mapQ: 'Meijer',                    weeklyAd: 'https://www.meijer.com/content/meijer/en/weekly-ad.html' },
];

function loadSelectedStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function saveSelectedStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (_) {}
}

// Sun=0 … Sat=6, matching Date.getDay()
const ALL_DAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STORAGE_KEY  = 'mealPrepCalendar';
const PREFS_KEY    = 'prepflowPrefs';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { weekStartDay: 1, prepMode: 'batch', ...JSON.parse(raw) };
  } catch (_) {}
  return { weekStartDay: 1, prepMode: 'batch' };
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  } catch (_) {}
}

function loadMeals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old format (string|null per day) to new (string[] per day)
      const migrated = {};
      for (const [week, days] of Object.entries(parsed)) {
        migrated[week] = days.map(d => {
          if (!Array.isArray(d)) return d ? [{ recipeId: d, members: MEMBERS.map(m => m.id) }] : [];
          return d.map(entry =>
            typeof entry === 'string'
              ? { recipeId: entry, members: MEMBERS.map(m => m.id) }
              : entry
          );
        });
      }
      return migrated;
    }
  } catch (_) {}
  const allMembers = MEMBERS.map(m => m.id);
  return { 0: MEAL_CALENDAR.map(d => d.slots[0].meal ? [{ recipeId: d.slots[0].meal, members: allMembers }] : []) };
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
  armedRecipeId: null,
  calPrefsOpen: false,
  mealsByWeek:    loadMeals(),
  memberPhases:   loadMemberPhases(),
  memberMacros:   loadMemberMacros(),
  calcInputs:     loadCalcInputs(),
  prefs:          loadPrefs(),
  selectedStore:       loadSelectedStore(),
  userLocation:        null,
  nearbyStores:        null,
  nearbyStoresLoading: false,
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
  renderMealCalendar();
  renderGroceryList();
  renderStoreBanner();
  renderStoreLayout();
  renderPrepSteps();
  renderPortionTable();
}

function renderDownstream() {
  renderGroceryList();
  renderStoreBanner();
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

  grid.innerHTML = RECIPES.map((recipe, i) => {
    const armed = state.armedRecipeId === recipe.id;
    return `
      <div
        class="recipe-card${armed ? ' armed' : ''}"
        data-recipe-index="${i}"
        onclick="armRecipe('${recipe.id}')"
      >
        <div class="recipe-card-top">
          <div class="recipe-name">${recipe.name}</div>
          <button class="recipe-remove-btn" onclick="removeRecipe(${i}, event)" title="Remove recipe" aria-label="Remove recipe">✕</button>
        </div>
        <div class="macro-badges">
          <span class="badge badge-protein">${recipe.protein}g protein</span>
          <span class="badge badge-carbs">${recipe.carbs}g carbs</span>
          ${recipe.fat ? `<span class="badge badge-fat">${recipe.fat}g fat</span>` : ''}
          <span class="badge badge-calories">${recipe.calories} cal</span>
        </div>
        ${armed ? `<div class="recipe-armed-hint">Tap a day to add ↓</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Stage 1 — Weekly meal calendar with week navigation.
 */
function renderMealCalendar() {
  const monday = getWeekStart(state.weekOffset);
  const meals  = getMealsForWeek(state.weekOffset);

  // Card header: title + prev/next arrows + prefs gear
  const header = document.getElementById('meal-cal-header');
  if (header) {
    const label = monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    header.innerHTML = `
      <span>Meal calendar</span>
      <div class="cal-header-right">
        <div class="week-nav">
          <button class="week-nav-btn" onclick="changeWeek(-1)" title="Previous week">&#8592;</button>
          <span class="week-nav-label">${label}</span>
          <button class="week-nav-btn" onclick="changeWeek(1)" title="Next week">&#8594;</button>
        </div>
        <button class="cal-prefs-btn${state.calPrefsOpen ? ' active' : ''}" onclick="toggleCalPrefs()" title="Calendar preferences" aria-label="Calendar preferences">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;
  }

  // Prefs panel
  const prefsPanel = document.getElementById('cal-prefs-panel');
  if (prefsPanel) {
    if (state.calPrefsOpen) {
      const startDay = state.prefs.weekStartDay;
      prefsPanel.innerHTML = `
        <div class="cal-prefs-row">
          <span class="cal-prefs-label">Week starts on</span>
          <div class="cal-prefs-days">
            ${ALL_DAYS.map((d, i) => `
              <button class="cal-prefs-day-btn${startDay === i ? ' active' : ''}" onclick="setWeekStartDay(${i})">${d}</button>
            `).join('')}
          </div>
        </div>
      `;
      prefsPanel.style.display = 'block';
    } else {
      prefsPanel.style.display = 'none';
    }
  }

  // Keep the app header subtitle in sync
  const weekLabel = document.getElementById('week-label');
  if (weekLabel) {
    weekLabel.textContent = 'Week of ' + monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const cal = document.getElementById('meal-calendar');
  if (!cal) return;

  const armed = state.armedRecipeId;
  const armedRecipe = armed ? [...RECIPES, ...ETG_RECIPES].find(r => r.id === armed) : null;

  // Build day names starting from configured week start
  const startDay = state.prefs.weekStartDay;
  const weekDayNames = Array.from({ length: 7 }, (_, i) => ALL_DAYS[(startDay + i) % 7]);

  cal.innerHTML = weekDayNames.map((name, dayIdx) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + dayIdx);

    const dayMeals = meals[dayIdx] || [];

    const chips = dayMeals.map((meal, mealIdx) => {
      const { recipeId, members = [] } = meal;
      const recipe = [...RECIPES, ...ETG_RECIPES].find(r => r.id === recipeId);
      const label = recipe ? recipe.name : recipeId;
      const avatarBadges = MEMBERS.map(m => {
        const active = members.includes(m.id);
        return `<button class="chip-avatar${active ? ' chip-avatar--on' : ''} ${m.avatarClass}"
          onclick="toggleMealMember(event,${state.weekOffset},${dayIdx},${mealIdx},'${m.id}')"
          title="${m.name}">${m.initials}</button>`;
      }).join('');
      return `
        <div class="meal-chip"
          draggable="true"
          ondragstart="handleDragStart(event,${state.weekOffset},${dayIdx},${mealIdx})"
          ondragend="handleDragEnd(event)"
        >
          <div class="meal-chip-top">
            <span class="meal-chip-name" title="${label}">${label}</span>
            <button class="meal-chip-remove" onclick="clearMeal(event,${state.weekOffset},${dayIdx},${mealIdx})" title="Remove" aria-label="Remove">✕</button>
          </div>
          <div class="chip-avatars">${avatarBadges}</div>
        </div>
      `;
    }).join('');

    const dropZone = armed
      ? `<div class="meal-drop-zone" onclick="stampMeal(${state.weekOffset},${dayIdx})">+ add</div>`
      : (dayMeals.length === 0 ? `<div class="meal-day-empty">—</div>` : '');

    return `
      <div class="day-row"
        ondragover="handleDragOver(event)"
        ondragleave="handleDragLeave(event)"
        ondrop="handleDrop(event,${state.weekOffset},${dayIdx})"
      >
        <div class="day-row-hdr">
          <span class="day-row-name">${name}</span>
          <span class="day-row-date">${date.getDate()}</span>
        </div>
        <div class="day-meals">
          ${chips}
          ${dropZone}
        </div>
      </div>
    `;
  }).join('');

  // Arm banner
  const banner = document.getElementById('arm-banner');
  if (banner) {
    if (armed && armedRecipe) {
      banner.innerHTML = `<span>Tap a day below to add <strong>${armedRecipe.name}</strong></span><button onclick="disarmRecipe()">Cancel ✕</button>`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }
}

function clearMeal(event, weekOffset, dayIndex, mealIndex) {
  event.stopPropagation();
  state.mealsByWeek[weekOffset][dayIndex].splice(mealIndex, 1);
  saveMeals();
  renderMealCalendar();
  renderDownstream();
}

function changeWeek(delta) {
  state.weekOffset += delta;
  renderMealCalendar();
}

function toggleCalPrefs() {
  state.calPrefsOpen = !state.calPrefsOpen;
  renderMealCalendar();
}

function setWeekStartDay(dayIndex) {
  state.prefs.weekStartDay = dayIndex;
  state.weekOffset = 0; // reset to current week under new start day
  savePrefs();
  renderMealCalendar();
}

function getWeekStart(offset) {
  const startDay = state.prefs.weekStartDay; // 0=Sun … 6=Sat
  const today = new Date();
  const dow = today.getDay();
  const diff = (dow - startDay + 7) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diff + offset * 7);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

function getMealsForWeek(offset) {
  if (!state.mealsByWeek[offset]) {
    state.mealsByWeek[offset] = Array(7).fill(null).map(() => []);
    saveMeals();
  }
  return state.mealsByWeek[offset];
}

/**
 * Stage 2 — Grocery list driven by the meal calendar.
 */
function renderGroceryList() {
  const container = document.getElementById('grocery-list-container');
  if (!container) return;

  const plan = buildWeekPlan();

  if (!plan.hasMeals) {
    state.totalItems = 0;
    state.checkedItems = 0;
    _checkedIngredients.clear();
    container.innerHTML = `<div class="plan-empty-state">Add meals to your calendar on Stage 1 to generate your grocery list.</div>`;
    document.getElementById('total-items').textContent = '0';
    document.getElementById('remaining-count').textContent = '0';
    return;
  }

  // Group ingredients by category
  const grouped = {};
  for (const ing of plan.ingredients) {
    const cat = categorizeIngredient(ing.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(ing);
  }
  const catOrder = INGREDIENT_CATS.map(c => c.label).concat(['Other']);
  const sortedCats = catOrder.filter(c => grouped[c]);

  state.totalItems = plan.ingredients.length;
  state.checkedItems = _checkedIngredients.size;
  document.getElementById('total-items').textContent = state.totalItems;
  document.getElementById('remaining-count').textContent = state.totalItems - state.checkedItems;

  const checkSvg = `<svg class="check-icon" viewBox="0 0 11 11" fill="none"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  container.innerHTML = sortedCats.map(cat => {
    const items = grouped[cat];
    const catMeta = INGREDIENT_CATS.find(c => c.label === cat);
    return `
      <div class="grocery-section">
        <div class="grocery-section-title">${catMeta ? catMeta.icon + ' ' : ''}${cat}</div>
        ${items.map(ing => {
          const key = `${ing.name.toLowerCase().trim()}|${ing.unit}`;
          const checked = _checkedIngredients.has(key);
          const recipeTags = ing.fromRecipes.length > 1
            ? `<span class="ing-sources">${ing.fromRecipes.length} recipes</span>`
            : `<span class="ing-sources">${ing.fromRecipes[0]}</span>`;
          return `
            <div class="grocery-item">
              <div class="grocery-check ${checked ? 'checked' : ''}"
                onclick="toggleGroceryItem('${key.replace(/'/g,"\\'")}', this)"
                title="Mark as got it">${checkSvg}</div>
              <span class="grocery-name ${checked ? 'checked' : ''}">${ing.name}</span>
              ${recipeTags}
              <span class="grocery-qty">${fmtIngQty(ing.amount, ing.unit)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

/**
 * Stage 3 — Store aisle order, driven by calendar ingredients.
 */
function renderStoreLayout() {
  const container = document.getElementById('store-layout');
  if (!container) return;

  const plan = buildWeekPlan();

  if (!plan.hasMeals) {
    container.innerHTML = `<div class="plan-empty-state">Your shopping route will appear here once meals are added to the calendar.</div>`;
    return;
  }

  // Group by category in store-walk order
  const grouped = {};
  for (const ing of plan.ingredients) {
    const cat = categorizeIngredient(ing.name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(ing);
  }
  const catOrder = INGREDIENT_CATS.map(c => c.label).concat(['Other']);
  const sortedCats = catOrder.filter(c => grouped[c]);

  container.innerHTML = sortedCats.map(cat => {
    const items = grouped[cat];
    const meta = INGREDIENT_CATS.find(c => c.label === cat);
    const itemsText = items.map(i => `${i.name} (${fmtIngQty(i.amount, i.unit)})`).join(' · ');
    return `
      <div class="store-row">
        <div class="store-icon">${meta ? meta.icon : '📦'}</div>
        <div>
          <div class="store-cat-name">${cat}</div>
          <div class="store-items-text">${itemsText}</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Stage 4 — Prep overview driven by calendar recipes.
 */
function renderPrepSteps() {
  const container = document.getElementById('prep-steps');
  const titleEl   = document.getElementById('prep-header-title');
  if (!container) return;

  const plan = buildWeekPlan();
  const mode = state.prefs.prepMode || 'batch';

  // Sync toggle button active state
  document.querySelectorAll('.prep-mode-btn').forEach(btn => {
    const btnMode = btn.textContent.trim() === 'Batch session' ? 'batch' : 'by-meal';
    btn.classList.toggle('active', btnMode === mode);
  });

  if (!plan.hasMeals) {
    if (titleEl) titleEl.textContent = 'Prep plan';
    container.innerHTML = `<div class="plan-empty-state">Your prep plan will appear here once meals are added to the calendar.</div>`;
    return;
  }

  if (mode === 'batch') {
    const { steps, timeLabel } = generateBatchSteps(plan);
    if (titleEl) titleEl.textContent = `Batch prep session — est. ${timeLabel}`;

    container.innerHTML = steps.map((step, i) => `
      <div class="prep-step">
        <div class="step-number">${i + 1}</div>
        <div class="step-body">
          <div class="step-title">${step.title}</div>
          <div class="step-desc">${step.desc}</div>
          <div class="step-time">
            ${step.active ? `<span class="time-badge time-badge--active">${step.active}</span>` : ''}
            ${step.cook   ? `<span class="time-badge time-badge--cook">${step.cook}</span>`   : ''}
          </div>
        </div>
      </div>
    `).join('');

  } else {
    // By-meal mode: per-recipe steps using the same smart sequence, scoped to each recipe
    const startDay = state.prefs.weekStartDay;
    const weekDayNames = Array.from({ length: 7 }, (_, i) => ALL_DAYS[(startDay + i) % 7]);
    if (titleEl) titleEl.textContent = 'By meal — step-by-step per recipe';

    container.innerHTML = plan.recipes.map(({ recipe, instances, totalScale }, recipeIdx) => {
      const memberSummary = [...new Set(instances.flatMap(inst => inst.members))]
        .map(mid => {
          const m = MEMBERS.find(x => x.id === mid);
          return `<span class="prep-avatar avatar ${m.avatarClass}">${m.initials}</span>`;
        }).join('');

      const dayLabels = instances.map(inst => weekDayNames[inst.dayIdx]).join(', ');
      const batchLabel = `×${totalScale.toFixed(2)} batch`;

      // Build a mini-plan with just this recipe's scaled ingredients so generateBatchSteps
      // produces steps specific to what this recipe actually calls for
      const miniPlan = {
        ingredients: (recipe.ingredients || []).map(ing => ({
          name: ing.name,
          amount: ing.amount * totalScale,
          unit: ing.unit,
          fromRecipes: [recipe.name],
        })),
      };

      const { steps, timeLabel } = generateBatchSteps(miniPlan);

      const stepsHtml = steps.map((step, i) => `
        <div class="prep-step prep-step--sub">
          <div class="step-number step-number--sm">${i + 1}</div>
          <div class="step-body">
            <div class="step-title">${step.title}</div>
            <div class="step-desc">${step.desc}</div>
            <div class="step-time">
              ${step.active ? `<span class="time-badge time-badge--active">${step.active}</span>` : ''}
              ${step.cook   ? `<span class="time-badge time-badge--cook">${step.cook}</span>`   : ''}
            </div>
          </div>
        </div>
      `).join('');

      return `
        <div class="by-meal-section">
          <div class="by-meal-header">
            <div class="by-meal-num">${recipeIdx + 1}</div>
            <div class="by-meal-info">
              <div class="step-title">${recipe.name}</div>
              <div class="prep-meta">
                <span class="prep-batch-label">${batchLabel}</span>
                <span class="prep-days">${dayLabels}</span>
                <span class="prep-avatars">${memberSummary}</span>
              </div>
              <div class="step-time" style="margin-top:4px">
                <span class="time-badge time-badge--cook">est. ${timeLabel}</span>
              </div>
            </div>
          </div>
          <div class="by-meal-steps">${stepsHtml}</div>
        </div>
      `;
    }).join('');
  }
}

function setPrepMode(mode) {
  state.prefs.prepMode = mode;
  savePrefs();
  renderPrepSteps();
}

/**
 * Stage 5 — Per-meal, per-member portion breakdown from calendar.
 */
function renderPortionTable() {
  const container = document.getElementById('portion-table-body');
  if (!container) return;

  const plan = buildWeekPlan();
  const startDay = state.prefs.weekStartDay;
  const weekDayNames = Array.from({ length: 7 }, (_, i) => ALL_DAYS[(startDay + i) % 7]);

  if (!plan.hasMeals) {
    container.innerHTML = `<tr><td colspan="5" class="plan-empty-state">Portion breakdowns will appear here once meals are added to the calendar.</td></tr>`;
    return;
  }

  const rows = [];
  for (const { recipe, instances } of plan.recipes) {
    // Section header row for this recipe
    rows.push(`<tr class="portion-recipe-header"><td colspan="5">${recipe.name}</td></tr>`);

    // Collect all unique members across all instances of this recipe
    const memberIds = [...new Set(instances.flatMap(inst => inst.members))];

    for (const mid of memberIds) {
      const m = MEMBERS.find(x => x.id === mid);
      const scale = getMemberScaleFactor(mid);
      const protein  = Math.round((recipe.protein  || 0) * scale);
      const carbs    = Math.round((recipe.carbs    || 0) * scale);
      const fat      = Math.round((recipe.fat      || 0) * scale);
      const calories = Math.round((recipe.calories || 0) * scale);
      // Days this member eats this meal
      const days = instances
        .filter(inst => inst.members.includes(mid))
        .map(inst => weekDayNames[inst.dayIdx])
        .join(', ');

      rows.push(`
        <tr>
          <td>
            <div class="member-cell">
              <div class="avatar ${m.avatarClass}">${m.initials}</div>
              <span>${m.name}</span>
            </div>
          </td>
          <td class="portion-days">${days}</td>
          <td class="highlight-val">${protein}g</td>
          <td>${carbs}g / ${fat}g</td>
          <td class="highlight-val">${calories}</td>
        </tr>
      `);
    }
  }

  container.innerHTML = rows.join('');
}


/* ============================================================
   6. INTERACTION HANDLERS
   ============================================================ */

/**
 * Toggle a recipe card selected/deselected on Stage 1.
 * @param {number} index - index into the RECIPES array
 */
function armRecipe(recipeId) {
  state.armedRecipeId = state.armedRecipeId === recipeId ? null : recipeId;
  renderRecipes();
  renderMealCalendar();
}

function disarmRecipe() {
  state.armedRecipeId = null;
  renderRecipes();
  renderMealCalendar();
}

function stampMeal(weekOffset, dayIdx) {
  if (!state.armedRecipeId) return;
  if (!state.mealsByWeek[weekOffset]) {
    state.mealsByWeek[weekOffset] = Array(7).fill(null).map(() => []);
  }
  state.mealsByWeek[weekOffset][dayIdx].push({
    recipeId: state.armedRecipeId,
    members: MEMBERS.map(m => m.id),
  });
  saveMeals();
  renderMealCalendar();
  renderDownstream();
}

function toggleMealMember(event, weekOffset, dayIdx, mealIdx, memberId) {
  event.stopPropagation();
  const meal = state.mealsByWeek[weekOffset][dayIdx][mealIdx];
  const i = meal.members.indexOf(memberId);
  if (i === -1) {
    meal.members.push(memberId);
  } else if (meal.members.length > 1) {
    meal.members.splice(i, 1);
  }
  saveMeals();
  renderMealCalendar();
  renderDownstream();
}

// Drag & drop
let _drag = null;

function handleDragStart(event, weekOffset, fromDay, fromMeal) {
  _drag = { weekOffset, fromDay, fromMeal };
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.day-row.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(event) {
  if (!_drag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function handleDrop(event, weekOffset, toDay) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!_drag) return;
  const { fromDay, fromMeal } = _drag;
  _drag = null;
  if (fromDay === toDay) return;
  const mealEntry = state.mealsByWeek[weekOffset][fromDay].splice(fromMeal, 1)[0];
  if (!state.mealsByWeek[weekOffset][toDay]) state.mealsByWeek[weekOffset][toDay] = [];
  state.mealsByWeek[weekOffset][toDay].push(mealEntry);
  saveMeals();
  renderMealCalendar();
  renderDownstream();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (state.armedRecipeId) disarmRecipe();
    if (document.getElementById('store-selector-modal')?.classList.contains('open')) closeStoreSelector();
  }
});

function removeRecipe(index, event) {
  event.stopPropagation();
  const recipeId = RECIPES[index].id;
  if (state.armedRecipeId === recipeId) state.armedRecipeId = null;
  RECIPES.splice(index, 1);
  for (const week of Object.values(state.mealsByWeek)) {
    for (let d = 0; d < week.length; d++) {
      week[d] = week[d].filter(entry => entry.recipeId !== recipeId);
    }
  }
  saveMeals();
  renderAll();
  renderMealCalendar();
}

/**
 * Toggle a grocery item checked/unchecked on Stage 2.
 * Updates the data model, the checkbox UI, and the counter metrics.
 *
 * @param {number} sectionIndex - index into GROCERY_LIST
 * @param {number} itemIndex    - index into section.items
 * @param {HTMLElement} checkEl - the clicked .grocery-check element
 */
function toggleGroceryItem(key, checkEl) {
  if (_checkedIngredients.has(key)) {
    _checkedIngredients.delete(key);
  } else {
    _checkedIngredients.add(key);
  }
  const checked = _checkedIngredients.has(key);
  checkEl.classList.toggle('checked', checked);
  const nameEl = checkEl.closest('.grocery-item')?.querySelector('.grocery-name');
  if (nameEl) nameEl.classList.toggle('checked', checked);

  state.checkedItems = _checkedIngredients.size;
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


/* ============================================================
   8. EAT THE GAINS RECIPE BROWSER
   ============================================================ */

function openEtgBrowser() {
  const input = document.getElementById('etg-filter-input');
  if (input) input.value = '';
  renderEtgBrowser('');
  document.getElementById('etg-browser-modal').classList.add('open');
  if (input) setTimeout(() => input.focus(), 50);
}

function closeEtgBrowser() {
  document.getElementById('etg-browser-modal').classList.remove('open');
}

function handleEtgOverlayClick(e) {
  if (e.target === e.currentTarget) closeEtgBrowser();
}

function onEtgFilter(query) {
  renderEtgBrowser(query);
}

function renderEtgBrowser(query = '') {
  const grid = document.getElementById('etg-recipe-grid');
  if (!grid) return;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ETG_RECIPES.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.id.replace(/etg-/,'').replace(/-/g,' ').includes(q) ||
        (r.ingredients && r.ingredients.some(ing => ing.name.toLowerCase().includes(q)))
      )
    : ETG_RECIPES;

  const countEl = document.getElementById('etg-filter-count');
  if (countEl) {
    countEl.textContent = q ? `${filtered.length} of ${ETG_RECIPES.length}` : `${ETG_RECIPES.length} recipes`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="etg-no-results">No recipes match "' + query + '"</p>';
    return;
  }

  grid.innerHTML = filtered.map(recipe => {
    const alreadyAdded = RECIPES.some(r => r.id === recipe.id);
    const hasIngredients = recipe.ingredients && recipe.ingredients.length > 0;
    return `
      <div class="etg-recipe-card">
        <div class="etg-recipe-top">
          <div class="etg-recipe-name">${recipe.name}</div>
          <div class="etg-recipe-actions">
            ${hasIngredients ? `<button class="etg-ing-btn" onclick="toggleIngPopover(event,'${recipe.id}')" title="View ingredients" aria-label="View ingredients">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0" y="1" width="8" height="1.5" rx="0.75" fill="currentColor"/><rect x="0" y="5" width="11" height="1.5" rx="0.75" fill="currentColor"/><rect x="0" y="9" width="9" height="1.5" rx="0.75" fill="currentColor"/></svg>
            </button>` : ''}
            <a class="etg-recipe-link" href="${recipe.url}" target="_blank" rel="noopener">View ↗</a>
          </div>
        </div>
        <div class="macro-badges">
          <span class="badge badge-protein">${recipe.protein}g protein</span>
          <span class="badge badge-carbs">${recipe.carbs}g carbs</span>
          <span class="badge badge-fat">${recipe.fat}g fat</span>
          <span class="badge badge-calories">${recipe.calories} cal</span>
        </div>
        <button
          class="etg-add-btn${alreadyAdded ? ' added' : ''}"
          onclick="addEtgRecipe('${recipe.id}')"
          ${alreadyAdded ? 'disabled' : ''}
        >${alreadyAdded ? 'Added ✓' : '+ Add to week'}</button>
      </div>
    `;
  }).join('');
}

function toggleIngPopover(event, recipeId) {
  event.stopPropagation();
  const existing = document.getElementById('etg-ing-popover');
  if (existing && existing.dataset.recipeId === recipeId) {
    existing.remove();
    return;
  }
  if (existing) existing.remove();

  const recipe = ETG_RECIPES.find(r => r.id === recipeId);
  if (!recipe || !recipe.ingredients) return;

  const servingsLine = recipe.servings ? `<div class="eip-servings">Makes ${recipe.servings} servings</div>` : '';
  const rows = recipe.ingredients.map(ing => {
    const amt = ing.amount ? `${ing.amount}${ing.unit ? ' ' + ing.unit : ''}` : (ing.unit || '');
    return `<li class="eip-row"><span class="eip-amt">${amt}</span><span class="eip-name">${ing.name}</span></li>`;
  }).join('');

  const pop = document.createElement('div');
  pop.id = 'etg-ing-popover';
  pop.dataset.recipeId = recipeId;
  pop.innerHTML = `
    <div class="eip-header">
      <span class="eip-title">Ingredients</span>
      ${servingsLine}
      <button class="eip-close" onclick="document.getElementById('etg-ing-popover').remove()">✕</button>
    </div>
    <ul class="eip-list">${rows}</ul>
  `;
  document.body.appendChild(pop);

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const popW = 240;
  let left = rect.right + 8;
  if (left + popW > window.innerWidth - 16) left = rect.left - popW - 8;
  pop.style.left = `${left + window.scrollX}px`;
  pop.style.top = `${rect.top + window.scrollY}px`;

  const dismiss = e => {
    if (!pop.contains(e.target) && e.target !== btn) {
      pop.remove();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);

  const onKey = e => {
    if (e.key === 'Escape') { pop.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

function addEtgRecipe(recipeId) {
  const etgRecipe = ETG_RECIPES.find(r => r.id === recipeId);
  if (!etgRecipe || RECIPES.some(r => r.id === recipeId)) return;
  RECIPES.push({ ...etgRecipe, selected: true });
  renderAll();
  const currentQuery = document.getElementById('etg-filter-input')?.value || '';
  renderEtgBrowser(currentQuery);
}


/* ============================================================
   STORE SELECTOR
   ============================================================ */

function openStoreSelector() {
  renderStoreSelectorModal();
  document.getElementById('store-selector-modal').classList.add('open');
}

function closeStoreSelector() {
  document.getElementById('store-selector-modal').classList.remove('open');
}

function handleStoreSelectorOverlayClick(e) {
  if (e.target === e.currentTarget) closeStoreSelector();
}

function selectStore(storeId) {
  const chain = STORE_CHAINS.find(s => s.id === storeId);
  if (!chain) return;
  // Prefer auto-detected address; fall back to whatever the user typed
  const found     = state.nearbyStores?.[storeId];
  const addrInput = document.getElementById(`store-addr-${storeId}`);
  const address   = found?.address || addrInput?.value.trim() || null;
  const distanceMi = found?.distanceMi ?? null;
  state.selectedStore = { id: chain.id, name: chain.name, weeklyAd: chain.weeklyAd, address, distanceMi };
  saveSelectedStore(state.selectedStore);
  closeStoreSelector();
  renderStoreBanner();
}

function openWeeklyAd() {
  if (state.selectedStore?.weeklyAd) {
    window.open(state.selectedStore.weeklyAd, '_blank', 'noopener,noreferrer');
  }
}

// Haversine great-circle distance in miles
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Build a readable address from OSM addr:* tags
function fmtOsmAddress(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  const num    = tags['addr:housenumber'] || '';
  const street = tags['addr:street']     || '';
  const city   = tags['addr:city']       || '';
  const line1  = [num, street].filter(Boolean).join(' ');
  return [line1, city].filter(Boolean).join(', ') || null;
}

async function fetchNearbyStores(lat, lng) {
  state.nearbyStoresLoading = true;
  state.nearbyStores        = null;
  renderStoreSelectorModal();

  const radius = 16000;
  const query  = `[out:json][timeout:10];node["shop"="supermarket"](around:${radius},${lat},${lng});out 80;`;
  const url    = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const nearby = {};
    for (const elem of data.elements || []) {
      const name = (elem.tags?.name || '').trim();
      if (!name) continue;
      const chain = STORE_CHAINS.find(c => c.nameMatch.test(name));
      if (!chain) continue;
      const distanceMi = haversineDistance(lat, lng, elem.lat, elem.lon);
      const address    = fmtOsmAddress(elem.tags || {});
      if (!nearby[chain.id] || distanceMi < nearby[chain.id].distanceMi) {
        nearby[chain.id] = { address, distanceMi };
      }
    }

    state.nearbyStores = nearby;
  } catch (err) {
    console.warn('[PrepFlow] Overpass fetch failed:', err.message);
    state.nearbyStores = {};
  }

  state.nearbyStoresLoading = false;
  renderStoreSelectorModal();
}

function requestStoreLocation() {
  const btn = document.getElementById('store-location-btn');
  if (btn) { btn.textContent = 'Finding stores near you…'; btn.disabled = true; }

  if (!('geolocation' in navigator)) {
    if (btn) { btn.textContent = 'Location unavailable'; btn.disabled = false; }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (btn) { btn.textContent = '📍 Location found'; btn.disabled = false; }
      fetchNearbyStores(state.userLocation.lat, state.userLocation.lng);
    },
    () => {
      if (btn) { btn.textContent = 'Location denied — search manually below'; btn.disabled = false; }
    },
    { timeout: 8000 }
  );
}

function renderStoreSelectorModal() {
  const grid = document.getElementById('store-chain-grid');
  if (!grid) return;

  const loc      = state.userLocation;
  const selected = state.selectedStore;
  const loading  = state.nearbyStoresLoading;
  const nearby   = state.nearbyStores;

  // While loading, show a single skeleton list (not a grid)
  if (loading) {
    grid.innerHTML = `
      <div class="store-search-loading">
        <div class="store-search-spinner"></div>
        Searching for stores near you…
      </div>
    `;
    return;
  }

  // Split into found nearby vs not found
  const foundChains    = STORE_CHAINS.filter(c => nearby?.[c.id]);
  const notFoundChains = STORE_CHAINS.filter(c => nearby && !nearby[c.id]);
  const allChains      = nearby ? [...foundChains, ...notFoundChains] : STORE_CHAINS;

  const renderFound = (chain) => {
    const isSelected = selected?.id === chain.id;
    const found      = nearby[chain.id];
    return `
      <div class="store-chain-card${isSelected ? ' store-chain-card--selected' : ''}"
           onclick="selectStore('${chain.id}')">
        ${isSelected ? '<div class="store-chain-check">✓</div>' : ''}
        <div class="store-chain-name">${chain.name}</div>
        <div class="store-chain-distance">${found.distanceMi.toFixed(1)} mi away</div>
        ${found.address ? `<div class="store-chain-address">${found.address}</div>` : ''}
      </div>
    `;
  };

  const renderFallback = (chain) => {
    const isSelected   = selected?.id === chain.id;
    const savedAddress = isSelected ? (selected.address || '') : '';
    const mapsUrl      = loc
      ? `https://www.google.com/maps/search/${chain.mapQ}/@${loc.lat},${loc.lng},13z`
      : `https://www.google.com/maps/search/${chain.mapQ}`;
    return `
      <div class="store-chain-card store-chain-card--dim${isSelected ? ' store-chain-card--selected' : ''}"
           onclick="selectStore('${chain.id}')">
        ${isSelected ? '<div class="store-chain-check">✓</div>' : ''}
        <div class="store-chain-name">${chain.name}</div>
        <input
          class="store-chain-addr-input"
          id="store-addr-${chain.id}"
          type="text"
          placeholder="Enter address (optional)"
          value="${savedAddress.replace(/"/g, '&quot;')}"
          onclick="event.stopPropagation()"
          onfocus="event.stopPropagation()"
        />
        <a class="store-chain-map-link"
           href="${mapsUrl}"
           target="_blank"
           rel="noopener noreferrer"
           onclick="event.stopPropagation()">📍 ${loc ? 'Find near me' : 'Search on Maps'}</a>
      </div>
    `;
  };

  // Build sections
  let html = '';

  if (foundChains.length) {
    html += foundChains.map(renderFound).join('');
  }

  if (notFoundChains.length && foundChains.length) {
    html += `<div class="store-section-divider">Not found within 10 mi</div>`;
    html += notFoundChains.map(renderFallback).join('');
  } else if (!nearby) {
    // No location yet — show all chains with fallback cards
    html += allChains.map(renderFallback).join('');
  }

  grid.innerHTML = html;
}

function renderStoreBanner() {
  const banner = document.getElementById('store-banner');
  if (!banner) return;

  const store = state.selectedStore;
  if (!store) {
    banner.innerHTML = `
      <div class="store-banner-empty">
        <span>No store selected</span>
        <button class="store-select-btn" onclick="openStoreSelector()">Select store</button>
      </div>
    `;
    return;
  }

  const sub = [store.address, store.distanceMi != null ? `${store.distanceMi.toFixed(1)} mi` : null]
    .filter(Boolean).join(' · ') || null;

  banner.innerHTML = `
    <div class="store-banner-selected">
      <div class="store-banner-info">
        <span class="store-banner-label">Shopping at</span>
        <span class="store-banner-name">${store.name}</span>
        ${sub ? `<span class="store-banner-address">${sub}</span>` : ''}
      </div>
      <div class="store-banner-btns">
        <button class="weekly-ad-btn" onclick="openWeeklyAd()">Weekly ad ↗</button>
        <button class="store-change-btn" onclick="openStoreSelector()">Change</button>
      </div>
    </div>
  `;
}
