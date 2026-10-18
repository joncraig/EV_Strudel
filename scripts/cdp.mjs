// Dev tool: evaluate a JS expression in the running dev app's renderer over CDP (port 9224).
// Usage: node scripts/cdp.mjs "document.title"
const list = await (await fetch('http://127.0.0.1:9224/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
if (!page) { console.log('no page', list.map((t) => t.url)); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const send = (method, params = {}) => new Promise((res) => {
  const my = ++id
  ws.addEventListener('message', function on(ev) { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener('message', on); res(m) } })
  ws.send(JSON.stringify({ id: my, method, params }))
})
await new Promise((r) => ws.addEventListener('open', r))
const r = await send('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, returnByValue: true, userGesture: true })
console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1))
ws.close()
