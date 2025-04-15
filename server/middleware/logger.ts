import { H3Event } from 'h3'

const logApiRequest = (event: H3Event, status: number, error?: any) => {
  const ip = event.node.req.socket.remoteAddress || 'unknown'
  const method = event.method
  const path = event.path
  const userAgent = getHeader(event, 'user-agent')
  const timestamp = new Date().toISOString()
  
  console.log(`[${timestamp}] ${method} ${path} - IP: ${ip} - Status: ${status} - UA: ${userAgent}${error ? ` - Error: ${error}` : ''}`)
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  
  try {
    event.node.res.on('finish', () => {
      const duration = Date.now() - startTime
      logApiRequest(event, event.node.res.statusCode, `Duration: ${duration}ms`)
    })
  } catch (error) {
    const duration = Date.now() - startTime
    logApiRequest(event, 500, `Error: ${error} - Duration: ${duration}ms`)
  }
})
