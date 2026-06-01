"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type Face = { index: number; x: number; y: number; w: number; h: number; thumb: string };
type Monke = { id: string; thumb: string };

const NUDGE = 30; // px per nudge, in original-image pixels

export default function Home() {
  const [session, setSession] = useState<string | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [monkes, setMonkes] = useState<Monke[]>([]);
  const [assign, setAssign] = useState<Record<number, string>>({}); // faceIndex -> monkeId
  const [offsets, setOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setResultUrl(null);
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
      await recompose(session);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function recompose(sid: string) {
    const assignments = Object.entries(assign).map(([fi, mid]) => {
      const o = offsets[Number(fi)] || { dx: 0, dy: 0 };
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

  async function nudge(faceIndex: number, dx: number, dy: number) {
    if (!session) return;
    const cur = offsets[faceIndex] || { dx: 0, dy: 0 };
    const next = { ...offsets, [faceIndex]: { dx: cur.dx + dx, dy: cur.dy + dy } };
    setOffsets(next);
    setBusy(true);
    setError(null);
    try {
      // recompose with the updated offset (read from `next`, not stale state)
      const assignments = Object.entries(assign).map(([fi, mid]) => {
        const o = next[Number(fi)] || { dx: 0, dy: 0 };
        return { face_index: Number(fi), monke_id: mid, dx: o.dx, dy: o.dy };
      });
      const r = await fetch(`${API}/api/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, assignments }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "compose failed");
      setResultUrl(URL.createObjectURL(await r.blob()));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
  }

  const card: React.CSSProperties = {
    background: "#16224a",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  };
  const thumb = (sel: boolean): React.CSSProperties => ({
    width: 72,
    height: 72,
    objectFit: "cover",
    borderRadius: 8,
    cursor: "pointer",
    border: sel ? "3px solid #34d7c0" : "3px solid transparent",
  });

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ marginBottom: 4 }}>MonkeMask 🐵</h1>
      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Cover faces with monkes. Pick a face, pick its monke, generate. Your photo
        is processed on the server and deleted right after — never stored or shared.
      </p>

      {error && (
        <div style={{ ...card, background: "#5a1d1d" }}>⚠️ {error}</div>
      )}

      {/* Step 1: photo */}
      <section style={card}>
        <h2 style={{ marginTop: 0 }}>1. Upload the event photo</h2>
        <input type="file" accept="image/*" onChange={onPhoto} disabled={busy} />
      </section>

      {/* Step 2: faces + monkes + pairing */}
      {faces.length > 0 && (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>
            2. Pair each face with a monke
            {selectedFace !== null && (
              <span style={{ color: "#34d7c0" }}> — now pick a monke for face #{selectedFace}</span>
            )}
          </h2>

          <p style={{ opacity: 0.8 }}>Faces ({faces.length}). Click one to select it:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {faces.map((f) => (
              <div key={f.index} style={{ textAlign: "center" }}>
                <img
                  src={f.thumb}
                  alt={`face ${f.index}`}
                  style={thumb(selectedFace === f.index)}
                  onClick={() => setSelectedFace(f.index)}
                />
                <div style={{ fontSize: 12 }}>
                  #{f.index}
                  {assign[f.index] ? " ✅" : " ❌"}
                </div>
              </div>
            ))}
          </div>

          <p style={{ opacity: 0.8, marginTop: 20 }}>
            Upload monke images, then click one to assign it to the selected face:
          </p>
          <input type="file" accept="image/*" multiple onChange={onMonkes} disabled={busy} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            {monkes.map((m) => (
              <img
                key={m.id}
                src={m.thumb}
                alt={m.id}
                style={thumb(false)}
                onClick={() => pickMonke(m.id)}
                title={selectedFace === null ? "select a face first" : `assign to face #${selectedFace}`}
              />
            ))}
          </div>

          <button
            onClick={generate}
            disabled={busy}
            style={{
              marginTop: 20,
              padding: "12px 24px",
              fontSize: 16,
              borderRadius: 8,
              border: "none",
              background: "#34d7c0",
              color: "#0f1a38",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {busy ? "Working…" : "3. Generate"}
          </button>
        </section>
      )}

      {/* Step 3: result + manual adjust */}
      {resultUrl && (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Done!</h2>
          <img src={resultUrl} alt="result" style={{ maxWidth: "100%", borderRadius: 8 }} />

          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Adjust a monke (if two overlap or one sits off)
            </summary>
            <p style={{ opacity: 0.8, fontSize: 14 }}>
              Monkes that overlap are separated automatically. Use the arrows to
              nudge any one by hand; the image updates each time.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              {faces
                .filter((f) => assign[f.index])
                .map((f) => (
                  <div
                    key={f.index}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <strong>#{f.index}</strong>
                    <button onClick={() => nudge(f.index, -NUDGE, 0)} disabled={busy}>◀</button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button onClick={() => nudge(f.index, 0, -NUDGE)} disabled={busy}>▲</button>
                      <button onClick={() => nudge(f.index, 0, NUDGE)} disabled={busy}>▼</button>
                    </div>
                    <button onClick={() => nudge(f.index, NUDGE, 0)} disabled={busy}>▶</button>
                  </div>
                ))}
            </div>
          </details>

          <div style={{ marginTop: 14 }}>
            <a
              href={resultUrl}
              download="monkemasked.png"
              style={{ color: "#34d7c0", fontWeight: 700, marginRight: 16 }}
            >
              ⬇ Download
            </a>
            <button onClick={reset} style={{ cursor: "pointer" }}>
              Start over
            </button>
          </div>
        </section>
      )}

      <footer style={{ opacity: 0.6, fontSize: 13, marginTop: 24 }}>
        Built by @f0x1777 of the Chapter of Argentina 🇦🇷 to the rest of the world.
      </footer>
    </main>
  );
}
