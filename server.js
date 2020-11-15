const Busboy = require('busboy')
const doNotCache = require('do-not-cache')
const escapeHTML = require('escape-html')
const fs = require('fs')
const moment = require('moment')
const parseURL = require('url-parse')
const path = require('path')
const runSeries = require('run-series')

// Logging

const logger = require('pino')()
const addLoggers = require('pino-http')({ logger })

// Error Handling

process
  .on('SIGTERM', shutdown)
  .on('SIGQUIT', shutdown)
  .on('SIGINT', shutdown)
  .on('uncaughtException', (error) => {
    logger.error(error, 'uncaughtException')
    shutdown()
  })

// HTTP Server

const server = require('http').createServer()

server.on('request', (request, response) => {
  addLoggers(request, response)
  const parsed = request.parsed = parseURL(request.url, true)
  const pathname = parsed.pathname
  if (pathname === '/') return serveIndex(request, response)
  if (pathname === '/styles.css') return serveStyles(request, response)
  if (pathname === '/client.js') return serveClient(request, response)
  return serveFile(request, response)
})

server.listen(process.env.PORT || 8080, () => {
  logger.info({ port: server.address().port }, 'listening')
})

function shutdown () {
  server.close(() => process.exit())
}

// Partials

const meta = `
<meta charset=UTF-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<link href=/styles.css rel=stylesheet>
`.trim()

// Routes

function serveIndex (request, response) {
  doNotCache(response)
  listFiles((error, files) => {
    if (error) return internalError(request, response, error)
    servePage(files)
  })

  function servePage (files) {
    const accept = request.headers.accept
    if (accept === 'text/plain') {
      response.setHeader('Content-Type', 'text/plain')
      response.end(files.sort().join('\n') + '\n')
      return
    }
    const items = files.map((file) => {
      return `
<li>
  <a href="/${encodeURIComponent(file)}">${escapeHTML(file)}</a>
</li>
      `.trim()
    })
    response.setHeader('Content-Type', 'text/html')
    response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    ${meta}
    <title>Files</title>
  </head>
  <body>
    <main>
      <h1>Files</h1>
      <ul>${items.join('')}</ul>
    </main>
  </body>
</html>
    `.trim())
  }
}

function listFiles (callback) {
  const directory = directoryName()
  fs.readdir(directory, (error, entries) => {
    if (error) return callback(error)
    const files = []
    runSeries(
      entries.map((entry) => {
        return (done) => {
          const latest = path.join(directory, entry, 'latest')
          fs.lstat(latest, (error, stats) => {
            if (error) return done()
            files.push(entry)
            done()
          })
        }
      }),
      (error) => {
        if (error) return callback(error)
        callback(null, files)
      }
    )
  })
}

function listVersions (name, callback) {
  const directory = path.join(directoryName(), name)
  fs.readdir(directory, (error, entries) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return callback(null, [])
      }
      return callback(error)
    }
    const versions = entries.filter((entry) => !isNaN(Date.parse(entry)))
    callback(null, versions.sort())
  })
}

function serveStyles (request, response) {
  const file = path.join(__dirname, 'styles.css')
  response.setHeader('Content-Type', 'text/css')
  fs.createReadStream(file).pipe(response)
}

function serveClient (request, response) {
  const file = path.join(__dirname, 'client.js')
  response.setHeader('Content-Type', 'text/javascript')
  fs.createReadStream(file).pipe(response)
}

function serveFile (request, response) {
  request.fileName = path.basename(request.parsed.pathname)
  request.filePath = path.join(
    directoryName(),
    request.fileName
  )
  const method = request.method
  if (method === 'GET') return getFile(request, response)
  if (method === 'POST') return postFile(request, response)
  response.statusCode = 405
  response.end()
}

function getFile (request, response) {
  doNotCache(response)
  const version = request.parsed.query.version
    ? decodeURIComponent(request.parsed.query.version)
    : 'latest'
  const file = path.join(request.filePath, version)
  fs.readFile(file, 'utf8', (error, text) => {
    if (error) {
      if (error.code === 'ENOENT') return withText('')
      return internalError(request, response, error)
    }
    withText(text)
  })

  function withText (text) {
    listVersions(request.fileName, (error, versions) => {
      if (error) return internalError(request, response, error)
      servePage(text, versions)
    })
  }

  function servePage (text, versions) {
    const accept = request.headers.accept
    if (accept === 'text/plain') {
      response.setHeader('Content-Type', 'text/plain')
      response.end(text)
      return
    }
    const items = versions
      .reverse()
      .slice(0, 10)
      .map((version) => {
        const url = `/${encodeURIComponent(request.fileName)}?version=${encodeURIComponent(version)}`
        const text = moment(version).fromNow()
        return `<li><a href="${url}" title="${escapeHTML(version)}">${escapeHTML(text)}</a></li>`
      })
    response.setHeader('Content-Type', 'text/html')
    response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    ${meta}
    <title>${escapeHTML(request.fileName)}</title>
  </head>
  <body>
    <main>
      <form id=form method=post enctype=multipart/form-data>
        <h1>${escapeHTML(request.fileName)}</h1>
        <textarea id=textarea name=text>${escapeHTML(text)}</textarea>
        <button type=submit>Save</button>
      </form>
      <ol id=versions>${items.join('')}</ol>
    </main>
    <script src=/client.js></script>
  </body>
</html>
    `.trim())
  }
}

function postFile (request, response) {
  let text
  const parser = new Busboy({ headers: request.headers })
    .on('field', (name, value) => {
      if (name === 'text') text = value
    })
    .once('finish', saveAndRedirect)
  request.pipe(parser)

  function saveAndRedirect () {
    const time = new Date().toISOString()
    request.log.info({ name: request.fileName, version: time }, 'saving')
    const version = path.join(request.filePath, time)
    const latest = path.join(request.filePath, 'latest')
    runSeries([
      (done) => fs.mkdir(request.filePath, { recursive: true }, done),
      (done) => fs.writeFile(version, text, done),
      (done) => {
        fs.unlink(latest, (error) => {
          if (error && error.code !== 'ENOENT') return done(error)
          done()
        })
      },
      (done) => fs.symlink(version, latest, done)
    ], (error) => {
      if (error) return internalError(request, response, error)
      response.statusCode = 303
      response.setHeader('Location', '/' + request.fileName)
      response.end()
    })
  }
}

function internalError (request, response, error) {
  request.log.error(error)
  response.statusCode = 500
  response.end()
}

// Helper Functions

function directoryName () {
  return process.env.DIRECTORY || 'files'
}
