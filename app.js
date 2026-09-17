const DB_NAME = 'my-money-book-db';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';
const STATE_KEY = 'state';

const defaultCategories = [
  { id: 'food', name: '餐饮', type: 'expense', icon: 'food', color: '#F07A4F', enabled: true },
  { id: 'transport', name: '交通', type: 'expense', icon: 'transport', color: '#D2A93A', enabled: true },
  { id: 'shopping', name: '购物', type: 'expense', icon: 'shopping', color: '#D95745', enabled: true },
  { id: 'housing', name: '住房', type: 'expense', icon: 'house', color: '#8B6FBA', enabled: true },
  { id: 'utilities', name: '水电', type: 'expense', icon: 'water', color: '#71823A', enabled: true },
  { id: 'health', name: '医疗', type: 'expense', icon: 'health', color: '#B85F70', enabled: true },
  { id: 'fun', name: '娱乐', type: 'expense', icon: 'fun', color: '#7565C7', enabled: true },
  { id: 'study', name: '学习', type: 'expense', icon: 'study', color: '#4E4B9B', enabled: true },
  { id: 'social', name: '人情', type: 'expense', icon: 'gift', color: '#C18456', enabled: true },
  { id: 'other-expense', name: '其他', type: 'expense', icon: 'more', color: '#817875', enabled: true }
];

const defaultAccounts = [
  { id: 'wechat', name: '微信', icon: 'cash', enabled: true },
  { id: 'alipay', name: '支付宝', icon: 'wallet', enabled: true },
  { id: 'unionpay', name: '云闪付', icon: 'bank', enabled: true },
  { id: 'cash', name: '现金', icon: 'cash', enabled: true },
  { id: 'bank', name: '银行卡', icon: 'bank', enabled: true },
  { id: 'other-account', name: '其他', icon: 'wallet', enabled: true }
];

const defaultState = {
  schemaVersion: 1,
  settings: { bookName: '我的账本', currency: 'CNY', monthlyBudget: 0, categoryBudgets: {}, defaultAccountId: 'wechat' },
  accounts: defaultAccounts,
  categories: defaultCategories,
  entries: []
};

let state = null;
let currentScreen = 'home';
let currentMonth = monthKey(new Date());
let statsPeriod = 'month';
let editingEntryId = null;
let selectedEntryType = 'expense';
let selectedCategoryId = 'food';
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('当前浏览器不支持本地数据库'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开本地数据库失败'));
  });
}

let dbPromise = openDatabase();

async function readState() {
  try {
    const db = await dbPromise;
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return normalizeState(stored || clone(defaultState));
  } catch {
    try { return normalizeState(JSON.parse(localStorage.getItem('my-money-book-fallback') || 'null') || clone(defaultState)); }
    catch { return clone(defaultState); }
  }
}

async function writeState() {
  const payload = clone(state);
  try {
    const db = await dbPromise;
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(payload, STATE_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } catch {
    localStorage.setItem('my-money-book-fallback', JSON.stringify(payload));
  }
}

function normalizeState(input) {
  const base = clone(defaultState);
  const value = input && typeof input === 'object' ? input : {};
  const settings = { ...base.settings, ...(value.settings || {}) };
  const validAccountIds = new Set(defaultAccounts.map(account => account.id));
  if (!validAccountIds.has(settings.defaultAccountId)) settings.defaultAccountId = 'wechat';
  return {
    ...base,
    ...value,
    settings,
    accounts: clone(defaultAccounts),
    categories: Array.isArray(value.categories) && value.categories.length ? value.categories.filter(category => category.type !== 'income') : base.categories,
    entries: Array.isArray(value.entries) ? value.entries.filter(isValidEntry).map(entry => ({ ...entry, accountId: normalizeAccountId(entry.accountId), toAccountId: entry.type === 'transfer' ? normalizeAccountId(entry.toAccountId) : '' })) : []
  };
}

function normalizeAccountId(id) {
  return ['wechat', 'alipay', 'unionpay', 'cash', 'other-account'].includes(id) ? id : 'other-account';
}

function isValidEntry(entry) {
  return entry && typeof entry.id === 'string' && ['expense', 'transfer'].includes(entry.type) && Number(entry.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date);
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftMonth(key, amount) {
  const date = dateFromKey(`${key}-01`);
  date.setMonth(date.getMonth() + amount);
  return monthKey(date);
}

function monthLabel(key) {
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
}

function statsPeriodInfo() {
  const [year, month] = currentMonth.split('-').map(Number);
  if (statsPeriod === 'year') return { label: `${year}年`, startMonth: 1, endMonth: 12, trend: 'year', note: '各年度汇总' };
  if (statsPeriod === 'quarter') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return { label: `${year}年第${Math.ceil(startMonth / 3)}季度`, startMonth, endMonth: startMonth + 2, trend: 'quarter', note: '本年各季度' };
  }
  return { label: monthLabel(currentMonth), startMonth: month, endMonth: month, trend: 'day', note: '当月趋势' };
}

function entriesForStatsPeriod() {
  const [year] = currentMonth.split('-').map(Number);
  const period = statsPeriodInfo();
  const startDate = `${year}-${String(period.startMonth).padStart(2, '0')}-01`;
  const endDate = dateKey(new Date(year, period.endMonth, 0));
  return state.entries.filter(entry => entry.date >= startDate && entry.date <= endDate);
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
}

function money(value) {
  return `¥${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}

function scaledPeriodAmount(value, divisor, unit) {
  return `${((Number(value) || 0) / divisor).toFixed(2)}${unit}`;
}

function signedMoney(entry) {
  const sign = entry.type === 'expense' ? '' : '↔';
  return `${sign}${money(entry.amount)}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function getCategory(id) {
  return state.categories.find(category => category.id === id) || { id: 'other', name: '其他', icon: 'more', color: '#817875' };
}

function getAccount(id) {
  return state.accounts.find(account => account.id === id) || { id, name: '其他', icon: 'wallet' };
}

function entriesForMonth(month = currentMonth) {
  return state.entries.filter(entry => entry.date.startsWith(month)).sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`));
}

function summary(entries) {
  return entries.reduce((result, entry) => {
    if (entry.type === 'expense') result.expense += Number(entry.amount);
    return result;
  }, { expense: 0 });
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function fitSummaryAmounts() {
  [$('#homeExpense'), $('#homeBalance')].filter(Boolean).forEach(element => {
    element.style.fontSize = '';
    let size = Number.parseFloat(getComputedStyle(element).fontSize);
    while (element.scrollWidth > element.clientWidth && size > 14) {
      size -= 1;
      element.style.fontSize = `${size}px`;
    }
  });
}

function showScreen(name) {
  currentScreen = name;
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === name));
  $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'stats') renderStats();
}

function emptyState(title, description) {
  return `<div class="empty-state">${icon('receipt')}<strong>${title}</strong><p>${description}</p></div>`;
}

function entryIcon(entry) {
  if (entry.type === 'transfer') return { name: 'transfer', color: '#71823A', background: '#f6efcf' };
  const category = getCategory(entry.categoryId);
  return { name: category.icon, color: category.color, background: `${category.color}1c` };
}

function renderEntry(entry) {
  const category = entry.type === 'transfer' ? '账户转账' : getCategory(entry.categoryId).name;
  const account = getAccount(entry.accountId).name;
  const visual = entryIcon(entry);
  return `<button class="entry-item" data-entry-id="${escapeHtml(entry.id)}"><span class="category-icon" style="color:${visual.color};background:${visual.background}">${icon(visual.name)}</span><span class="entry-main"><strong>${escapeHtml(entry.note || category)}</strong><small>${escapeHtml(category)} · ${escapeHtml(account)}</small></span><strong class="entry-amount ${entry.type}">${signedMoney(entry)}</strong></button>`;
}

function renderEntryGroups(entries, target, emptyTitle = '还没有账目', emptyDescription = '从记下第一笔开始。', totalsEntries = entries) {
  if (!entries.length) {
    target.innerHTML = emptyState(emptyTitle, emptyDescription);
    return;
  }
  const totalsByDate = new Map();
  totalsEntries.forEach(entry => {
    if (!totalsByDate.has(entry.date)) totalsByDate.set(entry.date, []);
    totalsByDate.get(entry.date).push(entry);
  });
  const groups = new Map();
  entries.forEach(entry => { if (!groups.has(entry.date)) groups.set(entry.date, []); groups.get(entry.date).push(entry); });
  target.innerHTML = [...groups.entries()].map(([date, group]) => {
    const total = summary(totalsByDate.get(date) || group);
    const dayTotal = total.expense ? `支出 ${money(total.expense)}` : `转账 ${group.length} 笔`;
    const day = dateFromKey(date);
    return `<section class="entry-date-group"><div class="entry-date-heading"><strong>${date === dateKey() ? '今天' : formatDate(day)}</strong><span>${dayTotal}</span></div>${group.map(renderEntry).join('')}</section>`;
  }).join('');
  $$('.entry-item', target).forEach(button => button.addEventListener('click', () => openEntryDialog('edit', state.entries.find(entry => entry.id === button.dataset.entryId))));
}

function renderHome() {
  const now = new Date();
  const hour = now.getHours();
  $('#homeGreeting').textContent = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  $('#homeDate').textContent = `今天是 ${formatDate(now)}`;
  const monthEntries = entriesForMonth();
  const totals = summary(monthEntries);
  const budget = Number(state.settings.monthlyBudget) || 0;
  const percent = budget ? Math.round(totals.expense / budget * 100) : 0;
  const overBudget = budget > 0 && totals.expense > budget;
  $('#homeExpense').textContent = money(totals.expense);
  $('#homeBalance').textContent = budget ? (overBudget ? `超额 ${money(totals.expense - budget)}` : money(budget - totals.expense)) : '—';
  $('#homeBalance').classList.toggle('over-budget', overBudget);
  $('#homeBudgetUsage').textContent = budget ? `${percent}%` : '未设置';
  $('#homeExpenseBar').style.width = `${budget ? totals.expense / budget * 100 : 0}%`;
  $('#homeBalanceBar').style.width = `${budget ? Math.max(0, Math.min(100, (budget - totals.expense) / budget * 100)) : 0}%`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const recentDates = new Set([dateKey(now), dateKey(yesterday)]);
  const recentEntries = state.entries.filter(entry => recentDates.has(entry.date)).sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`));
  renderEntryGroups(recentEntries, $('#homeRecent'), '今天和昨天还没有账目', '记下一笔后，这里会显示最近记录。', state.entries);
  requestAnimationFrame(fitSummaryAmounts);
}

function allRecordsForDialog() {
  let entries = [...state.entries].sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`));
  const time = $('#recordTimeFilter').value;
  const category = $('#recordCategoryFilter').value;
  if (time === 'month') entries = entries.filter(entry => entry.date.startsWith(monthKey(new Date())));
  if (time === 'today') entries = entries.filter(entry => entry.date === dateKey());
  if (time === 'week') { const start = new Date(); start.setDate(start.getDate() - 6); entries = entries.filter(entry => entry.date >= dateKey(start)); }
  if (category === 'transfer') entries = entries.filter(entry => entry.type === 'transfer');
  if (category !== 'all' && category !== 'transfer') entries = entries.filter(entry => entry.categoryId === category);
  return entries;
}

function renderAllRecordsDialog() {
  renderEntryGroups(allRecordsForDialog(), $('#recordsDialogList'), '没有找到账目', '调整时间或类别后再试试。');
}

function openRecordsDialog() {
  const categorySelect = $('#recordCategoryFilter');
  const currentCategory = categorySelect.value || 'all';
  categorySelect.innerHTML = `<option value="all">全部类别</option>${state.categories.filter(category => category.enabled && category.type === 'expense').map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}<option value="transfer">转账</option>`;
  categorySelect.value = [...categorySelect.options].some(option => option.value === currentCategory) ? currentCategory : 'all';
  $('#recordTimeFilter').value = 'all';
  renderAllRecordsDialog();
  $('#recordsDialog').showModal();
}

function renderStats() {
  const period = statsPeriodInfo();
  $('#statsMonth').textContent = period.label;
  $$('[data-period]').forEach(button => button.classList.toggle('active', button.dataset.period === statsPeriod));
  $('#statsTrendTitle').textContent = period.trend === 'day' ? '每日支出趋势' : period.trend === 'quarter' ? '季度支出' : '年度支出';
  $('#statsTrendNote').textContent = period.note;
  $('#statsTrendNote').hidden = period.trend === 'day';
  const entries = entriesForStatsPeriod();
  const totals = summary(entries);
  $('#monthTrendTotal').hidden = period.trend !== 'day';
  $('#monthTrendTotal').innerHTML = `<span>本月支出</span><strong>${money(totals.expense)}</strong>`;
  const byCategory = new Map();
  entries.filter(entry => entry.type === 'expense').forEach(entry => byCategory.set(entry.categoryId, (byCategory.get(entry.categoryId) || 0) + Number(entry.amount)));
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  $('#statsTopCategory').textContent = ranked.length ? `最多：${getCategory(ranked[0][0]).name}` : '暂无记录';
  $('#categoryStats').innerHTML = ranked.length ? ranked.map(([categoryId, amount]) => {
    const category = getCategory(categoryId); const percent = totals.expense ? Math.round(amount / totals.expense * 100) : 0;
    return `<div class="category-row"><span class="category-icon" style="color:${category.color};background:${category.color}1c">${icon(category.icon)}</span><span class="category-name"><strong>${escapeHtml(category.name)}</strong><small><i style="width:${percent}%;background:${category.color}"></i></small></span><span class="category-total"><strong>${money(amount)}</strong><span>${percent}%</span></span></div>`;
  }).join('') : emptyState(`${statsPeriod === 'month' ? '本月' : period.label}还没有支出`, '记下一笔后，这里会显示分类排行。');
  renderTrend(entries, period);
}

function renderTrend(entries, period = statsPeriodInfo()) {
  const chart = $('#trendChart');
  chart.dataset.trendType = period.trend;
  if (period.trend === 'quarter') {
    const [year] = currentMonth.split('-').map(Number);
    const quarters = Array.from({ length: 4 }, (_, index) => ({ quarter: index + 1, amount: 0 }));
    state.entries.filter(entry => entry.type === 'expense' && entry.date.startsWith(`${year}-`)).forEach(entry => { const quarter = Math.ceil(Number(entry.date.slice(5, 7)) / 3); quarters[quarter - 1].amount += Number(entry.amount); });
    const max = Math.max(...quarters.map(item => item.amount), 1);
    const selectedQuarter = Math.ceil(Number(currentMonth.slice(5, 7)) / 3);
    chart.innerHTML = quarters.map(item => `<div class="trend-day trend-quarter ${item.quarter === selectedQuarter ? 'selected' : ''}" title="${year}年第${item.quarter}季度 ${money(item.amount)}"><i class="trend-bar ${item.amount ? '' : 'zero'}" style="--bar-height:${Math.max(4, item.amount / max * 48)}px"></i><span>${year}Q${item.quarter}</span><em class="trend-amount">${scaledPeriodAmount(item.amount, 10000, '万元')}</em></div>`).join('');
    return;
  }
  if (period.trend === 'year') {
    const [selectedYear] = currentMonth.split('-').map(Number);
    const yearSet = new Set([selectedYear]);
    state.entries.forEach(entry => yearSet.add(Number(entry.date.slice(0, 4))));
    const years = [...yearSet].sort((a, b) => a - b).map(year => ({ year, amount: 0 }));
    state.entries.filter(entry => entry.type === 'expense').forEach(entry => { const item = years.find(value => value.year === Number(entry.date.slice(0, 4))); if (item) item.amount += Number(entry.amount); });
    const max = Math.max(...years.map(item => item.amount), 1);
    chart.innerHTML = years.map(item => `<div class="trend-day trend-year ${item.year === selectedYear ? 'selected' : ''}" title="${item.year}年 ${money(item.amount)}"><i class="trend-bar ${item.amount ? '' : 'zero'}" style="--bar-height:${Math.max(4, item.amount / max * 48)}px"></i><span>${item.year}</span><em class="trend-amount">${scaledPeriodAmount(item.amount, 10000, '万元')}</em></div>`).join('');
    return;
  }
  const [year, month] = currentMonth.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  const days = Array.from({ length: totalDays }, (_, index) => ({ day: index + 1, amount: 0 }));
  entries.filter(entry => entry.type === 'expense').forEach(entry => { const day = Number(entry.date.slice(-2)); if (days[day - 1]) days[day - 1].amount += Number(entry.amount); });
  const max = Math.max(...days.map(day => day.amount), 1);
  chart.innerHTML = days.map(day => `<div class="trend-day" title="${day.day}日 ${money(day.amount)}"><i class="trend-bar ${day.amount ? '' : 'zero'}" style="--bar-height:${Math.max(4, day.amount / max * 48)}px"></i><span>${day.day}</span></div>`).join('');
}

function populateAccounts() {
  const accountOptions = state.accounts.filter(account => account.enabled);
  const options = accountOptions.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('');
  $('#entryAccount').innerHTML = options;
}

function renderCategoryChoices() {
  const grid = $('#categoryGrid');
  const categories = state.categories.filter(category => category.enabled && category.type === selectedEntryType);
  grid.innerHTML = categories.map(category => `<button type="button" class="category-option ${category.id === selectedCategoryId ? 'active' : ''}" data-category-id="${category.id}" style="--category-color:${category.color}">${icon(category.icon)}<span>${escapeHtml(category.name)}</span></button>`).join('');
  grid.hidden = selectedEntryType === 'transfer';
  $$('.category-option', grid).forEach(button => button.addEventListener('click', () => { selectedCategoryId = button.dataset.categoryId; renderCategoryChoices(); }));
}

function updateEntryType(type) {
  selectedEntryType = type;
  $$('.entry-type-tabs [data-entry-type]').forEach(button => button.classList.toggle('active', button.dataset.entryType === type));
  const title = type === 'expense' ? (editingEntryId ? '编辑支出' : '记一笔支出') : (editingEntryId ? '编辑转账' : '记一笔转账');
  $('#entryDialogTitle').textContent = title;
  $('.category-field').hidden = type === 'transfer';
  $('.form-two-col .form-field:first-child span').textContent = '日期';
  $('.form-two-col .form-field:nth-child(2) span').textContent = '支出方式';
  renderCategoryChoices();
}

function openEntryDialog(mode = 'new', entry = null) {
  editingEntryId = mode === 'edit' && entry ? entry.id : null;
  selectedEntryType = entry?.type || 'expense';
  selectedCategoryId = entry?.categoryId || 'food';
  $('#entryAmount').value = entry ? entry.amount : '';
  $('#entryDate').value = entry?.date || dateKey();
  $('#entryNote').value = entry?.note || '';
  populateAccounts();
  $('#entryAccount').value = entry?.accountId || 'wechat';
  $('#deleteEntry').hidden = !editingEntryId;
  $('#entryError').textContent = '';
  updateEntryType(selectedEntryType);
  $('#entryDialog').showModal();
}

async function saveEntry(event) {
  event.preventDefault();
  const amount = Math.round(Number($('#entryAmount').value) * 100) / 100;
  const date = $('#entryDate').value;
  const accountId = $('#entryAccount').value;
  if (!amount || amount <= 0) return $('#entryError').textContent = '请输入大于 0 的金额。';
  if (!date) return $('#entryError').textContent = '请选择日期。';
  const now = Date.now();
  const entry = { id: editingEntryId || `entry_${now}_${Math.random().toString(36).slice(2, 8)}`, type: selectedEntryType, amount, categoryId: selectedEntryType === 'transfer' ? '' : selectedCategoryId, accountId, toAccountId: '', date, note: $('#entryNote').value.trim(), createdAt: editingEntryId ? state.entries.find(item => item.id === editingEntryId)?.createdAt || now : now, updatedAt: now };
  if (editingEntryId) state.entries = state.entries.map(item => item.id === editingEntryId ? entry : item);
  else state.entries.push(entry);
  await writeState();
  $('#entryDialog').close();
  renderAll();
  if ($('#recordsDialog')?.open) renderAllRecordsDialog();
  notify(editingEntryId ? '账目已更新' : '账目已保存');
}

async function deleteEntry() {
  if (!editingEntryId || !confirm('确定删除这笔账目吗？删除后无法恢复。')) return;
  state.entries = state.entries.filter(entry => entry.id !== editingEntryId);
  await writeState();
  $('#entryDialog').close();
  renderAll();
  if ($('#recordsDialog')?.open) renderAllRecordsDialog();
  notify('账目已删除');
}

function openBudgetDialog() {
  $('#budgetAmount').value = state.settings.monthlyBudget || '';
  $('#budgetDialog').showModal();
}

async function saveBudget(event) {
  event.preventDefault();
  const value = Math.round(Number($('#budgetAmount').value) * 100) / 100;
  if (Number.isNaN(value) || value < 0) return;
  state.settings.monthlyBudget = value;
  await writeState();
  $('#budgetDialog').close();
  renderAll();
  notify(value ? '预算已保存' : '已取消预算');
}

function exportData() {
  const payload = { ...clone(state), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `我的账本-${dateKey()}.json`; link.click();
  URL.revokeObjectURL(url);
  notify('JSON 备份已导出');
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || !Array.isArray(imported.entries) || !Array.isArray(imported.accounts) || !Array.isArray(imported.categories)) throw new Error('格式不完整');
    const checked = normalizeState(imported);
    if (!confirm(`确认导入 ${checked.entries.length} 笔账目吗？当前数据会被替换。`)) return;
    state = checked;
    await writeState();
    renderAll();
    notify('JSON 数据已导入');
  } catch {
    notify('文件格式不正确，未导入任何数据');
  }
}

async function clearData() {
  if (!confirm('确定清空本地数据吗？账目、预算和设置都会被删除，且无法恢复。')) return;
  state = clone(defaultState);
  await writeState();
  renderAll();
  notify('本地数据已清空');
}

function changeMonth(amount) {
  const step = statsPeriod === 'year' ? 12 : statsPeriod === 'quarter' ? 3 : 1;
  currentMonth = shiftMonth(currentMonth, amount * step);
  if (currentScreen === 'stats') renderStats();
}

function changeStatsPeriod(period) {
  if (!['month', 'quarter', 'year'].includes(period)) return;
  statsPeriod = period;
  if (currentScreen === 'stats') renderStats();
}

function openMonthPicker() {
  const [year, month] = currentMonth.split('-').map(Number);
  const yearSelect = $('#monthPickerYear');
  const years = new Set();
  for (let item = year - 5; item <= year + 1; item += 1) years.add(item);
  state.entries.forEach(entry => years.add(Number(entry.date.slice(0, 4))));
  yearSelect.innerHTML = [...years].sort((a, b) => b - a).map(item => `<option value="${item}">${item}年</option>`).join('');
  $('#monthPickerMonth').innerHTML = Array.from({ length: 12 }, (_, index) => `<option value="${String(index + 1).padStart(2, '0')}">${index + 1}月</option>`).join('');
  yearSelect.value = String(year);
  $('#monthPickerMonth').value = String(month).padStart(2, '0');
  $('#periodPickerTitle').textContent = statsPeriod === 'year' ? '选择统计年份' : statsPeriod === 'quarter' ? '选择统计季度' : '选择统计年月';
  $('#returnToCurrentPeriod').textContent = statsPeriod === 'year' ? '回到当年' : statsPeriod === 'quarter' ? '回到当季' : '回到当月';
  $('#monthPickerMonthField').hidden = statsPeriod !== 'month';
  $('#monthPickerQuarterField').hidden = statsPeriod !== 'quarter';
  $('#monthPickerQuarter').value = String(Math.ceil(month / 3));
  $('#monthPickerDialog').showModal();
}

function saveMonthSelection(event) {
  event.preventDefault();
  const year = Number($('#monthPickerYear').value);
  const month = statsPeriod === 'year' ? 1 : statsPeriod === 'quarter' ? (Number($('#monthPickerQuarter').value) - 1) * 3 + 1 : Number($('#monthPickerMonth').value);
  currentMonth = `${year}-${String(month).padStart(2, '0')}`;
  $('#monthPickerDialog').close();
  renderStats();
}

function returnToCurrentPeriod() {
  currentMonth = monthKey(new Date());
  $('#monthPickerDialog').close();
  renderStats();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function renderAll() {
  renderHome();
  renderStats();
}

function bindEvents() {
  $$('[data-nav]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.nav)));
  $('#addExpense').addEventListener('click', () => openEntryDialog('expense'));
  $('#viewAllRecords').addEventListener('click', openRecordsDialog);
  $('#editBudget').addEventListener('click', openBudgetDialog);
  $('#entryForm').addEventListener('submit', saveEntry);
  $('#budgetForm').addEventListener('submit', saveBudget);
  $('#deleteEntry').addEventListener('click', deleteEntry);
  $('#exportData').addEventListener('click', exportData);
  $('#importData').addEventListener('change', importData);
  $('#clearData').addEventListener('click', clearData);
  $('#statsPrev').addEventListener('click', () => changeMonth(-1));
  $('#statsNext').addEventListener('click', () => changeMonth(1));
  $('#statsMonth').addEventListener('click', openMonthPicker);
  $('#monthPickerForm').addEventListener('submit', saveMonthSelection);
  $('#returnToCurrentPeriod').addEventListener('click', returnToCurrentPeriod);
  $$('[data-period]').forEach(button => button.addEventListener('click', () => changeStatsPeriod(button.dataset.period)));
  window.addEventListener('resize', fitSummaryAmounts);
  $('#recordTimeFilter').addEventListener('change', renderAllRecordsDialog);
  $('#recordCategoryFilter').addEventListener('change', renderAllRecordsDialog);
  $$('[data-entry-type]').forEach(button => button.addEventListener('click', () => updateEntryType(button.dataset.entryType)));
  $$('[data-close]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); closeDialog(button.dataset.close); }));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog.id); }));
}

async function boot() {
  state = await readState();
  bindEvents();
  renderAll();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

boot();
