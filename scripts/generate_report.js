import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { URL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.ZHIPU_API_BASE || "https://open.bigmodel.cn/api/coding/paas/v4";
const MODELS = ["GLM-5-Turbo", "GLM-4.7", "GLM-4.7-Flash"];

const SYSTEM_PROMPT = `你是浪漫關係與親密關係研究領域的資深研究員與科學傳播者。你的任務是：
1. 從提供的醫學與心理學文獻中，篩選出最具研究價值與臨床意義的論文
2. 對每篇論文進行繁體中文摘要、分類
3. 評估其實用性（高/中/低）
4. 生成適合專業人員與大眾閱讀的日報

輸出格式要求：
- 語言：繁體中文（台灣用語）
- 專業但易懂
- 每篇論文需包含：中文標題、原文標題、一句話總結、實用性、分類標籤
- 最後提供今日精選 TOP 5-8（最重要/最影響臨床實踐的論文）
回傳格式必須是純 JSON，不要用 markdown code block 包裹。`;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: "", output: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) opts.input = args[i + 1];
    if (args[i] === "--output" && args[i + 1]) opts.output = args[i + 1];
  }
  return opts;
}

function loadPapers(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function postJson(urlStr, body, headers, timeout = 660000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
        timeout,
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
          } else {
            resolve(buf);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.write(data);
    req.end();
  });
}

async function analyzePapers(apiKey, papersData) {
  const dateStr = papersData.date;
  const paperCount = papersData.count;
  const papersText = JSON.stringify(papersData.papers, null, 2);

  const prompt = `以下是 ${dateStr} 從 PubMed 抓取的最新浪漫關係與親密關係研究文獻（共 ${paperCount} 篇）。

請進行以下分析，並以 JSON 格式回傳（不要用 markdown code block）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今天文獻的整體趨勢與亮點",
  "top_picks": [
    {
      "rank": 1,
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結（繁體中文，點出核心發現與意義）",
      "clinical_utility": "高/中/低",
      "utility_reason": "為什麼實用的一句話說明",
      "tags": ["標籤1", "標籤2"],
      "url": "原文連結",
      "emoji": "相關emoji"
    }
  ],
  "all_papers": [
    {
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結",
      "clinical_utility": "高/中/低",
      "tags": ["標籤1"],
      "url": "連結",
      "emoji": "emoji"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2"],
  "topic_distribution": {
    "浪漫依附": 3,
    "關係滿意度": 2
  }
}

原始文獻資料：
${papersText}

請篩選出最重要的 TOP 5-8 篇論文放入 top_picks（按重要性排序），其餘放入 all_papers。
每篇 paper 的 tags 請從以下選擇：浪漫依附、關係滿意度、伴侶衝突、嫉妒與不忠、分手與失落、伴侶治療、性行為與親密、約會暴力、神經科學、荷爾蒙、演化心理學、婚姻與家庭、LGBTQ+關係、社會心理學、壓力與健康、依戀理論、育兒與家庭、跨文化研究、情感調節、溝通模式、道德與倫理。
記住：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const payload = {
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: 100000,
        };

        const raw = await postJson(`${API_BASE}/chat/completions`, payload, headers, 660000);
        const resp = JSON.parse(raw);
        let text = resp.choices?.[0]?.message?.content?.trim() || "";

        if (text.startsWith("```")) {
          text = text.split("\n").slice(1).join("\n").replace(/```$/, "").trim();
        }

        let result;
        try {
          result = JSON.parse(text);
        } catch {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("No JSON found in response");
          }
        }

        console.error(`[INFO] Analysis complete: ${result.top_picks?.length || 0} top picks, ${result.all_papers?.length || 0} total`);
        return result;
      } catch (e) {
        console.error(`[WARN] ${model} attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  console.error("[ERROR] All models and attempts failed");
  return null;
}

function generateHtml(analysis) {
  const dateStr = analysis.date || new Date().toISOString().slice(0, 10);
  const dateParts = dateStr.split("-");
  const dateDisplay = dateParts.length === 3
    ? `${dateParts[0]}年${parseInt(dateParts[1])}月${parseInt(dateParts[2])}日`
    : dateStr;

  const summary = analysis.market_summary || "";
  const topPicks = analysis.top_picks || [];
  const allPapers = analysis.all_papers || [];
  const keywords = analysis.keywords || [];
  const topicDist = analysis.topic_distribution || {};

  let topPicksHtml = "";
  for (const pick of topPicks) {
    const tagsHtml = (pick.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
    const util = pick.clinical_utility || "中";
    const utilityClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
    topPicksHtml += `
        <div class="news-card featured">
          <div class="card-header">
            <span class="rank-badge">#${pick.rank || ""}</span>
            <span class="emoji-icon">${pick.emoji || "\uD83D\uDCD6"}</span>
            <span class="${utilityClass}">${util}實用性</span>
          </div>
          <h3>${pick.title_zh || pick.title_en || ""}</h3>
          <p class="journal-source">${pick.journal || ""} &middot; ${pick.title_en || ""}</p>
          <p>${pick.summary || ""}</p>
          <div class="card-footer">
            ${tagsHtml}
            <a href="${pick.url || "#"}" target="_blank">閱讀原文 &rarr;</a>
          </div>
        </div>`;
  }

  let allPapersHtml = "";
  for (const paper of allPapers) {
    const tagsHtml = (paper.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
    const util = paper.clinical_utility || "中";
    const utilityClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
    allPapersHtml += `
        <div class="news-card">
          <div class="card-header-row">
            <span class="emoji-sm">${paper.emoji || "\uD83D\uDCD6"}</span>
            <span class="${utilityClass} utility-sm">${util}</span>
          </div>
          <h3>${paper.title_zh || paper.title_en || ""}</h3>
          <p class="journal-source">${paper.journal || ""}</p>
          <p>${paper.summary || ""}</p>
          <div class="card-footer">
            ${tagsHtml}
            <a href="${paper.url || "#"}" target="_blank">PubMed &rarr;</a>
          </div>
        </div>`;
  }

  const keywordsHtml = keywords.map((k) => `<span class="keyword">${k}</span>`).join("");
  let topicBarsHtml = "";
  if (Object.keys(topicDist).length) {
    const maxCount = Math.max(...Object.values(topicDist), 1);
    for (const [topic, count] of Object.entries(topicDist)) {
      const widthPct = Math.round((count / maxCount) * 100);
      topicBarsHtml += `
            <div class="topic-row">
              <span class="topic-name">${topic}</span>
              <div class="topic-bar-bg"><div class="topic-bar" style="width:${widthPct}%"></div></div>
              <span class="topic-count">${count}</span>
            </div>`;
    }
  }

  const totalCount = topPicks.length + allPapers.length;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Romance Relationship &middot; 浪漫關係研究日報 &middot; ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} 浪漫關係研究日報，由 AI 自動彙整 PubMed 最新論文"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(140,79,43,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(140,79,43,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(61,36,15,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(61,36,15,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff7f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(118,100,83,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(140,79,43,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 100px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .links-banner { margin-top: 48px; display: flex; flex-direction: column; gap: 10px; animation: fadeUp 0.5s ease 0.4s both; }
  .banner-link { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(61,36,15,0.04); }
  .banner-link:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .banner-icon { font-size: 28px; flex-shrink: 0; }
  .banner-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .banner-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 70px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">\uD83D\uDC91</div>
    <div class="header-text">
      <h1>Romance Relationship &middot; 浪漫關係研究日報</h1>
      <div class="header-meta">
        <span class="badge badge-date">\uD83D\uDCC5 ${dateDisplay}</span>
        <span class="badge badge-count">\uD83D\uDCCA ${totalCount} 篇文獻</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>\uD83D\uDCCB 今日文獻趨勢</h2>
    <p class="summary-text">${summary}</p>
  </div>

  ${topPicksHtml ? `<div class="section"><div class="section-title"><span class="section-icon">\u2B50</span>今日精選 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${allPapersHtml ? `<div class="section"><div class="section-title"><span class="section-icon">\uD83D\uDCDA</span>其他值得關注的文獻</div>${allPapersHtml}</div>` : ""}

  ${topicBarsHtml ? `<div class="topic-section section"><div class="section-title"><span class="section-icon">\uD83D\uDCCA</span>主題分佈</div>${topicBarsHtml}</div>` : ""}

  ${keywordsHtml ? `<div class="keywords-section section"><div class="section-title"><span class="section-icon">\uD83C\uDFF7\uFE0F</span>關鍵字</div><div class="keywords">${keywordsHtml}</div></div>` : ""}

  <div class="links-banner">
    <a href="https://www.leepsyclinic.com/" class="banner-link" target="_blank">
      <span class="banner-icon">\uD83C\uDFE5</span>
      <span class="banner-name">李政洋身心診所首頁</span>
      <span class="banner-arrow">&rarr;</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="banner-link" target="_blank">
      <span class="banner-icon">\uD83D\uDCDC</span>
      <span class="banner-name">訂閱電子報</span>
      <span class="banner-arrow">&rarr;</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="banner-link" target="_blank">
      <span class="banner-icon">\u2615</span>
      <span class="banner-name">Buy Me a Coffee</span>
      <span class="banner-arrow">&rarr;</span>
    </a>
  </div>

  <footer>
    <span>資料來源：PubMed &middot; 分析模型：GLM-5-Turbo</span>
    <span><a href="https://github.com/u8901006/romance-relationship">GitHub</a></span>
  </footer>
</div>
</body>
</html>`;
}

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    console.error("[ERROR] ZHIPU_API_KEY env var is required");
    process.exit(1);
  }
  if (!opts.input || !opts.output) {
    console.error("[ERROR] --input and --output are required");
    process.exit(1);
  }

  const papersData = loadPapers(opts.input);
  let analysis;

  if (!papersData?.papers?.length) {
    console.error("[WARN] No papers found, generating empty report");
    const now = new Date();
    const tz = new Date(now.getTime() + 8 * 3600000);
    const dateStr = `${tz.getUTCFullYear()}-${String(tz.getUTCMonth() + 1).padStart(2, "0")}-${String(tz.getUTCDate()).padStart(2, "0")}`;
    analysis = {
      date: dateStr,
      market_summary: "今日 PubMed 暫無新的浪漫關係研究文獻更新。請明天再查看。",
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
    };
  } else {
    analysis = await analyzePapers(apiKey, papersData);
    if (!analysis) {
      console.error("[ERROR] Analysis failed");
      process.exit(1);
    }
  }

  const html = generateHtml(analysis);
  const outDir = dirname(opts.output);
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(opts.output, html, "utf-8");
  console.error(`[INFO] Report saved to ${opts.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
