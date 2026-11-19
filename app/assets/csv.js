'use strict';

const tableColumns = [
  ['kind','记录类型'], ['name','游戏名称'], ['platform','平台'], ['region','区域'],
  ['status','收藏状态'], ['number','卡带编号'], ['price','入手价'], ['date','入手日期'],
  ['channel','购入渠道'], ['condition','盒卡状态'], ['quality','成色'], ['location','收纳位置'],
  ['series','系列'], ['progress','游玩进度'], ['barcode','条码'], ['note','备注'],
  ['salePrice','售出价'], ['saleShipping','售出运费'], ['saleDate','售出日期'], ['target','目标价'], ['reference','参考价'],
  ['person','借还对象'], ['start','借用日期'], ['due','应还日期'], ['returned','归还日期'], ['rent','租金'], ['shipping','运费']
];
const csvAliases = {
  '游戏名':'name','卡带名称':'name','名称':'name','title':'name','name':'name',
  '价格':'price','购入价格':'price','购入价':'price','入手价格':'price','price':'price',
  '购入日期':'date','购买日期':'date','日期':'date','date':'date',
  '版本':'region','版本地区':'region','地区':'region','region':'region',
  '机型':'platform','主机':'platform','platform':'platform',
  '出手价':'salePrice','出手日期':'saleDate','位置':'location','状态':'state','购买渠道':'channel','barcode':'barcode','备注信息':'note'
};
const csvStatus = {owned:'在库',sold:'已售',wished:'已移到心愿单',archived:'已归档'};

function csvCell(value, key) {
  let text = String(value ?? '');
  if (/^[\t\r\n]|^\s*[=+\-@]/.test(text) || (key === 'barcode' && /^\d+$/.test(text))) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
}
function makeCollectionCsv(data) {
  const rows = [];
  const itemsById = new Map(data.items.map(item => [item.id,item]));
  for (const item of data.items) {
    const common = {name:item.name,platform:platforms[platformOf(item)],region:item.region,number:item.number};
    for (const purchase of item.pastPurchases || []) {
      rows.push({...common,kind:'历史购入',price:cashInput(purchase.price),date:purchase.date});
    }
    rows.push({...item,...common,kind:'卡带',status:csvStatus[item.status] || csvStatus.owned,
      price:cashInput(item.price),salePrice:cashInput(item.salePrice),saleShipping:cashInput(item.saleShipping)});
  }
  for (const wish of data.wishes) {
    rows.push({...wish,kind:'心愿',platform:platforms[platformOf(wish)],target:cashInput(wish.target),reference:cashInput(wish.reference)});
  }
  for (const loan of data.loans) {
    const item = itemsById.get(loan.itemId);
    rows.push({...loan,kind:loan.direction === 'in' ? '借入' : '借出',name:loan.game,
      number:item?.number,platform:platforms[platformOf(item || loan)],rent:cashInput(loan.rent),shipping:cashInput(loan.shipping)});
  }
  return '\uFEFF' + tableColumns.map(([,label]) => csvCell(label)).join(',') + '\r\n' +
    rows.map(row => tableColumns.map(([key]) => csvCell(row[key],key)).join(',')).join('\r\n') + '\r\n';
}

function csvRows(text) {
  const input = text.replace(/^\uFEFF/,'');
  const rows = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char !== '"') value += char;
      else if (input[index + 1] === '"') { value += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === ',') {
      cells.push(value);
      value = '';
      closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      rows.push([...cells,value]);
      cells = [];
      value = '';
      closed = false;
    } else if (char === '"' && !closed && !value) quoted = true;
    else if (char === '"' || closed) throw new Error('表格引号格式有误');
    else value += char;
  }
  if (quoted) throw new Error('表格引号格式有误');
  if (cells.length || value || closed) rows.push([...cells,value]);
  return rows;
}
function csvDate(value) {
  if (!value) return '';
  const match = value.normalize('NFKC').match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!match) return null;
  const normalized = match[1] + '-' + match[2].padStart(2,'0') + '-' + match[3].padStart(2,'0');
  const parsed = new Date(normalized + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0,10) === normalized ? normalized : null;
}
function csvCard(values) {
  const {name} = values;
  if (!name || name.length > 120) throw new Error('游戏名称为空或太长');
  const platformText = lower(values.platform);
  let platform = 'ns1';
  if (['ns2','switch2','nintendoswitch2','switch2edition'].includes(platformText)) platform = 'ns2';
  else if (platformText && !['ns','ns1','switch','nintendoswitch'].includes(platformText)) throw new Error('平台无法识别');
  const regionText = (values.region || '').replace(/版$/,'');
  const regionAliases = {日本:'日',香港:'港',美国:'美',国行:'国',欧洲:'欧'};
  const region = regions.includes(regionText) ? regionText :
    Object.prototype.hasOwnProperty.call(regionAliases,regionText) ? regionAliases[regionText] : regionText ? '其他' : '';
  const amount = value => {
    const text = String(value || '').normalize('NFKC').replace(/元$/,'').trim();
    if (text.includes(',') && !/^[¥￥]?\s*\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) return NaN;
    return parsePrice(text.replace(/,/g,''));
  };
  const statusLabel = values.status || values.state;
  const status = Object.keys(csvStatus).find(key => csvStatus[key] === statusLabel) || (['已出','售出'].includes(statusLabel) ? 'sold' : 'owned');
  const price = amount(values.price), salePrice = amount(values.salePrice);
  const saleShipping = amount(values.saleShipping || (status === 'sold' ? values.shipping : ''));
  if ([price,salePrice,saleShipping].some(Number.isNaN)) throw new Error('价格或售出运费格式有误');
  const date = csvDate(values.date), saleDate = csvDate(values.saleDate);
  if (date === null || saleDate === null) throw new Error('日期格式有误');
  const condition = values.condition || (conditions.includes(values.state) ? values.state : '');
  const progress = Number(String(values.progress || 0).replace(/%$/,''));
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('游玩进度应为 0 到 100');
  const text = (key,limit) => (values[key] || '').slice(0,limit);
  return {name,platform,region,price,date,status,salePrice,saleShipping,saleDate,progress,
    channel:text('channel',120),condition:condition.slice(0,40),quality:text('quality',40),location:text('location',80),
    series:text('series',60),barcode:text('barcode',101).replace(/^'(?=\d+$)/,''),note:text('note',1000),cover:'',photos:[]};
}
function parseCollectionCsv(text) {
  const rows = csvRows(text);
  const headers = new Map(tableColumns.map(([key,label]) => [lower(label),key]));
  for (const [label,key] of Object.entries(csvAliases)) headers.set(lower(label),key);
  const columns = (rows.shift() || []).map(value => headers.get(lower(value)));
  if (!columns.includes('name')) throw new Error('CSV 第一行需要有「游戏名称」或「游戏名」列');
  const cards = [], errors = [];
  let nonCards = 0;
  for (const [index,cells] of rows.entries()) {
    if (cells.every(cell => !cell.trim())) continue;
    const values = {};
    for (const [column,key] of columns.entries()) if (key) values[key] = (cells[column] || '').trim();
    if (values.kind && !['卡带','收藏卡带','收藏'].includes(values.kind)) { nonCards++; continue; }
    try { cards.push(csvCard(values)); }
    catch (error) { errors.push('第 ' + (index + 2) + ' 行 · ' + error.message); }
  }
  return {cards,errors,nonCards};
}
