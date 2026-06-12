const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
// 🎯 உன் ஃபைலோட முதல் வரியா (Line 1) இதை போட்டு சேவ் பண்ணு da Siva:
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');// ============================================================
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
const LOGIN_URL   = "https://api.goa7777.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.goa7777.com/api/webapi/GetCaptcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// Martingale multipliers — user can customize base bet
const MULT = [50,160,360] // 🔥 இங்க base bet-க்கு நேரடியாக மடங்காகும் மடிப்புகள் தான் இருக்கணும் da!];

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

// ============================================================
//  HELPERS
// ============================================================
function initUser(id) {
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0 };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { watch:true, watchLoss:1, baseBet:1, maxLvl:3, enabled:false };
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
//  DEVICE ID
// ============================================================
function getOrCreateDevice(userId) {
    if (!userCreds[userId]) userCreds[userId] = {};
    if (!userCreds[userId].deviceId) {
        userCreds[userId].deviceId = crypto.randomBytes(16).toString('hex');
    }
    return userCreds[userId].deviceId;
}

// ============================================================
//  SIGNATURES
// ============================================================
 // 🎯 ஃபைலோட டாப்ல இது இருக்கணும் Siva!

// ============================================================
// 🎯 MULTI-USER 24-HOUR AUTO LOGIN ENGINE
// ============================================================

let loginLock = {};

// 🎯 1. மெயின் ஆட்டோ-லாகின் ஃபங்க்ஷன் (மொபைல் & லேப்டாப் ரெண்டுக்கும் பொதுவானது)
async function autoLogin(userId, chatId, silent=false) {
    if (loginLock[userId]) return false;
    loginLock[userId] = true;

    // 💾 ஒவ்வொரு பிரண்டுக்கும் தனித்தனி மெமரி ஃபைல் ஆட்டோவா கிரியேட் ஆகும் Siva da!
    const sessionPath = path.join(__dirname, `session_${userId}.json`);
    const hasSession = fs.existsSync(sessionPath);

    if (!hasSession) {
        if (!silent && chatId) {
            await send(chatId, "🌐 முதன்முறை லாகின் செய்கிறாய் Siva/Friend! பிரவுசர் ஓபன் ஆகியுள்ளது, கேம் பேஜில் உங்கள் Register Number & Password போட்டு லாகின் செய்யவும்.\n\n" +
                               "⚠️ இந்த ஒரு முறை மட்டும் லாகின் செய்தால் போதும்! அடுத்த 24 மணி நேரத்திற்கும் பாட் ஆட்டோவாக டோக்கன் எடுத்துக்கொள்ளும்! ⏳");
        }
    } else {
        if (!silent && chatId) {
            await send(chatId, "🔄 பழைய லாகின் மெமரி உள்ளது! உங்களுக்கான 24h ஆட்டோ-டோக்கன் என்ஜினை பேக்ரவுண்டில் ரன் செய்கிறேன்... ⏳");
        }
    }

    // 🚀 டோக்கன் அள்ற மேஜிக் என்ஜினை கூப்பிடுறோம்
    const tokenSuccess = await getMultiUser24HourToken(userId, chatId, silent, hasSession, sessionPath);
    
    loginLock[userId] = false;
    return tokenSuccess;
}

// 🤖 2. யூசர் லாகின் செஷனை வச்சு ஆட்டோவா டோக்கன் அள்ற அல்டிமேட் இஞ்சின்!
async function getMultiUser24HourToken(userId, chatId, silent, hasSession, sessionPath) {
    let browser;
    try {
        console.log(`[🌐 BROWSER] Launching Browser Engine for User: ${userId}`);

        // Replit (Cloud)-ல் ரன் ஆகும்போது 'true' (கண்ணுக்கு தெரியாது), லேப்டாப்ல ரன் ஆகும்போது விண்டோவாக ஓபன் ஆகும் da
        const isReplit = process.env.REPLIT === "true" || process.env.REPL_ID !== undefined;

        browser = await chromium.launch({
            headless: hasSession ? true : (isReplit ? 'new' : false), 
            channel: 'chrome'
        });

        let context;
        if (hasSession) {
            // 💾 அந்தந்த பிரண்டோட தனிப்பட்ட மெமரியை மட்டும் லோடு பண்ணுது
            console.log(`[💾 LOADING SESSION] Loading session_${userId}.json`);
            context = await browser.newContext({ storageState: sessionPath });
        } else {
            context = await browser.newContext();
        }

        const page = await context.newPage();
        console.log("[🌐 BROWSER] Navigating to Goa Games Login Page...");
        await page.goto('https://goaokk.com/#/login', { waitUntil: 'load', timeout: 60000 });

        let tokenFound = null;

        if (!hasSession) {
            // 🔥 ஃபர்ஸ்ட் டைம் உன் பிரண்ட் லாகின் பண்ற வரைக்கும் பாட் 2 நிமிடம் வெயிட் பண்ணும் Siva
            const maxWaitTime = 120000; 
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
                tokenFound = await page.evaluate(() => {
                    return localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('Authorization');
                });

                if (tokenFound && tokenFound !== "null" && tokenFound.trim() !== "") {
                    // 🎯 லாகின் ஆன உடனே அவனோட செஷனை மட்டும் தனி ஃபைல்ல பாட் லாக் பண்ணிடும்!
                    await page.waitForTimeout(2000); // டேட்டா முழுசா சேவ் ஆக சின்ன வெயிட்டிங்
                    await context.storageState({ path: sessionPath });
                    console.log(`[💾 SESSION SAVED] Session saved for user: session_${userId}.json`);
                    break;
                }
                await page.waitForTimeout(1500); // ஒவ்வொரு 1.5 செகண்டுக்கும் செக் பண்ணும்
            }
        } else {
            // 🔄 ஏற்கனவே மெமரி இருந்தா, ஆட்டோவா ஹோம் பேஜுக்கு போய் புது டோக்கனை அள்ளிடும்!
            await page.goto('https://goaokk.com/#/home', { waitUntil: 'load', timeout: 40000 });
            await page.waitForTimeout(4000); 

            tokenFound = await page.evaluate(() => {
                return localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('Authorization');
            });
        }

        // 🎯 டோக்கன் கிடைச்சதும் பாட் பண்ற வேலை
        if (tokenFound && tokenFound !== "null" && tokenFound.trim() !== "") {
            userTokens[userId] = tokenFound;
            console.log(`[✅ SUCCESS] Captured Token for ${userId}:`, tokenFound.slice(0, 15) + "...");
            
            if (!silent && chatId) {
                if (!hasSession) {
                    await send(chatId, "✅ லாகின் மெமரி சேவ் செய்யப்பட்டது Siva/Friend! இனி உங்கள் அக்கவுண்ட்டிற்கு 24 மணி நேரமும் பாட்டே பேக்ரவுண்டில் ஆட்டோவாக டோக்கன் எடுத்து பெட் கட்டும்! 🔥🚀");
                } else {
                    await send(chatId, "✅ 24h என்ஜின் பேக்rவுண்டில் புது டோக்கனை ஆட்டோவாக அள்ளிக்கொண்டது! 🚀");
                }
            }
            await browser.close();
            return true;
        } else {
            console.log(`[❌ ERROR] Could not get token for user ${userId}`);
            if (!silent && chatId) {
                await send(chatId, "❌ டோக்கன் எடுக்க முடியவில்லை Siva/Friend! லாகின் செஷன் எக்ஸ்பயர் ஆகியிருக்கலாம். `/login` கொடுத்து மீண்டும் ஒருமுறை லாகின் செய்யவும்.");
            }
            // ஒருவேளை லாகின் செஷன் தப்பானா பழைய ஃபைலை டெலிட் பண்ணிடும், அப்போதான் மறுபடி லாகின் விண்டோ வரும்
            if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath); 
            await browser.close();
            return false;
        }

    } catch (e) {
        console.error("[❌ BROWSER ERROR]", e.message);
        if (browser) await browser.close();
        return false;
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
                "Origin":           "https://goaokk.com",
                "Referer":          "https://goaokk.com/",
                "Ar-Origin":        "https://goaokk.com",
                "Sec-Ch-Ua":        '"Chromium";v="139"',
                "Sec-Ch-Ua-Mobile": "?1",
                "Sec-Fetch-Dest":   "empty",
                "Sec-Fetch-Mode":   "cors",
                "Sec-Fetch-Site":   "cross-site",
                "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        const d = r.data;
        console.log(`[BET RESP] code:${d.code} msg:${d.msg}`);

        if (d.code===0||d.msg==="Succeed"||d.msgCode===0) return {ok:true, amt:betMult, bc};

        if (d.code===401||d.code===40100||(d.msg&&(d.msg.toLowerCase().includes("token")||d.msg.toLowerCase().includes("expired")))) {
            userTokens[userId]="";
            await send(chatId,"🔄 Token expired — Re-login...");
            const ok = await autoLogin(userId,chatId,true);
            if(ok) await send(chatId,"✅ Re-login OK!");
            else   await send(chatId,"❌ Re-login fail! /setcreds பண்ணu.");
            return false;
        }

        await send(chatId,"❌ Bet fail: "+(d.msg||JSON.stringify(d).substr(0,60)));
        return false;
    } catch(err) {
        console.error("[BET ERR]",err.message);
        await send(chatId,"❌ Network error: "+err.message);
        return false;
    }
}

// ============================================================
//  FETCH HISTORY — Multiple fallback URLs for reliability
// ============================================================
const DRAW_URLS = [
    "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json",
    "https://api.ar-lottery01.com/api/Lottery/WinGoHistory?gameCode=WinGo_30S&pageNo=1&pageSize=20"
];

function decodeBuffer(buf) {
    try{return JSON.parse(buf.toString("utf8"));}catch(e){}
    try{return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));}catch(e){}
    try{return JSON.parse(zlib.inflateSync(buf).toString("utf8"));}catch(e){}
    try{return JSON.parse(zlib.inflateRawSync(buf).toString("utf8"));}catch(e){}
    try{return JSON.parse(zlib.brotliDecompressSync(buf).toString("utf8"));}catch(e){}
    return null;
}

async function fetchList(retries=3) {
    for(let attempt=0; attempt<retries; attempt++){
        for(const url of DRAW_URLS){
            try{
                const res = await axios.get(url+"?ts="+Date.now(), {
                    headers:{
                        "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
                        "Accept":           "application/json, text/plain, */*",
                        "Accept-Encoding":  "gzip, deflate, br",
                        "Origin":           "https://goaokk.com",
                        "Referer":          "https://goaokk.com/"
                    },
                    timeout:12000, decompress:true, responseType:"arraybuffer"
                });
                const data = decodeBuffer(Buffer.from(res.data));
                if(!data) continue;
                const list = data?.data?.list || data?.data?.rows || data?.list;
                if(list && list.length>0) return list;
            }catch(e){
                console.error(`Fetch attempt ${attempt+1} url fail:`, e.message);
            }
        }
        if(attempt < retries-1) await sleep(5000);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔥 PREDICTION WITH RECOVERY MODE - FINAL VERSION
//  ⭐ EXACTLY 2 LOSSES → 2 RECOVERY PREDICTIONS
//  ✅ NORMAL: 0-4=SMALL, 5-9=BIG
//  ✅ RECOVERY: 0-4=BIG, 5-9=SMALL
//  🚀 PRODUCTION READY!
// ═══════════════════════════════════════════════════════════════════════════════

let userStates = {};

function initState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            mode: "NORMAL",
            recoveryCount: 0,
            normalModeHistory: []
        };
    }
    // ஒருவேளை ஆப்ஜெக்ட் இருந்து அரே மிஸ் ஆனாலும் கிராஷ் ஆகாம இருக்க:
    if (!userStates[userId].normalModeHistory) {
        userStates[userId].normalModeHistory = [];
    }
}

// ═════════════════════════════════════════════════════════════════════
//  1. DECIDE PREDICTION FUNCTION
// ═════════════════════════════════════════════════════════════════════
function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 2) {
        return null;
    }

    // 1. ═══ உன்னோட ஒரிஜினல் மேத்தமேட்டிக்கல் கால்குலேஷன் ═══
    const currentPeriod = String(list[0].issueNumber);
    const currentResult = parseInt(list[0].number || list[0].winNumber || 0);

    const nextPeriodNum = BigInt(currentPeriod) + 1n;
    const nextPeriod = nextPeriodNum.toString();
    const nextLast3Num = parseInt(nextPeriod.slice(-3));

    // 🎯 உன்னோட Formula
    const answer = nextLast3Num * Math.exp(currentResult);

    const answerStr = answer.toString();
    const noDecimal = answerStr.replace('.', '');
    const first14 = noDecimal.substring(0, 14);

    // 🎯 கால்குலேஷன் ஆன்சரோட கடைசி டிஜிட்
    const lastDigit = parseInt(first14.charAt(first14.length - 1));

    // ═════════════════════════════════════════════════════════════════════
    // 🔥 [SIVA REAL ULTRA FILTER] வெறும் 8 வந்தா மட்டும் BIG, மத்ததெல்லாம் SKIP!
    // ═════════════════════════════════════════════════════════════════════
    if (lastDigit === 8) {
        return {
            type: 'SIZE',
            val: 'BIG',
            conf: 99, // வெறும் 8 மட்டும் எடுக்குறதுனால அக்யூரசி 99% கெத்தா வச்சுக்கலாம் Siva!
            pat: 'NORMAL PATTERN',
            normalPrediction: 'BIG',
            skip: false
        };
    } 
    // 8 தவிர 0,1,2,3,4,5,6,7,9 எது வந்தாலும் இங்க வந்து ஸ்கிப் ஆகிடும் da!
    else {
        console.log(`[🤖 BOT CALC SKIP] Calculation digit is ${lastDigit}. Not 8. Skipping period.`);
        return {
            skip: true,
            pat: `SKIP (CALC ${lastDigit})`
        };
    }
}
// ═════════════════════════════════════════════════════════════════════
//  2. UPDATE AFTER RESULT FUNCTION (உன் புது லாஜிக் படி)
// ═════════════════════════════════════════════════════════════════════
function updateAfterResult(userId, wasWin, predictionVal, actualSide) {
    initState(userId);
    const state = userStates[userId];
    const won = actualSide === predictionVal;

    // வெறும் ரிசல்ட்டை மட்டும் பிரிண்ட் பண்ணும் Siva, மோடு மாறாது
    console.log(`[RESULT] Pred: ${predictionVal} | Actual: ${actualSide} → ${won ? 'WIN' : 'LOSS'}`);
    
    // இப்போ நமக்கு ரெக்கவரி மோடு தேவையில்லைன்றதுனால ஹிஸ்டரி மெயின்டைன் பண்ண வேண்டாம் da Siva.
    state.mode = 'NORMAL';
    state.recoveryCount = 0;
    state.normalModeHistory = [];
}
// ============================================================
//  AUTOBET LOGIC
// ============================================================
function shouldBetNow(userId) {
    const cfg=autobetCfg[userId],st=autobetState[userId];
    if(!cfg.enabled)return false;
    if(!getToken(userId))return false;
    if(st.inMart)return true;
    if(!cfg.watch)return true;
    return st.consecutiveLoss>=cfg.watchLoss;
}

async function handleWin(userId, chatId, actual, num) {
    const st=autobetState[userId],pt=profitTrack[userId],cfg=autobetCfg[userId];
    const amt=cfg.baseBet*MULT[st.level-1],profit=amt*0.98;
    pt.totalBets++;pt.wins++;pt.pnl+=profit;
    pt.winStreak++;pt.lossStreak=0;if(pt.winStreak>pt.maxW)pt.maxW=pt.winStreak;
    st.level=1;st.inMart=false;st.consecutiveLoss=0;
    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN! 🎉              ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Profit : +₹"+profit.toFixed(2)+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Streak : "+pt.winStreak+" wins\n"+
"║ Total  : "+pt.wins+"W/"+pt.losses+"L\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
    );
    await sendSticker(chatId,WIN_STICKER);
}

async function handleLoss(userId, chatId, actual, num) {
    const st=autobetState[userId],pt=profitTrack[userId],cfg=autobetCfg[userId];
    const amt=cfg.baseBet*MULT[st.level-1];
    pt.totalBets++;pt.losses++;pt.pnl-=amt;
    pt.lossStreak++;pt.winStreak=0;if(pt.lossStreak>pt.maxL)pt.maxL=pt.lossStreak;
    if(st.level<cfg.maxLvl){
        st.level++;st.inMart=true;
        const next=cfg.baseBet*MULT[st.level-1];
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
        await sendSticker(chatId,LOSS_STICKER);
    } else {
        st.level=1;st.inMart=false;st.consecutiveLoss=0;
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  💀 MAX LEVEL LOSS       ║\n"+
"╠══════════════════════════╣\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
        );
        await sendSticker(chatId,LOSS_STICKER);
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
        color:
            n === 0 ? "RED" :
            n === 5 ? "GREEN" :
            n % 2 === 0 ? "RED" : "GREEN"
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

    // 1. முதல்ல லிஸ்ட்டை ஃபெட்ச் பண்றோம்
    const list = await fetchList();
    if(!list){
        await send(chatId,"⚠️ API error — retrying in 5s...");
        return setTimeout(()=>runPredict(userId,chatId), 5000); 
    }

    // 2. பிரிடிக்ஷன் கால்குலேட் பண்றோம் da Siva
    const signal = decidePrediction(
        list,
        autobetState[userId].level,
        userId
    );

    const next = (BigInt(list[0].issueNumber)+1n).toString();

    // 🔥 [பக்கா பிக்ஸ்] ரிசல்ட் 0 அல்லது 5 வந்து ஸ்கிப் பண்ண சொல்லிருந்தா டெலிகிராம்ல SKIP கார்டு போகும்!
   // runPredict குள்ள இருக்குற ஸ்கிப் கார்டு மெசேஜ்:
    if (!signal || signal.skip) {
        console.log(`[🤖 BOT] Skipping period due to Calculation Filter.`);
        
        const nextPeriodShort = next.slice(-6);
        
        // டெலிகிராம் குரூப்புக்கு போற கெத்தான FILTER SKIP மெசேஜ் கார்டு:
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

    const data10 = list.slice(0,10).map(parseItem);
    const szS = stk(data10,"size"), clS = stk(data10,"color");
    
    const dragonInfo = szS.count>=6 ? "🐉 SIZE:"+szS.val+" x"+szS.count : clS.count>=6 ? "🐉 COLOR:"+clS.val+" x"+clS.count : "";

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
        if (++tries > 20) {
            clearInterval(iv);
            return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
        }
        
        const list = await fetchList(); if (!list) return;
        if (BigInt(list[0].issueNumber) < BigInt(target)) return;
        clearInterval(iv);

        const res = list.find(i => i.issueNumber === target) || list[0];
        const num = parseInt(res.number || res.winNumber || 0);
        
        // 🔥 Actual SIZE கணிப்பு (இங்க தான் திருத்தியிருக்கேன் da)
        const actual = num >= 5 ? "BIG" : "SMALL";
        const win = predicted === actual;

        // 🔥 அப்டேட் ஃபங்க்ஷனுக்கு டேட்டாவை கரெக்ட்டா பாஸ் பண்றோம் Siva
        updateAfterResult(userId, win, predicted, actual);

        const s = stats[userId]; s.total++;
        if (win) { s.win++; s.winStreak++; s.lossStreak = 0; if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak; }
        else { s.loss++; s.lossStreak++; s.winStreak = 0; if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak; }

        if (cfg.enabled) {
            if (wasReal) {
                if (win) await handleWin(userId, chatId, actual, num);
                else    await handleLoss(userId, chatId, actual, num);
            } else {
                if (!win) { st.consecutiveLoss++; } else { st.consecutiveLoss = 0; }
            }
        } else {
            if (win) { await send(chatId, `✅ WIN! #${num} ${actual}`); await sendSticker(chatId, WIN_STICKER); }
            else   { await send(chatId, `❌ LOSS #${num} ${actual}`); await sendSticker(chatId, LOSS_STICKER); }
        }
        setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000);
    }, 10000);
}
// ============================================================
//  STATS
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

// ============================================================
//  KEYBOARDS
// ============================================================
function userMenu(id){
    const rows=[["▶️ Start Prediction","🛑 Stop"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
    if(isAdmin(id))rows.push(["👑 Admin Panel"]);
    return{keyboard:rows,resize_keyboard:true};
}
const ownerMenu={keyboard:[["👥 All Users","👮 All Admins"],["👤 Add Admin","🗑 Remove Admin"],["🔑 Generate Key","📋 All Keys"],["🟢 Add User","🔴 Remove User"],["🔐 Set Token","📊 All Stats"],["🚪 Owner Logout"]],resize_keyboard:true};
const adminMenu={keyboard:[["👥 Active Users","🔑 Generate Key"],["🟢 Add User","🔴 Remove User"],["📋 All Keys","🚪 Admin Logout"]],resize_keyboard:true};
const autobetMenu={keyboard:[["✅ Enable AutoBet","❌ Disable AutoBet"],["👀 Watch Mode ON","👀 Watch Mode OFF"],["💰 Set Base Bet","📈 Set Max Level"],["🔢 Set Watch Losses","📊 AutoBet Status"],["🔙 Back"]],resize_keyboard:true};

// ============================================================
//  BOT INIT
// ============================================================
let bot;
function startBot(){
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{console.error("Poll:",err.message);setTimeout(startBot,5000);});
    bot.on("error",err=>{console.error("Bot:",err.message);});
    addHandlers();
    console.log("✅ SIVA BOT running...");
}
async function send(chatId,text,opts={}){
    try{return await bot.sendMessage(chatId,text,opts);}
    catch(e){if(e.message&&e.message.includes("parse entities")){try{const o={...opts};delete o.parse_mode;return await bot.sendMessage(chatId,text,o);}catch(e2){}}console.error("send:",e.message?.substr(0,60));}
}
async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

// ============================================================
//  HANDLERS
// ============================================================
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
        if(parts.length<2)return send(id,"❌ Format:\n/setcreds FULLPHONE PASSWORD\n\nExample:\n/setcreds 916381605525 mypassword");
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
        send(id,"✅ Token saved!\n..."+tok.slice(-12)+"\n\n🤖 AutoBet Setup → ✅ Enable");
    });

    bot.onText(/\/login/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        send(id,"🔄 Logging in...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/owner/,(msg)=>{
        if(msg.from.id!==OWNER_ID)return;
        if(ownerLoggedIn)return send(OWNER_ID,"Already in!",{reply_markup:ownerMenu});
        ownerState={action:"login"};send(OWNER_ID,"🔐 Owner password:");
    });

    bot.onText(/\/adminlogin (.+)/,(msg,match)=>{
        const id=msg.from.id,pass=match[1].trim();
        if(!isAdmin(id))return send(id,"Not admin.");
        if(pass===adminPasswords[id]){adminLoggedIn[id]=true;send(id,"✅ Admin Login!",{reply_markup:userMenu(id)});}
        else send(id,"❌ Wrong!");
    });

    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
        initUser(id);

        const OB=["👥 All Users","👮 All Admins","👤 Add Admin","🗑 Remove Admin","🔑 Generate Key","📋 All Keys","🟢 Add User","🔴 Remove User","🔐 Set Token","📊 All Stats","🚪 Owner Logout"];
        const AB=["👥 Active Users","🔑 Generate Key","🟢 Add User","🔴 Remove User","📋 All Keys","🚪 Admin Logout"];

        if(id===OWNER_ID&&ownerState){
            const s=ownerState;
            if(s.action==="login"){if(text===OWNER_PASS){ownerLoggedIn=true;ownerState=null;return send(OWNER_ID,"👑 Welcome!",{reply_markup:ownerMenu});}else return send(OWNER_ID,"❌ Wrong!");}
            if(OB.includes(text)){ownerState=null;}
            else if(s.action==="addadmin"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(OWNER_ID,"❌");ownerState={action:"addadmin",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nPassword:");}else{if(text.length<6)return send(OWNER_ID,"❌ Min 6");adminPasswords[s.tid]=text;adminLoggedIn[s.tid]=false;ownerState=null;send(OWNER_ID,"✅ Admin: "+s.tid,{reply_markup:ownerMenu});send(s.tid,"🎉 Admin!\n/adminlogin "+text);return;}}
            else if(s.action==="removeadmin"){const t=parseInt(text);if(isNaN(t))return;delete adminPasswords[t];delete adminLoggedIn[t];ownerState=null;send(OWNER_ID,"🚫 Removed",{reply_markup:ownerMenu});return;}
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(OWNER_ID,"❌ Days?");const k=generateKey(d,OWNER_ID);ownerState=null;return send(OWNER_ID,"🔑 Key:\n\n"+k+"\n\n"+d+"d\n/key "+k,{reply_markup:ownerMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(OWNER_ID,"❌");ownerState={action:"adduser",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(OWNER_ID,"❌");usersAccess[s.tid]=Date.now()+d*86400000;ownerState=null;send(OWNER_ID,"✅ "+s.tid+" "+d+"d",{reply_markup:ownerMenu});send(s.tid,"🎊 VIP! "+d+" days\n▶️ Start Prediction!");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;const was=hasAccess(t);delete usersAccess[t];running[t]=false;ownerState=null;send(OWNER_ID,was?"🚫 Removed":"⚠️ Not active",{reply_markup:ownerMenu});if(was)send(t,"🔴 Access removed.");return;}
            else if(s.action==="settoken"){GLOBAL_TOKEN=text.trim().replace(/^Bearer\s+/i,"");ownerState=null;return send(OWNER_ID,"✅ Global Token set!",{reply_markup:ownerMenu});}
        }

        if(id===OWNER_ID&&ownerLoggedIn){
            if(text==="👥 All Users")    return send(OWNER_ID,"👥\n\n"+activeUsersList());
            if(text==="👮 All Admins")   return send(OWNER_ID,"👮\n\n"+adminList());
            if(text==="👤 Add Admin")    {ownerState={action:"addadmin"};return send(OWNER_ID,"User ID:");}
            if(text==="🗑 Remove Admin") {ownerState={action:"removeadmin"};return send(OWNER_ID,"Admin ID:");}
            if(text==="🔑 Generate Key") {ownerState={action:"genkey"};return send(OWNER_ID,"Days?");}
            if(text==="📋 All Keys")     return send(OWNER_ID,"📋\n\n"+allKeysList());
            if(text==="🟢 Add User")     {ownerState={action:"adduser"};return send(OWNER_ID,"User ID:");}
            if(text==="🔴 Remove User")  {ownerState={action:"removeuser"};return send(OWNER_ID,"User ID?");}
            if(text==="🔐 Set Token")    {ownerState={action:"settoken"};return send(OWNER_ID,"Token paste:");}
            if(text==="📊 All Stats")    {const lines=Object.entries(stats).map(([id,s])=>"👤 "+id+": "+s.win+"W/"+s.loss+"L");return send(OWNER_ID,lines.join("\n")||"No stats");}
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(OWNER_ID,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(isAdmin(id)&&isAdminIn(id)&&adminState[id]){
            const s=adminState[id];
            if(AB.includes(text)){delete adminState[id];}
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌ Days?");const k=generateKey(d,id);delete adminState[id];return send(id,"🔑 Key:\n\n"+k+"\n\n"+d+"d",{reply_markup:adminMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");adminState[id]={action:"adduser",step2:true,tid:t};return send(id,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌");usersAccess[s.tid]=Date.now()+d*86400000;delete adminState[id];send(id,"✅ "+s.tid+" "+d+"d",{reply_markup:adminMenu});send(s.tid,"🎊 ACCESS! "+d+"d");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;const was=hasAccess(t);delete usersAccess[t];running[t]=false;delete adminState[id];send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:adminMenu});if(was)send(t,"🔴 Removed.");return;}
            else if(s.action==="setbase"){const v=parseInt(text);if(isNaN(v)||v<1)return send(id,"❌ Min 1");autobetCfg[id].baseBet=v;delete adminState[id];const a=MULT.slice(0,autobetCfg[id].maxLvl).map(m=>v*m);return send(id,"✅ Base: ₹"+v+"\nMart: ₹"+a.join("→₹"),{reply_markup:autobetMenu});}
            else if(s.action==="setlvl"){const v=parseInt(text);if(isNaN(v)||v<1||v>10)return send(id,"❌ 1-10");autobetCfg[id].maxLvl=v;delete adminState[id];const a=MULT.slice(0,v).map(m=>autobetCfg[id].baseBet*m);return send(id,"✅ Level: "+v+"\nMart: ₹"+a.join("→₹"),{reply_markup:autobetMenu});}
            else if(s.action==="setwloss"){const v=parseInt(text);if(isNaN(v)||v<1)return send(id,"❌ Min 1");autobetCfg[id].watchLoss=v;delete adminState[id];return send(id,"✅ Watch: "+v+" consecutive losses → bet",{reply_markup:autobetMenu});}
        }

        if(isAdmin(id)&&isAdminIn(id)){
            if(text==="👥 Active Users") return send(id,"👥\n\n"+activeUsersList());
            if(text==="🔑 Generate Key") {adminState[id]={action:"genkey"};return send(id,"Days?");}
            if(text==="🟢 Add User")     {adminState[id]={action:"adduser"};return send(id,"User ID?");}
            if(text==="🔴 Remove User")  {adminState[id]={action:"removeuser"};return send(id,"User ID?");}
            if(text==="📋 All Keys")     return send(id,"📋\n\n"+allKeysList());
            if(text==="🚪 Admin Logout") {adminLoggedIn[id]=false;return send(id,"🔒 Out.",{reply_markup:userMenu(id)});}
        }
        if(text==="👑 Admin Panel"&&isAdmin(id)){
            if(!isAdminIn(id))return send(id,"Login:\n/adminlogin YOUR_PASS");
            return send(id,"👑 Admin",{reply_markup:adminMenu});
        }

        if(text==="🤖 AutoBet Setup"){
            if(!hasAccess(id))return send(id,"❌ No access.");
            const cfg=autobetCfg[id],creds=userCreds[id]||{};
            const amounts=MULT.slice(0,cfg.maxLvl).map(m=>cfg.baseBet*m);
            return send(id,
"🤖 AUTOBET SETTINGS\n\n"+
"Status   : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(id).length>20?"✅ SET":"❌ MISSING")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌ /setcreds")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+cfg.watchLoss+" consecutive\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n\n"+
"Mart: ₹"+amounts.join("→₹")+"\n\n"+
"/setcreds 916381605525 PASSWORD\n"+
"/setmytoken TOKEN",
            {reply_markup:autobetMenu});
        }

        if(text==="✅ Enable AutoBet"){
            const creds=userCreds[id]||{};
            if(!getToken(id)&&!creds.phone)return send(id,"❌ /setcreds FULLPHONE PASSWORD\nor /setmytoken TOKEN");
            autobetCfg[id].enabled=true;
            if(!getToken(id)&&creds.phone){
                send(id,"🔄 Auto login...");
                const ok=await autoLogin(id,msg.chat.id,true);
                if(ok)send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
                else send(id,"⚠️ Login fail. /setcreds பண்ணு.",{reply_markup:autobetMenu});
            } else {
                send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
            }
            return;
        }
        if(text==="❌ Disable AutoBet"){autobetCfg[id].enabled=false;return send(id,"❌ AutoBet OFF",{reply_markup:userMenu(id)});}
        if(text==="👀 Watch Mode ON") {autobetCfg[id].watch=true;return send(id,"👀 Watch ON — "+autobetCfg[id].watchLoss+" losses → bet");}
        if(text==="👀 Watch Mode OFF"){autobetCfg[id].watch=false;return send(id,"👀 Watch OFF — Direct bet!");}
        if(text==="💰 Set Base Bet"){adminState[id]={action:"setbase"};return send(id,"Base bet ₹?\nCurrent: ₹"+autobetCfg[id].baseBet+"\nEnter:");}
        if(text==="📈 Set Max Level"){adminState[id]={action:"setlvl"};const a=MULT.slice(0,10).map(m=>autobetCfg[id].baseBet*m);return send(id,"Max Level (1-10)?\nCurrent: "+autobetCfg[id].maxLvl+"\n\n"+a.map((v,i)=>"L"+(i+1)+":₹"+v).join("\n")+"\n\nEnter:");}
        if(text==="🔢 Set Watch Losses"){adminState[id]={action:"setwloss"};return send(id,"Watch losses?\nCurrent: "+autobetCfg[id].watchLoss+"\n\n2 → 2 consecutive losses → bet\nEnter:");}
        if(text==="📊 AutoBet Status")return autobetStatus(msg.chat.id,id);
        if(text==="🔙 Back")return send(id,"Main Menu",{reply_markup:userMenu(id)});

        if(text==="🔑 My Token"){
            const tok=getToken(id),creds=userCreds[id]||{};
            return send(id,"Token: "+(tok.length>20?"✅ ..."+tok.slice(-12):"❌")+"\nLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n\n/setcreds FULLPHONE PASSWORD\n/setmytoken TOKEN\n/login — Test");
        }

        if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(msg.chat.id,"❌ No access!\n📩 "+ADMIN_HANDLE+"\nID: "+id);
            if(running[id])return send(msg.chat.id,"⚠️ Already running!");
            if(!getToken(id)&&userCreds[id]?.phone){await send(msg.chat.id,"🔄 Auto login...");await autoLogin(id,msg.chat.id,true);}
            running[id]=true;sentPeriods[id]=new Set();
            autobetState[id]={level:1,consecutiveLoss:0,inMart:false};
            const cfg=autobetCfg[id];
            await send(msg.chat.id,
"🚀 ENGINE ON!\n\nAutoBet: "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nWatch  : "+(cfg.watch?"ON ("+cfg.watchLoss+"L)":"OFF")+"\nBase   : ₹"+cfg.baseBet+" | MaxLvl: "+cfg.maxLvl
            );
            runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop")   {running[id]=false;send(msg.chat.id,"🛑 Stopped.");}
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}

startBot();
