// Run: node scripts/check-canvas-ux.cjs (no browser or server mutations).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../src/components/servers/network-map");
const slots = [], effects = [], listeners = new Map();
let cursor = 0, safeMode = true, mutationRequests = 0;
let fetchMock = async (url, options) => {
  if (options) mutationRequests++;
  assert.equal(options, undefined, "Default UX checks must never mutate a server");
  return { ok: true, json: async () => ({ success: true, data: url.endsWith("firewall") ? { rules: [], ufwActive: false } : topology }) };
};
const windowMock = { confirm: () => true, prompt: (message) => message.match(/Type (.*) to continue/)[1] };
const equalDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useState(initial) {
    const i = cursor++;
    if (!slots[i]) slots[i] = { value: initial };
    const slot = slots[i];
    return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  },
  useRef(initial) {
    const i = cursor++;
    if (!slots[i]) slots[i] = { current: initial };
    return slots[i];
  },
  useCallback(fn, deps) {
    const i = cursor++;
    if (!slots[i] || !equalDeps(slots[i].deps, deps)) slots[i] = { value: fn, deps };
    return slots[i].value;
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!slots[i] || !equalDeps(slots[i].deps, deps)) {
      const cleanup = slots[i]?.cleanup;
      slots[i] = { deps };
      effects.push(() => { cleanup?.(); slots[i].cleanup = fn(); });
    }
  },
};
const jsx = (type, props, key) => ({ type, key, props: props || {} });
const topology = {
  networks: [{ id: "net1", name: "bridge", driver: "bridge", containers: [{ id: "app1", name: "Example app", state: "running", ipv4: "172.18.0.2", image: "example:1", ports: "0.0.0.0:8080->80/tcp" }] }],
  hostPorts: [{ localPort: 8080, localAddress: "0.0.0.0", protocol: "tcp", process: "docker-proxy" }],
  findings: [],
};
const document = {
  addEventListener(type, fn, capture) { listeners.set(type, { fn, capture }); },
  removeEventListener(type, fn) { if (listeners.get(type)?.fn === fn) listeners.delete(type); },
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const sourceFile = file.endsWith("ServerNetworkMap.tsx") && process.env.CANVAS_UX_BASELINE || file;
  const source = fs.readFileSync(sourceFile, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const requireMock = (id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "lucide-react") return new Proxy({}, { get: (_, name) => name });
    if (id === "@/contexts/SafeModeContext") return { useSafeMode: () => ({ safeMode }) };
    if (id === "@/components/ui/Button") return { Button: "Button" };
    if (id === "@/components/ui/Badge") return { Badge: "Badge" };
    if (id.startsWith(".")) {
      const base = path.resolve(path.dirname(file), id);
      return load(fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`);
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(code, { exports, require: requireMock, document, console, Error, window: windowMock, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, fetch: (...args) => fetchMock(...args) }, { filename: file });
  return exports;
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => nodes(item, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const { ServerNetworkMap } = load(path.join(root, "ServerNetworkMap.tsx"));
const { ContainerCard, InternetCard } = load(path.join(root, "cards.tsx"));
const { SvgEdge } = load(path.join(root, "SvgEdge.tsx"));
let tree, viewportNode, panelNode, focus = 0, zoom;
const trigger = { isConnected: true, focus() { focus++; }, matches: () => true, getBoundingClientRect: () => ({ left: 140, bottom: 170 }) };
const inside = {};
const closeButton = { focus() { focus++; } };
const panel = { contains: (target) => target === inside, querySelector: () => closeButton };
const captured = new Set(), wheelListeners = new Map();
const viewport = {
  clientWidth: 320, clientHeight: 480,
  getBoundingClientRect: () => ({ left: 100, top: 100, width: 320, height: 480 }),
  setPointerCapture(id) { captured.add(id); },
  hasPointerCapture: (id) => captured.has(id),
  releasePointerCapture(id) { captured.delete(id); },
  addEventListener(type, fn, options) { wheelListeners.set(type, { fn, options }); },
  removeEventListener(type) { wheelListeners.delete(type); },
};
let currentServer = "local";
function render(serverId = currentServer) {
  if (serverId !== currentServer) {
    slots.forEach((slot) => slot?.cleanup?.()); slots.length = 0; effects.length = 0;
  }
  currentServer = serverId;
  cursor = 0;
  tree = ServerNetworkMap({ serverId });
  if (typeof tree.type === "function") {
    assert.equal(tree.key, serverId, "Canvas child must be keyed by target identity");
    tree = tree.type(tree.props);
  }
  viewportNode = nodes(tree, (n) => !!n.props.onPointerMove)[0];
  panelNode = nodes(tree, (n) => n.props.role === "dialog")[0];
  if (viewportNode) viewportNode.props.ref.current = viewport;
  if (panelNode) panelNode.props.ref.current = panel;
  else if (viewportNode) {
    // React clears a removed panel ref before flushing effects.
    slots.filter((slot) => slot?.current === panel).forEach((slot) => { slot.current = null; });
  }
  effects.splice(0).forEach((effect) => effect());
  zoom = nodes(tree, (n) => n.props.title === "Zoom out")[0];
  return tree;
}
function event(overrides = {}) {
  return { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 140, clientY: 170, detail: 1, type: "pointerup", nativeEvent: { isPrimary: true }, currentTarget: trigger, target: trigger,
    stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...overrides };
}
function card() { return nodes(tree, (n) => n.type === ContainerCard)[0]; }
function open(e = event({ type: "click", nativeEvent: { isPrimary: false } })) {
  const rendered = ContainerCard(card().props);
  nodes(rendered, (n) => n.type === "button")[0].props.onClick(e);
  render();
}
function position() { return card().props.card; }
function move(props) { viewportNode.props.onPointerMove(event(props)); render(); }
function finish(props = {}) { viewportNode.props.onPointerUp(event(props)); render(); }
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (data, extra = {}) => ({ ok: true, json: async () => ({ success: true, data, ...extra }) });
const button = (label) => nodes(tree, (n) => n.props.onClick && [n.props.children].flat().some((child) => typeof child === "string" && child.includes(label)))[0];
function reset() {
  slots.forEach((slot) => slot?.cleanup?.()); slots.length = 0; effects.length = 0;
  listeners.clear(); wheelListeners.clear(); safeMode = false;
}
async function checkFlowReview() {
  const failures = [];
  async function check(name, fn) { try { reset(); await fn(); } catch (error) { failures.push(`${name}: ${error.message}`); } }
  await check("late identity reads", async () => {
    const pending = [];
    fetchMock = (url) => new Promise((resolve) => pending.push({ url, resolve }));
    render("A"); render("B");
    const b = { ...topology, networks: [{ ...topology.networks[0], containers: [{ ...topology.networks[0].containers[0], id: "B-app", name: "B app" }] }] };
    for (const request of pending.filter((r) => r.url.includes("/B/"))) request.resolve(response(request.url.endsWith("firewall") ? { rules: [{ number: 2, target: "9000/tcp", action: "DENY", from: "B" }], ufwActive: true } : b));
    await tick(); render();
    for (const request of pending.filter((r) => r.url.includes("/A/"))) request.resolve(response(request.url.endsWith("firewall") ? { rules: [{ number: 1, target: "8080/tcp", action: "DENY", from: "A" }], ufwActive: false } : topology));
    await tick(); render();
    assert.equal(card().props.container.id, "B-app", "Late A topology replaced B");
    assert.ok(!JSON.stringify(tree).includes("8080/tcp"), "Late A firewall replaced B");
    card().props.onAction(b.networks[0].containers[0], event({ detail: 0 })); render();
    const staleRestart = button("Restart").props.onClick;
    render("C");
    assert.equal(card(), undefined, "Old actionable data visible on target switch");
    assert.equal(panelNode, undefined, "Old action confirmation survives switch");
    await staleRestart();
    assert.ok(pending.every((r) => !r.url.endsWith("docker/action")), "Stale confirmation submitted");
  });
  for (const kind of ["restart", "deny", "allow", "preview"]) await check(`synchronous ${kind} guard`, async () => {
    let postResolve, readResolve, posts = 0;
    const rules = [{ number: 1, target: "8080/tcp", action: "DENY", from: "Anywhere" }];
    fetchMock = async (url, options) => {
      if (options?.method === "POST") { posts++; return new Promise((resolve) => { postResolve = resolve; }); }
      if (posts) return new Promise((resolve) => { readResolve = () => resolve(response(url.endsWith("firewall") ? { rules, ufwActive: true } : topology)); });
      return response(url.endsWith("firewall") ? { rules, ufwActive: true } : topology);
    };
    render("A"); await tick(); render();
    if (kind === "restart") open(event({ detail: 0 }));
    if (kind === "deny" || kind === "preview") { const port = nodes(tree, (n) => n.props.title?.startsWith("Click for a short"))[0]; port.props.onClick(); render(); }
    const handler = button(kind === "restart" ? "Restart" : kind === "allow" ? "Add allow rule" : kind === "preview" ? "Preview firewall change" : "Add deny rule").props.onClick;
    const first = handler(), second = handler();
    assert.equal(posts, 1, "Two same-tick calls POST twice");
    postResolve(response({ message: "Command completed", verified: true, risk: "danger", outcome: "verified" })); await tick();
    if (kind !== "preview") { await handler(); assert.equal(posts, 1, "Guard released before readback"); }
    if (kind !== "preview") { for (let i = 0; i < 3; i++) { readResolve?.(); await tick(); } }
    await Promise.all([first, second]);
  });
  await check("same-target read ordering and stale-data clearing", async () => {
    const pending = [];
    fetchMock = (url) => new Promise((resolve) => pending.push({ url, resolve }));
    render("read-order");
    pending.splice(0).forEach((r) => r.resolve(response(r.url.endsWith("firewall") ? { rules: [], ufwActive: false } : topology)));
    await tick(); render();
    const refresh = nodes(tree, (n) => n.props.title === "Refresh network data")[0].props.onClick;
    const first = refresh(), second = refresh(); render();
    assert.equal(card(), undefined, "Refreshing retains actionable old topology");
    const newer = { ...topology, networks: [{ ...topology.networks[0], containers: [{ ...topology.networks[0].containers[0], name: "newer", id: "newer" }] }] };
    pending[1].resolve(response(newer)); await second; render();
    pending[0].resolve(response(topology)); await first; render();
    assert.equal(card().props.container.id, "newer", "Older same-target read replaced newer state");
  });
  await check("readback failure retains command evidence and lock", async () => {
    let posts = 0;
    fetchMock = async (url, options) => {
      if (options?.method === "POST") { posts++; return response({ message: "command evidence", verified: true, risk: "danger" }); }
      if (posts) throw new Error("readback lost");
      return response(url.endsWith("firewall") ? { rules: [], ufwActive: false } : topology);
    };
    render("readback-failure"); await tick(); render(); open(event({ detail: 0 }));
    const handler = button("Restart").props.onClick;
    await handler(); render();
    assert.ok(JSON.stringify(tree).includes("command evidence"), "Readback erased completed command evidence");
    assert.ok(button("Check current server state (read-only)"), "Readback error hid recovery");
    await handler(); assert.equal(posts, 1, "Failed readback unlocked mutation");
  });
  await check("late action result and return-to-target lock", async () => {
    let finishPost, posts = 0;
    fetchMock = async (url, options) => {
      if (options?.method === "POST") { posts++; return new Promise((resolve) => { finishPost = resolve; }); }
      return response(url.endsWith("firewall") ? { rules: [], ufwActive: false } : topology);
    };
    render("action-A"); await tick(); render(); open(event({ detail: 0 }));
    const oldHandler = button("Restart").props.onClick;
    const action = oldHandler();
    render("action-B"); await tick(); render();
    finishPost(response({ message: "A-only result", verified: true, risk: "danger" })); await action; render();
    assert.ok(!JSON.stringify(tree).includes("A-only result"), "A action result leaked into B");
    render("action-A"); await tick(); render(); open(event({ detail: 0 }));
    await button("Restart").props.onClick(); assert.equal(posts, 1, "Remount bypassed unsettled target lock");
    await button("Check current server state (read-only)").props.onClick(); render();
    await oldHandler(); assert.equal(posts, 1, "Unmounted confirmation revived after A-B-A switch");
  });
  for (const kind of ["restart", "deny", "allow"]) for (const fault of ["transport", "json", "payload", "server-error"]) await check(`unknown ${kind}/${fault} outcome`, async () => {
    let posts = 0, malformed = true;
    const rules = [{ number: 1, target: "8080/tcp", action: "DENY", from: "Anywhere" }];
    fetchMock = async (url, options) => {
      if (options?.method === "POST") {
        posts++;
        if (fault === "transport") throw new Error("transport lost");
        if (fault === "json") return { ok: true, json: async () => { throw new Error("response lost"); } };
        if (fault === "server-error") return { ok: false, status: 503, json: async () => ({ success: false, error: "Server transport lost" }) };
        return response({ message: "Incomplete response" });
      }
      if (posts && malformed) return response(url.endsWith("firewall") ? { rules: "invalid" } : { networks: [], hostPorts: null });
      return response(url.endsWith("firewall") ? { rules, ufwActive: true } : topology);
    };
    render("A"); await tick(); render();
    if (kind === "restart") open(event({ detail: 0 }));
    if (kind === "deny") { nodes(tree, (n) => n.props.title?.startsWith("Click for a short"))[0].props.onClick(); render(); }
    const handler = button(kind === "restart" ? "Restart" : kind === "allow" ? "Add allow rule" : "Add deny rule").props.onClick;
    await handler(); render();
    assert.ok(JSON.stringify(tree).includes("Outcome unknown"), "Lost response claimed action failure");
    await handler(); assert.equal(posts, 1, "Unknown outcome allows automatic retry");
    const readOnly = button("Check current server state (read-only)");
    assert.ok(readOnly, "Explicit read-only recovery unavailable");
    await readOnly.props.onClick(); render();
    await handler(); assert.equal(posts, 1, "Malformed readback unlocked mutation");
    malformed = false;
    await button("Check current server state (read-only)").props.onClick(); render();
    assert.ok(!JSON.stringify(tree).includes("Expected state verified"), "Recovery invented command outcome");
    if (kind === "restart") open(event({ detail: 0 }));
    if (kind === "deny") { nodes(tree, (n) => n.props.title?.startsWith("Click for a short"))[0].props.onClick(); render(); }
    await button(kind === "restart" ? "Restart" : kind === "allow" ? "Add allow rule" : "Add deny rule").props.onClick();
    assert.equal(posts, 2, "Valid explicit readback did not unlock new intentional operation");
    render(); await button("Check current server state (read-only)").props.onClick(); render();
  });
  assert.deepEqual(failures, [], failures.join("\n"));
}
(async () => {
  render();
  await new Promise((resolve) => setImmediate(resolve));
  render();
  assert.ok(viewportNode, "Canvas must use Pointer Events, not mouse-only handlers");
  assert.equal(wheelListeners.get("wheel").options.passive, false);
  const start = position();
  card().props.onPointerDown(event()); render();
  assert.ok(captured.has(1), "Drag must capture pointer");
  card().props.onPointerDown(event({ pointerId: 2, isPrimary: false }));
  move({ pointerId: 2, isPrimary: false, clientX: 240 });
  assert.equal(position().x, start.x, "Extra pointer must not move node");
  finish({ pointerId: 2, isPrimary: false });
  assert.ok(captured.has(1), "Extra pointer must not end primary drag");
  open();
  assert.equal(panelNode, undefined, "Active drag must not open actions");
  move({ clientX: 142 });
  assert.equal(position().x, start.x, "Tap jitter must not move node");
  move({ clientX: 160, clientY: 180 });
  assert.equal(position().x, start.x + 20);
  assert.equal(position().y, start.y + 10);
  finish();
  assert.equal(captured.size, 0);
  open();
  assert.equal(panelNode, undefined, "Drag-generated click must not open actions");
  viewportNode.props.onPointerDownCapture(event());
  open();
  assert.ok(panelNode, "Chromium click with nativeEvent.isPrimary=false opens actions");
  nodes(panelNode, (n) => n.props["aria-label"] === "Close canvas actions")[0].props.onClick(); render();
  open(event({ detail: 0, type: "click", nativeEvent: { isPrimary: false } }));
  assert.ok(panelNode, "Keyboard-generated click with nativeEvent.isPrimary=false opens actions");
  assert.equal(mutationRequests, 0, "Opening actions must not mutate a server");
  assert.equal(panelNode.props["aria-labelledby"], "canvas-action-title");
  assert.ok(focus > 0, "Opening panel focuses its close button");
  assert.ok(panelNode.props.style.maxHeight.includes("280px"));
  assert.ok(panelNode.props.style.left.includes("min("));
  assert.ok(panelNode.props.className.includes("overflow-auto"));
  assert.equal(panelNode.props.style.touchAction, "pan-y");
  for (const prop of ["onPointerDown", "onClick", "onWheel"]) {
    const e = event(); panelNode.props[prop](e); assert.ok(e.stopped, prop);
  }
  assert.ok(listeners.get("pointerdown").capture, "Outside dismissal must use document capture");
  listeners.get("pointerdown").fn(event({ target: inside })); render();
  assert.ok(panelNode, "Panel click must not dismiss itself");
  const previousFocus = focus;
  const escape = event({ key: "Escape" }); listeners.get("keydown").fn(escape); render();
  assert.equal(panelNode, undefined); assert.ok(escape.prevented); assert.ok(focus > previousFocus, "Escape restores trigger focus");
  assert.equal(listeners.size, 0, "Dismissal cleans document listeners");
  open(event({ detail: 0 }));
  listeners.get("pointerdown").fn(event({ target: {}, isPrimary: false })); render(); assert.ok(panelNode);
  listeners.get("pointerdown").fn(event({ target: {} })); render(); assert.equal(panelNode, undefined, "Outside-canvas pointerdown dismisses");
  card().props.onPointerDown(event()); render();
  viewportNode.props.onPointerCancel(event({ type: "pointercancel" })); render();
  assert.equal(captured.size, 0); open(); assert.equal(panelNode, undefined, "Cancelled drag must not open actions");
  card().props.onPointerDown(event()); render();
  viewportNode.props.onLostPointerCapture(event({ type: "lostpointercapture" })); render();
  assert.equal(captured.size, 0); open(); assert.equal(panelNode, undefined);
  viewportNode.props.onPointerDownCapture(event());
  move({ clientX: 170 }); open(); assert.equal(panelNode, undefined, "Dragging an action pill must not activate it");
  const surface = () => nodes(tree, (n) => n.props.style?.transformOrigin === "top left")[0];
  const beforePan = surface().props.style.transform;
  viewportNode.props.onPointerDown(event()); render(); move({ clientX: 160, clientY: 180 }); finish();
  assert.notEqual(surface().props.style.transform, beforePan, "Empty canvas drag pans");
  assert.equal(surface().props.style.touchAction, "none", "Disable browser touch gestures on draggable surface, not panel ancestor");
  viewportNode.props.onPointerDownCapture(event());
  open(event({ type: "contextmenu", detail: 0 })); assert.ok(panelNode, "Right-click still opens actions");
  nodes(panelNode, (n) => n.props["aria-label"] === "Close canvas actions")[0].props.onClick(); render();
  const wheel = event({ deltaY: 100, target: {} }); wheelListeners.get("wheel").fn(wheel); render(); assert.ok(wheel.prevented);
  open(event({ detail: 0 }));
  const panelWheel = event({ deltaY: 100, target: inside }); wheelListeners.get("wheel").fn(panelWheel); assert.equal(panelWheel.prevented, false, "Panel wheel scroll must remain native");
  const disabled = nodes(panelNode, (n) => ["Safe Mode locks app state changes"].includes(n.props.title));
  assert.equal(disabled.length, 3); assert.ok(disabled.every((n) => n.props.disabled), "Safe Mode stays locked");
  nodes(panelNode, (n) => n.props["aria-label"] === "Close canvas actions")[0].props.onClick(); render(); assert.equal(panelNode, undefined);
  for (const component of [InternetCard, ContainerCard]) {
    const rendered = component({ card: start, container: topology.networks[0].containers[0] });
    const button = nodes(rendered, (n) => n.type === "button")[0];
    assert.equal(button.props.type, "button"); assert.ok(button.props["aria-label"].includes("actions"));
    assert.ok(!button.props.className.includes("opacity-0"), "Actions must not be hover-only");
    assert.ok(button.props.className.includes("min-h-11"));
  }
  let actions = 0;
  const edge = SvgEdge({ from: start, to: { ...start, id: "other", x: 400 }, color: "#fff", onAction: () => actions++ });
  const edgeButton = nodes(edge, (n) => n.props.role === "button")[0];
  assert.equal(edgeButton.props.tabIndex, 0); assert.ok(edgeButton.props["aria-label"].startsWith("Connection actions"));
  for (const key of ["Enter", " "]) { const e = event({ key }); edgeButton.props.onKeyDown(e); assert.ok(e.prevented && e.stopped); }
  edgeButton.props.onKeyDown(event({ key: " ", repeat: true }));
  edgeButton.props.onKeyDown(event({ key: "ArrowDown" })); assert.equal(actions, 2);
  const edgeDown = event(); edge.props.onPointerDown(edgeDown); assert.ok(edgeDown.stopped, "SVG action must not start panning");
  const source = fs.readFileSync(path.join(root, "ServerNetworkMap.tsx"), "utf8");
  assert.ok(source.includes("External reachability is not verified."), "TRUST-01 caveat preserved");
  assert.ok(source.includes("safeModeOff: !safeMode"), "API safety acknowledgment preserved");
  assert.ok(!source.includes("onMouseDown="));
  await checkFlowReview();
  console.log("PASS canvas UX + FLOW-REVIEW-2/3: capture/extra pointers/threshold/cancel/lost capture/drag suppression; named native + SVG keyboard actions; document outside/Escape/close focus + cleanup; bounded scroll/propagation/nonpassive wheel; Safe Mode/TRUST-01 preserved. Browser layout/touch acceptance remains parent-owned.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
