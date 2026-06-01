"use client";

import { useRef, useState } from "react";
import { ui } from "./theme";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const NUDGE = 30; // px per nudge, in original-image pixels

type Face = { index: number; x: number; y: number; w: number; h: number; thumb: string };
type Monke = { id: string; thumb: string };

export default function Home() {
  const [session, setSession] = useState<string | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [monkes, setMonkes] = useState<Monke[]>([]);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [offsets, setOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which assigned face the drag-on-result moves.
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const resultImgRef = useRef<HTMLImageElement | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`${API}/api/detect`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail || "detect failed");
      const data = await r.json();
      setSession(data.session);
      setFaces(data.faces);
      setMonkes([]);
      setAssign({});
      setOffsets({});
      setResultUrl(null);
      setSelectedFace(null);
      setDragTarget(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onMonkes(e: React.ChangeEvent<HTMLInputElement>) {
    if (!session || !e.target.files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("session", session);
      Array.from(e.target.files).forEach((f) => fd.append("files", f));
      const r = await fetch(`${API}/api/monkes`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail || "monke upload failed");
      const data = await r.json();
      setMonkes((m) => [...m, ...data.monkes]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pickMonke(monkeId: string) {
    if (selectedFace === null) return;
    setAssign((a) => ({ ...a, [selectedFace]: monkeId }));
    setSelectedFace(null);
  }

  async function composeWith(sid: string, off: typeof offsets) {
    const assignments = Object.entries(assign).map(([fi, mid]) => {
      const o = off[Number(fi)] || { dx: 0, dy: 0 };
      return { face_index: Number(fi), monke_id: mid, dx: o.dx, dy: o.dy };
    });
    const r = await fetch(`${API}/api/compose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sid, assignments }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "compose failed");
    setResultUrl(URL.createObjectURL(await r.blob()));
  }

  async function generate() {
    if (!session) return;
    const unassigned = faces.filter((f) => !assign[f.index]).length;
    if (
      unassigned > 0 &&
      !confirm(`${unassigned} face(s) have no monke and will stay visible. Continue?`)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await composeWith(session, offsets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function nudge(faceIndex: number, dx: number, dy: number) {
    if (!session) return;
    const cur = offsets[faceIndex] || { dx: 0, dy: 0 };
    const next = { ...offsets, [faceIndex]: { dx: cur.dx + dx, dy: cur.dy + dy } };
    setOffsets(next);
    setBusy(true);
    setError(null);
    try {
      await composeWith(session, next);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Drag a monke on the result image. Screen-pixel movement is scaled to
  // original-image pixels (naturalWidth / displayed width). Uses window mouse
  // events so the drag survives the pointer leaving the image.
  function onResultMouseDown(e: React.MouseEvent<HTMLImageElement>) {
    if (dragTarget === null || !session) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const face = dragTarget;
    const sid = session;
    let dx = 0;
    let dy = 0;

    const onMove = (ev: MouseEvent) => {
      dx = ev.clientX - startX;
      dy = ev.clientY - startY;
    };
    const onUp = async () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const img = resultImgRef.current;
      const scale = img && img.clientWidth ? img.naturalWidth / img.clientWidth : 1;
      const ddx = dx * scale;
      const ddy = dy * scale;
      if (Math.abs(ddx) < 1 && Math.abs(ddy) < 1) return; // ignore taps
      const cur = offsets[face] || { dx: 0, dy: 0 };
      const next = { ...offsets, [face]: { dx: cur.dx + ddx, dy: cur.dy + ddy } };
      setOffsets(next);
      setBusy(true);
      setError(null);
      try {
        await composeWith(sid, next);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function reset() {
    if (session) {
      try {
        await fetch(`${API}/api/session/${session}`, { method: "DELETE" });
      } catch {
        /* best effort */
      }
    }
    setSession(null);
    setFaces([]);
    setMonkes([]);
    setAssign({});
    setOffsets({});
    setSelectedFace(null);
    setResultUrl(null);
    setError(null);
    setDragTarget(null);
  }

  const assignedCount = faces.filter((f) => assign[f.index]).length;

  return (
    <main style={S.page}>
      <header style={S.header}>
        <img src="/brand/monkedao-icon.png" alt="MonkeDAO" style={{ height: 44 }} />
        <div>
          <h1 style={S.h1}>MonkeMask</h1>
          <p style={S.tagline}>Cover faces with monkes. No editing skills needed.</p>
        </div>
      </header>

      <p style={S.privacy}>
        🔒 Your photo is processed on the server and deleted right after — never
        stored or shared.
      </p>

      {error && <div style={S.errorBox}>⚠️ {error}</div>}

      {/* Step 1 */}
      <section style={S.card}>
        <h2 style={S.h2}>
          <span style={S.step}>1</span> Upload the event photo
        </h2>
        <label style={S.upload}>
          {faces.length ? "Choose a different photo" : "Choose a photo"}
          <input type="file" accept="image/*" onChange={onPhoto} disabled={busy} hidden />
        </label>
      </section>

      {/* Step 2 */}
      {faces.length > 0 && (
        <section style={S.card}>
          <h2 style={S.h2}>
            <span style={S.step}>2</span> Pair each face with a monke
            <span style={S.counter}>
              {assignedCount}/{faces.length} done
            </span>
          </h2>

          {selectedFace !== null && (
            <p style={{ color: ui.accent, fontWeight: 700 }}>
              Now click a monke to assign it to face #{selectedFace}
            </p>
          )}

          <p style={S.label}>Faces — click one to select it:</p>
          <div style={S.grid}>
            {faces.map((f) => (
              <button
                key={f.index}
                style={S.thumbBtn(selectedFace === f.index, !!assign[f.index])}
                onClick={() => setSelectedFace(f.index)}
                title={`face #${f.index}`}
              >
                <img src={f.thumb} alt={`face ${f.index}`} style={S.thumbImg} />
                <span style={S.thumbTag}>
                  #{f.index} {assign[f.index] ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>

          <p style={S.label}>Monkes — upload, then click one to assign it:</p>
          <label style={S.uploadSmall}>
            + Add monke images
            <input type="file" accept="image/*" multiple onChange={onMonkes} disabled={busy} hidden />
          </label>
          <div style={S.grid}>
            {monkes.map((m) => (
              <button
                key={m.id}
                style={S.thumbBtn(false, false)}
                onClick={() => pickMonke(m.id)}
                disabled={selectedFace === null}
                title={selectedFace === null ? "select a face first" : `assign to face #${selectedFace}`}
              >
                <img src={m.thumb} alt={m.id} style={S.thumbImg} />
              </button>
            ))}
          </div>

          <button onClick={generate} disabled={busy} style={S.primary}>
            {busy ? "Working…" : "Generate →"}
          </button>
        </section>
      )}

      {/* Step 3 */}
      {resultUrl && (
        <section style={S.card}>
          <h2 style={S.h2}>
            <span style={S.step}>3</span> Result
          </h2>
          <img
            ref={resultImgRef}
            src={resultUrl}
            alt="result"
            style={{
              ...S.result,
              cursor: dragTarget !== null ? "move" : "default",
              userSelect: "none",
            }}
            draggable={false}
            onMouseDown={onResultMouseDown}
          />

          <details style={{ marginTop: 16 }} open>
            <summary style={S.summary}>Adjust a monke (if two overlap or one sits off)</summary>
            <p style={S.label}>
              Overlapping monkes are separated automatically. To fine-tune, pick a
              face below then <strong>drag it on the image</strong> — or use the arrows.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {faces
                .filter((f) => assign[f.index])
                .map((f) => (
                  <div key={f.index} style={S.nudgeRow(dragTarget === f.index)}>
                    <button
                      style={S.facePick(dragTarget === f.index)}
                      onClick={() => setDragTarget(dragTarget === f.index ? null : f.index)}
                      title="select, then drag on the image"
                    >
                      #{f.index} {dragTarget === f.index ? "✋" : ""}
                    </button>
                    <button style={S.arrow} onClick={() => nudge(f.index, -NUDGE, 0)} disabled={busy}>◀</button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <button style={S.arrow} onClick={() => nudge(f.index, 0, -NUDGE)} disabled={busy}>▲</button>
                      <button style={S.arrow} onClick={() => nudge(f.index, 0, NUDGE)} disabled={busy}>▼</button>
                    </div>
                    <button style={S.arrow} onClick={() => nudge(f.index, NUDGE, 0)} disabled={busy}>▶</button>
                  </div>
                ))}
            </div>
            {dragTarget !== null && (
              <p style={{ ...S.label, color: ui.accent }}>
                Dragging face #{dragTarget}. Drag on the image above to move its monke.
              </p>
            )}
          </details>

          <div style={{ marginTop: 18, display: "flex", gap: 14, alignItems: "center" }}>
            <a href={resultUrl} download="monkemasked.png" style={S.download}>
              ⬇ Download
            </a>
            <button onClick={reset} style={S.ghost}>
              Start over
            </button>
          </div>
        </section>
      )}

      <footer style={S.footer}>
        Built by{" "}
        <a href="https://github.com/f0x1777" style={{ color: ui.accent }}>
          @f0x1777
        </a>{" "}
        of the Chapter of Argentina 🇦🇷 to the rest of the world.
      </footer>
    </main>
  );
}

const S: Record<string, any> = {
  page: { maxWidth: 880, margin: "0 auto", padding: "40px 20px 60px" },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 8 },
  h1: { margin: 0, fontSize: 38, fontWeight: 700, letterSpacing: -1 },
  tagline: { margin: "2px 0 0", color: ui.textDim, fontSize: 15 },
  privacy: { color: ui.textDim, fontSize: 14, margin: "8px 0 24px" },
  errorBox: {
    background: ui.danger,
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 10,
    marginBottom: 20,
  },
  card: {
    background: ui.panel,
    border: `1px solid ${ui.panelBorder}`,
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },
  h2: { marginTop: 0, fontSize: 20, display: "flex", alignItems: "center", gap: 10 },
  step: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: ui.accent,
    color: ui.accentText,
    fontWeight: 700,
    fontSize: 15,
  },
  counter: { marginLeft: "auto", fontSize: 14, color: ui.good, fontWeight: 500 },
  label: { color: ui.textDim, fontSize: 14, marginTop: 18, marginBottom: 8 },
  grid: { display: "flex", flexWrap: "wrap", gap: 10 },
  thumbBtn: (sel: boolean, done: boolean) => ({
    position: "relative",
    padding: 0,
    background: "transparent",
    border: `3px solid ${sel ? ui.selected : done ? ui.good : "transparent"}`,
    borderRadius: 12,
    cursor: "pointer",
  }),
  thumbImg: {
    width: 76,
    height: 76,
    objectFit: "cover",
    borderRadius: 9,
    display: "block",
  },
  thumbTag: {
    position: "absolute",
    bottom: 4,
    left: 4,
    background: "rgba(24,70,35,0.85)",
    color: ui.ivory,
    fontSize: 11,
    padding: "1px 6px",
    borderRadius: 6,
  },
  upload: {
    display: "inline-block",
    background: ui.accent,
    color: ui.accentText,
    padding: "12px 22px",
    borderRadius: 10,
    fontWeight: 700,
    cursor: "pointer",
  },
  uploadSmall: {
    display: "inline-block",
    background: "transparent",
    color: ui.ivory,
    border: `1px dashed ${ui.panelBorder}`,
    padding: "8px 16px",
    borderRadius: 9,
    fontWeight: 500,
    cursor: "pointer",
    marginBottom: 4,
  },
  primary: {
    marginTop: 22,
    padding: "14px 28px",
    fontSize: 16,
    borderRadius: 10,
    border: "none",
    background: ui.accent,
    color: ui.accentText,
    fontWeight: 700,
    cursor: "pointer",
  },
  result: { maxWidth: "100%", borderRadius: 12, display: "block" },
  summary: { cursor: "pointer", fontWeight: 600, color: ui.ivory },
  nudgeRow: (active: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: ui.bg,
    padding: "8px 12px",
    borderRadius: 10,
    border: `2px solid ${active ? ui.accent : "transparent"}`,
  }),
  facePick: (active: boolean) => ({
    minWidth: 44,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${active ? ui.accent : ui.panelBorder}`,
    background: active ? ui.accent : ui.panel,
    color: active ? ui.accentText : ui.ivory,
    fontWeight: 700,
    cursor: "pointer",
  }),
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${ui.panelBorder}`,
    background: ui.panel,
    color: ui.ivory,
    cursor: "pointer",
  },
  download: {
    background: ui.good,
    color: ui.accentText,
    padding: "12px 22px",
    borderRadius: 10,
    fontWeight: 700,
    textDecoration: "none",
  },
  ghost: {
    background: "transparent",
    color: ui.textDim,
    border: `1px solid ${ui.panelBorder}`,
    padding: "12px 18px",
    borderRadius: 10,
    cursor: "pointer",
  },
  footer: { color: ui.textDim, fontSize: 13, marginTop: 28, textAlign: "center" },
};
