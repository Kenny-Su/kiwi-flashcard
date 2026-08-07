import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { ApiClient } from '../api';
import type { Card, CardLink, Deck, SuggestedCardLink } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

type Position = { x: number; y: number };
type ViewBox = { x: number; y: number; width: number; height: number };
const overview: ViewBox = { x: 0, y: 0, width: 900, height: 520 };

export default function ConceptMapModal({ decks, initialDeckId, api, onClose, onEdit }: {
  decks: Deck[]; initialDeckId?: string; api: ApiClient; onClose: () => void; onEdit: (card: Card) => void;
}) {
  const [deckId, setDeckId] = useState(initialDeckId || decks[0]?.id || '');
  const [links, setLinks] = useState<CardLink[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedCardLink[]>([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedLinkId, setSelectedLinkId] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [connectIds, setConnectIds] = useState<string[]>([]);
  const [draftPair, setDraftPair] = useState<string[]>([]);
  const [draftExplanation, setDraftExplanation] = useState('');
  const [editingExplanation, setEditingExplanation] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<ViewBox>(overview);
  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  const [draggingId, setDraggingId] = useState('');
  const cameraRef = useRef(camera);
  const animationRef = useRef<number | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startClientX: number; startClientY: number; startCamera: ViewBox; scaleX: number; scaleY: number } | null>(null);
  const panMovedRef = useRef(false);
  const settledDeckRef = useRef('');
  const reducedMotion = useReducedMotion();

  const deck = decks.find((item) => item.id === deckId);
  const cards = useMemo(() => deck?.cards || [], [deck]);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const fallbackPositions = useMemo(() => seedCircle(cards), [cards]);
  const selectedCard = cardsById.get(selectedCardId);
  const selectedLink = links.find((link) => link.id === selectedLinkId);
  const focusedIds = selectedLink ? new Set([selectedLink.sourceCardId, selectedLink.targetCardId]) : null;

  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); }, []);

  const animateCamera = (target: ViewBox) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (reducedMotion) { setCamera(target); return; }
    const from = cameraRef.current;
    const started = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / 420);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCamera({
        x: from.x + (target.x - from.x) * eased, y: from.y + (target.y - from.y) * eased,
        width: from.width + (target.width - from.width) * eased, height: from.height + (target.height - from.height) * eased,
      });
      if (progress < 1) animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  };

  const zoomAt = (factor: number) => {
    const cx = camera.x + camera.width / 2; const cy = camera.y + camera.height / 2;
    const width = Math.min(2200, Math.max(240, camera.width / factor)); const height = width * overview.height / overview.width;
    animateCamera({ x: cx - width / 2, y: cy - height / 2, width, height });
  };

  const resetFocus = () => { setSelectedLinkId(''); setEditing(false); animateCamera(fitBox(positions)); };

  const loadLinks = async (nextDeckId: string) => {
    if (!nextDeckId) { setLinks([]); return; }
    setLoading(true); setError(null);
    try {
      const fetched = await api.listCardLinks(nextDeckId);
      setLinks(fetched);
      if (settledDeckRef.current !== nextDeckId) {
        settledDeckRef.current = nextDeckId;
        const deckCards = decks.find((item) => item.id === nextDeckId)?.cards || [];
        if (deckCards.length) {
          const next = simulateLayout(deckCards, fetched, seedCircle(deckCards));
          setPositions(next); setCamera(fitBox(next));
        } else setPositions(new Map());
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load card relationships.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadLinks(deckId); }, [api, deckId]);
  useEffect(() => { setSelectedCardId(cards[0]?.id || ''); setSuggestions([]); setConnectIds([]); setDraftPair([]); setSelectedLinkId(''); setCamera(overview); }, [cards, deckId]);
  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { if (selectedLinkId) resetFocus(); else if (connectMode) { setConnectMode(false); setConnectIds([]); setDraftPair([]); } } };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [connectMode, selectedLinkId]);

  const relayout = () => {
    if (!cards.length) return;
    const next = simulateLayout(cards, links, seedCircle(cards));
    setPositions(next); animateCamera(fitBox(next));
  };

  const toSvgPoint = (clientX: number, clientY: number): Position => {
    const svg = svgRef.current; const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const nodePointerDown = (event: PointerEvent<SVGGElement>, cardId: string) => {
    if (connectMode) { event.stopPropagation(); chooseNode(cardId); return; }
    event.stopPropagation();
    const position = positions.get(cardId) || fallbackPositions.get(cardId); if (!position) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    dragRef.current = { id: cardId, offsetX: point.x - position.x, offsetY: point.y - position.y, startX: position.x, startY: position.y, moved: false };
    setDraggingId(cardId);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const nodePointerMove = (event: PointerEvent<SVGGElement>) => {
    const drag = dragRef.current; if (!drag) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    const next = { x: point.x - drag.offsetX, y: point.y - drag.offsetY };
    if (!drag.moved && Math.hypot(next.x - drag.startX, next.y - drag.startY) > 3) drag.moved = true;
    setPositions((prev) => { const map = new Map(prev); map.set(drag.id, next); return map; });
  };

  const nodePointerUp = (event: PointerEvent<SVGGElement>, cardId: string) => {
    const drag = dragRef.current; dragRef.current = null; setDraggingId('');
    if (!drag) return;
    if (!drag.moved) chooseNode(cardId);
  };

  const svgPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    panMovedRef.current = false;
    panRef.current = { startClientX: event.clientX, startClientY: event.clientY, startCamera: camera, scaleX: camera.width / rect.width, scaleY: camera.height / rect.height };
    svg.setPointerCapture(event.pointerId);
  };

  const svgPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current; if (!pan) return;
    const dx = (event.clientX - pan.startClientX) * pan.scaleX; const dy = (event.clientY - pan.startClientY) * pan.scaleY;
    if (Math.hypot(dx, dy) > 3) panMovedRef.current = true;
    setCamera({ ...pan.startCamera, x: pan.startCamera.x - dx, y: pan.startCamera.y - dy });
  };

  const svgPointerUp = () => { panRef.current = null; };

  const focusLink = (link: CardLink) => {
    const source = positions.get(link.sourceCardId); const target = positions.get(link.targetCardId);
    if (!source || !target) return;
    setSelectedLinkId(link.id); setEditingExplanation(link.explanation); setEditing(false);
    animateCamera(focusViewBox(source, target));
  };

  const generateDraft = async (pair: string[]) => {
    setGenerating(true); setError(null); setDraftPair(pair);
    try { const result = await api.explainCardLink(pair[0], pair[1]); setDraftExplanation(result.explanation); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to explain this connection.'); setDraftPair([]); }
    finally { setGenerating(false); }
  };

  const chooseNode = (cardId: string) => {
    if (!connectMode) { setSelectedCardId(cardId); return; }
    if (draftPair.length) return;
    if (connectIds[0] === cardId) { setConnectIds([]); return; }
    if (connectIds.length === 0) { setConnectIds([cardId]); return; }
    const pair = [connectIds[0], cardId]; setConnectIds(pair);
    const existing = links.find((link) => samePair(link.sourceCardId, link.targetCardId, pair[0], pair[1]));
    if (existing) { setConnectMode(false); setConnectIds([]); focusLink(existing); return; }
    void generateDraft(pair);
  };

  const saveDraft = async () => {
    if (draftPair.length !== 2 || !draftExplanation.trim()) return;
    setSaving(true); setError(null);
    try { await api.createCardLinks([{ sourceCardId: draftPair[0], targetCardId: draftPair[1], explanation: draftExplanation.trim() }]); setConnectMode(false); setConnectIds([]); setDraftPair([]); setDraftExplanation(''); await loadLinks(deckId); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to save connection.'); }
    finally { setSaving(false); }
  };

  const saveExplanation = async () => {
    if (!selectedLink || !editingExplanation.trim()) return;
    setSaving(true); setError(null);
    try { const updated = await api.updateCardLink(selectedLink.id, editingExplanation.trim()); setLinks((old) => old.map((link) => link.id === updated.id ? updated : link)); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update explanation.'); }
    finally { setSaving(false); }
  };

  const regenerate = async (sourceId: string, targetId: string, target: 'draft' | 'saved') => {
    setGenerating(true); setError(null);
    try { const result = await api.explainCardLink(sourceId, targetId); if (target === 'draft') setDraftExplanation(result.explanation); else { setEditingExplanation(result.explanation); setEditing(true); } }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to regenerate explanation.'); }
    finally { setGenerating(false); }
  };

  const deleteSelected = async () => {
    if (!selectedLink) return; setSaving(true);
    try { await api.deleteCardLink(selectedLink.id); setLinks((old) => old.filter((link) => link.id !== selectedLink.id)); resetFocus(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete connection.'); }
    finally { setSaving(false); }
  };

  const generateSuggestions = async () => { setSuggesting(true); setError(null); try { const next = await api.suggestCardLinks(deckId); setSuggestions(next); if (!next.length) setError('No strong new connections were found for this deck.'); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to suggest connections.'); } finally { setSuggesting(false); } };
  const approveSuggestion = async (item: SuggestedCardLink, index: number) => { setSaving(true); try { await api.createCardLinks([item]); setSuggestions((old) => old.filter((_, i) => i !== index)); await loadLinks(deckId); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to approve connection.'); } finally { setSaving(false); } };

  const nodeKey = (event: KeyboardEvent<SVGGElement>, cardId: string) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseNode(cardId); } };
  const edgeKey = (event: KeyboardEvent<SVGGElement>, link: CardLink) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusLink(link); } };
  const backgroundClick = (event: MouseEvent<SVGSVGElement>) => { if (event.target !== event.currentTarget || panMovedRef.current) return; if (selectedLinkId) resetFocus(); };

  return <Modal open title="Card map" eyebrow="Explore concept connections" size="study" onClose={onClose} footer={<button className="button button--primary" type="button" onClick={onClose}>Done</button>}>
    <div className="concept-map">
      <div className="concept-map__toolbar"><label className="field concept-map__deck-field"><span className="field__label">Deck</span><select value={deckId} onChange={(event) => setDeckId(event.currentTarget.value)}>{!decks.length && <option value="">No decks available</option>}{decks.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.cards.length})</option>)}</select></label><div className="concept-map__toolbar-actions"><button className={`button ${connectMode ? 'button--primary' : 'button--secondary'}`} type="button" disabled={cards.length < 2} onClick={() => { setConnectMode(!connectMode); setConnectIds([]); setDraftPair([]); resetFocus(); }}><Icon name={connectMode ? 'close' : 'add'} /> {connectMode ? 'Cancel connect' : 'Connect concepts'}</button><button className="button button--secondary" type="button" disabled={cards.length < 2 || suggesting} onClick={() => void generateSuggestions()}>{suggesting ? <Spinner label="Finding connections" size="small" /> : <Icon name="sparkles" />} Suggest connections</button><button className="button button--secondary" type="button" disabled={cards.length < 2} onClick={relayout}><Icon name="reset" /> Reset layout</button></div></div>
      {connectMode && <Notice>{generating ? 'Writing a grounded explanation…' : connectIds.length === 0 ? 'Select the first concept.' : connectIds.length === 1 ? 'Now select a second concept.' : 'Review the explanation before saving.'}</Notice>}
      {error && <Notice tone={error.startsWith('No strong') ? 'info' : 'error'} onClose={() => setError(null)}>{error}</Notice>}
      {!deck ? <div className="concept-map__empty">Create a deck before building a map.</div> : !cards.length ? <div className="concept-map__empty">This deck has no cards yet.</div> : <>
        <section className={`concept-map__canvas${selectedLink ? ' concept-map__canvas--focused' : ''}`}>
          <div className="concept-map__zoom"><button className="icon-button icon-button--small icon-button--surface" type="button" onClick={() => zoomAt(1.25)} aria-label="Zoom in"><Icon name="add" size={15} /></button><button className="icon-button icon-button--small icon-button--surface" type="button" onClick={() => zoomAt(.8)} aria-label="Zoom out">−</button></div>
          {loading ? <div className="concept-map__loading"><Spinner label="Loading map" /></div> : <svg ref={svgRef} viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} role="img" aria-label={`${cards.length} cards connected by ${links.length} relationships`} onClick={backgroundClick} onPointerDown={svgPointerDown} onPointerMove={svgPointerMove} onPointerUp={svgPointerUp} onPointerCancel={svgPointerUp}>
            <g className="concept-map__edges">{links.map((link, index) => { const source = positions.get(link.sourceCardId); const target = positions.get(link.targetCardId); if (!source || !target) return null; const edge = edgePoints(source, target); const active = link.id === selectedLinkId; const muted = Boolean(selectedLink && !active); const sourceName = cardsById.get(link.sourceCardId)?.question || 'card'; const targetName = cardsById.get(link.targetCardId)?.question || 'card'; return <g className={`concept-map__edge${active ? ' concept-map__edge--selected' : ''}${muted ? ' concept-map__edge--muted' : ''}`} role="button" tabIndex={0} aria-label={`${sourceName} and ${targetName}: ${link.explanation}`} onClick={(event) => { event.stopPropagation(); focusLink(link); }} onKeyDown={(event) => edgeKey(event, link)} style={{ animationDelay: `${index * 45}ms` }} key={link.id}><title>{link.explanation}</title><line className="concept-map__edge-visible" {...edge} /><line className="concept-map__edge-hit" {...edge} /></g>; })}</g>
            <g className="concept-map__nodes">{cards.map((card, index) => { const position = positions.get(card.id) || fallbackPositions.get(card.id)!; const lines = cardLabel(card.question); const picked = connectIds.includes(card.id); const muted = Boolean(focusedIds && !focusedIds.has(card.id)); return <g className={`concept-map__node${selectedCardId === card.id ? ' concept-map__node--selected' : ''}${picked ? ' concept-map__node--picked' : ''}${muted ? ' concept-map__node--muted' : ''}${draggingId === card.id ? ' concept-map__node--dragging' : ''}`} transform={`translate(${position.x - 78} ${position.y - 34})`} role="button" tabIndex={0} aria-label={card.question} onPointerDown={(event) => nodePointerDown(event, card.id)} onPointerMove={nodePointerMove} onPointerUp={(event) => nodePointerUp(event, card.id)} onPointerCancel={() => { dragRef.current = null; setDraggingId(''); }} onKeyDown={(event) => nodeKey(event, card.id)} style={{ animationDelay: `${index * 35}ms` }} key={card.id}><rect width="156" height="68" rx="16" /><text x="78" y={lines.length === 1 ? 38 : 29} textAnchor="middle">{lines.map((line, i) => <tspan x="78" dy={i ? 17 : 0} key={line}>{line}</tspan>)}</text></g>; })}</g>
          </svg>}
          {selectedLink && <div className="concept-map__focus-card"><button className="button button--ghost button--compact" type="button" onClick={resetFocus}><Icon name="arrow-left" size={15} /> Back to map</button><div className="concept-map__focus-pair"><strong>{cardsById.get(selectedLink.sourceCardId)?.question}</strong><span>↔</span><strong>{cardsById.get(selectedLink.targetCardId)?.question}</strong></div>{editing ? <textarea value={editingExplanation} onChange={(event) => setEditingExplanation(event.currentTarget.value)} rows={3} aria-label="Relationship explanation" /> : <p>{selectedLink.explanation}</p>}<div className="concept-map__focus-actions">{editing ? <><button className="button button--ghost button--compact" type="button" onClick={() => { setEditing(false); setEditingExplanation(selectedLink.explanation); }}>Cancel</button><button className="button button--primary button--compact" type="button" disabled={saving || !editingExplanation.trim()} onClick={() => void saveExplanation()}>Save</button></> : <><button className="button button--ghost button--compact" type="button" disabled={generating} onClick={() => void regenerate(selectedLink.sourceCardId, selectedLink.targetCardId, 'saved')}><Icon name="sparkles" size={15} /> Regenerate</button><button className="button button--secondary button--compact" type="button" onClick={() => setEditing(true)}><Icon name="edit" size={15} /> Edit</button><button className="icon-button icon-button--small icon-button--danger" type="button" disabled={saving} onClick={() => void deleteSelected()} aria-label="Delete connection"><Icon name="trash" size={15} /></button></>}</div></div>}
          {draftPair.length === 2 && !generating && <div className="concept-map__focus-card concept-map__focus-card--draft"><div className="eyebrow">New connection</div><div className="concept-map__focus-pair"><button className="concept-map__pair-card" type="button" onClick={() => { setDraftPair([]); setDraftExplanation(''); setConnectIds([draftPair[1]]); }}><strong>{cardsById.get(draftPair[0])?.question}</strong><small>Change first concept</small></button><span>↔</span><button className="concept-map__pair-card" type="button" onClick={() => { setDraftPair([]); setDraftExplanation(''); setConnectIds([draftPair[0]]); }}><strong>{cardsById.get(draftPair[1])?.question}</strong><small>Change second concept</small></button></div><textarea value={draftExplanation} onChange={(event) => setDraftExplanation(event.currentTarget.value)} rows={3} aria-label="New relationship explanation" /><div className="concept-map__focus-actions"><button className="button button--ghost button--compact" type="button" onClick={() => { setDraftPair([]); setConnectIds([]); }}>Cancel</button><button className="button button--ghost button--compact" type="button" disabled={generating} onClick={() => void regenerate(draftPair[0], draftPair[1], 'draft')}><Icon name="sparkles" size={15} /> Regenerate</button><button className="button button--primary button--compact" type="button" disabled={saving || !draftExplanation.trim()} onClick={() => void saveDraft()}>Save connection</button></div></div>}
        </section>
        {selectedCard && !connectMode && !selectedLink && <section className="concept-map__panel"><h3>Selected card</h3><strong className="concept-map__question">{selectedCard.question}</strong><p>{selectedCard.answer}</p><button className="button button--secondary" type="button" onClick={() => onEdit(selectedCard)}><Icon name="edit" /> Edit card</button></section>}
        {suggestions.length > 0 && <section className="concept-map__review"><div><h3>Suggested connections</h3><p>Edit each explanation before approving it.</p></div><div className="concept-map__suggestions">{suggestions.map((item, index) => <article className="concept-map__suggestion" key={`${item.sourceCardId}-${item.targetCardId}`}><div><div className="concept-map__suggestion-pair"><strong>{cardsById.get(item.sourceCardId)?.question}</strong><span>↔</span><strong>{cardsById.get(item.targetCardId)?.question}</strong></div><textarea value={item.explanation} rows={2} aria-label="Suggested explanation" onChange={(event) => setSuggestions((old) => old.map((value, i) => i === index ? { ...value, explanation: event.currentTarget.value } : value))} /></div><div className="button-row"><button className="button button--ghost" type="button" onClick={() => setSuggestions((old) => old.filter((_, i) => i !== index))}>Reject</button><button className="button button--secondary" type="button" disabled={saving || !item.explanation.trim()} onClick={() => void approveSuggestion(item, index)}><Icon name="check" /> Approve</button></div></article>)}</div></section>}
      </>}
    </div>
  </Modal>;
}

function useReducedMotion() { const [reduced, setReduced] = useState(false); useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []); return reduced; }
function seedCircle(cards: Card[]) { const positions = new Map<string, Position>(); if (cards.length === 1) { positions.set(cards[0].id, { x: 450, y: 260 }); return positions; } const radiusX = Math.min(330, 150 + cards.length * 22); const radiusY = Math.min(190, 100 + cards.length * 14); cards.forEach((card, index) => { const angle = index / cards.length * Math.PI * 2 - Math.PI / 2; positions.set(card.id, { x: 450 + Math.cos(angle) * radiusX, y: 260 + Math.sin(angle) * radiusY }); }); return positions; }

function simulateLayout(cards: Card[], links: CardLink[], seed: Map<string, Position>) {
  const ids = cards.map((card) => card.id);
  const positions = new Map(seed);
  if (ids.length <= 1) return positions;
  const velocities = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
  const edges = links.filter((link) => positions.has(link.sourceCardId) && positions.has(link.targetCardId) && link.sourceCardId !== link.targetCardId);
  const centerX = 450; const centerY = 260;
  for (let iteration = 0; iteration < 180; iteration++) {
    const forces = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions.get(ids[i])!; const b = positions.get(ids[j])!;
        let dx = a.x - b.x; let dy = a.y - b.y; let distSq = dx * dx + dy * dy;
        if (distSq < 1) { dx = Math.random() - .5; dy = Math.random() - .5; distSq = 1; }
        const dist = Math.sqrt(distSq); const force = 15000 / distSq;
        const fx = (dx / dist) * force; const fy = (dy / dist) * force;
        forces.get(ids[i])!.x += fx; forces.get(ids[i])!.y += fy;
        forces.get(ids[j])!.x -= fx; forces.get(ids[j])!.y -= fy;
      }
    }
    for (const link of edges) {
      const a = positions.get(link.sourceCardId)!; const b = positions.get(link.targetCardId)!;
      const dx = b.x - a.x; const dy = b.y - a.y; const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 200) * .02;
      const fx = (dx / dist) * force; const fy = (dy / dist) * force;
      forces.get(link.sourceCardId)!.x += fx; forces.get(link.sourceCardId)!.y += fy;
      forces.get(link.targetCardId)!.x -= fx; forces.get(link.targetCardId)!.y -= fy;
    }
    for (const id of ids) {
      const p = positions.get(id)!;
      forces.get(id)!.x += (centerX - p.x) * .008; forces.get(id)!.y += (centerY - p.y) * .008;
    }
    for (const id of ids) {
      const velocity = velocities.get(id)!; const force = forces.get(id)!;
      velocity.x = (velocity.x + force.x) * .82; velocity.y = (velocity.y + force.y) * .82;
      const p = positions.get(id)!;
      positions.set(id, { x: p.x + velocity.x, y: p.y + velocity.y });
    }
  }
  return positions;
}

function fitBox(positions: Map<string, Position>): ViewBox {
  if (!positions.size) return overview;
  const points = [...positions.values()];
  const padX = 130; const padY = 90;
  const minX = Math.min(...points.map((p) => p.x)) - padX; const maxX = Math.max(...points.map((p) => p.x)) + padX;
  const minY = Math.min(...points.map((p) => p.y)) - padY; const maxY = Math.max(...points.map((p) => p.y)) + padY;
  const aspect = overview.width / overview.height;
  let width = Math.max(overview.width * .4, maxX - minX); let height = Math.max(overview.height * .4, maxY - minY);
  if (width / height > aspect) height = width / aspect; else width = height * aspect;
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height };
}
function cardLabel(question: string) { const words = question.trim().split(/\s+/); const lines = ['', '']; let line = 0; for (const word of words) { if (`${lines[line]} ${word}`.trim().length > 22 && line === 0) line = 1; if (`${lines[line]} ${word}`.trim().length > 25) { lines[line] = `${lines[line].slice(0, 22)}…`; break; } lines[line] = `${lines[line]} ${word}`.trim(); } return lines.filter(Boolean); }
function edgePoints(source: Position, target: Position) { const dx = target.x - source.x; const dy = target.y - source.y; const ratio = Math.min(70 / Math.max(Math.abs(dx), .001), 28 / Math.max(Math.abs(dy), .001)); return { x1: source.x + dx * ratio, y1: source.y + dy * ratio, x2: target.x - dx * ratio, y2: target.y - dy * ratio }; }
function focusViewBox(source: Position, target: Position): ViewBox { const centerX = (source.x + target.x) / 2; const centerY = (source.y + target.y) / 2; const width = Math.max(390, Math.abs(source.x - target.x) + 240); const height = width * 520 / 900; return { x: centerX - width / 2, y: centerY - height / 2 + 35, width, height }; }
function samePair(sourceA: string, targetA: string, sourceB: string, targetB: string) { return (sourceA === sourceB && targetA === targetB) || (sourceA === targetB && targetA === sourceB); }
