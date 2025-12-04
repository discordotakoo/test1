import fetch from "node-fetch";

export default async function handler(req, res) {
  const { file } = req.query; // file name, e.g., finalUpdatedBaseList.json
  const url = `https://kirka.lukeskywalk.com/${file}`;

  try {
    const r = await fetch(url);
    const data = await r.text();

    res.setHeader("Access-Control-Allow-Origin", "*"); // allow your HTML to fetch it
    res.setHeader("Content-Type", r.headers.get("content-type"));
    res.status(200).send(data);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
