import https from "node:https";
import { URL } from "node:url";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "docs");

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const SEARCH_QUERIES = [
  `("romantic relationship*"[tiab] OR "romantic love"[tiab] OR "close relationship*"[tiab] OR "intimate relationship*"[tiab] OR dating[tiab] OR courtship[tiab] OR "pair bond*"[tiab])`,
  `("romantic attachment"[tiab] OR attachment[tiab] OR "pair bond*"[tiab] OR bonding[tiab] OR "partner attachment"[tiab]) AND ("romantic relationship*"[tiab] OR partner*[tiab] OR couple*[tiab] OR spouse*[tiab])`,
  `("relationship satisfaction"[tiab] OR "marital satisfaction"[tiab] OR commitment[tiab] OR "relationship quality"[tiab] OR "dyadic coping"[tiab] OR "partner support"[tiab]) AND (couple*[tiab] OR partner*[tiab] OR spouse*[tiab] OR marriage[tiab])`,
  `("romantic love"[tiab] OR "pair bond*"[tiab] OR attachment[tiab] OR courtship[tiab]) AND (neurobiolog*[tiab] OR neural[tiab] OR reward[tiab] OR dopamine[tiab] OR oxytocin[tiab] OR vasopressin[tiab] OR cortisol[tiab] OR fMRI[tiab] OR psychophysiolog*[tiab])`,
  `(jealousy[tiab] OR infidelity[tiab] OR "romantic jealousy"[tiab] OR breakup[tiab] OR "relationship dissolution"[tiab] OR rejection[tiab]) AND ("romantic relationship*"[tiab] OR partner*[tiab] OR spouse*[tiab] OR couple*[tiab])`,
  `("couples therapy"[tiab] OR "marital therapy"[tiab] OR "family therapy"[tiab] OR "marital conflict"[tiab] OR "couple conflict"[tiab] OR "relationship distress"[tiab] OR "emotionally focused therapy"[tiab] OR "behavioral couples therapy"[tiab])`,
  `("sexual satisfaction"[tiab] OR "sexual desire"[tiab] OR "desire discrepancy"[tiab] OR "sexual communication"[tiab] OR intimacy[tiab] OR "sexual function*"[tiab]) AND (partner*[tiab] OR couple*[tiab] OR spouse*[tiab] OR "romantic relationship*"[tiab])`,
  `("Intimate Partner Violence"[MeSH] OR "dating violence"[tiab] OR "partner violence"[tiab] OR "relationship aggression"[tiab] OR stalking[tiab] OR coercive[tiab]) AND (dating[tiab] OR partner*[tiab] OR spouse*[tiab] OR couple*[tiab])`,
  `("relationship quality"[tiab] OR "marital quality"[tiab] OR "relationship satisfaction"[tiab] OR "partner support"[tiab]) AND (health[tiab] OR depression[tiab] OR anxiety[tiab] OR sleep[tiab] OR inflammation[tiab] OR cortisol[tiab] OR adherence[tiab] OR "health behavior"[tiab])`,
];

function fetchUrl(urlStr, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.get(
      url,
      { headers: { "User-Agent": "RomanceRelationshipBot/1.0 (research aggregator)" }, timeout },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function getExistingPmids() {
  const pmids = new Set();
  if (!existsSync(DOCS_DIR)) return pmids;
  const files = readdirSync(DOCS_DIR).filter((f) => f.startsWith("romance-") && f.endsWith(".json"));
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(DOCS_DIR, f), "utf-8"));
      for (const p of data.papers || []) {
        if (p.pmid) pmids.add(p.pmid);
      }
    } catch {}
  }
  return pmids;
}

async function searchPapers(query, retmax = 50) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const raw = await fetchUrl(url);
    const data = JSON.parse(raw);
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[ERROR] PubMed search failed: ${e.message}`);
    return [];
  }
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const ids = pmids.join(",");
  const url = `${PUBMED_FETCH}?db=pubmed&id=${ids}&retmode=xml`;
  try {
    const xml = await fetchUrl(url, 60000);
    return parseXml(xml);
  } catch (e) {
    console.error(`[ERROR] PubMed fetch failed: ${e.message}`);
    return [];
  }
}

function parseXml(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "ArticleTitle");
    const journal = extractTag(block, "<Title>", "</Title>");
    const abstract = extractAbstract(block);
    const pmid = extractTag(block, "<PMID", "</PMID>").replace(/^[^>]*>/, "");
    const dateStr = extractPubDate(block);
    const keywords = extractKeywords(block);
    const link = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";
    if (title) {
      papers.push({ pmid, title, journal, date: dateStr, abstract, url: link, keywords });
    }
  }
  return papers;
}

function extractTag(block, openTag, closeTag) {
  if (!closeTag) closeTag = `</${openTag.split(/[< >]/).filter(Boolean)[0]}>`;
  if (openTag.startsWith("<")) {
    const startIdx = block.indexOf(openTag);
    if (startIdx === -1) return "";
    const contentStart = block.indexOf(">", startIdx) + 1;
    const endIdx = block.indexOf(closeTag, contentStart);
    if (endIdx === -1) return "";
    return block.slice(contentStart, endIdx).replace(/<[^>]+>/g, "").trim();
  }
  return "";
}

function extractAbstract(block) {
  const parts = [];
  const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
  let m;
  while ((m = absRegex.exec(block)) !== null) {
    const labelMatch = m[0].match(/Label="([^"]*)"/);
    const label = labelMatch ? labelMatch[1] : "";
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text) parts.push(label ? `${label}: ${text}` : text);
  }
  return parts.join(" ").slice(0, 2000);
}

function extractPubDate(block) {
  const pdMatch = block.match(/<PubDate>([\s\S]*?)<\/PubDate>/);
  if (!pdMatch) return "";
  const pd = pdMatch[1];
  const y = pd.match(/<Year>(.*?)<\/Year>/)?.[1] || "";
  const m = pd.match(/<Month>(.*?)<\/Month>/)?.[1] || "";
  const d = pd.match(/<Day>(.*?)<\/Day>/)?.[1] || "";
  return [y, m, d].filter(Boolean).join(" ");
}

function extractKeywords(block) {
  const kws = [];
  const kwRegex = /<Keyword>(.*?)<\/Keyword>/g;
  let m;
  while ((m = kwRegex.exec(block)) !== null) {
    if (m[1].trim()) kws.push(m[1].trim());
  }
  return kws;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 7, maxPapers: 40, output: "papers.json" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) opts.days = parseInt(args[i + 1]);
    if (args[i] === "--max-papers" && args[i + 1]) opts.maxPapers = parseInt(args[i + 1]);
    if (args[i] === "--output" && args[i + 1]) opts.output = args[i + 1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const existingPmids = getExistingPmids();
  console.error(`[INFO] Found ${existingPmids.size} existing PMIDs to exclude`);

  const now = new Date();
  const lookback = new Date(now.getTime() - opts.days * 86400000);
  const lookbackStr = `${lookback.getUTCFullYear()}/${String(lookback.getUTCMonth() + 1).padStart(2, "0")}/${String(lookback.getUTCDate()).padStart(2, "0")}`;

  const allPmids = new Set();
  for (const q of SEARCH_QUERIES) {
    const fullQuery = `(${q}) AND "${lookbackStr}"[Date - Publication] : "3000"[Date - Publication]`;
    console.error(`[INFO] Searching: ${q.slice(0, 80)}...`);
    const ids = await searchPapers(fullQuery, opts.maxPapers);
    for (const id of ids) allPmids.add(id);
    await new Promise((r) => setTimeout(r, 500));
  }

  const newPmids = [...allPmids].filter((id) => !existingPmids.has(id));
  console.error(`[INFO] Found ${allPmids.size} total PMIDs, ${newPmids.length} new`);

  if (!newPmids.length) {
    console.error("[INFO] No new papers found");
    const tz = new Date(now.getTime() + 8 * 3600000);
    const dateStr = `${tz.getUTCFullYear()}-${String(tz.getUTCMonth() + 1).padStart(2, "0")}-${String(tz.getUTCDate()).padStart(2, "0")}`;
    const result = { date: dateStr, count: 0, papers: [] };
    writeFileSync(opts.output, JSON.stringify(result, null, 2), "utf-8");
    return;
  }

  const papers = await fetchDetails(newPmids.slice(0, opts.maxPapers));
  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  const tz = new Date(now.getTime() + 8 * 3600000);
  const dateStr = `${tz.getUTCFullYear()}-${String(tz.getUTCMonth() + 1).padStart(2, "0")}-${String(tz.getUTCDate()).padStart(2, "0")}`;
  const result = { date: dateStr, count: papers.length, papers };
  writeFileSync(opts.output, JSON.stringify(result, null, 2), "utf-8");
  console.error(`[INFO] Saved to ${opts.output}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
