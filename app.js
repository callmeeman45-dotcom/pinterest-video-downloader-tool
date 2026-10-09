const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3500;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

// Follow pin.it short links to the real pinterest.com pin URL
async function resolveShortLink(url) {
  if (url.includes("pin.it")) {
    try {
      const res = await axios.get(url, {
        maxRedirects: 5,
        headers: BROWSER_HEADERS,
      });
      return res.request.res.responseUrl || url;
    } catch (err) {
      return url;
    }
  }
  return url;
}

// Scrape the pin page for a direct mp4 video URL only.
// If the pin is an Idea/Story pin (HLS-only, no mp4), we treat it as unsupported.
async function extractPinData(url) {
  const { data: html } = await axios.get(url, { headers: BROWSER_HEADERS });
  const $ = cheerio.load(html);

  let videoUrl = null;
  const match = html.match(/"url":"(https:\/\/v\d*\.pinimg\.com\/videos\/[^"]+\.mp4)"/);
  if (match) {
    videoUrl = match[1].replace(/\\\//g, "/");
  }

  const isUnsupportedFormat = !videoUrl && html.includes("video_list");

  const thumbnail = $('meta[property="og:image"]').attr("content") || null;
  const title = $('meta[property="og:title"]').attr("content") || null;

  return { videoUrl, thumbnail, title, isUnsupportedFormat };
}

// Home page
app.get("/", (req, res) => {
  res.render("index", { result: null, error: null, submittedUrl: "" });
});

// Handle form submission
app.post("/extract", async (req, res) => {
  const { pinUrl } = req.body;

  if (!pinUrl) {
    return res.render("index", { result: null, error: "Please paste a link.", submittedUrl: "" });
  }

  try {
    const resolvedUrl = await resolveShortLink(pinUrl.trim());
    const data = await extractPinData(resolvedUrl);

    if (data.isUnsupportedFormat) {
      return res.render("index", {
        result: null,
        error: "This is a multi-page (Idea) pin, which isn't supported yet. Please use a regular video pin link.",
        submittedUrl: pinUrl,
      });
    }

    if (!data.videoUrl) {
      return res.render("index", {
        result: null,
        error: "No video found on this pin. Make sure it's a video pin.",
        submittedUrl: pinUrl,
      });
    }

    res.render("index", { result: data, error: null, submittedUrl: pinUrl });
  } catch (err) {
    console.error(err.message);
    res.render("index", {
      result: null,
      error: "Something went wrong fetching that pin. Try again.",
      submittedUrl: pinUrl,
    });
  }
});

// Stream the direct mp4 straight through — no conversion needed
app.get("/download", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing video URL");

  try {
    const response = await axios({
      method: "GET",
      url,
      responseType: "stream",
      headers: {
        Referer: "https://www.pinterest.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    console.log("Video content-length:", response.headers["content-length"]);

    res.setHeader("Content-Disposition", "attachment; filename=pinterest-video.mp4");
    res.setHeader("Content-Type", "application/octet-stream");
    response.data.pipe(res);
  } catch (err) {
    console.error("Download error:", err.message);
    if (err.response) {
      console.error("Pinterest CDN responded with status:", err.response.status);
    }
    res.status(500).send("Download failed");
  }
});



app.get("/how-to-download-pinterest-videos", (req, res) => {
  res.render("guide");
});



const BASE_URL = "https://pinterest-video-downloader-tool.vercel.app/";

// Pages you want Google to index
const sitemapPages = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/how-to-download-pinterest-videos", changefreq: "monthly", priority: "0.8" },
  // Add more pages here later, e.g. { path: "/privacy-policy", changefreq: "yearly", priority: "0.3" }
];

app.get("/sitemap.xml", (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const urls = sitemapPages
    .map(
      (p) => `  <url>
    <loc>${BASE_URL}${p.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  res.header("Content-Type", "application/xml");
  res.send(xml);
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /
Disallow: /download
Disallow: /extract

Sitemap: ${BASE_URL}/sitemap.xml`);
});




app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});