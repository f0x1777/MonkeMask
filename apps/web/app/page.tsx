"use client";

import { useRef, useState } from "react";
import { ui } from "./theme";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const NUDGE = 30; // px per nudge, in original-image pixels

type Face = { index: number; x: number; y: number; w: number; h: number; thumb: string };
type Monke = { id: string; thumb: string };
type Person = { person_id: string; name: string; monke_id: string; n_refs: number; usable_refs: number };

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

  // Auto-suggest (in-session recognition).
  const [people, setPeople] = useState<Person[]>([]);
  const [pName, setPName] = useState("");
  const [pMonke, setPMonke] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<number[]>([]);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);

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
      setPeople([]);
      setUnmatched([]);
      setSuggestMsg(null);
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

  async function addPerson(e: React.ChangeEvent<HTMLInputElement>) {
    if (!session || !pName || !pMonke || !e.target.files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("session", session);
      fd.append("name", pName);
      fd.append("monke_id", pMonke);
      Array.from(e.target.files).forEach((f) => fd.append("faces", f));
      const r = await fetch(`${API}/api/people`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail || "add person failed");
      const p: Person = await r.json();
      setPeople((ps) => [...ps, p]);
      setPName("");
      setPMonke(null);
      if (p.usable_refs === 0)
        setError(`No face found in ${p.name}'s reference photo(s) — not enrolled. Add a clearer photo.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function autoSuggest() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setSuggestMsg(null);
    try {
      const r = await fetch(`${API}/api/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "suggest failed");
      const data = await r.json();
      setAssign((a) => {
        const next = { ...a };
        for (const s of data.suggestions) next[s.face_index] = s.monke_id;
        return next;
      });
      setUnmatched(data.unmatched);
      setSuggestMsg(
        `Matched ${data.suggestions.length} of ${faces.length} faces.` +
          (data.unmatched.length ? ` ${data.unmatched.length} not recognized.` : "")
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function useGenericForRest() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/generic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "generic failed");
      const g = await r.json();
      setMonkes((m) => (m.some((x) => x.id === g.id) ? m : [...m, g]));
      setAssign((a) => {
        const next = { ...a };
        for (const fi of unmatched) next[fi] = g.id;
        return next;
      });
      setUnmatched([]);
      setSuggestMsg("Unrecognized faces set to the generic DAOJones monke.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
    setPeople([]);
    setUnmatched([]);
    setSuggestMsg(null);
    setPName("");
    setPMonke(null);
  }

  const assignedCount = faces.filter((f) => assign[f.index]).length;

  return (
    <>
      <div className="monke-wash" />
      <main style={S.page}>
        {/* ---------- HERO ---------- */}
        <header style={S.hero} className="fade-up">
          <img
            src="/brand/monkedao-logo-horizontal.png"
            alt="MonkeDAO"
            style={S.heroLogo}
          />
          <h1 style={S.h1}>
            Monke<span style={{ color: ui.accent }}>Mask</span>{" "}
            <span style={S.heroMonke} aria-hidden>
              <img src="/brand/daojones.png" alt="" style={{ width: 54, height: 54 }} />
            </span>
          </h1>
          <p style={S.tagline}>
            Cover every face in a group photo with a monke — <strong>no editing
            skills needed.</strong> 🐵
          </p>
          <div style={S.badges}>
            <span style={S.badge}>🔒 100% private</span>
            <span style={S.badge}>⚡ Auto face detection</span>
            <span style={S.badge}>🎨 Your own monkes</span>
            <span style={S.badge}>🇦🇷 by MonkeDAO Argentina</span>
          </div>
        </header>

        <p style={S.privacy}>
          🔒 Your photo is processed on the server and deleted right after — never
          stored or shared.
        </p>

        {error && (
          <div style={S.errorBox} className="pop-in">
            ⚠️ {error}
          </div>
        )}

        {/* Step 1 */}
        <section style={S.card} className="fade-up">
          <h2 style={S.h2}>
            <span style={S.step}>1</span> 📸 Upload the event photo
          </h2>
          <label style={S.upload} className="lift">
            {faces.length ? "🔄 Choose a different photo" : "⬆️ Choose a photo"}
            <input type="file" accept="image/*" onChange={onPhoto} disabled={busy} hidden />
          </label>
          {busy && !faces.length && (
            <span style={S.spinnerRow}>
              <span style={S.spinner} /> detecting faces…
            </span>
          )}
        </section>

        {/* Step 2 */}
        {faces.length > 0 && (
          <section style={S.card} className="fade-up">
          <h2 style={S.h2}>
            <span style={S.step}>2</span> 🐵 Pair each face with a monke
            <span style={S.counter}>
              {assignedCount === faces.length ? "✅ " : ""}
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

          {/* Auto-suggest (optional) */}
          <details style={{ marginTop: 18 }}>
            <summary style={S.summary}>
              ✨ Auto-suggest — recognize people and fill the pairs for you
            </summary>
            <p style={S.label}>
              Add each person: their name, pick their monke above, and upload one or
              more clear photos of their face. Then hit Auto-suggest. Reference
              photos are processed on the server and deleted with your session.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <input
                placeholder="Person name"
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                style={S.input}
              />
              <select
                value={pMonke ?? ""}
                onChange={(e) => setPMonke(e.target.value || null)}
                style={S.input}
              >
                <option value="">— their monke —</option>
                {monkes.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    monke {i + 1} ({m.id})
                  </option>
                ))}
              </select>
              <label style={{ ...S.uploadSmall, opacity: pName && pMonke ? 1 : 0.5 }}>
                + Add reference face(s)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={addPerson}
                  disabled={busy || !pName || !pMonke}
                  hidden
                />
              </label>
            </div>

            {people.length > 0 && (
              <ul style={{ fontSize: 14, color: ui.textDim }}>
                {people.map((p) => (
                  <li key={p.person_id}>
                    {p.name} — {p.usable_refs}/{p.n_refs} usable reference photo(s)
                    {p.usable_refs === 0 ? " ⚠️ not enrolled" : " ✓"}
                  </li>
                ))}
              </ul>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
              <button
                onClick={autoSuggest}
                disabled={busy || people.length === 0}
                style={S.secondary}
              >
                ✨ Auto-suggest
              </button>
              {unmatched.length > 0 && (
                <button onClick={useGenericForRest} disabled={busy} style={S.secondary}>
                  Use DAOJones for the {unmatched.length} unrecognized
                </button>
              )}
            </div>
            {suggestMsg && <p style={{ ...S.label, color: ui.good }}>{suggestMsg}</p>}
          </details>

          <button onClick={generate} disabled={busy} style={S.primary} className="lift">
            {busy ? (
              <>
                <span style={S.spinner} /> Working…
              </>
            ) : (
              "✨ Generate"
            )}
          </button>
        </section>
      )}

      {/* Step 3 */}
      {resultUrl && (
        <section style={S.card} className="fade-up">
          <h2 style={S.h2}>
            <span style={S.step}>3</span> 🎉 Result
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

          <div style={{ marginTop: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <a href={resultUrl} download="monkemasked.png" style={S.download} className="lift">
              ⬇️ Download
            </a>
            <button onClick={reset} style={S.ghost}>
              ↺ Start over
            </button>
          </div>
        </section>
      )}

        {/* ---------- FOOTER ---------- */}
        <footer style={S.footer}>
          <img src="/brand/monkedao-icon.png" alt="MonkeDAO" style={{ height: 40, opacity: 0.9 }} />
          <p style={S.footerTagline}>
            <strong>MonkeMask</strong> — privacy for the troop. 🐵💚
          </p>
          <div style={S.footerLinks}>
            <a href="https://monkedao.io" target="_blank" rel="noreferrer" style={S.footerLink}>
              🌐 MonkeDAO
            </a>
            <a href="https://github.com/f0x1777/MonkeMask" target="_blank" rel="noreferrer" style={S.footerLink}>
              💻 GitHub
            </a>
            <a href="https://solanamonkey.business" target="_blank" rel="noreferrer" style={S.footerLink}>
              🐒 SMB
            </a>
          </div>
          <p style={S.footerCredit}>
            Built by{" "}
            <a href="https://github.com/f0x1777" target="_blank" rel="noreferrer" style={{ color: ui.accent, fontWeight: 700 }}>
              @f0x1777
            </a>{" "}
            of the Chapter of Argentina 🇦🇷 — to the rest of the world. 🌎
          </p>
        </footer>
      </main>
    </>
  );
}

const S: Record<string, any> = {
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "48px 20px 40px",
    position: "relative",
    zIndex: 1,
  },
  hero: {
    textAlign: "center",
    marginBottom: 28,
  },
  heroLogo: { height: 30, opacity: 0.85, marginBottom: 18 },
  h1: {
    margin: 0,
    fontSize: 52,
    fontWeight: 700,
    letterSpacing: -2,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  heroMonke: { display: "inline-flex", animation: "float 4s ease-in-out infinite" },
  tagline: {
    margin: "14px auto 0",
    color: ui.text,
    fontSize: 18,
    maxWidth: 520,
    lineHeight: 1.5,
  },
  badges: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: 18,
  },
  badge: {
    background: "rgba(243,239,205,0.08)",
    border: `1px solid ${ui.panelBorder}`,
    color: ui.text,
    fontSize: 13,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 999,
  },
  privacy: {
    color: ui.textDim,
    fontSize: 13,
    margin: "0 0 24px",
    textAlign: "center",
  },
  errorBox: {
    background: ui.danger,
    color: "#fff",
    padding: "12px 16px",
    borderRadius: 10,
    marginBottom: 20,
    fontWeight: 500,
  },
  card: {
    background: "rgba(31,86,48,0.7)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    border: `1px solid ${ui.panelBorder}`,
    borderRadius: 18,
    padding: 26,
    marginBottom: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  },
  spinnerRow: { display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 14, color: ui.textDim, fontSize: 14 },
  spinner: {
    display: "inline-block",
    width: 16,
    height: 16,
    border: `2px solid rgba(24,70,35,0.4)`,
    borderTopColor: ui.accentText,
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
    verticalAlign: "middle",
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
    padding: "13px 24px",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(255,201,25,0.25)",
    transition: "transform 0.2s ease-out, box-shadow 0.2s ease-out",
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
    padding: "15px 32px",
    fontSize: 17,
    borderRadius: 12,
    border: "none",
    background: ui.accent,
    color: ui.accentText,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 8px 20px rgba(255,201,25,0.3)",
    transition: "transform 0.2s ease-out, box-shadow 0.2s ease-out",
  },
  input: {
    background: ui.bg,
    color: ui.ivory,
    border: `1px solid ${ui.panelBorder}`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 14,
  },
  secondary: {
    padding: "10px 18px",
    borderRadius: 9,
    border: `1px solid ${ui.accent}`,
    background: "transparent",
    color: ui.accent,
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
    padding: "13px 26px",
    borderRadius: 12,
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-block",
    boxShadow: "0 6px 16px rgba(134,201,148,0.28)",
    transition: "transform 0.2s ease-out",
  },
  ghost: {
    background: "transparent",
    color: ui.textDim,
    border: `1px solid ${ui.panelBorder}`,
    padding: "12px 18px",
    borderRadius: 12,
    cursor: "pointer",
  },
  footer: {
    marginTop: 48,
    paddingTop: 28,
    borderTop: `1px solid ${ui.panelBorder}`,
    textAlign: "center",
  },
  footerTagline: { color: ui.text, fontSize: 16, margin: "12px 0 4px" },
  footerLinks: {
    display: "flex",
    gap: 18,
    justifyContent: "center",
    flexWrap: "wrap",
    margin: "14px 0",
  },
  footerLink: {
    color: ui.text,
    textDecoration: "none",
    fontWeight: 500,
    fontSize: 15,
    padding: "6px 14px",
    borderRadius: 999,
    border: `1px solid ${ui.panelBorder}`,
    background: "rgba(243,239,205,0.06)",
  },
  footerCredit: { color: ui.textDim, fontSize: 13, marginTop: 14 },
};
