"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "./theme";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const NUDGE = 30; // px per nudge, in original-image pixels

type Face = { index: number; x: number; y: number; w: number; h: number; thumb: string };
type Monke = { id: string; thumb: string };
// One placed monke for the live (client-side) preview: its cutout + base placement
// in original-image pixels. The user's live offsets are applied on top in the browser.
type LayoutItem = {
  face_index: number;
  monke: string; // data URL of the cut-out monke
  cx: number; cy: number; w: number; h: number; roll_deg: number; z: number;
};
type Layout = { image: { w: number; h: number }; items: LayoutItem[] };

export default function Home() {
  const [session, setSession] = useState<string | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [monkes, setMonkes] = useState<Monke[]>([]);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [offsets, setOffsets] =
    useState<Record<number, { dx: number; dy: number; scale: number }>>({});
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  const [selectedMonke, setSelectedMonke] = useState<string | null>(null);
  // Live preview: cutouts + base placements (server) edited locally; the heavy
  // server render only runs once, on Download.
  const [layout, setLayout] = useState<Layout | null>(null);
  const [dispW, setDispW] = useState(0); // displayed width of the preview photo, px
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal shown when some faces have no monke at Generate time.
  const [unassignedPrompt, setUnassignedPrompt] = useState<number | null>(null);

  // Which assigned face the drag-on-result moves.
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);

  // Keep the overlay scale in sync with the displayed photo width on window resize
  // (the monke positions are computed from dispW / image width).
  useEffect(() => {
    if (!layout) return;
    const onResize = () => {
      if (previewImgRef.current) setDispW(previewImgRef.current.clientWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [layout]);

  // Turn backend errors into a user-friendly message (esp. expired sessions).
  function friendlyError(msg: string): string {
    if (/unknown or expired session/i.test(msg))
      return "Your session expired (the server may have restarted). Please upload the photo again to start over.";
    if (/failed to fetch/i.test(msg))
      return "Couldn't reach the server. It may be waking up — wait a moment and try again.";
    return msg;
  }

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
      setLayout(null);
      setSelectedFace(null);
      setSelectedMonke(null);
      setDragTarget(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function rotatePhoto(degrees: number) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, degrees }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "rotate failed");
      const data = await r.json();
      setFaces(data.faces);
      // Rotation renumbers faces; clear assignments/results to stay consistent.
      setAssign({});
      setOffsets({});
      setLayout(null);
      setSelectedFace(null);
      setSelectedMonke(null);
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

  function assignPair(faceIndex: number, monkeId: string) {
    setAssign((a) => ({ ...a, [faceIndex]: monkeId }));
    setSelectedFace(null);
    setSelectedMonke(null);
  }

  // Click a face: if a monke is already selected, pair them; otherwise select/
  // toggle the face (works in either order — face-first or monke-first).
  function clickFace(faceIndex: number, el?: HTMLElement) {
    el?.blur();
    if (selectedMonke !== null) {
      assignPair(faceIndex, selectedMonke);
      return;
    }
    setSelectedFace(selectedFace === faceIndex ? null : faceIndex);
  }

  // Click a monke: if a face is already selected, pair them; otherwise select/
  // toggle the monke so the next face click assigns it.
  function clickMonke(monkeId: string, el?: HTMLElement) {
    el?.blur();
    if (selectedFace !== null) {
      assignPair(selectedFace, monkeId);
      return;
    }
    setSelectedMonke(selectedMonke === monkeId ? null : monkeId);
  }

  function buildAssignments(assignMap: Record<number, string>, off: typeof offsets) {
    return Object.entries(assignMap).map(([fi, mid]) => {
      const o = off[Number(fi)] || { dx: 0, dy: 0, scale: 1 };
      return { face_index: Number(fi), monke_id: mid, dx: o.dx, dy: o.dy, scale: o.scale };
    });
  }

  async function generate() {
    if (!session) return;
    const unassigned = faces.filter((f) => !assign[f.index]).length;
    if (unassigned > 0) {
      // Offer a choice (leave visible vs cover with DAOJones) via a modal.
      setUnassignedPrompt(unassigned);
      return;
    }
    await fetchLayout(assign);
  }

  // Fetch the cutouts + base placements for the live preview (no server render).
  // Takes an explicit assignment map so it can run right after mutating assignments
  // without waiting for React state to settle.
  async function fetchLayout(assignMap: Record<number, string>) {
    if (!session) return;
    setUnassignedPrompt(null);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, assignments: buildAssignments(assignMap, {}) }),
      });
      if (!r.ok) throw new Error(friendlyError((await r.json()).detail || "layout failed"));
      setLayout(await r.json());
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setBusy(false);
    }
  }

  // Modal choice A: cover the unassigned faces with the generic DAOJones, then preview.
  async function coverRestWithGeneric() {
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
      const next = { ...assign };
      for (const f of faces) if (!next[f.index]) next[f.index] = g.id;
      setAssign(next);
      await fetchLayout(next);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Modal choice B: leave the unassigned faces visible, preview as-is.
  async function leaveRestVisible() {
    await fetchLayout(assign);
  }

  // All adjustments below are INSTANT and local: they only update `offsets`, which
  // the preview overlay reads. No server round-trip until Download.
  function nudge(faceIndex: number, dx: number, dy: number) {
    setOffsets((o) => {
      const cur = o[faceIndex] || { dx: 0, dy: 0, scale: 1 };
      return { ...o, [faceIndex]: { ...cur, dx: cur.dx + dx, dy: cur.dy + dy } };
    });
  }

  function resize(faceIndex: number, factor: number) {
    setOffsets((o) => {
      const cur = o[faceIndex] || { dx: 0, dy: 0, scale: 1 };
      const scale = Math.min(4, Math.max(0.25, cur.scale * factor));
      return { ...o, [faceIndex]: { ...cur, scale } };
    });
  }

  // Drag a monke directly on the preview. Screen movement is converted to
  // original-image pixels via the displayed scale and applied live (no server).
  function onMonkeMouseDown(faceIndex: number, e: React.MouseEvent) {
    if (!layout || !dispW) return;
    e.preventDefault();
    e.stopPropagation();
    setDragTarget(faceIndex);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = offsets[faceIndex] || { dx: 0, dy: 0, scale: 1 };
    const scale = dispW / layout.image.w; // display px per image px

    const onMove = (ev: MouseEvent) => {
      const ddx = (ev.clientX - startX) / scale;
      const ddy = (ev.clientY - startY) / scale;
      setOffsets((o) => ({
        ...o,
        [faceIndex]: { ...start, dx: start.dx + ddx, dy: start.dy + ddy },
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // The single heavy server render: compose with the final offsets, then download.
  async function downloadResult() {
    if (!session) return;
    setDownloading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, assignments: buildAssignments(assign, offsets) }),
      });
      if (!r.ok) throw new Error(friendlyError((await r.json()).detail || "compose failed"));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "monkemasked.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setDownloading(false);
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
    setSelectedMonke(null);
    setLayout(null);
    setDispW(0);
    setDownloading(false);
    setError(null);
    setDragTarget(null);
    setUnassignedPrompt(null);
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
            Get your event photo <strong>ready for socials</strong> in seconds —
            no editing headaches. 🐵
          </p>
          <div style={S.badges}>
            <span style={S.badge}>🔒 100% private</span>
            <span style={S.badge}>⚡ Auto face detection</span>
            <span style={S.badge}>🎨 Your own monkes</span>
          </div>
        </header>

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
          {session && (
            <div style={S.rotateRow}>
              <span style={{ color: ui.textDim, fontSize: 14 }}>Photo sideways?</span>
              <button style={S.rotateBtn} onClick={() => rotatePhoto(270)} disabled={busy} title="rotate left">
                ↺ Rotate left
              </button>
              <button style={S.rotateBtn} onClick={() => rotatePhoto(90)} disabled={busy} title="rotate right">
                ↻ Rotate right
              </button>
            </div>
          )}
          <p style={S.privacy}>
            🔒 Your photo is processed on the server and deleted right after — never
            stored or shared.
          </p>
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

          {(selectedFace !== null || selectedMonke !== null) && (
            <p style={{ color: ui.accent, fontWeight: 700 }}>
              {selectedFace !== null
                ? `Now click a monke to assign it to face #${selectedFace} →`
                : "Now click a face to assign this monke to it →"}
            </p>
          )}

          <p style={S.label}>Faces — click one to select it (or pick a monke first):</p>
          <div style={S.grid}>
            {faces.map((f) => (
              <button
                key={f.index}
                style={S.thumbBtn(selectedFace === f.index, !!assign[f.index])}
                onClick={(e) => clickFace(f.index, e.currentTarget)}
                title={`face #${f.index}`}
              >
                <img src={f.thumb} alt={`face ${f.index}`} style={S.thumbImg} />
                <span style={S.thumbTag}>
                  #{f.index} {assign[f.index] ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>

          <p style={S.label}>Monkes — click one to select it (or pick a face first):</p>
          <label style={S.uploadSmall}>
            + Add monke images
            <input type="file" accept="image/*" multiple onChange={onMonkes} disabled={busy} hidden />
          </label>
          <div style={S.grid}>
            {monkes.map((m) => {
              const usedCount = Object.values(assign).filter((id) => id === m.id).length;
              const used = usedCount > 0;
              const sel = selectedMonke === m.id;
              return (
                <button
                  key={m.id}
                  style={S.monkeBtn(used, sel)}
                  onClick={(e) => clickMonke(m.id, e.currentTarget)}
                  title={
                    selectedFace !== null
                      ? `assign to face #${selectedFace}`
                      : sel
                        ? "selected — now click a face"
                        : "click to select, then click a face"
                  }
                >
                  <img src={m.thumb} alt={m.id} style={{ ...S.thumbImg, opacity: used ? 0.45 : 1 }} />
                  {used && <span style={S.usedBadge}>✓ used{usedCount > 1 ? ` ×${usedCount}` : ""}</span>}
                </button>
              );
            })}
          </div>

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

      {/* Step 3 — live preview: monkes are overlaid in the browser and moved/resized
          instantly; the server only renders once, on Download. */}
      {layout && session && (
        <section style={S.card} className="fade-up">
          <h2 style={S.h2}>
            <span style={S.step}>3</span> 🎉 Result — drag a monke to move it
          </h2>

          <div style={{ position: "relative", width: "100%", lineHeight: 0, userSelect: "none" }}>
            <img
              ref={previewImgRef}
              src={`${API}/api/photo?session=${session}`}
              alt="your photo"
              style={{ ...S.result, display: "block" }}
              draggable={false}
              onLoad={(e) => setDispW(e.currentTarget.clientWidth)}
            />
            {(() => {
              const S0 = dispW ? dispW / layout.image.w : 0; // display px per image px
              if (!S0) return null;
              return [...layout.items]
                .sort((a, b) => a.z - b.z)
                .map((it) => {
                  const off = offsets[it.face_index] || { dx: 0, dy: 0, scale: 1 };
                  const cx = (it.cx + off.dx) * S0;
                  const cy = (it.cy + off.dy) * S0;
                  const w = it.w * off.scale * S0;
                  const h = it.h * off.scale * S0;
                  const sel = dragTarget === it.face_index;
                  return (
                    <img
                      key={it.face_index}
                      src={it.monke}
                      alt={`monke for face ${it.face_index}`}
                      draggable={false}
                      onMouseDown={(e) => onMonkeMouseDown(it.face_index, e)}
                      style={{
                        position: "absolute",
                        left: cx,
                        top: cy,
                        width: w,
                        height: h,
                        transform: `translate(-50%, -50%) rotate(${-it.roll_deg}deg)`,
                        cursor: "grab",
                        outline: sel ? `2px dashed ${ui.accent}` : "none",
                        outlineOffset: 2,
                      }}
                    />
                  );
                });
            })()}
          </div>

          <details style={{ marginTop: 16 }} open>
            <summary style={S.summary}>Fine-tune a monke</summary>
            <p style={S.label}>
              <strong>Drag any monke</strong> on the image to move it (instant), or
              pick a face below and use the arrows (◀▲▼▶) and <strong>－／＋</strong> to
              nudge/resize. Changes preview live — nothing is uploaded until you
              download.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {faces
                .filter((f) => assign[f.index])
                .map((f) => {
                  const monkeSrc = layout.items.find((it) => it.face_index === f.index)?.monke;
                  return (
                  <div key={f.index} style={S.nudgeRow(dragTarget === f.index)}>
                    <button
                      style={S.facePick(dragTarget === f.index)}
                      onClick={() => setDragTarget(dragTarget === f.index ? null : f.index)}
                      title="highlight this monke on the image"
                    >
                      {monkeSrc ? (
                        <img src={monkeSrc} alt="" style={S.facePickThumb} draggable={false} />
                      ) : (
                        `#${f.index}`
                      )}
                      {dragTarget === f.index ? <span style={S.facePickHand}>✋</span> : null}
                    </button>
                    <button style={S.arrow} onClick={() => nudge(f.index, -NUDGE, 0)}>◀</button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <button style={S.arrow} onClick={() => nudge(f.index, 0, -NUDGE)}>▲</button>
                      <button style={S.arrow} onClick={() => nudge(f.index, 0, NUDGE)}>▼</button>
                    </div>
                    <button style={S.arrow} onClick={() => nudge(f.index, NUDGE, 0)}>▶</button>
                    <span style={{ width: 1, height: 26, background: ui.panelBorder, margin: "0 2px" }} />
                    <button style={S.arrow} onClick={() => resize(f.index, 1 / 1.15)} title="smaller">－</button>
                    <button style={S.arrow} onClick={() => resize(f.index, 1.15)} title="bigger">＋</button>
                    {(offsets[f.index]?.dx || offsets[f.index]?.dy || (offsets[f.index]?.scale ?? 1) !== 1) ? (
                      <button
                        style={S.arrow}
                        title="reset this monke"
                        onClick={() => setOffsets((o) => ({ ...o, [f.index]: { dx: 0, dy: 0, scale: 1 } }))}
                      >
                        ↺
                      </button>
                    ) : null}
                  </div>
                  );
                })}
            </div>
          </details>

          <div style={{ marginTop: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={downloadResult} disabled={downloading} style={S.download} className="lift">
              {downloading ? (
                <>
                  <span style={S.spinner} /> Rendering…
                </>
              ) : (
                "⬇️ Download"
              )}
            </button>
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
            <a href="https://x.com/MonkeDAO" target="_blank" rel="noreferrer" style={S.footerLink}>
              𝕏 MonkeDAO
            </a>
            <a href="https://github.com/f0x1777/MonkeMask" target="_blank" rel="noreferrer" style={S.footerLink}>
              💻 GitHub
            </a>
          </div>
          <div style={S.footerLinks}>
            <a href="https://magiceden.io/marketplace/smb_gen3" target="_blank" rel="noreferrer" style={S.footerLink}>
              🛒 Buy a Gen3 monke
            </a>
            <a href="https://magiceden.io/marketplace/solana_monkey_business" target="_blank" rel="noreferrer" style={S.footerLink}>
              🛒 Buy a Gen2 monke
            </a>
          </div>
          <p style={S.footerCredit}>
            Built by{" "}
            <a href="https://x.com/f0x1777" target="_blank" rel="noreferrer" style={{ color: ui.accent, fontWeight: 700 }}>
              @f0x1777
            </a>{" "}
            of the Argentina Chapter 🇦🇷 for the rest of the world. 🌎
          </p>
        </footer>
      </main>

      {/* Unassigned-faces choice modal */}
      {unassignedPrompt !== null && (
        <div style={S.modalBackdrop} onClick={() => setUnassignedPrompt(null)}>
          <div style={S.modal} className="pop-in" onClick={(e) => e.stopPropagation()}>
            <h3 style={S.modalTitle}>
              🐵 {unassignedPrompt} face{unassignedPrompt > 1 ? "s" : ""} without a monke
            </h3>
            <p style={S.modalText}>
              {unassignedPrompt > 1 ? "These faces" : "This face"} would stay visible.
              What do you want to do?
            </p>
            <div style={S.modalActions}>
              <button onClick={coverRestWithGeneric} disabled={busy} style={S.primary} className="lift">
                🙈 Cover with DAOJones
              </button>
              <button onClick={leaveRestVisible} disabled={busy} style={S.secondary}>
                👀 Leave visible
              </button>
            </div>
            <button onClick={() => setUnassignedPrompt(null)} style={S.modalCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
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
    margin: "14px 0 0",
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
  monkeBtn: (used: boolean, selected = false) => ({
    position: "relative",
    padding: 0,
    background: "transparent",
    border: `3px solid ${selected ? ui.selected : used ? ui.good : "transparent"}`,
    borderRadius: 12,
    cursor: "pointer",
  }),
  usedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    background: ui.good,
    color: ui.accentText,
    fontSize: 10,
    fontWeight: 700,
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
  rotateRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },
  rotateBtn: {
    background: "transparent",
    color: ui.ivory,
    border: `1px solid ${ui.panelBorder}`,
    borderRadius: 9,
    padding: "8px 14px",
    fontWeight: 500,
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
    position: "relative" as const,
    width: 46,
    height: 46,
    padding: 3,
    borderRadius: 9,
    border: `2px solid ${active ? ui.accent : ui.panelBorder}`,
    background: active ? ui.accent : ui.panel,
    color: active ? ui.accentText : ui.ivory,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  }),
  facePickThumb: {
    width: 38,
    height: 38,
    objectFit: "contain" as const,
    display: "block",
  },
  facePickHand: {
    position: "absolute" as const,
    top: -8,
    right: -8,
    fontSize: 16,
    filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))",
  },
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
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(8,24,12,0.72)",
    backdropFilter: "blur(3px)",
    WebkitBackdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 20,
  },
  modal: {
    background: ui.panel,
    border: `1px solid ${ui.panelBorder}`,
    borderRadius: 18,
    padding: 28,
    maxWidth: 440,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  },
  modalTitle: { margin: "0 0 8px", fontSize: 20 },
  modalText: { color: ui.textDim, fontSize: 15, margin: "0 0 20px", lineHeight: 1.5 },
  modalActions: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  modalCancel: {
    marginTop: 16,
    background: "transparent",
    border: "none",
    color: ui.textDim,
    fontSize: 14,
    cursor: "pointer",
    textDecoration: "underline",
  },
};
