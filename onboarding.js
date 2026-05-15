/* ============================================================
   ONBOARDING.JS — New-user setup flow for PrepTare
   ============================================================
   5-step wizard shown to every new account before the main app.
   On completion it writes the user's profile to Firestore and
   calls initMainApp() to hand off to the main application.

   Steps:
     1. Welcome      — confirm display name
     2. Family       — add household members + avatar colors
     3. Mode         — Basic (calories) vs Advanced (full macros)
     4. Macros       — targets per member (calculator or manual)
     5. Preferences  — prep period, units
   ============================================================ */

const ONB_TOTAL_STEPS = 5;

const _onb = {
  step:        1,
  user:        null,
  displayName: '',
  firstName:   '',      // first word of displayName — used for greetings & member pre-fill
  members:     [],      // [{ id, name, initials, avatarClass, maintenance }]
  mode:        'advanced',
  prefs: {
    prepPeriod: 7,
    prepDay:    'sunday',
    units:      'imperial',
  },
};

let _onbCalcActivity   = 1.55;  // tracks selected activity level in calculator
let _onbCalcHeightUnit = 'imperial'; // ft/in or metric — independent of prefs.units

// ── Entry point called by auth.js ─────────────────────────

function showOnboardingScreen(user, existingProfile) {
  hideAuthScreen();
  _onb.user        = user;
  _onb.displayName = user.displayName || '';

  // If partially completed, restore what we have
  if (existingProfile?.members?.length) {
    _onb.members = existingProfile.members;
    _onb.mode    = existingProfile.mode || 'advanced';
    Object.assign(_onb.prefs, existingProfile.prefs || {});
    _onb.step = existingProfile.onboardingStep || 1;
  }

  document.getElementById('onboarding-screen').classList.remove('hidden');
  _renderOnbStep();
}

// ── Step renderer ─────────────────────────────────────────

function _renderOnbStep() {
  _updateOnbProgress();
  const content = document.getElementById('onb-content');
  const backBtn  = document.getElementById('onb-back');
  const nextBtn  = document.getElementById('onb-next');

  backBtn.classList.toggle('hidden', _onb.step === 1);
  nextBtn.textContent = _onb.step === ONB_TOTAL_STEPS ? 'Start PrepTare!' : 'Continue';

  const renders = [null, _renderStep1, _renderStep2, _renderStep3, _renderStep4, _renderStep5];
  content.innerHTML = '';
  renders[_onb.step](content);
}

function _updateOnbProgress() {
  document.getElementById('onb-step-label').textContent = `Step ${_onb.step} of ${ONB_TOTAL_STEPS}`;
  const pct = (_onb.step / ONB_TOTAL_STEPS) * 100;
  document.getElementById('onb-progress-fill').style.width = `${pct}%`;
}

// ── Step 1: Welcome ───────────────────────────────────────

function _renderStep1(container) {
  container.innerHTML = `
    <div class="onb-step onb-step--welcome">
      <div class="onb-emoji">👋</div>
      <h2 class="onb-title">Welcome to PrepTare!</h2>
      <p class="onb-subtitle">
        Let's set up your household in about 2 minutes so PrepTare
        can generate accurate grocery lists and macro targets.
      </p>
      <div class="onb-field">
        <label class="onb-label" for="onb-name">What should we call you?</label>
        <input
          type="text"
          id="onb-name"
          class="onb-input"
          placeholder="Your first name"
          value="${escHtml(_onb.displayName)}"
          autocomplete="given-name"
        />
      </div>
    </div>`;
}

function _collectStep1() {
  const name = document.getElementById('onb-name')?.value.trim();
  if (!name) { _onbError('Please enter your name.'); return false; }
  _onb.displayName = name;
  _onb.firstName   = name.split(/\s+/)[0]; // "Will Ditton" → "Will"
  return true;
}

// ── Step 2: Family members ────────────────────────────────

const ONB_AVATAR_COLORS = [
  'avatar-green','avatar-blue','avatar-amber','avatar-pink',
  'avatar-purple','avatar-teal','avatar-coral','avatar-slate',
];

function _renderStep2(container) {
  if (!_onb.members.length) {
    const seedName = _onb.firstName || _onb.displayName.split(/\s+/)[0];
    _onb.members = [{
      id:          'member-1',
      name:        seedName,
      initials:    generateInitials(seedName),
      avatarClass: 'avatar-green',
      maintenance: { cal: 2000, protein: 150, carbs: 200, fat: 65 },
    }];
  }

  container.innerHTML = `
    <div class="onb-step">
      <h2 class="onb-title">Who's in your household?</h2>
      <p class="onb-subtitle">Add everyone who eats from the weekly prep.</p>
      <div class="onb-member-list" id="onb-member-list"></div>
      <button class="onb-add-member-btn" onclick="onbAddMember()">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Add another member
      </button>
      <p class="onb-error hidden" id="onb-step-error"></p>
    </div>`;
  _renderOnbMemberList();
}

function _renderOnbMemberList() {
  const list = document.getElementById('onb-member-list');
  if (!list) return;
  list.innerHTML = _onb.members.map((m, i) => `
    <div class="onb-member-row" data-idx="${i}">
      <div class="onb-member-avatar ${escHtml(m.avatarClass)}" onclick="onbCycleAvatar(${i})">
        ${escHtml(m.initials)}
      </div>
      <input
        type="text"
        class="onb-input onb-member-name"
        placeholder="Name"
        value="${escHtml(m.name)}"
        onchange="onbUpdateMemberName(${i}, this.value)"
        oninput="onbUpdateMemberName(${i}, this.value)"
      />
      ${_onb.members.length > 1 ? `
        <button class="onb-remove-member" onclick="onbRemoveMember(${i})" aria-label="Remove ${escHtml(m.name)}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>` : ''}
    </div>`).join('');
}

function onbAddMember() {
  const colorIdx = _onb.members.length % ONB_AVATAR_COLORS.length;
  _onb.members.push({
    id:          `member-${Date.now()}`,
    name:        '',
    initials:    '?',
    avatarClass: ONB_AVATAR_COLORS[colorIdx],
    maintenance: { cal: 2000, protein: 150, carbs: 200, fat: 65 },
  });
  _renderOnbMemberList();
  // Focus the new input
  const inputs = document.querySelectorAll('.onb-member-name');
  inputs[inputs.length - 1]?.focus();
}

function onbRemoveMember(idx) {
  _onb.members.splice(idx, 1);
  _renderOnbMemberList();
}

function onbUpdateMemberName(idx, value) {
  _onb.members[idx].name     = value.trim();
  _onb.members[idx].initials = generateInitials(value);
  // Update avatar without full re-render
  const avatarEls = document.querySelectorAll('.onb-member-avatar');
  if (avatarEls[idx]) avatarEls[idx].textContent = generateInitials(value);
}

function onbCycleAvatar(idx) {
  const curr  = ONB_AVATAR_COLORS.indexOf(_onb.members[idx].avatarClass);
  const next  = (curr + 1) % ONB_AVATAR_COLORS.length;
  _onb.members[idx].avatarClass = ONB_AVATAR_COLORS[next];
  _renderOnbMemberList();
}

function _collectStep2() {
  // Sync any in-flight name edits from inputs
  document.querySelectorAll('.onb-member-name').forEach((input, i) => {
    if (_onb.members[i]) {
      _onb.members[i].name     = input.value.trim();
      _onb.members[i].initials = generateInitials(input.value);
    }
  });
  const empty = _onb.members.some(m => !m.name);
  if (empty) { _onbError('Please enter a name for every member.'); return false; }
  return true;
}

// ── Step 3: Mode selection ────────────────────────────────

function _renderStep3(container) {
  container.innerHTML = `
    <div class="onb-step">
      <h2 class="onb-title">How detailed do you want your nutrition tracking?</h2>
      <p class="onb-subtitle">You can change this any time in Settings.</p>
      <div class="onb-mode-cards">
        <button class="onb-mode-card ${_onb.mode === 'basic' ? 'selected' : ''}"
                onclick="onbSelectMode('basic')">
          <div class="onb-mode-icon">📊</div>
          <div class="onb-mode-title">Basic</div>
          <div class="onb-mode-desc">
            Calories only.<br>Simple weekly goals.
            Perfect for families who just want
            portion guidance without the math.
          </div>
        </button>
        <button class="onb-mode-card ${_onb.mode === 'advanced' ? 'selected' : ''}"
                onclick="onbSelectMode('advanced')">
          <div class="onb-mode-icon">🎯</div>
          <div class="onb-mode-title">Advanced</div>
          <div class="onb-mode-desc">
            Full macros — protein, carbs &amp; fat.
            Precise targets for fitness goals
            like cutting, bulking, or maintenance.
          </div>
        </button>
      </div>
    </div>`;
}

function onbSelectMode(mode) {
  _onb.mode = mode;
  document.querySelectorAll('.onb-mode-card').forEach(c => {
    c.classList.toggle('selected', c.textContent.toLowerCase().includes(mode));
  });
}

// ── Step 4: Macro targets per member ─────────────────────

let _onbMacroActiveMember = 0;
let _onbInputMode = 'calculator'; // 'calculator' | 'manual'
let _onbCalcStates = {};          // per-member calculator field snapshots
let _onbConfiguredMembers = new Set(); // indices whose macros have been set

function _renderStep4(container) {
  _onbMacroActiveMember = Math.min(_onbMacroActiveMember, _onb.members.length - 1);

  container.innerHTML = `
    <div class="onb-step">
      <h2 class="onb-title">Set daily targets for each member</h2>
      <p class="onb-subtitle">
        ${_onb.mode === 'basic'
          ? 'Enter each person\'s daily calorie target.'
          : 'Enter maintenance calories and macros. Deficit/bulk phases are calculated automatically.'}
      </p>
      <div class="onb-adjust-note">
        💡 These can be updated any time from the app — especially your
        <strong>Cut / Maintain / Bulk</strong> goal, which most people change regularly.
      </div>
      <div class="onb-member-tabs-section">
        <p class="onb-member-tabs-label">Who are you setting targets for?</p>
        <div class="onb-member-tabs" id="onb-macro-tabs"></div>
      </div>
      <div class="onb-macro-panel" id="onb-macro-panel"></div>
      <div class="onb-skip-prompt hidden" id="onb-skip-prompt"></div>
    </div>`;

  _renderOnbMacroTabs();
  _renderOnbMacroPanel();
}

function _renderOnbMacroTabs() {
  const tabs = document.getElementById('onb-macro-tabs');
  if (!tabs) return;
  tabs.innerHTML = _onb.members.map((m, i) => `
    <button
      class="onb-macro-tab ${i === _onbMacroActiveMember ? 'active' : ''}"
      onclick="onbSelectMacroMember(${i})"
    >
      <span class="onb-macro-tab-avatar ${escHtml(m.avatarClass)}">${escHtml(m.initials)}</span>
      ${escHtml(m.name)}
    </button>`).join('');
}

function _saveCalcState(idx) {
  if (_onbInputMode !== 'calculator') return;
  const s = {
    sex:        document.getElementById('onb-calc-sex')?.value || 'male',
    age:        document.getElementById('onb-calc-age')?.value || '',
    weight:     document.getElementById('onb-calc-weight')?.value || '',
    heightUnit: _onbCalcHeightUnit,
    activity:   _onbCalcActivity,
    goal:       _onbCalcGoal,
  };
  if (_onbCalcHeightUnit === 'metric') {
    s.heightCm = document.getElementById('onb-calc-height-cm')?.value || '';
  } else {
    s.heightFt = document.getElementById('onb-calc-height-ft')?.value || '';
    s.heightIn = document.getElementById('onb-calc-height-in')?.value || '';
  }
  _onbCalcStates[idx] = s;
}

function _restoreCalcState(idx) {
  const s = _onbCalcStates[idx];
  if (s) {
    _onbCalcHeightUnit = s.heightUnit;
    _onbCalcActivity   = s.activity;
    _onbCalcGoal       = s.goal;
  }
  _renderOnbMacroPanel();
  if (_onbInputMode !== 'calculator' || !s) return;
  requestAnimationFrame(() => {
    const sex = document.getElementById('onb-calc-sex');
    const age = document.getElementById('onb-calc-age');
    const wt  = document.getElementById('onb-calc-weight');
    if (sex && s.sex)    sex.value = s.sex;
    if (age && s.age)    age.value = s.age;
    if (wt  && s.weight) wt.value  = s.weight;
    if (s.heightUnit === 'metric') {
      const hcm = document.getElementById('onb-calc-height-cm');
      if (hcm && s.heightCm) hcm.value = s.heightCm;
    } else {
      const hft = document.getElementById('onb-calc-height-ft');
      const hin = document.getElementById('onb-calc-height-in');
      if (hft && s.heightFt) hft.value = s.heightFt;
      if (hin && s.heightIn) hin.value = s.heightIn;
    }
    onbRunCalc();
  });
}

function onbSelectMacroMember(idx) {
  _saveCalcState(_onbMacroActiveMember);
  _onbMacroActiveMember = idx;
  _renderOnbMacroTabs();
  _restoreCalcState(idx);
}

function _renderOnbMacroPanel() {
  const panel = document.getElementById('onb-macro-panel');
  if (!panel) return;
  const m   = _onb.members[_onbMacroActiveMember];
  const mac = m.maintenance;

  // Basic mode: just a calorie field, no mode chooser
  if (_onb.mode === 'basic') {
    panel.innerHTML = `
      <div class="onb-macro-fields">
        <div class="onb-field">
          <label class="onb-label">Daily Calories</label>
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-mac-cal"
              value="${mac.cal}" min="800" max="6000"
              oninput="onbUpdateMacro('cal', this.value)" />
            <span class="onb-unit">kcal</span>
          </div>
        </div>
      </div>`;
    return;
  }

  // Advanced mode: prominent mode-choice cards + content below
  panel.innerHTML = `
    <div class="onb-macro-fields">
      <div class="onb-input-mode-cards">
        <button class="onb-input-mode-card ${_onbInputMode === 'calculator' ? 'selected' : ''}"
                onclick="onbSetInputMode('calculator')">
          <div class="onb-input-mode-icon">🧮</div>
          <div class="onb-input-mode-title">Calculate for me</div>
          <div class="onb-input-mode-desc">Enter your stats — we handle the math</div>
          ${_onbInputMode === 'calculator' ? '<div class="onb-input-mode-badge">Recommended</div>' : ''}
        </button>
        <button class="onb-input-mode-card ${_onbInputMode === 'manual' ? 'selected' : ''}"
                onclick="onbSetInputMode('manual')">
          <div class="onb-input-mode-icon">✏️</div>
          <div class="onb-input-mode-title">I know my macros</div>
          <div class="onb-input-mode-desc">Enter your targets directly</div>
        </button>
      </div>
      ${_onbInputMode === 'calculator' ? _onbCalcHTML(m) : _onbManualHTML(mac)}
    </div>`;
}

function onbSetInputMode(mode) {
  // Preserve any calc values before switching to manual
  if (mode === 'manual') {
    const m = _onb.members[_onbMacroActiveMember];
    // members[].maintenance is already live-updated by onbRunCalc — nothing to save
    _onbInputMode = mode;
    _renderOnbMacroPanel();
  } else {
    _onbInputMode = mode;
    _renderOnbMacroPanel();
  }
}

function _onbManualHTML(mac) {
  return `
    <div class="onb-manual-fields">
      <div class="onb-field-row">
        <div class="onb-field">
          <label class="onb-label">Daily Calories</label>
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-mac-cal"
              value="${mac.cal}" min="800" max="6000"
              oninput="onbUpdateMacro('cal', this.value)" />
            <span class="onb-unit">kcal</span>
          </div>
        </div>
        <div class="onb-field">
          <label class="onb-label">Protein</label>
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-mac-protein"
              value="${mac.protein}" min="0" max="500"
              oninput="onbUpdateMacro('protein', this.value)" />
            <span class="onb-unit">g</span>
          </div>
        </div>
      </div>
      <div class="onb-field-row">
        <div class="onb-field">
          <label class="onb-label">Carbs</label>
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-mac-carbs"
              value="${mac.carbs}" min="0" max="800"
              oninput="onbUpdateMacro('carbs', this.value)" />
            <span class="onb-unit">g</span>
          </div>
        </div>
        <div class="onb-field">
          <label class="onb-label">Fat</label>
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-mac-fat"
              value="${mac.fat}" min="0" max="300"
              oninput="onbUpdateMacro('fat', this.value)" />
            <span class="onb-unit">g</span>
          </div>
        </div>
      </div>
    </div>`;
}

function onbUpdateMacro(field, value) {
  const m = _onb.members[_onbMacroActiveMember];
  m.maintenance[field] = parseInt(value, 10) || 0;
  _onbConfiguredMembers.add(_onbMacroActiveMember);
  document.getElementById('onb-skip-prompt')?.classList.add('hidden');
}

function _onbCalcHTML(member) {
  const metric = _onbCalcHeightUnit === 'metric';
  return `
    <div class="onb-calc">

      <div class="onb-field-row">
        <div class="onb-field">
          <label class="onb-label">Sex</label>
          <select class="onb-input" id="onb-calc-sex" onchange="onbRunCalc()">
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
        <div class="onb-field">
          <label class="onb-label">Age</label>
          <input type="number" class="onb-input" id="onb-calc-age"
            placeholder="e.g. 35" min="10" max="100" oninput="onbRunCalc()" />
        </div>
      </div>

      <div class="onb-field">
        <div class="onb-label-row">
          <label class="onb-label">Height</label>
          <div class="onb-unit-toggle">
            <button class="onb-unit-btn ${!metric ? 'active' : ''}" onclick="onbSetHeightUnit('imperial')">ft / in</button>
            <button class="onb-unit-btn ${metric ? 'active' : ''}" onclick="onbSetHeightUnit('metric')">cm</button>
          </div>
        </div>
        ${metric ? `
          <div class="onb-input-unit">
            <input type="number" class="onb-input" id="onb-calc-height-cm"
              placeholder="e.g. 178" min="120" max="250" oninput="onbRunCalc()" />
            <span class="onb-unit">cm</span>
          </div>
        ` : `
          <div class="onb-height-ftIn">
            <div class="onb-input-unit">
              <input type="number" class="onb-input" id="onb-calc-height-ft"
                placeholder="5" min="3" max="8" oninput="onbRunCalc()" />
              <span class="onb-unit">ft</span>
            </div>
            <div class="onb-input-unit">
              <input type="number" class="onb-input" id="onb-calc-height-in"
                placeholder="10" min="0" max="11" oninput="onbRunCalc()" />
              <span class="onb-unit">in</span>
            </div>
          </div>
        `}
      </div>

      <div class="onb-field">
        <label class="onb-label">Weight (${metric ? 'kg' : 'lbs'})</label>
        <div class="onb-input-unit">
          <input type="number" class="onb-input" id="onb-calc-weight"
            placeholder="${metric ? 'e.g. 80' : 'e.g. 185'}"
            min="${metric ? '30' : '66'}" max="${metric ? '300' : '660'}"
            oninput="onbRunCalc()" />
          <span class="onb-unit">${metric ? 'kg' : 'lbs'}</span>
        </div>
      </div>

      <div class="onb-field">
        <label class="onb-label">Activity level</label>
        <div class="activity-grid">
          ${[
            { factor: 1.2,   emoji: '🪑', name: 'Sedentary',       desc: 'Little or no exercise' },
            { factor: 1.375, emoji: '🚶', name: 'Lightly Active',   desc: '1–3 days/wk exercise' },
            { factor: 1.55,  emoji: '🏃', name: 'Moderate',         desc: '3–5 days/wk' },
            { factor: 1.725, emoji: '🏋️', name: 'Very Active',      desc: '6–7 days/wk' },
            { factor: 1.9,   emoji: '🔥', name: 'Extra Active',     desc: 'Intense training' },
          ].map(c => `
            <div class="activity-card ${_onbCalcActivity === c.factor ? 'active' : ''}"
                 data-factor="${c.factor}"
                 onclick="onbSetActivity(${c.factor})">
              <span class="activity-emoji">${c.emoji}</span>
              <span class="activity-name">${c.name}</span>
              <span class="activity-desc">${c.desc}</span>
              <span class="activity-factor">×${c.factor}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="onb-field">
        <label class="onb-label">Goal</label>
        <div class="onb-goal-btns">
          <button class="onb-goal-btn ${_onbCalcGoal === 'deficit' ? 'selected' : ''}"
                  data-goal="deficit" onclick="onbSetGoal('deficit')">Cut (−20%)</button>
          <button class="onb-goal-btn ${_onbCalcGoal === 'maintenance' ? 'selected' : ''}"
                  data-goal="maintenance" onclick="onbSetGoal('maintenance')">Maintain</button>
          <button class="onb-goal-btn ${_onbCalcGoal === 'bulk' ? 'selected' : ''}"
                  data-goal="bulk" onclick="onbSetGoal('bulk')">Bulk (+20%)</button>
        </div>
      </div>

      <div class="onb-calc-result hidden" id="onb-calc-result"></div>
      <button class="onb-calc-apply-btn hidden" id="onb-calc-apply-btn"
              onclick="onbApplyCalcResult()">
        Apply these targets
      </button>
    </div>`;
}

function onbSetHeightUnit(unit) {
  // Save typed values before the re-render wipes the inputs
  const saved = {
    sex:    document.getElementById('onb-calc-sex')?.value,
    age:    document.getElementById('onb-calc-age')?.value,
    weight: document.getElementById('onb-calc-weight')?.value,
  };
  _onbCalcHeightUnit = unit;
  _renderOnbMacroPanel();
  // Restore after render (height inputs swap structure so we can't preserve those)
  requestAnimationFrame(() => {
    const sex = document.getElementById('onb-calc-sex');
    const age = document.getElementById('onb-calc-age');
    const wt  = document.getElementById('onb-calc-weight');
    if (sex && saved.sex)    sex.value    = saved.sex;
    if (age && saved.age)    age.value    = saved.age;
    if (wt  && saved.weight) wt.value     = saved.weight;
    onbRunCalc();
  });
}

function onbSetActivity(factor) {
  _onbCalcActivity = factor;
  // Update card highlights in-place — no re-render so typed field values are preserved
  document.querySelectorAll('.onb-calc .activity-card').forEach(card => {
    card.classList.toggle('active', parseFloat(card.dataset.factor) === factor);
  });
  onbRunCalc();
}

let _onbCalcGoal = 'maintenance';
let _onbCalcResult = null;

function onbSetGoal(goal) {
  _onbCalcGoal = goal;
  document.querySelectorAll('.onb-goal-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.goal === goal);
  });
  onbRunCalc();
}

function onbRunCalc() {
  const sex    = document.getElementById('onb-calc-sex')?.value;
  const age    = parseFloat(document.getElementById('onb-calc-age')?.value);
  const result = document.getElementById('onb-calc-result');
  const applyBtn = document.getElementById('onb-calc-apply-btn');

  // Height — ft/in or cm
  let heightCm;
  if (_onbCalcHeightUnit === 'metric') {
    heightCm = parseFloat(document.getElementById('onb-calc-height-cm')?.value);
  } else {
    const ft  = parseFloat(document.getElementById('onb-calc-height-ft')?.value) || 0;
    const ins = parseFloat(document.getElementById('onb-calc-height-in')?.value) || 0;
    const totalIn = ft * 12 + ins;
    heightCm = totalIn > 0 ? totalIn * 2.54 : NaN;
  }

  // Weight — kg or lbs
  const weightRaw = parseFloat(document.getElementById('onb-calc-weight')?.value);
  const weightKg  = _onbCalcHeightUnit === 'metric' ? weightRaw : weightRaw * 0.4536;
  const weightLb  = _onbCalcHeightUnit === 'metric' ? weightRaw * 2.205 : weightRaw;
  const activity  = _onbCalcActivity;

  if (!age || !heightCm || isNaN(heightCm) || !weightRaw || isNaN(weightKg)) {
    if (result) result.classList.add('hidden');
    if (applyBtn) applyBtn.classList.add('hidden');
    return;
  }

  // Mifflin-St Jeor BMR
  const bmr = sex === 'male'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
    : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;

  const goalFactor = _onbCalcGoal === 'deficit' ? 0.8 : _onbCalcGoal === 'bulk' ? 1.2 : 1.0;
  const tdee       = Math.round(bmr * activity * goalFactor);
  const protein    = Math.round(weightLb * 0.85); // ~0.85g per lb bodyweight
  const fat        = Math.round((tdee * 0.28) / 9);
  const carbs      = Math.round((tdee - protein * 4 - fat * 9) / 4);

  const finalCarbs = Math.max(0, carbs);

  // Update the member's stored maintenance values live
  const m = _onb.members[_onbMacroActiveMember];
  if (m) m.maintenance = { cal: tdee, protein, fat, carbs: finalCarbs };
  _onbConfiguredMembers.add(_onbMacroActiveMember);
  document.getElementById('onb-skip-prompt')?.classList.add('hidden');

  // Show live result summary inside the calculator
  if (result) {
    result.classList.remove('hidden');
    result.innerHTML = `
      <div class="onb-calc-result-label">Your daily targets</div>
      <div class="onb-calc-result-grid">
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${tdee}</span>
          <span class="onb-calc-result-unit">kcal</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${protein}g</span>
          <span class="onb-calc-result-unit">protein</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${finalCarbs}g</span>
          <span class="onb-calc-result-unit">carbs</span>
        </div>
        <div class="onb-calc-result-item">
          <span class="onb-calc-result-value">${fat}g</span>
          <span class="onb-calc-result-unit">fat</span>
        </div>
      </div>`;
  }
  if (applyBtn) applyBtn.classList.add('hidden'); // no longer needed — values update live
}

function _collectStep4() {
  // In manual mode, sync any in-flight field edits
  if (_onbInputMode === 'manual') {
    const m = _onb.members[_onbMacroActiveMember];
    ['cal','protein','carbs','fat'].forEach(f => {
      const el = document.getElementById(`onb-mac-${f}`);
      if (el) m.maintenance[f] = parseInt(el.value, 10) || 0;
    });
    _onbConfiguredMembers.add(_onbMacroActiveMember);
  }

  // Find members whose macros haven't been touched yet
  const unconfigured = _onb.members
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => !_onbConfiguredMembers.has(i));

  if (unconfigured.length > 0) {
    _showSkipPrompt(unconfigured);
    return false;
  }

  // Validate cal targets are sensible
  const invalid = _onb.members.find(mem => !mem.maintenance.cal || mem.maintenance.cal < 800);
  if (invalid) {
    _onbError(`Please set a calorie target for ${invalid.name} (minimum 800 kcal).`);
    return false;
  }
  return true;
}

function _showSkipPrompt(unconfigured) {
  const first = unconfigured[0];
  const names = unconfigured.map(({ m }) => m.name).join(' and ');
  const prompt = document.getElementById('onb-skip-prompt');
  if (!prompt) return;

  prompt.innerHTML = `
    <div class="onb-skip-prompt-inner">
      <div class="onb-skip-prompt-title">Hold on!</div>
      <div class="onb-skip-prompt-body">
        <strong>${names}</strong> ${unconfigured.length > 1 ? "haven't" : "hasn't"} had
        their macros set yet — no worries, these can be updated any time in the app.
      </div>
      <div class="onb-skip-prompt-actions">
        <button class="onb-skip-set-btn" onclick="onbGoToUnconfigured(${first.i})">
          Set for ${escHtml(first.m.name)}
        </button>
        <button class="onb-skip-continue-btn" onclick="onbForceNext()">
          Skip &amp; Continue
        </button>
      </div>
    </div>`;
  prompt.classList.remove('hidden');
}

function onbGoToUnconfigured(idx) {
  document.getElementById('onb-skip-prompt')?.classList.add('hidden');
  onbSelectMacroMember(idx);
}

function onbForceNext() {
  // Mark all remaining as done so validation passes, then advance
  _onb.members.forEach((_, i) => _onbConfiguredMembers.add(i));
  document.getElementById('onb-skip-prompt')?.classList.add('hidden');
  onbNext();
}

// ── Step 5: Preferences ───────────────────────────────────

const PREP_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function _renderStep5(container) {
  container.innerHTML = `
    <div class="onb-step">
      <h2 class="onb-title">Almost done!</h2>
      <p class="onb-subtitle">A couple of quick preferences to get PrepTare dialed in.</p>

      <div class="onb-pref-section">
        <label class="onb-pref-label">How often do you meal prep?</label>
        <div class="onb-pref-cards onb-pref-cards--3">
          <button class="onb-pref-card ${_onb.prefs.prepPeriod === 5 ? 'selected' : ''}"
                  onclick="onbSetPref('prepPeriod', 5)">
            <div class="onb-pref-title">Every 5 days</div>
            <div class="onb-pref-desc">Twice a week — max freshness</div>
          </button>
          <button class="onb-pref-card ${_onb.prefs.prepPeriod === 7 ? 'selected' : ''}"
                  onclick="onbSetPref('prepPeriod', 7)">
            <div class="onb-pref-title">Every 7 days</div>
            <div class="onb-pref-desc">Weekly — fresh variety each week</div>
          </button>
          <button class="onb-pref-card ${_onb.prefs.prepPeriod === 14 ? 'selected' : ''}"
                  onclick="onbSetPref('prepPeriod', 14)">
            <div class="onb-pref-title">Every 14 days</div>
            <div class="onb-pref-desc">Bi-weekly — bigger batches</div>
          </button>
        </div>
      </div>

      <div class="onb-pref-section">
        <label class="onb-pref-label">What day do you prefer to prep?</label>
        <div class="onb-day-grid">
          ${PREP_DAYS.map(d => `
            <button class="onb-day-btn ${_onb.prefs.prepDay === d.toLowerCase() ? 'selected' : ''}"
                    onclick="onbSetPref('prepDay', '${d.toLowerCase()}')">
              ${d.substring(0, 3)}
            </button>`).join('')}
        </div>
      </div>

      <div class="onb-pref-section">
        <label class="onb-pref-label">Unit preference</label>
        <div class="onb-pref-cards">
          <button class="onb-pref-card ${_onb.prefs.units === 'imperial' ? 'selected' : ''}"
                  onclick="onbSetPref('units', 'imperial')">
            <div class="onb-pref-title">Imperial</div>
            <div class="onb-pref-desc">lbs, oz, cups</div>
          </button>
          <button class="onb-pref-card ${_onb.prefs.units === 'metric' ? 'selected' : ''}"
                  onclick="onbSetPref('units', 'metric')">
            <div class="onb-pref-title">Metric</div>
            <div class="onb-pref-desc">kg, g, ml</div>
          </button>
        </div>
      </div>
    </div>`;
}

function onbSetPref(key, value) {
  _onb.prefs[key] = value;
  // Update card selection visually
  _renderOnbStep();
}

// ── Navigation ────────────────────────────────────────────

function onbNext() {
  clearOnbError();
  const collectors = [null, _collectStep1, _collectStep2, null, _collectStep4, null];
  const collect = collectors[_onb.step];
  if (collect && !collect()) return;

  if (_onb.step === ONB_TOTAL_STEPS) {
    _completeOnboarding();
    return;
  }
  _onb.step++;
  _renderOnbStep();
}

function onbBack() {
  if (_onb.step <= 1) return;
  clearOnbError();
  _onb.step--;
  _renderOnbStep();
}

async function _completeOnboarding() {
  const nextBtn = document.getElementById('onb-next');
  nextBtn.disabled    = true;
  nextBtn.textContent = 'Saving…';

  // Ensure members have correct initials + ids
  _onb.members = _onb.members.map((m, i) => ({
    ...m,
    id:       m.id || `member-${i + 1}`,
    initials: generateInitials(m.name),
  }));

  const profile = {
    displayName:       _onb.displayName,
    email:             _onb.user.email || '',
    mode:              _onb.mode,
    prefs:             _onb.prefs,
    members:           _onb.members,
    memberPhases:      Object.fromEntries(_onb.members.map(m => [m.id, 'maintenance'])),
    memberMacros:      {},
    onboardingComplete: true,
    onboardingStep:    ONB_TOTAL_STEPS,
    createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    await saveUserProfile(_onb.user.uid, profile);
    // Update Firebase display name if changed
    if (_onb.user.displayName !== _onb.displayName) {
      await _onb.user.updateProfile({ displayName: _onb.displayName });
    }
    currentProfile = profile;
    document.getElementById('onboarding-screen').classList.add('hidden');
    initMainApp(profile);
  } catch (err) {
    console.error('PrepTare: onboarding save failed', err);
    nextBtn.disabled    = false;
    nextBtn.textContent = 'Start PrepTare!';
    _onbError('Could not save your profile. Check your connection and try again.');
  }
}

// ── Helpers ───────────────────────────────────────────────

function _onbError(msg) {
  const el = document.getElementById('onb-step-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearOnbError() {
  const el = document.getElementById('onb-step-error');
  if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
