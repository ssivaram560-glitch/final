const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    = "8692459169:AAE2P2DE_RaSL4SazkRlwsAlo-zbfN4uOd4";
const OWNER_ID     = 8321379592;
const OWNER_PASS   = "2004";
const ADMIN_HANDLE = "@OnlineEarningapp_bot";
const REG_LINK     = "https://www.goaoko.com/#/register?invitationCode=457367799017";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.bdg88zf.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.bdg88zf.com/api/webapi/GetCaptcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

const MULT = [100,300,700];
// ============================================================
//  RENDER KEEP-ALIVE — Prevent render free tier sleep
// ============================================================
const http = require('http');
const PORT = process.env.PORT || 5000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SIVA BOT OK');
}).listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

// Self-ping every 14 minutes to prevent sleep
const RENDER_URL = process.env.RENDER_URL || "";
if (RENDER_URL) {
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
        console.log("[PING] Keep-alive ping sent");
    }, 14 * 60 * 1000);
}

// ============================================================
//  STORAGE
// ============================================================
let ownerLoggedIn  = false;
let adminPasswords = {};
let adminLoggedIn  = {};
let usersAccess    = {};
let keyStore       = {};
let stats          = {};
let running        = {};
let sentPeriods    = {};
let ownerState     = null;
let adminState     = {};
let userTokens     = {};
let userCreds      = {};
let autobetCfg     = {};
let autobetState   = {};
let profitTrack    = {};
let GLOBAL_TOKEN   = "";
let loginLock      = {};

// ============================================================
//  HELPERS
// ============================================================
function initUser(id) {
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0 };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { watch:false, watchLoss:4, baseBet:1, maxLvl:3, enabled:false };
    if (!autobetState[id]) autobetState[id] = { level:1, consecutiveLoss:0, inMart:false };
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0 };
}
function hasAccess(id)  { return !!(usersAccess[id] && Date.now() < usersAccess[id]); }
function daysLeft(id)   { return usersAccess[id] ? ((usersAccess[id]-Date.now())/86400000).toFixed(1) : "0"; }
function isAdmin(id)    { return adminPasswords[id] !== undefined; }
function isAdminIn(id)  { return adminLoggedIn[id] === true; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function getToken(id)   { return userTokens[id] || GLOBAL_TOKEN || ""; }

function generateKey(days, by) {
    const k = "SIVA-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID };
    return k;
}
function activateKey(userId, code) {
    const k = code.toUpperCase().trim();
    if (!keyStore[k])     return { ok:false, msg:"❌ Invalid key!" };
    if (keyStore[k].used) return { ok:false, msg:"❌ Key already used!" };
    const days = keyStore[k].days;
    keyStore[k].used=true; keyStore[k].usedBy=userId;
    const base = (usersAccess[userId]&&usersAccess[userId]>Date.now()) ? usersAccess[userId] : Date.now();
    usersAccess[userId] = base + days*86400000;
    return { ok:true, days, expiry:new Date(usersAccess[userId]).toLocaleString() };
}
function activeUsersList() {
    const now=Date.now(), list=Object.entries(usersAccess).filter(([,e])=>e>now);
    return list.length ? list.map(([id,e])=>"🟢 "+id+" | "+((e-now)/86400000).toFixed(1)+"d").join("\n") : "No active users.";
}
function adminList() {
    const ids=Object.keys(adminPasswords);
    return ids.length ? ids.map(id=>"👤 "+id+" | "+(adminLoggedIn[id]?"🟢 Online":"🔴 Offline")).join("\n") : "No admins.";
}
function allKeysList() {
    const keys=Object.entries(keyStore);
    return keys.length ? keys.map(([k,v])=>k+" → "+(v.used?"✅ Used":"🟢 "+v.days+"d")).join("\n") : "No keys.";
}

// ============================================================
//  SIGNATURES
// ============================================================
function makeBetSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp;
    const keys = Object.keys(p).filter(k=>p[k]!==null&&p[k]!=="").sort();
    const sorted = {};
    keys.forEach(k=>{ sorted[k]=p[k]===0?0:p[k]; });
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').toUpperCase().slice(0,32);
}

// ============================================================
//  UPDATED AUTOLOGIN FUNCTION (GOD MODE)
// ============================================================
async function autoLogin(userId, chatId, silent = false) {
    if (loginLock[userId]) return false;
    loginLock[userId] = true;

    const creds = userCreds[userId] || {};
    const phone = creds.phone;
    const pass = creds.pass;

    if (!phone || !pass) {
        loginLock[userId] = false;
        if (!silent && chatId) await send(chatId, "❌ Phone/Password இல்லை!\n/setcreds FULLPHONE PASSWORD");
        return false;
    }

    if (!silent && chatId) await send(chatId, "⏳ GOD MODE: Starting ULTRA-STABLE Flow...");
    console.log("[LOGIN] Phone:", phone, "via Playwright (STABLE)");

    let browser;
    try {
        browser = await chromium.launch({
            headless: true, // MUST BE TRUE ON SERVER
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const context = await browser.newContext({
            viewport: { width: 450, height: 1000 },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
        });
        const page = await context.newPage();
        let capturedToken = null;

        // Monitor network for token
        page.on('request', request => {
            const url = request.url();
            const headers = request.headers();
            if (url.includes('WinGoBet') && headers['authorization']) {
                capturedToken = headers['authorization'].replace(/^Bearer\s+/i, "");
            }
        });

        // 1. LOGIN
        console.log("Navigating to login...");
        await page.goto('https://bdgwin8.vip/#/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
        await page.fill('input[placeholder*="phone number"]', phone);
        await page.fill('input[type="password"]', pass);
        const loginBtn = page.locator('button:has-text("Log in")').first();
        await loginBtn.scrollIntoViewIfNeeded();
        await loginBtn.click();
        await page.waitForTimeout(8000);

        // 2. CONFIRM POPUP
        console.log("Checking for popups...");
        try {
            const confirmBtn = page.locator('div:has-text("Confirm"), button:has-text("Confirm")').first();
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
                await page.waitForTimeout(2000);
            }
        } catch (e) {}

        // 3. CLICK LOTTERY CATEGORY (RETRY LOGIC)
        console.log("Clicking Lottery category...");
        const lotteryCat = page.locator('div:has-text("Lottery")').first();
        await lotteryCat.scrollIntoViewIfNeeded();
        await lotteryCat.click();
        await page.waitForTimeout(3000);

        // 4. CLICK WINGO GAME (BETTER SELECTOR)
        console.log("Clicking Win Go game...");
        // Use a more specific locator for the Win Go card
        const wingoGame = page.locator('div.game-name:has-text("Win Go"), div:has-text("Win Go")').last();
        await wingoGame.scrollIntoViewIfNeeded();
        await wingoGame.click();
        await page.waitForTimeout(5000);

        // 5. CLICK SMALL
        console.log("Clicking Small...");
        const smallBtn = page.locator('div:has-text("Small"), .bet-button:has-text("Small")').first();
        await smallBtn.scrollIntoViewIfNeeded();
        await smallBtn.click();
        await page.waitForTimeout(2000);

        // 6. CLICK TOTAL AMOUNT (TRIGGER TOKEN REQUEST)
        console.log("Placing ₹1 bet to capture token...");
        const totalBtn = page.locator('button:has-text("Total amount")').first();
        if (await totalBtn.isVisible()) {
            await totalBtn.scrollIntoViewIfNeeded();
            await totalBtn.click();
        }
        await page.waitForTimeout(3000);

        // 7. EXTRACT TOKEN (Network fallback to LocalStorage)
        if (!capturedToken) {
            capturedToken = await page.evaluate(() => {
                return localStorage.getItem('token') || localStorage.getItem('userInfo');
            });
        }

        if (capturedToken && capturedToken.length > 50) {
            userTokens[userId] = capturedToken;
            console.log("[SUCCESS] Token Captured!");
            if (!silent && chatId) await send(chatId, "✅ GOD MODE SUCCESS!\nToken Captured: " + capturedToken.substring(0, 20) + "...");
            loginLock[userId] = false;
            return true;
        } else {
            throw new Error("Token not captured.");
        }

    } catch (error) {
        console.error("❌ GOD MODE Error:", error.message);
        if (!silent && chatId) await send(chatId, "❌ Error: " + error.message);
        loginLock[userId] = false;
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// Helper to send messages
async function send(chatId, text, opts = {}) {
    try {
        console.log(`[MSG to ${chatId}]: ${text}`);
        // return await bot.sendMessage(chatId, text, opts);
    } catch (e) {
        console.error("send error:", e.message);
    }
}




// ============================================================
//  PLACE BET
// ============================================================
async function placeBet(userId, chatId, period, prediction, predType, level) {
    let token = getToken(userId);
    if (!token || token.length < 20) {
        const ok = await autoLogin(userId, chatId, true);
        if (!ok) { await send(chatId,"❌ Token இல்லை!\n/setcreds FULLPHONE PASSWORD"); return false; }
        token = getToken(userId);
    }

    const cfg     = autobetCfg[userId];
    const betMult = cfg.baseBet * MULT[level-1];
    let bc = "";
    if (predType==="SIZE")  bc = prediction==="BIG" ? "BigSmall_Big" : "BigSmall_Small";
    if (predType==="COLOR") bc = prediction==="RED" ? "Color_Red"    : "Color_Green";

    const params = {
        amount:      1,
        betContent:  bc,
        betMultiple: betMult,
        gameCode:    "WinGo_30S", // 🔥 முக்கிய மாற்றம்: 1M-க்கு பதிலா 30S மாத்தியாச்சு da!
        issueNumber: String(period),
        language:    "en",
        random:      Math.floor(Math.random()*1e12)
    };
    const signature = makeBetSign(params);
    const timestamp = Math.floor(Date.now()/1000);
    const payload   = {...params, signature, timestamp};

    console.log(`[BET] ${bc} ₹${betMult} L${level} for Period: ${period}`);

    try {
        const r = await axios.post(BET_URL, payload, {
            headers: {
                "authorization":    "Bearer "+token,
                "content-type":     "application/json",
                "Accept":           "application/json, text/plain, */*",
                "Origin":           "https://bdgwin8.vip",
                "Referer":          "https://bdgwin8.vip/",
                "Ar-Origin":        "https://bdgwin8.vip",
                "Sec-Ch-Ua":        '"Chromium";v="139"',
                "Sec-Ch-Ua-Mobile": "?1",
                "Sec-Fetch-Dest":   "empty",
                "Sec-Fetch-Mode":   "cors",
                "User-Agent":       "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
            },
            timeout: 10000
        });

        const d = r.data;
        if (d.code === 0 || d.msg === "Succeed") {
            return { ok: true, amt: betMult, bc };
        } else if (d.code === 401) {
            console.log("[401] Token expired. Retrying auto login...");
            userTokens[userId] = "";
            const ok = await autoLogin(userId, chatId, true);
            if (ok) return await placeBet(userId, chatId, period, prediction, predType, level);
            return false;
        } else {
            console.log("[BET FAIL]", d.msg || d);
            return false;
        }
    } catch (err) {
        console.error("[BET ERR]", err.message);
        return false;
    }
}

// ============================================================
//  FETCH HISTORY
// ============================================================
const DRAW_URLS = [
    "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json",
    "https://api.ar-lottery01.com/api/Lottery/WinGoHistory?gameCode=WinGo_30S&pageNo=1&pageSize=20"
];

function decodeBuffer(buf) {
    try {
        const s = buf.toString('utf8');
        return JSON.parse(s);
    } catch (e) {
        try {
            const decompressed = zlib.gunzipSync(buf);
            return JSON.parse(decompressed.toString('utf8'));
        } catch (e2) {
            return null;
        }
    }
}

async function fetchList() {
    for (const url of DRAW_URLS) {
        try {
            const r = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: {
                    "Accept": "application/json, text/plain, */*",
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                },
                timeout: 8000
            });
            const data = decodeBuffer(r.data);
            if (data && data.data && data.data.list) return data.data.list;
        } catch (e) {
            continue;
        }
    }
    return null;
}

// ============================================================
//  PREDICTION LOGIC
// ============================================================
function decidePrediction(list, level, userId) {
    if (!list || list.length < 5) return null;
    const items = list.slice(0, 15).map(parseItem);
    const lastNum = items[0].n;
    if (lastNum === 0 || lastNum === 5) return { skip: true };

    const sz = stk(items, "size");
    if (sz.count >= 2) return { type: "SIZE", val: sz.val, pat: "Trend", conf: 85 };
    return { type: "SIZE", val: items[0].size === "BIG" ? "SMALL" : "BIG", pat: "Anti", conf: 75 };
}

function shouldBetNow(userId) {
    const cfg = autobetCfg[userId], st = autobetState[userId];
    if (!cfg.enabled) return false;
    if (st.inMart) return true;
    if (cfg.watch && st.consecutiveLoss < cfg.watchLoss) return false;
    return true;
}

function updateAfterResult(userId, win, predicted, actual) {
    const st = autobetState[userId], pt = profitTrack[userId], cfg = autobetCfg[userId];
    if (!shouldBetNow(userId)) return;
    const amt = cfg.baseBet * MULT[st.level - 1];
    pt.totalBets++;
    if (win) {
        pt.wins++; pt.pnl += (amt * 0.98);
        st.level = 1; st.inMart = false; st.consecutiveLoss = 0;
        pt.winStreak++; pt.lossStreak = 0; if (pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;
    } else {
        pt.losses++; pt.pnl -= amt;
        pt.lossStreak++; pt.winStreak = 0; if (pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;
        if (st.level < cfg.maxLvl) { st.level++; st.inMart = true; }
        else { st.level = 1; st.inMart = false; st.consecutiveLoss = 0; }
    }
}

async function handleWin(userId, chatId, actual, num) {
    const pt = profitTrack[userId], st = autobetState[userId], cfg = autobetCfg[userId];
    const amt = cfg.baseBet * MULT[st.level - 1];
    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN!                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Profit : +₹"+(amt*0.98).toFixed(2)+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╚══════════════════════════╝"
    );
    await sendSticker(chatId, WIN_STICKER);
}

async function handleLoss(userId, chatId, actual, num) {
    const st = autobetState[userId], pt = profitTrack[userId], cfg = autobetCfg[userId];
    const amt = cfg.baseBet * MULT[st.level - 1];
    if (st.level > 1) {
        const next = cfg.baseBet * MULT[st.level - 1];
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╠══════════════════════════╣\n"+
"║ Next L"+st.level+" : ₹"+next+"\n"+
"╚══════════════════════════╝"
        );
        await sendSticker(chatId, LOSS_STICKER);
    } else {
        st.level = 1; st.inMart = false; st.consecutiveLoss = 0;
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  💀 MAX LEVEL LOSS       ║\n"+
"╠══════════════════════════╣\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
        );
        await sendSticker(chatId, LOSS_STICKER);
    }
}

// ============================================================
//  PREDICT LOOP
// ============================================================
function parseItem(item) {
    const n = +(item.number || item.winNumber || 0);
    return {
        n,
        size: n >= 5 ? "BIG" : "SMALL",
        color: n === 0 ? "RED" : n === 5 ? "GREEN" : n % 2 === 0 ? "RED" : "GREEN"
    };
}
function stk(arr, key) {
    let count = 1;
    let val = arr[0]?.[key];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i][key] === val) count++;
        else break;
    }
    return { val, count };
}

async function runPredict(userId, chatId) {
    if(!running[userId]) return;
    const list = await fetchList();
    if(!list){
        await send(chatId,"⚠️ API error — retrying in 5s...");
        return setTimeout(()=>runPredict(userId,chatId), 5000); 
    }
    const signal = decidePrediction(list, autobetState[userId].level, userId);
    const next = (BigInt(list[0].issueNumber)+1n).toString();
    if (!signal || signal.skip) {
        const nextPeriodShort = next.slice(-6);
        await send(chatId,
"╔══════════════════════════╗\n"+
"║    ⏭️ SIVA AI - SKIP     ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+nextPeriodShort+"\n"+
"║ Reason  : SAFE FILTER DIGIT\n"+
"║ Strategy: CALCULATION SKIP\n"+
"╠══════════════════════════╣\n"+
"║ ⚠️ Safe mode active!      \n"+
"║ Waiting for next signal.. \n"+
"╚══════════════════════════╝"
        );
        return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 15000); 
    }
    if(sentPeriods[userId].has(next)) return setTimeout(()=>runPredict(userId,chatId), 2000); 
    sentPeriods[userId].add(next);
    if(sentPeriods[userId].size>50) sentPeriods[userId]=new Set([...sentPeriods[userId]].slice(-50));
    const st = autobetState[userId], cfg = autobetCfg[userId];
    const confBar = "🟦".repeat(Math.round(signal.conf/10))+"⬜".repeat(10-Math.round(signal.conf/10));
    const predDisplay = signal.type==="SIZE" ? (signal.val==="BIG"?"🔵 BIG":"🟠 SMALL") : (signal.val==="RED"?"🔴 RED":"🟢 GREEN");
    let abLine = "🤖 AutoBet: OFF";
    if(cfg.enabled){
        if(st.inMart) abLine = "📈 MART L"+st.level+": ₹"+(cfg.baseBet*MULT[st.level-1]);
        else if(cfg.watch&&st.consecutiveLoss<cfg.watchLoss) abLine = "👀 Watch: "+st.consecutiveLoss+"/"+cfg.watchLoss;
        else abLine = "💰 BET: ₹"+(cfg.baseBet*MULT[st.level-1])+" L"+st.level;
    }
    await send(chatId,
"╔══════════════════════════╗\n"+
"║    👑 SIVA ULTRA AI      ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Signal  : "+predDisplay+"\n"+
"║ Pattern : "+signal.pat+"\n"+
"║ Conf    : "+signal.conf+"%\n"+
"║ "+confBar+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
"╠══════════════════════════╣\n"+
"║ BET ON  : "+signal.val+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 GOAOKO PLAY NOW",url:REG_LINK}]]}}
    );
    if(cfg.enabled && shouldBetNow(userId)){
        const result = await placeBet(userId,chatId,next,signal.val,signal.type,st.level);
        if(result && result.ok) await send(chatId,"✅ Bet OK! "+result.bc+" ₹"+result.amt+" L"+st.level+"\n⏳ Checking result...");
    }
    checkResult(userId,chatId,next,signal.val,signal.type);
}

// ============================================================
//  RESULT CHECKER
// ============================================================
async function checkResult(userId, chatId, target, predicted, predType) {
    let tries = 0;
    const cfg = autobetCfg[userId], st = autobetState[userId];
    const wasReal = cfg.enabled && shouldBetNow(userId);
    const iv = setInterval(async () => {
        if (!running[userId]) return clearInterval(iv);
        if (++tries > 20) { clearInterval(iv); return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000); }
        const list = await fetchList(); if (!list) return;
        if (BigInt(list[0].issueNumber) < BigInt(target)) return;
        clearInterval(iv);
        const res = list.find(i => i.issueNumber === target) || list[0];
        const num = parseInt(res.number || res.winNumber || 0);
        const actual = num >= 5 ? "BIG" : "SMALL";
        const win = predicted === actual;
        updateAfterResult(userId, win, predicted, actual);
        const s = stats[userId]; s.total++;
        if (win) { s.win++; s.winStreak++; s.lossStreak = 0; if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak; }
        else { s.loss++; s.lossStreak++; s.winStreak = 0; if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak; }
        if (cfg.enabled) {
            if (wasReal) { if (win) await handleWin(userId, chatId, actual, num); else await handleLoss(userId, chatId, actual, num); }
            else { if (!win) { st.consecutiveLoss++; } else { st.consecutiveLoss = 0; } }
        } else {
            if (win) { await send(chatId, `✅ WIN! #${num} ${actual}`); await sendSticker(chatId, WIN_STICKER); }
            else   { await send(chatId, `❌ LOSS #${num} ${actual}`); await sendSticker(chatId, LOSS_STICKER); }
        }
        setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000);
    }, 10000);
}

// ============================================================
//  STATS & MENUS
// ============================================================
function showStats(chatId,userId){
    const d=stats[userId],rate=d.total?((d.win/d.total)*100).toFixed(1):"0.0";
    const bar="🟦".repeat(d.total?Math.round(d.win/d.total*10):0)+"⬜".repeat(d.total?10-Math.round(d.win/d.total*10):10);
    send(chatId,"📊 STATS\n\nTotal: "+d.total+"\nWins: "+d.win+"\nLosses: "+d.loss+"\nAcc: "+rate+"%\n"+bar+"\n\nBest Win: "+d.maxWinStreak+" streak\nWorst Loss: "+d.maxLossStreak+" streak");
}
function profitReport(chatId,userId){
    const pt=profitTrack[userId],cfg=autobetCfg[userId];
    const rate=pt.totalBets?((pt.wins/pt.totalBets)*100).toFixed(1):"0.0";
    const amounts=MULT.slice(0,cfg.maxLvl).map(m=>cfg.baseBet*m);
    send(chatId,
"💰 PROFIT REPORT\n\n"+
"Bets  : "+pt.totalBets+"\nWins  : "+pt.wins+"\nLoss  : "+pt.losses+"\nRate  : "+rate+"%\n"+
"P&L   : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"Best W: "+pt.maxW+" | Worst L: "+pt.maxL+"\n\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}
function autobetStatus(chatId,userId){
    const cfg=autobetCfg[userId],st=autobetState[userId],pt=profitTrack[userId];
    const amounts=MULT.slice(0,cfg.maxLvl).map(m=>cfg.baseBet*m);
    const creds=userCreds[userId]||{};
    send(chatId,
"🤖 AUTOBET STATUS\n\n"+
"Enabled  : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(userId).length>20?"✅":"❌")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+st.consecutiveLoss+"/"+cfg.watchLoss+"\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Mart Lvl : L"+st.level+"\n"+
"In Mart  : "+(st.inMart?"YES":"NO")+"\n"+
"P&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}

function userMenu(id){
    const rows=[["▶️ Start Prediction","🛑 Stop"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
    if(isAdmin(id))rows.push(["👑 Admin Panel"]);
    return{keyboard:rows,resize_keyboard:true};
}
const ownerMenu={keyboard:[["👥 All Users","👮 All Admins"],["👤 Add Admin","🗑 Remove Admin"],["🔑 Generate Key","📋 All Keys"],["🟢 Add User","🔴 Remove User"],["🔐 Set Token","📊 All Stats"],["🚪 Owner Logout"]],resize_keyboard:true};
const adminMenu={keyboard:[["👥 Active Users","🔑 Generate Key"],["🟢 Add User","🔴 Remove User"],["📋 All Keys","🚪 Admin Logout"]],resize_keyboard:true};
const autobetMenu={keyboard:[["✅ Enable AutoBet","❌ Disable AutoBet"],["👀 Watch Mode ON","👀 Watch Mode OFF"],["💰 Set Base Bet","📈 Set Max Level"],["🔢 Set Watch Losses","📊 AutoBet Status"],["🔙 Back"]],resize_keyboard:true};

// ============================================================
//  BOT INIT & HANDLERS
// ============================================================
let bot;
function startBot(){
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{console.error("Poll:",err.message);});
    addHandlers();
    console.log("✅ SIVA BOT running...");
}
async function send(chatId,text,opts={}){
    try{return await bot.sendMessage(chatId,text,opts);}
    catch(e){console.error("send:",e.message?.substr(0,60));}
}
async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

function addHandlers(){
    bot.onText(/\/start/,(msg)=>{
        const id=msg.from.id;initUser(id);
        const status=hasAccess(id)?"✅ ACTIVE — "+daysLeft(id)+"d left":"❌ NO ACCESS";
        send(msg.chat.id,
"╔══════════════════════════╗\n║  👑 SIVA ULTRA AI BOT    ║\n╠══════════════════════════╣\n"+
"║ Status : "+status+"\n║ ID     : "+id+"\n║ Admin  : "+ADMIN_HANDLE+"\n╠══════════════════════════╣\n"+
"║ /key CODE to activate    ║\n╚══════════════════════════╝",
        {reply_markup:userMenu(id)});
    });

    bot.onText(/\/key (.+)/,(msg,match)=>{
        const id=msg.from.id;initUser(id);
        const res=activateKey(id,match[1].trim());
        if(res.ok){send(msg.chat.id,"🎊 KEY ACTIVATED!\n⏳ "+res.days+" days\n📅 "+res.expiry,{reply_markup:userMenu(id)});send(OWNER_ID,"🔔 Key used!\nUser: "+id+"\nDays: "+res.days);}
        else send(msg.chat.id,res.msg);
    });

    bot.onText(/\/setcreds (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const parts=match[1].trim().split(/\s+/);
        if(parts.length<2)return send(id,"❌ Format:\n/setcreds FULLPHONE PASSWORD");
        const phone=parts[0],pass=parts.slice(1).join(" ");
        if(!userCreds[id])userCreds[id]={};
        userCreds[id].phone=phone;userCreds[id].pass=pass;
        send(id,"✅ Saved!\n📱 "+phone+"\n🔄 Testing login...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/setmytoken (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const tok=match[1].trim().replace(/^Bearer\s+/i,"");
        if(tok.length<20)return send(id,"❌ Token too short!");
        userTokens[id]=tok;
        send(id,"✅ Token saved!");
    });

    bot.onText(/\/login/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/owner/,(msg)=>{
        if(msg.from.id!==OWNER_ID)return;
        ownerState={action:"login"};send(OWNER_ID,"🔐 Owner password:");
    });

    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
        initUser(id);
        if(id===OWNER_ID&&ownerState){
            if(ownerState.action==="login"){if(text===OWNER_PASS){ownerLoggedIn=true;ownerState=null;return send(OWNER_ID,"👑 Welcome!",{reply_markup:ownerMenu});}}
            else if(ownerState.action==="genkey"){const d=parseInt(text);const k=generateKey(d,OWNER_ID);ownerState=null;return send(OWNER_ID,"🔑 Key:\n"+k,{reply_markup:ownerMenu});}
            else if(ownerState.action==="adduser"){if(!ownerState.step2){ownerState={action:"adduser",step2:true,tid:parseInt(text)};return send(OWNER_ID,"Days?");}else{usersAccess[ownerState.tid]=Date.now()+parseInt(text)*86400000;ownerState=null;return send(OWNER_ID,"✅ Added",{reply_markup:ownerMenu});}}
            else if(ownerState.action==="settoken"){GLOBAL_TOKEN=text.trim().replace(/^Bearer\s+/i,"");ownerState=null;return send(OWNER_ID,"✅ Global Token set!",{reply_markup:ownerMenu});}
        }
        if(id===OWNER_ID&&ownerLoggedIn){
            if(text==="👥 All Users")    return send(OWNER_ID,activeUsersList());
            if(text==="🔑 Generate Key") {ownerState={action:"genkey"};return send(OWNER_ID,"Days?");}
            if(text==="🟢 Add User")     {ownerState={action:"adduser"};return send(OWNER_ID,"User ID:");}
            if(text==="🔐 Set Token")    {ownerState={action:"settoken"};return send(OWNER_ID,"Token paste:");}
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(OWNER_ID,"🔒 Out.",{reply_markup:userMenu(id)});}
        }
        if(text==="🤖 AutoBet Setup"){
            if(!hasAccess(id))return send(id,"❌ No access.");
            return send(id,"🤖 SETTINGS",{reply_markup:autobetMenu});
        }
        if(text==="✅ Enable AutoBet"){autobetCfg[id].enabled=true;return send(id,"✅ AutoBet ON");}
        if(text==="❌ Disable AutoBet"){autobetCfg[id].enabled=false;return send(id,"❌ AutoBet OFF");}
        if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(id,"❌ No access!");
            if(running[id])return send(id,"⚠️ Already running!");
            running[id]=true;runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop")   {running[id]=false;send(msg.chat.id,"🛑 Stopped.");}
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE);
        if(text==="🔑 My Token") send(id,"Token: "+(getToken(id).length>20?"✅":"❌"));
        if(text==="🔙 Back") return send(id,"Main Menu",{reply_markup:userMenu(id)});
    });
}

startBot();
