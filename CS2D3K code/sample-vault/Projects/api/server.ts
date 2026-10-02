import { createServer } from 'node:http'

interface Route {
  method: string
  path: string
  handler: () => unknown
}

const routes: Route[] = [
  { method: 'GET', path: '/health', handler: () => ({ ok: true }) },
  { method: 'GET', path: '/notes', handler: () => ['Welcome', 'Linking notes'] }
]

export function start(port = 3000): void {
  createServer((req, res) => {
    const route = routes.find((r) => r.method === req.method && r.path === req.url)
    res.setHeader('content-type', 'application/json')
    if (!route) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    res.end(JSON.stringify(route.handler()))
  }).listen(port, () => console.log(`listening on :${port}`))
}
