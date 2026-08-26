import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Pattern";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Mark geometry and lockup ratio from the Pattern logo kit: six rounded
// blocks in a 64x64 box, three rows of unequal-width pairs. The kit
// deliberately ships no static lockup file -- the wordmark needs live
// Nunito 900, so lockups are composed in code from this same geometry.
const MARK_BLOCKS = [
  { x: 6, y: 10, w: 26, h: 12, fill: "#1A73E8", opacity: 1 },
  { x: 36, y: 10, w: 22, h: 12, fill: "#0E9F6E", opacity: 0.85 },
  { x: 6, y: 26, w: 22, h: 12, fill: "#C77D0A", opacity: 1 },
  { x: 32, y: 26, w: 26, h: 12, fill: "#1A73E8", opacity: 0.55 },
  { x: 6, y: 42, w: 30, h: 12, fill: "#0E9F6E", opacity: 1 },
  { x: 40, y: 42, w: 18, h: 12, fill: "#C77D0A", opacity: 0.7 },
];

async function loadGoogleFont(cssUrl: string) {
  const css = await fetch(cssUrl).then((res) => res.text());
  const fontUrl = css.match(/src: url\(([^)]+)\)/)?.[1];
  if (!fontUrl) throw new Error(`Could not resolve font URL from Google Fonts CSS: ${cssUrl}`);
  return fetch(fontUrl).then((res) => res.arrayBuffer());
}

export default async function OpengraphImage() {
  const [nunito900, instrumentSans, instrumentSansItalic] = await Promise.all([
    loadGoogleFont("https://fonts.googleapis.com/css2?family=Nunito:wght@900&display=swap"),
    loadGoogleFont("https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,500&display=swap"),
    loadGoogleFont("https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@1,500&display=swap"),
  ]);
  const markSize = 132;
  const gap = markSize * 0.26;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap }}>
          <svg width={markSize} height={markSize} viewBox="0 0 64 64" fill="none">
            {MARK_BLOCKS.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={b.fill} opacity={b.opacity} />
            ))}
          </svg>
          <span
            style={{
              fontFamily: "Nunito",
              fontWeight: 900,
              fontSize: 116,
              letterSpacing: -4,
              color: "#0B0F16",
            }}
          >
            Pattern
          </span>
        </div>
        <div
          style={{
            marginTop: 36,
            fontFamily: "Instrument Sans",
            fontWeight: 500,
            fontSize: 28,
            color: "#4A5462",
            display: "flex",
          }}
        >
          Empower your agents to ship great products with&nbsp;
          <span style={{ fontStyle: "italic" }}>taste</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Nunito", data: nunito900, weight: 900, style: "normal" },
        { name: "Instrument Sans", data: instrumentSans, weight: 500, style: "normal" },
        { name: "Instrument Sans", data: instrumentSansItalic, weight: 500, style: "italic" },
      ],
    }
  );
}
