'use strict';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const native = window.Kadai;
const coverLibraryAvailable = native?.coverLibraryAvailable?.() ?? (typeof native?.configureCover === 'function');
const coverTitleHints = JSON.parse(native?.coverTitleHints?.() || '[]');
let coverTokenReady = coverLibraryAvailable && native?.hasCoverToken?.() === true;
let coverLibraryRefreshing = false;
let coverRequest = null;
let coverTimer = null;
const regions = ['日', '港', '美', '国', '欧', '其他'];
const regionColors = ['#d65041', '#d9a63e', '#678466', '#5d92ae', '#8b73a4', '#9a9285', '#c5bbb0'];
const platforms = {ns1: 'Switch', ns2: 'Switch 2'};
const conditions = ['未拆', '盒卡齐全', '裸卡'];
const qualities = ['全新', '近新', '良好', '有使用痕迹', '有明显瑕疵'];
const icons = {
  box: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
  chart: '<path d="M4 20h16M7 16v-5m5 5V7m5 9V3"/>',
  transfer: '<path d="M3 7h16m-5-4 5 4-5 4m7 6H5m5-4-5 4 5 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  left: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  sort: '<path d="M3 6h13M3 11h9m-9 5h6m9-4v8m-3-3 3 3 3-3"/>',
  scan: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m13-5v4a1 1 0 0 1-1 1h-4M7 8v8m3-8v8m4-8v8m3-8v8"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3"/>',
  cartridge: '<path d="M7 2h10a2 2 0 0 1 2 2v14l-4 4H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M8 6h8v7H8zm1 11v3m3-3v3m3-3v2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-.5 2.5L6 7l-2.4-.6-1.5 2.7L4 11v2l-1.9 1.9 1.5 2.7L6 17l2.5 1.5L9 21h6l.5-2.5L18 17l2.4.6 1.5-2.7L20 13v-2l1.9-1.9-1.5-2.7L18 7l-2.5-1.5L15 3z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  heart: '<path d="M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6l-8 8Z"/>',
  disk: '<path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-7h8v7"/>'
};

function icon(name, size = 23) {
  return '<svg aria-hidden="true" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    (icons[name] || '') + '</svg>';
}
function e(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}
function id() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
}
const collectionOrders = [['new','最近入手'],['ascending','价格从低到高'],['descending','价格从高到低'],['name','游戏名']];
const wishOrders = [['old','最早添加'],['new','最近添加'],['ascending','目标价从低到高'],['descending','目标价从高到低'],['name','游戏名']];
const flowSections = [['in','借入'],['out','借出'],['sold','已售']];
const defaultPreferences = {collectionSort:'new',wishSort:'old',flowMode:'out',resumeFlow:false};

function emptyState() {
  return {version:1,nextNumber:1,items:[],loans:[],wishes:[],reminders:false,targets:{},preferences:{...defaultPreferences}};
}
function shape(value) {
  const stored = value.preferences || {};
  const preferences = {
    collectionSort:collectionOrders.some(([key]) => key === stored.collectionSort) ? stored.collectionSort : defaultPreferences.collectionSort,
    wishSort:wishOrders.some(([key]) => key === stored.wishSort) ? stored.wishSort : defaultPreferences.wishSort,
    flowMode:flowSections.some(([key]) => key === stored.flowMode) ? stored.flowMode : defaultPreferences.flowMode,
    resumeFlow:stored.resumeFlow === true
  };
  return {...emptyState(), ...value, items:Array.isArray(value.items) ? value.items : [],
    loans:Array.isArray(value.loans) ? value.loans : [], wishes:Array.isArray(value.wishes) ? value.wishes : [],
    targets:value.targets && typeof value.targets === 'object' ? value.targets : {}, preferences};
}
function load() {
  try { return shape(JSON.parse(native ? native.load() : localStorage.getItem('kadaihe') || '{}')); }
  catch (_) { return {...emptyState(), readError: true}; }
}
let state = load();
let liveState = null;
let page = state.preferences.resumeFlow ? 'flow' : 'library';
let current = '';
let form = null;
let modal = null;
let mode = state.preferences.flowMode;
let filters = {};
let search = false;
let query = '';
let libraryScroll = 0;
let toastTimer = 0;
const undoBar = document.querySelector('#undo-removal');
let removedItem = null;
let undoTimer = 0;
let coverMenuAnchor = null;
let coverHold = null;
let suppressHoldClick = false;
let coverPull = null;

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}
function commit(next) {
  if (state.readError) { notify('收藏读取失败，暂时无法保存'); return false; }
  try {
    if (!liveState) {
      if (native) {
        if (!native.save(JSON.stringify(next))) throw new Error('write');
      } else localStorage.setItem('kadaihe', JSON.stringify(next));
    }
    state = next;
    return true;
  } catch (_) { notify('保存失败，请检查手机存储空间'); return false; }
}
function savePreference(key,value) {
  return commit({...state,preferences:{...state.preferences,[key]:value}});
}
function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
function daysFromNow(date) {
  const from = Date.parse(today() + 'T00:00:00Z');
  const to = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(to) ? Math.round((to - from) / 86400000) : 0;
}
function price(cents) {
  return Number.isInteger(cents) ? '¥' + (cents / 100).toLocaleString('zh-CN',
    {minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2}) : '—';
}
function parsePrice(input) {
  if (!String(input ?? '').trim()) return null;
  const cleaned = String(input).replace(/^[¥￥]/, '').trim();
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}
function dateLabel(date) { return date ? String(date) : '—'; }
function fmtShort(date) {
  const parts = String(date).split('-');
  return parts.length === 3 ? Number(parts[1]) + '月' + Number(parts[2]) + '日' : '—';
}
function lower(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,''); }
function itemBy(itemId) { return state.items.find(item => item.id === itemId); }
function platformOf(entry) { return entry.platform === 'ns2' ? 'ns2' : 'ns1'; }
function isOwned(item) { return item && (!item.status || item.status === 'owned'); }
function owned() { return state.items.filter(isOwned); }
function soldItems() { return state.items.filter(item => item.status === 'sold'); }
function saleProceeds(item) {
  const income = Number.isInteger(item.salePrice) ? item.salePrice : 0;
  const shipping = Number.isInteger(item.saleShipping) ? item.saleShipping : 0;
  return income - shipping;
}
function saleBalance(item) {
  if (!Number.isInteger(item.price) || !Number.isInteger(item.salePrice)) return {label:'待补价格',tone:''};
  const balance = saleProceeds(item) - item.price;
  if (balance === 0) return {label:'持平',tone:''};
  const amount = price(Math.abs(balance)).slice(1) + ' 元';
  return balance > 0 ? {label:'赚 ' + amount,tone:'gain'} : {label:'亏 ' + amount,tone:'loss'};
}
function outgoingLoan(itemId) {
  return state.loans.find(loan => loan.direction !== 'in' && loan.itemId === itemId && !loan.returned);
}
function financial(items) {
  const valid = items.filter(item => Number.isInteger(item.price));
  const sum = valid.reduce((acc, item) => acc + item.price, 0);
  return {sum, average: valid.length ? Math.round(sum / valid.length) : null,
    month: items.filter(item => String(item.date || '').startsWith(today().slice(0,7))).length};
}
function purchaseHistory() {
  return state.items.flatMap(item => [
    ...(Array.isArray(item.pastPurchases) ? item.pastPurchases : []),
    {date:item.date, price:item.price}
  ]);
}
function spending(purchases) {
  const cost = financial(purchases).sum;
  let borrowed = 0;
  let lent = 0;
  for (const loan of state.loans) {
    const rent = Number.isInteger(loan.rent) && loan.rent >= 0 ? loan.rent : 0;
    const shipping = Number.isInteger(loan.shipping) && loan.shipping >= 0 ? loan.shipping : 0;
    if (loan.direction === 'in') borrowed += rent + shipping;
    else lent += rent - shipping;
  }
  const sold = soldItems().reduce((sum,item) => sum + saleProceeds(item),0);
  return {cost,borrowed,lent,sold,total:cost + borrowed - lent - sold};
}
function collectionKey(item) {
  return JSON.stringify([lower(item.name),platformOf(item),item.region || '']);
}
function nextCollectionNumber() {
  return Math.max(1,state.nextNumber || 1,...state.items.map(item => (item.number || 0) + 1));
}
function button(label, action, className = '', attrs = '') {
  return '<button type="button" data-action="' + action + '" class="' + className + '" ' + attrs + '>' + label + '</button>';
}
function iconButton(name, label, action, klass = '') {
  return button(icon(name), action, 'icon-btn ' + klass, 'aria-label="' + e(label) + '"');
}
function dataAttr(name, value) { return 'data-' + name + '="' + e(value) + '"'; }
function itemAction(label, action, item, className = '') { return button(label, action, className, dataAttr('id', item.id)); }
function coverMenuAttrs(kind, item) {
  return dataAttr('id', item.id) + ' ' + dataAttr('cover-menu', kind) + ' aria-haspopup="menu" aria-expanded="false"';
}
function header(title, config = {}) {
  const leading = config.back ? iconButton('left', '返回', 'back') : '';
  return '<header class="topbar ' + (config.back ? 'inner' : '') + '">' + leading +
    '<h1>' + e(title) + '</h1><div class="header-actions">' + (config.actions || '') + '</div></header>';
}
function navigation() {
  return '<nav class="tabbar" aria-label="主导航">' + [
    ['library', 'box', '收藏库'], ['stats', 'chart', '统计'], ['wishes', 'heart', '心愿单'],
    ['flow', 'transfer', '流转收藏库']
  ].map(([route, symbol, name]) => button(icon(symbol, 24) + '<span>' + name + '</span>', 'tab',
    page === route ? 'selected' : '', dataAttr('page', route) + (page === route ? ' aria-current="page"' : ''))).join('') + '</nav>';
}
function imageUrl(name) {
  if (/^sample[1-4]$/.test(name || '')) return name + '.jpg';
  if (/^[0-9a-f-]{36}\.jpg$/.test(name || '')) return '/photos/' + name;
  return '';
}
function libraryCoverPath(item) {
  return item?.cover && /^\/covers\/switch2?\/[A-Za-z0-9_-]+\.png$/.test(item.coverSource || '') ? item.coverSource : '';
}
function coverFields(item) {
  return {cover:item?.cover || '',coverSource:libraryCoverPath(item) || undefined};
}
const tones = ['fern', 'rust', 'iris', 'sea', 'sand'];
function tone(name) {
  let seed = 0;
  for (const character of String(name || '')) seed += character.codePointAt(0);
  return tones[seed % tones.length];
}
function art(item, extra = '') {
  const source = imageUrl(item.cover);
  return '<span class="art ' + tone(item.name) + ' ' + extra + (libraryCoverPath(item) ? ' library-cover' : '') + '">' +
    (source ? '<img src="' + e(source) + '" alt="" draggable="false">' :
      '<span class="art-mark">' + icon('cartridge', 28) + '</span><span class="art-name">' + e(item.name) + '</span>') +
    '</span>';
}
function tags(item) {
  return (item.region ? '<span class="tag region">' + e(item.region) + '</span>' : '') +
    (item.condition ? '<span class="tag condition">' + e(item.condition) + '</span>' : '');
}
function grid(items, showSaleBalance = false) {
  return '<div class="cover-grid">' + items.map(item => {
    const balance = showSaleBalance ? saleBalance(item) : null;
    return button('<span class="cover-top">' + art(item) +
      (platformOf(item) === 'ns2' ? '<span class="tag platform-tag">NS2</span>' : '') +
      tags(item) + '</span><span class="cover-title">' + e(item.name) + '</span>' +
      (balance ? '<span class="sale-balance ' + balance.tone + '">' + e(balance.label) + '</span>' : ''),
      'detail', 'cover-tile', coverMenuAttrs('item', item));
  }).join('') + '</div>';
}
function empty(symbol, text, sub = '', actions = '') {
  return '<div class="empty"><span class="empty-mark">' + icon(symbol, 30) + '</span><strong>' + e(text) + '</strong>' +
    (sub ? '<span>' + e(sub) + '</span>' : '') + (actions ? '<div class="empty-actions">' + actions + '</div>' : '') + '</div>';
}
function row(key, value) {
  return '<div class="info-row"><span>' + e(key) + '</span><strong>' + e(value) + '</strong></div>';
}
function section(title, body, extra = '') {
  return '<section class="panel ' + extra + '"><h2>' + e(title) + '</h2>' + body + '</section>';
}
function bar(percent) {
  return '<div class="track" role="progressbar" aria-valuenow="' + percent + '" aria-valuemin="0" aria-valuemax="100">' +
    '<i style="width:' + percent + '%"></i></div>';
}
function field(label, key, value, settings = {}) {
  const {type = 'text', placeholder = '', maximum = 120, inputmode = '', min = '', step = ''} = settings;
  return '<label class="field"><span>' + e(label) + '</span><input aria-label="' + e(label) + '" data-field="' + key +
    '" type="' + type + '" value="' + e(value) + '" placeholder="' + e(placeholder) + '" maxlength="' + maximum + '"' +
    (inputmode ? ' inputmode="' + inputmode + '"' : '') + (min ? ' min="' + min + '"' : '') +
    (step ? ' step="' + step + '"' : '') + ' autocomplete="off"></label>';
}
function chips(label, values, active, action, allowAll = false) {
  return '<div class="field chip-field"><span>' + e(label) + '</span><div class="chips">' +
    (allowAll ? [['', '不限'], ...values.map(x => [x, x])] : values.map(x => [x, x])).map(([value, text]) =>
      button(e(text), action, 'chip' + (value === active ? ' active' : ''), dataAttr('value', value) +
        ' aria-pressed="' + (value === active) + '"')).join('') + '</div></div>';
}
function platformChoices(platform) {
  return '<div class="field chip-field"><span>平台</span><div class="chips">' +
    Object.entries(platforms).map(([value, label]) => button(label, 'set-platform',
      'chip' + (value === platform ? ' active' : ''), dataAttr('value', value) +
        ' aria-pressed="' + (value === platform) + '"')).join('') + '</div></div>';
}
function platformField(platform) {
  return '<label class="field"><span>平台</span><select data-modal-field="platform" aria-label="平台">' +
    Object.entries(platforms).map(([value, label]) => '<option value="' + value + '"' +
      (value === platform ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
}
function overallDemo() {
  return liveState ? '<div class="demo-banner"><span>示例收藏</span>' + button('退出示例', 'demo-off', 'text-btn') + '</div>' : '';
}
function filterCount() { return Object.values(filters).filter(Boolean).length; }
function collectionGrid() {
  const lentIds = new Set(loansFor('out').filter(loan => !loan.returned).map(loan => loan.itemId));
  const items = owned().filter(item => {
    const progress = Number(item.progress) || 0;
    const attributes = {platform:platformOf(item), region:item.region, condition:item.condition, location:item.location,
      progress:progress >= 100 ? 'finished' : progress > 0 ? 'playing' : 'new',
      availability:lentIds.has(item.id) ? 'lent' : 'here'};
    return Object.entries(filters).every(([key,value]) => !value || attributes[key] === value) &&
      (!query || [item.name, item.barcode, item.location, item.series, platforms[platformOf(item)],
        platformOf(item) === 'ns2' ? 'NS2' : 'NS'].some(value => lower(value).includes(lower(query))));
  });
  const sort = state.preferences.collectionSort;
  items.sort((a,b) => {
    if (sort === 'ascending') return (a.price ?? Infinity) - (b.price ?? Infinity) || (b.number || 0) - (a.number || 0);
    if (sort === 'descending') return (b.price ?? -1) - (a.price ?? -1) || (b.number || 0) - (a.number || 0);
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    return String(b.date || '').localeCompare(String(a.date || '')) || (b.number || 0) - (a.number || 0);
  });
  if (items.length) return grid(items);
  if (query || filterCount()) return empty('search','没找到卡带','试试其他游戏名或筛选条件');
  return empty('cartridge','收藏库还是空的','扫描包装条码，或输入游戏名录入。',
    button('录入第一张', 'add', 'primary') + button('查看示例', 'demo', 'secondary'));
}
function library() {
  const costs = financial(owned());
  const count = filterCount();
  const metrics = [['总投入', price(spending(purchaseHistory()).total)], ['均价', price(costs.average)], ['本月新增', '+' + costs.month]];
  return header('卡带盒', {actions: iconButton('search', '搜索收藏', 'search-toggle') +
    iconButton('settings', '设置与备份', 'settings')}) +
    '<main class="view library-view"><div class="content">' +
    (search ? '<label class="searchbox">' + icon('search') +
        '<input id="library-search" value="' + e(query) + '" aria-label="搜索收藏" placeholder="搜索游戏名、条码或收纳位置">' +
        iconButton('close', '清空搜索', 'search-clear') + '</label>' : '') +
    '<div class="metrics">' + metrics.map(([name, value]) =>
      '<div><span>' + name + '</span><strong>' + value + '</strong></div>').join('') + '</div>' +
    '<div class="filters">' + button((count ? '筛选 · ' + count : '筛选') + icon('down', 17),
      'filter','secondary filter-btn') + iconButton('sort', '排序', 'sort') + '</div>' +
    '<div id="library-items">' + collectionGrid() + '</div></div></main>' +
    button(icon('plus', 29), 'add', 'fab', 'aria-label="录入卡带"') + navigation();
}
function resultsFor(name, code, platform) {
  const ownOptions = state.items.map(item => [item.name, item.series || '', item.barcode || '', platformOf(item)]);
  const options = [...ownOptions, ...catalog, ...coverTitleHints];
  const key = lower(name);
  const matches = options.filter(([title, series, aliases]) =>
    (key && [title, series, aliases].some(value => lower(value).includes(key))) || (code && aliases === code));
  const rank = ([title, , aliases, version]) => {
    if (code && aliases === code) return -1;
    const titlePriority = lower(title) === key ? 0 : 2;
    const platformPriority = (version || 'ns1') === platform ? 0 : 1;
    return titlePriority + platformPriority;
  };
  const seen = new Set();
  return matches.sort((a, b) => rank(a) - rank(b)).filter(record => {
    const identity = lower(record[0]) + '/' + (record[3] || 'ns1');
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 8);
}
function titleSuggestions(name, platform, action, barcode = '') {
  if (!String(name || '').trim()) return '';
  const matches = resultsFor(name, barcode, platform);
  if (!matches.length) return '';
  return '<div class="suggestions">' + matches.map(([title, series, , suggestionPlatform = 'ns1']) =>
    button('<span>' + e(title) + '</span><small>' + platforms[suggestionPlatform] + '</small>' + icon('right', 17),
      action, 'suggestion', dataAttr('name', title) + ' ' + dataAttr('series', series) +
      ' ' + dataAttr('platform', suggestionPlatform))).join('') + '</div>';
}
function resultList() {
  if (form.selected) {
    const match = form.cover ? form : state.items.find(item =>
      item.name === form.name && platformOf(item) === form.platform && item.cover) || {name: form.name};
    return '<div class="selected-result">' + art(match, 'mini') + '<strong>' + e(form.name) + '</strong>' + icon('check') + '</div>';
  }
  return titleSuggestions(form.name, form.platform, 'select-title', form.barcode);
}
function activeCoverDraft() {
  if (modal) return modal.type === 'wish' || (modal.type === 'loan' && modal.values.direction === 'in') ? modal.values : null;
  return page === 'edit' ? form : null;
}
function coverTitle(draft) { return (draft.name ?? draft.game ?? '').trim(); }
function coverPlatform(candidate) { return candidate.platform === 'switch2' ? 'ns2' : 'ns1'; }
function coverPanel(draft, manualAction) {
  const cover = imageUrl(draft.cover);
  const state = coverRequest?.draft === draft ? coverRequest : null;
  const candidates = state?.phase === 'choose' ? state.candidates : [];
  const waiting = state?.phase === 'search' || state?.phase === 'download';
  const canConfigure = coverLibraryAvailable;
  const canRefresh = libraryCoverPath(draft) && typeof native?.refreshCurrentCover === 'function';
  const needsToken = !coverTokenReady || state?.code === 'auth' || state?.code === 'no-token';
  return '<div class="cover-actions">' + button('<span>封面照片</span><span class="row-right">' +
    (cover ? '<span class="cover-preview-frame' + (libraryCoverPath(draft) ? ' library-cover' : '') +
      '"><img class="cover-preview" src="' + e(cover) + '" alt="已选封面"></span>手动更换' : '拍照或选图') +
    icon('right',18) + '</span>', manualAction, 'field action-row') +
    (canRefresh && !needsToken ? button('刷新当前封面','refresh-current-cover','text-btn cover-action', waiting ? 'disabled' : '') : '') +
    (canConfigure ? button(needsToken ? '配置封面站令牌' : canRefresh ? '查找其他日版封面' : '查找日版封面',
      needsToken ? 'cover-token' : 'find-cover', 'text-btn cover-action', waiting ? 'disabled' : '') : '') +
    (waiting ? button('跳过','skip-cover','text-btn cover-action') : '') + '</div>' +
    (state?.message ? '<p class="cover-status' + (state.phase === 'error' ? ' cover-error' : '') +
      '" role="status">' + e(state.message) + '</p>' : '') +
    (candidates.length ? '<div class="suggestions cover-candidates">' + candidates.map((candidate, index) => {
      const platform = platforms[coverPlatform(candidate)];
      const label = [platform, candidate.keyCard ? '游戏钥匙卡' : '', candidate.edition].filter(Boolean).join(' · ');
      return button('<span><strong>' + e(candidate.title) + '</strong><small>' + e(label) + '</small>' +
        (candidate.sourceTitle && candidate.sourceTitle !== candidate.title ? '<small>' + e(candidate.sourceTitle) + '</small>' : '') +
        '</span>' + icon('right',17), 'choose-cover', 'suggestion', dataAttr('value',index));
    }).join('') + '</div>' : '');
}
function coverField(draft, manualAction) {
  return '<div id="' + manualAction + '-panel" class="cover-field">' + coverPanel(draft, manualAction) + '</div>';
}
function refreshCoverPanel(draft) {
  if (!draft || draft !== activeCoverDraft()) return;
  const action = modal?.type === 'wish' ? 'wish-cover' : modal?.type === 'loan' ? 'borrow-cover' : 'form-cover';
  const holder = document.querySelector('#' + action + '-panel');
  if (holder) holder.innerHTML = coverPanel(draft, action);
}
function cancelCover(draft) {
  if (coverRequest?.draft !== draft) return;
  clearTimeout(coverTimer);
  native?.cancelCoverRequest?.(coverRequest.request);
  coverRequest = null;
  refreshCoverPanel(draft);
}
function findCover(explicit = false) {
  const draft = activeCoverDraft();
  if (!draft) return;
  cancelCover(draft);
  const title = coverTitle(draft);
  if (!title) {
    if (explicit) notify('请先输入游戏名称');
    return;
  }
  if (!coverTokenReady || (!explicit && draft.cover)) return;
  const search = {draft, request:id(), title, refresh:explicit, phase:'search', message:'正在匹配日版封面…'};
  coverRequest = search;
  refreshCoverPanel(draft);
  coverTimer = setTimeout(() => {
    if (coverRequest === search && activeCoverDraft() === draft) native.findCover(search.request, title, search.refresh);
  }, explicit ? 0 : 650);
}
function coverTitleChanged(draft, previous) {
  if (coverTitle(draft) === previous) return;
  if (draft.autoCover) {
    draft.cover = '';
    draft.coverSource = undefined;
    draft.autoCover = false;
  }
  findCover();
  refreshCoverPanel(draft);
}
function downloadCover(candidate) {
  if (!candidate || !coverRequest) return;
  const draft = coverRequest.draft;
  coverRequest = {...coverRequest, request:id(), candidate, phase:'download', message:'正在下载日版封面…'};
  refreshCoverPanel(draft);
  native.downloadCover(coverRequest.request, candidate.image, coverRequest.refresh);
}
function refreshCurrentCover() {
  const draft = activeCoverDraft();
  const image = libraryCoverPath(draft);
  if (!image || !coverTokenReady) return;
  cancelCover(draft);
  coverRequest = {draft, request:id(), title:coverTitle(draft), candidate:{image},
    refreshCurrent:true, phase:'download', message:'正在刷新当前封面…'};
  refreshCoverPanel(draft);
  native.refreshCurrentCover(coverRequest.request, image);
}
function coverErrorMessage(code) {
  const messages = {
    'no-token':'输入封面站令牌后可自动查找，也可手动选图。',
    auth:'封面站认证失败，请重新配置令牌。',
    network:'暂时无法连接封面站，请检查网络后重试，也可手动选图。',
    missing:'封面站找不到这份资源，可手动选图。',
    'invalid-index':'封面站的索引格式有误，可手动选图。',
    'invalid-image':'封面站返回的图片无法读取，请刷新封面库后重试。',
    size:'封面资源超出大小限制，可手动选图。',
    storage:'封面保存失败，请检查手机存储空间。',
    site:'封面站暂时不可用，请重试或手动选图。'
  };
  return messages[code] || messages.site;
}
function acceptCoverEvent(type, payload) {
  const request = coverRequest;
  const draft = activeCoverDraft();
  if (!request || request.draft !== draft || request.request !== payload.request || request.title !== coverTitle(draft)) return;
  if (type === 'cover-found') {
    request.candidates = payload.candidates;
    const first = request.candidates[0];
    if (request.candidates.length === 1 && !first.suggested) return downloadCover(first);
    if (request.candidates.length) {
      request.phase = 'choose';
      request.message = first.suggested ? '找到名称相近的日版封面，请选择。' : '找到多个日版封面，请选择平台和版本。';
    } else {
      request.phase = 'empty';
      request.message = '没找到匹配的日版封面，可手动选图。';
    }
  } else if (type === 'cover-downloaded') {
    draft.cover = payload.name;
    draft.coverSource = request.candidate.image;
    draft.autoCover = true;
    request.phase = 'done';
    if (request.refreshCurrent) {
      request.message = '当前封面已刷新，保存后生效。';
      if (!modal) document.querySelector('#suggestions').innerHTML = resultList();
      refreshCoverPanel(draft);
      return;
    }
    if (request.candidate.suggested) {
      const key = modal?.type === 'loan' ? 'game' : 'name';
      draft[key] = request.candidate.title;
      request.title = coverTitle(draft);
      const input = document.querySelector((modal ? '[data-modal-field="' : '[data-field="') + key + '"]');
      if (input) input.value = draft[key];
      if (modal) {
        draft.suggestTitle = false;
        document.querySelector('#modal-title-suggestions').innerHTML = '';
      } else {
        draft.selected = true;
      }
    }
    const platform = coverPlatform(request.candidate);
    if (modal) {
      draft.platform = platform;
      const select = document.querySelector('[data-modal-field="platform"]');
      if (select) select.value = platform;
    } else {
      setChip('platform', platform);
      document.querySelector('#suggestions').innerHTML = resultList();
    }
    request.message = '已添加日版封面 · ' + platforms[platform] + (request.candidate.keyCard ? ' · 游戏钥匙卡' : '');
  } else {
    request.code = payload.code;
    request.phase = 'error';
    request.message = coverErrorMessage(payload.code);
  }
  refreshCoverPanel(draft);
}
function waitingForCover(draft) {
  if (coverRequest?.draft !== draft || !['search','download'].includes(coverRequest.phase)) return false;
  notify('封面处理中，可稍等或点「跳过」后保存');
  return true;
}
function editScreen() {
  const editing = !!form.id && !form.fromWish;
  const scanText = form.barcode ? '已读取 · ' + form.barcode : '扫描包装条码';
  const more = form.more || editing;
  return header(form.fromWish ? '购入心愿卡带' : editing ? '编辑卡带' : '录入卡带', {back: true}) +
    '<main class="view"><div class="content record">' +
    (form.fromWish ? '' : button(icon('scan', 42) + '<span><strong>' + (form.barcode ? '重新扫码' : '扫码录入') +
      '</strong><small>' + e(scanText) + '</small></span>', 'scan', 'scan-card')) +
    '<label class="searchbox title-search">' + icon('search') +
    '<input data-field="name" value="' + e(form.name) + '" aria-label="游戏名称" maxlength="120" autocomplete="off" placeholder="搜索或输入游戏名称">' +
    iconButton('close','清空游戏名称','clear-title') + '</label><div id="suggestions">' + resultList() + '</div>' +
    coverField(form, 'form-cover') +
    '<h2 class="form-title">这张属于</h2><div class="panel form-panel">' +
    platformChoices(form.platform) +
    chips('区域', regions, form.region, 'set-region') +
    field(form.fromWish ? '实际入手价' : '价格', 'priceText', form.priceText,
      {placeholder:'可稍后填写', inputmode:'decimal', maximum:10}) +
    field('收纳位置', 'location', form.location, {placeholder:'如 客厅 A 盒', maximum:80}) +
    '</div>' +
    (more ? '<div class="panel form-panel more-fields">' +
      chips('状态', conditions, form.condition, 'set-condition') +
      '<label class="field"><span>成色</span><select data-field="quality" aria-label="成色">' +
      [''].concat(qualities).map(value => '<option value="' + e(value) + '"' + (value === form.quality ? ' selected' : '') + '>' +
        e(value || '未填写') + '</option>').join('') + '</select></label>' +
      field('入手日期', 'date', form.date, {type:'date'}) +
      field('购入渠道', 'channel', form.channel, {placeholder:'如 二手平台'}) +
      field('条码', 'barcode', form.barcode, {placeholder:'包装条码', maximum:100}) +
      field('系列', 'series', form.series, {placeholder:'可选，参与系列统计', maximum:60}) +
      '<label class="memo"><span>备注</span><textarea data-field="note" aria-label="备注" rows="2" maxlength="1000" placeholder="可选">' + e(form.note) + '</textarea></label>' +
      '</div>' : button('补充购入信息 ' + icon('down', 16), 'show-more', 'quiet more-button')) +
    '</div></main><footer class="bottom-action">' +
    button(form.fromWish ? '转入收藏库' : '保存卡带','save-item','primary full') + '</footer>';
}
function detail() {
  const item = itemBy(current);
  if (!item) return header('卡带详情',{back:true}) + '<main class="view">' + empty('cartridge','这张卡带已移除') + '</main>';
  const source = imageUrl(item.cover);
  const framed = libraryCoverPath(item);
  const purchase = [item.channel, Number.isInteger(item.price) ? price(item.price) : ''].filter(Boolean).join(' · ') || '—';
  const progress = Math.max(0,Math.min(100,Number(item.progress) || 0));
  const progressLabel = progress === 100 ? '已通关' : progress > 0 ? '游玩中' : '未开始';
  const active = outgoingLoan(item.id);
  const photos = (item.photos || []).filter(name => imageUrl(name));
  return header('卡带详情',{back:true,actions:button('编辑','edit','text-btn')}) +
    '<main class="view detail-view"><section class="detail-cover-header"><div class="hero ' + tone(item.name) + '">' +
    (source ? '<img class="hero-image' + (framed ? ' hero-library-cover' : '') + '" src="' + e(source) + '" alt="">' : '') +
    '<div class="hero-copy"><h2>' + e(item.name) + '</h2><p>' +
      e([platforms[platformOf(item)], item.region && item.region + '版', item.condition,
        item.status === 'sold' && '已售'].filter(Boolean).join(' · ')) +
    '</p></div><div class="standing-card ' + platformOf(item) + '">' + art(item) + '<i></i></div></div>' +
    (source ? '<div id="full-cover" class="detail-full-cover" role="img" aria-hidden="true" aria-label="' +
      e(item.name + '完整封面') + '">' + art(item, 'full-cover-art') + '</div>' +
      button(icon('down',19), 'toggle-detail-cover', 'cover-pull-handle',
        'aria-label="展开封面" aria-controls="full-cover" aria-expanded="false"') : '') + '</section>' +
    '<div class="content detail-content">' +
    '<section class="panel identifiers">' + row('卡带编号', '#' + String(item.number || 1).padStart(3, '0')) +
    '<div class="info-row"><span>购入链路</span><div class="purchase"><strong>' + e(purchase) +
      '</strong><span>' + e(dateLabel(item.date)) + '</span></div></div>' +
    (item.location ? row('收纳位置', item.location) : '') + (item.quality ? row('成色', item.quality) : '') +
    (item.barcode ? row('条码', item.barcode) : '') + '</section>' +
    '<section class="panel"><div class="section-head"><h2>游玩进度</h2>' +
    button(e(progressLabel) + icon('right',16),'progress','quiet') + '</div><div class="progress-line">' +
      bar(progress) + '<span>' + progress + '%</span></div></section>' +
    section('实拍留存','<div class="photo-grid">' + photos.map(name =>
       button('<img src="' + e(imageUrl(name)) + '" alt="实拍照片">', 'view-photo', 'photo-tile', dataAttr('value',name))).join('') +
      (photos.length < 12 ? button(icon('plus',24),'add-photo','photo-tile add-photo','aria-label="添加实拍照片"') : '') +
      '</div>') +
    (item.note ? section('备注','<p class="note">' + e(item.note) + '</p>') : '') +
    (item.status === 'sold' ? section('售出记录',row('售出价',price(item.salePrice)) +
      row('售出运费',price(item.saleShipping)) + row('本次盈亏',saleBalance(item).label) +
      row('售出日期',dateLabel(item.saleDate))) : '') +
    '<section class="detail-actions">' +
    (item.status === 'sold' ? button('编辑售出','sell','primary') + button('恢复到收藏库','unsell','secondary') : active
      ? itemAction('登记归还','return',active,'primary') + itemAction('编辑借出','edit-loan',active,'secondary')
      : button('登记借出','loan','primary') + button('登记售出','sell','secondary') +
        button('移到心愿单','move-to-wish','secondary')) +
    '</section>' + (active ? '' : button('删除记录','delete-item','text-btn delete-record')) + '</div></main>';
}
function monthlyPurchases(items) {
  const counts = new Map();
  for (const item of items) {
    const month = String(item.date || '').match(/^(\d{4}-(?:0[1-9]|1[0-2]))-\d{2}$/)?.[1];
    if (month) counts.set(month, (counts.get(month) || 0) + 1);
  }
  if (!counts.size) return '<p class="muted inset">记录入手日期后显示</p>';
  const currentDate = new Date();
  for (let offset = 0; offset < 12; offset++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - offset, 1);
    const month = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    if (!counts.has(month)) counts.set(month, 0);
  }
  const maxCount = Math.max(...counts.values());
  const columns = [...counts.keys()].sort().map(month => {
    const count = counts.get(month);
    const height = count ? Math.max(18, Math.round(count / maxCount * 74)) : 0;
    return '<div data-month="' + month + '"><span class="column' + (count ? '' : ' zero') + '" style="height:' +
      height + 'px">' + count + '</span><span>' + month.replace('-', '.') + '</span></div>';
  }).join('');
  return '<div class="monthly-chart" aria-label="每月购入数量">' + columns + '</div>' +
    '<p class="chart-hint">左右滑动查看较早月份</p>';
}
function statistics() {
  const items = owned();
  const costs = financial(items);
  const purchases = purchaseHistory();
  const finance = spending(purchases);
  const average = costs.average === null ? '—' : price(costs.average).slice(1) + '元';
  const regionList = [...regions, '未填'];
  const counts = regionList.map(region => items.filter(item => (item.region || '未填') === region).length);
  let stops = 0;
  const gradient = counts.map((count, index) => {
    const start = stops;
    stops += items.length ? (count / items.length) * 100 : 0;
    return regionColors[index] + ' ' + start + '% ' + stops + '%';
  }).join(',');
  const bySeries = new Map();
  for (const item of items) {
    if (item.series) {
      if (!bySeries.has(item.series)) bySeries.set(item.series, {ns1:new Set(), ns2:new Set()});
      bySeries.get(item.series)[platformOf(item)].add(lower(item.name));
    }
  }
  const seriesRows = [...bySeries].map(([name, unique]) => {
    const ns1 = unique.ns1.size, ns2 = unique.ns2.size;
    const count = ns1 + ns2;
    const target = Number(state.targets[name]) || catalog.filter(entry => entry[1] === name).length;
    const amount = Math.max(count, target);
    return button('<span class="series-name"><span>' + e(name) + '</span><small>NS ' + ns1 + ' · NS2 ' + ns2 +
      '</small></span>' + bar(Math.round(count / amount * 100)) +
      '<strong>' + (target ? count + ' / ' + amount : count + ' 款') + '</strong>' + icon('right',16),
      'series-target','series-row',dataAttr('value',name));
  }).join('');
  const backlog = items.filter(item => !Number(item.progress) && item.date && daysFromNow(item.date) < -90);
  return header('统计') + '<main class="view"><div class="content stats-content">' +
    '<div class="stat-total"><div><span>总投入</span><strong>' + price(finance.total) +
    '</strong><small>（单张均价：' + average + '）</small></div><span>在库 ' + items.length + ' 张</span></div>' +
    section('购买总结',row('购买价格',price(finance.cost)) + row('借入价',price(finance.borrowed)) +
      row('借出回血',price(finance.lent)) + row('已售回血',price(finance.sold)),'purchase-summary') +
    section('区域分布', '<div class="distribution"><div class="donut" aria-hidden="true"' +
      (items.length ? ' style="background:conic-gradient(' + gradient + ')"' : '') + '></div><div class="legend">' +
      regionList.map((region,i) => (i < 4 || counts[i] ? '<div><i style="background:' + regionColors[i] + '"></i><span>' + region +
         '</span><strong>' + counts[i] + '</strong></div>' : '')).join('') + '</div></div>') +
    section('每月购入', monthlyPurchases(purchases)) +
    section('系列进度', seriesRows || '<p class="muted inset">在卡带详情里补填系列</p>') +
    '<section class="panel compact"><h2>吃灰提醒</h2>' +
    button('<span>' + (backlog.length ? backlog.length + ' 张入手超 90 天未玩' : '暂无入手超 90 天未玩的卡带') +
      '</span>' + icon('right',18), 'backlog', 'action-row field') + '</section>' +
    '</div></main>' + navigation();
}
function loanTile(loan, historical = false, linkPerson = true) {
  const borrowing = loan.direction === 'in';
  const item = itemBy(loan.itemId) || {name:loan.game || '卡带', platform:loan.platform, ...coverFields(loan)};
  const days = daysFromNow(loan.due);
  const due = days < 0 ? '逾期 ' + -days + ' 天' : days === 0 ? '今天应还' : '剩余 ' + days + ' 天';
  const edit = itemAction('编辑',borrowing ? 'edit-borrow' : 'edit-loan',loan,'text-btn return-btn');
  const person = (borrowing ? '借自 ' : '借给 ') + e(loan.person) + ' · ' + platforms[platformOf(item)];
  const personLine = linkPerson && loan.person ?
    button(person + icon('right',14),'person-loans','loan-person',dataAttr('value',personKey(loan.person))) :
    '<div class="muted">' + person + '</div>';
  const returnAction = historical ? '' : itemAction('登记归还','return',loan,'text-btn return-btn');
  return '<article class="panel loan-card">' + art(item, 'loan-art') + '<div class="loan-copy">' +
    '<h2>' + e(item.name) + '</h2>' + personLine +
    (linkPerson && !borrowing ? '' : '<div class="muted">' + (borrowing ? '借入 ' : '借出 ') +
      e(dateLabel(loan.start)) + '</div>') +
    (historical ? '<div class="muted">' + (borrowing ? '已归还对方 ' : '对方已归还 ') + e(dateLabel(loan.returned)) + '</div>' :
      '<span class="badge ' + (days <= 0 ? 'urgent' : '') + '">' + due + '</span>' +
      '<div class="muted">应还 ' + e(borrowing ? dateLabel(loan.due) : fmtShort(loan.due)) + '</div>') +
    itemAction('租金 ' + (Number.isInteger(loan.rent) ? price(loan.rent) : '未填写') +
      icon('right',14), 'edit-rent', loan, 'loan-rent') +
    (Number.isInteger(loan.shipping) ? '<div class="muted">运费 ' + price(loan.shipping) + '</div>' : '') +
    '</div>' + (edit || returnAction ? '<div class="loan-actions">' + edit + returnAction + '</div>' : '') + '</article>';
}
function wishCover(wish) {
  return coverFields(wish.cover ? wish : state.items.find(item =>
    item.name === wish.name && platformOf(item) === platformOf(wish) && item.cover));
}
function wishTile(wish) {
  const diff = Number.isInteger(wish.reference) && Number.isInteger(wish.target) ? wish.reference - wish.target : null;
  const compare = diff === null ? '—' : diff <= 0 ? '已达目标' : price(diff);
  const version = [platforms[platformOf(wish)], wish.region && wish.region + '版'].filter(Boolean).join(' · ');
  return '<article class="panel wish-card"><div class="wish-item">' +
    button(art({...wish, ...wishCover(wish)}, 'wish-art'), 'edit-wish', 'wish-cover-target',
      coverMenuAttrs('wish', wish) + ' aria-label="' + e(wish.name + '封面') + '"') + '<div class="wish-copy">' +
    itemAction('<span><strong>' + e(wish.name) + '</strong><small>' + e(version) + '</small></span>' +
      icon('right',16), 'edit-wish', wish, 'wish-title') +
    '<div class="wish-prices"><div><span>参考价</span><strong>' + price(wish.reference) +
    '</strong></div><div><span>目标价</span><strong>' + price(wish.target) +
    '</strong></div><div class="' + (diff !== null && diff <= 0 ? 'achieved' : 'gap') + '"><span>' +
    (diff !== null && diff > 0 ? '还差' : '差额') + '</span><strong>' + compare + '</strong></div></div></div></div>' +
    '<div class="wish-actions">' + itemAction('已购入','buy-wish',wish,'primary') + '</div></article>';
}
function wishScreen() {
  const wishes = [...state.wishes];
  switch (state.preferences.wishSort) {
    case 'new': wishes.reverse(); break;
    case 'ascending': wishes.sort((a,b) => (a.target ?? Infinity) - (b.target ?? Infinity)); break;
    case 'descending': wishes.sort((a,b) => (b.target ?? -1) - (a.target ?? -1)); break;
    case 'name': wishes.sort((a,b) => a.name.localeCompare(b.name,'zh-CN')); break;
  }
  const body = wishes.length ? wishes.map(wishTile).join('') :
    empty('heart','心愿单是空的','记录想入手的卡带和目标价。');
  return header('心愿单') + '<main class="view"><div class="content flow-content"><div class="wish-toolbar">' +
    button(icon('plus',18) + ' 添加心愿','add-wish','primary') +
    button(icon('sort',18) + ' 排序','wish-sort','secondary') + '</div>' + body + '</div></main>' + navigation();
}
function loansFor(direction) {
  return state.loans.filter(loan => (loan.direction === 'in' ? 'in' : 'out') === direction);
}
function personKey(person) { return String(person || '').normalize('NFKC').trim().toLowerCase(); }
function loanContacts() {
  const contacts = new Map();
  for (const loan of state.loans) {
    const key = personKey(loan.person);
    if (!key) continue;
    if (!contacts.has(key)) contacts.set(key,{name:loan.person,loans:[]});
    contacts.get(key).loans.push(loan);
  }
  return contacts;
}
function personLoans(person) {
  return [['in','借入'],['out','借出']].map(([direction,label]) => {
    const loans = person.loans.filter(loan => (loan.direction === 'in' ? 'in' : 'out') === direction)
      .sort((a,b) => Number(Boolean(a.returned)) - Number(Boolean(b.returned)) || String(a.due).localeCompare(String(b.due)));
    return '<div class="person-group"><h3>' + label + ' · ' + loans.length + '</h3>' +
      (loans.length ? loans.map(loan => loanTile(loan,Boolean(loan.returned),false)).join('') :
        '<p class="muted inset">暂无' + label + '记录</p>') + '</div>';
  }).join('');
}
function flow() {
  const tabs = '<div class="segments">' + flowSections.map(([value,label]) => button(label,'flow-mode',
    mode === value ? 'active' : '', dataAttr('value',value) + ' aria-pressed="' + (mode === value) + '"')).join('') + '</div>';
  let body;
  if (mode === 'sold') {
    const sold = soldItems();
    body = sold.length ? grid(sold, true) : empty('box','暂无已售卡带','可从详情页登记售出价、运费和日期。');
  } else {
    const borrowing = mode === 'in';
    const entries = loansFor(mode);
    const active = entries.filter(loan => !loan.returned).sort((a,b) => String(a.due).localeCompare(String(b.due)));
    const count = entries.length - active.length;
    body = button('按人查看 ' + icon('right',16),'loan-contacts','secondary full') +
      (active.length ? active.map(loan => loanTile(loan)).join('') :
        empty('transfer',borrowing ? '暂无借入的卡带' : '暂无借出的卡带'));
    body += button(icon('plus',18) + (borrowing ? ' 登记借入' : ' 登记借出'),
      borrowing ? 'borrow' : 'pick-loan','secondary full') +
      '<section class="panel form-panel">' +
      button('<span>归还提醒</span><i class="switch ' + (state.reminders ? 'on' : '') + '"></i>', 'toggle-reminder',
        'action-row field', 'role="switch" aria-checked="' + !!state.reminders + '"') +
      button('<span>归还历史</span><span class="row-right">' + (count || '') + icon('right',18) + '</span>',
        'history','action-row field') + '</section>';
  }
  return header('流转') + '<main class="view"><div class="content flow-content">' + tabs + body + '</div></main>' + navigation();
}
function modalField(label, name, value, options) {
  return field(label, name, value, options).replace('data-field=', 'data-modal-field=');
}
function selectField(label, key, selected, options) {
  return '<label class="field"><span>' + label + '</span><select data-modal-field="' + key + '" aria-label="' +
    label + '">' + options.map(([value,text]) => '<option value="' + e(value) + '"' +
      (value === selected ? ' selected' : '') + '>' + e(text) + '</option>').join('') + '</select></label>';
}
function filterFields(values) {
  const locations = [...new Set(owned().map(item => item.location).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  const choices = [
    ['平台','platform',Object.entries(platforms)], ['区域','region',regions.map(value => [value,value + '版'])],
    ['盒卡状态','condition',conditions.map(value => [value,value])], ['收纳位置','location',locations.map(value => [value,value])],
    ['游玩进度','progress',[['new','未开始'],['playing','游玩中'],['finished','已通关']]],
    ['借出状态','availability',[['here','在手'],['lent','借出中']]]
  ];
  return choices.map(([label,key,options]) => selectField(label,key,values[key],[['','不限'],...options])).join('');
}
function modalTitleField(key, values) {
  return modalField('游戏名称', key, values[key], {placeholder:'搜索或输入游戏名'}) +
    '<div id="modal-title-suggestions">' + (values.suggestTitle ?
      titleSuggestions(values[key], values.platform, 'select-modal-title') : '') + '</div>';
}
function removalConfirmation(message, action, label = '确认删除') {
  return '<p class="inset">' + e(message) + '</p>' + button(label,action,'primary full') +
    button('取消','close-modal','secondary full');
}
function modalContents() {
  let html = '';
  const values = modal.values || {};
  switch (modal.type) {
    case 'filter':
      html = '<div class="form-panel">' + filterFields(values) + '</div>' +
        button('应用筛选','apply-filter','primary full') + button('清除筛选','clear-filter','secondary full');
      break;
    case 'duplicate':
      html = '<p class="inset">收藏库已有同名、同平台、同区域的卡带。</p>' +
        values.items.slice(0,5).map(item => row('#' + String(item.number || 1).padStart(3,'0'),
          [item.name,item.condition,item.location].filter(Boolean).join(' · '))).join('') +
        (values.items.length > 5 ? '<p class="muted inset">另有 ' + (values.items.length - 5) + ' 张同款</p>' : '') +
        button('继续保存一张','save-duplicate','primary full');
      break;
    case 'delete-item': {
      const records = values.item.status === 'sold' ? '购入和售出记录' : '购入记录';
      html = removalConfirmation('删除「' + values.item.name + '」及其' + records + '。删除后 10 秒内可撤销。','confirm-delete-item');
      break;
    }
    case 'delete-wish':
      html = removalConfirmation('将「' + values.wish.name + '」从心愿单删除？','confirm-delete-wish');
      break;
    case 'remove-photo':
      html = removalConfirmation('从这张卡带的实拍留存中移除这张照片？','confirm-remove-photo','确认移除');
      break;
    case 'clear-borrow-cover':
      html = removalConfirmation('移除这条借入记录的封面？保存记录后生效。','confirm-clear-borrow-cover','确认移除');
      break;
    case 'unsell':
      html = removalConfirmation('恢复到收藏库会清除本次售出的价格、运费和日期。','confirm-unsell','确认恢复');
      break;
    case 'sort':
    case 'wish-sort': {
      const wishSorting = modal.type === 'wish-sort';
      const choices = wishSorting ? wishOrders : collectionOrders;
      const selected = wishSorting ? state.preferences.wishSort : state.preferences.collectionSort;
      html = choices.map(([value,label]) => button('<span>' + label + '</span>' +
        (value === selected ? icon('check',18) : ''), wishSorting ? 'apply-wish-sort' : 'apply-sort',
        'action-row field', dataAttr('value',value) + (value === selected ? ' aria-pressed="true"' : ' aria-pressed="false"'))).join('');
      break;
    }
    case 'settings':
      html = (coverLibraryAvailable ?
        button('<span>日版封面站</span><span class="row-right">' + (coverTokenReady ? '已配置' : '配置令牌') +
          icon('right',18) + '</span>','cover-token','field action-row') : '') +
        (coverTokenReady && typeof native?.refreshCoverLibrary === 'function' ?
          button('<span>' + (coverLibraryRefreshing ? '正在刷新日版封面库…' : '刷新日版封面库') + '</span>' + icon('right',18),
            'refresh-cover-library','field action-row',coverLibraryRefreshing ? 'disabled' : '') : '') +
        button('<span>导出</span>' + icon('right',18),'export','field action-row') +
        button('<span>导入 ZIP 备份</span>' + icon('right',18),'import','field action-row') +
        button('<span>从 CSV 批量导入</span>' + icon('right',18),'import-csv','field action-row') +
        button('<span>' + (liveState ? '退出示例' : '查看示例') + '</span>' + icon('right',18),
          liveState ? 'demo-off' : 'demo','field action-row') +
        '<p class="muted inset">备份含卡带、心愿单、流转记录和照片 · 版本 2.5</p>';
      break;
    case 'export-format':
      html = button('<span>ZIP 备份（含照片）</span>' + icon('right',18),'export-zip','field action-row') +
        button('<span>CSV 表格</span>' + icon('right',18),'export-csv','field action-row');
      break;
    case 'csv-preview': {
      const plan = csvImportPlan(values.data);
      html = row('可新增卡带',plan.fresh.length + ' 张') + row('同款卡带',plan.duplicates.length + ' 张') +
        row('格式有误',values.data.errors.length + ' 行') +
        (values.data.nonCards ? row('将跳过其他类型记录',values.data.nonCards + ' 行') : '') +
        values.data.errors.slice(0,5).map(message => '<p class="muted inset">' + e(message) + '</p>').join('');
      if (plan.fresh.length) html += button('导入新卡带','merge-csv','primary full');
      if (plan.duplicates.length) html += button('连同同款一起导入','merge-csv-all','secondary full');
      break;
    }
    case 'progress':
      html = '<label class="slider"><span>完成进度 <strong id="percent">' + Number(values.progress) + '%</strong></span>' +
        '<input data-modal-field="progress" type="range" aria-label="完成进度" min="0" max="100" step="1" value="' +
        Number(values.progress) + '"></label>' + button('保存进度','save-progress','primary full');
      break;
    case 'photo':
      html = button(icon('camera',22) + '<span>拍照</span>', 'take-photo','action-row field photo-choice') +
        button('<span>从相册选择</span>' + icon('right',18),'pick-photo','action-row field') +
        (values.slot === 'borrow' && modal.previous?.values.cover ?
          button('<span>移除封面</span>','clear-borrow-cover','action-row field') : '');
      break;
    case 'preview':
      html = '<img class="preview-photo" src="' + e(imageUrl(values.name)) + '" alt="实拍照片">' +
        (values.canRemove ? button('移除照片','remove-photo','secondary full') : '');
      break;
    case 'loan': {
      const borrowing = values.direction === 'in';
      html = '<div class="form-panel">' + (borrowing ?
        modalTitleField('game', values) + coverField(values, 'borrow-cover') + platformField(values.platform) : '') +
        modalField(borrowing ? '从谁借入' : '借给谁','person',values.person,{placeholder:'输入对方称呼',maximum:60}) +
        modalField('租金','rent',values.rent,
          {inputmode:'decimal',placeholder:borrowing ? '支付金额（元），可选' : '收取金额（元），可选',maximum:10}) +
        modalField('运费','shipping',values.shipping,{inputmode:'decimal',placeholder:'我支付的金额（元），可选',maximum:10}) +
        modalField(borrowing ? '借入日期' : '借出日期','start',values.start,{type:'date'}) +
        modalField('应还日期','due',values.due,{type:'date'}) +
        (values.hasReturnDate ? modalField('归还日期','returned',values.returned,{type:'date'}) : '') + '</div>' +
        button(values.loanId ? '保存修改' : borrowing ? '保存借入记录' : '保存借出记录','save-loan','primary full') +
        (values.loanId ? button(borrowing ? '删除借入记录' : '删除借出记录','delete-loan','secondary full delete-record') : '');
      break;
    }
    case 'delete-loan': {
      const borrowing = values.loan.direction === 'in';
      html = removalConfirmation('删除「' + values.loan.game + '」的' + (borrowing ? '借入' : '借出') +
        '记录后，相关租金、运费和提醒会一并移除。' + (borrowing ? '' : '收藏里的卡带会保留。'), 'confirm-delete-loan');
      break;
    }
    case 'rent':
      html = modalField('租金','rent',values.rent,{inputmode:'decimal',
        placeholder:values.borrowing ? '支付金额（元），可选' : '收取金额（元），可选',maximum:10}) +
        button('保存租金','save-rent','primary full');
      break;
    case 'pick-loan': {
      const existing = new Set(loansFor('out').filter(loan => !loan.returned).map(loan => loan.itemId));
      const eligible = owned().filter(item => !existing.has(item.id));
      html = eligible.length ? eligible.map(item => itemAction('<span>' + e(item.name) + '</span>' + icon('right',18),
        'choose-loan',item,'action-row field')).join('') :
        '<p class="muted inset">录入卡带后即可登记借出。</p>';
      break;
    }
    case 'return':
      html = '<p class="inset">归还记录将保留在「归还历史」。</p>' + modalField('归还日期','date',values.date,{type:'date'}) +
        button('确认归还','save-return','primary full');
      break;
    case 'loan-contacts': {
      const contacts = [...loanContacts()].sort((a,b) => a[1].name.localeCompare(b[1].name,'zh-CN'));
      html = contacts.map(([key,person]) =>
        button('<span>' + e(person.name) + '</span><span class="row-right">' + person.loans.length +
          ' 条 ' + icon('right',18) + '</span>', 'person-loans','action-row field',dataAttr('value',key))).join('') ||
        '<p class="muted inset">登记借入或借出后可按人查看</p>';
      break;
    }
    case 'person-loans': {
      const person = loanContacts().get(values.key);
      html = person ? personLoans(person) : '<p class="muted inset">暂无记录</p>';
      break;
    }
    case 'history':
      html = loansFor(mode).filter(loan => loan.returned).sort((a,b) => b.returned.localeCompare(a.returned))
        .map(loan => loanTile(loan,true)).join('') || '<p class="muted inset">还没有归还记录。</p>';
      break;
    case 'wish': {
      html = '<div class="form-panel">' + modalTitleField('name', values) + coverField(values, 'wish-cover') +
        platformField(values.platform) +
        '<label class="field"><span>区域</span><select data-modal-field="region" aria-label="区域">' +
        [''].concat(regions).map(region => '<option value="' + e(region) + '"' + (values.region === region ? ' selected' : '') + '>' +
           e(region ? region + '版' : '不限') + '</option>').join('') + '</select></label>' +
        modalField('目标价','target',values.target,{inputmode:'decimal',placeholder:'可选 ¥',maximum:10}) +
        modalField('参考价','reference',values.reference,{inputmode:'decimal',placeholder:'可选 ¥',maximum:10}) +
        '</div>' + button(values.move ? '确认移到心愿单' : '保存心愿','save-wish','primary full') +
        (values.id ? button('移除心愿','delete-wish','secondary full') : '');
      break;
    }
    case 'sell':
      html = modalField('售出价','priceText',values.priceText,{inputmode:'decimal',placeholder:'可选',maximum:10}) +
        modalField('运费','saleShipping',values.saleShipping,{inputmode:'decimal',placeholder:'我支付的金额（元），可选',maximum:10}) +
        modalField('售出日期','date',values.date,{type:'date'}) +
        button(values.editing ? '保存修改' : '确认登记售出','save-sell','primary full');
      break;
    case 'series':
      html = modalField('目标总数','target',values.target,{type:'number',min:'1',step:'1'}) +
        button('保存目标','save-series','primary full');
      break;
    case 'backlog': {
      const items = owned().filter(item => !Number(item.progress) && item.date && daysFromNow(item.date) < -90);
      html = items.length ? items.map(item => itemAction('<span>' + e(item.name) + '</span>' + icon('right',18),
        'detail',item,'action-row field')).join('') : '<p class="muted inset">暂无入手超 90 天未玩的卡带。</p>';
      break;
    }
    case 'barcode':
      html = modalField('条码','code',values.code,{placeholder:'输入包装条码',maximum:100}) +
        button('确认条码','save-barcode','primary full');
      break;
    case 'replace': {
      const plan = backupPlan(values.data);
      const groups = [['卡带记录',plan.added.items.length],['心愿记录',plan.added.wishes.length],['借还记录',plan.added.loans.length]];
      html = groups.map(([label,count]) => row('将新增' + label,count + ' 条')).join('');
      if (plan.skipped.length) {
        html += '<p class="muted inset">' + plan.skipped.length + ' 条重复或冲突记录会跳过，保留手机上已有的记录。</p>' +
          plan.skipped.slice(0,5).map(record => row(record.group,record.name)).join('');
      }
      html += button('确认合并备份','merge-backup','primary full');
      break;
    }
  }
  return '<div class="overlay"><div class="overlay-scrim" data-action="close-modal"></div>' +
    '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-head"><h2 id="sheet-title">' +
    e(modal.title) + '</h2>' + iconButton('close','关闭','close-modal') + '</div><div class="sheet-body">' + html + '</div></div></div>';
}
function refreshModal() {
  const holder = document.querySelector('#modal-root');
  if (holder) holder.innerHTML = modal ? modalContents() : '';
}
function showModal(type, title, values, previous = null) {
  closeCoverMenu();
  modal = {type, title, values, previous};
  refreshModal();
}
function closeModal() {
  if (modal) cancelCover(activeCoverDraft());
  modal = modal?.previous || null;
  refreshModal();
}
function closeCoverMenu(restoreFocus = false) {
  if (!coverMenuAnchor) return;
  const anchor = coverMenuAnchor;
  coverMenuAnchor = null;
  anchor.setAttribute('aria-expanded','false');
  const holder = document.querySelector('#cover-menu-root');
  if (holder) holder.innerHTML = '';
  if (restoreFocus && anchor.isConnected) anchor.focus({preventScroll:true});
}
function openCoverMenu(anchor) {
  if (modal || !anchor?.isConnected) return;
  closeCoverMenu();
  coverMenuAnchor = anchor;
  anchor.setAttribute('aria-expanded','true');
  const attrs = dataAttr('id',anchor.dataset.id) + ' ' + dataAttr('kind',anchor.dataset.coverMenu) + ' role="menuitem"';
  const holder = document.querySelector('#cover-menu-root');
  holder.innerHTML = '<div class="cover-menu-layer"><div class="cover-menu-scrim" data-action="dismiss-cover-menu"></div>' +
    '<div class="cover-menu" role="menu" aria-label="封面操作">' +
    button('编辑','cover-menu-edit','',attrs) + button('删除','cover-menu-delete','cover-menu-danger',attrs) + '</div></div>';
  const menu = holder.querySelector('.cover-menu');
  const edges = app.getBoundingClientRect();
  const rect = (anchor.querySelector('.cover-top') || anchor).getBoundingClientRect();
  const gap = 6;
  const leftEdge = edges.left + 8;
  const right = edges.right - menu.offsetWidth - 8;
  const bottom = edges.bottom - menu.offsetHeight - 8;
  const onRight = rect.right + gap <= right;
  const onLeft = rect.left - menu.offsetWidth - gap >= leftEdge;
  const left = onRight ? rect.right + gap : onLeft ? rect.left - menu.offsetWidth - gap :
    rect.left + (rect.width - menu.offsetWidth) / 2;
  const top = onRight || onLeft ? rect.top + (rect.height - menu.offsetHeight) / 2 :
    rect.bottom + gap <= bottom ? rect.bottom + gap : rect.top - menu.offsetHeight - gap;
  menu.style.left = Math.max(leftEdge, Math.min(left, right)) + 'px';
  menu.style.top = Math.max(edges.top + 8, Math.min(top, bottom)) + 'px';
  menu.querySelector('button').focus({preventScroll:true});
}
function cancelCoverHold() {
  if (!coverHold) return;
  clearTimeout(coverHold.timer);
  coverHold = null;
}
function openHeldCover(anchor) {
  cancelCoverHold();
  openCoverMenu(anchor);
  suppressHoldClick = coverMenuAnchor === anchor;
}
function coverPreviewSizes(header) {
  const compact = header.querySelector('.hero').offsetHeight;
  const available = header.closest('.detail-view').clientHeight;
  return {compact, full:Math.max(compact,Math.min(available,Math.round(header.clientWidth * 1.5)))};
}
function drawCoverPreview(header, amount, sizes = coverPreviewSizes(header)) {
  header.style.height = Math.round(sizes.compact + (sizes.full - sizes.compact) * amount) + 'px';
  header.style.setProperty('--cover-reveal', amount.toFixed(3));
}
function settleCoverPreview(header, expanded) {
  if (!header?.isConnected) return;
  const handle = header.querySelector('.cover-pull-handle');
  if (!handle) return;
  if (!header.style.height) {
    header.style.height = header.offsetHeight + 'px';
    header.getBoundingClientRect();
  }
  header.classList.remove('cover-pulling');
  header.classList.toggle('cover-expanded', expanded);
  handle.setAttribute('aria-expanded', String(expanded));
  handle.setAttribute('aria-label', expanded ? '收起封面' : '展开封面');
  header.querySelector('.detail-full-cover').setAttribute('aria-hidden', String(!expanded));
  drawCoverPreview(header, expanded ? 1 : 0);
}
let backFromDetail = 'library';
function render(keepScroll = false) {
  cancelCoverHold();
  closeCoverMenu();
  coverPull = null;
  const lastView = document.querySelector('.view');
  const oldScroll = keepScroll && lastView ? lastView.scrollTop : 0;
  const screens = {library, detail, edit: editScreen, stats: statistics, wishes: wishScreen, flow};
  app.innerHTML = overallDemo() + screens[page]() + '<div id="cover-menu-root"></div><div id="modal-root">' +
    (modal ? modalContents() : '') + '</div>';
  const view = document.querySelector('.view');
  if (view) view.scrollTop = oldScroll;
  const monthlyChart = document.querySelector('.monthly-chart');
  if (monthlyChart) {
    monthlyChart.nextElementSibling.hidden = monthlyChart.scrollWidth <= monthlyChart.clientWidth;
    monthlyChart.scrollLeft = monthlyChart.scrollWidth;
  }
}
function newForm(item) {
  return item ? {...item, platform:platformOf(item), priceText:cashInput(item.price),
    selected:true, more:true} : {id:'', name:'', platform:'ns1', region:'', priceText:'', location:'', condition:'',
    quality:'', date:today(), channel:'', barcode:'', cover:'', series:'', note:'', selected:false, more:false};
}
function patchItem(item, changes) {
  return commit({...state, items: state.items.map(entry => entry.id === item.id ? {...entry,...changes} : entry)});
}
function openItem(itemId, editing = false) {
  const item = itemBy(itemId);
  if (!isOwned(item) && item?.status !== 'sold') return;
  if (page === 'library') libraryScroll = document.querySelector('.view').scrollTop;
  backFromDetail = page;
  page = editing ? 'edit' : 'detail';
  current = itemId;
  if (editing) form = {...newForm(item),cancelTo:backFromDetail};
  modal = null;
  render();
  if (editing) findCover();
}
function confirmItemDeletion(item) {
  if (!item) return;
  if (outgoingLoan(item.id)) { notify('请先登记归还这张卡带'); return; }
  showModal('delete-item',item.status === 'sold' ? '删除已售卡带' : '删除卡带记录',{item});
}
function confirmWishDeletion(wishId) {
  const wish = state.wishes.find(entry => entry.id === wishId);
  if (wish) showModal('delete-wish','删除心愿',{wish},modal);
}
function openSaleEditor(item) {
  if (!item) return;
  const editing = item.status === 'sold';
  showModal('sell',editing ? '编辑售出' : '登记售出',{
    itemId:item.id, editing, priceText:cashInput(item.salePrice), saleShipping:cashInput(item.saleShipping), date:item.saleDate || today()});
}
function finishRecord(allowDuplicate = false) {
  const name = String(form.name || '').trim();
  if (!name) { document.querySelector('[data-field="name"]').focus(); return notify('请输入游戏名称'); }
  if (waitingForCover(form)) return;
  const amount = parsePrice(form.priceText);
  if (Number.isNaN(amount)) return notify('请输入正确的价格，最多两位小数');
  const wish = state.wishes.find(entry => entry.id === form.fromWish);
  if (form.fromWish && !wish) return notify('这条心愿已移除');
  const previous = itemBy(form.id);
  const key = collectionKey({...form,name});
  if (!allowDuplicate && (!previous || wish || key !== collectionKey(previous))) {
    const matches = owned().filter(item => item.id !== previous?.id && collectionKey(item) === key);
    if (matches.length) {
      document.activeElement?.blur();
      showModal('duplicate','已录入同款卡带',{items:matches});
      return;
    }
  }
  const nextNum = nextCollectionNumber();
  const record = {...previous,
    id: previous?.id || id(), number:previous?.number || nextNum, name,
    platform:form.platform, region:form.region, price:amount, date:form.date, channel:form.channel.trim(),
    location:form.location.trim(), condition:form.condition, quality:form.quality,
    barcode:form.barcode.trim(), ...coverFields(form), series:form.series.trim(), note:form.note.trim(),
    status:wish ? 'owned' : previous?.status || 'owned', progress:previous?.progress || 0, photos:previous?.photos || []};
  if (wish && previous) {
    record.pastPurchases = [...(previous.pastPurchases || []),{date:previous.date,price:previous.price}];
  }
  const items = previous ? state.items.map(item => item.id === previous.id ? record : item) : [...state.items,record];
  const loans = state.loans.map(loan => loan.itemId === record.id ? {...loan,game:name} : loan);
  const wishes = wish ? state.wishes.filter(entry => entry.id !== wish.id) : state.wishes;
  if (commit({...state,items,loans,wishes,nextNumber: previous ? nextNum : nextNum + 1})) {
    document.activeElement?.blur();
    modal = null;
    page = 'detail';
    current = record.id;
    if (wish) { backFromDetail = 'library'; filters = {}; query = ''; search = false; libraryScroll = 0; }
    form = null;
    render();
    notify(wish ? '已转入收藏库' : previous ? '卡带已更新' : '卡带已录入');
  }
}
function clearUndo() {
  clearTimeout(undoTimer);
  removedItem = null;
  undoBar.hidden = true;
}
function deleteRecord(itemId) {
  const item = itemBy(itemId);
  if (!item) return;
  if (outgoingLoan(item.id)) return notify('请先登记归还这张卡带');
  if (!commit({...state,items:state.items.filter(entry => entry.id !== item.id)})) return;
  modal = null;
  const fromDetail = page === 'detail';
  if (fromDetail) page = backFromDetail;
  current = '';
  render(!fromDetail);
  if (fromDetail && page === 'library') document.querySelector('.view').scrollTop = libraryScroll;
  clearUndo();
  removedItem = item;
  undoBar.querySelector('span').textContent = '已删除「' + item.name + '」';
  undoBar.hidden = false;
  undoTimer = setTimeout(clearUndo,10000);
}
undoBar.querySelector('button').addEventListener('click', () => {
  if (!removedItem || itemBy(removedItem.id)) { clearUndo(); return; }
  const record = state.items.some(item => item.number === removedItem.number)
    ? {...removedItem,number:nextCollectionNumber()} : removedItem;
  if (commit({...state,items:[...state.items,record],nextNumber:Math.max(nextCollectionNumber(),(Number(record.number) || 0) + 1)})) {
    clearUndo();
    render(true);
    notify('卡带已恢复');
  }
});
function sample() {
  const setup = [['雾岛物语','日','未拆',22900,0],['山间列车','港','裸卡',16900,25],
    ['星野邮局','美','未拆',20900,0],['山海旅人','国','裸卡',19300,80]];
  const items = setup.map(([name,region,condition,amount,progress],i) => ({
    ...newForm(null), id:'sample-item-' + (i+1), number: i+1, name,region,condition,price:amount,progress,
    cover:'sample' + (i+1),photos:[],status:'owned',platform:i === 3 ? 'ns2' : 'ns1', date:today([0,-12,-106,-386][i]),channel:'二手平台',
    location: '客厅 A 盒', series:i === 0 || i === 3 ? '山海系列' : '', barcode: i === 0 ? '4901234567894' : '',
    note: ''
  }));
  return {...emptyState(), items, nextNumber:5, targets:{山海系列:4}, reminders:true, loans:[
    {id:'sample-loan-1',itemId:items[1].id,game:items[1].name,person:'阿哲',start:today(-10),due:today(-3),returned:'',rent:1500},
    {id:'sample-loan-2',itemId:items[2].id,game:items[2].name,person:'小周',start:today(-4),due:today(4),returned:''},
    {id:'sample-borrow',direction:'in',game:'月光咖啡馆',platform:'ns2',person:'小林',start:today(-2),due:today(5),returned:'',rent:3550}],
    wishes:[{id:'sample-wish',name:items[3].name,region:'日',target:19900,reference:22900,cover:'sample4'}]};
}
function cashInput(value) { return Number.isInteger(value) ? String(value/100) : ''; }
function wishModal(wish = {}, move = false) {
  showModal('wish',move ? '移到心愿单' : wish.id ? '编辑心愿' : '添加心愿',{
    ...wish, move, draftId:wish.id || id(), name:wish.name || '', platform:platformOf(wish),
    region:wish.region || '', target:cashInput(wish.target), reference:cashInput(wish.reference)});
  findCover();
}
function buyWish(wish) {
  if (!wish) return;
  const previous = itemBy(wish.sourceItemId);
  const original = previous?.status === 'wished' ? previous : null;
  const platform = platformOf(wish);
  const knownTitle = catalog.find(entry => lower(entry[0]) === lower(wish.name) && (entry[3] || 'ns1') === platform);
  form = {...newForm(original), fromWish:wish.id, name:wish.name, selected:true, more:false,
    platform, region:wish.region || '', ...wishCover(wish), date:today(),
    series:knownTitle?.[1] || original?.series || '', priceText:cashInput(wish.reference ?? wish.target)};
  modal = null;
  page = 'edit';
  render();
  findCover();
}
function loanModal(item) {
  if (isOwned(item) && !outgoingLoan(item.id)) {
    showModal('loan','借出 · ' + item.name,{direction:'out',itemId:item.id,person:'',start:today(),due:today(7)});
  }
}
function editLoanModal(loan) {
  const borrowing = !loan || loan.direction === 'in';
  const title = !loan ? '登记借入' : borrowing ? '编辑借入' : '编辑借出';
  showModal('loan',title,{
    direction:borrowing ? 'in' : 'out', loanId:loan?.id || '', itemId:loan?.itemId,
    draftId:loan?.id || id(), game:loan?.game || '',
    platform:platformOf(loan || {}), person:loan?.person || '', rent:cashInput(loan?.rent), shipping:cashInput(loan?.shipping),
    start:loan?.start || today(), due:loan?.due || today(7), returned:loan?.returned || '',
    ...coverFields(loan), hasReturnDate:Boolean(loan?.returned)
  },modal);
  if (borrowing) findCover();
}
function validCode(value) { return value && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value); }
function scanCode(value) {
  if (!form || !validCode(value)) return;
  const previous = coverTitle(form);
  form.barcode = value;
  const known = state.items.find(item => item.barcode === value);
  if (known) {
    form.name = known.name;
    form.platform = platformOf(known);
    form.region = form.region || known.region;
    form.series = form.series || known.series;
    form.selected = true;
    notify('已带出本地匹配的游戏');
  } else {
    notify('条码已读取，请搜索或输入游戏名称');
  }
  closeModal();
  render(true);
  if (known) coverTitleChanged(form, previous);
}
function leaveDemo() {
  if (!liveState) return;
  clearUndo();
  state = liveState;
  liveState = null;
  page = 'library'; mode = state.preferences.flowMode; filters = {}; query = ''; search = false; modal = null;
  libraryScroll = 0;
  render();
}
window.appBack = function () {
  if (coverMenuAnchor) { closeCoverMenu(true); return true; }
  if (modal) { closeModal(); return true; }
  if (page === 'edit') {
    cancelCover(form);
    const cancelTo = form.cancelTo;
    page = cancelTo || (form.fromWish ? 'wishes' : form.id ? 'detail' : 'library');
    form = null;
    render();
    if (cancelTo === 'library') document.querySelector('.view').scrollTop = libraryScroll;
    return true;
  }
  if (page === 'detail') {
    const expanded = app.querySelector('.detail-cover-header.cover-expanded');
    if (expanded) { settleCoverPreview(expanded,false); return true; }
    page = backFromDetail;
    render();
    if (page === 'library') document.querySelector('.view').scrollTop = libraryScroll;
    return true;
  }
  if (page !== 'library') {
    if (state.preferences.resumeFlow) savePreference('resumeFlow',false);
    page = 'library';
    render();
    return true;
  }
  if (search) { query = ''; search = false; render(); return true; }
  if (liveState) { leaveDemo(); return true; }
  return false;
};
window.nativeEvent = function (type, value) {
  switch (type) {
    case 'cover-found':
    case 'cover-downloaded':
    case 'cover-error':
      acceptCoverEvent(type, JSON.parse(value));
      break;
    case 'cover-library-updated':
    case 'cover-library-error':
      coverLibraryRefreshing = false;
      if (modal?.type === 'settings') refreshModal();
      notify(type === 'cover-library-updated' ? '封面库已刷新' : coverErrorMessage(value));
      break;
    case 'cover-token':
      coverTokenReady = value === 'saved';
      findCover();
      if (modal?.type === 'settings') refreshModal();
      refreshCoverPanel(activeCoverDraft());
      notify(coverTokenReady ? '封面站令牌已保存' : '封面站令牌已移除');
      break;
    case 'message': notify(value); break;
    case 'flow':
      page = 'flow'; mode = value === 'in' ? 'in' : 'out'; modal = null; render(); break;
    case 'barcode': scanCode(value); break;
    case 'notificationDenied':
      if (!liveState && commit({...state,reminders:false})) render(true);
      notify('允许系统通知后，才能收到归还提醒');
      break;
    case 'photo': {
      const payload = JSON.parse(value);
      if (payload.slot === 'cover' && page === 'edit' && form.id === payload.item) {
        cancelCover(form);
        form.autoCover = false;
        form.cover = payload.name;
        form.coverSource = undefined;
        render(true);
        notify('封面已添加');
      } else if (((payload.slot === 'wish' && modal?.type === 'wish') ||
                  (payload.slot === 'borrow' && modal?.type === 'loan' && modal.values.direction === 'in')) &&
                 modal.values.draftId === payload.item) {
        cancelCover(modal.values);
        modal.values.autoCover = false;
        modal.values.cover = payload.name;
        modal.values.coverSource = undefined;
        refreshModal();
        notify('封面已添加');
      } else if (payload.slot === 'detail') {
        const item = itemBy(payload.item);
        if (item && (item.photos || []).length < 12 &&
            patchItem(item,{photos:[...(item.photos || []),payload.name]})) {
          render(true);
          notify('实拍已保存');
        }
      }
      break;
    }
    case 'import':
      showModal('replace','预览备份恢复',{data:shape(JSON.parse(value))},modal);
      break;
    case 'csv-import':
      try { showModal('csv-preview','预览 CSV 导入',{data:parseCollectionCsv(value)},modal); }
      catch (error) { notify(error.message || '无法读取这份 CSV'); }
      break;
  }
};
function saveLoan(values) {
  const borrowing = values.direction === 'in';
  const person = values.person.trim();
  const existing = values.loanId && state.loans.find(loan => loan.id === values.loanId);
  if (values.loanId && !existing) return notify('这条借还记录已移除');
  const item = itemBy(values.itemId);
  if (!person) return notify('请输入对方的称呼');
  if (!values.start || values.start > today()) return notify('请选择有效的借用日期');
  if (!values.due || values.due < values.start) return notify('应还日期应在借用日期当天或之后');
  const returned = values.returned || '';
  if (existing?.returned && (!returned || returned < values.start || returned > today()))
    return notify('归还日期应在借用日期和今天之间');
  if (!borrowing && !existing && (!isOwned(item) || outgoingLoan(item.id))) return notify('这张卡带当前无法登记借出');
  const game = borrowing ? values.game.trim() : item?.name || existing?.game;
  if (!game) return notify('请输入游戏名称');
  if (borrowing && waitingForCover(values)) return;
  const rent = parsePrice(values.rent);
  if (Number.isNaN(rent)) return notify('请输入正确的租金，最多两位小数');
  const shipping = parsePrice(values.shipping);
  if (Number.isNaN(shipping)) return notify('请输入正确的运费，最多两位小数');
  const loan = {...existing, id:existing?.id || id(), direction:values.direction, game, person,
    start:values.start, due:values.due, returned, platform:borrowing ? values.platform : platformOf(item || existing), rent, shipping};
  if (item) loan.itemId = item.id;
  if (borrowing) Object.assign(loan, coverFields(values));
  const loans = existing ? state.loans.map(entry => entry.id === loan.id ? loan : entry) : [...state.loans,loan];
  if (commit({...state,loans})) {
    modal = modal.previous || null;
    render(true);
    notify(existing ? '借还记录已更新' : borrowing ? '已登记借入' : '已登记借出');
  }
}
function saveWish(values) {
  const name = values.name.trim();
  if (!name) return notify('请输入游戏名称');
  if (waitingForCover(values)) return;
  const target = parsePrice(values.target), reference = parsePrice(values.reference);
  if (Number.isNaN(target) || Number.isNaN(reference)) return notify('请输入有效的目标价和参考价');
  const original = itemBy(values.sourceItemId);
  if (values.move && (!isOwned(original) || outgoingLoan(original.id)))
    return notify('这张卡带当前无法移到心愿单');
  const wish = {id:values.id || values.draftId, name, platform:values.platform, region:values.region,
    target, reference, ...coverFields(values), sourceItemId:values.sourceItemId || ''};
  const wishes = values.id ? state.wishes.map(entry => entry.id === wish.id ? wish : entry) : [...state.wishes,wish];
  const items = values.move ? state.items.map(item =>
    item.id === original.id ? {...item,status:'wished'} : item) : state.items;
  if (commit({...state,items,wishes})) {
    if (values.move) { page = 'wishes'; current = ''; }
    modal = null;
    render(true);
    notify(values.move ? '已移到心愿单' : '心愿已保存');
  }
}
function backupPlan(incoming) {
  const ids = new Set(state.items.map(item => item.id));
  const numbers = new Set(state.items.map(item => item.number));
  const added = {items:[], wishes:[], loans:[]};
  const skipped = [];
  let nextNumber = nextCollectionNumber();
  for (const item of incoming.items) {
    if (ids.has(item.id)) { skipped.push({group:'卡带',name:item.name}); continue; }
    let number = item.number;
    if (!Number.isInteger(number) || number < 1 || numbers.has(number)) number = nextNumber++;
    numbers.add(number);
    nextNumber = Math.max(nextNumber,number + 1);
    added.items.push({...item,number});
  }
  const items = [...state.items,...added.items];
  const wishIds = new Set(state.wishes.map(wish => wish.id));
  for (const wish of incoming.wishes) {
    if (wishIds.has(wish.id)) skipped.push({group:'心愿',name:wish.name});
    else added.wishes.push(wish);
  }
  const loanIds = new Set(state.loans.map(loan => loan.id));
  const activeIds = new Set(loansFor('out').filter(loan => !loan.returned).map(loan => loan.itemId));
  const available = new Set(items.filter(isOwned).map(item => item.id));
  for (const loan of incoming.loans) {
    const lending = loan.direction !== 'in' && !loan.returned;
    if (loanIds.has(loan.id) || (lending && (!available.has(loan.itemId) || activeIds.has(loan.itemId)))) {
      skipped.push({group:'借还',name:loan.game || '卡带'});
      continue;
    }
    added.loans.push(loan);
    if (lending) activeIds.add(loan.itemId);
  }
  const next = {...state,items,nextNumber,wishes:[...state.wishes,...added.wishes],
    loans:[...state.loans,...added.loans],targets:{...incoming.targets,...state.targets}};
  return {next,added,skipped};
}
function mergeBackup(incoming) {
  const {next,added} = backupPlan(incoming);
  if (commit(next)) {
    modal = null;
    render(true);
    notify('备份已恢复 · 新增 ' + added.items.length + ' 条卡带记录');
  }
}
function csvImportPlan(data) {
  const known = new Set(state.items.map(collectionKey));
  const fresh = [], duplicates = [];
  for (const card of data.cards) {
    const key = collectionKey(card);
    if (known.has(key)) duplicates.push(card);
    else { fresh.push(card); known.add(key); }
  }
  return {fresh,duplicates};
}
function importCsvCards(data, includeDuplicates) {
  const {fresh,duplicates} = csvImportPlan(data);
  const incoming = includeDuplicates ? data.cards : fresh;
  if (!incoming.length) return;
  let nextNumber = nextCollectionNumber();
  const items = [...state.items,...incoming.map(card => ({...card,id:id(),number:nextNumber++}))];
  if (commit({...state,items,nextNumber})) {
    modal = null;
    filters = {}; search = false; query = '';
    render();
    const skipped = includeDuplicates ? 0 : duplicates.length;
    notify('已导入 ' + incoming.length + ' 张卡带' + (skipped ? '，跳过 ' + skipped + ' 张同款' : ''));
  }
}
function photoChoice(camera) {
  const {slot,item} = modal.values;
  closeModal();
  if (!native) return notify('请在手机 App 内选择照片');
  native.photo(slot,item,camera);
}
function setChip(key, value) {
  form[key] = form[key] === value && key !== 'platform' ? '' : value;
  const group = 'set-' + key;
  document.querySelectorAll('[data-action="' + group + '"]').forEach(target => {
    const selected = target.dataset.value === form[key];
    target.classList.toggle('active', selected);
    target.setAttribute('aria-pressed', selected);
  });
}
app.addEventListener('click', event => {
  if (suppressHoldClick && event.detail) { suppressHoldClick = false; event.preventDefault(); return; }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const {action, value, id:itemId} = control.dataset;
  const item = itemBy(current);
  const values = modal?.values;
  switch (action) {
    case 'dismiss-cover-menu': closeCoverMenu(true); break;
    case 'cover-menu-edit': {
      closeCoverMenu();
      if (control.dataset.kind === 'wish') {
        const wish = state.wishes.find(entry => entry.id === itemId);
        if (wish) wishModal(wish);
      } else {
        const target = itemBy(itemId);
        if (target?.status === 'sold') openSaleEditor(target);
        else openItem(itemId, true);
      }
      break;
    }
    case 'cover-menu-delete':
      closeCoverMenu();
      if (control.dataset.kind === 'wish') confirmWishDeletion(itemId);
      else confirmItemDeletion(itemBy(itemId));
      break;
    case 'toggle-detail-cover': {
      const header = control.closest('.detail-cover-header');
      settleCoverPreview(header, !header.classList.contains('cover-expanded'));
      break;
    }
    case 'tab': {
      const target = control.dataset.page;
      const resumeFlow = target === 'flow';
      if (state.preferences.resumeFlow !== resumeFlow) savePreference('resumeFlow',resumeFlow);
      modal = null;
      page = target;
      render();
      break;
    }
    case 'back': window.appBack(); break;
    case 'close-modal': closeModal(); break;
    case 'search-toggle':
      search = !search; if (!search) query = ''; render(); document.querySelector('#library-search')?.focus(); break;
    case 'search-clear':
      query = ''; render(true); document.querySelector('#library-search')?.focus(); break;
    case 'filter': showModal('filter','筛选收藏',{...filters}); break;
    case 'sort': showModal('sort','收藏排序'); break;
    case 'wish-sort': showModal('wish-sort','心愿单排序'); break;
    case 'settings': showModal('settings','设置与备份'); break;
    case 'cover-token': native?.configureCover?.(); break;
    case 'refresh-cover-library':
      if (coverTokenReady && !coverLibraryRefreshing) {
        coverLibraryRefreshing = true;
        refreshModal();
        native.refreshCoverLibrary();
      }
      break;
    case 'refresh-current-cover': refreshCurrentCover(); break;
    case 'find-cover': findCover(true); break;
    case 'skip-cover': cancelCover(activeCoverDraft()); break;
    case 'choose-cover':
      if (coverRequest?.phase === 'choose' && coverRequest.draft === activeCoverDraft()) {
        downloadCover(coverRequest.candidates[Number(value)]);
      }
      break;
    case 'apply-filter': filters = {...values}; modal = null; render(); break;
    case 'clear-filter': filters = {}; modal = null; render(); break;
    case 'apply-sort':
    case 'apply-wish-sort':
      if (savePreference(action === 'apply-sort' ? 'collectionSort' : 'wishSort',value)) {
        modal = null;
        render();
      }
      break;
    case 'demo':
      if (liveState) break;
      clearUndo();
      liveState = state; state = sample(); mode = state.preferences.flowMode; page = 'library'; search = false; query = ''; filters = {}; modal = null; render(); break;
    case 'demo-off': leaveDemo(); break;
    case 'export':
      if (liveState) { notify('先退出示例，再导出自己的记录'); break; }
      showModal('export-format','选择导出格式',{},modal);
      break;
    case 'export-zip':
    case 'export-csv':
    case 'import':
    case 'import-csv':
      if (liveState) { notify('先退出示例，再处理自己的记录'); break; }
      if (!native) { notify('请在手机 App 里选择文件'); break; }
      modal = null;
      refreshModal();
      if (action === 'export-csv') native.exportCsv(makeCollectionCsv(state));
      else if (action === 'import-csv') native.importCsv();
      else native.backup(action === 'export-zip');
      break;
    case 'merge-csv': importCsvCards(values.data,false); break;
    case 'merge-csv-all': importCsvCards(values.data,true); break;
    case 'merge-backup': mergeBackup(values.data); break;
    case 'detail': openItem(itemId); break;
    case 'add':
      backFromDetail = 'library'; form = newForm(null); page = 'edit'; render(); break;
    case 'edit':
      if (item) { form = newForm(item); page = 'edit'; render(); findCover(); }
      break;
    case 'show-more': form.more = true; render(true); break;
    case 'scan':
      document.activeElement?.blur();
      if (native) native.scan(); else showModal('barcode','输入条码',{code:form.barcode});
      break;
    case 'save-barcode':
      if (validCode(values.code.trim())) scanCode(values.code.trim());
      else notify('请输入有效的包装条码');
      break;
    case 'select-modal-title': {
      const key = modal.type === 'wish' ? 'name' : 'game';
      const previous = coverTitle(values);
      document.activeElement?.blur();
      values[key] = control.dataset.name;
      values.platform = control.dataset.platform;
      values.suggestTitle = false;
      refreshModal();
      coverTitleChanged(values, previous);
      break;
    }
    case 'select-title': {
      const previous = coverTitle(form);
      document.activeElement?.blur();
      form.name = control.dataset.name; form.series = control.dataset.series;
      form.platform = control.dataset.platform;
      form.selected = true; render(true);
      coverTitleChanged(form, previous);
      break;
    }
    case 'clear-title':
      cancelCover(form);
      if (form.autoCover) { form.cover = ''; form.coverSource = undefined; form.autoCover = false; }
      form.name = ''; form.selected = false;
      render(true); document.querySelector('[data-field="name"]').focus(); break;
    case 'set-platform':
      setChip('platform',value);
      document.querySelector('#suggestions').innerHTML = resultList();
      break;
    case 'set-region': setChip('region',value); break;
    case 'set-condition': setChip('condition',value); break;
    case 'save-item': finishRecord(); break;
    case 'save-duplicate': finishRecord(true); break;
    case 'delete-item': confirmItemDeletion(item); break;
    case 'confirm-delete-item': deleteRecord(values.item.id); break;
    case 'form-cover':
      cancelCover(form);
      showModal('photo','选择封面',{slot:'cover',item:form.id});
      break;
    case 'add-photo': showModal('photo','添加实拍',{slot:'detail',item:current}); break;
    case 'take-photo': photoChoice(true); break;
    case 'pick-photo': photoChoice(false); break;
    case 'view-photo': showModal('preview','实拍照片',{name:value,canRemove:(item.photos || []).includes(value)}); break;
    case 'remove-photo': showModal('remove-photo','移除实拍照片',{itemId:item.id,name:values.name},modal); break;
    case 'confirm-remove-photo': {
      const target = itemBy(values.itemId);
      if (target && patchItem(target,{photos:(target.photos || []).filter(name => name !== values.name)})) {
        modal = null;
        render(true);
      }
      break;
    }
    case 'progress': showModal('progress','更新游玩进度',{progress:item.progress || 0}); break;
    case 'save-progress':
      if (patchItem(item,{progress:Number(values.progress)})) { modal = null; render(true); notify('进度已更新'); }
      break;
    case 'series-target': {
      const count = catalog.filter(entry => entry[1] === value).length;
      showModal('series',value + ' · 系列目标',{series:value,target:state.targets[value] || count || ''});
      break;
    }
    case 'save-series': {
      const target = Number(values.target);
      if (!Number.isInteger(target) || target < 1 || target > 999) { notify('请输入 1 到 999 之间的目标数'); break; }
      if (commit({...state,targets:{...state.targets,[values.series]:target}})) { modal = null; render(true); }
      break;
    }
    case 'backlog': showModal('backlog','吃灰提醒'); break;
    case 'flow-mode':
      if (commit({...state,preferences:{...state.preferences,flowMode:value,resumeFlow:true}})) {
        mode = value;
        render();
      }
      break;
    case 'loan': loanModal(item); break;
    case 'borrow': editLoanModal(); break;
    case 'edit-borrow':
    case 'edit-loan': {
      const loan = state.loans.find(entry => entry.id === itemId);
      if (loan) editLoanModal(loan);
      break;
    }
    case 'loan-contacts': showModal('loan-contacts','按人查看借还'); break;
    case 'person-loans': {
      const person = loanContacts().get(value);
      if (person) showModal('person-loans',person.name + '的借还记录',{key:value},modal);
      break;
    }
    case 'pick-loan': showModal('pick-loan','选择借出的卡带'); break;
    case 'choose-loan': loanModal(itemBy(itemId)); break;
    case 'save-loan': saveLoan(values); break;
    case 'delete-loan': {
      const loan = state.loans.find(entry => entry.id === values.loanId);
      if (loan) showModal('delete-loan',loan.direction === 'in' ? '删除借入记录' : '删除借出记录',{loan},modal);
      break;
    }
    case 'confirm-delete-loan':
      if (commit({...state,loans:state.loans.filter(loan => loan.id !== values.loan.id)})) {
        modal = modal.previous?.previous || null;
        render(true);
        notify(values.loan.direction === 'in' ? '借入记录已删除' : '借出记录已删除');
      }
      break;
    case 'edit-rent': {
      const loan = state.loans.find(entry => entry.id === itemId);
      if (loan) {
        modal = {type:'rent', title:'租金 · ' + loan.game,
          values:{loanId:loan.id, rent:cashInput(loan.rent), borrowing:loan.direction === 'in'}, previous:modal};
        refreshModal();
      }
      break;
    }
    case 'save-rent': {
      const rent = parsePrice(values.rent);
      if (Number.isNaN(rent)) { notify('请输入正确的租金，最多两位小数'); break; }
      const loans = state.loans.map(loan => loan.id === values.loanId ? {...loan,rent} : loan);
      if (commit({...state,loans})) {
        modal = modal.previous || null;
        render(true);
        notify('租金已更新');
      }
      break;
    }
    case 'return': {
      const loan = state.loans.find(entry => entry.id === itemId && !entry.returned);
      if (loan) showModal('return','归还 · ' + loan.game,{loanId:loan.id,date:today(),start:loan.start},modal);
      break;
    }
    case 'save-return':
      if (!values.date || values.date < values.start || values.date > today()) { notify('请选择有效的归还日期'); break; }
      if (commit({...state,loans:state.loans.map(loan => loan.id === values.loanId ? {...loan,returned:values.date} : loan)})) {
        modal = modal.previous || null; render(true); notify('已登记归还');
      }
      break;
    case 'history': showModal('history',mode === 'in' ? '借入归还历史' : '借出归还历史'); break;
    case 'toggle-reminder': {
      const reminders = !state.reminders;
      if (commit({...state,reminders})) {
        render(true);
        if (reminders && !liveState && native) native.enableNotifications();
      }
      break;
    }
    case 'add-wish': wishModal(); break;
    case 'edit-wish': wishModal(state.wishes.find(wish => wish.id === itemId)); break;
    case 'wish-cover':
    case 'borrow-cover': {
      cancelCover(values);
      const previous = modal;
      const slot = action === 'borrow-cover' ? 'borrow' : 'wish';
      modal = {type:'photo',title:'选择封面',values:{slot,item:values.draftId},previous};
      refreshModal();
      break;
    }
    case 'clear-borrow-cover': showModal('clear-borrow-cover','移除借入封面',{},modal); break;
    case 'confirm-clear-borrow-cover': {
      const loanDraft = modal.previous?.previous;
      if (loanDraft?.type !== 'loan') break;
      Object.assign(loanDraft.values,{cover:'',coverSource:undefined,autoCover:false});
      modal = loanDraft;
      refreshModal();
      break;
    }
    case 'move-to-wish':
      if (isOwned(item) && !outgoingLoan(item.id)) {
        wishModal({name:item.name, platform:platformOf(item), region:item.region, ...coverFields(item),
          target:item.price, sourceItemId:item.id}, true);
      }
      break;
    case 'buy-wish': buyWish(state.wishes.find(wish => wish.id === itemId)); break;
    case 'save-wish': saveWish(values); break;
    case 'delete-wish': confirmWishDeletion(values.id); break;
    case 'confirm-delete-wish': {
      const target = state.wishes.find(wish => wish.id === values.wish.id);
      if (!target) break;
      const wishes = state.wishes.filter(wish => wish.id !== target.id);
      const items = state.items.map(entry => entry.id === target.sourceItemId && entry.status === 'wished' &&
        !wishes.some(wish => wish.sourceItemId === entry.id) ? {...entry,status:'archived'} : entry);
      if (commit({...state,items,wishes})) { modal = null; render(true); notify('心愿已删除'); }
      break;
    }
    case 'sell': openSaleEditor(item); break;
    case 'save-sell': {
      const salePrice = parsePrice(values.priceText);
      const saleShipping = parsePrice(values.saleShipping);
      if (Number.isNaN(salePrice) || !values.date) { notify('请检查售出价格和日期'); break; }
      if (Number.isNaN(saleShipping)) { notify('请输入正确的售出运费，最多两位小数'); break; }
      const target = itemBy(values.itemId);
      if (target && patchItem(target,{status:'sold',salePrice,saleShipping,saleDate:values.date})) {
        modal = null;
        render(true);
        notify(values.editing ? '售出记录已更新' : '已登记售出');
      }
      break;
    }
    case 'unsell': showModal('unsell','恢复到收藏库',{itemId:item.id}); break;
    case 'confirm-unsell': {
      const target = itemBy(values.itemId);
      if (target?.status === 'sold' && patchItem(target,{status:'owned',salePrice:null,saleShipping:null,saleDate:''})) {
        modal = null;
        render(true);
        notify('已恢复到收藏库');
      }
      break;
    }
  }
});
function updateInput(event) {
  const input = event.target;
  if (event.isComposing) return;
  if (input.id === 'library-search') {
    query = input.value.trim();
    document.querySelector('#library-items').innerHTML = collectionGrid();
  } else if (input.dataset.field && form) {
    const previous = coverTitle(form);
    form[input.dataset.field] = input.value;
    if (input.dataset.field === 'name') {
      form.selected = false;
      document.querySelector('#suggestions').innerHTML = resultList();
      coverTitleChanged(form, previous);
    }
  } else if (input.dataset.modalField && modal?.values) {
    const key = input.dataset.modalField;
    const previous = coverTitle(modal.values);
    modal.values[key] = input.value;
    const suggestions = document.querySelector('#modal-title-suggestions');
    if (suggestions) {
      const titleKey = modal.type === 'wish' ? 'name' : 'game';
      if (key === titleKey) modal.values.suggestTitle = true;
      if (key === titleKey) coverTitleChanged(modal.values, previous);
      if ((key === titleKey || key === 'platform') && modal.values.suggestTitle) {
        suggestions.innerHTML = titleSuggestions(modal.values[titleKey], modal.values.platform, 'select-modal-title');
      }
    }
    if (modal.type === 'progress') document.querySelector('#percent').textContent = input.value + '%';
  }
}
app.addEventListener('input', updateInput);
app.addEventListener('compositionend', updateInput);
app.addEventListener('change', event => {
  if (event.target.matches('select, input[type=date]')) updateInput(event);
});
app.addEventListener('pointerdown', event => {
  cancelCoverHold();
  if (!event.isPrimary) return;
  suppressHoldClick = false;
  const anchor = event.target.closest('[data-cover-menu]');
  if (!anchor || modal || event.button !== 0) return;
  coverHold = {id:event.pointerId,x:event.clientX,y:event.clientY,timer:setTimeout(() => openHeldCover(anchor),500)};
});
window.addEventListener('pointermove', event => {
  if (coverHold?.id === event.pointerId && Math.hypot(event.clientX - coverHold.x,event.clientY - coverHold.y) > 12) cancelCoverHold();
});
for (const eventName of ['pointerup','pointercancel']) {
  window.addEventListener(eventName, event => { if (coverHold?.id === event.pointerId) cancelCoverHold(); });
}
app.addEventListener('contextmenu', event => {
  const anchor = event.target.closest('[data-cover-menu]');
  if (!anchor) return;
  event.preventDefault();
  if (coverMenuAnchor !== anchor) openHeldCover(anchor);
});
app.addEventListener('scroll', () => { cancelCoverHold(); closeCoverMenu(); }, {capture:true,passive:true});

app.addEventListener('touchstart', event => {
  if (coverPull?.sizes) settleCoverPreview(coverPull.header,coverPull.expanded);
  coverPull = null;
  if (modal || event.touches.length !== 1 || event.target.closest('button,input,select,textarea')) return;
  const view = event.target.closest('.detail-view');
  if (!view || view.scrollTop > 2) return;
  const header = view.querySelector('.detail-cover-header');
  if (!header?.querySelector('.detail-full-cover')) return;
  const touch = event.changedTouches[0];
  coverPull = {header,id:touch.identifier,x:touch.clientX,y:touch.clientY,expanded:header.classList.contains('cover-expanded')};
}, {passive:true});
app.addEventListener('touchmove', event => {
  if (!coverPull) return;
  const pull = coverPull;
  const touch = Array.from(event.changedTouches).find(entry => entry.identifier === pull.id);
  if (!touch) return;
  const vertical = touch.clientY - pull.y;
  if (!pull.sizes) {
    const horizontal = Math.abs(touch.clientX - pull.x);
    if (horizontal > 9 && horizontal > Math.abs(vertical)) { coverPull = null; return; }
    if (Math.abs(vertical) < 5) return;
    if (vertical * (pull.expanded ? -1 : 1) <= 0 || !event.cancelable) { coverPull = null; return; }
    pull.sizes = coverPreviewSizes(pull.header);
    pull.header.classList.add('cover-pulling');
  }
  if (event.cancelable) event.preventDefault();
  pull.travel = vertical * (pull.expanded ? -1 : 1);
  const distance = Math.max(1, pull.sizes.full - pull.sizes.compact);
  const progress = Math.max(0,Math.min(1,1.55 * pull.travel / distance));
  drawCoverPreview(pull.header, pull.expanded ? 1 - progress : progress, pull.sizes);
}, {passive:false});
for (const eventName of ['touchend','touchcancel']) {
  app.addEventListener(eventName, event => {
    const pull = coverPull;
    if (!pull || !Array.from(event.changedTouches).some(touch => touch.identifier === pull.id)) return;
    coverPull = null;
    if (pull.sizes) settleCoverPreview(pull.header, eventName === 'touchend' && pull.travel >= 55 ? !pull.expanded : pull.expanded);
  }, {passive:true});
}
app.addEventListener('transitionend', event => {
  const header = event.target;
  if (event.propertyName === 'height' && header.matches('.detail-cover-header:not(.cover-expanded):not(.cover-pulling)')) {
    header.style.removeProperty('height');
  }
});
window.addEventListener('resize', () => {
  closeCoverMenu();
  const header = app.querySelector('.detail-cover-header');
  if (!header || coverPull) return;
  if (header.classList.contains('cover-expanded')) drawCoverPreview(header,1);
  else header.style.removeProperty('height');
});
app.addEventListener('keydown', event => {
  if (event.key === 'Escape' && window.appBack()) event.preventDefault();
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const anchor = event.target.closest('[data-cover-menu]');
    if (anchor) { event.preventDefault(); openCoverMenu(anchor); }
  }
  if (coverMenuAnchor && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const buttons = Array.from(app.querySelectorAll('.cover-menu [role="menuitem"]'));
    const current = buttons.indexOf(document.activeElement);
    buttons[(current + 1) % buttons.length]?.focus({preventScroll:true});
  }
  if (event.key === 'Enter' && event.target.dataset.field === 'name') {
    event.target.blur();
    event.preventDefault();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !modal && (page === 'flow' || page === 'stats')) render(true);
});
render();
if (state.readError) notify('收藏读取失败，请重启卡带盒后重试');
