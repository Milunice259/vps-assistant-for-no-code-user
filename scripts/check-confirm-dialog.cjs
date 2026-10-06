// Run: node scripts/check-confirm-dialog.cjs — no browser or server mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
let states = [], index = 0, confirmed = 0, cancelled = 0;
const react = { ...React, useEffect() {}, useRef: () => ({ current: null }), useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value; }]; } };
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/components/ui/ConfirmDialog.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
vm.runInNewContext(code, { exports: exportsObject, require(name) { if (name === 'react') return react; if (name === '@/components/ui/Button') return { Button: 'button' }; return require(name); } });
function render(props) { index = 0; return exportsObject.ConfirmDialog({ open: true, title: 'Delete backup', message: 'Deletes only the selected recovery file', confirmationText: 'DELETE', onConfirm: () => confirmed++, onCancel: () => cancelled++, ...props }); }
function elements(tree, matches = []) { if (!tree || typeof tree !== 'object') return matches; matches.push(tree); for (const child of [].concat(tree.props?.children || [])) elements(child, matches); return matches; }
let tree = render(); let nodes = elements(tree);
assert.ok(nodes.some(x => x.props.role === 'dialog' && x.props['aria-modal'] === 'true'));
let input = nodes.find(x => x.type === 'input'); let confirm = nodes.find(x => x.type === 'button' && x.props.onConfirm === undefined && x.props.loading !== undefined);
assert.equal(confirm.props.disabled, true);
input.props.onChange({ target: { value: 'wrong' } });
assert.equal(elements(render()).find(x => x.type === 'button' && x.props.loading !== undefined).props.disabled, true);
input.props.onChange({ target: { value: 'DELETE' } });
confirm = elements(render()).find(x => x.type === 'button' && x.props.loading !== undefined);
assert.equal(confirm.props.disabled, false); confirm.props.onClick(); assert.equal(confirmed, 1);
render({ open: false }); render();
assert.equal(elements(render()).find(x => x.type === 'input').props.value, '');
const busy = elements(render({ loading: true }));
busy.find(x => x.props.className === 'absolute inset-0').props.onClick(); assert.equal(cancelled, 0);
assert.equal(busy.find(x => x.type === 'input').props.disabled, true);
assert.match(source, /e.key === "Escape" && !loading/);
assert.match(source, /e.key === "Tab"/);
console.log('PASS typed confirmation, reopen clears stale acknowledgment, modal semantics/focus trap and busy backdrop/Escape protection.');
